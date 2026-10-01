'use strict';
const { T, L } = require('../lang');
const { h, today, parseNameField } = require('../util');

const NO_DATA = "<div class='layui-text' style='padding:15px;color:#999'>No Data</div>";
const TABLE_OPEN = "<table id='tb-order' class='layui-table' lay-even>";

/** 库存单元格（按库存与安全库存关系着色，与原 PHP 一致） */
function stockCell(stock, safe, width = '5%') {
  const s = Number(stock) || 0;
  const sf = Number(safe) || 0;
  let color = '#00ff33';
  if (s < sf) color = '#cc0000';
  else if (s === sf) color = '#FFFF05';
  return `<td style='width:${width}; background-color:${color}'>${h(stock)}</td>`;
}

module.exports = function registerManage(app, ctx) {
  const db = () => ctx.getDb();
  const ok = (res) => res.type('text/html; charset=utf-8').send('Sucess');
  const err = (res, e) => res.type('text/html; charset=utf-8').send('Error: ' + e);
  const text = (res, s) => res.type('text/html; charset=utf-8').send(s);

  // ---------- 列表渲染（read / read_del / read_verify 共用） ----------
  function renderList(rows, mode) {
    if (!rows.length) return NO_DATA;
    const withDeleteCol = mode === 'delete' || mode === 'verify';
    let out = TABLE_OPEN + '<tr>';
    out += T("<th style='width:10%'>日期</th>");
    out += T("<th style='width:5%'>物品</th>");
    out += T("<th style='width:5%'>编号</th>");
    out += T("<th style='width:5%'>型號</th>");
    out += T("<th style='width:5%'>庫存</th>");
    out += T("<th style='width:5%'>安全庫存</th>");
    out += T("<th style='width:5%'>入庫</th>");
    out += T("<th style='width:5%'>出庫</th>");
    out += T("<th style='width:60%'>記錄</th>");
    if (withDeleteCol) out += T("<th style='width:5%'>刪除</th>");
    out += '</tr>';

    for (const r of rows) {
      const id = Number(r.Id);
      out += '<tr>';
      out += `<td style='width:10%'>${h(r.date)}</td>`;
      out += `<td style='width:5%'>${h(r.thing)}</td>`;
      out += `<td style='width:5%'>${h(r.barcode)}</td>`;
      out += `<td style='width:5%'>${h(r.model)}</td>`;
      out += stockCell(r.stock, r.safestock);

      if (mode === 'read') {
        // 点击才弹出说明（原先是 onmouseenter，鼠标一扫过整排就乱弹）
        out += `<td style='width:5% '>  <button class='layui-btn layui-btn-primary' onclick='tip(${id})' title='${T('点击查看说明')}' >${h(r.safestock)}</button> </td>`;
        out += L`<th style='width:5%'> <input id='btn-create' class='layui-btn'  type='button'  value='入庫'  onclick=add(${id}) /> </td> `;
        out += L`<th style='width:5%'> <input id='btn-create' class='layui-btn layui-btn-danger'   type='button'  value='出庫'  onclick=minus(${id}) /> </td> `;
        const parts = String(r.remark ?? '').split(';');
        const remark = parts.length > 3 ? parts.slice(0, 3).join(';') : (r.remark ?? '');
        out += `<td style='width:5%'>${h(remark)}</td>`;
      } else {
        out += `<td style='width:5%'>${h(r.safestock)}</td>`;
        out += L`<th style='width:5%'> <input id='btn-create' style='color:blue'  type='button'  value='入庫' onclick=add(${id}) /> </td> `;
        out += L`<th style='width:5%'> <input id='btn-create' style='color:red'  type='button'  value='出庫' onclick=minus(${id}) /> </td> `;
        out += `<td style='width:5%'>${h(r.remark)}</td>`;
        if (mode === 'delete') {
          out += L`<th style='width:5%'> <input id='btn-create' style='color:red'  type='button'  value='刪除' onclick=delet(${id}) /> </td> `;
        } else {
          out += L`<th style='width:5%'> <input id='btn-create' style='color:green'  type='button'  value='修改' onclick=modify(${id}) /> </td> `;
        }
      }
      out += "<td style='width:10%'></td>";
      out += '</tr>';
    }
    return out + '</table>';
  }

  function queryRows(q) {
    const varArr = String(q || '').split('_');
    const team = varArr[0], cate = varArr[1];
    if (!team) return { err: T('...请选择部门...') };
    if (!cate) return { err: T('...请选择类别...') };
    const rows = cate === 'ALL'
      ? db().prepare('SELECT * FROM manage WHERE team = ?').all(team)
      : db().prepare('SELECT * FROM manage WHERE team = ? AND cate = ?').all(team, cate);
    return { team, cate, rows };
  }

  for (const [file, mode] of [['read.php', 'read'], ['read_del.php', 'delete'], ['read_verify.php', 'verify']]) {
    app.all('/manage/' + file, (req, res) => {
      const q = req.query.q || '';
      req.session.q = q;
      const r = queryRows(q);
      if (r.err) return text(res, r.err);
      text(res, `Team:${r.team} Type:${r.cate}` + renderList(r.rows, mode));
    });
  }

  // ---------- readsn.php（按 mark 查询） ----------
  app.all('/manage/readsn.php', (req, res) => {
    const q = req.query.q || '';
    if (!q) return text(res, T('请输入SN:'));
    const rows = db().prepare('SELECT * FROM manage WHERE mark = ?').all(q);

    const headers = [
      { label: 'ID', width: '5%' }, { label: T('部门'), width: '5%' }, { label: T('种类'), width: '5%' },
      { label: T('编号'), width: '10%' }, { label: T('厂商'), width: '5%' }, { label: T('型号'), width: '10%' },
      { label: T('数量'), width: '5%' }, { label: T('机种'), width: '10%' }, { label: T('状态'), width: '5%' },
      { label: T('时间'), width: '10%' },
    ];
    let out = TABLE_OPEN + '<tr>';
    for (const hd of headers) out += `<th style='width:${hd.width}'>${hd.label}</th>`;
    out += '</tr>';
    for (const r of rows) {
      out += '<tr>';
      out += `<td style='width:5%'>${h(r.Id)}</td>`;
      out += `<td style='width:5%'>${h(r.team)}</td>`;
      out += `<td style='width:5%'>${h(r.type)}</td>`;
      out += `<td style='width:10%'>${h(r.mark)}</td>`;
      out += `<td style='width:5%'>${h(r.changs)}</td>`;
      out += `<td style='width:10%'>${h(r.xinhao)}</td>`;
      out += `<td style='width:5%'>${h(r.num)}</td>`;
      out += `<td style='width:10%'>${h(r.beizhu)}</td>`;
      out += `<td style='width:5%'>${h(r.zhuangt)}</td>`;
      out += `<td style='width:10%'></td>`;
      out += '</tr>';
    }
    out += '</table>';
    text(res, rows.length ? out : NO_DATA);
  });

  // ---------- thing.php / veiw.php / verify.php（编辑回填 JSON） ----------
  app.all('/manage/thing.php', (req, res) => {
    const row = db().prepare('SELECT * FROM manage WHERE Id = ?').get(req.query.q);
    const out = { team: [], thing: [], type: [], cate: [] };
    if (row) { out.team.push(row.team); out.thing.push(row.thing); out.type.push(row.model); out.cate.push(row.cate); }
    res.type('application/json; charset=utf-8').send(JSON.stringify(out));
  });

  app.all('/manage/veiw.php', (req, res) => {
    const row = db().prepare('SELECT * FROM manage WHERE Id = ?').get(req.query.q);
    const out = { tip: [] };
    if (row) out.tip.push(row.tip);
    res.type('application/json; charset=utf-8').send(JSON.stringify(out));
  });

  app.all('/manage/verify.php', (req, res) => {
    const row = db().prepare('SELECT * FROM manage WHERE Id = ?').get(req.query.q);
    const out = { team: [], thing: [], type: [], cate: [], bar: [], stock: [], sstock: [], remark: [], tip: [] };
    if (row) {
      out.team.push(row.team); out.thing.push(row.thing); out.type.push(row.model); out.cate.push(row.cate);
      out.bar.push(row.barcode); out.stock.push(row.stock); out.sstock.push(row.safestock);
      out.remark.push(row.remark); out.tip.push(row.tip);
    }
    res.type('application/json; charset=utf-8').send(JSON.stringify(out));
  });

  // ---------- option.php（按部门取不重复物品名） ----------
  app.all('/manage/option.php', (req, res) => {
    const rows = db().prepare('SELECT * FROM manage WHERE team = ?').all(req.query.q || '');
    const team = [];
    for (const r of rows) {
      if (team.includes(r.thing)) continue;
      team.push(r.thing);
    }
    res.type('application/json; charset=utf-8').send(JSON.stringify({ team }));
  });

  // ---------- add.php / minus.php / stock.php / update.php / delet.php ----------
  app.all('/manage/add.php', (req, res) => {
    const data = parseNameField(req.body);
    const q = req.query.q;
    try {
      const row = db().prepare('SELECT * FROM manage WHERE Id = ?').get(q);
      const mark = row ? `${today()}-${data.username}-${data.remark};${row.remark ?? ''}` : '';
      db().prepare('UPDATE manage SET date = ?, stock = stock + ?, remark = ? WHERE Id = ?')
        .run(today(), Number(data.stock) || 0, mark, q);
      ok(res);
    } catch (e) { err(res, e.message); }
  });

  app.all('/manage/minus.php', (req, res) => {
    const data = parseNameField(req.body);
    const q = req.query.q;
    try {
      const row = db().prepare('SELECT * FROM manage WHERE Id = ?').get(q);
      const mark = row ? `${today()}-${data.username}-${data.remark};${row.remark ?? ''}` : '';
      db().prepare('UPDATE manage SET date = ?, stock = stock - ?, remark = ? WHERE Id = ?')
        .run(today(), Number(data.quantily) || 0, mark, q);
      ok(res);
    } catch (e) { err(res, e.message); }
  });

  app.all('/manage/stock.php', (req, res) => {
    const data = parseNameField(req.body);
    const date = today();
    try {
      if (!data.barcode) {
        db().prepare(
          'INSERT INTO manage (team,cate,thing,model,date,stock,safestock,tip) VALUES (?,?,?,?,?,?,?,?)'
        ).run(data.team, data.cate, data.thing, data.model, date, data.stock, data.safestock, data.tip);
      } else {
        db().prepare(
          'INSERT INTO manage (team,cate,thing,barcode,model,date,stock,safestock,tip) VALUES (?,?,?,?,?,?,?,?,?)'
        ).run(data.team, data.cate, data.thing, data.barcode, data.model, date, data.stock, data.safestock, data.tip);
      }
      ok(res);
    } catch (e) { err(res, e.message); }
  });

  app.all('/manage/update.php', (req, res) => {
    const data = parseNameField(req.body);
    try {
      db().prepare(
        'UPDATE manage SET team=?,cate=?,thing=?,barcode=?,model=?,stock=?,safestock=?,remark=?,tip=? WHERE Id=?'
      ).run(
        data.team, data.cate, data.thing, data.barcode, data.model,
        data.stock, data.safestock, data.remark, data.tip, req.query.q
      );
      ok(res);
    } catch (e) { err(res, e.message); }
  });

  app.all('/manage/delet.php', (req, res) => {
    try {
      db().prepare('DELETE FROM manage WHERE Id = ?').run(req.query.q);
      ok(res);
    } catch (e) { err(res, e.message); }
  });
};
