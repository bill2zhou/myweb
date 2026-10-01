'use strict';
const { T, L } = require('../lang');
const { h, today, dayEarly, numberFormat, gridTable } = require('../util');

const NO_DATA = "<div class='layui-text' style='padding:15px;color:#999'>No Data</div>";
const TABLE_OPEN = "<table id='tb-order' class='layui-table' lay-even>";

/** PHP date('w')：0=周日 … 6=周六 */
function weekday(val) {
  const d = new Date(dayEarly(val) + 'T00:00:00');
  return d.getDay();
}

/** PHP date('W')：ISO 周序号 */
function isoWeek(val) {
  const d = new Date(dayEarly(val) + 'T00:00:00');
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target - yearStart) / 86400000 + 1) / 7);
}

module.exports = function registerFpy(app, ctx) {
  const db = () => ctx.getDb();
  const text = (res, s) => res.type('text/html; charset=utf-8').send(s);

  /** 取某表某行（原 PHP 遍历命中行，以最后一行为准） */
  const lastRow = (table, where, params) => {
    const rows = db().prepare(`SELECT * FROM ${table} WHERE ${where}`).all(...params);
    return rows.length ? rows[rows.length - 1] : null;
  };

  // ============ 一、fpy_v1.php（良率明细表） ============
  function aoiTable(varArr) {
    const start = varArr[1], end = varArr[2];
    const rows = start === end
      ? db().prepare('SELECT * FROM aoi WHERE date = ? ORDER BY `dev` DESC').all(start)
      : db().prepare('SELECT * FROM aoi WHERE date >= ? AND date <= ? ORDER BY `dev` DESC').all(start, end);

    const headers = [T('机台编号'), T('日期'), T('总数'), T('良品'), T('不良'), T('良率'),
      'TOP1', 'TOP1_N', 'TOP2', 'TOP2_N', 'TOP3', 'TOP3_N',
      'TOP4', 'TOP4_N', 'TOP5', 'TOP5_N', 'TOP6', 'TOP6_N',
      'TOP7', 'TOP7_N', 'TOP8', 'TOP8_N', 'TOP9', 'TOP9_N', 'TOP10', 'TOP10_N'];
    const widths = ['4%', '10%', '8%', '8%', '5%', '7%',
      '10%', '6%', '10%', '6%', '10%', '6%', '10%', '6%', '10%', '6%',
      '10%', '6%', '10%', '6%', '10%', '6%', '10%', '6%', '10%', '6%'];

    let out = TABLE_OPEN + '<tr>';
    headers.forEach((label, i) => { out += `<th style='width:${widths[i]}'>${label}</th>`; });
    out += '</tr>';
    for (const r of rows) {
      const fp = Number(r.fpy) || 0;
      const color = fp < 55 ? '#cc0000' : '#00ff33';
      out += '<tr>';
      out += `<td style='width:15%'>${h(r.dev)} </td>`;
      out += `<td style='width:12%'>${h(r.date)}</td>`;
      out += `<td style='width:8%'>${h(r.total)}</td>`;
      out += `<td style='width:8%'>${h(r.pass)}</td>`;
      out += `<td style='width:7%'>${h(r.fail)}</td>`;
      out += `<td style='width:7%; background-color:${color}'>${h(r.fpy)}</td>`;
      for (let n = 1; n <= 10; n++) {
        out += `<td style='width:8%'>${h(r['top' + n])}</td>`;
        out += `<td style='width:6%'>${h(r['top' + n + '_n'])}</td>`;
      }
      out += '</tr>';
    }
    return rows.length ? out + '</table>' : NO_DATA;
  }

  function ateTable(varArr) {
    const start = varArr[1], end = varArr[2];
    const rows = start === end
      ? db().prepare('SELECT * FROM fpy WHERE date = ? ORDER BY `device`').all(start)
      : db().prepare('SELECT * FROM fpy WHERE date >= ? AND date <= ? ORDER BY `date` DESC').all(start, end);

    if (!rows.length) return NO_DATA;

    let total = 0, pass = 0;
    for (const r of rows) { total += Number(r.total) || 0; pass += Number(r.pass) || 0; }
    const fpyAll = numberFormat(pass / total, 4);

    let out = L`总数：${total} 良率：${fpyAll}`;
    out += TABLE_OPEN + '<tr>';
    out += T("<th style='width:4%'>綫體</th>");
    out += T("<th style='width:8%'>日期</th>");
    out += T("<th style='width:8%'>总数</th>");
    out += T("<th style='width:8%'>良品</th>");
    out += T("<th style='width:7%'>不良</th>");
    out += T("<th style='width:5%'>不良零件數</th>");
    out += T("<th style='width:7%'>良率</th>");
    out += T("<th style='width:10%'>机种</th>");
    out += "<th style='width:10%'>TOP1</th>";
    out += "<th style='width:6%'>TOP1_N</th>";
    out += "<th style='width:10%'>TOP2</th>";
    out += "<th style='width:6%'>TOP2_N</th>";
    out += "<th style='width:10%'>TOP3</th>";
    out += "<th style='width:6%'>TOP3_N</th>";
    out += T("<th style='width:5%'>机种</th>");
    out += '</tr>';

    for (const r of rows) {
      const fp = Number(r.fpy) || 0;
      let color = '#00ff33';
      if (fp <= 0) color = '#b0b0b0';
      else if (fp < 93) color = '#cc0000';
      out += '<tr>';
      out += `<td style='width:5%'>${h(r.device)} </td>`;
      out += `<td style='width:8%'>${h(r.date)}</td>`;
      out += `<td style='width:8%'>${h(r.total)}</td>`;
      out += `<td style='width:8%'>${h(r.pass)}</td>`;
      out += `<td style='width:7%'>${h(r.fail)}</td>`;
      out += `<td style='width:7%'>${h(r.fail_comp)}</td>`;
      out += `<td style='width:7%; background-color:${color}'>${h(r.fpy)}</td>`;
      out += `<td style='width:7%'>${h(r.mods)}</td>`;
      out += `<td style='width:8%'>${h(r.top1)}</td>`;
      out += `<td style='width:6%'>${h(r.top1_n)}</td>`;
      out += `<td style='width:8%'>${h(r.top2)}</td>`;
      out += `<td style='width:6%'>${h(r.top2_n)}</td>`;
      out += `<td style='width:8%'>${h(r.top3)}</td>`;
      out += `<td style='width:6%'>${h(r.top3_n)}</td>`;
      out += "<th style='width:5%'> <input id='dpmo'   value=''  /> </td> ";
      out += '</tr>';
    }
    return out + '</table>';
  }

  app.all('/fpy/fpy_v1.php', (req, res) => {
    const q = req.query.q || '';
    req.session.q = q;
    const varArr = String(q).split('_');
    if (!varArr[0]) return text(res, T('...请选择部门...'));
    if (!varArr[1] || varArr[1] > varArr[2]) return text(res, T('...请选择日期...'));

    const prefix = `Team:${varArr[0]}  Date:${varArr[1]}--${varArr[2]}`;
    if (varArr[0] === 'AOI') return text(res, prefix + aoiTable(varArr));
    if (varArr[0] === 'ATE') return text(res, prefix + ateTable(varArr));
    text(res, prefix + NO_DATA);
  });

  // ============ 二、图表页（ATE / AOI / FT） ============
  /** 某表某设备某日：返回 [fpy, total, pass] */
  function devStat(table, devCol, dev, date) {
    const row = lastRow(table, `${devCol} = ? AND date = ?`, [dev, date]);
    if (!row) return [0, 0, 0];
    return [Number(row.fpy) || 0, Number(row.total) || 0, Number(row.pass) || 0];
  }

  /** 某日整表汇总良率 */
  function dayFpy(table, date) {
    const rows = db().prepare(`SELECT total, pass FROM ${table} WHERE date = ?`).all(date);
    let t = 0, p = 0;
    for (const r of rows) { t += Number(r.total) || 0; p += Number(r.pass) || 0; }
    return numberFormat((p / (t + 0.01)) * 100, 2);
  }

  function weekInfo() {
    return {
      wek: weekday(1), wek1: weekday(2), wek2: weekday(3), wek3: weekday(4),
      wek4: weekday(5), wek5: weekday(6), wek6: weekday(7), We: isoWeek(1),
    };
  }

  /**
   * 近 7 天整表良率：fpy_0 = 昨天(day1) …
   * 图表 x 轴与数据均按 [day7 … day1] 顺序排列（与原 PHP 一致）
   */
  function weekSeries(table) {
    const byDay = [1, 2, 3, 4, 5, 6, 7].map((n) => Number(dayFpy(table, dayEarly(n))));
    return byDay.slice().reverse(); // [fpy_6 … fpy_0]
  }

  // 注意：必须写成函数。若写成 const NAV = L`...`，会在模块加载时（还没有请求上下文）
  // 就固定成中文，导致切换语言后导航栏始终是中文。
  const navHtml = () => L`<ul class="layui-nav" lay-filter="fpy">
  <li class="layui-nav-item"><a href="chart_fpy.php">ATE</a></li>
  <li class="layui-nav-item"><a href="chart_fpy_aoi.php">AOI</a></li>
  <li class="layui-nav-item"><a href="chart_fpy_ft.php">FT</a></li>
  <li class="layui-nav-item" style="float:right"><a href="/ntf.html">退出</a></li>
</ul>`;

  /** 通用图表页骨架 */
  function page({ title, chart1Title, categories, series1, showTop3, top3Title, top3Categories, top3Series, height }) {
    const w = weekInfo();
    const fpyList = weekSeries('fpy');
    const weeklyLabels = [w.wek6, w.wek5, w.wek4, w.wek3, w.wek2, w.wek1, w.wek];

    const top3Script = showTop3 ? `
   $('#tbarchart').highcharts({
     chart: { type: 'bar' },
     title: { text: null },
     subtitle: { text: 'Source: BILL' },
     xAxis: { categories: ${JSON.stringify(top3Categories)}, title: { text: null } },
     yAxis: { min: 0, title: { align: 'high' }, labels: { overflow: 'justify' } },
     tooltip: { valueSuffix: ' ' },
     plotOptions: { bar: { dataLabels: { enabled: true } } },
     legend: { layout: 'vertical', align: 'right', verticalAlign: 'top', x: -40, y: 100, floating: true, borderWidth: 1,
       backgroundColor: ((Highcharts.theme && Highcharts.theme.legendBackgroundColor) || '#FFFFFF'), shadow: true },
     credits: { enabled: false },
     series: ${JSON.stringify(top3Series)}
   });` : '';

    return L`<html lang="zh-CN">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<title>Charts ${title}</title>
<link rel="stylesheet" href="../layui/css/layui.css" media="all">
<script src="../js/jquery-1.7.2.js"></script>
<script src="../js/highcharts.js"></script>
<script src="../layui/layui.js"></script>
<!-- 本页由服务端生成并已翻译好，这里只加载语言切换按钮，不再翻译页面文字（避免误译数据） -->
<script>window.TE_I18N_NO_WALK = true;</script>
<script src="/js/i18n.js"></script>
</head>
<body class="layui-bg-gray">
${navHtml()}
<div class="layui-fluid" style="padding-top:15px;padding-bottom:15px">
  <div class="layui-card">
    <div class="layui-card-header">${chart1Title}</div>
    <div class="layui-card-body"><div id="container" style="height:400px"></div></div>
  </div>
  <div class="layui-card">
    <div class="layui-card-header">一周每日平均良率</div>
    <div class="layui-card-body"><div id="linechart" style="height:400px"></div></div>
  </div>
  ${showTop3 ? `<div class="layui-card">
    <div class="layui-card-header">${top3Title}</div>
    <div class="layui-card-body"><div id="tbarchart" style="height:${height || 400}px"></div></div>
  </div>` : ''}
</div>
<script language="JavaScript">
layui.use('element', function () { layui.element.render(); });
$(document).ready(function(){
  $('#container').highcharts({
    chart: { type: 'column' },
    title: { text: null },
    subtitle: { text: 'Date:' + '${dayEarly(1)}' },
    xAxis: { categories: ${JSON.stringify(categories)}, crosshair: true },
    yAxis: { min: 0, title: { text: '百分比' } },
    tooltip: {
      headerFormat: '<span style="font-size:10px">{point.key}</span><table>',
      pointFormat: '<tr><td style="color:{series.color};padding:0">{series.name}: </td>' +
        '<td style="padding:0"><b>{point.y:.2f} %</b></td></tr>',
      footerFormat: '</table>', shared: true, useHTML: true
    },
    plotOptions: { column: { pointPadding: 0.2, borderWidth: 0, dataLabels: { enabled: true } } },
    credits: { enabled: false },
    series: ${JSON.stringify(series1)}
  });

  $('#linechart').highcharts({
    title: { text: null },
    subtitle: { text: 'week:' + '${w.We}' },
    xAxis: { categories: ${JSON.stringify(weeklyLabels)} },
    yAxis: { title: { text: '(%)' } },
    plotOptions: { line: { dataLabels: { enabled: true }, enableMouseTracking: false } },
    series: [{ name: 'FPY', data: ${JSON.stringify(fpyList)} }]
  });
${top3Script}
});
</script>
</body>
</html>`;
  }

  app.all('/fpy/chart_fpy.php', (req, res) => {
    const d = dayEarly(1);
    const lines = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
    const ate = lines.map((L) => numberFormat(
      (devStat('fpy', 'device', L.toLowerCase(), d)[2] / (devStat('fpy', 'device', L.toLowerCase(), d)[1] + 0.01)) * 100, 2
    )).map(Number);

    const devs = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    const ratios = (field) => devs.map((dev) => {
      const r = lastRow('fpy', 'device = ? AND date = ?', [dev, d]);
      if (!r) return 0;
      const total = Number(r.total) || 0;
      const n = Number(r[field]) || 0;
      return Number(numberFormat(total > 0 ? (n / total) * 100 : 0, 2));
    });

    text(res, page({
      title: 'TE Maintain',
      chart1Title: T('ATE各线良率'),
      categories: lines,
      series1: [{ name: 'ATE', data: ate }],
      showTop3: true,
      top3Title: 'ATE TOP3 NTF',
      top3Categories: devs,
      top3Series: [
        { name: 'TOP1', data: ratios('top1_n') },
        { name: 'TOP2', data: ratios('top2_n') },
        { name: 'TOP3', data: ratios('top3_n') },
      ],
      height: 1600,
    }));
  });

  app.all('/fpy/chart_fpy_aoi.php', (req, res) => {
    const d = dayEarly(1);
    const lines = ['A', 'B', 'C', 'D', 'E', 'G', 'H', 'I'];
    const pct = (dev) => {
      const v = devStat('aoi', 'dev', dev, d);
      return Number(numberFormat((v[2] / (v[1] + 0.01)) * 100, 2));
    };
    // 与原 PHP 的 a_aoia..i_aoia 一一对应
    const aoia = lines.map((L) => pct(`${L.toLowerCase()}_aoia`));
    // 原 PHP 中 aoib 的键与设备名错位（b→c、d→d、g→e、c→g 等），此处保持一致
    const aoib = {
      A: pct('a_aoib'), B: pct('b_aoib'), D: pct('c_aoib'), G: pct('d_aoib'),
      C: pct('e_aoib'), E: pct('g_aoib'), H: pct('h_aoib'), I: pct('i_aoib'),
    };
    const aoibSeries = lines.map((L) => aoib[L] ?? 0);

    const devNames = ['a_aoia', 'b_aoia', 'c_aoia', 'd_aoia', 'e_aoia', 'g_aoia', 'h_aoia', 'i_aoia',
      'a_aoib', 'b_aoib', 'c_aoib', 'd_aoib', 'e_aoib', 'g_aoib', 'h_aoib', 'i_aoib'];
    const topSeries = [];
    for (let n = 1; n <= 10; n++) {
      topSeries.push({
        name: 'TOP' + n,
        data: devNames.map((dev) => {
          const r = lastRow('aoi', 'dev = ? AND date = ?', [dev, d]);
          return r ? Number(r['top' + n + '_n']) || 0 : 0;
        }),
      });
    }

    text(res, page({
      title: 'TE Maintain AOI',
      chart1Title: T('AOI各线良率'),
      categories: lines,
      series1: [{ name: 'AOIA', data: aoia }, { name: 'AOIB', data: aoibSeries }],
      showTop3: true,
      top3Title: 'AOI TOP10 NTF',
      top3Categories: devNames,
      top3Series: topSeries,
      height: 4000,
    }));
  });

  app.all('/fpy/chart_fpy_ft.php', (req, res) => {
    const d = dayEarly(1);
    const rate = (dev) => {
      const v = devStat('ft', 'device', dev, d);
      return Number(numberFormat((v[2] / (v[1] + 0.01)) * 100, 2));
    };
    const ftS1 = { J: rate('111'), K: rate('113'), A: rate('115'), E: rate('117'), C: rate('119') };
    const ftS2 = { J: rate('112'), K: rate('114'), A: rate('116'), E: rate('118'), C: rate('120') };
    const cats = ['A', 'C', 'E', 'J', 'K'];

    text(res, page({
      title: 'TE Maintain FT',
      chart1Title: T('FT各线良率'),
      categories: cats,
      series1: [
        { name: 'S1', data: cats.map((c) => ftS1[c]) },
        { name: 'S2', data: cats.map((c) => ftS2[c]) },
      ],
      showTop3: false,
    }));
  });

  // ============ 三、Excel 导出（export.php / exportaoi.php / exportft.php） ============
  const TPL = {
    ate: { table: 'fpy', devCol: 'device', file: 'ate.xlsx' },
    aoi: { table: 'aoi', devCol: 'dev', file: 'aoi.xlsx' },
    // 原 exportft.php 查询的是 fpy 表（上游笔误），此处改为正确的 ft 表
    ft: { table: 'ft', devCol: 'device', file: 'ate.xlsx' },
  };

  async function exportFpy(req, res, kind) {
    const q = (req.session && req.session.q) || req.query.q || '';
    const varArr = String(q).split('_');
    const team = varArr[0];
    const start = varArr[1];
    const end = varArr[2];

    if (start && end && start > end) return text(res, T('...时间格式错误...'));

    const { table, devCol } = TPL[kind];
    const lines = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];

    // day[1..7]：有结束日期时以结束日期为基准，否则以今天为基准
    const day = {};
    for (let i = 1; i <= 7; i++) {
      day[i] = end ? dayEarly(i - 1, end) : dayEarly(i);
    }

    const getData = (dev, date) => devStat(table, devCol, dev, date);
    const topOf = (dev, date) => {
      const r = lastRow(table, `${devCol} = ? AND date = ?`, [dev, date]);
      return r || {};
    };
    const weekFpy = (d1, d2) => {
      const rows = db().prepare(`SELECT total, pass FROM ${table} WHERE date <= ? AND date >= ?`).all(d1, d2);
      let t = 0, p = 0;
      for (const r of rows) { t += Number(r.total) || 0; p += Number(r.pass) || 0; }
      return numberFormat((p / (t + 0.01)) * 100, 2);
    };
    const totalFpy = (date) => {
      const rows = db().prepare(`SELECT total, pass FROM ${table} WHERE date = ?`).all(date);
      let t = 0, p = 0;
      for (const r of rows) { t += Number(r.total) || 0; p += Number(r.pass) || 0; }
      return numberFormat((p / (t + 0.01)) * 100, 2);
    };

    const AVG_FPY = weekFpy(day[1], day[7]);
    const upday = start && end ? Math.trunc((new Date(end) - new Date(start)) / 86400000) : 0;

    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const sheetChart = wb.addWorksheet('chart');
    const sheetData = wb.addWorksheet('data');
    const sheetTop3 = wb.addWorksheet('top3');

    // --- chart 表：近 7 天整机良率 ---
    for (let i = 1; i <= 7; i++) {
      sheetChart.getCell(`A${i}`).value = day[8 - i];
      sheetChart.getCell(`B${i}`).value = Number(totalFpy(day[8 - i]));
    }

    // --- data 表：DEVICE × 7 天（每天 3 列：良品 / 总数 / 良率） ---
    const headerPass = ['U', 'R', 'O', 'L', 'I', 'F', 'C'];   // 良品
    const headerTotal = ['V', 'S', 'P', 'M', 'J', 'G', 'D'];  // 总数
    const headerFpy = ['W', 'T', 'Q', 'N', 'K', 'H', 'E'];    // 良率
    sheetData.getCell('C3').value = upday === 0
      ? L`${team} 导出时间：${today()} 未选择日期范围`
      : L`${team} 导出时间：${today()} ${start}--${end}`;
    sheetData.getCell('B4').value = 'DEVICE';
    [1, 2, 3, 4, 5, 6, 7].forEach((j) => {
      sheetData.getCell(`${headerPass[j - 1]}4`).value = day[j];
    });

    lines.forEach((dev, idx) => {
      const r = 5 + idx;
      sheetData.getCell(`A${r}`).value = dev;
      for (let j = 1; j <= 7; j++) {
        const v = getData(dev, day[j]);
        const fp = v[0];
        sheetData.getCell(`${headerPass[j - 1]}${r}`).value = v[2];
        sheetData.getCell(`${headerTotal[j - 1]}${r}`).value = v[1];
        const cell = sheetData.getCell(`${headerFpy[j - 1]}${r}`);
        cell.value = fp;
        if (fp < 93 && fp > 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
        else if (fp >= 93) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00FF22' } };
      }
    });

    // --- top3 表：每天每线 TOP1..TOP3 明细（原模板坐标 LT 布局） ---
    for (let j = 0; j < 7; j++) {
      const base = 2 + j * 27;
      sheetTop3.getCell(`A${base}`).value = day[1 + j];
      for (let i = 1; i <= 9; i++) {
        const one = i * 3 - 1 + 27 * j;
        const two = i * 3 + 27 * j;
        const three = i * 3 + 1 + 27 * j;
        const t = topOf(lines[i - 1], day[j + 1]);
        sheetTop3.getCell(`C${one}`).value = t.mods ?? '';
        sheetTop3.getCell(`E${one}`).value = t.top1 ?? '';
        sheetTop3.getCell(`E${two}`).value = t.top2 ?? '';
        sheetTop3.getCell(`E${three}`).value = t.top3 ?? '';
        sheetTop3.getCell(`G${one}`).value = t.top1_n ?? 0;
        sheetTop3.getCell(`G${two}`).value = t.top2_n ?? 0;
        sheetTop3.getCell(`G${three}`).value = t.top3_n ?? 0;
      }
    }

    // 模板中的平均值提示（原为内嵌图表标题）
    sheetChart.getCell('C3').value = L`平均良率 WEEKLY: ${AVG_FPY} %`;

    const filename = `FPY${q || start || day[1]}`;
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res);
    res.end();
  }

  app.all('/fpy/export.php', (req, res) => exportFpy(req, res, 'ate'));
  app.all('/fpy/exportaoi.php', (req, res) => exportFpy(req, res, 'aoi'));
  app.all('/fpy/exportft.php', (req, res) => exportFpy(req, res, 'ft'));
};
