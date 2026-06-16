// Service Worker — 监听标签页导航，按域名匹配注入时区覆盖
const STORAGE_KEY = 'timezoneConfig';

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

    // 先注入监听器（content script）
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['scripts/content.js']
    });

    // 发送时区参数
    chrome.tabs.sendMessage(tabId, {
      type: 'OVERRIDE_TIMEZONE',
      timezone: activeRule.timezone,
      offset
    });

  } catch (_) {
    // 标签页可能在注入前已关闭，忽略
  }
});

// 计算指定 IANA 时区当前 UTC 偏移（分钟）
function computeOffsetForTimezone(tz) {
  try {
    const now = new Date();
    const utcTimeVal = now.getTime() + (now.getTimezoneOffset() * 60000);
    const targetTime = new Date(utcTimeVal + (computeRawOffset(tz, now) * 60000));
    return -targetTime.getTimezoneOffset();
  } catch {
    // 后备：用粗略估算
    return estimateOffset(tz);
  }
}

function computeRawOffset(tz, now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric'
  }).formatToParts(now);

  const get = (type) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);
  const utcYear = now.getUTCFullYear();
  const utcMonth = now.getUTCMonth() + 1;
  const utcDay = now.getUTCDate();
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const utcSecond = now.getUTCSeconds();

  const targetDate = new Date(
    get('year'), get('month') - 1, get('day'),
    get('hour'), get('minute'), get('second')
  );
  const utcDate = new Date(Date.UTC(utcYear, utcMonth - 1, utcDay, utcHour, utcMinute, utcSecond));

  return (targetDate.getTime() - utcDate.getTime()) / 60000;
}

function estimateOffset(tz) {
  const testDate = new Date();
  const shortOffset = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'shortOffset'
  }).formatToParts(testDate);

  const offsetStr = shortOffset.find(p => p.type === 'timeZoneName')?.value || '';
  const match = offsetStr.match(/GMT([+-]\d{2}):?(\d{2})/);
  if (match) {
    const sign = match[1][0] === '-' ? -1 : 1;
    return sign * (Math.abs(parseInt(match[1], 10)) * 60 + parseInt(match[2], 10));
  }
  return 0;
}
