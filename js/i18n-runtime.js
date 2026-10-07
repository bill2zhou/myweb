/**
 * 多语言 - 浏览器端运行时
 *
 * 由服务端路由 /js/i18n.js 拼装后下发（前面已注入引擎与词典，见 window.TE_I18N）。
 * 职责：
 *   1. 页面载入后自动翻译静态界面文字（含 placeholder/title 等属性）—— 只处理页面自带文字，
 *      接口返回的 HTML 已由服务端翻译好，不会被二次处理，也不会误译数据。
 *   2. 接管 layer 弹窗与 jQuery 纯文本写入，使脚本里写死的中文也能翻译。
 *   3. 右下角提供语言切换按钮，选择结果记录在 Cookie TELANG，全站生效。
 */
(function () {
  'use strict';

  var TE = window.TE_I18N;
  if (!TE || typeof TE.translate !== 'function') return;

  var HAN = /[\u3400-\u4dbf\u4e00-\u9fff]/;
  var COOKIE = 'TELANG';
  var LANG = TE.lang || 'zh';

  function t(s) {
    if (typeof s !== 'string' || !HAN.test(s)) return s;
    var out = TE.translate(s, LANG);
    return out;
  }

  /** 供页面显式调用，翻译脚本里拼出来的文字（如 T('新增行')） */
  TE.t = t;

  /* ==================== 1. 静态界面文字 ==================== */

  /** 需要跟随语言变化的属性（value 仅处理按钮类，避免把数据译掉） */
  function translateAttrs(el) {
    var tag = el.tagName;
    ['placeholder', 'title', 'alt', 'data-title', 'data-tip'].forEach(function (name) {
      var v = el.getAttribute && el.getAttribute(name);
      if (v && HAN.test(v)) el.setAttribute(name, t(v));
    });
    if (tag === 'INPUT') {
      var type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'button' || type === 'submit' || type === 'reset') {
        var val = el.getAttribute('value');
        if (val && HAN.test(val)) el.setAttribute('value', t(val));
      }
    }
  }

  function walk(node) {
    if (!node) return;
    if (node.nodeType === 3) {
      var v = node.nodeValue;
      if (v && HAN.test(v)) {
        var out = t(v);
        if (out !== v) node.nodeValue = out;
      }
      return;
    }
    if (node.nodeType !== 1) return;
    var tag = node.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'META') return;
    translateAttrs(node);
    var kids = node.childNodes;
    for (var i = 0; i < kids.length; i++) walk(kids[i]);
  }

  /* ==================== 2. 弹窗与动态文本 ==================== */

  /** 形如 xxx.html?q=1 的路径是「引用外部页面」，不能当文字翻译 */
  function isUrlLike(s) {
    return /^\s*[\w./-]+\.(html?|php|json|js|css)(\?|#|$)/i.test(s);
  }

  function translateOptions(opt) {
    if (!opt || typeof opt !== 'object') return opt;
    if (typeof opt.title === 'string') opt.title = t(opt.title);
    if (Object.prototype.toString.call(opt.btn) === '[object Array]') {
      opt.btn = opt.btn.map(function (b) { return t(b); });
    }
    // 弹窗内容：本页自己拼的 HTML 需要翻译；作为 iframe 地址的路径要原样保留
    if (typeof opt.content === 'string' && !isUrlLike(opt.content)) {
      opt.content = t(opt.content);
    }
    return opt;
  }

  function patchLayer() {
    var layer = window.layui && window.layui.layer;
    if (!layer || layer.__tePatched) return;
    layer.__tePatched = true;

    ['msg', 'alert', 'confirm', 'tips', 'prompt', 'load', 'open', 'close'].forEach(function (name) {
      var orig = layer[name];
      if (typeof orig !== 'function') return;
      layer[name] = function () {
        var args = Array.prototype.slice.call(arguments);
        if (typeof args[0] === 'string') {
          args[0] = t(args[0]);
        } else if (args[0] && typeof args[0] === 'object') {
          translateOptions(args[0]);
        }
        if (name === 'alert' || name === 'confirm') {
          if (args[1] && typeof args[1] === 'object') translateOptions(args[1]);
        }
        return orig.apply(this, args);
      };
    });
  }

  function patchGlobalDialogs() {
    ['alert', 'confirm', 'prompt'].forEach(function (name) {
      var orig = window[name];
      if (typeof orig !== 'function' || orig.__tePatched) return;
      var wrapped = function (msg) {
        var args = Array.prototype.slice.call(arguments);
        if (typeof args[0] === 'string') args[0] = t(args[0]);
        return orig.apply(window, args);
      };
      wrapped.__tePatched = true;
      window[name] = wrapped;
    });
  }

  function patchJQuery() {
    // layui 自带一份 jQuery（layui.$），页面里的 $ 通常就是它；
    // 它要等 layui.use 加载完 jquery 模块后才存在，所以这里逐个补打补丁。
    [window.jQuery, window.$, window.layui && window.layui.$].forEach(patchJQueryInstance);
  }

  function patchJQueryInstance($) {
    if (!$ || !$.fn || $.fn.__tePatched) return;
    $.fn.__tePatched = true;
    ['html', 'text', 'append', 'prepend', 'before', 'after'].forEach(function (name) {
      var orig = $.fn[name];
      if (typeof orig !== 'function') return;
      $.fn[name] = function (v) {
        if (typeof v === 'string' && HAN.test(v) && v.indexOf('<') === -1) {
          var args = Array.prototype.slice.call(arguments);
          args[0] = t(v);
          return orig.apply(this, args);
        }
        return orig.apply(this, arguments);
      };
    });

    // 页面片段（如 rate.html）是动态 load 进来的，载入完成后补翻一次
    var origLoad = $.fn.load;
    if (typeof origLoad === 'function') {
      $.fn.load = function () {
        var args = Array.prototype.slice.call(arguments);
        if (!args.length || typeof args[0] !== 'string') {
          return origLoad.apply(this, args);
        }
        var self = this;
        var cbIndex = -1;
        for (var i = args.length - 1; i > 0; i--) {
          if (typeof args[i] === 'function') { cbIndex = i; break; }
        }
        var wrapped = function () {
          walk(self[0]);
          if (cbIndex > 0) return args[cbIndex].apply(this, arguments);
        };
        if (cbIndex > 0) args[cbIndex] = wrapped;
        else args.push(wrapped);
        return origLoad.apply(this, args);
      };
    }
  }

  /** 在页面调用 layui.use 时先打好补丁，保证页面自己的回调拿到的是打过补丁的 layer */
  function hookLayuiUse() {
    var layui = window.layui;
    if (!layui || typeof layui.use !== 'function' || layui.__teHooked) return;
    layui.__teHooked = true;
    var origUse = layui.use;
    layui.use = function (mods, fn) {
      if (typeof fn === 'function') {
        var wrapped = function () {
          // 此时 layui 的 layer / jquery 都就绪了，补打补丁后再执行页面回调
          patchLayer();
          patchJQuery();
          return fn.apply(this, arguments);
        };
        return origUse.call(layui, mods, wrapped);
      }
      return origUse.apply(layui, arguments);
    };
  }

  /* ==================== 3. 语言切换按钮 ==================== */

  var CSS = [
    '#te-lang-sw{position:fixed;right:12px;bottom:12px;z-index:2147483000;font:12px/1.5 -apple-system,',
    '"Segoe UI","Microsoft YaHei",Arial,sans-serif;text-align:right;-webkit-user-select:none;user-select:none}',
    '#te-lang-cur{cursor:pointer;display:inline-block;padding:4px 10px;border-radius:14px;',
    'background:rgba(57,61,73,.82);color:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25)}',
    '#te-lang-cur:hover{background:rgba(57,61,73,1)}',
    '#te-lang-menu{display:none;margin-bottom:6px;background:#fff;border-radius:4px;overflow:hidden;',
    'box-shadow:0 2px 10px rgba(0,0,0,.2)}',
    '#te-lang-menu.on{display:block}',
    '#te-lang-menu a{display:block;padding:6px 16px;color:#333;text-decoration:none;white-space:nowrap}',
    '#te-lang-menu a:hover{background:#f2f2f2}',
    '#te-lang-menu a.act{color:#16baaa;font-weight:bold}',
    '@media print{#te-lang-sw{display:none}}',
  ].join('');

  function switchLang(lang) {
    var d = new Date();
    d.setTime(d.getTime() + 365 * 24 * 3600 * 1000);
    document.cookie = COOKIE + '=' + encodeURIComponent(lang) + ';path=/;expires=' + d.toUTCString();
    // 用 ?lang= 再走一次服务端，确保本次立即生效并写回 Cookie
    var url = location.pathname + location.search;
    var sep = url.indexOf('?') === -1 ? '?' : '&';
    url = url.replace(/[?&]lang=[^&]*/g, '').replace(/[?&]$/, '');
    sep = url.indexOf('?') === -1 ? '?' : '&';
    location.href = url + sep + 'lang=' + encodeURIComponent(lang);
  }

  /** 页面被别的页面嵌着时（如 main.html 的内部窗口），不再画切换按钮，交给外层外壳 */
  function embedded() {
    try { return window.self !== window.top; } catch (e) { return true; }
  }

  function buildSwitcher() {
    if (embedded()) return;
    if (document.getElementById('te-lang-sw')) return;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var langs = TE.langs || ['zh', 'en', 'vi'];
    var labels = TE.labels || {};
    var box = document.createElement('div');
    box.id = 'te-lang-sw';

    var menu = document.createElement('div');
    menu.id = 'te-lang-menu';
    langs.forEach(function (l) {
      var a = document.createElement('a');
      a.href = 'javascript:;';
      a.setAttribute('data-lang', l);
      a.textContent = labels[l] || l;
      if (l === LANG) a.className = 'act';
      a.onclick = function () {
        if (l === LANG) { menu.className = ''; return; }
        switchLang(l);
      };
      menu.appendChild(a);
    });

    var cur = document.createElement('div');
    cur.id = 'te-lang-cur';
    cur.title = 'Display language / 显示语言 / Ngôn ngữ';
    cur.textContent = labels[LANG] || LANG;
    cur.onclick = function () { menu.className = menu.className ? '' : 'on'; };

    box.appendChild(menu);
    box.appendChild(cur);
    document.body.appendChild(box);

    document.addEventListener('click', function (e) {
      if (!box.contains(e.target)) menu.className = '';
    });
  }

  /* ==================== 启动 ==================== */

  // 服务端生成的页面（内容已翻译好）只显示切换按钮，不翻译页面文字，避免误译其中的数据
  function walkAllowed() {
    return !window.TE_I18N_NO_WALK;
  }

  function boot() {
    patchLayer();
    patchGlobalDialogs();
    patchJQuery();
    if (walkAllowed()) walk(document.documentElement);
  }

  // head 中即刻执行，尽可能早地接管 jQuery / layer
  hookLayuiUse();
  patchGlobalDialogs();
  patchJQuery();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      boot();
      buildSwitcher();
    });
  } else {
    boot();
    buildSwitcher();
  }
  // layui 会在 DOMContentLoaded 之后才异步加载 layer，这里再补一次
  window.addEventListener('load', function () {
    patchLayer();
    if (walkAllowed()) walk(document.body);
  });
})();
