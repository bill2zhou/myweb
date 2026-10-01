'use strict';
const { T, L } = require('../lang');
const { h, today, dayEarly, parseNameField } = require('../util');

const NO_DATA = "<div class='layui-text' style='padding:15px;color:#999'>No Data</div>";
const TABLE_OPEN = "<table id='tb-order' class='layui-table' lay-even>";

module.exports = function registerHandover(app, ctx) {
  const db = () => ctx.getDb();
  const text = (res, s) => res.type('text/html; charset=utf-8').send(s);
  const ok = (res) => text(res, 'Sucess');
  const err = (res, e) => text(res, 'Error: ' + e);

  /** 按日期区间 / 班別查询交接班记录 */
  function queryRows(start, shift, end) {
    const sameDay = start === end;
    if (shift) {
      return sameDay
        ? db().prepare('SELECT * FROM handover WHERE date = ? AND shift = ?').all(start, shift)
        : db().prepare('SELECT * FROM handover WHERE date >= ? AND date <= ? AND shift = ? ORDER BY `date` DESC').all(start, end, shift);
    }
    return sameDay
      ? db().prepare('SELECT * FROM handover WHERE date = ?').all(start)
      : db().prepare('SELECT * FROM handover WHERE date >= ? AND date <= ? ORDER BY `date` DESC').all(start, end);
  }

  function renderList(rows, mode) {
    if (!rows.length) return NO_DATA;
    let out = TABLE_OPEN + '<tr>';
    out += T("<th style='width:10%'>日期</th>");
    out += T("<th style='width:5%'>班別</th>");
    out += T("<th style='width:35%'>良率產出</th>");
    out += T("<th style='width:45%'>其它事項</th>");
    if (mode !== 'seach') out += T("<th style='width:5%'>刪除</th>");
    out += '</tr>';

    for (const r of rows) {
      const id = Number(r.Id);
      out += '<tr>';
      out += `<td style='width:10%'>${h(r.date)}</td>`;
      out += `<td style='width:5%'>${h(r.shift)}</td>`;
      out += `<td style='width:35%'><pre>${h(r.kpi)}</pre></td>`;
      out += `<td style='width:45%'><pre>${h(r.other)}</pre></td>`;
      if (mode === 'delete') {
        out += L`<th style='width:5%'> <input id='btn-create' style='color:red'  type='button'  value='刪除' onclick=delet(${id}) /> </td> `;
      }
      if (mode === 'change') {
        out += L`<th style='width:5%'> <input id='btn-create' style='color:red'  type='button'  value='修改' onclick=change(${id}) /> </td> `;
      }
      out += '</tr>';
    }
    return out + '</table>';
  }

  // ---------- seach.php（按查询条件） ----------
  app.all('/handover/seach.php', (req, res) => {
    const q = req.query.q || '';
    req.session.q = q;
    const varArr = String(q).split('_');
    const start = varArr[0], shift = varArr[1], end = varArr[2];

    if (!start) return text(res, T('...请选择日期...'));
    if (start > end) return text(res, T('...日期選擇錯誤...'));

    let prefix = '';
    if (start !== end) prefix = `  ${start}----${end}`;
    if (shift) prefix += L` 班別:${shift}`;

    text(res, prefix + renderList(queryRows(start, shift, end), 'seach'));
  });

  // ---------- seach1.php（固定查询近两天） ----------
  app.all('/handover/seach1.php', (req, res) => {
    const start = dayEarly(2);
    const end = dayEarly(0);
    text(res, renderList(queryRows(start, '', end), 'seach'));
  });

  // ---------- read_del.php / read_up.php ----------
  function readHandler(mode) {
    return (req, res) => {
      const q = req.query.q || '';
      req.session.q = q;
      const varArr = String(q).split('_');
      const start = varArr[0], shift = varArr[1], end = varArr[2];

      if (!start) return text(res, T('...请选择日期...'));
      if (start > end) return text(res, T('...日期選擇錯誤...'));

      let prefix = '';
      if (start !== end) prefix = `  ${start}----${end}`;
      if (shift) prefix += L` 班別:${shift}`;

      text(res, prefix + renderList(queryRows(start, shift, end), mode));
    };
  }

  app.all('/handover/read_del.php', readHandler('delete'));
  app.all('/handover/read_up.php', readHandler('change'));

  // ---------- thing.php（编辑回填 JSON） ----------
  app.all('/handover/thing.php', (req, res) => {
    const row = db().prepare('SELECT * FROM handover WHERE Id = ?').get(req.query.q);
    const out = { shift: [], date: [], kpi: [], other: [] };
    if (row) {
      out.shift.push(row.shift); out.date.push(row.date);
      out.kpi.push(row.kpi); out.other.push(row.other);
    }
    res.type('application/json; charset=utf-8').send(JSON.stringify(out));
  });

  // ---------- updata.php / from.php / delet.php ----------
  app.all('/handover/updata.php', (req, res) => {
    const d = parseNameField(req.body);
    try {
      db().prepare("UPDATE handover SET date=?,shift=?,kpi=?,other=? WHERE Id=?")
        .run(d.date, d.shift, d.kpi, d.other, req.query.q);
      ok(res);
    } catch (e) { err(res, e.message); }
  });

  app.all('/handover/from.php', (req, res) => {
    const d = parseNameField(req.body);
    try {
      db().prepare('INSERT INTO handover (date,shift,kpi,other) VALUES (?,?,?,?)')
        .run(d.date, d.shift, d.kpi, d.other);
      ok(res);
    } catch (e) { err(res, e.message); }
  });

  app.all('/handover/delet.php', (req, res) => {
    try {
      db().prepare('DELETE FROM handover WHERE Id = ?').run(req.query.q);
      ok(res);
    } catch (e) { err(res, e.message); }
  });
};
