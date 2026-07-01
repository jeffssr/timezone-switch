// Service Worker — 监听导航，按域名匹配注入时区覆盖
const STORAGE_KEY = 'timezoneConfig';
const injectedTabs = new Set();

// 新导航开始时清除该 tab 注入状态，确保注入用最新配置
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0) injectedTabs.delete(details.tabId);
});

// 最早注入点：导航已确认，文档即将创建（早于页面所有脚本）
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) injectIfNeeded(details.tabId, details.url);
});

// 次早注入点：SW 冷启动后的补漏 + 页面刷新场景
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url) {
    injectIfNeeded(tabId, tab.url);
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes[STORAGE_KEY]) injectedTabs.clear();
});

chrome.tabs.onRemoved.addListener(tabId => injectedTabs.delete(tabId));

async function injectIfNeeded(tabId, url) {
  if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) return;

  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const config = result[STORAGE_KEY];
    if (!config || !config.enabled || !config.activeRuleId) return;

    const activeRule = config.rules.find(r => r.id === config.activeRuleId);
    if (!activeRule) return;

    const hostname = new URL(url).hostname;
    const matched = activeRule.domains.some(domain =>
      hostname === domain || hostname.endsWith('.' + domain)
    );
    if (!matched) return;

    const offset = computeOffsetForTimezone(activeRule.timezone);

    if (injectedTabs.has(tabId)) {
      // 页面可能已刷新，ISOLATED 上下文丢失，需重新注入
      await chrome.scripting.executeScript({
        target: { tabId }, files: ['scripts/content.js']
      }).catch(() => {});
      await chrome.scripting.executeScript({
        target: { tabId }, func: overrideTimeAPIs,
        args: [activeRule.timezone, offset], world: 'MAIN'
      });
      chrome.tabs.sendMessage(tabId, { type: 'OVERRIDE_APPLIED' }).catch(() => {});
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId }, files: ['scripts/content.js']
    });

    injectedTabs.add(tabId);

    await chrome.scripting.executeScript({
      target: { tabId }, func: overrideTimeAPIs,
      args: [activeRule.timezone, offset], world: 'MAIN'
    });

    chrome.tabs.sendMessage(tabId, { type: 'OVERRIDE_APPLIED' }).catch(() => {});

  } catch (_) {}
}

// 计算指定 IANA 时区相对于 UTC 的分钟偏移（正值 = 东区）
function computeOffsetForTimezone(tz) {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, timeZoneName: 'shortOffset'
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

  /* ---- 0. Override Date constructor ---- */
  // 将无时区字符串和多参数构造按目标时区解释，消除 getter 双重偏移
  const _orig_Date = Date;
  const _orig_Date_UTC = Date.UTC;
  const _orig_Date_parse = Date.parse;
  const _orig_Date_now = Date.now;

  // 标记"真实数据" Date 实例：含具体时间的字符串构造，不应做时区偏移
  var _realDataDates = new WeakSet();

  function PatchedDate() {
    // Date() 无 new 调用 → 返回字符串
    if (!new.target) return (new PatchedDate()).toString();

    var len = arguments.length;
    var a = arguments;

    // 多参数：new Date(year, month, day, hours, mins, secs, ms)
    if (len >= 2) {
      var y = a[0];
      var mo = a[1];
      var d = a[2] !== undefined ? a[2] : 1;
      var h = a[3] || 0;
      var mi = a[4] || 0;
      var s = a[5] || 0;
      var ms = a[6] || 0;
      return new _orig_Date(_orig_Date_UTC(y, mo, d, h, mi, s, ms) - targetOffset * 60000);
    }

    // 纯日期字符串：new Date('MM/DD/YYYY') 或 new Date('YYYY-MM-DD')
    if (len === 1 && typeof a[0] === 'string') {
      var str = a[0];

      var mmddyyyy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (mmddyyyy) {
        return new _orig_Date(_orig_Date_UTC(
          parseInt(mmddyyyy[3], 10),
          parseInt(mmddyyyy[1], 10) - 1,
          parseInt(mmddyyyy[2], 10),
          0, 0, 0, 0
        ) - targetOffset * 60000);
      }

      var iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (iso) {
        return new _orig_Date(_orig_Date_UTC(
          parseInt(iso[1], 10),
          parseInt(iso[2], 10) - 1,
          parseInt(iso[3], 10),
          0, 0, 0, 0
        ) - targetOffset * 60000);
      }

      // 带时间或时区的字符串 → 真实数据，标记后不做时区偏移
      var _d = new _orig_Date(str);
      _realDataDates.add(_d);
      return _d;
    }

    // new Date() 或 new Date(timestamp)
    if (len === 0) return new _orig_Date();
    return new _orig_Date(a[0]);
  }

  PatchedDate.now = _orig_Date_now;
  PatchedDate.UTC = _orig_Date_UTC;
  PatchedDate.parse = _orig_Date_parse;
  PatchedDate.prototype = _orig_Date.prototype;

  Object.defineProperty(window, 'Date', {
    value: PatchedDate,
    writable: true,
    configurable: true
  });

  /* ---- 1. Override Date.prototype.getTimezoneOffset ---- */
  const _orig_getTimezoneOffset = Date.prototype.getTimezoneOffset;
  Date.prototype.getTimezoneOffset = function () {
    if (_realDataDates.has(this)) return _orig_getTimezoneOffset.call(this);
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

  Date.prototype.getFullYear = function () { if (_realDataDates.has(this)) return _orig_getFullYear.call(this); return _orig_getFullYear.call(new Date(toTargetLocal(this))); };
  Date.prototype.getMonth = function () { if (_realDataDates.has(this)) return _orig_getMonth.call(this); return _orig_getMonth.call(new Date(toTargetLocal(this))); };
  Date.prototype.getDate = function () { if (_realDataDates.has(this)) return _orig_getDate.call(this); return _orig_getDate.call(new Date(toTargetLocal(this))); };
  Date.prototype.getDay = function () { if (_realDataDates.has(this)) return _orig_getDay.call(this); return _orig_getDay.call(new Date(toTargetLocal(this))); };
  Date.prototype.getHours = function () { if (_realDataDates.has(this)) return _orig_getHours.call(this); return _orig_getHours.call(new Date(toTargetLocal(this))); };
  Date.prototype.getMinutes = function () { if (_realDataDates.has(this)) return _orig_getMinutes.call(this); return _orig_getMinutes.call(new Date(toTargetLocal(this))); };
  Date.prototype.getSeconds = function () { if (_realDataDates.has(this)) return _orig_getSeconds.call(this); return _orig_getSeconds.call(new Date(toTargetLocal(this))); };
  Date.prototype.getMilliseconds = function () { if (_realDataDates.has(this)) return _orig_getMilliseconds.call(this); return _orig_getMilliseconds.call(new Date(toTargetLocal(this))); };

  /* ---- 2.5. Override Date local setters ---- */
  function toUtcFromTarget(ms) {
    return ms - targetOffset * 60000;
  }

  function tzParts(d) {
    var tLocal = d.getTime() + targetOffset * 60000;
    var u = new Date(tLocal);
    return {
      y: u.getUTCFullYear(), m: u.getUTCMonth(), d: u.getUTCDate(),
      hh: u.getUTCHours(), mm: u.getUTCMinutes(), ss: u.getUTCSeconds(), ms: u.getUTCMilliseconds()
    };
  }

  Date.prototype.setFullYear = function (y, m, d) {
    var p = tzParts(this);
    this.setTime(toUtcFromTarget(Date.UTC(y, m !== undefined ? m : p.m, d !== undefined ? d : p.d, p.hh, p.mm, p.ss, p.ms)));
    return this.getTime();
  };
  Date.prototype.setMonth = function (m, d) {
    var p = tzParts(this);
    this.setTime(toUtcFromTarget(Date.UTC(p.y, m, d !== undefined ? d : p.d, p.hh, p.mm, p.ss, p.ms)));
    return this.getTime();
  };
  Date.prototype.setDate = function (d) {
    var p = tzParts(this);
    this.setTime(toUtcFromTarget(Date.UTC(p.y, p.m, d, p.hh, p.mm, p.ss, p.ms)));
    return this.getTime();
  };
  Date.prototype.setHours = function (h, m, s, ms) {
    var p = tzParts(this);
    this.setTime(toUtcFromTarget(Date.UTC(p.y, p.m, p.d, h, m !== undefined ? m : p.mm, s !== undefined ? s : p.ss, ms !== undefined ? ms : p.ms)));
    return this.getTime();
  };
  Date.prototype.setMinutes = function (m, s, ms) {
    var p = tzParts(this);
    this.setTime(toUtcFromTarget(Date.UTC(p.y, p.m, p.d, p.hh, m, s !== undefined ? s : p.ss, ms !== undefined ? ms : p.ms)));
    return this.getTime();
  };
  Date.prototype.setSeconds = function (s, ms) {
    var p = tzParts(this);
    this.setTime(toUtcFromTarget(Date.UTC(p.y, p.m, p.d, p.hh, p.mm, s, ms !== undefined ? ms : p.ms)));
    return this.getTime();
  };
  Date.prototype.setMilliseconds = function (ms) {
    var p = tzParts(this);
    this.setTime(toUtcFromTarget(Date.UTC(p.y, p.m, p.d, p.hh, p.mm, p.ss, ms)));
    return this.getTime();
  };

  /* ---- 3. Override Date toLocale methods ---- */
  const _orig_toLocaleString = Date.prototype.toLocaleString;
  const _orig_toLocaleDateString = Date.prototype.toLocaleDateString;
  const _orig_toLocaleTimeString = Date.prototype.toLocaleTimeString;

  Date.prototype.toLocaleString = function (locales, options) {
    if (_realDataDates.has(this)) return _orig_toLocaleString.call(this, locales, options);
    return _orig_toLocaleString.call(this, locales, { ...options, timeZone: targetTimezone });
  };
  Date.prototype.toLocaleDateString = function (locales, options) {
    if (_realDataDates.has(this)) return _orig_toLocaleDateString.call(this, locales, options);
    return _orig_toLocaleDateString.call(this, locales, { ...options, timeZone: targetTimezone });
  };
  Date.prototype.toLocaleTimeString = function (locales, options) {
    if (_realDataDates.has(this)) return _orig_toLocaleTimeString.call(this, locales, options);
    return _orig_toLocaleTimeString.call(this, locales, { ...options, timeZone: targetTimezone });
  };

  /* ---- 4. Override Date.prototype.toString / toTimeString / toDateString ---- */
  const _orig_toString = Date.prototype.toString;
  const _orig_toTimeString = Date.prototype.toTimeString;
  const _orig_toDateString = Date.prototype.toDateString;

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
    if (_realDataDates.has(this)) return _orig_toString.call(this);
    const fmt = getFmt();
    const parts = fmt.formatToParts(this);
    const get = function (t) { return (parts.find(function (p) { return p.type === t; }) || {}).value || ''; };
    return get('weekday') + ' ' + get('month') + ' ' + get('day') + ' ' +
           get('year') + ' ' + get('hour') + ':' + get('minute') + ':' + get('second') +
           ' GMT' + _sign + _offH + _offM + ' (' + get('timeZoneName') + ')';
  };

  Date.prototype.toTimeString = function () {
    if (_realDataDates.has(this)) return _orig_toTimeString.call(this);
    const fmt = getFmt();
    const parts = fmt.formatToParts(this);
    const get = function (t) { return (parts.find(function (p) { return p.type === t; }) || {}).value || ''; };
    return get('hour') + ':' + get('minute') + ':' + get('second') +
           ' GMT' + _sign + _offH + _offM + ' (' + get('timeZoneName') + ')';
  };

  Date.prototype.toDateString = function () {
    if (_realDataDates.has(this)) return _orig_toDateString.call(this);
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

  // 覆盖 format：真实数据 Date 不附加目标时区
  var _orig_format = _orig_DateTimeFormat.prototype.format;
  _orig_DateTimeFormat.prototype.format = function (date) {
    if (date instanceof Date && _realDataDates.has(date)) {
      var opts = this.resolvedOptions();
      var noTzOpts = {};
      for (var k in opts) {
        if (k !== 'timeZone') noTzOpts[k] = opts[k];
      }
      return new _orig_DateTimeFormat(noTzOpts.locale, noTzOpts).format(date);
    }
    return _orig_format.call(this, date);
  };
}
