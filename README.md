<p align="center">
  <img src="icons/icon_full.png" alt="GHUX logo" width="180">
</p>

<h1 align="center">GHUX - GitHub UX</h1>

Chrome extension that improves the GitHub code review experience.

## Features

- Toggle word wrapping in diffs (off by default)
- Enhance split-view diffs with a draggable divider, synchronized scrolling, and scrollbar bars that stay pinned to the viewport bottom while scrolling long files (on by default)
- Diff minimap per file: a marker strip showing where additions/deletions are after using "Expand all lines"; click a marker to jump to it (on by default)
- Quick review actions on pull request pages: an Azure DevOps style Approve split button in the Reviewers sidebar — approve, approve with a fixed comment, or request changes in one click (on by default)
- Access settings from the extension popup or GitHub's diff settings menu

Works on GitHub pull request, commit, and compare diff pages.

## Quick review actions

The review buttons work out of the box by automating GitHub's own review form.
For instant, navigation-free reviews you can configure a personal access token
in the extension popup (stored locally, never synced):

- Fine-grained token with **Pull requests: read/write** (per organization), or
- Classic token with the **repo** scope (works across all organizations)

If your organization enforces SAML SSO, authorize the token via **Configure SSO**.
Without a token, GHUX falls back to form automation.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Select **Load unpacked**
4. Choose this repository

Open a GitHub diff page and use the GHUX icon to configure the features.

## Development

GHUX is a Manifest V3 extension with no build step. After making changes, reload the extension from `chrome://extensions`.

## License

MIT
