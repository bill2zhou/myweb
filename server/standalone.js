'use strict';
const { T, L } = require('./lang');
/**
 * 纯 Node.js 启动方式（不使用 Electron，适合直接架在服务器 / 局域网主机上）：
 *   npm run serve
 * 启动后控制台会打印本机与局域网访问地址。
 * 默认监听 0.0.0.0:80，可用 TE_HOST / TE_PORT 环境变量覆盖。
 */
const path = require('path');
const { initDatabase, getDb, closeDatabase } = require('./db');
const { startServer } = require('./index');

const rootDir = path.join(__dirname, '..');
const dataDir = path.join(rootDir, 'data');

initDatabase({ dataDir, rootDir });

startServer({ rootDir, getDb }).catch((err) => {
  console.error(T('[TE-Server] 启动失败：'), err.message || err);
  process.exit(1);
});

function shutdown() {
  closeDatabase();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
