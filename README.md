# Mobile Webviewer

Mobile Webviewer is a lightweight, mobile-first web viewer for Obsidian.

It now has two clearly named modes:

- **Browser View**: the original plugin pane, designed like a normal mobile
  browser with a top address/search input, page area, bottom controls, history,
  bookmarks, external-open fallback, and one-tap link capture.
- **Note Browser**: a real Markdown note named `Mobile Webviewer.md` with HTML
  elements rendered inside the note. The plugin enhances that note with a
  Bing-like lightweight search shell and Markdown-style page rendering.

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
- Keep local history.
- Add/remove bookmarks.
- Use a mobile bottom toolbar.
- Open the current page in the system browser.
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

## Known limits

Obsidian community plugins cannot fully replace a native browser engine. Some
sites block iframe embedding through `X-Frame-Options` or CSP. For those pages,
use the external-open button.

Request interception, real ad blocking, and user-agent spoofing are not reliable
from a normal Obsidian plugin on mobile, so this plugin keeps those as future
native-wrapper possibilities instead of pretending they are solved.
