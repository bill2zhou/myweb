'use strict';
/**
 * 手动生成 SQLite3 数据库文件：
 *   npm run gen:db
 * 生成位置：<项目根>/data/ate.db
 */
const path = require('path');
const { initDatabase, getDb } = require('../server/db');

const rootDir = path.join(__dirname, '..');
const dataDir = path.join(rootDir, 'data');

initDatabase({ dataDir, rootDir });
const db = getDb();

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  .all();

console.log('数据库生成完成：' + path.join(dataDir, 'ate.db'));
for (const t of tables) {
  const c = db.prepare(`SELECT COUNT(*) AS c FROM "${t.name}"`).get().c;
  console.log(`  - ${t.name}: ${c} 行`);
}

// 显式关闭，避免进程退出时原生模块析构断言
db.close();
