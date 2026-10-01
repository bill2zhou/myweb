'use strict';
const { numberFormat, today, dayEarly, parseNameField } = require('../util');

/** PHP round($n, 2)（四舍五入，保留 2 位，输出数字而非字符串） */
function round2(n) {
  const num = Number(n) || 0;
  const sign = num < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(num) * 100) / 100;
}

/** 与 MySQL `now()` + DATE 列等价：只取日期 */
const dbNow = today;

/**
 * php/ 目录接口
 */
module.exports = function registerPhp(app, ctx) {
  const db = () => ctx.getDb();

  const okRes = (res) => res.type('text/html; charset=utf-8').send('Sucess');
  const errRes = (res, e) => res.type('text/html; charset=utf-8').send('Error: ' + e);

  // ---------- getuser.php（登录时取密码） ----------
  app.all('/php/getuser.php', (req, res) => {
    const q = req.query.q || '';
    req.session.q = q;
    const row = db().prepare('SELECT psn FROM users WHERE name = ?').get(q);
    res.type('text/html; charset=utf-8').send(row ? String(row.psn ?? '') : '');
  });

  // ---------- add.php（备品入库：manage.stock += stock） ----------
  app.all('/php/add.php', (req, res) => {
    const data = parseNameField(req.body);
    const q = req.query.q;
    try {
      const row = db().prepare('SELECT * FROM manage WHERE Id = ?').get(q);
      const mark = row ? `${today()}-${data.username}-${data.remark};${row.remark ?? ''}` : '';
      db().prepare('UPDATE manage SET date = ?, stock = stock + ?, remark = ? WHERE Id = ?')
        .run(dbNow(), Number(data.stock) || 0, mark, q);
      okRes(res);
    } catch (e) { errRes(res, e.message); }
  });

  // ---------- minus.php（备品出库：manage.stock -= quantily） ----------
  app.all('/php/minus.php', (req, res) => {
    const data = parseNameField(req.body);
    const q = req.query.q;
    try {
      const row = db().prepare('SELECT * FROM manage WHERE Id = ?').get(q);
      const mark = row ? `${today()}-${data.username}-${data.remark};${row.remark ?? ''}` : '';
      db().prepare('UPDATE manage SET date = ?, stock = stock - ?, remark = ? WHERE Id = ?')
        .run(dbNow(), Number(data.quantily) || 0, mark, q);
      okRes(res);
    } catch (e) { errRes(res, e.message); }
  });

  // ---------- stock.php（新增备品） ----------
  app.all('/php/stock.php', (req, res) => {
    const data = parseNameField(req.body);
    const date = today();
    try {
      if (!data.barcode) {
        db().prepare(
          'INSERT INTO manage (team,thing,model,date,stock,safestock,remark,tip) VALUES (?,?,?,?,?,?,?,?)'
        ).run(data.team, data.thing, data.model, date, data.stock, data.safestock, data.remark, data.tip);
      } else {
        db().prepare(
          'INSERT INTO manage (team,thing,barcode,model,date,stock,safestock,remark,tip) VALUES (?,?,?,?,?,?,?,?,?)'
        ).run(data.team, data.thing, data.barcode, data.model, date, data.stock, data.safestock, data.remark, data.tip);
      }
      okRes(res);
    } catch (e) { errRes(res, e.message); }
  });

  // ---------- probe.php（探针/治具入库） ----------
  app.all('/php/probe.php', (req, res) => {
    const data = parseNameField(req.body);
    try {
      const row = db().prepare('SELECT * FROM probe WHERE model = ?').get(data.model);
      const mark = row ? `${today()}-${data.remark};${row.remark ?? ''}` : '';
      db().prepare('UPDATE probe SET date = ?, stock = stock + ?, remark = ? WHERE model = ?')
        .run(dbNow(), Number(data.stock) || 0, mark, data.model);
      okRes(res);
    } catch (e) { errRes(res, e.message); }
  });

  // ---------- proben.php（探针/治具出库） ----------
  app.all('/php/proben.php', (req, res) => {
    const data = parseNameField(req.body);
    try {
      const row = db().prepare('SELECT * FROM probe WHERE model = ?').get(data.model);
      const mark = row ? `${today()}-${data.username}${data.remark};${row.remark ?? ''}` : '';
      db().prepare('UPDATE probe SET date = ?, stock = stock - ?, remark = ? WHERE model = ?')
        .run(dbNow(), Number(data.quantily) || 0, mark, data.model);
      okRes(res);
    } catch (e) { errRes(res, e.message); }
  });

  // ---------- from.php（新增维修记录） ----------
  app.all('/php/from.php', (req, res) => {
    const data = parseNameField(req.body);
    data.time = `${data.time ?? ''}mins`;
    try {
      if (!data.sn) {
        db().prepare(
          `INSERT INTO maintain (team, line, station, type, date, fa, reason, ca, fault, time, jiya, owner)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(
          data.team, data.line, data.station, data.type, data.date,
          data.fa, data.reason, data.ca, data.fault, data.time, data.jiya, data.owner
        );
      } else {
        // 原 PHP 此处列名 11 个、值 12 个（缺 jiya 列名），属笔误；这里按原值顺序补上 jiya 列
        db().prepare(
          `INSERT INTO maintain (team, line, station, type, date, fa, ca, fault, time, jiya, owner, sn)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(
          data.team, data.line, data.station, data.type, data.date,
          data.fa, data.ca, data.fault, data.time, data.jiya, data.owner, data.sn
        );
      }
      okRes(res);
    } catch (e) { errRes(res, e.message); }
  });

  // ---------- delet.php（删除维修记录） ----------
  app.all('/php/delet.php', (req, res) => {
    try {
      db().prepare('DELETE FROM maintain WHERE Id = ?').run(req.query.q);
      okRes(res);
    } catch (e) { errRes(res, e.message); }
  });

  // ---------- DailyFpy.php（首页每日良率 JSON） ----------
  app.all('/php/DailyFpy.php', (req, res) => {
    const Dates = today();
    const days = [1, 2, 3, 4, 5, 6, 7].map((n) => dayEarly(n, Dates));
    const day0 = days[0];

    // day_fpy：按日期汇总 fpy 表
    const dayFpy = (date) => {
      const rows = db().prepare('SELECT * FROM fpy WHERE date = ?').all(date);
      let sumT = 0, sumP = 0;
      for (const r of rows) { sumT += Number(r.total) || 0; sumP += Number(r.pass) || 0; }
      return numberFormat((sumP / (sumT + 0.01)) * 100, 2);
    };

    // Dev_fpy：原 PHP 遍历所有命中行并以最后一行为准
    const devFpy = (date, dev) => {
      const rows = db().prepare('SELECT * FROM fpy WHERE date = ? AND device = ?').all(date, dev);
      if (!rows.length) return [0, 0];
      const r = rows[rows.length - 1];
      return [Number(r.total) || 0, Number(r.pass) || 0];
    };

    const pairs = [
      ['a', '17'], ['b', '25'], ['c', '35'],
      ['d', '47', '48'], ['e', '55'], ['f', '65'],
      ['g', '75'], ['i', '85'],
    ];
    const lineFpy = pairs.map((grp) => {
      let t = 0, p = 0;
      for (const dev of grp) {
        const v = devFpy(day0, dev);
        t += v[0]; p += v[1];
      }
      return numberFormat((p / (t + 0.01)) * 100, 2);
    });

    const arr = {
      Dates: days,
      ATE: days.map(dayFpy),
      line_fpy: lineFpy,
    };
    res.type('application/json; charset=utf-8').send(JSON.stringify(arr));
  });

  // ---------- maintain.php（首页停机时间 JSON） ----------
  app.all('/php/maintain.php', (req, res) => {
    const Dates = today();
    const days = [1, 2, 3, 4, 5, 6, 7].map((n) => dayEarly(n, Dates));
    const start = days[6];
    const end = days[0];

    const stopTime = (name, line) => {
      const rows = db()
        .prepare('SELECT time, station, type FROM maintain WHERE team = ? AND line = ? AND date >= ? AND date <= ?')
        .all(name, line, start, end);
      let sum = 0, count = 0;
      for (const r of rows) {
        let t = parseInt(String(r.time ?? '').replace(/mins/g, ''), 10) || 0;
        if (/S\d_\d.*/.test(r.station || '')) t = t / 12;
        if (/ROUT.*/.test(r.station || '')) t = t / 2;
        if (/I3070.*/.test(r.type || '')) t = t / 2;
        sum += Math.trunc(t);
        count++;
      }
      return [sum, count, numberFormat(sum / 1440 / 7 * 85, 2)];
    };

    const lines = ['A', 'B', 'C', 'D', 'E', 'G', 'H', 'I'];
    const ate = {}, aoi = {}, ft = {};
    const cAte = {}, cAoi = {}, cFt = {};
    const vAte = {}, vAoi = {}, vFt = {};
    for (const L of lines) {
      const a = stopTime('ATE', L), o = stopTime('AOI', L), f = stopTime('FT', L);
      ate[L] = a[0]; aoi[L] = o[0]; ft[L] = f[0];
      cAte[L] = a[1]; cAoi[L] = o[1]; cFt[L] = f[1];
      vAte[L] = a[2]; vAoi[L] = o[2]; vFt[L] = f[2];
    }

    const arr = {
      Dates: days,
      ATE: ate, AOI: aoi, FT: ft,
      ATE_C: cAte, AOI_C: cAoi, FT_C: cFt,
      ATE_V: vAte, AOI_V: vAoi, FT_V: vFt,
    };
    res.type('application/json; charset=utf-8').send(JSON.stringify(arr));
  });

  // ---------- get_downtime_data.php（停机率看板 JSON） ----------
  app.all('/php/get_downtime_data.php', (req, res) => {
    const DAILY_TOTAL = 19000;

    // 近一年（365 天）的停线时间：后出现的记录覆盖前面的（PHP 关联数组行为）
    const cutoff = dayEarly(365, today());
    const map = new Map();
    const rows = db()
      .prepare("SELECT date, jiya FROM maintain WHERE team = 'ATE' AND date >= ? ORDER BY date ASC")
      .all(cutoff);
    for (const r of rows) map.set(String(r.date), Number(r.jiya) || 0);

    const dailyData = [];
    for (let i = 364; i >= 0; i--) {
      const dateStr = dayEarly(i, today());
      const jiya = map.has(dateStr) ? map.get(dateStr) : 0;
      dailyData.push({
        date: dateStr,
        jiya,
        rate: DAILY_TOTAL > 0 ? round2((jiya / DAILY_TOTAL) * 100) : 0,
      });
    }

    const calcAvgRate = (list) => {
      if (!list.length) return 0;
      let totalJiya = 0;
      for (const it of list) totalJiya += it.jiya;
      const count = list.length;
      let totalPlanned = count * DAILY_TOTAL;
      if (count === 7) totalPlanned = 19000 * 5;
      if (count > 20 && count < 35) totalPlanned = 19000 * 22;
      if (count > 350) totalPlanned = 19000 * 261;
      if (totalPlanned === 0) return 0;
      return round2((totalJiya / totalPlanned) * 100);
    };

    const last7 = dailyData.slice(-7);
    const last30 = dailyData.slice(-30);

    const monthMap = new Map();
    for (const it of dailyData) {
      const key = it.date.slice(0, 7);
      if (!monthMap.has(key)) monthMap.set(key, []);
      monthMap.get(key).push(it);
    }
    const monthKeys = [...monthMap.keys()].slice(-12);

    const yearLabels = [];
    const yearValues = [];
    let yearJiyaSum = 0, yearDayCount = 0;
    for (const key of monthKeys) {
      const items = monthMap.get(key);
      yearLabels.push(key);
      yearValues.push(calcAvgRate(items));
      for (const it of items) { yearJiyaSum += it.jiya; yearDayCount++; }
    }
    const yearPlanned = yearDayCount * DAILY_TOTAL;
    const yearAvg = yearPlanned > 0 ? round2((yearJiyaSum / yearPlanned) * 100) : 0;

    res.type('application/json; charset=utf-8').send(JSON.stringify({
      status: 'success',
      data: {
        week: { labels: last7.map((i) => i.date), values: last7.map((i) => i.rate), avg: calcAvgRate(last7) },
        month: { labels: last30.map((i) => i.date), values: last30.map((i) => i.rate), avg: calcAvgRate(last30) },
        year: { labels: yearLabels, values: yearValues, avg: yearAvg },
      },
    }));
  });
};
