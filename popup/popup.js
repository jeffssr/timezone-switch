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
let editingRule = null;

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
    const escaped = escapeHtml(domain);
    li.innerHTML = `${escaped} <button class="tag-remove">&times;</button>`;
    li.querySelector('.tag-remove').addEventListener('click', () => removeDomain(domain));
    domainTagList.appendChild(li);
  });
}

domainAddBtn.addEventListener('click', () => addDomain(domainInput.value));
domainInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addDomain(domainInput.value); }
});

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

    li.querySelector('.rule-info').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditView(rule);
    });
    li.querySelector('.rule-radio').addEventListener('click', (e) => {
      e.stopPropagation();
      activateRule(rule.id);
    });
    li.addEventListener('click', () => openEditView(rule));

    li.querySelector('.rule-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`确定删除规则「${rule.timezoneLabel}」？`)) deleteRule(rule.id);
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
  if (!tzSelected) { alert('请选择时区'); return; }
  if (domainList.length === 0) { alert('请至少添加一个域名'); return; }

  if (editingRule) {
    editingRule.timezone = tzSelected.value;
    editingRule.timezoneLabel = tzSelected.label;
    editingRule.domains = [...domainList];
  } else {
    config.rules.push({
      id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
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
    if (confirm(`确定删除规则「${editingRule.timezoneLabel}」？`)) {
      deleteRule(editingRule.id);
      switchToListView();
    }
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
