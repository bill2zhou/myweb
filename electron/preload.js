'use strict';
const { contextBridge } = require('electron');

// 暴露少量只读信息，渲染进程按需使用（页面本身均为相对路径 AJAX，可不依赖此对象）
contextBridge.exposeInMainWorld('TE', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
});
