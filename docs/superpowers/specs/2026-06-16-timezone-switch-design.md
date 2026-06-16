# Timezone Switch 插件设计文档

## 概述

Chrome/Edge 通用浏览器扩展，根据域名将页面时间偏移到指定时区。点击插件图标弹出配置页，添加时区规则（时区 + 域名），单选某条规则启用，匹配的域名下页面时间表现为目标时区，未匹配域名不受影响。

## 技术方案

- **时区覆盖方式**: JS 注入（方案 A），content script 覆盖 `Intl.DateTimeFormat`、`Date.prototype.toLocaleString`/`getTimezoneOffset` 等 API
- **UI 技术栈**: 纯 HTML/JS/CSS
- **存储**: `chrome.storage.local`
- **构建**: 无构建工具，直接加载开发目录

## 架构

### 文件结构

```
timezone-switch/
├── manifest.json
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── scripts/
│   ├── background.js      # Service Worker
│   └── content.js         # 时区覆盖脚本
└── icons/
    └── icon-*.png
```

### 数据流

1. 用户点击插件图标 → popup 打开，读取 `chrome.storage.local` 展示规则列表
2. 用户操作（增删改规则、切换启用、开关总控）→ 写入 `chrome.storage.local`
3. 页面导航 → background 监听 `tabs.onUpdated`，检查总开关 + 启用规则 + 域名匹配
4. 匹配成功 → `chrome.scripting.executeScript(content.js)` 注入时区覆盖
5. content.js 劫持时间相关 API，偏移到目标时区

### 组件职责

| 组件 | 职责 |
|------|------|
| popup.html/css | 弹窗 UI 布局、主题样式 |
| popup.js | 规则管理、时区选择器、存储读写 |
| background.js | 标签页监听、域名匹配、注入调度 |
| content.js | 覆盖 Date/Intl API，偏移到目标时区 |

## 数据模型

```js
// chrome.storage.local key: "timezoneConfig"
{
  enabled: true,                // 总开关
  activeRuleId: "r1",          // 当前启用的规则 ID
  rules: [
    {
      id: "r1",
      timezone: "Asia/Tokyo",
      timezoneLabel: "东京 (UTC+09:00)",
      domains: ["example.jp", "api.example.jp"]
    }
  ]
}
```

## UI 设计

### 弹窗主页面

- 顶部：插件名称 + 总开关（toggle）
- 中间：规则列表，每条显示时区名、域名标签
- 每条规则前有 radio button（○），选中即启用
- 底部：[+ 添加新时区规则] 按钮

### 添加/编辑规则弹窗

- 时区选择器：可搜索下拉框，支持按城市名、UTC 偏移、IANA 名称搜索
- 域名输入框 + 添加按钮，回车也可添加
- 已添加域名以 tag + ✕ 形式展示
- 保存 / 取消 按钮

## Content Script 覆盖策略

注入后劫持以下 API：

1. `Date.prototype.getTimezoneOffset` → 返回目标时区偏移
2. `Date.prototype.toLocaleString` / `toLocaleTimeString` / `toLocaleDateString` → 强制使用目标时区
3. `Intl.DateTimeFormat.prototype.format` / `formatToParts` / `resolvedOptions` → 注入目标时区

`Date.now()` 和 `new Date().getTime()` 返回 UTC 时间戳，不受影响，无需覆盖。

## 权限

```json
{
  "permissions": ["storage", "activeTab", "scripting"],
  "host_permissions": ["<all_urls>"]
}
```

- `storage`: 保存规则配置
- `scripting`: 注入 content script
- `host_permissions`: 匹配任意域名（注入时按域名匹配规则过滤）

## 开发与发布

- 开发：chrome://extensions → "加载已解压的扩展程序" → 选择项目目录
- 发布：打包 `.zip` → Chrome Web Store / Edge Add-ons
