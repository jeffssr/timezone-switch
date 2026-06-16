# Timezone Switch 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 Chrome/Edge 通用时区切换插件，按域名规则覆盖页面时间 API，使匹配域名下的页面展示目标时区时间。

**Architecture:** Manifest V3 插件。popup（纯 HTML/JS/CSS）管理规则配置，background service worker 监听标签页导航并按域名匹配注入，content script 在页面主世界劫持时间 API。

**Tech Stack:** 纯 HTML/JS/CSS，Manifest V3，chrome.storage.local，chrome.scripting API，无构建工具。

---

## 文件结构

```
timezone-switch/
├── manifest.json              # 插件清单
├── popup/
│   ├── popup.html             # 弹窗结构
│   ├── popup.css              # 弹窗样式
│   └── popup.js               # 弹窗逻辑（规则 CRUD、存储、时区选择器）
├── scripts/
│   ├── background.js          # Service Worker（标签页监听、域名匹配、注入调度）
│   └── content.js             # 页面注入脚本（ISOLATED 世界接收消息，注入 MAIN 世界覆盖 API）
└── icons/
    └── icon.svg               # 矢量图标
```

---

### Task 1: 项目骨架 — manifest.json + 图标 + 目录

**Files:**
- Create: `manifest.json`
- Create: `icons/icon.svg`

- [ ] **Step 1: 创建目录结构**

```bash
mkdir -p icons popup scripts
```

- [ ] **Step 2: 编写 manifest.json**

```json
{
  "manifest_version": 3,
  "name": "Timezone Switch",
  "version": "1.0.0",
  "description": "按域名切换浏览器时区",
  "permissions": ["storage", "scripting", "tabs"],
  "host_permissions": ["<all_urls>"],
  "action": {
    "default_popup": "popup/popup.html",
    "default_title": "Timezone Switch"
  },
  "background": {
    "service_worker": "scripts/background.js",
    "type": "module"
  },
  "icons": {
    "16": "icons/icon.svg",
    "48": "icons/icon.svg",
    "128": "icons/icon.svg"
  }
}
```

- [ ] **Step 3: 创建 SVG 图标**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <circle cx="64" cy="64" r="58" fill="#1677ff"/>
  <text x="64" y="44" text-anchor="middle" fill="white" font-size="36" font-family="sans-serif">UTC</text>
  <text x="64" y="80" text-anchor="middle" fill="white" font-size="22" font-family="sans-serif">⇄</text>
</svg>
```

- [ ] **Step 4: 验证——在 chrome://extensions 中加载**

以开发者模式加载项目根目录，确认插件出现且无错误。

- [ ] **Step 5: Commit**

```bash
git add manifest.json icons/icon.svg
git commit -m "chore: initialize extension scaffold with manifest and icon"
```

---

### Task 2: Content Script — 时区 API 覆盖

**Files:**
- Create: `scripts/content.js`

content.js 运行在 ISOLATED 世界：接收 background 消息，将覆盖代码通过 `<script>` 标签注入到页面 MAIN 世界。

- [ ] **Step 1: 编写 scripts/content.js**

```js
// Content script — 运行在 ISOLATED 世界
// 监听 background 消息，将时区覆盖代码注入到页面 MAIN 世界

chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.type === 'OVERRIDE_TIMEZONE') {
    const { timezone, offset } = message;
    injectScript(timezone, offset);
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
      const _orig_format = Intl.DateTimeFormat.prototype.format;
      const _orig_formatToParts = Intl.DateTimeFormat.prototype.formatToParts;
      const _orig_resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;

      function PatchedDateTimeFormat(locales, options) {
        return new _orig_DateTimeFormat(locales, { ...options, timeZone: TARGET_TZ });
      }

      PatchedDateTimeFormat.prototype.format = function patchedFormat(date) {
        return _orig_format.call(this, date);
      };
      PatchedDateTimeFormat.prototype.formatToParts = function patchedFormatToParts(date) {
        return _orig_formatToParts.call(this, date);
      };
      PatchedDateTimeFormat.prototype.resolvedOptions = function patchedResolvedOptions() {
        const opts = _orig_resolvedOptions.call(this);
        return { ...opts, timeZone: TARGET_TZ };
      };
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
```

- [ ] **Step 2: Commit**

```bash
git add scripts/content.js
git commit -m "feat: add content script with time API override injection"
```

---

### Task 3: Background Service Worker

**Files:**
- Create: `scripts/background.js`

监听标签页导航完成事件，读存储 → 匹配域名 → 注入 content script + 发送时区消息。

- [ ] **Step 1: 编写 scripts/background.js**

```js
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
```

- [ ] **Step 2: Commit**

```bash
git add scripts/background.js
git commit -m "feat: add background service worker with domain matching and injection"
```

---

### Task 4: Popup HTML — 弹窗结构

**Files:**
- Create: `popup/popup.html`

- [ ] **Step 1: 编写 popup/popup.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Timezone Switch</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div id="app" class="container">
    <!-- Header -->
    <header class="header">
      <h1 class="title">时区切换</h1>
      <label class="toggle" id="masterToggleLabel">
        <input type="checkbox" id="masterToggle">
        <span class="toggle-slider"></span>
      </label>
    </header>

    <!-- Rule list view -->
    <section id="ruleListView">
      <ul id="ruleList" class="rule-list"></ul>
      <button id="addRuleBtn" class="btn btn-primary btn-full">+ 添加新时区规则</button>
    </section>

    <!-- Rule edit view (hidden by default) -->
    <section id="ruleEditView" class="hidden">
      <header class="header">
        <button id="backBtn" class="btn btn-link">← 返回</button>
        <h2 id="editTitle">添加时区规则</h2>
      </header>

      <!-- Timezone selector -->
      <div class="form-group">
        <label class="form-label">时区</label>
        <div class="search-select" id="tzSearchSelect">
          <input
            type="text"
            id="tzSearchInput"
            class="search-input"
            placeholder="搜索时区..."
            autocomplete="off"
          >
          <div class="search-dropdown hidden" id="tzDropdown"></div>
        </div>
      </div>

      <!-- Domain input -->
      <div class="form-group">
        <label class="form-label">域名</label>
        <div class="domain-input-row">
          <input
            type="text"
            id="domainInput"
            class="text-input"
            placeholder="输入域名后回车添加"
            autocomplete="off"
          >
          <button id="domainAddBtn" class="btn btn-small btn-primary">添加</button>
        </div>
        <ul id="domainTagList" class="tag-list"></ul>
      </div>

      <!-- Actions -->
      <div class="form-actions">
        <button id="saveRuleBtn" class="btn btn-primary">保存</button>
        <button id="cancelRuleBtn" class="btn btn-secondary">取消</button>
        <button id="deleteRuleBtn" class="btn btn-danger hidden">删除</button>
      </div>
    </section>
  </div>

  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add popup/popup.html
git commit -m "feat: add popup HTML structure with rule list and edit views"
```

---

### Task 5: Popup CSS — 弹窗样式

**Files:**
- Create: `popup/popup.css`

设计风格：紧凑、现代、亮色主题。弹窗宽度 320px。

- [ ] **Step 1: 编写 popup/popup.css**

```css
/* ---- Reset & Base ---- */
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  width: 320px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  color: #1a1a2e;
  background: #f8f9fc;
}

.container { padding: 0; }

.hidden { display: none !important; }

/* ---- Header ---- */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #fff;
  border-bottom: 1px solid #e8ecf1;
}

.title { font-size: 16px; font-weight: 600; }

/* ---- Toggle switch ---- */
.toggle { position: relative; display: inline-block; width: 40px; height: 22px; cursor: pointer; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle-slider {
  position: absolute; top: 0; left: 0; right: 0; bottom: 0;
  background: #ccc; border-radius: 22px; transition: background 0.2s;
}
.toggle-slider::before {
  content: ""; position: absolute; height: 18px; width: 18px;
  left: 2px; bottom: 2px; background: #fff; border-radius: 50%; transition: transform 0.2s;
}
.toggle input:checked + .toggle-slider { background: #1677ff; }
.toggle input:checked + .toggle-slider::before { transform: translateX(18px); }

/* ---- Rule List ---- */
.rule-list { list-style: none; }

.rule-item {
  display: flex; align-items: center; gap: 10px; padding: 12px 16px;
  background: #fff; border-bottom: 1px solid #f0f2f5; cursor: pointer;
  transition: background 0.1s;
}
.rule-item:hover { background: #f0f5ff; }
.rule-item.active { background: #e6f4ff; }

.rule-radio {
  width: 16px; height: 16px; border-radius: 50%; border: 2px solid #ccc;
  flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  transition: border-color 0.2s;
}
.rule-item.active .rule-radio { border-color: #1677ff; }
.rule-radio::after {
  content: ""; width: 8px; height: 8px; border-radius: 50%; background: transparent;
}
.rule-item.active .rule-radio::after { background: #1677ff; }

.rule-info { flex: 1; min-width: 0; }
.rule-tz { font-weight: 500; font-size: 13px; }
.rule-domains { font-size: 11px; color: #888; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rule-delete { color: #ccc; font-size: 16px; cursor: pointer; padding: 2px 6px; border: none; background: none; }
.rule-delete:hover { color: #ff4d4f; }

/* ---- Buttons ---- */
.btn { border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; transition: opacity 0.1s; }
.btn:hover { opacity: 0.85; }
.btn-primary { background: #1677ff; color: #fff; padding: 8px 16px; }
.btn-secondary { background: #f0f2f5; color: #555; padding: 8px 16px; }
.btn-danger { background: #fff2f0; color: #ff4d4f; padding: 8px 16px; }
.btn-link { background: none; color: #1677ff; padding: 0; font-size: 13px; }
.btn-small { padding: 4px 10px; font-size: 12px; }
.btn-full { width: 100%; margin-top: 8px; padding: 10px; }

/* ---- Form ---- */
.form-group { padding: 12px 16px; }
.form-label { display: block; font-size: 12px; font-weight: 500; color: #888; margin-bottom: 6px; }

.text-input, .search-input {
  width: 100%; padding: 8px 10px; border: 1px solid #d9d9d9; border-radius: 6px;
  font-size: 13px; outline: none; transition: border-color 0.2s;
}
.text-input:focus, .search-input:focus { border-color: #1677ff; }

/* ---- Searchable select ---- */
.search-select { position: relative; }
.search-dropdown {
  position: absolute; top: 100%; left: 0; right: 0; z-index: 10;
  max-height: 180px; overflow-y: auto; background: #fff;
  border: 1px solid #d9d9d9; border-top: none; border-radius: 0 0 6px 6px;
}
.search-option {
  padding: 8px 10px; cursor: pointer; font-size: 13px;
  border-bottom: 1px solid #f5f5f5;
}
.search-option:hover, .search-option.selected { background: #e6f4ff; }
.search-option .offset { color: #888; font-size: 11px; margin-left: 6px; }

/* ---- Domain tags ---- */
.domain-input-row { display: flex; gap: 6px; }
.domain-input-row .text-input { flex: 1; }
.tag-list { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.tag-item {
  display: flex; align-items: center; gap: 4px; padding: 3px 8px;
  background: #f0f5ff; border: 1px solid #d6e4ff; border-radius: 4px; font-size: 12px;
}
.tag-remove { cursor: pointer; color: #999; border: none; background: none; font-size: 14px; line-height: 1; }
.tag-remove:hover { color: #ff4d4f; }

/* ---- Form actions ---- */
.form-actions { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid #f0f2f5; }

/* ---- Empty state ---- */
.empty-state { padding: 40px 16px; text-align: center; color: #bbb; font-size: 13px; }
```

- [ ] **Step 2: Commit**

```bash
git add popup/popup.css
git commit -m "feat: add popup styles with toggle, rules, form components"
```

---

### Task 6: Popup JS — 弹窗逻辑

**Files:**
- Create: `popup/popup.js`

核心逻辑：存储读写、规则 CRUD、时区搜索选择器、域名管理、启停切换。

- [ ] **Step 1: 编写 popup/popup.js（第 1 部分——状态与时区数据）**

```js
/* ---- Constants ---- */
const STORAGE_KEY = 'timezoneConfig';

// IANA 时区列表（常用城市 + 主要 UTC 偏移）
const TIMEZONES = [
  { value: 'Pacific/Midway', label: '中途岛 (UTC-11:00)' },
  { value: 'Pacific/Honolulu', label: '夏威夷 (UTC-10:00)' },
  { value: 'America/Anchorage', label: '安克雷奇 (UTC-09:00)' },
  { value: 'America/Los_Angeles', label: '洛杉矶 (UTC-08:00)' },
  { value: 'America/Denver', label: '丹佛 (UTC-07:00)' },
  { value: 'America/Chicago', label: '芝加哥 (UTC-06:00)' },
  { value: 'America/New_York', label: '纽约 (UTC-05:00)' },
  { value: 'America/Halifax', label: '哈利法克斯 (UTC-04:00)' },
  { value: 'America/Sao_Paulo', label: '圣保罗 (UTC-03:00)' },
  { value: 'Atlantic/South_Georgia', label: '南乔治亚 (UTC-02:00)' },
  { value: 'Atlantic/Azores', label: '亚速尔 (UTC-01:00)' },
  { value: 'Europe/London', label: '伦敦 (UTC+00:00)' },
  { value: 'Europe/Paris', label: '巴黎 (UTC+01:00)' },
  { value: 'Europe/Helsinki', label: '赫尔辛基 (UTC+02:00)' },
  { value: 'Europe/Moscow', label: '莫斯科 (UTC+03:00)' },
  { value: 'Asia/Dubai', label: '迪拜 (UTC+04:00)' },
  { value: 'Asia/Karachi', label: '卡拉奇 (UTC+05:00)' },
  { value: 'Asia/Dhaka', label: '达卡 (UTC+06:00)' },
  { value: 'Asia/Bangkok', label: '曼谷 (UTC+07:00)' },
  { value: 'Asia/Shanghai', label: '上海 (UTC+08:00)' },
  { value: 'Asia/Tokyo', label: '东京 (UTC+09:00)' },
  { value: 'Australia/Sydney', label: '悉尼 (UTC+10:00)' },
  { value: 'Pacific/Noumea', label: '努美阿 (UTC+11:00)' },
  { value: 'Pacific/Auckland', label: '奥克兰 (UTC+12:00)' }
];

let config = { enabled: true, activeRuleId: null, rules: [] };
let editingRule = null; // null = adding new, object = editing existing
```

- [ ] **Step 2: 编写 popup/popup.js（第 2 部分——存储操作）**

```js
/* ---- Storage ---- */
async function loadConfig() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY];
  if (stored) {
    config.enabled = stored.enabled !== false;
    config.activeRuleId = stored.activeRuleId || null;
    config.rules = stored.rules || [];
  }
}

async function saveConfig() {
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
}
```

- [ ] **Step 3: 编写 popup/popup.js（第 3 部分——UI 元素引用）**

```js
/* ---- DOM refs ---- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const masterToggle = $('#masterToggle');
const ruleListView = $('#ruleListView');
const ruleEditView = $('#ruleEditView');
const ruleList = $('#ruleList');
const addRuleBtn = $('#addRuleBtn');
const backBtn = $('#backBtn');
const editTitle = $('#editTitle');
const tzSearchInput = $('#tzSearchInput');
const tzDropdown = $('#tzDropdown');
const domainInput = $('#domainInput');
const domainAddBtn = $('#domainAddBtn');
const domainTagList = $('#domainTagList');
const saveRuleBtn = $('#saveRuleBtn');
const cancelRuleBtn = $('#cancelRuleBtn');
const deleteRuleBtn = $('#deleteRuleBtn');
```

- [ ] **Step 4: 编写 popup/popup.js（第 4 部分——时区搜索选择器）**

```js
/* ---- Timezone Search Select ---- */
let tzSelected = null;

function filterTimezones(query) {
  const q = query.toLowerCase();
  return TIMEZONES.filter(tz =>
    tz.label.toLowerCase().includes(q) ||
    tz.value.toLowerCase().includes(q)
  );
}

function renderTzDropdown(items) {
  tzDropdown.innerHTML = '';
  items.forEach(tz => {
    const div = document.createElement('div');
    div.className = 'search-option';
    div.dataset.value = tz.value;
    div.dataset.label = tz.label;
    div.innerHTML = `${tz.label}${tz.label === (tzSelected?.label || '') ? ' ✓' : ''}`;
    div.addEventListener('click', () => {
      tzSelected = tz;
      tzSearchInput.value = tz.label;
      tzDropdown.classList.add('hidden');
    });
    tzDropdown.appendChild(div);
  });
  tzDropdown.classList.toggle('hidden', items.length === 0);
}

tzSearchInput.addEventListener('input', () => {
  renderTzDropdown(filterTimezones(tzSearchInput.value));
});
tzSearchInput.addEventListener('focus', () => {
  renderTzDropdown(filterTimezones(tzSearchInput.value));
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#tzSearchSelect')) tzDropdown.classList.add('hidden');
});
```

- [ ] **Step 5: 编写 popup/popup.js（第 5 部分——域名输入管理）**

```js
/* ---- Domain Input ---- */
let domainList = [];

function addDomain(val) {
  const domain = val.trim().replace(/^https?:\/\//, '').split('/')[0];
  if (!domain || domainList.includes(domain)) return;
  domainList.push(domain);
  renderDomainTags();
  domainInput.value = '';
}

function removeDomain(domain) {
  domainList = domainList.filter(d => d !== domain);
  renderDomainTags();
}

function renderDomainTags() {
  domainTagList.innerHTML = '';
  domainList.forEach(domain => {
    const li = document.createElement('li');
    li.className = 'tag-item';
    li.innerHTML = `${domain} <button class="tag-remove" data-domain="${domain}">&times;</button>`;
    li.querySelector('.tag-remove').addEventListener('click', () => removeDomain(domain));
    domainTagList.appendChild(li);
  });
}

domainAddBtn.addEventListener('click', () => addDomain(domainInput.value));
domainInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addDomain(domainInput.value); }
});
```

- [ ] **Step 6: 编写 popup/popup.js（第 6 部分——规则列表渲染）**

```js
/* ---- Rule List ---- */
function renderRuleList() {
  ruleList.innerHTML = '';

  if (config.rules.length === 0) {
    const div = document.createElement('div');
    div.className = 'empty-state';
    div.textContent = '暂无时区规则，点击下方按钮添加';
    ruleList.appendChild(div);
    return;
  }

  config.rules.forEach(rule => {
    const li = document.createElement('li');
    li.className = 'rule-item' + (rule.id === config.activeRuleId ? ' active' : '');

    li.innerHTML = `
      <div class="rule-radio"></div>
      <div class="rule-info">
        <div class="rule-tz">${escapeHtml(rule.timezoneLabel)}</div>
        <div class="rule-domains">${escapeHtml(rule.domains.join(', '))}</div>
      </div>
      <button class="rule-delete" data-id="${rule.id}">&times;</button>
    `;

    // 点击规则行 → 编辑
    li.querySelector('.rule-info').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditView(rule);
    });
    li.querySelector('.rule-radio').addEventListener('click', (e) => {
      e.stopPropagation();
      activateRule(rule.id);
    });
    // 点击域名字段 → 编辑
    li.addEventListener('click', () => openEditView(rule));

    li.querySelector('.rule-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteRule(rule.id);
    });

    ruleList.appendChild(li);
  });
}

function activateRule(id) {
  config.activeRuleId = config.activeRuleId === id ? null : id;
  saveConfig().then(renderRuleList);
}

function deleteRule(id) {
  config.rules = config.rules.filter(r => r.id !== id);
  if (config.activeRuleId === id) config.activeRuleId = null;
  saveConfig().then(renderRuleList);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
```

- [ ] **Step 7: 编写 popup/popup.js（第 7 部分——编辑视图与初始化）**

```js
/* ---- Edit View ---- */
function openEditView(rule = null) {
  editingRule = rule;
  domainList = rule ? [...rule.domains] : [];
  tzSelected = rule ? TIMEZONES.find(t => t.value === rule.timezone) || null : null;

  editTitle.textContent = rule ? '编辑时区规则' : '添加时区规则';
  tzSearchInput.value = tzSelected ? tzSelected.label : '';
  deleteRuleBtn.classList.toggle('hidden', !rule);

  renderDomainTags();
  switchToEditView();
}

function switchToEditView() {
  ruleListView.classList.add('hidden');
  ruleEditView.classList.remove('hidden');
}

function switchToListView() {
  ruleEditView.classList.add('hidden');
  ruleListView.classList.remove('hidden');
  editingRule = null;
  tzSelected = null;
  domainList = [];
  tzSearchInput.value = '';
  domainInput.value = '';
  renderRuleList();
}

function saveRule() {
  if (!tzSelected) return;
  if (domainList.length === 0) return;

  if (editingRule) {
    editingRule.timezone = tzSelected.value;
    editingRule.timezoneLabel = tzSelected.label;
    editingRule.domains = [...domainList];
  } else {
    config.rules.push({
      id: 'r' + Date.now(),
      timezone: tzSelected.value,
      timezoneLabel: tzSelected.label,
      domains: [...domainList]
    });
  }

  saveConfig().then(switchToListView);
}

/* ---- Event bindings ---- */
addRuleBtn.addEventListener('click', () => openEditView(null));
backBtn.addEventListener('click', switchToListView);
cancelRuleBtn.addEventListener('click', switchToListView);
saveRuleBtn.addEventListener('click', saveRule);
deleteRuleBtn.addEventListener('click', () => {
  if (editingRule) {
    deleteRule(editingRule.id);
    switchToListView();
  }
});

masterToggle.addEventListener('change', () => {
  config.enabled = masterToggle.checked;
  saveConfig();
});

/* ---- Init ---- */
async function init() {
  await loadConfig();
  masterToggle.checked = config.enabled;
  renderRuleList();
}

init();
```

- [ ] **Step 8: Commit**

```bash
git add popup/popup.js
git commit -m "feat: add popup logic with rule CRUD, searchable timezone picker"
```

---

### Task 7: 集成验证

无新文件，在浏览器中手动验证。

- [ ] **Step 1: 加载插件**

打开 `chrome://extensions`，启用"开发者模式"，点击"加载已解压的扩展程序"，选择项目根目录 `timezone-switch/`。

- [ ] **Step 2: 验证 popup**

点击工具栏插件图标，确认：
- 弹窗正常显示，标题"时区切换"可见
- 总开关默认开启
- 显示空状态提示"暂无时区规则"
- 点击"+ 添加新时区规则"进入编辑表单

- [ ] **Step 3: 验证添加规则**

在编辑表单中：
- 搜索时区"东京"，选择"东京 (UTC+09:00)"
- 输入域名 `example.jp` 回车添加，再输入 `httpbin.org` 添加
- 点击保存
- 规则列表中出现新规则

- [ ] **Step 4: 验证时区覆盖**

- 选中刚创建的规则的 radio（○ → ●）
- 在地址栏输入 `httpbin.org/get` 回车
- 按 F12 打开控制台，输入：`new Date().getTimezoneOffset()`
- 应返回 -540（即 UTC+09:00 东京时区）
- 输入 `Intl.DateTimeFormat().resolvedOptions().timeZone`
- 应返回 `"Asia/Tokyo"`

- [ ] **Step 5: 验证未匹配域名不受影响**

- 访问非 `httpbin.org` 的任意网站
- 控制台 `new Date().getTimezoneOffset()` 应返回系统默认值

- [ ] **Step 6: 验证总开关**

- 关闭总开关
- 刷新 `httpbin.org`
- 控制台 `new Date().getTimezoneOffset()` 应返回系统默认值

- [ ] **Step 7: Commit**

```bash
git commit --allow-empty -m "test: integration verification checklist completed"
```
