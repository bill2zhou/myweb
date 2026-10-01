'use strict';
const { T, L } = require('../lang');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const dbm = require('../db');
const { now } = require('../util');

/**
 * 远程访问密码（本机访问无需密码）。
 * 未设置时：只允许本机（127.0.0.1）访问数据库管理页，局域网一律拒绝。
 * 设置后：局域网用户可在页面上输入密码进入。
 */
const REMOTE_PASSWORD = process.env.TE_DB_PASSWORD || '';

/** 破坏性操作需要的确认口令 */
const CONFIRM_WORD = 'CONFIRM';

const SQLITE_EXT = /\.(db|sqlite|sqlite3|db3)$/i;
const MAX_UPLOAD = '500mb';

function clientIp(req) {
  return String(req.ip || req.connection?.remoteAddress || '').replace(/^::ffff:/, '');
}

function isLoopback(req) {
  const ip = clientIp(req);
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

function isAuthed(req) {
  if (isLoopback(req)) return true;
  if (!REMOTE_PASSWORD) return false;
  return !!(req.session && req.session.dbadmin === true);
}

/** 依据列类型把表单里的字符串值转成合适的 JS 值 */
function coerce(column, raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const s = String(raw);
  if (s === '') {
    // 非文本列的空串按 NULL 处理，避免把 '' 写进数值列
    const t = String(column.type || '').toUpperCase();
    return /INT|REAL|NUM|DEC|DOUB|FLOA|BLOB/.test(t) && !/CHAR|CLOB|TEXT/.test(t) ? null : '';
  }
  return s;
}

module.exports = function registerDbAdmin(app, ctx) {
  const db = () => ctx.getDb();
  const json = (res, data, code = 200) =>
    res.status(code).type('application/json; charset=utf-8').send(JSON.stringify(data));
  const fail = (res, msg, code = 400) => json(res, { ok: false, msg: String(msg) }, code);

  /* ---------------- 页面 ---------------- */
  const pageFile = () => path.join(ctx.rootDir, 'dbadmin', 'index.html');

  const servePage = (req, res) => {
    fs.readFile(pageFile(), (err, buf) => {
      if (err) return res.status(500).type('text/plain; charset=utf-8').send(T('数据库管理页面缺失'));
      res.setHeader('Cache-Control', 'no-cache');
      res.type('text/html; charset=utf-8').send(buf.toString('utf8'));
    });
  };
  app.get('/dbadmin', servePage);
  app.get('/dbadmin/', servePage);
  app.get('/dbadmin/index.html', servePage);

  /* ---------------- 会话（不需鉴权） ---------------- */
  app.get('/dbadmin/api/status', (req, res) => {
    const loopback = isLoopback(req);
    const authed = isAuthed(req);
    const info = {
      ok: true,
      authorized: authed,
      loopback,
      remotePasswordSet: !!REMOTE_PASSWORD,
      needPassword: !authed && !loopback,
      passwordWrong: !!(req.session && req.session.dbadminFailed),
      serverTime: now(),
    };
    if (authed) {
      const state = dbm.getState();
      const tables = dbm.listTables();
      info.db = {
        path: state.dbFile,
        fileName: path.basename(state.dbFile || ''),
        size: dbm.getDbSize(),
        tableCount: tables.length,
        rowCount: tables.reduce((a, t) => a + t.rows, 0),
      };
    }
    json(res, info);
  });

  app.post('/dbadmin/api/login', (req, res) => {
    const pwd = String((req.body && req.body.password) || '');
    if (!REMOTE_PASSWORD) {
      return fail(res, T('未配置远程密码（环境变量 TE_DB_PASSWORD），局域网不允许访问数据库管理页'), 403);
    }
    if (pwd !== REMOTE_PASSWORD) {
      req.session.dbadminFailed = true;
      return fail(res, T('密码错误'), 401);
    }
    req.session.dbadmin = true;
    delete req.session.dbadminFailed;
    json(res, { ok: true });
  });

  app.post('/dbadmin/api/logout', (req, res) => {
    if (req.session) {
      delete req.session.dbadmin;
      delete req.session.dbadminFailed;
    }
    json(res, { ok: true });
  });

  /* ---------------- 以下接口一律要求已授权 ---------------- */
  app.use('/dbadmin/api', (req, res, next) => {
    if (isAuthed(req)) return next();
    return json(
      res,
      {
        ok: false,
        needPassword: true,
        msg: REMOTE_PASSWORD ? T('请先输入管理密码') : T('数据库管理页仅允许本机访问'),
      },
      401
    );
  });

  /* ---------------- 表结构 / 数据 ---------------- */
  app.get('/dbadmin/api/tables', (req, res) => {
    try {
      json(res, { ok: true, tables: dbm.listTables() });
    } catch (e) { fail(res, e.message, 500); }
  });

  app.get('/dbadmin/api/schema', (req, res) => {
    try {
      const name = dbm.assertTable(String(req.query.name || ''));
      json(res, {
        ok: true,
        table: name,
        columns: dbm.tableColumns(name),
        rowid: true,
      });
    } catch (e) { fail(res, e.message, 400); }
  });

  // layui table 数据接口：{code, msg, count, data}
  app.get('/dbadmin/api/table', (req, res) => {
    try {
      const name = dbm.assertTable(String(req.query.name || ''));
      const columns = dbm.tableColumns(name);
      const colNames = columns.map((c) => c.name);

      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 500);
      const page = Math.max(Number(req.query.page) || 1, 1);
      const offset = (page - 1) * limit;

      // 排序字段必须是真实存在的列，避免注入
      let orderBy = 'rowid';
      const field = String(req.query.field || '');
      if (field && (colNames.includes(field) || field === '_rowid')) {
        const dir = String(req.query.order || '').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
        orderBy = `"${field === '_rowid' ? 'rowid' : field}" ${dir}`;
      }

      // 关键字过滤：对所有文本列做 LIKE
      const keyword = String(req.query.keyword || '').trim();
      let where = '';
      const params = [];
      if (keyword) {
        const likes = colNames.map((c) => `CAST("${c}" AS TEXT) LIKE ?`).join(' OR ');
        where = ` WHERE (${likes})`;
        colNames.forEach(() => params.push('%' + keyword + '%'));
      }

      const total = db().prepare(`SELECT COUNT(*) AS c FROM "${name}"${where}`).get(...params).c;
      const rows = db()
        .prepare(`SELECT rowid AS _rowid, * FROM "${name}"${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
        .all(...params, limit, offset);

      json(res, { code: 0, msg: '', count: total, data: rows, columns });
    } catch (e) { fail(res, e.message, 400); }
  });

  /* ---------------- 行编辑 ---------------- */
  app.post('/dbadmin/api/row', (req, res) => {
    try {
      const body = req.body || {};
      const name = dbm.assertTable(String(body.table || ''));
      const action = String(body.action || '');
      const columns = dbm.tableColumns(name);
      const colMap = new Map(columns.map((c) => [c.name, c]));

      if (action === 'delete') {
        const rowid = body.rowid;
        if (rowid === undefined || rowid === null || rowid === '') throw new Error(T('缺少 rowid'));
        const info = db().prepare(`DELETE FROM "${name}" WHERE rowid = ?`).run(rowid);
        return json(res, { ok: true, changes: info.changes });
      }

      const values = body.values && typeof body.values === 'object' ? body.values : {};
      const badCol = Object.keys(values).find((k) => !colMap.has(k));
      if (badCol) throw new Error(T('列不存在：') + badCol);

      if (action === 'insert') {
        const cols = Object.keys(values).filter((k) => values[k] !== undefined);
        if (!cols.length) throw new Error(T('没有可写入的字段'));
        const colList = cols.map((c) => `"${c}"`).join(',');
        const holders = cols.map(() => '?').join(',');
        const args = cols.map((c) => coerce(colMap.get(c), values[c]));
        const info = db()
          .prepare(`INSERT INTO "${name}" (${colList}) VALUES (${holders})`)
          .run(...args);
        return json(res, { ok: true, rowid: Number(info.lastInsertRowid), changes: info.changes });
      }

      if (action === 'update') {
        const rowid = body.rowid;
        if (rowid === undefined || rowid === null || rowid === '') throw new Error(T('缺少 rowid'));
        const cols = Object.keys(values).filter((k) => values[k] !== undefined);
        if (!cols.length) throw new Error(T('没有需要更新的字段'));
        const setList = cols.map((c) => `"${c}" = ?`).join(',');
        const args = cols.map((c) => coerce(colMap.get(c), values[c]));
        const info = db()
          .prepare(`UPDATE "${name}" SET ${setList} WHERE rowid = ?`)
          .run(...args, rowid);
        return json(res, { ok: true, changes: info.changes });
      }

      fail(res, T('未知操作：') + action);
    } catch (e) { fail(res, e.message, 400); }
  });

  /* ---------------- 清空 ---------------- */
  app.post('/dbadmin/api/clear', (req, res) => {
    try {
      const body = req.body || {};
      if (String(body.confirm || '').toUpperCase() !== CONFIRM_WORD) {
        return fail(res, L`请输入 ${CONFIRM_WORD} 以确认清空操作`);
      }
      const list = Array.isArray(body.tables) ? body.tables.map(String) : null;
      const cleared = dbm.clearTables(list);
      json(res, { ok: true, cleared, tables: dbm.listTables() });
    } catch (e) { fail(res, e.message, 500); }
  });

  /* ---------------- 导出 ---------------- */
  app.get('/dbadmin/api/export', (req, res) => {
    try {
      const format = String(req.query.format || 'db').toLowerCase();
      const stamp = now().replace(/[-: ]/g, '').slice(0, 14);

      if (format === 'db') {
        // 先把 WAL 内容并回主文件，保证导出的是完整一致的库
        try { db().pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { /* ignore */ }
        const src = dbm.getDbPath();
        const tmp = path.join(os.tmpdir(), `te-export-${Date.now()}.db`);
        fs.copyFileSync(src, tmp);
        return res.download(tmp, `ate-${stamp}.db`, () => {
          fs.unlink(tmp, () => { /* ignore */ });
        });
      }

      if (format === 'sql') {
        const { sql } = dbm.dumpSql();
        res.setHeader('Content-Type', 'application/sql; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="ate-${stamp}.sql"`);
        return res.send(sql);
      }

      if (format === 'csv') {
        const name = dbm.assertTable(String(req.query.name || ''));
        const csv = dbm.dumpCsv(name);
        // 加 BOM，Excel 打开中文不乱码
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${name}-${stamp}.csv"`);
        return res.send('\ufeff' + csv);
      }

      fail(res, T('不支持的导出格式：') + format);
    } catch (e) { fail(res, e.message, 500); }
  });

  /* ---------------- 导入 ---------------- */
  app.post(
    '/dbadmin/api/import',
    express.raw({ type: () => true, limit: MAX_UPLOAD }),
    (req, res) => {
      const tmpFiles = [];
      try {
        const body = req.body;
        if (!Buffer.isBuffer(body) || body.length === 0) {
          return fail(res, T('没有收到文件内容'));
        }
        if (String(req.query.confirm || '').toUpperCase() !== CONFIRM_WORD) {
          return fail(res, L`请输入 ${CONFIRM_WORD} 以确认导入操作`);
        }

        const fileName = path.basename(String(req.query.filename || 'upload'));
        const tmp = path.join(os.tmpdir(), `te-import-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(fileName) || '.tmp'}`);
        fs.writeFileSync(tmp, body);
        tmpFiles.push(tmp);

        if (SQLITE_EXT.test(fileName)) {
          const r = dbm.replaceDatabase(tmp);
          const total = r.tables.reduce((a, t) => a + t.rows, 0);
          return json(res, {
            ok: true,
            mode: 'replace',
            msg: L`已用 ${fileName} 替换整个数据库：${r.tables.length} 张表、${total} 行`,
            tables: r.tables,
          });
        }

        // 其余按 SQL 文本处理
        const text = body.toString('utf8');
        const r = dbm.importSqlText(text);
        // 被跳过的行必须显示出来，否则「看起来成功、其实丢数据」
        const skipped = r.failed
          ? L`，跳过 ${r.failed} 行（${(r.errors && r.errors[0]) || '数据不符合约束'}）`
          : '';
        json(res, {
          ok: true,
          mode: r.mode,
          msg: L`已导入 ${fileName}：${r.tables.length} 张表、${r.rows} 行` + skipped,
          tables: r.tables,
          rows: r.rows,
          failed: r.failed || 0,
          errors: r.errors || [],
        });
      } catch (e) {
        fail(res, e.message, 400);
      } finally {
        for (const f of tmpFiles) fs.unlink(f, () => { /* ignore */ });
      }
    }
  );

  /* ---------------- SQL 执行器 ---------------- */
  app.post('/dbadmin/api/sql', (req, res) => {
    try {
      const sql = String((req.body && req.body.sql) || '').trim();
      if (!sql) return fail(res, T('请输入 SQL'));
      if (String(req.body.confirm || '').toUpperCase() !== CONFIRM_WORD) {
        return fail(res, L`请输入 ${CONFIRM_WORD} 以确认执行`);
      }

      const first = sql.replace(/^\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*/g, '').slice(0, 12).toUpperCase();
      if (/^(SELECT|PRAGMA|EXPLAIN|WITH)/.test(first)) {
        const rows = db().prepare(sql).all();
        return json(res, { ok: true, kind: 'query', count: rows.length, rows: rows.slice(0, 500) });
      }

      db().exec(sql);
      const tables = dbm.listTables();
      json(res, { ok: true, kind: 'exec', msg: T('执行完成'), tables });
    } catch (e) { fail(res, e.message, 400); }
  });
};
