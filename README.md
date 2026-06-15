# Mobile Webviewer

Mobile Webviewer is a lightweight, mobile-first web viewer for Obsidian.

It now has two clearly named modes:

- **Browser View**: the original plugin pane, designed like a normal mobile
  browser with a top address/search input, page area, bottom controls, history,
  downloads, bookmarks, reading list, cache controls, console copy, and one-tap
  link capture. It includes a persistent mobile tab strip with per-tab URL and
  back/forward state. Normal pages are shown through a live web surface first,
  with the reader/cache layer below it. System-browser opening is kept inside
  the More menu, not the main browser chrome.
- **Note Browser**: a real Markdown note named `Mobile Webviewer.md` with HTML
  elements rendered inside the note. The plugin enhances that note with a
  Bing-like lightweight search shell, live page surface, reader layer,
  bookmarks bar, cache, downloads, history, and More menu.

## Install

Copy these files into your vault:

```text
.obsidian/plugins/mobile-webviewer/
  manifest.json
  main.js
  styles.css
```

Then reload Obsidian and enable **Mobile Webviewer** in Community plugins.

## What it can do

- Open the original browser-like view inside Obsidian.
- Open the note-based browser shell as a real Markdown file.
- Load URLs or search text from one input.
- Use multiple persistent browser tabs.
- Find text inside the live page where accessible and inside the reader/search
  layer.
- Zoom pages and switch between mobile and desktop-width surfaces.
- Choose mobile or desktop page width.
- Switch mobile/desktop request UA for internal fetch, search, save, and
  download requests.
- Toggle night mode, eye-protection mode, no-image mode, incognito mode,
  fullscreen, rotation, JavaScript sandbox blocking, ad blocking, and ad
  marking from More.
- Keep local history.
- Save the current page as HTML.
- Save the current page as MHT/MHTML with a compact set of fetched page
  resources when available.
- Download the current URL as a file into the configured vault folder.
- Use parallel byte-range downloads when the server supports resumable ranges;
  otherwise the plugin automatically uses a single connection.
- Add/remove bookmarks.
- Save pages to the reading list.
- Reuse cached reader pages.
- View or copy console/navigation logs from More.
- Run global reader-layer custom CSS and JavaScript.
- Manage URL-matched user script rules with wildcard matching, per-rule enable
  switches, CSS, and JavaScript.
- Sniff media resources, list page resources, view source, open developer
  resource tools, translate pages to many target languages or follow Obsidian's
  current UI language, read page text
  aloud, generate a QR-code panel, copy share text, report URL text, and create
  a `.url` shortcut file.
- Autofill accessible form fields from a local profile.
- Use a richer settings console with grouped browser, display, download,
  script, autofill, data, and support-code controls.
- Use a mobile bottom toolbar.
- Open the current page in the system browser from More.
- Insert the current page as a Markdown link into the active note.
- Show a NoteDraw-style magic-wand button and trigger NoteDraw where available.
- Open links through Obsidian's link menu where supported.
- Open `obsidian://mobile-webviewer?url=https%3A%2F%2Fexample.com`.

## Commands

- `Mobile Webviewer: Open Note Browser`
- `Mobile Webviewer: Open Note Browser Home`
- `Mobile Webviewer: Open URL in Note Browser`
- `Mobile Webviewer: Open Browser View`
- `Mobile Webviewer: Open URL in Browser View`

## Browser model

The plugin first tries to show pages inside Obsidian with the live surface and
reader/cache layer. More contains power actions such as system-browser open,
copy link, bookmark, reading list, history, downloads, matched user scripts,
console, and cache management. Downloads are saved under `Mobile Webviewer
Downloads` by default and can be configured in settings.
