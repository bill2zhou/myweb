'use strict';
/**
 * 「测试资料查询」页面的同源转发：/fmdi、/everything
 *
 * search/index.html 要用到两个外部服务：
 *   FMDI 接口    http://192.188.0.13:9092/FMDI/SMT/FTSTDCHECK.ashx
 *   Everything   http://192.188.0.240:2016/（HTTP 服务，需 Basic 认证，且不返回 CORS 响应头）
 * 浏览器直连属于跨域，会被同源策略拦掉；所以由本服务代转一次：
 * 页面里接口地址填 /fmdi、Everything 地址填 /everything，与页面放在同一个源上，不需要额外运行代理程序。
 *
 * 目标地址可用环境变量覆盖（与 search/web-proxy/proxy.js 同名，换现场只改环境变量即可）：
 *   FMDI_PREFIX / FMDI_TARGET / FMDI_UA / FMDI_TIMEOUT
 *   EVERYTHING_PREFIX / EVERYTHING_TARGET / EVERYTHING_USER / EVERYTHING_PASS / EVERYTHING_TIMEOUT
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

function envStr(name, dflt) {
  return process.env[name] === undefined || process.env[name] === '' ? dflt : process.env[name];
}

const RULES = [
  {
    label: 'FMDI 接口',
    prefix: envStr('FMDI_PREFIX', '/fmdi'),
    target: envStr('FMDI_TARGET', 'http://192.188.0.13:9092/FMDI/SMT/FTSTDCHECK.ashx'),
    userAgent: envStr('FMDI_UA', 'FMDICLIENT'),
    auth: '',
    /* 页面自己 10 秒就放弃，这里略早一点结束，好把失败原因送回页面显示 */
    timeout: Number(envStr('FMDI_TIMEOUT', 9000)),
  },
  {
    label: 'Everything',
    prefix: envStr('EVERYTHING_PREFIX', '/everything'),
    target: envStr('EVERYTHING_TARGET', 'http://192.188.0.240:2016/'),
    userAgent: '',
    /* Everything 不开匿名访问，这里代加 Basic 认证 */
    auth: 'Basic ' + Buffer.from(
      envStr('EVERYTHING_USER', 'engineer') + ':' + envStr('EVERYTHING_PASS', 'engineer'),
      'utf8'
    ).toString('base64'),
    timeout: Number(envStr('EVERYTHING_TIMEOUT', 14000)),
  },
];

/** 目标地址本身带 ? 时用 & 拼接入参 */
function joinQuery(base, search) {
  if (!search) return base;
  return base + (base.indexOf('?') === -1 ? search : '&' + search.slice(1));
}

function forward(req, res, rule) {
  let upstream = rule.target;
  let u;
  try {
    const search = req.originalUrl.indexOf('?') === -1
      ? ''
      : new URL(req.originalUrl, 'http://localhost').search;
    upstream = joinQuery(rule.target, search);
    u = new URL(upstream);
  } catch (e) {
    return res.status(500).type('text/plain; charset=utf-8').send('转发目标地址不合法：' + rule.target);
  }

  const client = u.protocol === 'https:' ? https : http;
  const headers = Object.assign({}, req.headers);
  delete headers.host;
  delete headers['accept-encoding'];   // 不接压缩，原样回传，省去解压/再压
  delete headers['content-length'];
  delete headers['transfer-encoding'];
  headers.host = u.host;
  headers.accept = '*/*';
  if (rule.userAgent) headers['user-agent'] = rule.userAgent;
  if (rule.auth) headers.authorization = rule.auth;

  const preq = client.request({
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port || (u.protocol === 'https:' ? 443 : 80),
    method: req.method,
    path: u.pathname + u.search,
    headers: headers,
  }, (pres) => {
    const out = Object.assign({}, pres.headers);
    delete out['content-length'];
    delete out['transfer-encoding'];
    out['x-upstream-status'] = String(pres.statusCode);
    res.writeHead(pres.statusCode, out);
    pres.pipe(res);
  });

  preq.setTimeout(rule.timeout, () => {
    preq.destroy(new Error('目标 ' + rule.timeout + 'ms 未响应'));
  });

  preq.on('error', (err) => {
    if (res.headersSent) return res.end();
    const envName = rule.label === 'Everything' ? 'EVERYTHING_TARGET' : 'FMDI_TARGET';
    res.status(502).type('text/plain; charset=utf-8').send(
      '转发失败（' + rule.label + '）：' + err.message +
      '\n目标地址：' + upstream +
      '\n提示：检查本机到目标的网络、目标服务是否已启动；目标地址可用环境变量 ' + envName + ' 覆盖'
    );
  });

  if (req.method === 'GET' || req.method === 'HEAD') {
    preq.end();
  } else if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
    /* 全局 body 解析器已把请求体读完，这里按 JSON 重新发出去 */
    const body = JSON.stringify(req.body);
    preq.setHeader('content-type', 'application/json; charset=utf-8');
    preq.setHeader('content-length', Buffer.byteLength(body));
    preq.end(body);
  } else {
    req.pipe(preq);
  }
}

module.exports = function registerForward(app) {
  for (const rule of RULES) {
    /* 匹配 /fmdi 以及 /fmdi/xxx，入参只看查询串（与 web-proxy/proxy.js 行为一致） */
    app.use(rule.prefix, (req, res) => forward(req, res, rule));
  }
};
