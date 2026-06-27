# Mobile Webviewer

Mobile Webviewer is a lightweight, mobile-first web viewer for Obsidian.

It now has two clearly named modes:

- **Browser View**: the original plugin pane, designed like a normal mobile
  browser with a top address/search input, page area, bottom controls, history,
  downloads, bookmarks, reading list, cache controls, console copy, import/export,
  and one-tap
  link capture. It includes a persistent mobile tab strip with per-tab URL and
  back/forward state. The foreground is now an editable, reader-style Obsidian
  web note by default. A full Chromium `webview` page stays loaded behind it for
  real browser navigation and can be switched in with Note/Web/Split controls.
  Edited text and doodles auto-save into plugin data. Use `存 MD` when you
  want to add a Markdown file to the vault.
  On mobile it uses a full-height browser layout with the Obsidian pane header
  hidden and the bottom toolbar floating over the page instead of shrinking the
  webview.
- Real-page navigation now catches `target=_blank` and `window.open` in the
  Chromium webview and routes them to browser tabs, so page jumps behave more
  like Chrome/Edge instead of falling back to the home shell.
- **Note Browser**: a real Markdown note named `Mobile Webviewer.md` with HTML
  elements rendered inside the note. The plugin enhances that note with a
  Bing-like lightweight search shell, editable web-note foreground, live web
  backend,
  bookmarks bar, cache, downloads, history, and More menu. NoteDraw buttons are
  deduped so Mobile Webviewer surfaces keep one visible magic-wand launcher
  while still using NoteDraw's real page controller behind it.

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
- Use an editable reader-style note as the foreground while keeping a full
  browser page loaded in the background.
- Switch between Note, Web, and Split modes.
- Auto-save edited text and doodles into plugin data, then export to Markdown
  under `Mobile Webviewer Notes` with `存 MD`.
- Keep Note Browser and Browser View on the same URL-backed web-note data, so
  edited text and doodles follow the page when switching modes.
- Load multi-page Bing results with a More results control instead of stopping
  after the first compact result set.
- Load URLs or search text from one input.
- Use multiple persistent browser tabs.
- Open popup/new-window links as real browser tabs and keep titles, URLs, load
  state, and hover/context-link status synchronized with the browser shell.
- Find text inside the live page where accessible and inside the reader/search
  layer.
- Zoom pages and switch between mobile and desktop-width surfaces.
- Choose mobile or desktop page width.
- Switch mobile/desktop request UA for internal fetch, search, save, and
  download requests.
- Toggle night mode, eye-protection mode, incognito mode, fullscreen, rotation,
  JavaScript sandbox blocking, ad blocking, and ad marking from More.
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
- Inspect the active browser surface from More, including whether the current
  page is using real Electron Chromium `webview` or iframe fallback, current
  URL, loading state, back/forward availability, zoom, UA mode, and download
  folder.
- Catch common downloadable links inside the live webview and route them to the
  plugin Downloads panel.
- Open downloaded files from the Downloads panel or reveal their location when
  the desktop shell exposes that capability.
- Run global reader-layer custom CSS and JavaScript.
- Manage URL-matched user script rules with wildcard matching, per-rule enable
  switches, CSS, and JavaScript.
- Sniff media resources, list page resources, view source, translate pages to
  many target languages or follow Obsidian's current UI language, read page text
  aloud, generate a QR-code panel, copy share text, report URL text, and create
  a `.url` shortcut file.
- Export and import a portable Mobile Webviewer JSON package for bookmarks,
  reading list, history, downloads, user scripts, web notes, and common
  settings. Clipboard import also accepts common bookmark HTML and plain URL
  lists.
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

## Browser model

The plugin uses a dual-layer model. The foreground is an editable Obsidian-like
web note extracted from the page, suitable for reading, editing, highlighting,
and doodling. The background keeps the complete browser page alive with
Electron Chromium `webview` when Obsidian exposes it, falling back to iframe
where needed. Note/Web/Split controls switch between the editable note, the
real page, and both together. More contains power actions such as system-browser
open, copy link, bookmark, reading list, history, downloads, matched user
scripts, browser-status inspection, console, QR code, and cache management.
Downloads are saved under `Mobile Webviewer Downloads` by default and can be
configured in settings. The home shell expands to the available mobile screen
and avoids browser suggestion overlays that can cover the keyboard.
