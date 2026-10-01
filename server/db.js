'use strict';
const { T, L } = require('./lang');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { parseDump } = require('./sql-import');
const { now } = require('./util');

let db = null;
/** 数据库文件路径与初始化参数（供导入/替换后重新打开使用） */
let dbFile = null;
let dbDataDir = null;
let dbRootDir = null;

/** 原始 MySQL 数据导出文件名（按优先级查找） */
const DUMP_CANDIDATES = ['localhost.sql', 'ate.sql'];

/** 解析 schema.sql 的建表语句 → [{ table, columns: [{ name, def }] }] */
function parseSchema(schemaText) {
  const out = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(([\s\S]*?)\)\s*;/gi;
  let m;
  while ((m = re.exec(schemaText)) !== null) {
    const columns = [];
    for (const raw of m[2].split(',')) {
      const part = raw.trim();
      if (!part) continue;
      const cm = part.match(/^[`"]?(\w+)[`"]?\s+([\s\S]*)$/);
      if (!cm) continue;
      columns.push({ name: cm[1], def: cm[2].trim() });
    }
    out.push({ table: m[1], columns });
  }
  return out;
}

/**
 * 补齐缺失的列。
 * `CREATE TABLE IF NOT EXISTS` 不会修改已存在的表，因此当数据库是旧版本
 * 或由其它程序（曾共用同一产品名/数据目录）创建时，会出现缺列导致接口报错。
 * 这里按 schema.sql 的定义自动 ALTER TABLE 补列。
 */
function ensureColumns(database, schemaText) {
  for (const { table, columns } of parseSchema(schemaText)) {
    const exists = database
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(table);
    if (!exists) continue;

    const have = new Set(
      database.prepare(`PRAGMA table_info("${table}")`).all().map((c) => String(c.name).toLowerCase())
    );
    for (const col of columns) {
      if (have.has(col.name.toLowerCase())) continue;
      if (/PRIMARY\s+KEY/i.test(col.def)) {
        console.warn(L`[TE-Server] 表 ${table} 缺少主键列 ${col.name}，无法自动补齐`);
        continue;
      }
      try {
        database.exec(`ALTER TABLE "${table}" ADD COLUMN "${col.name}" ${col.def}`);
        console.log(L`[TE-Server] 表 ${table} 已自动补列：${col.name}`);
      } catch (e) {
        console.warn(L`[TE-Server] 表 ${table} 补列 ${col.name} 失败：${e.message}`);
      }
    }
  }
}

/**
 * 初始化 SQLite3 数据库。
 * - 不存在时按 schema.sql 建表（并自动补齐旧库缺失的列）
 * - 目标表为空时，导入 MySQL dump 中的原始数据
 *
 * @param {object} opts
 * @param {string} opts.dataDir  数据库文件存放目录（Electron 下为用户数据目录）
 * @param {string} opts.rootDir  项目根目录（用于查找 dump 文件）
 */
function initDatabase({ dataDir, rootDir }) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  dbDataDir = dataDir;
  dbRootDir = rootDir;
  dbFile = path.join(dataDir, 'ate.db');
  const dbPath = dbFile;
  const markerPath = path.join(dataDir, '.seeded');

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  ensureColumns(db, schema);

  // 首次运行（或上次导入未完成）时导入 dump 中的原始数据。
  // 仅当目标表全部为空时才导入，避免覆盖数据库中已有的数据。
  if (!fs.existsSync(markerPath)) {
    const dumpPath = DUMP_CANDIDATES
      .map((f) => path.join(rootDir, f))
      .find((p) => fs.existsSync(p));
    if (dumpPath) {
      const groups = parseDump(fs.readFileSync(dumpPath, 'utf8'));
      const targets = [...new Set(groups.map((g) => g.table))].filter((t) => tableExists(db, t));
      const nonEmpty = targets.filter((t) => countRows(db, t) > 0);

      if (nonEmpty.length) {
        console.warn(
          L`[TE-Server] 数据库中已存在数据（${nonEmpty.join(', ')}），跳过 ${path.basename(dumpPath)} 的导入。`
        );
        console.warn(
          L`[TE-Server] 若要用 ${path.basename(dumpPath)} 重建，请删除 ${dbPath}（连同 -wal/-shm）后重新启动。`
        );
      } else {
        console.log(T('[TE-Server] 首次运行：正在导入 ') + path.basename(dumpPath) + ' …');
        const st = importDump(db, dumpPath, groups);
        console.log(`[TE-Server] 导入完成：写入 ${st.inserted} 行` +
          (st.failed ? `，跳过 ${st.failed} 行` : ''));
        if (st.failed) {
          console.warn('[TE-Server] 被跳过的行示例：' + st.errors.join(' | '));
        }
      }
      fs.writeFileSync(markerPath, new Date().toISOString());
    }
  }
  return db;
}

function tableExists(database, name) {
  return !!database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name);
}

function countRows(database, name) {
  try {
    return database.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get().c;
  } catch (e) {
    return 0;
  }
}

/** 把 PRAGMA 里的默认值文本还原成 JS 值（'' -> 空串，42 -> 42，NULL -> null） */
function parseDefault(decl) {
  if (decl === null || decl === undefined) return undefined;
  const s = String(decl).trim();
  if (/^null$/i.test(s)) return null;
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

/**
 * 把 dump 数据写入 SQLite。
 *
 * 注意：MySQL 数据里经常有 NULL，而 SQLite 的建表语句可能把该列声明为 NOT NULL，
 * 此时直接插入会被拒绝。这里对「NOT NULL 且有默认值」的列，用默认值顶替 NULL，
 * 避免整行被丢弃（历史上曾因此静默丢掉 maintain 表 5999 行）。
 *
 * @returns {{inserted:number, failed:number, errors:string[]}}
 */
function importDump(database, dumpPath, groups) {
  if (!groups) groups = parseDump(fs.readFileSync(dumpPath, 'utf8'));
  const existingTables = new Set(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name)
  );

  // 清空本次要写入的表，保证重复导入不会产生重复数据
  const targets = [...new Set(groups.map((g) => g.table))].filter((t) => existingTables.has(t));

  const stats = { inserted: 0, failed: 0, errors: [] };

  // 用显式事务包裹（BEGIN/COMMIT 走 exec），把上万条插入压缩到一次提交
  database.exec('BEGIN');
  try {
    for (const t of targets) {
      database.prepare(`DELETE FROM "${t}"`).run();
    }

    for (const g of groups) {
      if (!existingTables.has(g.table) || g.rows.length === 0) continue;
      const cols = g.columns;
      const placeholders = cols.map(() => '?').join(',');
      const colList = cols.map((c) => `"${c}"`).join(',');

      // 预先算出每列的 NULL 兜底值（仅 NOT NULL 的列需要）
      const tableInfo = database.prepare(`PRAGMA table_info("${g.table}")`).all();
      const byName = new Map(tableInfo.map((c) => [String(c.name).toLowerCase(), c]));
      const fallback = cols.map((c) => {
        const col = byName.get(String(c).toLowerCase());
        if (!col || !col.notnull) return undefined;   // 可为 NULL，保持 NULL
        const d = parseDefault(col.dflt_value);
        return d === undefined ? '' : d;              // 无默认值时用空串兜底
      });

      const stmt = database.prepare(
        `INSERT INTO "${g.table}" (${colList}) VALUES (${placeholders})`
      );
      for (const row of g.rows) {
        const values = row.map((v, i) => (v === null && fallback[i] !== undefined ? fallback[i] : v));
        try {
          stmt.run(values);
          stats.inserted++;
        } catch (e) {
          // 个别脏数据不影响整表导入，但必须计数，不能再静默吞掉
          stats.failed++;
          if (stats.errors.length < 5) stats.errors.push(`${g.table}: ${e.message}`);
        }
      }
    }
    database.exec('COMMIT');
  } catch (e) {
    try { database.exec('ROLLBACK'); } catch (err) { /* ignore */ }
    throw e;
  }
  return stats;
}

function getDb() {
  if (!db) throw new Error(T('数据库尚未初始化'));
  return db;
}

function closeDatabase() {
  if (db) {
    try { db.close(); } catch (e) { /* ignore */ }
    db = null;
  }
}

/* ============================================================
 *  数据库管理（导入 / 导出 / 清空 / 编辑）支撑函数
 * ============================================================ */

/** 数据库文件绝对路径 */
function getDbPath() {
  return dbFile;
}

/** 数据库文件大小（字节），含 WAL 数据 */
function getDbSize() {
  let size = 0;
  for (const f of [dbFile, dbFile + '-wal']) {
    try { size += fs.statSync(f).size; } catch (e) { /* ignore */ }
  }
  return size;
}

/** 全部业务表（排除 sqlite_ 内部表），带行数 */
function listTables() {
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  return names.map((name) => ({ name, rows: countRows(db, name) }));
}

/** 表结构 */
function tableColumns(name) {
  if (!tableExists(db, name)) throw new Error(T('表不存在：') + name);
  return db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => ({
    name: c.name,
    type: c.type || '',
    notnull: !!c.notnull,
    pk: !!c.pk,
    dflt: c.dflt_value,
  }));
}

/** 校验表名合法（必须是已存在的表，防注入） */
function assertTable(name) {
  if (!name || !tableExists(db, name)) throw new Error(T('表不存在：') + name);
  return name;
}

/** SQL 字面量转义 */
function sqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'bigint') return v.toString();
  if (Buffer.isBuffer(v)) return "X'" + v.toString('hex') + "'";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

/**
 * 导出整库为 SQL 文本（含建表语句与全部数据，可直接再导入）
 */
function dumpSql() {
  const out = [];
  out.push(T('-- TE-Server 数据库导出'));
  out.push(T('-- 导出时间：') + now());
  out.push(T('-- 数据库文件：') + path.basename(dbFile));
  out.push('PRAGMA foreign_keys=OFF;');
  out.push('BEGIN TRANSACTION;');

  let total = 0;
  for (const { name, rows } of listTables()) {
    const schema = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?")
      .get(name).sql;
    out.push('');
    out.push(`DROP TABLE IF EXISTS "${name}";`);
    out.push(String(schema).trim() + ';');

    const cols = tableColumns(name).map((c) => c.name);
    const colList = cols.map((c) => `"${c}"`).join(',');
    const stmt = db.prepare(`SELECT * FROM "${name}"`);
    for (const r of stmt.iterate()) {
      out.push(
        `INSERT INTO "${name}" (${colList}) VALUES (${cols.map((c) => sqlValue(r[c])).join(',')});`
      );
      total++;
    }
  }

  out.push('');
  out.push('COMMIT;');
  return { sql: out.join('\n'), rows: total };
}

/** 导出单表为 CSV（首行表头） */
function dumpCsv(name) {
  assertTable(name);
  const cols = tableColumns(name).map((c) => c.name);
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const out = [cols.map(esc).join(',')];
  for (const r of db.prepare(`SELECT * FROM "${name}"`).iterate()) {
    out.push(cols.map((c) => esc(r[c])).join(','));
  }
  return out.join('\r\n');
}

/**
 * 清空表（重置自增）
 * @param {string[]|null} names 为 null/空 时表示清空全部业务表
 */
function clearTables(names) {
  const all = listTables().map((t) => t.name);
  const targets = names && names.length ? names.filter((n) => all.includes(n)) : all;

  db.exec('BEGIN');
  try {
    for (const t of targets) {
      db.prepare(`DELETE FROM "${t}"`).run();
      db.prepare("DELETE FROM sqlite_sequence WHERE name = ?").run(t);
    }
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (err) { /* ignore */ }
    throw e;
  }
  return targets;
}

/**
 * 用上传的 SQLite 文件替换整个数据库
 * @param {string} tempFile 已落盘的临时文件路径
 */
function replaceDatabase(tempFile) {
  // 先校验它确实是一个可读的 SQLite 数据库
  let probe;
  try {
    probe = new Database(tempFile, { readonly: true, fileMustExist: true });
    const tables = probe.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    if (!tables.length) throw new Error(T('文件中没有任何数据表'));
  } finally {
    if (probe) probe.close();
  }

  closeDatabase();
  // WAL/SHM 与主文件必须一起清掉，否则新库会读到旧日志
  for (const suffix of ['-wal', '-shm']) {
    const f = dbFile + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  fs.copyFileSync(tempFile, dbFile);

  // 重新打开：按 schema.sql 补建缺失的表与列
  initDatabase({ dataDir: dbDataDir, rootDir: dbRootDir });
  return { tables: listTables() };
}

/**
 * 导入 SQL 文本。
 * 支持两种格式：
 *   1. MySQL dump（phpMyAdmin 导出的 `INSERT INTO \`t\` VALUES (...)`）——按表覆盖
 *   2. SQLite SQL 脚本（含 CREATE TABLE / INSERT），直接整体执行
 * @returns {{mode:string, tables:string[], rows:number}}
 */
function importSqlText(text) {
  const groups = parseDump(text);
  const meaningful = groups.filter((g) => g.rows.length > 0);
  const existing = listTables().map((t) => t.name);
  const hit = meaningful.filter((g) => existing.includes(g.table));

  // 1) phpMyAdmin 风格 dump：按表覆盖（保留其它表）
  if (hit.length) {
    const st = importDump(db, 'memory', hit);
    if (st.failed) {
      console.warn(`[TE-Server] 导入时跳过 ${st.failed} 行：${st.errors.join(' | ')}`);
    }
    return {
      mode: 'mysql-dump',
      tables: [...new Set(hit.map((g) => g.table))],
      rows: st.inserted,
      failed: st.failed,
      errors: st.errors,
    };
  }

  // 2) 其余情况按 SQLite 脚本整体执行（支持 CREATE / INSERT / UPDATE / DROP 等）
  if (!/create\s+table|insert\s+into|update\s+|delete\s+from|alter\s+table|drop\s+table/i.test(text)) {
    throw new Error(T('无法识别的 SQL 文件内容'));
  }
  const before = listTables().reduce((a, t) => a + t.rows, 0);
  db.exec(text);
  const tables = listTables();
  const after = tables.reduce((a, t) => a + t.rows, 0);
  return {
    mode: 'sqlite-script',
    tables: tables.map((t) => t.name),
    rows: Math.max(after - before, 0),
  };
}

/** 关闭数据库（供维护操作使用） */
function getState() {
  return { dbFile, dbDataDir, dbRootDir };
}

module.exports = {
  initDatabase,
  getDb,
  closeDatabase,
  getDbPath,
  getDbSize,
  listTables,
  tableColumns,
  assertTable,
  dumpSql,
  dumpCsv,
  clearTables,
  replaceDatabase,
  importSqlText,
  getState,
};
