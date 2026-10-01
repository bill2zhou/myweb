/**
 * 多语言核心引擎（浏览器与 Node 共用同一份代码）
 *
 * 设计要点：
 *   词典以「中文短语」为键，翻译时按中文短语整段匹配替换，
 *   绝不会碰夹在两个中文短语中间的数据（由 ${...} 插值或字符串拼接传入）。
 *   例：L`<th>序号</th>`  → 只翻译 "序号"；`T('表不存在：') + name` → 只翻译前半段。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TE_I18N_CORE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /** 支持的语言（zh 为中文原文，无需词典） */
  const LANGS = ['zh', 'en', 'vi'];
  const DEFAULT_LANG = 'zh';
  const LANG_LABEL = { zh: '简体中文', en: 'English', vi: 'Tiếng Việt' };

  /* 连续的中日韩文字 + 紧邻的中文标点，视为一个「可翻译单元」 */
  const IDEO = '\u3400-\u4dbf\u4e00-\u9fff';
  const CPUNCT = '\u3000-\u303f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65';
  const RUN_RE = new RegExp('[' + IDEO + '][' + IDEO + CPUNCT + ']*', 'g');
  const TRAIL_RE = new RegExp('[' + CPUNCT + ']+$');
  const HAS_HAN_RE = new RegExp('[' + IDEO + ']');

  /** 中文全角标点 → 半角（只用于「词典没有收录带标点的整串」时的兜底） */
  const PUNCT_MAP = {
    '：': ':', '，': ',', '。': '.', '？': '?', '！': '!', '、': ',', '；': ';',
    '（': '(', '）': ')', '「': '"', '」': '"', '『': "'", '』': "'",
    '…': '...', '～': '~', '《': '<', '》': '>', '　': ' ',
  };

  function halfwidth(str) {
    return String(str).replace(/[^\u0000-\u00ff]/g, (c) => (
      PUNCT_MAP[c] !== undefined ? PUNCT_MAP[c] : c
    ));
  }

  function hasHan(text) {
    return HAS_HAN_RE.test(String(text));
  }

  function normalizeLang(v) {
    const s = String(v || '').trim().toLowerCase().slice(0, 2);
    if (s === 'zh' || s === 'cn' || s === 'zh-cn') return 'zh';
    if (s === 'en') return 'en';
    if (s === 'vi' || s === 'vn') return 'vi';
    return DEFAULT_LANG;
  }

  /** 把一个字符串中的中文短语逐段翻译（数据部分不会匹配到词典，原样保留） */
  function makeTranslator(dicts) {
    return function translate(text, lang) {
      if (text === null || text === undefined) return text;
      const L = normalizeLang(lang);
      if (L === DEFAULT_LANG) return String(text);
      const d = dicts[L];
      if (!d) return String(text);
      const s = String(text);
      if (!hasHan(s)) return s;

      // 1) 整串精确匹配：可处理「含数字/符号」的短语，如 "周趋势 (近7天)"
      if (Object.prototype.hasOwnProperty.call(d, s)) return d[s];
      const trimmed = s.trim();
      if (trimmed !== s && Object.prototype.hasOwnProperty.call(d, trimmed)) {
        return s.replace(trimmed, d[trimmed]);
      }

      // 2) 按中文短语逐段替换（夹在中间的引用数据不会被误译）
      return s.replace(RUN_RE, (run) => {
        if (Object.prototype.hasOwnProperty.call(d, run)) return d[run];
        // 兜底：去掉尾部中文标点再查一次，标点转半角
        const core = run.replace(TRAIL_RE, '');
        if (core && Object.prototype.hasOwnProperty.call(d, core)) {
          return d[core] + halfwidth(run.slice(core.length));
        }
        return run;
      });
    };
  }

  return {
    LANGS,
    DEFAULT_LANG,
    LANG_LABEL,
    RUN_RE,
    PUNCT_MAP,
    halfwidth,
    hasHan,
    normalizeLang,
    makeTranslator,
  };
});
