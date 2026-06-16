// Service Worker — 监听标签页导航，按域名匹配注入时区覆盖
const STORAGE_KEY = 'timezoneConfig';
const injectedTabs = new Set();

// 配置变更时清空注入状态，下次导航会用新配置重新注入
chrome.storage.onChanged.addListener((changes) => {
  if (changes[STORAGE_KEY]) {
    console.log('[TZ-SW] config changed, clearing injectedTabs');
    injectedTabs.clear();
  }
});

// 标签页关闭时清理
chrome.tabs.onRemoved.addListener(tabId => {
  console.log('[TZ-SW] tab removed:', tabId);
  injectedTabs.delete(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  console.log('[TZ-SW] tab complete:', tabId, tab.url);

  if (!tab.url || !(tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
    console.log('[TZ-SW] skip non-http:', tab.url);
    return;
  }

  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const config = result[STORAGE_KEY];
    console.log('[TZ-SW] config loaded:', JSON.stringify({ enabled: config?.enabled, activeRuleId: config?.activeRuleId, rulesCount: config?.rules?.length }));

    if (!config || !config.enabled) {
      console.log('[TZ-SW] skip: disabled or no config');
      return;
    }
    if (!config.activeRuleId) {
      console.log('[TZ-SW] skip: no activeRuleId');
      return;
    }

    const activeRule = config.rules.find(r => r.id === config.activeRuleId);
    if (!activeRule) {
      console.log('[TZ-SW] skip: activeRule not found');
      return;
    }

    const url = new URL(tab.url);
    const hostname = url.hostname;
    console.log('[TZ-SW] hostname:', hostname, '| rule domains:', activeRule.domains);

    const domainMatched = activeRule.domains.some(domain => {
      const match = hostname === domain || hostname.endsWith('.' + domain);
      console.log('[TZ-SW]   check:', hostname, 'vs', domain, '→', match);
      return match;
    });
    if (!domainMatched) {
      console.log('[TZ-SW] skip: domain not matched');
      return;
    }

    const offset = computeOffsetForTimezone(activeRule.timezone);
    console.log('[TZ-SW] timezone:', activeRule.timezone, 'offset:', offset);

    if (injectedTabs.has(tabId)) {
      console.log('[TZ-SW] already injected, updating MAIN world');
      chrome.scripting.executeScript({
        target: { tabId },
        func: overrideTimeAPIs,
        args: [activeRule.timezone, offset],
        world: 'MAIN'
      }).then(() => console.log('[TZ-SW] MAIN world update OK'))
        .catch(e => console.error('[TZ-SW] MAIN world update FAILED:', e));
      return;
    }

    // 注入 ISOLATED 世界监听器（storage 变更 → reload）
    console.log('[TZ-SW] injecting content.js (ISOLATED)...');
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['scripts/content.js']
    });
    console.log('[TZ-SW] content.js ISOLATED injection OK');

    injectedTabs.add(tabId);

    // 注入 MAIN 世界时区覆盖（不受页面 CSP 约束）
    console.log('[TZ-SW] injecting overrideTimeAPIs (MAIN)...');
    await chrome.scripting.executeScript({
      target: { tabId },
      func: overrideTimeAPIs,
      args: [activeRule.timezone, offset],
      world: 'MAIN'
    });
    console.log('[TZ-SW] overrideTimeAPIs MAIN injection OK');

    // 通知 content.js 覆盖已生效
    console.log('[TZ-SW] notifying content.js...');
    chrome.tabs.sendMessage(tabId, {
      type: 'OVERRIDE_APPLIED'
    }).then(() => console.log('[TZ-SW] notification sent OK'))
      .catch(e => console.error('[TZ-SW] notification FAILED:', e));

  } catch (err) {
    console.error('[TZ-SW] ERROR:', err);
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

// 注入 MAIN 世界的时区覆盖函数（函数引用，不受页面 CSP 约束）
function overrideTimeAPIs(targetTimezone, targetOffset) {
  console.log('[TZ-MAIN] overrideTimeAPIs called. TZ:', targetTimezone, 'offset:', targetOffset);

  if (window.__tzSwitchApplied) {
    console.log('[TZ-MAIN] already applied, skipping');
    return;
  }
  window.__tzSwitchApplied = true;
  console.log('[TZ-MAIN] applying patches...');

  /* ---- 1. Override Date.prototype.getTimezoneOffset ---- */
  const _orig_getTimezoneOffset = Date.prototype.getTimezoneOffset;
  Date.prototype.getTimezoneOffset = function () {
    return -targetOffset;
  };
  console.log('[TZ-MAIN] getTimezoneOffset patched, original:', _orig_getTimezoneOffset.call(new Date()), 'new:', -targetOffset);

  /* ---- 2. Override Date toLocale methods ---- */
  const _orig_toLocaleString = Date.prototype.toLocaleString;
  const _orig_toLocaleDateString = Date.prototype.toLocaleDateString;
  const _orig_toLocaleTimeString = Date.prototype.toLocaleTimeString;

  Date.prototype.toLocaleString = function (locales, options) {
    return _orig_toLocaleString.call(this, locales, { ...options, timeZone: targetTimezone });
  };
  Date.prototype.toLocaleDateString = function (locales, options) {
    return _orig_toLocaleDateString.call(this, locales, { ...options, timeZone: targetTimezone });
  };
  Date.prototype.toLocaleTimeString = function (locales, options) {
    return _orig_toLocaleTimeString.call(this, locales, { ...options, timeZone: targetTimezone });
  };
  console.log('[TZ-MAIN] Date toLocale methods patched');

  /* ---- 3. Override Intl.DateTimeFormat ---- */
  const _orig_DateTimeFormat = Intl.DateTimeFormat;

  function PatchedDateTimeFormat(locales, options) {
    return new _orig_DateTimeFormat(locales, { ...options, timeZone: targetTimezone });
  }
  PatchedDateTimeFormat.prototype = _orig_DateTimeFormat.prototype;
  PatchedDateTimeFormat.supportedLocalesOf = _orig_DateTimeFormat.supportedLocalesOf.bind(_orig_DateTimeFormat);

  Object.defineProperty(Intl, 'DateTimeFormat', {
    value: PatchedDateTimeFormat,
    writable: true,
    configurable: true
  });
  console.log('[TZ-MAIN] Intl.DateTimeFormat patched');
  console.log('[TZ-MAIN] ALL PATCHES APPLIED SUCCESSFULLY');
}
