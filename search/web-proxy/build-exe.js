#!/usr/bin/env node
'use strict';
/**
 * 把 proxy.js 打包成单个 Windows exe（Node 官方 SEA 方案，目标机器无需安装 Node）
 *
 * 用法：
 *   node build-exe.js                      → dist/测试资料查询代理.exe
 *   node build-exe.js --name BomProxy.exe  → 自定义 exe 文件名
 *
 * 说明：
 *   · 页面文件（../index.html 等）会内嵌进 exe，单独拷走 exe 也能用；
 *     exe 同目录若存在 index.html，则优先使用同目录的文件（方便现场改页面）。
 *   · 接口地址、Everything 地址等仍由页面里的「设置」决定，也可用环境变量覆盖：
 *     PORT / FMDI_TARGET / EVERYTHING_TARGET / EVERYTHING_USER / EVERYTHING_PASS
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const BUILD = path.join(DIST, '.build');
const ASSETS = path.join(BUILD, 'assets');
const CACHE_DIR = path.join(ROOT, '.cache');
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const exeName = (() => {
  const i = process.argv.indexOf('--name');
  return (i !== -1 && process.argv[i + 1]) ? process.argv[i + 1] : '测试资料查询代理.exe';
})();

/* 内嵌资源：key（页面里的访问路径）→ 源文件 */
const PAGES = [
  ['index.html', path.join(ROOT, '..', 'index.html')],
  ['search.html', path.join(ROOT, '..', 'search.html')],
  ['search/search.html', path.join(ROOT, '..', 'search', 'search.html')]
];

function log(...a) { console.log('[*]', ...a); }
function fail(msg) { console.error('[错误] ' + msg); process.exit(1); }
function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

function main() {
  if (Number(process.versions.node.split('.')[0]) < 20) {
    fail('本机 Node.js 版本过低（需要 20 及以上），当前 ' + process.version);
  }

  rmrf(DIST);
  fs.mkdirSync(ASSETS, { recursive: true });

  /* 1) 收集要内嵌的页面 */
  const assets = {};
  for (const [key, src] of PAGES) {
    if (!fs.existsSync(src)) continue;
    const target = path.join(ASSETS, key.replace(/\//g, '__'));
    fs.copyFileSync(src, target);
    assets[key] = target;
    log('内嵌页面 ' + key + '  ←  ' + path.relative(ROOT, src));
  }
  if (!Object.keys(assets).length) {
    fail('没找到页面文件（' + PAGES.map(p => path.relative(ROOT, p[1])).join(' / ') + '），无法打包');
  }

  /* 2) 生成 SEA 配置并生成 blob */
  const configPath = path.join(BUILD, 'sea-config.json');
  const blobPath = path.join(BUILD, 'sea-prep.blob');
  fs.writeFileSync(configPath, JSON.stringify({
    main: path.join(ROOT, 'proxy.js'),
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets: assets
  }, null, 2));

  log('生成 SEA blob（main: proxy.js）...');
  execFileSync(process.execPath, ['--experimental-sea-config', configPath], { cwd: ROOT, stdio: 'inherit' });
  if (!fs.existsSync(blobPath)) fail('未生成 ' + blobPath);

  /* 3) 用本机 node.exe 复制一份，并把 blob 注入进去 */
  const exePath = path.join(DIST, 'app.exe');
  log('复制 Node 运行时: ' + process.execPath);
  fs.copyFileSync(process.execPath, exePath);

  const postject = ensurePostject();
  log('注入 SEA blob 到 exe ...');
  execFileSync(process.execPath, [
    postject, exePath, 'NODE_SEA_BLOB', blobPath, '--sentinel-fuse', FUSE
  ], { cwd: ROOT, stdio: 'inherit' });

  /* 4) 改名为最终文件名 */
  const finalPath = path.join(DIST, exeName);
  if (fs.existsSync(finalPath)) fs.rmSync(finalPath);
  fs.renameSync(exePath, finalPath);
  rmrf(BUILD);

  const size = (fs.statSync(finalPath).size / 1024 / 1024).toFixed(1);
  console.log('');
  log('打包完成: ' + finalPath + '（' + size + ' MB）');
  log('把该 exe 拷到目标机器双击即可运行，浏览器会自动打开 http://127.0.0.1:8080/');
  log('页面设置：接口地址填 /fmdi，Everything 地址填 /everything');
}

/* 构建期工具 postject：已经装了就直接用，否则现装一次（会缓存到 .cache） */
function ensurePostject() {
  try {
    return require.resolve('postject/dist/cli.js');
  } catch (e) { /* 继续安装 */ }

  const cached = path.join(CACHE_DIR, 'node_modules', 'postject', 'dist', 'cli.js');
  if (fs.existsSync(cached)) return cached;

  log('首次打包，安装构建工具 postject（仅打包用，不影响 exe 运行）...');
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  try {
    execSync('npm install --no-audit --no-fund --loglevel=error postject@latest', {
      cwd: CACHE_DIR, stdio: 'inherit'
    });
  } catch (e) {
    fail('安装 postject 失败，请检查网络后重试（或手动执行：npm i -D postject）');
  }
  if (!fs.existsSync(cached)) fail('安装 postject 后仍未找到 ' + cached);
  return cached;
}

main();
