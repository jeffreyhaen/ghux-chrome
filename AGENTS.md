# GHUX Agent Guidance

## Scope And Priorities

This file applies to the whole repository. Use `README.md` and the current `manifest.json` as the primary product and runtime references. Preserve the extension's Manifest V3, GitHub-only scope, and no-build-step workflow.

## Repository Shape

- This repository is public shared on [Github](https://github.com/jeffreyhaen/ghux-chrome) for other users.
- `manifest.json` is the MV3 entry point and explicitly lists every content-script CSS and JavaScript file.
- `content.js` owns route detection, page-level `data-ghux-*` attributes, feature defaults, and storage-change handling.
- `features/<feature>/` contains one feature's runtime code and styles. Feature scripts are loaded as isolated IIFEs and react to GitHub's dynamic DOM with observers/navigation events.
- `popup/` contains the extension settings UI. Feature toggles use `chrome.storage.sync`; the GitHub token uses `chrome.storage.local`.
- `icons/` contains extension assets. `.lavish/` is ignored working output and is not part of the extension runtime.

## Working Principles

- Keep CSS scoped to the relevant `html[data-ghux-page]` and feature data attributes so embedded GitHub views are not changed accidentally.
- Follow existing feature patterns: namespace DOM markers/classes with `ghux-`, make rendering idempotent, observe GitHub re-renders, and remove injected UI when a feature or route becomes inactive.
- Keep route-specific behavior in the relevant feature directory. Change `content.js` only for shared routing, feature metadata, storage state, or navigation signaling.
- When adding or renaming a feature, update all applicable coordination points together: `manifest.json`, the `FEATURES` list in `content.js`, popup controls/defaults in `popup/popup.html` and `popup/popup.js`, the diff settings menu in `features/settings-indicator/indicator.js` when applicable, and `README.md`.
- Preserve existing public selectors, storage keys, data attributes, and manifest paths unless the corresponding behavior is intentionally migrated.
- Use GitHub's existing DOM and API contracts where possible. API requests must use the configured token and the permissions already declared in `manifest.json`.

## Boundaries And Safety

- Do not commit GitHub tokens or other credentials. Keep token handling in `chrome.storage.local`; do not move it to sync storage.
- Keep destructive github commands behind confirmation flows and GitHub API token requirement.
- Do not broaden `host_permissions` or extension permissions without a feature requirement and matching documentation.
- Do not edit git ignored artifacts as part of the extension implementation.

## Development and verification

There is no package manifest, build script, test configuration, linter configuration, or CI workflow in this repository. Edit the source files directly.

After changes:

1. Open `chrome://extensions` and reload the unpacked GHUX extension.
2. Exercise the affected popup setting and GitHub route described in `README.md`.
3. Check GitHub SPA navigation and dynamic re-rendering when the feature injects UI.
4. For API-backed features, verify both the no-token/fallback state and the configured-token state without exposing the token.
5. Confirm unrelated GitHub pages and embedded diffs remain unchanged.

## Documentation

Update `README.md` when features, defaults, routes, token requirements, or installation/development behavior change. Keep the readme concise.