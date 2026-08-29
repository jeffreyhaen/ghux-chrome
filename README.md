<p align="center">
  <img src="icons/icon_full.png" alt="GHUX logo" width="180">
</p>

<h1 align="center">GHUX - GitHub UX</h1>

Chrome extension that improves the GitHub code review experience similar to Azure DevOps.

## Features

**Diff pages** (pull requests, commits, compare):

- **Word wrap** — toggle word wrapping in diffs (off by default)
- **Split view enhancements** — draggable divider, synchronized scrolling, and scrollbar bars that stay pinned to the viewport bottom while scrolling long files (on by default)
- **Diff minimap** — marker strip per file showing where additions/deletions are after using "Expand all lines"; click a marker to jump to it (on by default)

**Pull request pages**:

- **Quick review actions** — Azure DevOps style Approve split button in the Reviewers sidebar: approve, approve with a fixed comment, or request changes in one click (on by default)
- **Commit grouping** — consecutive push blocks in the conversation timeline collapse into one summary row (“pushed 36 commits · 5 days ago → 2 days ago”), keeping the 3 most recent commits visible; click the row to expand the original list again (on by default)

**Profile repositories tab** (`/<you>?tab=repositories`):

- **Repo cleanup** — delete button (trash icon) next to the Star dropdown on each of your own repositories; asks you to type the repo name to confirm and deletes via the GitHub API (off by default, requires a token)

**Pull request list** (`/<owner>/<repo>/pulls`):

- **PR dashboard** — replaces the native pull request list with an Azure DevOps board style table: Open/Draft state badges, checks status, creator avatars, open/resolved comment chips, reviewer avatars with status rings, branch flow (head → base), plus its own filter/search/sort toolbar and a ⇄ toggle back to the native list (on by default, requires a token)

All features can be toggled from the extension popup or GitHub's diff settings menu.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Select **Load unpacked**
4. Choose this repository

Open a GitHub page and use the GHUX icon to configure the features.

## GitHub API token (optional)

Some features can use the GitHub REST API instead of automating the GitHub
interface, which makes them faster and more reliable. These features work
without a token, but fall back to UI automation.

Currently used by: **quick review actions** (optional), **repo cleanup**
(required — a repository can only be deleted through the API) and **PR
dashboard** (required — reviewer statuses and resolved comment counts come
from the GraphQL API).

Configure it once in the extension popup — all API-based features share the
same token. The token is stored locally (`storage.local`), never synced.

Which token to create:

- **Fine-grained token** with *Pull requests: read/write* (reviews) and
  *Administration: read/write* (repository delete) — scoped to a single
  organization or set of repositories
- **Classic token** with the `repo` scope (reviews) and `delete_repo` scope
  (repository delete) — works across all organizations and repositories you
  can access

If your organization enforces SAML SSO, authorize the token afterwards via
**Configure SSO** on the token page, otherwise the API returns `404 Not Found`.

## Development

GHUX is a Manifest V3 extension with no build step. After making changes, reload the extension from `chrome://extensions`.

## License

MIT
