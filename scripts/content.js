// Content script — 运行在 ISOLATED 世界
// 监听 storage 变更，配置变化时自动刷新恢复正确时区
// IIFE 包裹避免多次 executeScript 注入时 let 重复声明报错
(function () {
  let _overrideApplied = false;

  chrome.storage.onChanged.addListener((changes) => {
    const c = changes.timezoneConfig;
    if (!c || !_overrideApplied) return;
    const oldEnabled = c.oldValue?.enabled;
    const newEnabled = c.newValue?.enabled;
    const oldActive = c.oldValue?.activeRuleId;
    const newActive = c.newValue?.activeRuleId;
    if (oldEnabled !== newEnabled || oldActive !== newActive) {
      location.reload();
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'OVERRIDE_APPLIED') {
      _overrideApplied = true;
    }
  });
})();
