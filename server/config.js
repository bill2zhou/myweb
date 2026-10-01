'use strict';
const { T, L } = require('./lang');
const os = require('os');

/**
 * 服务监听配置
 *   TE_HOST  监听地址，默认 0.0.0.0（允许局域网访问）
 *            如需仅本机可用，设为 127.0.0.1
 *   TE_PORT  监听端口，默认 80（与原站点保持一致）
 */
const host = process.env.TE_HOST || '0.0.0.0';
const port = Number(process.env.TE_PORT) || 80;

/** 端口被占用时的备选端口（优先保持 80 不变） */
const fallbackPorts = [8080, 8081, 8000, 88];

/** 枚举本机所有 IPv4 局域网地址 */
function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family === 'IPv4' && !info.internal) {
        out.push({ name, address: info.address });
      }
    }
  }
  return out;
}

/** 端口部分省略时浏览器地址更简洁（80 端口） */
function displayPort(p) {
  return Number(p) === 80 ? '' : ':' + p;
}

/** 在控制台打印可访问地址 */
function logAddresses(boundHost, boundPort) {
  const suffix = displayPort(boundPort);
  console.log(L`[TE-Server] 本机访问：http://127.0.0.1${suffix}/`);
  if (boundHost === '0.0.0.0' || boundHost === '::') {
    const list = lanAddresses();
    if (list.length) {
      console.log(T('[TE-Server] 局域网访问（其它电脑用下面的地址打开）：'));
      for (const a of list) {
        console.log(`             http://${a.address}${suffix}/    [${a.name}]`);
      }
    } else {
      console.log(T('[TE-Server] 未检测到可用的局域网网卡地址'));
    }
  }
}

module.exports = { host, port, fallbackPorts, lanAddresses, logAddresses, displayPort };
