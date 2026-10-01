'use strict';
const { T, L } = require('../lang');
const { h, today, dayEarly, numberFormat } = require('../util');

const NO_DATA = "<div class='layui-text' style='padding:15px;color:#999'>No Data</div>";

module.exports = function registerMaintain(app, ctx) {
  const db = () => ctx.getDb();

  /** 列表表格（统一 layui 表格样式） */
  function gridTable(headers, rows) {
    let s = "<table id='tb-order' class='layui-table' lay-even><tbody><tr>";
    for (const hd of headers) {
      const label = typeof hd === 'string' ? hd : hd.label;
      const w = typeof hd === 'string' ? '' : hd.width;
      s += `<th style='width:${w || 'auto'}'>${label}</th>`;
    }
    s += '</tr>';
    for (const row of rows) {
      s += '<tr>';
      for (const c of row) s += `<td>${c}</td>`;
      s += '</tr>';
    }
    s += '</tbody></table>';
    return s;
  }

  /** 提示信息（layui 引用块样式） */
  const tip = (msg, warn) =>
    `<div class="layui-elem-quote layui-text"${warn ? ' style="color:#FF5722"' : ''}>${msg}</div>`;

  const text = (res, s) => res.type('text/html; charset=utf-8').send(s);

  // ---------- read.php（查询结果，新版样式） ----------
  app.all('/maintain/read.php', (req, res) => {
    const q = req.query.q || '';
    req.session.q = q;
    const varArr = String(q).split('_');
    const team = varArr[0], line = varArr[1], start = varArr[2], end = varArr[3];

    if (!team) return text(res, tip(T('⚠️ 请选择部门'), true));
    if (!line) return text(res, tip(T('⚠️ 请选择线别'), true));
    if (start !== undefined && end !== undefined && start > end) {
      return text(res, tip(T('⚠️ 时间区间选择错误'), true));
    }

    let out = '<div class="layui-elem-quote layui-text">';
    out += L`🏢 部门：<strong>${h(team)}</strong>`;
    out += L`　🔧 线别：<strong>${h(line)}</strong>`;
    if (start !== undefined && end !== undefined && start !== end) {
      out += L`　📅 日期：<strong>${h(start)} ~ ${h(end)}</strong>`;
    }
    out += '</div>';

    const sameDay = start === end;
    let sql, params;
    if (sameDay && line === 'ALL') {
      sql = 'SELECT * FROM maintain WHERE team = ? ORDER BY `date` DESC'; params = [team];
    } else if (sameDay) {
      sql = 'SELECT * FROM maintain WHERE team = ? AND line = ? ORDER BY `date` DESC'; params = [team, line];
    } else if (line === 'ALL') {
      sql = 'SELECT * FROM maintain WHERE team = ? AND date >= ? AND date <= ? ORDER BY `date` DESC';
      params = [team, start, end];
    } else {
      sql = 'SELECT * FROM maintain WHERE team = ? AND line = ? AND date >= ? AND date <= ? ORDER BY `date` DESC';
      params = [team, line, start, end];
    }
    const rows = db().prepare(sql).all(...params);

    if (!rows.length) {
      out += T('<div class="layui-text" style="padding:15px;color:#999">📭 暂无数据，请调整查询条件后重试</div>');
      return text(res, out);
    }

    const isAoi = team === 'AOI';
    out += '<table class="layui-table" id="tb-order" lay-even><thead><tr>';
    out += T('<th>线别</th>');
    out += T('<th>站别</th>');
    out += T('<th>机台型号</th>');
    out += T('<th>日期</th>');
    if (isAoi) out += T('<th>故障原因</th>');
    out += T('<th>故障描述</th>');
    out += T('<th>故障处理分析</th>');
    out += T('<th>故障类别</th>');
    out += T('<th>维修时间</th>');
    out += T('<th>维修人员</th>');
    out += '</tr></thead><tbody>';
    for (const r of rows) {
      out += '<tr>';
      out += `<td>${h(r.line)}</td><td>${h(r.station)}</td><td>${h(r.type)}</td><td>${h(r.date)}</td>`;
      if (isAoi) out += `<td>${h(r.reason)}</td>`;
      out += `<td>${h(r.fa)}</td><td>${h(r.ca)}</td><td>${h(r.fault)}</td><td>${h(r.time)}</td><td>${h(r.owner)}</td>`;
      out += '</tr>';
    }
    out += '</tbody></table>';
    out += L`<div class="layui-text" style="padding:8px 5px;color:#666">共 <strong>${rows.length}</strong> 条记录</div>`;
    text(res, out);
  });

  // ---------- read_del.php（带删除按钮，老式表格） ----------
  app.all('/maintain/read_del.php', (req, res) => {
    const q = req.query.q || '';
    req.session.q = q;
    const varArr = String(q).split('_');
    const team = varArr[0], line = varArr[1], start = varArr[2], end = varArr[3];

    if (!team) return text(res, tip(T('⚠️ 请选择部门'), true));
    if (!line) return text(res, tip(T('⚠️ 请选择线别'), true));
    if (start > end) return text(res, tip(T('⚠️ 时间区间选择错误'), true));

    let out = `Team:${team} Line:${line}`;
    if (start !== end) out += `  ${start}----${end}`;

    let sql, params;
    const sameDay = start === end;
    if (sameDay && line === 'ALL') {
      sql = 'SELECT * FROM maintain WHERE team = ? ORDER BY `date` DESC'; params = [team];
    } else if (sameDay) {
      sql = 'SELECT * FROM maintain WHERE team = ? AND line = ? ORDER BY `date` DESC'; params = [team, line];
    } else if (line === 'ALL') {
      sql = 'SELECT * FROM maintain WHERE team = ? AND date >= ? AND date <= ? ORDER BY `date` DESC';
      params = [team, start, end];
    } else {
      sql = 'SELECT * FROM maintain WHERE team = ? AND line = ? AND date >= ? AND date <= ? ORDER BY `date` DESC';
      params = [team, line, start, end];
    }
    const rows = db().prepare(sql).all(...params);

    const headers = [
      { label: T('线别'), width: '5%' }, { label: T('站别'), width: '5%' },
      { label: T('机台型号'), width: '10%' }, { label: T('日期'), width: '10%' },
      { label: T('故障描述'), width: '20%' }, { label: T('故障处理分析'), width: '20%' },
      { label: T('故障类别'), width: '5%' }, { label: T('维修时间'), width: '5%' },
      { label: T('维修人员'), width: '5%' }, { label: T('刪除'), width: '5%' },
    ];
    const body = rows.map((r) => [
      h(r.line), h(r.station), h(r.type), h(r.date),
      h(r.fa), h(r.ca), h(r.fault), h(r.time), h(r.owner),
      L`<input id='btn-create' style='color:red' type='button' value='刪除' onclick=delet(${Number(r.id)}) />`,
    ]);
    text(res, out + (body.length ? gridTable(headers, body) : NO_DATA));
  });

  // ---------- readseach.php（按故障描述模糊查询） ----------
  app.all('/maintain/readseach.php', (req, res) => {
    const q = req.query.q || '';
    if (!q) return text(res, T('请输入內容:'));
    const varArr = String(q).split('_');
    if (!varArr[0]) return text(res, T('...请选择部门...'));
    if (!varArr[1]) return text(res, T('...请輸入查詢內容...'));

    const rows = db()
      .prepare("SELECT * FROM maintain WHERE team = ? AND fa like ? ESCAPE '\\'")
      .all(varArr[0], `%${String(varArr[1]).replace(/[\\%_]/g, (m) => '\\' + m)}%`);

    const headers = [
      { label: T('线别'), width: '5%' }, { label: T('机台型号'), width: '10%' },
      { label: T('日期'), width: '10%' }, { label: T('故障描述'), width: '25%' },
      { label: T('故障处理分析'), width: '25%' }, { label: T('维修人员'), width: '5%' },
    ];
    const body = rows.map((r) => [h(r.line), h(r.type), h(r.date), h(r.fa), h(r.ca), h(r.owner)]);
    text(res, L`查詢內容:${varArr[1]}` + (body.length ? gridTable(headers, body) : NO_DATA));
  });

  // ---------- readsn.php / thing.php（原文件查询的是 manage 表） ----------
  app.all('/maintain/readsn.php', (req, res) => {
    const q = req.query.q || '';
    if (!q) return text(res, T('请输入SN:'));
    let out = L`请输入SN:${q}`;
    const rows = db().prepare('SELECT * FROM manage WHERE sn = ?').all(q);
    const headers = [
      { label: T('编号'), width: '20%' }, { label: T('线别'), width: '5%' },
      { label: T('机台型号'), width: '10%' }, { label: T('日期'), width: '10%' },
      { label: T('故障描述'), width: '25%' }, { label: T('故障处理分析'), width: '25%' },
      { label: T('维修人员'), width: '5%' },
    ];
    const body = rows.map((r) => [r.sn, r.line, r.type, r.date, r.fa, r.ca, r.owner]);
    text(res, out + (body.length ? gridTable(headers, body) : NO_DATA));
  });

  app.all('/maintain/thing.php', (req, res) => {
    const row = db().prepare('SELECT * FROM manage WHERE Id = ?').get(req.query.q);
    const out = { team: [], thing: [], type: [] };
    if (row) { out.team.push(row.team); out.thing.push(row.thing); out.type.push(row.model); }
    res.type('application/json; charset=utf-8').send(JSON.stringify(out));
  });

  // ---------- charttry.php（停机数据图表页） ----------
  function totalTime(name, index, line, start, end) {
    const col = index === 'type' ? 'type' : 'team';
    let sql = `SELECT time, station, type FROM maintain WHERE ${col} = ? AND line = ?`;
    const params = [name, line];
    if (start < end) {
      sql += ' AND date >= ? AND date <= ?';
      params.push(start, end);
    }
    const rows = db().prepare(sql).all(...params);
    let sum = 0, count = 0;
    for (const r of rows) {
      let t = parseInt(String(r.time ?? '').replace(/mins/g, ''), 10) || 0;
      if (/S\d.*/.test(r.station || '')) t = t / 12;
      if (/ROUT.*/.test(r.station || '')) t = t / 2;
      if (/I3070.*/.test(r.type || '')) t = t / 2;
      sum += Math.trunc(t);
      count++;
    }
    return [sum, count];
  }

  app.all('/maintain/charttry.php', (req, res) => {
    const start = (req.body && req.body.startt) || '';
    const end = (req.body && req.body.endt) || '';
    if (start > end) return text(res, T('...日期输入不正确...'));

    const queryLines = ['A', 'B', 'C', 'D', 'E', 'F', 'J', 'K'];
    const chartLines = ['A', 'B', 'C', 'D', 'E', 'G', 'H', 'I'];
    const teamMap = { ate: 'ATE', aoi: 'AOI', ft: 'FT' };
    const typeMap = {
      se500: 'SE500', qx500: 'QX500', holly_spi: 'HOLLY_SPI', holly_aoi: 'HOLLY_AOI',
      xray: 'XRAY', veiw: T('目视主机'), i3070: 'I3070', jet300: 'JET300', emu: 'EMU',
      robot: 'ROBOT', jig: T('治具'), el: 'EL_router', sm: 'SM_router',
    };

    /** 按线别汇总某维度（部门或机台类型）：{ A:[合计, 次数], B:[...], ... } */
    const byLine = (name, index) => {
      const o = {};
      for (const L of queryLines) o[L] = totalTime(name, index, L, start, end);
      return o;
    };
    const teams = { ate: byLine('ATE', 'team'), aoi: byLine('AOI', 'team'), ft: byLine('FT', 'team') };
    const types = {};
    for (const k of Object.keys(typeMap)) types[k] = byLine(typeMap[k], 'type');

    const seriesOf = (src, i) => chartLines.map((L) => (src && src[L] ? src[L][i] : 0));
    const chart3Series = Object.keys(typeMap).map((k) => ({ name: typeMap[k], data: seriesOf(types[k], 0) }));

    const page = L`<html lang="zh-CN">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<title>Charts TE Maintain</title>
<link rel="stylesheet" href="../layui/css/layui.css" media="all">
<script src="../js/jquery-1.7.2.js"></script>
<script src="../js/highcharts.js"></script>
<script src="../layui/layui.js"></script>
<!-- 本页由服务端生成并已翻译好，这里只加载语言切换按钮，不再翻译页面文字（避免误译数据） -->
<script>window.TE_I18N_NO_WALK = true;</script>
<script src="/js/i18n.js"></script>
</head>
<body class="layui-bg-gray">
  <script>
layui.use(['form', 'laydate'], function(){
  var laydate = layui.laydate;
  laydate.render({ elem: '#StartTime', theme: 'molv' });
  laydate.render({ elem: '#EndTime', theme: 'molv' });
  layui.form.render();
});
 </script>
<div class="layui-fluid" style="padding-top:15px">
  <div class="layui-card">
    <div class="layui-card-header">TE-Maintain 数据图表</div>
    <div class="layui-card-body">
      <form class="layui-form" method="post" action="/maintain/charttry.php">
        <div class="layui-form-item">
          <div class="layui-inline">
            <label class="layui-form-label" style="width:60px">日期起</label>
            <div class="layui-input-inline" style="width:150px">
              <input id="StartTime" type="text" class="layui-input" name="startt" value="${h(start)}" autocomplete="off">
            </div>
          </div>
          <div class="layui-inline">
            <label class="layui-form-label" style="width:40px">止</label>
            <div class="layui-input-inline" style="width:150px">
              <input id="EndTime" type="text" class="layui-input" name="endt" value="${h(end)}" autocomplete="off">
            </div>
          </div>
          <div class="layui-inline">
            <button id="btn-veiw" type="submit" name="submit" class="layui-btn layui-btn-sm">查询记录</button>
          </div>
        </div>
      </form>
    </div>
  </div>
</div>
 <script>
 var Start="${start}";
 var Et="${end}";
 function chartBase(yTitle, categories, series, pointUnit){
   return {
     chart: { type: 'column' },
     title: { text: null },
     subtitle: { text: 'Date:' + Start + '--' + Et },
     xAxis: { categories: categories, crosshair: true },
     yAxis: { min: 0, title: { text: yTitle } },
     tooltip: {
       headerFormat: '<span style="font-size:10px">{point.key}</span><table>',
       pointFormat: '<tr><td style="color:{series.color};padding:0">{series.name}: </td>' +
         '<td style="padding:0"><b>{point.y} ' + pointUnit + '</b></td></tr>',
       footerFormat: '</table>', shared: true, useHTML: true
     },
     plotOptions: { column: { pointPadding: 0.2, borderWidth: 0 } },
     credits: { enabled: false },
     series: series
   };
 }
 $(document).ready(function(){
   var cats = ${JSON.stringify(chartLines)};
   $('#container').highcharts(chartBase('time (mins)', cats, ${JSON.stringify([
      { name: 'ATE', data: seriesOf(teams, 0) },
      { name: 'AOI', data: seriesOf(teams.aoi, 0) },
      { name: 'FT', data: seriesOf(teams.ft, 0) },
    ])}, 'mins'));
   $('#counts').highcharts(chartBase('counts', cats, ${JSON.stringify([
      { name: 'ATE', data: seriesOf(teams, 1) },
      { name: 'AOI', data: seriesOf(teams.aoi, 1) },
      { name: 'FT', data: seriesOf(teams.ft, 1) },
    ])}, ''));
   $('#type_time').highcharts(chartBase('time (mins)', cats, ${JSON.stringify(chart3Series)}, 'mins'));
 });
</script>
<div class="layui-fluid" style="padding-bottom:15px">
  <div class="layui-card">
    <div class="layui-card-header">各线停机时间</div>
    <div class="layui-card-body"><div id="container" style="height:400px"></div></div>
  </div>
  <div class="layui-card">
    <div class="layui-card-header">各线停线次数</div>
    <div class="layui-card-body"><div id="counts" style="height:400px"></div></div>
  </div>
  <div class="layui-card">
    <div class="layui-card-header">各种机台停机时间</div>
    <div class="layui-card-body"><div id="type_time" style="height:400px"></div></div>
  </div>
</div>
</body>
</html>`;
    text(res, page);
  });

  // ---------- export.php（导出维修统计 Excel） ----------
  app.all('/maintain/export.php', async (req, res) => {
    const q = (req.session && req.session.q) || req.query.q || '';
    if (!q) return text(res, "Session 'q' not set.");

    const varArr = String(q).split('_');
    const team = varArr[0], line = varArr[1], start = varArr[2], end = varArr[3];
    const TODAY = today();
    const lines = ['A', 'B', 'C', 'D', 'E', 'G', 'H', 'I'];

    const stats = {};
    for (const L of lines) {
      stats[L] = {
        ATE: { time: 0, count: 0 },
        AOI: { time: 0, count: 0 },
        FT: { time: 0, count: 0, z_time: 0, r_time: 0 },
        daily: {},
      };
    }

    const dailyDates = [TODAY, dayEarly(1), dayEarly(2), dayEarly(3), dayEarly(4)];

    // 时间换算规则：I3070 减半；S\d_x / S\d_ROB 除以 24；最后取整
    const calcTime = (raw, type, station) => {
      let t = raw;
      if (/I3070.*/.test(type || '')) t = t / 2;
      if (/S\d_\d.*/.test(station || '') || /S\d_ROB.*/.test(station || '')) t = t / 24;
      return Math.trunc(t);
    };

    const where = ['team = ?'];
    const params = [team];
    if (line && line !== 'ALL') { where.push('line = ?'); params.push(line); }
    const globalStart = [start, dayEarly(4)].sort()[0];
    const globalEnd = [end, TODAY].sort().slice(-1)[0];
    where.push('date >= ?'); params.push(globalStart);
    where.push('date <= ?'); params.push(globalEnd);

    const details = db()
      .prepare(`SELECT id, line, station, type, date, fa, ca, fault, time, owner FROM maintain WHERE ${where.join(' AND ')}`)
      .all(...params);

    for (const row of details) {
      const l = row.line, type = row.type, date = row.date, station = row.station;
      if (!lines.includes(l)) continue;
      const rawTime = parseInt(String(row.time ?? '').replace(/mins/g, ''), 10) || 0;
      if (rawTime === 0) continue;

      if (date >= start && date <= end && stats[l][type]) {
        const finalTime = calcTime(rawTime, type, station);
        stats[l][type].time += finalTime;
        stats[l][type].count++;
        if (type === 'FT') {
          if (/S\d_\d.*/.test(station || '') || /S\d_ROB.*/.test(station || '')) {
            stats[l].FT.z_time += calcTime(rawTime, type, station);
          }
          if (/ROUT.*/.test(station || '')) {
            stats[l].FT.r_time += calcTime(rawTime, type, station);
          }
        }
      }

      if (dailyDates.includes(date)) {
        const t = calcTime(rawTime, type, station);
        if (!stats[l].daily[date]) stats[l].daily[date] = { ATE: 0, AOI: 0, FT: 0 };
        if (stats[l].daily[date][type] !== undefined) stats[l].daily[date][type] += t;
      }
    }

    let totalCount = 0, totalTime = 0, totalZTime = 0, totalRTime = 0;
    for (const L of lines) {
      totalCount += stats[L].FT.count;
      totalTime += stats[L].FT.time;
      totalZTime += stats[L].FT.z_time;
      totalRTime += stats[L].FT.r_time;
    }
    const AVG = totalCount > 0 ? totalTime / totalCount : 0;
    const AVG_Z = totalCount > 0 ? totalZTime / totalCount : 0;
    const AVG_R = totalCount > 0 ? totalRTime / totalCount : 0;

    // 与 PHP `up2days($start,$end)` 等价：日期为空时按 0 处理
    let upday = 0;
    if (start && end) {
      const d1 = new Date(start), d2 = new Date(end);
      if (!Number.isNaN(d1.getTime()) && !Number.isNaN(d2.getTime())) {
        upday = Math.trunc((d2 - d1) / 86400000);
      }
    }
    const headerText = upday === 0
      ? L`${team} 导出时间：${TODAY} 未选择日期范围`
      : L`${team} 导出时间：${TODAY} ${start}--${end}`;

    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const dataSheet = wb.addWorksheet('Data');
    const chartSheet = wb.addWorksheet('Chart');

    // 表头信息与产线标签（沿用原模板单元格位置）
    dataSheet.getCell('A4').value = headerText;
    lines.forEach((L, idx) => {
      dataSheet.getCell(`L${5 + idx}`).value = L;
      dataSheet.getCell(`N${5 + idx}`).value = L;
      dataSheet.getCell(`M${5 + idx}`).value = stats[L].FT.count;
      dataSheet.getCell(`O${5 + idx}`).value = stats[L].FT.time;
      dataSheet.getCell(`L${25 + idx}`).value = stats[L].FT.z_time;
      dataSheet.getCell(`M${25 + idx}`).value = stats[L].FT.r_time;
      const d = stats[L].daily;
      ['P', 'Q', 'R', 'S', 'T'].forEach((col, i) => {
        const day = dailyDates[i];
        dataSheet.getCell(`${col}${5 + idx}`).value = (d[day] && d[day].FT) || 0;
      });
    });
    dailyDates.forEach((date, idx) => { dataSheet.getCell(`V${1 + idx}`).value = date; });
    dataSheet.getCell('M23').value = totalCount;
    dataSheet.getCell('O23').value = totalTime;
    dataSheet.getCell('L33').value = totalZTime;
    dataSheet.getCell('M33').value = totalRTime;

    // 详细记录：第 50 行起（A-J 列）
    const keywords = ['id', 'line', 'station', 'type', 'date', 'fa', 'ca', 'fault', 'time', 'owner'];
    details.forEach((row, idx) => {
      const r = 50 + idx;
      keywords.forEach((k, i) => {
        dataSheet.getCell(r, i + 1).value = row[k] ?? '';
      });
      const t = parseInt(String(row.time ?? '').replace(/mins/g, ''), 10);
      dataSheet.getCell(r, 11).value = Number.isFinite(t) ? t : 0;
    });

    chartSheet.getCell('C1').value = L`${team} Maintain记录图表`;
    const summary = [
      [T('线别'), T('次数'), T('停机时间')],
      ...lines.map((L) => [L, stats[L].FT.count, stats[L].FT.time]),
      [T('合计'), totalCount, totalTime],
    ];
    summary.forEach((row, i) => {
      row.forEach((v, j) => { chartSheet.getCell(3 + i, 3 + j).value = v; });
    });
    const avgRows = [
      [L`${start}--${end} 停机率 avg`, `${numberFormat(AVG * 100, 2)}%`, 'limited', Math.round(totalCount * AVG)],
      [L`${start}--${end} 日Zero_Touch avg`, `${numberFormat(AVG_Z * 100, 2)}%`, 'limited', Math.round(totalCount * AVG_Z)],
      [L`${start}--${end} 日Router avg`, `${numberFormat(AVG_R * 100, 2)}%`, 'limited', Math.round(totalCount * AVG_R)],
      [T('近五日停机时间分布'), dailyDates.join(' / '), '', ''],
    ];
    avgRows.forEach((row, i) => {
      row.forEach((v, j) => { chartSheet.getCell(12 + i, 3 + j).value = v; });
    });

    const filename = q || 'maintain';
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res);
    res.end();
  });
};
