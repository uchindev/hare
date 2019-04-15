const Koa = require('koa')
const { Nuxt, Builder } = require('nuxt')
const bunyan = require('bunyan')
const mkdirp = require('mkdirp')
const koaBunyan = require('koa-bunyan')
const koaLogger = require('koa-bunyan-logger')
const chalk = require('chalk')
const proxy = require('koa-proxies')
const config = require('../nuxt.config.js')
const useMiddlewares = require('./middlewares')
const useRoutes = require('./routes')
const consts = require('./utils/consts')

// Start nuxt.js
async function start() {
  const isWin = /^win/.test(process.platform)
  const host = consts.HOST
  const port = consts.PORT
  const app = new Koa()

  app.keys = ['hare-server']
  config.dev = !(app.env === 'production')

  // logging
  let logDir = process.env.LOG_DIR || (isWin ? 'C:\\\\log' : '/var/tmp/log')
  mkdirp.sync(logDir)
  logDir = logDir.replace(/(\\|\/)+$/, '') + (isWin ? '\\\\' : '/')

  const access = {
    type: 'rotating-file',
    path: `${logDir}hare-access.log`,
    level: config.dev ? 'debug' : 'info',
    period: '1d',
    count: 4
  }
  const error = {
    type: 'rotating-file',
    path: `${logDir}hare-error.log`,
    level: 'error',
    period: '1d',
    count: 4
  }
  const logger = bunyan.createLogger({
    name: 'hare',
    streams: [
      access,
      error
    ]
  })
  app.use(koaBunyan(logger, {
    level: config.dev ? 'debug' : 'info'
  }))
  app.use(koaLogger(logger))

  const nuxt = new Nuxt(config)
  // Build only in dev mode
  if (config.dev) {
    const devConfigs = config.development
    if (devConfigs && devConfigs.proxies) {
      for (const proxyItem of devConfigs.proxies) {
        // eslint-disable-next-line no-console
        console.log(
          `Active Proxy: path[${proxyItem.path}] target[${proxyItem.target}]`
        )
        app.use(proxy(proxyItem.path, proxyItem))
      }
    }
    await new Builder(nuxt).build()
  }

  // select sub-app (admin/api) according to host subdomain (could also be by analysing request.url);
  // separate sub-apps can be used for modularisation of a large system, for different login/access
  // rights for public/protected elements, and also for different functionality between api & web
  // pages (content negotiation, error handling, handlebars templating, etc).

  app.use(async (ctx, next) => {
    // use subdomain to determine which app to serve: www. as default, or admin. or api
    // note: could use root part of path instead of sub-domains e.g. ctx.request.url.split('/')[1]
    ctx.state.subapp = ctx.url.split('/')[1] // subdomain = part after first '/' of hostname
    if (ctx.state.subapp !== consts.API) {
      ctx.status = 200 // koa defaults to 404 when it sees that status is unset
      ctx.req.session = ctx.session
      await new Promise((resolve, reject) => {
        nuxt.render(ctx.req, ctx.res, (err) => {
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        })
      })
    } else {
      await next()
    }
  })

  useMiddlewares(app)
  useRoutes(app)

  app.listen(port, host)
  const _host = host === '0.0.0.0' ? 'localhost' : host
  // eslint-disable-next-line no-console
  console.log('\n' + chalk.bgGreen.black(' OPEN ') + chalk.green(` http://${_host}:${port}\n`))
}

start()
