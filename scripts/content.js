// Content script — 运行在 ISOLATED 世界
// 监听 background 消息，将时区覆盖代码注入到页面 MAIN 世界

let _overrideApplied = false;

// 配置变更时自动刷新，恢复正确时区状态
chrome.storage.onChanged.addListener((changes) => {
  if (changes.timezoneConfig && _overrideApplied) {
    location.reload();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.type === 'OVERRIDE_TIMEZONE') {
    const { timezone, offset } = message;
    injectScript(timezone, offset);
    _overrideApplied = true;
  }
});

function injectScript(targetTimezone, targetOffset) {
  const code = `
    void function _tzOverride(TARGET_TZ, TARGET_OFFSET) {
      if (window.__tzSwitchApplied) return;
      window.__tzSwitchApplied = true;

      /* ---- 1. Override Date.prototype.getTimezoneOffset ---- */
      const _orig_getTimezoneOffset = Date.prototype.getTimezoneOffset;
      Date.prototype.getTimezoneOffset = function patchedGetTimezoneOffset() {
        return -TARGET_OFFSET;
      };

      /* ---- 2. Override Date toLocale methods ---- */
      const _orig_toLocaleString = Date.prototype.toLocaleString;
      const _orig_toLocaleDateString = Date.prototype.toLocaleDateString;
      const _orig_toLocaleTimeString = Date.prototype.toLocaleTimeString;

      Date.prototype.toLocaleString = function patchedToLocaleString(locales, options) {
        return _orig_toLocaleString.call(this, locales, { ...options, timeZone: TARGET_TZ });
      };
      Date.prototype.toLocaleDateString = function patchedToLocaleDateString(locales, options) {
        return _orig_toLocaleDateString.call(this, locales, { ...options, timeZone: TARGET_TZ });
      };
      Date.prototype.toLocaleTimeString = function patchedToLocaleTimeString(locales, options) {
        return _orig_toLocaleTimeString.call(this, locales, { ...options, timeZone: TARGET_TZ });
      };

      /* ---- 3. Override Intl.DateTimeFormat ---- */
      const _orig_DateTimeFormat = Intl.DateTimeFormat;

      function PatchedDateTimeFormat(locales, options) {
        return new _orig_DateTimeFormat(locales, { ...options, timeZone: TARGET_TZ });
      }
      PatchedDateTimeFormat.supportedLocalesOf = _orig_DateTimeFormat.supportedLocalesOf.bind(_orig_DateTimeFormat);

      Object.defineProperty(Intl, 'DateTimeFormat', {
        value: PatchedDateTimeFormat,
        writable: true,
        configurable: true
      });
    }(${JSON.stringify(targetTimezone)}, ${targetOffset});
  `;

  const script = document.createElement('script');
  script.textContent = code;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}
