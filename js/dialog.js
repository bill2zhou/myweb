/*!
 * TE 管理系统弹窗辅助脚本
 * 子页面既可能被父页面用 layer iframe 弹窗打开，也可能用 window.open 打开，
 * 提交成功后统一调用 closeSelf() 关闭，不用再各写一套判断。
 */
(function (win) {
  win.closeSelf = function () {
    try {
      var p = win.parent;
      if (p && p !== win && p.layui && p.layui.layer && p.layui.layer.getFrameIndex) {
        var idx = p.layui.layer.getFrameIndex(win.name);
        if (idx !== undefined && idx !== null && idx !== '') {
          p.layui.layer.close(idx);
          return;
        }
      }
    } catch (e) { /* 跨域或被禁用时忽略，退回到 window.close() */ }
    win.close();
  };
})(window);
