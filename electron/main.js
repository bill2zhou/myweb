'use strict';
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, shell, Tray, Menu, nativeImage, session } = require('electron');
const { initDatabase, closeDatabase } = require('../server/db');
const { startServer } = require('../server/index');
const { lanAddresses } = require('../server/config');

/**
 * 解析网页源码目录（HTML/CSS/JS 等可后期手工调整的部分）
 *  - 打包后：安装目录下的 resources\web（明文源码，可直接编辑）
 *  - 也支持用环境变量 TE_WEB_ROOT 指向任意目录
 *  - 开发环境：项目根目录
 */
function resolveWebRoot() {
  if (process.env.TE_WEB_ROOT && fs.existsSync(process.env.TE_WEB_ROOT)) {
    return process.env.TE_WEB_ROOT;
  }
  if (app.isPackaged) {
    const external = path.join(process.resourcesPath, 'web');
    if (fs.existsSync(path.join(external, 'index.html'))) return external;
  }
  return path.join(__dirname, '..');
}

/** 托盘菜单文案：跟随界面语言（读取页面写入的 TELANG Cookie） */
const TRAY_TEXT = {
  zh: {
    show: '显示界面',
    autostart: '开机启动',
    quit: '退出',
    tip: 'TE-Server（点此显示界面）',
    hiddenTitle: 'TE-Server 仍在运行',
    hiddenBody: '窗口已最小化到托盘，双击托盘图标可重新打开。',
  },
  en: {
    show: 'Show window',
    autostart: 'Start with Windows',
    quit: 'Exit',
    tip: 'TE-Server (click to show)',
    hiddenTitle: 'TE-Server is still running',
    hiddenBody: 'The window was minimized to tray. Double-click the tray icon to reopen.',
  },
  vi: {
    show: 'Hiện cửa sổ',
    autostart: 'Khởi động cùng Windows',
    quit: 'Thoát',
    tip: 'TE-Server (bấm để hiện cửa sổ)',
    hiddenTitle: 'TE-Server vẫn đang chạy',
    hiddenBody: 'Cửa sổ đã thu nhỏ xuống khay. Nháy đúp biểu tượng khay để mở lại.',
  },
};

/** 开机启动时附加的参数：启动后直接最小化到托盘 */
const AUTOSTART_ARGS = ['--hidden'];
const startHidden = process.argv.includes('--hidden');

let mainWindow = null;
let tray = null;
let isQuitting = false;
let hideNoticeShown = false;

/* ============================ 托盘 ============================ */

/** 托盘图标：放在 electron/ 里随程序一起打包（asar 内，用 Buffer 读取最稳） */
function loadTrayIcon() {
  const file = path.join(__dirname, 'tray.png');
  try {
    const img = nativeImage.createFromBuffer(fs.readFileSync(file));
    if (!img.isEmpty()) return img;
  } catch (e) {
    console.warn('[TE-Server] 托盘图标读取失败：' + e.message);
  }
  return nativeImage.createEmpty();
}

/** 读取当前界面语言（页面切换语言时会写 TELANG Cookie） */
async function currentLang() {
  try {
    const list = await session.defaultSession.cookies.get({ name: 'TELANG' });
    const v = list.length ? String(list[0].value).toLowerCase() : 'zh';
    return TRAY_TEXT[v] ? v : 'zh';
  } catch (e) {
    return 'zh';
  }
}

/* ---- 开机启动 ---- */

function autoStartEnabled() {
  try {
    return !!app.getLoginItemSettings({ path: process.execPath, args: AUTOSTART_ARGS }).openAtLogin;
  } catch (e) {
    return false;
  }
}

/** 写入/取消开机启动，返回写入后的真实状态 */
function setAutoStart(enable) {
  if (!app.isPackaged) {
    console.warn('[TE-Server] 开发模式下不支持设置开机启动（避免把 electron.exe 写进启动项）');
    return false;
  }
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enable,
      path: process.execPath,
      args: enable ? AUTOSTART_ARGS : [],
    });
    const now = autoStartEnabled();
    console.log(`[TE-Server] 开机启动已${now ? '开启' : '关闭'}（${process.execPath}）`);
    return now;
  } catch (e) {
    console.error('[TE-Server] 设置开机启动失败：' + e.message);
    return autoStartEnabled();
  }
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** 依据当前语言重建托盘菜单（语言切换后会再次调用） */
async function refreshTrayMenu() {
  if (!tray) return;
  const t = TRAY_TEXT[await currentLang()] || TRAY_TEXT.zh;

  const menu = Menu.buildFromTemplate([
    { label: t.show, click: showWindow },
    { type: 'separator' },
    {
      label: t.autostart,
      type: 'checkbox',
      checked: autoStartEnabled(),
      enabled: app.isPackaged,
      click: (item) => {
        item.checked = setAutoStart(item.checked);   // 以注册表实际状态为准
        refreshTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: t.quit,
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip(t.tip);
}

function createTray() {
  try {
    const icon = loadTrayIcon();
    if (icon.isEmpty()) {
      // 空图标在托盘里是「看不见但能点」的状态，必须能诊断出来
      console.warn('[TE-Server] 托盘图标为空，请检查 electron/tray.png 是否随程序打包');
    }
    tray = new Tray(icon);
  } catch (e) {
    console.error('[TE-Server] 托盘创建失败，关闭窗口将直接退出：' + e.message);
    tray = null;
    return;
  }
  refreshTrayMenu();
  // 左键单击/双击都用来恢复窗口（Windows 上右键才出菜单）
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  console.log('[TE-Server] 托盘已就绪（关闭窗口后不会退出程序）');
}

/* ============================ 启动 ============================ */

// 保证单实例运行（同一时间只允许一个进程占用 80 端口）
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else if (app.isReady()) {
      bootstrap();
    }
  });
}

async function bootstrap() {
  const rootDir = resolveWebRoot();      // 网页源码目录（外部可见，可后期手工调整）
  const dataDir = app.getPath('userData'); // 数据库放在用户数据目录，保证安装后有写权限

  console.log('[TE-Server] 网页源码目录：' + rootDir);
  if (startHidden) console.log('[TE-Server] 由开机启动拉起，将直接最小化到托盘');
  initDatabase({ dataDir, rootDir });
  const { port } = await startServer({ rootDir, getDb: require('../server/db').getDb });

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'TE-Server',
    show: false,                       // 先不显示，加载完再显示，避免白屏闪烁
    autoHideMenuBar: true,
    icon: app.isPackaged ? undefined : path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 指向本服务的链接在窗口内打开，其余交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      const isSelf =
        u.port === String(port) ||
        u.hostname === '127.0.0.1' ||
        u.hostname === 'localhost' ||
        lanAddresses().some((a) => a.address === u.hostname);
      if (isSelf) return { action: 'allow' };
    } catch (e) { /* 非标准 URL 走外部浏览器 */ }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 点关闭按钮时不退出，最小化到托盘
  mainWindow.on('close', (e) => {
    if (isQuitting || !tray) return;    // 真正退出、或托盘不可用时，照常关闭
    e.preventDefault();
    mainWindow.hide();
    if (!hideNoticeShown) {
      hideNoticeShown = true;
      currentLang().then((lang) => {
        const t = TRAY_TEXT[lang] || TRAY_TEXT.zh;
        try {
          tray.displayBalloon({ title: t.hiddenTitle, content: t.hiddenBody });
        } catch (err) { /* 部分系统不支持气泡提示，忽略 */ }
      });
    }
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  if (!startHidden) showWindow();

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  // 供安装脚本/运维直接设置，不必打开界面：
  //   TE-Server.exe --set-autostart=on | off | status
  const autoArg = process.argv.find((a) => a.startsWith('--set-autostart'));
  if (autoArg) {
    const val = (autoArg.split('=')[1] || 'status').toLowerCase();
    if (val === 'on') setAutoStart(true);
    else if (val === 'off') setAutoStart(false);
    console.log('[TE-Server] 开机启动状态：' + (autoStartEnabled() ? '已开启' : '已关闭'));
    isQuitting = true;
    setTimeout(() => app.exit(0), 150);   // 留出时间把日志刷出去
    return;
  }

  createTray();
  // 语言切换后重建托盘菜单，让托盘文字跟着界面走
  try {
    session.defaultSession.cookies.on('changed', (e, cookie) => {
      if (cookie && cookie.name === 'TELANG') refreshTrayMenu();
    });
  } catch (e) { /* ignore */ }
  // 已开启开机启动时，每次启动都重新写一遍，避免程序升级/移动后启动项失效
  if (app.isPackaged && autoStartEnabled()) setAutoStart(true);
  return bootstrap();
}).catch((err) => {
  console.error('[TE-Server] 启动失败：', err);
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) bootstrap();
  else showWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
});

// 有托盘时关闭窗口不退出；没有托盘（创建失败）则按常规退出，避免留下无法操作的后台进程
app.on('window-all-closed', () => {
  if (!tray) app.quit();
});

app.on('will-quit', () => {
  if (tray) {
    tray.destroy();
    tray = null;
  }
  closeDatabase();
});
