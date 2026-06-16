// Content script — 运行在 ISOLATED 世界
// 监听 storage 变更，配置变化时自动刷新恢复正确时区

console.log('[TZ-ISO] content.js loaded');

let _overrideApplied = false;

// 配置变更时自动刷新（仅 enabled/activeRuleId 变化才 reload）
chrome.storage.onChanged.addListener((changes) => {
  const c = changes.timezoneConfig;
  console.log('[TZ-ISO] storage changed, hasConfig:', !!c, '_overrideApplied:', _overrideApplied);
  if (!c || !_overrideApplied) return;
  const oldEnabled = c.oldValue?.enabled;
  const newEnabled = c.newValue?.enabled;
  const oldActive = c.oldValue?.activeRuleId;
  const newActive = c.newValue?.activeRuleId;
  console.log('[TZ-ISO] oldEnabled:', oldEnabled, '→ newEnabled:', newEnabled, 'oldActive:', oldActive, '→ newActive:', newActive);
  if (oldEnabled !== newEnabled || oldActive !== newActive) {
    console.log('[TZ-ISO] reloading page...');
    location.reload();
  } else {
    console.log('[TZ-ISO] no effective change, skip reload');
  }
});

// background 通知 MAIN 世界覆盖已生效
chrome.runtime.onMessage.addListener((message) => {
  console.log('[TZ-ISO] message received:', message.type);
  if (message.type === 'OVERRIDE_APPLIED') {
    _overrideApplied = true;
    console.log('[TZ-ISO] _overrideApplied = true');
  }
});
