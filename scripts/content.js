// Content script — 运行在 ISOLATED 世界
// 监听 storage 变更，配置变化时自动刷新恢复正确时区

let _overrideApplied = false;

// 配置变更时自动刷新（仅 enabled/activeRuleId 变化才 reload）
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

// background 通知 MAIN 世界覆盖已生效
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'OVERRIDE_APPLIED') {
    _overrideApplied = true;
  }
});
