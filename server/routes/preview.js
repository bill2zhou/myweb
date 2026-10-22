'use strict';
/**
 * 「测试资料查询」页面的文件内容预览接口：/file?path=<完整路径>
 *
 * 页面里 Everything 搜到的文件在 D:\… / H:\… / \\共享\… 这类路径上，浏览器不能直接读，
 * 由本服务按完整路径读取后回传（与 search/web-proxy/proxy.js 的 /file 行为一致）：
 *   · 文本：UTF-8 优先，不是合法 UTF-8 就按 GBK/GB18030 解码（现场 txt 多为 GBK）
 *   · 图片：webp / png / jpg / gif / bmp 等按 MIME 直出
 *
 * 只接受绝对路径，且只允许白名单扩展名，避免被当成任意文件读取器。
 * 环境变量：FILE_PREFIX / FILE_MAX_TEXT / FILE_MAX_IMAGE
 */

const fs = require('fs');
const path = require('path');

function envStr(name, dflt) {
  return process.env[name] === undefined || process.env[name] === '' ? dflt : process.env[name];
}

const CFG = {
  prefix: envStr('FILE_PREFIX', '/file'),
  maxTextBytes: Number(envStr('FILE_MAX_TEXT', 8 * 1024 * 1024)),
  maxImageBytes: Number(envStr('FILE_MAX_IMAGE', 40 * 1024 * 1024)),
  textExts: ['.txt', '.log', '.csv', '.json', '.xml', '.ini', '.md', '.text',
             '.cfg', '.conf', '.yml', '.yaml', '.sql', '.dat', '.htm', '.html',
             '.bat', '.ps1', '.js', '.css'],
  imageExts: ['.webp', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.avif'],
};

const MIME = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
};

/** 文本编码：UTF-8 优先，失败再按 GBK/GB18030 */
function decodeText(buf) {
  let b = buf;
  if (b.length > 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) b = b.subarray(3);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch (e) { /* 不是 UTF-8 */ }
  try {
    return new TextDecoder('gb18030').decode(b);
  } catch (e) { /* 运行时没有 GBK 支持 */ }
  return b.toString('utf8');
}

/** 只接受绝对路径：Windows 盘符 / UNC 共享，其它平台以 / 开头 */
function resolveTargetPath(raw) {
  const s = String(raw || '').trim();
  if (!s || s.indexOf('\0') !== -1) return null;
  if (process.platform === 'win32') {
    if (/^[a-z]:[\\/]/i.test(s) || /^\\\\[^\\]/.test(s)) return path.win32.normalize(s);
    return null;
  }
  return s[0] === '/' ? path.normalize(s) : null;
}

function fail(res, code, msg) {
  res.set('Cache-Control', 'no-store');
  return res.status(code).type('text/plain; charset=utf-8').send(msg);
}

module.exports = function registerFilePreview(app) {
  app.get(CFG.prefix, (req, res) => {
    const target = resolveTargetPath(req.query.path);
    if (!target) {
      return fail(res, 400, '缺少 path 参数或不是绝对路径（需形如 D:\\资料\\a.txt 或 \\\\server\\share\\a.txt）');
    }

    let st;
    try {
      st = fs.statSync(target);
    } catch (e) {
      return fail(res, 404, '文件不存在或无权访问：' + target);
    }
    if (st.isDirectory()) return fail(res, 400, '目标是文件夹，无法预览：' + target);

    const ext = path.extname(target).toLowerCase();
    res.set('Cache-Control', 'no-store');

    if (CFG.textExts.indexOf(ext) !== -1) {
      if (st.size > CFG.maxTextBytes) {
        return fail(res, 413, '文件过大（' + st.size + ' 字节，上限 ' + CFG.maxTextBytes + '）：' + target);
      }
      let buf;
      try {
        buf = fs.readFileSync(target);
      } catch (e) {
        return fail(res, 500, '读取失败：' + e.message);
      }
      return res.type('text/plain; charset=utf-8').send(decodeText(buf));
    }

    if (CFG.imageExts.indexOf(ext) !== -1) {
      if (st.size > CFG.maxImageBytes) {
        return fail(res, 413, '图片过大（' + st.size + ' 字节，上限 ' + CFG.maxImageBytes + '）：' + target);
      }
      res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
      res.setHeader('Content-Length', st.size);
      return fs.createReadStream(target).on('error', () => res.end()).pipe(res);
    }

    return fail(res, 415,
      '该类型不支持预览（仅 ' + CFG.textExts.concat(CFG.imageExts).join(' ') + '）：' + target);
  });
};

module.exports.CFG = CFG;
