# TE 生产管理系统（TE-Server）

工厂测试（TE）生产管理系统，由原 **PHP + MySQL** 站点改造为 **Electron 桌面版**：内置 Node.js HTTP 服务（默认 80 端口）与 SQLite3 数据库，**一键安装、双击即用**，不需要再装 PHP / MySQL / IIS。

> 页面路径与接口名称沿用原来的 `*.php`（如 `/maintain/read.php`、`/manage1/read.php`），因此原有前端代码基本无需改动。

---

## 主要功能

- **一键安装**：NSIS 安装包，装完桌面/开始菜单生成快捷方式，启动即开
- **内置服务**：Node.js + Express，默认监听 80 端口，局域网内其它电脑用 `http://<本机IP>/` 直接访问
- **SQLite3 数据**：首次运行自动建表；若数据库为空且根目录有 `localhost.sql`，会自动导入原始数据
- **多语言界面**：简体中文 / English / Tiếng Việt，页面文字与接口返回内容都会跟着变
- **数据库管理页**：表浏览、分页/排序/搜索、行编辑、导入、导出、清空、SQL 执行器
- **托盘常驻**：关闭窗口只是最小化到托盘（服务继续运行），托盘菜单可开关**开机启动**
- **开机启动**：开机后在托盘静默启动，不弹窗口

---

## 安装与启动

1. 运行 `dist\TE-Server Setup 1.0.0.exe` 完成安装
2. 启动后右下角出现托盘图标，浏览器自动打开 `http://127.0.0.1/`
3. 其它电脑访问：控制台（或托盘）会打印局域网地址，例如 `http://192.168.1.20/`

**端口说明**

| 情况 | 行为 |
|---|---|
| 80 端口空闲 | 直接使用 80 |
| 80 被占用 | 自动改用 8080 → 8081 → 8000 → 88，并在控制台提示 |
| 想换端口 | 设置环境变量 `TE_PORT`；只监听本机设 `TE_HOST=127.0.0.1` |

若局域网访问不通，通常是防火墙拦了端口，可执行：

```powershell
npm run firewall
# 或
powershell -ExecutionPolicy Bypass -File scripts/open-firewall.ps1
```

**开机启动**

```
TE-Server.exe --set-autostart=on       # 开启（开机后在托盘静默启动）
TE-Server.exe --set-autostart=off
TE-Server.exe --set-autostart=status   # 查询当前状态
```

也可以直接在托盘图标右键菜单里勾选「开机启动」。

---

## 多语言

- 每个页面右下角有切换按钮，选择后写入 Cookie `TELANG`，**全站记住**（含托盘菜单文字）
- 也可用 URL 参数临时指定：`http://127.0.0.1/main.html?lang=en`
- 默认简体中文

**词典位置**（键是中文短语，值是译文）：

| 文件 | 说明 |
|---|---|
| `server/lang-en.js` | 英文词典 |
| `server/lang-vi.js` | 越南文词典 |
| `server/i18n-core.js` | 翻译引擎（浏览器与 Node 共用） |
| `js/i18n-runtime.js` | 浏览器端：自动翻译页面文字、接管弹窗、渲染切换按钮 |

**扩展新的中文文案**：在 `lang-en.js` / `lang-vi.js` 里加一条即可（键必须与页面里的中文原文完全一致）。

**新增页面**：在页面里引入一行脚本即可自动翻译静态文字：

```html
<script src="/js/i18n.js"></script>
```

**接口里的中文**：用 `T('字面量')` 或模板标签 `` L`<th>編號</th>${data}` `` —— `L` 只翻译模板里的固定文字，`${}` 里的数据原样保留，不会被误译。

> 注意：`T()` / `` L` ` `` 必须在请求上下文里调用。写在模块加载阶段（没有请求）的文字会固定成中文。

---

## 数据库

| 项 | 位置 / 说明 |
|---|---|
| 数据库文件 | `%APPDATA%\TE-Server\ate.db` |
| 建表语句 | `server/schema.sql`（缺列会自动补齐） |
| 原始数据 | 根目录 `localhost.sql`（**含真实生产数据，已在 .gitignore 中排除**） |
| 管理页面 | 打开 `http://127.0.0.1/dbadmin/` |

**数据库管理页功能**

- 左侧表列表（带行数），右侧表格支持分页、点列排序、全字段模糊搜索
- 行内「编辑 / 删除」，工具栏「新增行 / 导出本表 CSV / 刷新」
- **导出**：整库 `.db`、整库 `.sql`、单表 `.csv`
- **导入**：`.db`/`.sqlite`（整体替换）或 `.sql`（按表覆盖 / 整体执行）
- **清空**：勾选表后清空并重置自增序号
- **SQL 执行器**：`SELECT` 返回结果表格，其它语句直接执行

> 清空、导入、执行 SQL 属于危险操作，弹窗中需输入 `CONFIRM` 才会执行。操作前建议先「导出数据库文件」做备份。
>
> 该页面**默认只允许本机访问**；如需从局域网访问，启动前设置环境变量 `TE_DB_PASSWORD`，然后在该页面输入密码登录。

---

## 目录结构

```
electron/           Electron 主进程
  main.js             窗口、托盘、关闭最小化、开机启动
  preload.js          预加载脚本
  tray.png            托盘图标（由 images/logo.png 生成）
server/             HTTP 服务与后端
  index.js            Express 装配、端口监听、/js/i18n.js 下发
  config.js           监听配置与局域网地址
  db.js               SQLite 初始化、导入、导出、清空
  schema.sql          建表语句
  sql-import.js       MySQL dump 解析
  lang.js             多语言（T / L）与语言解析
  lang-en.js          英文词典
  lang-vi.js          越南文词典
  i18n-core.js        翻译引擎
  routes/             各模块接口（与原 PHP 文件一一对应）
    php.js  fpy.js  maintain.js  manage1.js  manage.js
    form.js  handover.js  search.js  test.js  dbadmin.js
scripts/            辅助脚本（放行防火墙、生成数据库等）
build/icon.ico      安装包与 exe 图标
js/i18n-runtime.js  浏览器端多语言运行时
maintain/ manage1/ manage/ form/ handover/ search/ test/ fpy/ dbadmin/ QPA/
                    各业务模块的网页源码
layui/ lib/ images/ 第三方组件与静态资源
```

> 打包后，网页源码位于安装目录 `resources\web\`（明文，可直接编辑），改完刷新页面即可生效——服务端对 HTML 做了禁用缓存处理。

---

## 开发

```bash
npm install          # 安装依赖（含 electron-builder 依赖重建）
npm start            # 开发模式启动（electron .）
npm run serve        # 只启动 HTTP 服务，不开窗口（便于调试接口）
npm run dist         # 打包 Windows 安装包 → dist/
npm run dist:portable  # 打包免安装版
```

**环境变量**

| 变量 | 作用 |
|---|---|
| `TE_HOST` | 监听地址，默认 `0.0.0.0`（允许局域网） |
| `TE_PORT` | 监听端口，默认 `80` |
| `TE_WEB_ROOT` | 指定网页源码目录（默认自动定位） |
| `TE_DB_PASSWORD` | 允许局域网访问数据库管理页 |

---

## 注意事项

1. **生产数据不进版本库**：`localhost.sql` 已加入 `.gitignore`。新机器首次运行是空库，需要时通过「数据库管理 → 导入」单独导入。
2. **定期备份**：用数据库管理页的「导出数据库文件(.db)」即可，恢复时用「导入」选择该文件。
3. **数据不会被翻译**：多语言只翻译界面文字，数据库里的内容（如物品名称、维修原因）在三语下都保持原文。
4. **依赖体积**：`node_modules/` 与构建产物 `dist/` 都已排除在版本库之外。

---

## 技术栈

Electron 31 · Node.js（Express 4） · better-sqlite3 · Layui 2.4.3 · jQuery 1.7.2 · Highcharts · ExcelJS · electron-builder
