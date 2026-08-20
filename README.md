# GHUX - GitHub UX

Chrome extension (Manifest V3) that improves the GitHub review experience. First feature: word wrap in diffs. Built to grow: new features plug into a small feature router.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select this folder
4. Open a PR "Files changed" page and toggle via the GHUX icon in the toolbar

## Features

### Word wrap in diffs (default: on)

GitHub renders diff lines with `white-space: pre`, so long lines are only reachable via horizontal scroll. This feature overrides that with `white-space: pre-wrap` on `.blob-code` / `.blob-code-inner` inside `table.diff-table`.

- Works in unified and split view, on PR "Files changed", commit and compare pages (same markup)
- Line numbers stay aligned: number and code live in the same `<tr>`, so the row grows with the wrapped line
- Purely visual: copy/paste, suggestions and comment anchoring are unaffected
- CSS is scoped under `html[data-ghux-wrap="on"]`, so the popup toggle works without a page reload
- Injected via manifest `content_scripts.css`, so GitHub's CSP never blocks it and it survives lazy-loaded diffs and Turbo navigations

## Architecture

```
manifest.json          MV3, host permission github.com only
content.js             feature router: reads chrome.storage.sync, applies feature state
features/word-wrap/    one folder per feature (css/js)
popup/                 toolbar popup with toggles
```

A feature is `{ id, storageKey, defaultValue, apply(on) }`. CSS-only features scope their rules under an `html[data-...]` attribute so toggling never needs reinjection.

## Notes / known risks

- GitHub changes class names regularly. Selectors are centralized per feature for quick fixes.
- The selectors were verified against the server-rendered PR diff page. If a logged-in React diff view uses different markup, inspect and extend the selector list in `features/word-wrap/wrap.css`.
- GitHub Enterprise: add your domain via `optional_host_permissions` later.

## Roadmap ideas

- Word wrap toggle for file (blob) view
- Full-width diff layout
- Collapse resolved review threads by default
- "Mark all files viewed" / persist file filter
- Jump-to-next-file hotkeys in PR files
