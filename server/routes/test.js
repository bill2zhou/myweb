'use strict';
const { T, L } = require('../lang');
const { parseNameField } = require('../util');

/** 四个等级图表页共用的渲染逻辑（保持与原 PHP 页面一致的数据结构） */
function chartScript(levels) {
  return L`layui.use(function () {
  var DATA = ${JSON.stringify(levels)};
  var TITLES = {
    basic: 'Basic 測試分數',
    standard: 'Standard 測試分數',
    advance: 'Advance 測試分數',
    professional: 'Professional 測試分數'
  };

  function build(obj) {
    var series = Object.keys(obj).map(function (key) {
      return { name: key, data: obj[key].map(function (item) { return Number(item); }) };
    });
    var longest = null;
    Object.keys(obj).forEach(function (k) {
      if (!longest || obj[k].length > longest.length) longest = obj[k];
    });
    return { series: series, xdata: Object.keys(longest || {}) };
  }

  Object.keys(TITLES).forEach(function (level) {
    var built = build(DATA[level] || {});
    Highcharts.chart(level, {
      chart: { type: 'column' },
      title: { text: TITLES[level] },
      subtitle: { text: 'Date:' },
      xAxis: { categories: built.xdata, crosshair: true },
      yAxis: { min: 0, title: { text: '分數' } },
      tooltip: {
        headerFormat: '<span style="font-size:10px">{point.key}</span><table>',
        pointFormat: '<tr><td style="color:{series.color};padding:0">{series.name}: </td>' +
          '<td style="padding:0"><b>{point.y:.2f} %</b></td></tr>',
        footerFormat: '</table>',
        shared: true,
        useHTML: true
      },
      plotOptions: { column: { pointPadding: 0.2, borderWidth: 0, dataLabels: { enabled: true } } },
      credits: { enabled: false },
      series: built.series
    });
  });
});`;
}

module.exports = function registerTest(app, ctx) {
  const db = () => ctx.getDb();
  const text = (res, s) => res.type('text/html; charset=utf-8').send(s);

  // ---------- getdata.php（按等级 + 部门取题目，超过 20 题随机抽 20 题） ----------
  app.all('/test/getdata.php', (req, res) => {
    const q = req.query.q || '';
    req.session.q = q;
    const varArr = String(q).split('_');
    const level = varArr[0], team = varArr[1];

    const rows = db().prepare('SELECT * FROM test WHERE level = ? AND team = ?').all(level, team);
    let arr = rows.map((r) => ({
      question: r.question,
      options: [r.answer1, r.answer2, r.answer3, r.answer4],
      correct: r.correct,
    }));

    if (arr.length > 20) {
      // 与 PHP array_rand 等价：随机抽取 20 题并重新编号
      const picked = [];
      const pool = arr.slice();
      for (let i = 0; i < 20 && pool.length; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        picked.push(pool.splice(idx, 1)[0]);
      }
      arr = picked.map((item, i) => ({
        question: `${i + 1}.${item.question}`,
        options: item.options,
        correct: item.correct,
      }));
    }
    res.type('application/json; charset=utf-8').send(JSON.stringify(arr));
  });

  // ---------- savescore.php（按工号记录成绩） ----------
  app.all('/test/savescore.php', (req, res) => {
    const q = req.query.q || '';
    req.session.q = q;
    const varArr = String(q).split('_');
    const level = varArr[0], psn = varArr[1], score = varArr[2], team = varArr[3];

    const user = db().prepare('SELECT name FROM users WHERE psn = ?').get(psn);
    if (!user) {
      return text(res, T('Error: 數據庫沒有這個工號<br>'));
    }
    try {
      db().prepare('INSERT INTO score (team,name,scores,level) VALUES (?,?,?,?)')
        .run(team, user.name, score, level);
      text(res, 'Sucess');
    } catch (e) {
      text(res, 'Error: ' + e.message);
    }
  });

  // ---------- add.php（新增题目） ----------
  app.all('/test/add.php', (req, res) => {
    const d = parseNameField(req.body);
    try {
      db().prepare(
        `INSERT INTO test (team,level,question,answer1,answer2,answer3,answer4,correct)
         VALUES (?,?,?,?,?,?,?,?)`
      ).run(
        d.team, d.level, d.question,
        `A.${d.answer1}`, `B.${d.answer2}`, `C.${d.answer3}`, `D.${d.answer4}`,
        d.correct
      );
      text(res, 'Sucess');
    } catch (e) {
      text(res, 'Error: ' + e.message);
    }
  });

  // ---------- chart_score.php（ATE 各等级测试分数图表页） ----------
  app.all('/test/chart_score.php', (req, res) => {
    const rows = db().prepare("SELECT * FROM score WHERE team = 'ATE'").all();
    const levels = { basic: {}, standard: {}, advance: {}, professional: {} };
    const map = { Basic: 'basic', Standard: 'standard', Advance: 'advance', Professional: 'professional' };

    for (const r of rows) {
      const key = map[r.level];
      if (!key) continue;
      if (!levels[key][r.name]) levels[key][r.name] = [];
      levels[key][r.name].push(r.scores);
    }

    const page = L`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>ATE 測試分數</title>
<link rel="stylesheet" href="../layui/css/layui.css" media="all">
<script src="../js/jquery-1.7.2.js"></script>
<script src="../js/highcharts.js"></script>
<script src="../layui/layui.js"></script>
<!-- 本页由服务端生成并已翻译好，这里只加载语言切换按钮，不再翻译页面文字（避免误译数据） -->
<script>window.TE_I18N_NO_WALK = true;</script>
<script src="/js/i18n.js"></script>
</head>
<body class="layui-bg-gray">
<div class="layui-container" style="padding-top:15px;padding-bottom:15px">
  <div class="layui-card">
    <div class="layui-card-header">Basic 測試分數</div>
    <div class="layui-card-body"><div id="basic" style="height:400px"></div></div>
  </div>
  <div class="layui-card">
    <div class="layui-card-header">Standard 測試分數</div>
    <div class="layui-card-body"><div id="standard" style="height:400px"></div></div>
  </div>
  <div class="layui-card">
    <div class="layui-card-header">Advance 測試分數</div>
    <div class="layui-card-body"><div id="advance" style="height:400px"></div></div>
  </div>
  <div class="layui-card">
    <div class="layui-card-header">Professional 測試分數</div>
    <div class="layui-card-body"><div id="professional" style="height:400px"></div></div>
  </div>
</div>
<script>
${chartScript(levels)}
</script>
</body>
</html>`;
    text(res, page);
  });
};
