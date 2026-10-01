'use strict';
/**
 * 解析 phpMyAdmin 导出的 MySQL dump（localhost.sql），提取 INSERT 数据。
 * 仅用于首次运行时把原有数据导入 SQLite3。
 */

function unescapeMysql(str) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '\\' && i + 1 < str.length) {
      const n = str[++i];
      switch (n) {
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case '0': out += '\0'; break;
        case 'b': out += '\b'; break;
        case 'Z': out += '\x1a'; break;
        case "'": out += "'"; break;
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        default: out += n;
      }
    } else {
      out += ch;
    }
  }
  return out;
}

/** 在字符串之外按分隔符切分 */
function splitTopLevel(src, sep) {
  const parts = [];
  let buf = '';
  let inQuote = false;
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuote) {
      buf += ch;
      if (ch === '\\') { buf += src[++i] ?? ''; continue; }
      if (ch === "'") inQuote = false;
      continue;
    }
    if (ch === "'") { inQuote = true; buf += ch; continue; }
    if (ch === '(') { depth++; buf += ch; continue; }
    if (ch === ')') { depth--; buf += ch; continue; }
    if (ch === sep && depth === 0) { parts.push(buf); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim() !== '') parts.push(buf);
  return parts;
}

function parseScalar(tok) {
  const t = tok.trim();
  if (/^NULL$/i.test(t)) return null;
  if (t.startsWith("'")) return unescapeMysql(t.slice(1, -1));
  const n = Number(t);
  return Number.isNaN(n) ? t : n;
}

/** 解析 "(1,'a',NULL),(2,'b',3)" → [[...],[...]] */
function parseTuples(src) {
  const rows = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    while (i < n && src[i] !== '(') i++;
    if (i >= n) break;
    let depth = 0;
    let inQuote = false;
    const start = i;
    for (; i < n; i++) {
      const ch = src[i];
      if (inQuote) {
        if (ch === '\\') { i++; continue; }
        if (ch === "'") inQuote = false;
        continue;
      }
      if (ch === "'") { inQuote = true; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) { i++; break; }
      }
    }
    const body = src.slice(start + 1, i - 1);
    rows.push(splitTopLevel(body, ',').map(parseScalar));
  }
  return rows;
}

/**
 * @returns {Array<{table:string, columns:string[], rows:any[][]}>}
 */
function parseDump(sqlText) {
  const out = [];
  const re = /INSERT\s+INTO\s+`?([A-Za-z0-9_]+)`?\s*\(([^)]*)\)\s*VALUES/gi;
  let m;
  while ((m = re.exec(sqlText)) !== null) {
    const table = m[1];
    const columns = m[2]
      .split(',')
      .map((c) => c.trim().replace(/^`|`$/g, ''))
      .filter(Boolean);

    // 从 VALUES 之后读取到语句结束的分号（忽略字符串内的分号）
    let i = re.lastIndex;
    let inQuote = false;
    let end = -1;
    for (; i < sqlText.length; i++) {
      const ch = sqlText[i];
      if (inQuote) {
        if (ch === '\\') { i++; continue; }
        if (ch === "'") inQuote = false;
        continue;
      }
      if (ch === "'") { inQuote = true; continue; }
      if (ch === ';') { end = i; break; }
    }
    if (end === -1) end = sqlText.length;
    const valuesSrc = sqlText.slice(re.lastIndex, end);
    const rows = parseTuples(valuesSrc);
    re.lastIndex = end + 1;
    out.push({ table, columns, rows });
  }
  return out;
}

module.exports = { parseDump, parseTuples, parseScalar, unescapeMysql };
