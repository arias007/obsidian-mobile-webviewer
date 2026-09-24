# Mobile Webviewer 开放 API

> 适用版本：main（0.4.39+）· API 版本 `1.0.0`（`MOBILE_WEBVIEWER_API_VERSION`）

其他 agent、插件或控制台脚本可以通过**两种等价方式**访问本插件的全部底层能力：

```js
// 方式一：全局别名（推荐，onload 时挂载，onunload 时移除）
const MWV = window.MWV;

// 方式二：Obsidian 插件注册表
const MWV = window.app.plugins.plugins["mobile-webviewer"].api;
```

两者是同一个对象。所有方法前后台均可调用（命令面板脚本、Timers、其他插件、自动化 agent 均可）。

## 能力总览

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `apiVersion` | `string` | API 版本号 |
| `getCapabilities()` | `→ Record` | 插件能力清单 |
| `getStatus()` | `→ Record` | 运行状态（版本、标签页数等） |
| `open(input)` | `string \| {url, newTab, mode}` | 打开网页（view=NoteWeb / note=阅读模式） |
| `listTabs()` | `→ MobileWebviewerTabSummary[]` | 标签页列表（含 active 标记） |
| `getActiveTab()` | `→ TabSummary \| null` | 当前活动标签页 |
| `newTab(input)` | `string \| {url}` | 新建标签页 |
| `switchTab(input)` | `string \| {id}` | 切换标签页 |
| `closeTab(input)` | `string \| {id}` | 关闭标签页 |
| `readPage(input)` | `string \| {url, maxChars, refresh}` | 抓取并解析网页为正文/链接/图片 |
| `getCurrentContext(options)` | `→ MobileWebviewerContext` | 当前页面完整上下文 |
| `getSelection()` | `→ {text, url, title}` | 页内选中文本 |
| `execInPage(input)` | `{tabId?, code}` | **在活动网页内执行任意 JS 并取回返回值** |
| `listBookmarks()` | `→ {url,title,time}[]` | 书签 |
| `listHistory()` | `→ {url,title,time}[]` | 历史 |
| `listReadingList()` | `→ {url,title,time}[]` | 稍后读 |
| `toggleBookmark(input)` | `{url?, title?}` | 收藏/取消收藏 |
| `addToReadingList(input)` | `{url?, title?}` | 加入稍后读 |
| `listUserScripts()` | `→ {id,name,match,enabled,runAt}[]` | 用户脚本规则 |
| `importUserscript(source)` | `string` | 导入油猴脚本（需 `==UserScript==` 头） |
| `setUserScriptEnabled(id, enabled)` | `(string, boolean)` | 启停某条脚本 |
| `sendToCancip(input)` | `{prompt?, submit?}` | 把当前网页上下文发给 Cancip |
| `subscribe(listener)` | `(event) => void` | 订阅事件流（navigate/tab-change/tab-close/bookmark-change/reading-list-change） |

## 常用示例

```js
// 导航：新标签打开页面
await window.MWV.open({ url: "https://www.bing.com/", newTab: true });

// 读当前页
const ctx = await window.MWV.getCurrentContext({ includeContent: true });
console.log(ctx.title, ctx.content.slice(0, 200));

// 页内执行：取当前页所有链接（前台+后台皆可）
const r = await window.MWV.execInPage({ code: "Array.from(document.querySelectorAll('a')).map(a => a.href).slice(0, 10)" });
console.log(r.ok, r.result);

// 页内执行：滚动/点击/填表
await window.MWV.execInPage({ code: "window.scrollTo(0, document.body.scrollHeight)" });

// 书签/历史
window.MWV.listBookmarks();
await window.MWV.toggleBookmark({ url: "https://obsidian.md/", title: "Obsidian" });

// 导入油猴脚本（完整源码，含 ==UserScript== 元数据块）
await window.MWV.importUserscript(`
// ==UserScript==
// @name   示例脚本
// @match  *://example.com/*
// @run-at document-idle
// @grant  GM_addStyle
// ==/UserScript==
GM_addStyle("body{outline:2px solid red}");
`);

// 事件订阅（后台 agent 监听导航）
window.MWV.subscribe((event) => {
  if (event.type === "navigate") console.log("navigated:", event.url);
});
```

## 油猴（Tampermonkey）兼容层

- **导入**：设置 → 用户脚本规则 → 「用户脚本」按钮，粘贴完整脚本源码；或调 `importUserscript(source)`。
- **解析**：自动读取 `@name`、`@match`（多个取第一个）、`@include`（fallback）、`@run-at`（document-start/end/idle，缺省 idle）、`@description`、`@version`。
- **注入时机**：`document-start` 在 dom-ready；`document-end` / `document-idle` 在 did-finish-load（页面加载完成）。同一脚本对同一 URL 只运行一次。
- **GM_* API 支持**：

| API | 实现 |
| --- | --- |
| `GM_addStyle(css)` | 注入 `<style>` |
| `GM_getValue/GM_setValue/GM_deleteValue/GM_listValues` | 页面 localStorage（键前缀 `__mwvGm:<ruleId>:`，持久化） |
| `GM_xmlhttpRequest(details)` | fetch 实现，支持 method/headers/data/responseType/onload/onerror/abort |
| `GM_setClipboard(text)` | navigator.clipboard |
| `GM_notification(text, title)` | console 输出 |
| `GM_openInTab(url)` | window.open |
| `GM_registerMenuCommand/GM_unregisterMenuCommand` | 注册到 `window.__mwvGmMenus`（可经 `execInPage` 触发） |
| `GM_info` | 脚本元信息 |
| `unsafeWindow` | 页面真实 window |

- **内置预设**（设置里可启停）：网页复制限制解除（document-end）、返回顶部按钮（document-idle）、双击显示密码（document-idle）。
- 开关：`settings.userScriptsEnabled`（默认开）。reader 层规则（runAt=`reader`）维持原有行为。

## 注意事项

- `execInPage` 只作用于**活动表面**（主视图或可见 embed 的 webview）；若指定 `tabId` 必须与活动标签一致，否则返回错误提示先 `switchTab`。
- `GM_xmlhttpRequest` 走页面自身 fetch，受目标页 CSP 限制（跨域被 connect-src 拦截时会走 onerror）。
- 脚本存储上限 40 条规则。
- 破坏性动作（关闭标签页、改书签）会通过 `subscribe` 广播事件，后台 agent 可据此同步状态。
