// Service Worker — 监听标签页导航，按域名匹配注入时区覆盖
const STORAGE_KEY = 'timezoneConfig';
const injectedTabs = new Set();

chrome.storage.onChanged.addListener((changes) => {
  if (changes[STORAGE_KEY]) injectedTabs.clear();
});

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
      // 页面可能已刷新（ISOLATED 上下文丢失），重新注入
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['scripts/content.js']
      }).catch(() => {});
      await chrome.scripting.executeScript({
        target: { tabId },
        func: overrideTimeAPIs,
        args: [activeRule.timezone, offset],
        world: 'MAIN'
      });
      chrome.tabs.sendMessage(tabId, { type: 'OVERRIDE_APPLIED' }).catch(() => {});
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['scripts/content.js']
    });

    injectedTabs.add(tabId);

    await chrome.scripting.executeScript({
      target: { tabId },
      func: overrideTimeAPIs,
      args: [activeRule.timezone, offset],
      world: 'MAIN'
    });

    chrome.tabs.sendMessage(tabId, { type: 'OVERRIDE_APPLIED' }).catch(() => {});

  } catch (_) {}
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
  if (window.__tzSwitchApplied) return;
  window.__tzSwitchApplied = true;

  /* ---- 1. Override Date.prototype.getTimezoneOffset ---- */
  const _orig_getTimezoneOffset = Date.prototype.getTimezoneOffset;
  Date.prototype.getTimezoneOffset = function () {
    return -targetOffset;
  };

  /* ---- 2. Override Date local getters ---- */
  const _orig_getFullYear = Date.prototype.getFullYear;
  const _orig_getMonth = Date.prototype.getMonth;
  const _orig_getDate = Date.prototype.getDate;
  const _orig_getDay = Date.prototype.getDay;
  const _orig_getHours = Date.prototype.getHours;
  const _orig_getMinutes = Date.prototype.getMinutes;
  const _orig_getSeconds = Date.prototype.getSeconds;
  const _orig_getMilliseconds = Date.prototype.getMilliseconds;

  function toTargetLocal(d) {
    const sysEast = -_orig_getTimezoneOffset.call(d);
    return d.getTime() + (targetOffset - sysEast) * 60000;
  }

  Date.prototype.getFullYear = function () { return _orig_getFullYear.call(new Date(toTargetLocal(this))); };
  Date.prototype.getMonth = function () { return _orig_getMonth.call(new Date(toTargetLocal(this))); };
  Date.prototype.getDate = function () { return _orig_getDate.call(new Date(toTargetLocal(this))); };
  Date.prototype.getDay = function () { return _orig_getDay.call(new Date(toTargetLocal(this))); };
  Date.prototype.getHours = function () { return _orig_getHours.call(new Date(toTargetLocal(this))); };
  Date.prototype.getMinutes = function () { return _orig_getMinutes.call(new Date(toTargetLocal(this))); };
  Date.prototype.getSeconds = function () { return _orig_getSeconds.call(new Date(toTargetLocal(this))); };
  Date.prototype.getMilliseconds = function () { return _orig_getMilliseconds.call(new Date(toTargetLocal(this))); };

  /* ---- 3. Override Date toLocale methods ---- */
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

  /* ---- 4. Override Date.prototype.toString / toTimeString / toDateString ---- */
  const absOff = Math.abs(targetOffset);
  const _sign = targetOffset >= 0 ? '+' : '-';
  const _offH = String(Math.floor(absOff / 60)).padStart(2, '0');
  const _offM = String(absOff % 60).padStart(2, '0');

  function getFmt() {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: targetTimezone, hour12: false,
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZoneName: 'long'
    });
  }

  Date.prototype.toString = function () {
    const fmt = getFmt();
    const parts = fmt.formatToParts(this);
    const get = function (t) { return (parts.find(function (p) { return p.type === t; }) || {}).value || ''; };
    return get('weekday') + ' ' + get('month') + ' ' + get('day') + ' ' +
           get('year') + ' ' + get('hour') + ':' + get('minute') + ':' + get('second') +
           ' GMT' + _sign + _offH + _offM + ' (' + get('timeZoneName') + ')';
  };

  Date.prototype.toTimeString = function () {
    const fmt = getFmt();
    const parts = fmt.formatToParts(this);
    const get = function (t) { return (parts.find(function (p) { return p.type === t; }) || {}).value || ''; };
    return get('hour') + ':' + get('minute') + ':' + get('second') +
           ' GMT' + _sign + _offH + _offM + ' (' + get('timeZoneName') + ')';
  };

  Date.prototype.toDateString = function () {
    const fmt = getFmt();
    const parts = fmt.formatToParts(this);
    const get = function (t) { return (parts.find(function (p) { return p.type === t; }) || {}).value || ''; };
    return get('weekday') + ' ' + get('month') + ' ' + get('day') + ' ' + get('year');
  };

  /* ---- 5. Override Intl.DateTimeFormat ---- */
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
}
