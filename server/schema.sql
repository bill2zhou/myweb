-- SQLite3 数据库结构（对应原 MySQL 数据库 ate）
-- 所有主键改为 INTEGER PRIMARY KEY AUTOINCREMENT，保证无主键的 INSERT 可自动编号

CREATE TABLE IF NOT EXISTS fpy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT,
  device TEXT NOT NULL DEFAULT '',
  total REAL,
  pass REAL,
  fail REAL,
  fail_comp REAL,
  fpy REAL,
  mods TEXT,
  top1 TEXT, top1_n INTEGER,
  top2 TEXT, top2_n INTEGER,
  top3 TEXT, top3_n INTEGER
);

-- 原 MySQL 中由其它程序写入、PHP 侧只读的表
CREATE TABLE IF NOT EXISTS aoi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT,
  dev TEXT NOT NULL DEFAULT '',
  total REAL,
  pass REAL,
  fail REAL,
  fpy REAL,
  mods TEXT,
  top1 TEXT, top1_n INTEGER,
  top2 TEXT, top2_n INTEGER,
  top3 TEXT, top3_n INTEGER,
  top4 TEXT, top4_n INTEGER,
  top5 TEXT, top5_n INTEGER,
  top6 TEXT, top6_n INTEGER,
  top7 TEXT, top7_n INTEGER,
  top8 TEXT, top8_n INTEGER,
  top9 TEXT, top9_n INTEGER,
  top10 TEXT, top10_n INTEGER
);

CREATE TABLE IF NOT EXISTS ft (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT,
  device TEXT NOT NULL DEFAULT '',
  total REAL,
  pass REAL,
  fail REAL,
  fpy REAL,
  mods TEXT,
  top1 TEXT, top1_n INTEGER,
  top2 TEXT, top2_n INTEGER,
  top3 TEXT, top3_n INTEGER
);

CREATE TABLE IF NOT EXISTS maintain (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line TEXT NOT NULL DEFAULT '',
  station TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  fa TEXT NOT NULL DEFAULT '',
  reason TEXT,
  ca TEXT NOT NULL DEFAULT '',
  fault TEXT NOT NULL DEFAULT '',
  time TEXT NOT NULL DEFAULT '',
  -- 原始数据里有大量 NULL，不能加 NOT NULL
  jiya TEXT DEFAULT NULL,
  owner TEXT NOT NULL DEFAULT '',
  team TEXT NOT NULL DEFAULT '',
  sn TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS handover (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT,
  shift TEXT,
  kpi TEXT,
  other TEXT
);

CREATE TABLE IF NOT EXISTS manage (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  team TEXT,
  cate TEXT,
  thing TEXT,
  barcode TEXT,
  model TEXT,
  date TEXT,
  stock INTEGER,
  safestock INTEGER,
  remark TEXT,
  tip TEXT,
  remark2024091009Septh TEXT,
  remark1725932914 TEXT,
  sn TEXT,
  mark TEXT,
  type TEXT,
  changs TEXT,
  xinhao TEXT,
  num INTEGER,
  beizhu TEXT,
  zhuangt TEXT,
  line TEXT
);

CREATE TABLE IF NOT EXISTS probe (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  team TEXT,
  barcode TEXT,
  model TEXT,
  date TEXT,
  stock INTEGER,
  safestock INTEGER,
  remark TEXT
);

CREATE TABLE IF NOT EXISTS score (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  team TEXT,
  name TEXT NOT NULL DEFAULT '',
  scores INTEGER NOT NULL DEFAULT 0,
  level TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS teprogram (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT,
  shift TEXT,
  model TEXT,
  oldname TEXT,
  newname TEXT,
  reason TEXT,
  summary TEXT,
  owner TEXT,
  verify TEXT
);

CREATE TABLE IF NOT EXISTS test (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  team TEXT,
  level TEXT,
  question TEXT,
  answer1 TEXT,
  answer2 TEXT,
  answer3 TEXT,
  answer4 TEXT,
  correct TEXT
);

CREATE TABLE IF NOT EXISTS users (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  psn TEXT
);

-- 治具点检表（原 aardio_mysql.jig）
CREATE TABLE IF NOT EXISTS jig (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT,
  time TEXT,
  device TEXT,
  line TEXT,
  probe TEXT,
  structure TEXT,
  clear TEXT,
  sensor TEXT,
  owner TEXT,
  checker TEXT
);
