'use strict';
/**
 * 测试资料查询 · 同源转发服务（Node.js，零依赖，单文件）
 *
 * 作用：把「页面 + FMDI 接口 + Everything」放在同一个源上，浏览器就没有跨域问题，
 *       也不用在 IIS 上装 ASP.NET。
 *
 * 用法：把本文件与 index.html（或 search.html）放在同一目录，然后
 *         node proxy.js
 *         node proxy.js --port 8080          （改端口）
 *       浏览器打开   http://<本机IP>:8080/
 *
 * 打包成单个 exe：执行 node build-exe.js（需先装 Node，打包用一次即可），
 *       产物 dist/测试资料查询代理.exe；目标机器无需安装 Node，页面已内嵌，双击即用。
 *
 * 页面设置：接口设置 → URL 填 /fmdi
 *           Everything 设置 → 地址填 /everything（由本服务代加 engineer 的 Basic 认证）
 *
 * 路由规则：
 *   /fmdi?...        → http://192.188.0.13:9092/FMDI/SMT/FTSTDCHECK.ashx?...   （带 User-Agent: FMDICLIENT）
 *   /everything?...  → http://192.188.0.240:2016/...                          （由本服务带 Basic 认证）
 *   /file?path=...   → 读取本机/共享路径上的文件并回传（供页面弹窗预览 txt / webp）
 *   其它路径          → 返回本目录下的静态文件（默认 index.html / search.html）
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { spawn } = require('child_process');

/* ---- 单文件 exe（Node SEA）支持：页面文件已被嵌进 exe 时从这里读取 ---- */
let SEA = null;
try {
  const sea = require('node:sea');
  if (sea.isSea()) SEA = sea;
} catch (e) { /* 普通 node 运行时没有 node:sea 模块 */ }

/* ======== 配置：按现场情况改这里（也可用同名环境变量覆盖） ======== */
const CONFIG = {
  port: Number(process.env.PORT) || 8080,
  /* exe 运行时以 exe 所在目录为静态目录，方便把页面放在 exe 旁边替换内嵌版本 */
  staticDir: process.env.STATIC_DIR || (SEA ? path.dirname(process.execPath) : __dirname),
  indexFiles: ['index.html', 'search.html', 'search/search.html'],
  cors: true,                       // 转发响应是否附加 Access-Control-Allow-Origin: *

  fmdi: {
    prefix: process.env.FMDI_PREFIX || '/fmdi',
    target: process.env.FMDI_TARGET || 'http://192.188.0.13:9092/FMDI/SMT/FTSTDCHECK.ashx',
    userAgent: process.env.FMDI_UA || 'FMDICLIENT',
    timeout: 10000
  },

  everything: {
    prefix: process.env.EVERYTHING_PREFIX || '/everything',
    target: process.env.EVERYTHING_TARGET || 'http://192.188.0.240:2016/',
    user: process.env.EVERYTHING_USER === undefined ? 'engineer' : process.env.EVERYTHING_USER,
    pass: process.env.EVERYTHING_PASS === undefined ? 'engineer' : process.env.EVERYTHING_PASS,
    timeout: 15000
  },

  /* 文件内容预览：浏览器不能直读 D:\… 或 \\共享\… 这类路径，
     由本服务按完整路径读取后回传。只允许下面白名单里的扩展名，防止被当成任意文件下载器 */
  file: {
    prefix: process.env.FILE_PREFIX || '/file',
    maxTextBytes: Number(process.env.FILE_MAX_TEXT) || 8 * 1024 * 1024,
    maxImageBytes: Number(process.env.FILE_MAX_IMAGE) || 40 * 1024 * 1024,
    textExts: ['.txt', '.log', '.csv', '.json', '.xml', '.ini', '.md', '.text',
               '.cfg', '.conf', '.yml', '.yaml', '.sql', '.dat', '.htm', '.html',
               '.bat', '.ps1', '.js', '.css'],
    imageExts: ['.webp', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.avif']
  }
};
/* ================================================================ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml'
};

const STATIC_ROOT = path.resolve(CONFIG.staticDir);

function argValue(name) {
  const hit = process.argv.find(a => a.startsWith(name + '='));
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return hit ? hit.slice(name.length + 1) : '';
}

function joinQuery(base, search) {
  if (!search) return base;
  return base + (base.indexOf('?') === -1 ? search : '&' + search.slice(1));
}

function log(...args) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log('[' + t + ']', ...args);
}

/* ---------- 静态文件 ---------- */
function mimeOf(name) {
  return MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';
}

/* 从 exe 内嵌资源取文件（打包成单文件 exe 后使用） */
function bundledAsset(rel) {
  if (!SEA || !rel) return null;
  const key = String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!key) return null;
  try {
    return Buffer.from(SEA.getAsset(key));
  } catch (e) {
    return null;
  }
}

/* 返回磁盘文件路径；找不到返回 null（先看同目录，再看内嵌资源） */
function resolveOnDisk(rel) {
  const file = path.resolve(path.join(STATIC_ROOT, rel));
  const inside = file === STATIC_ROOT || file.startsWith(STATIC_ROOT + path.sep);
  if (!inside || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return file;
}

function findIndex() {
  for (const f of CONFIG.indexFiles) {
    if (resolveOnDisk(f)) return f;
    if (bundledAsset(f)) return f;
  }
  return null;
}

/* 发一个文件：同目录磁盘文件优先，其次 exe 内嵌资源。命中返回 true */
function sendFile(res, rel) {
  const relPath = decodeURIComponent(rel).replace(/^\/+/, '');
  const file = resolveOnDisk(relPath);
  if (file) {
    res.writeHead(200, { 'content-type': mimeOf(file), 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
    return true;
  }
  const buf = bundledAsset(relPath);
  if (buf) {
    res.writeHead(200, {
      'content-type': mimeOf(relPath),
      'content-length': buf.length,
      'cache-control': 'no-store'
    });
    res.end(buf);
    return true;
  }
  return false;
}

function serveStatic(req, res, pathname) {
  let rel = pathname;
  if (rel === '/' || rel === '') {
    const found = findIndex();
    if (!found) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('未找到 ' + CONFIG.indexFiles.join(' 或 ') + '，请把页面放在本程序同一目录');
    }
    rel = '/' + found;
  }
  if (sendFile(res, rel)) return;
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('未找到文件: ' + rel);
}

/* ---------- 文件预览：/file?path=<完整路径> ---------- */
function fail(res, code, msg) {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(msg);
}

/* 文本编码：UTF-8 优先，不是合法 UTF-8 就按 GBK/GB18030 解码（现场 txt 多为 GBK） */
function decodeText(buf) {
  let b = buf;
  if (b.length > 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) b = b.subarray(3);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch (e) { /* 不是 UTF-8 */ }
  try {
    return new TextDecoder('gb18030').decode(b);
  } catch (e) { /* 运行时没有 GBK 支持（非 full-icu） */ }
  return b.toString('utf8');
}

/* 只接受绝对路径：Windows 盘符 / UNC 共享，其它平台 / 开头 */
function resolveTargetPath(raw) {
  const s = String(raw || '').trim();
  if (!s || s.indexOf('\0') !== -1) return null;
  if (process.platform === 'win32') {
    if (/^[a-z]:[\\/]/i.test(s) || /^\\\\[^\\]/.test(s)) return path.win32.normalize(s);
    return null;
  }
  return s[0] === '/' ? path.normalize(s) : null;
}

function serveFilePreview(req, res, url) {
  const raw = url.searchParams.get('path') || '';
  const target = resolveTargetPath(raw);
  if (!target) {
    return fail(res, 400, '缺少 path 参数或不是绝对路径（需形如 D:\\资料\\a.txt 或 \\\\server\\share\\a.txt）');
  }

  let st;
  try {
    st = fs.statSync(target);
  } catch (e) {
    return fail(res, 404, '文件不存在或无权访问：' + target);
  }
  if (st.isDirectory()) return fail(res, 400, '目标是文件夹，无法预览：' + target);

  const ext = path.extname(target).toLowerCase();
  log('preview', target);

  if (CONFIG.file.textExts.indexOf(ext) !== -1) {
    if (st.size > CONFIG.file.maxTextBytes) {
      return fail(res, 413, '文件过大（' + st.size + ' 字节，上限 ' + CONFIG.file.maxTextBytes + '）：' + target);
    }
    let buf;
    try {
      buf = fs.readFileSync(target);
    } catch (e) {
      return fail(res, 500, '读取失败：' + e.message);
    }
    const body = Buffer.from(decodeText(buf), 'utf8');
    res.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'content-length': body.length,
      'cache-control': 'no-store',
      'access-control-allow-origin': '*'
    });
    return res.end(body);
  }

  if (CONFIG.file.imageExts.indexOf(ext) !== -1) {
    if (st.size > CONFIG.file.maxImageBytes) {
      return fail(res, 413, '图片过大（' + st.size + ' 字节，上限 ' + CONFIG.file.maxImageBytes + '）：' + target);
    }
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': 'no-store',
      'access-control-allow-origin': '*'
    });
    fs.createReadStream(target).on('error', () => res.end()).pipe(res);
    return;
  }

  return fail(res, 415, '该类型不支持预览（仅 ' + CONFIG.file.textExts.concat(CONFIG.file.imageExts).join(' ') + '）：' + target);
}

/* ---------- 转发 ---------- */
function proxy(req, res, rule) {
  const incoming = new URL(req.url, 'http://localhost');
  const upstream = joinQuery(rule.target, incoming.search);
  const u = new URL(upstream);
  const client = u.protocol === 'https:' ? https : http;

  const headers = Object.assign({}, req.headers);
  delete headers['accept-encoding'];
  delete headers.host;
  headers.host = u.host;
  headers.accept = '*/*';
  if (rule.userAgent) headers['user-agent'] = rule.userAgent;
  if (rule.user) {
    headers.authorization = 'Basic ' + Buffer.from(rule.user + ':' + (rule.pass || ''), 'utf8').toString('base64');
  }

  log('->', upstream);
  const preq = client.request({
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port || (u.protocol === 'https:' ? 443 : 80),
    method: req.method,
    path: u.pathname + u.search,
    headers: headers
  }, pres => {
    const out = Object.assign({}, pres.headers);
    delete out['content-length'];
    delete out['transfer-encoding'];
    if (CONFIG.cors) {
      out['access-control-allow-origin'] = '*';
      out['access-control-allow-headers'] = '*';
      out['access-control-allow-methods'] = 'GET,POST,OPTIONS';
    }
    out['x-upstream-status'] = String(pres.statusCode);
    res.writeHead(pres.statusCode, out);
    let size = 0;
    pres.on('data', d => { size += d.length; });
    pres.on('end', () => log('<-', pres.statusCode, size + ' 字节'));
    pres.pipe(res);
  });

  preq.setTimeout(rule.timeout || 15000, () => preq.destroy(new Error('上游响应超时 ' + (rule.timeout || 15000) + 'ms')));
  preq.on('error', err => {
    log('!!', err.message, '目标:', upstream);
    if (res.headersSent) return res.end();
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('转发失败: ' + err.message + '\n目标地址: ' + upstream
      + '\n提示: 检查本机到目标的网络、目标服务是否运行、账号密码是否正确');
  });
  req.pipe(preq);
}

/* ---------- 入口 ---------- */
/* 路径匹配：/fmdi、/fmdi/xxx（Everything 同理） */
function isFmdiPath(pathname) {
  return pathname === CONFIG.fmdi.prefix || pathname.startsWith(CONFIG.fmdi.prefix + '/');
}

function isEverythingPath(pathname) {
  return pathname === CONFIG.everything.prefix || pathname.startsWith(CONFIG.everything.prefix + '/');
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS'
    });
    return res.end();
  }

  if (isFmdiPath(pathname)) {
    return proxy(req, res, CONFIG.fmdi);
  }
  if (isEverythingPath(pathname)) {
    return proxy(req, res, CONFIG.everything);
  }
  if (pathname === CONFIG.file.prefix || pathname.startsWith(CONFIG.file.prefix + '/')) {
    return serveFilePreview(req, res, new URL(req.url, 'http://localhost'));
  }
  serveStatic(req, res, pathname);
});

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (e) {
    log('!! 打开浏览器失败:', e.message);
  }
}

const port = Number(argValue('--port')) || CONFIG.port;
const localUrl = 'http://127.0.0.1:' + port + '/';
/* 双击 exe 时自动打开页面；不想自动打开可加 --no-open，普通 node 运行默认不打开 */
const autoOpen = process.argv.includes('--open') || (SEA !== null && !process.argv.includes('--no-open'));

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.log('[错误] 端口 ' + port + ' 已被占用，请先关掉占用的程序，或用 --port 8081 换端口。');
  } else {
    console.log('[错误] ' + err.message);
  }
  process.exit(1);
});

server.listen(port, () => {
  console.log('测试资料查询 · 同源转发服务已启动' + (SEA ? '（单文件 exe）' : ''));
  console.log('  页面地址:  ' + localUrl);
  console.log('  FMDI 转发: ' + CONFIG.fmdi.prefix + '  ->  ' + CONFIG.fmdi.target);
  console.log('  Everything: ' + CONFIG.everything.prefix + '  ->  ' + CONFIG.everything.target
    + (CONFIG.everything.user ? '（服务端代加 Basic 认证）' : ''));
  console.log('  文件预览:   ' + CONFIG.file.prefix + '?path=<完整路径>  ->  本机/共享文件（txt、webp 等）');
  console.log('  页面里接口地址填 ' + CONFIG.fmdi.prefix + '，Everything 地址填 ' + CONFIG.everything.prefix);
  console.log('按 Ctrl+C 结束');
  if (autoOpen) openBrowser(localUrl);
});
