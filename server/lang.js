'use strict';
/**
 * 服务端多语言支持
 *
 * 语言来源（优先级）：
 *   1. URL 上的 ?lang=vi       （会同时写入 Cookie，下次访问仍生效）
 *   2. Cookie TELANG=vi
 *   3. 默认 zh（简体中文）
 *
 * 用法：
 *   在路由里用 T('表不存在：') 翻译「字面量」，用 L`<th>序号</th>${data}` 翻译模板。
 *   L 只会翻译模板里的固定文字，${...} 插入的数据原样保留，绝不会被误译。
 */
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const core = require('./i18n-core');
const EN = require('./lang-en');
const VI = require('./lang-vi');

const DICTS = { en: EN, vi: VI };
const translate = core.makeTranslator(DICTS);
const COOKIE_NAME = 'TELANG';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const als = new AsyncLocalStorage();

/** 当前请求的语言（不在请求上下文时返回默认语言） */
function getLang() {
  const store = als.getStore();
  return (store && store.lang) || core.DEFAULT_LANG;
}

/** 翻译一个字面量 */
function T(text) {
  return translate(text, getLang());
}

/** 翻译模板字符串的固定文字部分（${...} 插值不受影响） */
function L(strings) {
  const values = Array.prototype.slice.call(arguments, 1);
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += translate(strings[i], getLang());
    if (i < values.length) out += values[i];
  }
  return out;
}

/** 在指定语言上下文里执行（供脚本/测试使用） */
function runWith(lang, fn) {
  return als.run({ lang: core.normalizeLang(lang) }, fn);
}

/** 从请求里解析语言 */
function langFromReq(req) {
  const q = req.query && req.query.lang;
  if (q) return core.normalizeLang(q);
  const raw = req.headers && req.headers.cookie;
  if (raw) {
    const m = /(?:^|;\s*)TELANG=([^;]*)/.exec(raw);
    if (m) return core.normalizeLang(decodeURIComponent(m[1]));
  }
  return core.DEFAULT_LANG;
}

/** Express 中间件：为每个请求绑定语言 */
function middleware() {
  return function teLang(req, res, next) {
    const lang = langFromReq(req);
    // ?lang=xx 时写回 Cookie，实现「切换后记住」
    if (req.query && req.query.lang) {
      res.cookie(COOKIE_NAME, lang, {
        path: '/', maxAge: COOKIE_MAX_AGE * 1000, httpOnly: false, sameSite: 'lax',
      });
    }
    res.setHeader('Content-Language', lang === 'zh' ? 'zh-CN' : lang);
    als.run({ lang }, () => next());
  };
}

/** 生成浏览器端脚本：核心引擎 + 词典 + 当前语言 */
function clientScript(rootDir) {
  const coreSrc = fs.readFileSync(path.join(__dirname, 'i18n-core.js'), 'utf8');
  const boot = [
    ';(function(){',
    '  var core = (typeof module === "object" && module.exports)',
    '    ? module.exports : window.TE_I18N_CORE;',
    '  window.TE_I18N = {',
    '    langs: ' + JSON.stringify(core.LANGS) + ',',
    '    labels: ' + JSON.stringify(core.LANG_LABEL) + ',',
    '    dict: ' + JSON.stringify(DICTS) + ',',
    '    lang: ' + JSON.stringify(getLang()) + ',',
    '    translate: core.makeTranslator(' + JSON.stringify(DICTS) + '),',
    '  };',
    '})();',
  ].join('\n');

  let runtime = '';
  const runtimeFile = path.join(rootDir, 'js', 'i18n-runtime.js');
  try {
    runtime = fs.readFileSync(runtimeFile, 'utf8');
  } catch (e) {
    runtime = '/* 缺少 js/i18n-runtime.js */';
  }
  return coreSrc + '\n' + boot + '\n' + runtime + '\n';
}

module.exports = {
  COOKIE_NAME,
  LANGS: core.LANGS,
  LANG_LABEL: core.LANG_LABEL,
  DEFAULT_LANG: core.DEFAULT_LANG,
  getLang,
  T,
  L,
  translate,
  runWith,
  langFromReq,
  middleware,
  clientScript,
};
