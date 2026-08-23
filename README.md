# GHUX - GitHub UX

Chrome extension (Manifest V3) that improves the GitHub review experience. First feature: word wrap in diffs. Built to grow: new features plug into a small feature router.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select this folder
4. Open a PR "Files changed" page and toggle via the GHUX icon in the toolbar

## Features

### Word wrap in diffs (default: off)

GitHub's logged-in React diff view wraps long lines by default (`white-space: pre-wrap` + `overflow-wrap: break-word`), chopping long tokens mid-word. GHUX makes wrap a deterministic toggle:

- **Off**: one code line = one visual line, matching the raw file. Forces `white-space: pre`, switches the diff table to `table-layout: auto` and gives the table wrapper a horizontal scrollbar.
- **On**: GitHub-style wrapping, forced explicitly.

Works in unified and split view on PR "Files changed"/"Changes", commit and compare pages. Compare pages use GitHub's server-rendered classic markup (`table.diff-table`) — supported via a separate code path (see below). Line numbers stay aligned (number and code share a `<tr>`). Purely visual: copy/paste, suggestions and comment anchoring are unaffected.

### Split view (default: on)

Enhances GitHub's split (side-by-side) diff view:

- **Draggable divider** between the two panes; ratio persists in `chrome.storage.sync` (`splitRatio`), applied via the `--ghux-split` CSS var.
- **Two horizontal scrollbars per file diff** (Azure DevOps style): one under each half. Scrolling either bar — or any code line directly, e.g. trackpad — scrolls **both sides together** (absolute sync, like ADO); the shorter side simply stops at its own end. Line-number columns stay put.
- **Block scrolling**: every line of a side gets an invisible `::after` spacer (`--ghux-pad`) equalizing its scroll range to the longest line, so a side moves as one block instead of only the long lines. A per-side high-water mark keeps the range stable while GitHub virtualizes rows; ranges recompute on content mutations (e.g. async syntax highlighting) and resize.
- Only active when word wrap is off (wrap on = GitHub's default wrapping, no horizontal scroll needed).

Verified live selectors (React view): `td.diff-text-cell`, `td.left-side-diff-cell` / `td.right-side-diff-cell`, `.diff-text`, `.diff-text-inner`, `tr.diff-line-row`. Note: nested `:has()` is invalid CSS, so the wrapper scroll rule uses single-level `:has(> table > tbody > tr.diff-line-row)`.

Classic view (compare pages, logged-out): `table.diff-table`, split variant `table.diff-table.file-diff-split`, rows `[numL, codeL, numR, codeR]` (empty sides: `.blob-code-empty`, no inner), code span `.blob-code-inner` (a `span` with `display: table-cell` — GHUX makes it `display: block` to make it scrollable). The table has NO overflow container anywhere in its ancestor chain (GitHub wraps via its own `pre-wrap`), so wrap-off without a scroll mechanism stretches the whole page (measured live: 2179px vs 1745px viewport). Unified classic: wrapper gets `overflow-x: auto` + `table-layout: auto`. Split classic: per-line scrolling + ADO bars, same as React view. The first row is a `thead.sr-only` accessibility header (position: absolute) — never use it for measurements; `tBodies[0]` only.

- CSS is scoped under `html[data-ghux-page="diff"][data-ghux-wrap="on"|"off"]`, so the popup toggle works without a page reload
- **Page gating**: `content.js` sets `data-ghux-page="diff"` only on diff main pages (`/pull/<n>/files`, `/pull/<n>/changes` (GitHub's new PR diff experience — same React view, verified live), `/pull/<n>/commits/<sha>`, `/commit/<sha>`, `/compare/<range>`) and clears all `data-ghux-*` attributes elsewhere. Every CSS rule requires `data-ghux-page="diff"`, so embedded diffs on other pages — PR conversation comments, suggested changes — are never touched. Re-evaluated on Turbo navigations, `popstate`, and URL changes from GitHub's React router.
- Injected via manifest `content_scripts.css`, so GitHub's CSP never blocks it and it survives lazy-loaded diffs and Turbo navigations

## Architecture

```
manifest.json          MV3, host permission github.com only
content.js             feature router: reads chrome.storage.sync, applies feature state
features/word-wrap/    one folder per feature (css/js)
popup/                 toolbar popup with toggles
```

A feature is `{ id, storageKey, defaultValue, attr }`. CSS-only features scope their rules under `html[data-ghux-page="diff"]` plus their feature attribute, so toggling never needs reinjection.

## Notes / known risks

- GitHub changes class names regularly. Selectors are centralized per feature for quick fixes.
- The selectors were verified live (via Chrome DevTools Protocol) against the logged-in React diff view of a PR files page, and the classic selectors against a compare page.
- GitHub Enterprise: add your domain via `optional_host_permissions` later.

## Roadmap ideas

- Word wrap toggle for file (blob) view
- Full-width diff layout
- Collapse resolved review threads by default
- "Mark all files viewed" / persist file filter
- Jump-to-next-file hotkeys in PR files

## License

MIT
