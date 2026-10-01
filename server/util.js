'use strict';
/** 通用工具：对齐 PHP 常用函数行为 */

/** 类似 PHP htmlspecialchars（ENT_QUOTES） */
function h(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** PHP number_format($n, d) */
function numberFormat(n, d = 2) {
  const num = Number(n);
  if (!Number.isFinite(num)) return Number(0).toFixed(d);
  return num.toFixed(d);
}

/** PHP date('Y-m-d') */
function today() {
  return formatDate(new Date());
}

/** PHP date('Y-m-d H:i:s') */
function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${formatDate(d)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** PHP date('Y-m-d', strtotime("-N day")) */
function dayEarly(val, base) {
  const d = base ? new Date(base) : new Date();
  d.setDate(d.getDate() - Number(val));
  return formatDate(d);
}

/**
 * PHP 的 `date("Y-m-d", time())` 与 MySQL `now()` 在「写库」场景等价。
 * 这里统一返回 Y-m-d。
 */
function dbDate() {
  return today();
}

/** 解析前端提交的 name 字段（JSON 字符串，可能被 htmlspecialchars 转义） */
function parseNameField(body) {
  let raw = body && body.name;
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw === 'object') return raw;
  let s = String(raw);
  // 还原 htmlspecialchars 实体
  s = s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  try {
    return JSON.parse(s);
  } catch (e) {
    return {};
  }
}

/** 转义用于 SQL LIKE 的 % 和 _ */
function likeValue(v) {
  return String(v).replace(/[\\%_]/g, (m) => '\\' + m);
}

/** HTML 表格（统一使用 layui 表格样式） */
function gridTable(headers, rows, opts = {}) {
  const { tableId = 'tb-order', className = 'layui-table', extra = ' lay-even' } = opts;
  let out = `<table id='${tableId}' class='${className}'${extra}>`;
  out += '<tbody>';
  out += '<tr>';
  for (const hd of headers) {
    const label = typeof hd === 'string' ? hd : hd.label;
    const w = typeof hd === 'string' ? '' : hd.width;
    out += `<th style='width:${w || 'auto'}'>${label}</th>`;
  }
  out += '</tr>';
  for (const row of rows) {
    out += '<tr>';
    for (const cell of row) out += `<td>${cell}</td>`;
    out += '</tr>';
  }
  out += '</tbody>';
  out += '</table>';
  return out;
}

const NO_DATA = "<div class='layui-text' style='padding:15px;color:#999'>No Data</div>";

module.exports = {
  h,
  numberFormat,
  today,
  now,
  formatDate,
  dayEarly,
  dbDate,
  parseNameField,
  likeValue,
  gridTable,
  NO_DATA,
};
