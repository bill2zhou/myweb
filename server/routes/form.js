'use strict';
const { T, L } = require('../lang');
const { h, dayEarly, parseNameField } = require('../util');

const NO_DATA = "<div class='layui-text' style='padding:15px;color:#999'>No Data</div>";
const TABLE_OPEN = "<table id='tb-order' class='layui-table' lay-even>";

module.exports = function registerForm(app, ctx) {
  const db = () => ctx.getDb();
  const text = (res, s) => res.type('text/html; charset=utf-8').send(s);
  const ok = (res) => text(res, 'Sucess');
  const err = (res, e) => text(res, 'Error: ' + e);

  // ---------- teprogram（測試程式修改記錄） ----------
  function programRows(q) {
    const varArr = String(q || '').split('_');
    const start = varArr[0], shift = varArr[1], end = varArr[2];
    if (!start) return { err: T('...请选择日期...') };
    if (start > end) return { err: T('...时间区间选择错误...') };

    let prefix = '';
    if (start !== end) prefix = `  ${start}----${end}`;

    const sameDay = start === end;
    let rows;
    if (shift) {
      prefix += L` 班別:${shift}`;
      rows = sameDay
        ? db().prepare('SELECT * FROM teprogram WHERE date = ? AND shift = ?').all(start, shift)
        : db().prepare('SELECT * FROM teprogram WHERE date >= ? AND date <= ? AND shift = ? ORDER BY `date` DESC').all(start, end, shift);
    } else {
      rows = sameDay
        ? db().prepare('SELECT * FROM teprogram WHERE date = ?').all(start)
        : db().prepare('SELECT * FROM teprogram WHERE date >= ? AND date <= ? ORDER BY `date` DESC').all(start, end);
    }
    return { prefix, rows };
  }

  function renderProgram(rows, mode) {
    if (!rows.length) return NO_DATA;
    let out = TABLE_OPEN + '<tr>';
    out += T("<th style='width:10%'>日期</th>");
    out += T("<th style='width:5%'>班別</th>");
    out += T("<th style='width:5%'>機種</th>");
    out += T("<th style='width:10%'>原程式名</th>");
    out += T("<th style='width:10%'>新程式名</th>");
    out += T("<th style='width:25%'>修改原因</th>");
    out += T("<th style='width:25%'>修改内容</th>");
    out += T("<th style='width:5%'>修改者</th>");
    out += T("<th style='width:5%'>確認者</th>");
    if (mode === 'delete') out += T("<th style='width:5%'>刪除</th>");
    if (mode === 'change') out += T("<th style='width:5%'>修改</th>");
    out += '</tr>';

    for (const r of rows) {
      const id = Number(r.Id);
      out += '<tr>';
      out += `<td style='width:10%'>${h(r.date)}</td>`;
      out += `<td style='width:5%'>${h(r.shift)}</td>`;
      out += `<td style='width:5%'><pre>${h(r.model)}</pre></td>`;
      out += `<td style='width:10%'><pre>${h(r.oldname)}</pre></td>`;
      if (mode === 'seach') {
        out += `<th style='width:5%'> <input id='btn-create' class='layui-btn layui-btn-primary'   type='button'  value='${h(r.newname)}' /> </td> `;
      } else {
        out += `<td style='width:10%'><pre>${h(r.newname)}</pre></td>`;
      }
      out += `<td style='width:25%'><pre>${h(r.reason)}</pre></td>`;
      out += `<td style='width:25%'><pre>${h(r.summary)}</pre></td>`;
      out += `<td style='width:5%'><pre>${h(r.owner)}</pre></td>`;
      out += `<td style='width:5%'><pre>${h(r.verify)}</pre></td>`;
      if (mode === 'delete') {
        out += L`<th style='width:5%'> <input id='btn-create' style='color:red'  type='button'  value='刪除' onclick=delet(${id}) /> </td> `;
      }
      if (mode === 'change') {
        out += L`<th style='width:5%'> <input id='btn-create' style='color:blue'  type='button'  value='修改' onclick=change(${id}) /> </td> `;
      }
      out += '</tr>';
    }
    return out + '</table>';
  }

  app.all('/form/seach.php', (req, res) => {
    const q = req.query.q || '';
    req.session.q = q;
    const r = programRows(q);
    if (r.err) return text(res, r.err);
    text(res, r.prefix + renderProgram(r.rows, 'seach'));
  });

  app.all('/form/read_del.php', (req, res) => {
    const q = req.query.q || '';
    req.session.q = q;
    const r = programRows(q);
    if (r.err) return text(res, r.err);
    text(res, r.prefix + renderProgram(r.rows, 'delete'));
  });

  app.all('/form/read_up.php', (req, res) => {
    const q = req.query.q || '';
    req.session.q = q;
    const r = programRows(q);
    if (r.err) return text(res, r.err);
    text(res, r.prefix + renderProgram(r.rows, 'change'));
  });

  // ---------- jig（治具點檢表） ----------
  function jigRows(q, lineColumn) {
    const varArr = String(q || '').split('_');
    const start = varArr[0], arg = varArr[1], end = varArr[2];
    if (!start) return { err: T('...请选择日期...') };
    if (start > end) return { err: T('...时间区间选择错误...') };

    let prefix = '';
    if (start !== end) prefix = `  ${start}----${end}`;

    const sameDay = start === end;
    const col = lineColumn;
    let rows;
    if (arg) {
      prefix += L` 班別:${arg}`;
      rows = sameDay
        ? db().prepare(`SELECT * FROM jig WHERE time = ? AND ${col} = ?`).all(start, arg)
        : db().prepare(`SELECT * FROM jig WHERE time >= ? AND time <= ? AND ${col} = ? ORDER BY \`time\` DESC`).all(start, end, arg);
    } else {
      rows = sameDay
        ? db().prepare('SELECT * FROM jig WHERE time = ?').all(start)
        : db().prepare('SELECT * FROM jig WHERE time >= ? AND time <= ? ORDER BY `time` DESC').all(start, end);
    }
    return { prefix, rows };
  }

  function renderJig(rows, mode) {
    if (!rows.length) return NO_DATA;
    let out = TABLE_OPEN + '<tr>';
    out += T("<th style='width:10%'>日期</th>");
    out += T("<th style='width:5%'>幾臺</th>");
    out += T("<th style='width:5%'>探針使用次數</th>");
    out += T("<th style='width:5%'>治具結構</th>");
    out += T("<th style='width:5%'>治具載板清潔</th>");
    out += T("<th style='width:5%'>有板sensor</th>");
    out += T("<th style='width:5%'>檢查者</th>");
    out += T("<th style='width:5%'>確認者</th>");
    if (mode !== 'seach') out += T("<th style='width:5%'>確認</th>");
    out += '</tr>';

    for (const r of rows) {
      const id = Number(r.Id);
      out += '<tr>';
      out += `<td style='width:10%'>${h(r.time)}</td>`;
      out += `<td style='width:5%'>${h(r.device)}</td>`;
      out += `<td style='width:5%'>${h(r.probe)}</td>`;
      out += `<td style='width:5%'>${h(r.structure)}</td>`;
      out += `<td style='width:5%'>${h(r.clear)}</td>`;
      out += `<td style='width:5%'>${h(r.sensor)}</td>`;
      out += `<td style='width:5%'>${h(r.owner)}</td>`;
      out += `<td style='width:5%'>${h(r.checker)}</td>`;
      if (mode === 'delete') {
        out += L`<th style='width:5%'> <input id='btn-create' style='color:red'  type='button'  value='删除' onclick=delet(${id}) /> </td> `;
      }
      if (mode === 'change') {
        out += L`<th style='width:5%'> <input id='btn-create' style='color:blue'  type='button'  value='確認' onclick=change(${id}) /> </td> `;
      }
      out += '</tr>';
    }
    return out + '</table>';
  }

  app.all('/form/seach_jig.php', (req, res) => {
    const q = req.query.q || '';
    req.session.q = q;
    const r = jigRows(q, 'device');
    if (r.err) return text(res, r.err);
    text(res, r.prefix + renderJig(r.rows, 'seach'));
  });

  app.all('/form/read_del_jig.php', (req, res) => {
    const q = req.query.q || '';
    req.session.q = q;
    const r = jigRows(q, 'line');
    if (r.err) return text(res, r.err);
    text(res, r.prefix + renderJig(r.rows, 'delete'));
  });

  app.all('/form/read_up_jig.php', (req, res) => {
    const q = req.query.q || '';
    req.session.q = q;
    const r = jigRows(q, 'line');
    if (r.err) return text(res, r.err);
    text(res, r.prefix + renderJig(r.rows, 'change'));
  });

  // ---------- thing.php / thing_jig.php（编辑回填 JSON） ----------
  app.all('/form/thing.php', (req, res) => {
    const row = db().prepare('SELECT * FROM teprogram WHERE Id = ?').get(req.query.q);
    const out = { model: [], oldname: [], newname: [], reason: [], summary: [] };
    if (row) {
      out.model.push(row.model); out.oldname.push(row.oldname); out.newname.push(row.newname);
      out.reason.push(row.reason); out.summary.push(row.summary);
    }
    res.type('application/json; charset=utf-8').send(JSON.stringify(out));
  });

  app.all('/form/thing_jig.php', (req, res) => {
    const row = db().prepare('SELECT * FROM jig WHERE Id = ?').get(req.query.q);
    const out = { probe: [], device: [], time: [], owner: [] };
    if (row) {
      out.probe.push(row.probe); out.device.push(row.device); out.time.push(row.time); out.owner.push(row.owner);
    }
    res.type('application/json; charset=utf-8').send(JSON.stringify(out));
  });

  // ---------- updata.php / updata_jig.php ----------
  app.all('/form/updata.php', (req, res) => {
    const d = parseNameField(req.body);
    try {
      db().prepare('UPDATE teprogram SET model=?,oldname=?,newname=?,reason=?,summary=? WHERE Id=?')
        .run(d.model, d.oldname, d.newname, d.reason, d.summary, req.query.q);
      ok(res);
    } catch (e) { err(res, e.message); }
  });

  app.all('/form/updata_jig.php', (req, res) => {
    const d = parseNameField(req.body);
    try {
      db().prepare('UPDATE jig SET checker=? WHERE Id=?').run(d.check, req.query.q);
      ok(res);
    } catch (e) { err(res, e.message); }
  });

  // ---------- from.php（新增程式修改记录） ----------
  app.all('/form/from.php', (req, res) => {
    const d = parseNameField(req.body);
    try {
      db().prepare(
        `INSERT INTO teprogram (date, shift, model, oldname, newname, reason, summary, owner, verify)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(d.date, d.shift, d.model, d.oldname, d.newname, d.reason, d.summary, d.owner, d.verify);
      ok(res);
    } catch (e) { err(res, e.message); }
  });

  // ---------- delet.php / delet_jig.php ----------
  app.all('/form/delet.php', (req, res) => {
    try {
      db().prepare('DELETE FROM teprogram WHERE Id = ?').run(req.query.q);
      ok(res);
    } catch (e) { err(res, e.message); }
  });

  app.all('/form/delet_jig.php', (req, res) => {
    try {
      db().prepare('DELETE FROM jig WHERE Id = ?').run(req.query.q);
      ok(res);
    } catch (e) { err(res, e.message); }
  });

  // ---------- export.php（原文件输出为纯文本，此处保持一致） ----------
  app.all('/form/export.php', (req, res) => {
    let out = '';
    for (let i = 0; i < 7; i++) {
      const start = dayEarly(i + 1);
      const end = dayEarly(i);
      const sql = `SELECT * FROM jig WHERE  time >= '${start}'AND time <= '${end}' `;
      out += sql;
      const rows = db().prepare('SELECT * FROM jig WHERE time >= ? AND time <= ?').all(start, end);
      for (const r of rows) {
        // 与 PHP 的 date('Y-m-d', strtotime($row["time"])) / date('H', ...) 一致
        const t = String(r.time ?? '');
        const d = new Date(t.replace(' ', 'T'));
        const valid = !Number.isNaN(d.getTime());
        const dateStr = valid
          ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          : t.slice(0, 10);
        const hour = valid ? String(d.getHours()).padStart(2, '0') : t.slice(11, 13);
        out += dateStr;
        out += '<br>';
        out += hour;
        out += '<br>';
        out += r.time ?? '';
        out += r.device ?? '';
        out += r.probe ?? '';
        out += r.structure ?? '';
        out += r.clear ?? '';
        out += r.sensor ?? '';
        out += r.owner ?? '';
        out += r.checker ?? '';
        out += '<br>';
      }
    }
    text(res, out);
  });
};
