'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const { host: defaultHost, port: defaultPort, fallbackPorts, logAddresses } = require('./config');
// 多语言：启动阶段的提示文字也要能翻译（下面 startServer 里会用到 L）
const { T, L } = require('./lang');

/** 不允许通过 HTTP 访问的后端目录 */
const BLOCKED_DIRS = /^\/(data|server|electron|scripts|node_modules|\.git|\.vscode)(\/|$)/i;
/** 不允许通过 HTTP 访问的敏感文件（数据库导出、依赖清单、日志等） */
const BLOCKED_FILES = /^\/(localhost\.sql|ate\.sql|package(-lock)?\.json|.*\.(db|db-wal|db-shm|log))$/i;

/**
 * 创建 Express 应用（保持与原 PHP 站点完全一致的 URL 路径）
 * @param {object} opts
 * @param {string} opts.rootDir  静态资源根目录（项目根）
 * @param {Function} opts.getDb  返回 better-sqlite3 实例
 */
function createApp({ rootDir, getDb }) {
  const app = express();
  app.disable('x-powered-by');

  app.use(express.urlencoded({ extended: true, limit: '20mb' }));
  app.use(express.json({ limit: '20mb' }));
  app.use(
    session({
      name: 'TESESSID',
      secret: 'te-myweb-session-secret',
      resave: false,
      saveUninitialized: true,
      cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 },
    })
  );

  // 多语言：把当前请求的语言绑定到上下文（后续所有接口用 T()/L` ` 输出对应语言）
  const lang = require('./lang');
  app.use(lang.middleware());

  const ctx = { getDb, rootDir };

  // 注册各目录接口（顺序无依赖）
  require('./routes/php')(app, ctx);
  require('./routes/fpy')(app, ctx);
  require('./routes/maintain')(app, ctx);
  require('./routes/manage')(app, ctx);
  require('./routes/form')(app, ctx);
  require('./routes/handover')(app, ctx);
  require('./routes/search')(app, ctx);
  require('./routes/test')(app, ctx);
  // 数据库管理（自带鉴权，须在静态资源处理之前注册）
  require('./routes/dbadmin')(app, ctx);

  // 多语言脚本：引擎 + 词典 + 当前语言，由服务端实时拼装下发
  app.get('/js/i18n.js', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.type('application/javascript; charset=utf-8').send(lang.clientScript(rootDir));
  });

  // 未被上面路由处理的 .php 请求不再返回源码
  app.use((req, res, next) => {
    if (/\.php$/i.test(req.path)) {
      return res.status(404).type('text/html; charset=utf-8').send('Not Found');
    }
    next();
  });

  // 后端目录与敏感文件一律拒绝
  app.use((req, res, next) => {
    if (BLOCKED_DIRS.test(req.path) || BLOCKED_FILES.test(req.path)) {
      return res.status(404).type('text/plain; charset=utf-8').send('Not Found');
    }
    next();
  });

  // HTML 页面：读取后统一声明 UTF-8 并禁用缓存（改完页面按 Ctrl+F5 立即生效）
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let rel = req.path;
    if (rel === '/' || rel.endsWith('/')) rel += 'index.html';
    if (!/\.html?$/i.test(rel)) return next();
    // 第三方组件自带的示例页面不做处理
    if (/^\/(lib|layui)\//i.test(rel)) return next();

    let decoded;
    try { decoded = decodeURIComponent(rel); } catch (e) { return next(); }

    const filePath = path.normalize(path.join(rootDir, decoded));
    if (!filePath.startsWith(path.normalize(rootDir))) return next();

    fs.readFile(filePath, (err, buf) => {
      if (err) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.type('text/html; charset=utf-8').send(buf.toString('utf8'));
    });
  });

  // 其余静态资源（CSS/JS/图片/layui/lib 等）
  app.use(express.static(rootDir, { index: false }));

  app.use((req, res) => res.status(404).type('text/plain; charset=utf-8').send('Not Found'));
  return app;
}

/**
 * 启动 HTTP 服务
 * 默认监听 0.0.0.0:80（与原站点一致），局域网内其它电脑用 http://本机IP/ 访问。
 * 如需仅本机可用，设置环境变量 TE_HOST=127.0.0.1
 *
 * @returns {Promise<{server:any, port:number, host:string}>}
 */
function startServer({ rootDir, getDb, port = defaultPort, host = defaultHost }) {
  const app = createApp({ rootDir, getDb });
  const candidates = [port, ...fallbackPorts.filter((p) => p !== port)];

  return new Promise((resolve, reject) => {
    const tryListen = (index) => {
      if (index >= candidates.length) {
        reject(new Error(
          L`端口 ${port} 及其备选端口均被占用。请关闭占用 ${port} 端口的程序` +
          L`（IIS / Apache / 另一个 TE-Server 实例）后重试。`
        ));
        return;
      }
      const p = candidates[index];
      const server = app.listen(p, host, () => {
        if (p !== port) {
          console.warn(L`[TE-Server] 端口 ${port} 已被占用，本次改用 ${p}。`);
          console.warn(L`[TE-Server] 如需恢复 ${port}，请释放该端口后重启本程序。`);
        }
        logAddresses(host, p);
        resolve({ server, port: p, host });
      });
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
          tryListen(index + 1);
        } else {
          reject(err);
        }
      });
    };
    tryListen(0);
  });
}

module.exports = { createApp, startServer };
