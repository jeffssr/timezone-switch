// Service Worker — 监听标签页导航，按域名匹配注入时区覆盖
const STORAGE_KEY = 'timezoneConfig';
const injectedTabs = new Set();

// 配置变更时清空注入状态，下次导航会用新配置重新注入
chrome.storage.onChanged.addListener((changes) => {
  if (changes[STORAGE_KEY]) injectedTabs.clear();
});

// 标签页关闭时清理
chrome.tabs.onRemoved.addListener(tabId => injectedTabs.delete(tabId));

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || !(tab.url.startsWith('http://') || tab.url.startsWith('https://'))) return;

  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const config = result[STORAGE_KEY];
    if (!config || !config.enabled || !config.activeRuleId) return;

    const activeRule = config.rules.find(r => r.id === config.activeRuleId);
    if (!activeRule) return;

    const url = new URL(tab.url);
    const hostname = url.hostname;

    const domainMatched = activeRule.domains.some(domain =>
      hostname === domain || hostname.endsWith('.' + domain)
    );
    if (!domainMatched) return;

    const offset = computeOffsetForTimezone(activeRule.timezone);

    if (injectedTabs.has(tabId)) {
      // 已注入过，只更新时区参数
      chrome.tabs.sendMessage(tabId, {
        type: 'OVERRIDE_TIMEZONE',
        timezone: activeRule.timezone,
        offset
      }).catch(() => {});
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['scripts/content.js']
    });

    injectedTabs.add(tabId);

    chrome.tabs.sendMessage(tabId, {
      type: 'OVERRIDE_TIMEZONE',
      timezone: activeRule.timezone,
      offset
    });

  } catch (_) {
    // 标签页可能在注入前已关闭，忽略
  }
});

// 计算指定 IANA 时区相对于 UTC 的分钟偏移（正值 = 东区）
function computeOffsetForTimezone(tz) {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset'
    }).formatToParts(now);

    const offsetStr = parts.find(p => p.type === 'timeZoneName')?.value || '';
    // 匹配 "GMT+09:00" / "UTC+9" / "GMT-05:00" 等格式
    const match = offsetStr.match(/(?:GMT|UTC)([+-])(\d{1,2}):?(\d{2})?/);
    if (match) {
      const sign = match[1] === '-' ? -1 : 1;
      const hours = parseInt(match[2], 10);
      const minutes = parseInt(match[3] || '0', 10);
      return sign * (hours * 60 + minutes);
    }
    return 0;
  } catch {
    return 0;
  }
}
