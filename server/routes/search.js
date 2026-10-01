'use strict';
const { T, L } = require('../lang');
const fs = require('fs');
const path = require('path');

/**
 * search/read.php：基于测试日志文件的条码检索。
 * 日志根目录可通过环境变量 ATE_TEST_DATA 配置，默认 D:/ATE_Test_data/DailyFPY
 */
module.exports = function registerSearch(app, ctx) {
  const ROOT = process.env.ATE_TEST_DATA || 'D:\\ATE_Test_data\\DailyFPY';

  /** 递归查找同名文件（对应 PHP 的 glob 目录 + 通配） */
  function scanDir(dir, fileName, out) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        scanDir(full, fileName, out);
      } else if (e.name === fileName) {
        out.push(full);
      }
    }
  }

  /** 与 PHP date("F-d-Y--H:i:s.") 等价的英文月份格式 */
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  function phpFileTime(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${MONTHS[d.getMonth()]}-${p(d.getDate())}-${d.getFullYear()}--${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.`;
  }

  app.all('/search/read.php', (req, res) => {
    const q = req.query.q || '';
    req.session.q = q;
    const varArr = String(q).split(',');
    const team = varArr[0], line = varArr[1], date = varArr[2], sn = varArr[3];

    if (!sn) return res.type('text/html; charset=utf-8').send(T('...请输入条码...'));

    let out = `Team:${team} Date:${date} Line:${line} Sn:${sn}`;
    // 目录名：2026-09-30 → 260930
    const dateN = date ? date.slice(2, 4) + date.slice(5, 7) + date.slice(8, 10) : '';
    // 线别首字母小写（PHP lcfirst）
    const lineN = line ? line.charAt(0).toLowerCase() + line.slice(1) : '';

    out += '<hr>';
    const fileN = `${sn}.txt`;

    const matches = [];
    if (dateN) {
      if (lineN && lineN !== 'ALL') scanDir(path.join(ROOT, dateN, lineN), fileN, matches);
      else scanDir(path.join(ROOT, dateN), fileN, matches);
    }
    out += '<hr>';

    for (const f of matches) {
      let stat;
      try { stat = fs.statSync(f); } catch (e) { continue; }
      out += `${f}--${phpFileTime(stat.mtime)}<hr>`;
      if (stat.size === 0) {
        out += 'PASS<hr>';
      } else {
        out += 'FAIL<hr>';
        try {
          const content = fs.readFileSync(f, 'utf8');
          out += '<p align="left">';
          for (const line of content.split(/\r?\n/)) out += `${line}<br>`;
          out += '</p>';
        } catch (e) { /* ignore */ }
      }
    }

    // 线别为 ALL 时，额外列出当日目录下的日志文件（原 PHP 行为）
    if (lineN === 'ALL' && dateN) {
      const dir = path.join(ROOT, dateN);
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isFile()) continue;
          const full = path.join(dir, e.name);
          let stat;
          try { stat = fs.statSync(full); } catch (err) { continue; }
          out += `${full}<hr>`;
          if (stat.size === 0) out += 'PASS<hr>';
          else out += 'FAIL<hr>';
        }
      } catch (e) { /* 目录不存在则忽略 */ }
    }

    res.type('text/html; charset=utf-8').send(out);
  });
};
