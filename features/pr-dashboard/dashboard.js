// Replaces the native pull request list (/owner/repo/pulls) with a GHUX
// dashboard table, Azure DevOps board style: state badges, checks, creator
// avatars, comment chips and reviewer status rings. Data comes from the
// GitHub GraphQL API using the token from GHUX settings. Without a token
// the native list stays untouched and a notice is shown instead.
(() => {
  const ROOT_ID = 'ghux-prdash';
  const NATIVE_ATTR = 'data-ghux-prdash-native';
  const CACHE_TTL = 5 * 60 * 1000;

  let view = 'dash'; // 'dash' | 'native'
  let cache = null; // { key, fetchedAt, prs }
  let status = { kind: 'idle' }; // idle | loading | ready | no-token | error
  let dirty = true; // only rebuild DOM when state actually changed
  const filter = { state: 'active', search: '', sort: 'newest' };

  function isActive() {
    const root = document.documentElement;
    return root.dataset.ghuxPage === 'pulls' && root.dataset.ghuxPrDash === 'on';
  }

  function repoFromPath() {
    const m = location.pathname.match(/^\/([^/]+)\/([^/]+)\/pulls\/?$/i);
    return m ? { owner: m[1], repo: m[2] } : null;
  }

  const QUERY = `query ($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      open: pullRequests(first: 50, states: [OPEN], orderBy: { field: CREATED_AT, direction: DESC }) {
        nodes { ...PrFields }
      }
      closed: pullRequests(first: 25, states: [CLOSED, MERGED], orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes { ...PrFields }
      }
    }
  }

  fragment PrFields on PullRequest {
    number title url state isDraft createdAt closedAt body headRefName baseRefName
    author { login avatarUrl }
    reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login avatarUrl } } } }
    reviews(last: 100) { nodes { state submittedAt author { login avatarUrl } } }
    reviewThreads(first: 100) { nodes { isResolved } }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  }`;

  async function fetchPrs(owner, repo, token) {
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: QUERY, variables: { owner, repo } }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.errors) {
      const detail =
        (data.errors && data.errors[0] && data.errors[0].message) ||
        data.message ||
        `${res.status}`;
      throw new Error(detail);
    }
    return [
      ...data.data.repository.open.nodes,
      ...data.data.repository.closed.nodes,
    ];
  }

  // Latest submitted review per reviewer wins; requested reviewers without a
  // review are pending. The PR author never counts as a reviewer.
  function deriveReviewers(pr) {
    const authorLogin = pr.author ? pr.author.login : null;
    const byLogin = new Map();
    for (const review of pr.reviews.nodes) {
      if (!review.author || review.state === 'PENDING') continue;
      const login = review.author.login;
      if (login === authorLogin) continue;
      const prev = byLogin.get(login);
      if (!prev || new Date(review.submittedAt) > new Date(prev.submittedAt)) {
        byLogin.set(login, {
          login,
          avatarUrl: review.author.avatarUrl,
          state: review.state,
          submittedAt: review.submittedAt,
        });
      }
    }
    const pending = (pr.reviewRequests.nodes || [])
      .map((n) => n.requestedReviewer)
      .filter((r) => r && r.login && r.login !== authorLogin && !byLogin.has(r.login))
      .map((r) => ({ login: r.login, avatarUrl: r.avatarUrl, state: 'PENDING' }));
    return [...byLogin.values(), ...pending];
  }

  function reviewerSummary(reviewers) {
    if (!reviewers.length) return { text: 'No reviewers', cls: '' };
    if (reviewers.some((r) => r.state === 'CHANGES_REQUESTED')) {
      return { text: 'changes requested', cls: 'changes' };
    }
    if (reviewers.every((r) => r.state === 'APPROVED')) {
      return { text: 'approved', cls: 'approved' };
    }
    return { text: 'awaiting review', cls: '' };
  }

  function commentChips(pr) {
    const threads = pr.reviewThreads.nodes;
    const resolved = threads.filter((t) => t.isResolved).length;
    return { open: threads.length - resolved, resolved };
  }

  function taskProgress(body) {
    if (!body) return null;
    const open = (body.match(/^\s*[-*]\s+\[ \]/gm) || []).length;
    const done = (body.match(/^\s*[-*]\s+\[[xX]\]/gm) || []).length;
    return open + done ? { done, total: open + done } : null;
  }

  function checksState(pr) {
    const node = pr.commits.nodes[0];
    const state = node && node.commit.statusCheckRollup
      ? node.commit.statusCheckRollup.state
      : null;
    if (state === 'SUCCESS') return { icon: '✓', cls: 'ok', label: 'Checks passed' };
    if (state === 'FAILURE' || state === 'ERROR') return { icon: '✗', cls: 'fail', label: 'Checks failing' };
    if (state) return { icon: '●', cls: 'pending', label: 'Checks pending' };
    return { icon: '—', cls: 'none', label: 'No checks' };
  }

  function relTime(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
    const unit = (n, name) => `${Math.floor(n)} ${name}${Math.floor(n) === 1 ? '' : 's'} ago`;
    if (s < 60) return 'just now';
    if (s < 3600) return unit(s / 60, 'minute');
    if (s < 86400) return unit(s / 3600, 'hour');
    if (s < 604800) return unit(s / 86400, 'day');
    return unit(s / 604800, 'week');
  }

  function applyFilters(prs) {
    let out = [...prs];
    if (filter.state === 'active') out = out.filter((pr) => pr.state === 'OPEN');
    if (filter.state === 'closed') out = out.filter((pr) => pr.state === 'CLOSED' || pr.state === 'MERGED');
    const q = filter.search.trim().toLowerCase();
    if (q) {
      out = out.filter((pr) =>
        pr.title.toLowerCase().includes(q) ||
        String(pr.number).includes(q) ||
        (pr.author && pr.author.login.toLowerCase().includes(q))
      );
    }
    const sortKey = (pr) => new Date(pr.closedAt || pr.createdAt);
    out.sort((a, b) => {
      const diff = sortKey(a) - sortKey(b);
      return filter.sort === 'oldest' ? diff : -diff;
    });
    return out;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function avatarImg(url, login) {
    const img = el('img', 'ghux-prdash-avatar');
    img.src = url ? `${url}${url.includes('?') ? '&' : '?'}s=44` : '';
    img.alt = login || '';
    img.width = 22;
    img.height = 22;
    return img;
  }

  const RING_CLASS = {
    APPROVED: 'approved',
    CHANGES_REQUESTED: 'changes',
    COMMENTED: 'commented',
    DISMISSED: 'commented',
    PENDING: 'pending',
  };
  const STATE_LABEL = {
    APPROVED: 'approved',
    CHANGES_REQUESTED: 'changes requested',
    COMMENTED: 'commented',
    DISMISSED: 'dismissed',
    PENDING: 'pending',
  };

  function buildCollapsedBar() {
    const bar = el('div', 'ghux-prdash-toolbar');
    bar.append(el('span', 'ghux-prdash-muted', 'GHUX PR dashboard — showing the native GitHub list.'));
    const toggle = el('button', 'ghux-prdash-btn ghux-prdash-toggle', '⇄ Dashboard');
    toggle.type = 'button';
    toggle.title = 'Switch back to the GHUX dashboard';
    toggle.addEventListener('click', () => {
      view = 'dash';
      dirty = true;
      render();
    });
    bar.append(toggle);
    return bar;
  }

  function buildToolbar() {
    const bar = el('div', 'ghux-prdash-toolbar');

    for (const [value, label] of [['active', 'Active'], ['closed', 'Closed'], ['all', 'All']]) {
      const pill = el('button', `ghux-prdash-pill${filter.state === value ? ' is-active' : ''}`, label);
      pill.type = 'button';
      pill.addEventListener('click', () => {
        filter.state = value;
        dirty = true;
        render();
      });
      bar.append(pill);
    }

    const search = el('input', 'ghux-prdash-search');
    search.type = 'search';
    search.placeholder = 'Search title, number, author…';
    search.value = filter.search;
    search.addEventListener('input', () => {
      filter.search = search.value;
      renderTable();
    });
    bar.append(search);

    const sort = el('select', 'ghux-prdash-select');
    for (const [value, label] of [['newest', 'Newest first'], ['oldest', 'Oldest first']]) {
      const option = el('option', '', label);
      option.value = value;
      if (filter.sort === value) option.selected = true;
      sort.append(option);
    }
    sort.addEventListener('change', () => {
      filter.sort = sort.value;
      dirty = true;
      render();
    });
    bar.append(sort);

    const refresh = el('button', 'ghux-prdash-btn', '↻ Refresh');
    refresh.type = 'button';
    refresh.addEventListener('click', () => loadData(true));
    bar.append(refresh);

    const toggle = el(
      'button',
      'ghux-prdash-btn ghux-prdash-toggle',
      view === 'dash' ? '⇄ Native list' : '⇄ Dashboard'
    );
    toggle.type = 'button';
    toggle.title = 'Switch between the GHUX dashboard and the native GitHub list';
    toggle.addEventListener('click', () => {
      view = view === 'dash' ? 'native' : 'dash';
      dirty = true;
      render();
    });
    bar.append(toggle);

    return bar;
  }

  function buildRow(pr) {
    const reviewers = deriveReviewers(pr);
    const summary = reviewerSummary(reviewers);
    const chips = commentChips(pr);
    const tasks = taskProgress(pr.body);
    const checks = checksState(pr);
    const cells = [];

    const state = el('div');
    const stateMeta = pr.isDraft && pr.state === 'OPEN'
      ? { cls: 'draft', label: 'Draft' }
      : pr.state === 'MERGED'
      ? { cls: 'merged', label: 'Merged' }
      : pr.state === 'CLOSED'
      ? { cls: 'closed', label: 'Closed' }
      : { cls: 'open', label: 'Open' };
    state.append(el('span', `ghux-prdash-state ${stateMeta.cls}`, stateMeta.label));
    cells.push(state);

    const prCell = el('div', 'ghux-prdash-pr');
    const link = el('a', 'ghux-prdash-title');
    link.href = pr.url;
    const num = el('span', 'ghux-prdash-num', `#${pr.number} `);
    link.append(num, document.createTextNode(pr.title));
    const branch = el('span', 'ghux-prdash-branch');
    branch.textContent = `${pr.headRefName} → ${pr.baseRefName}`;
    branch.title = `${pr.headRefName} → ${pr.baseRefName}`;
    const dateBits = [
      pr.closedAt
        ? `${pr.state === 'MERGED' ? 'merged' : 'closed'} ${relTime(pr.closedAt)}`
        : `opened ${relTime(pr.createdAt)}`,
    ];
    if (tasks) dateBits.push(`${tasks.done} of ${tasks.total} tasks`);
    prCell.append(link, branch, el('span', 'ghux-prdash-date', dateBits.join(' · ')));
    cells.push(prCell);

    const checksCell = el('div', `ghux-prdash-checks ${checks.cls}`, checks.icon);
    checksCell.title = checks.label;
    cells.push(checksCell);

    const creator = el('div', 'ghux-prdash-creator');
    if (pr.author) {
      creator.append(avatarImg(pr.author.avatarUrl, pr.author.login), el('span', '', pr.author.login));
    } else {
      creator.append(el('span', 'ghux-prdash-muted', 'ghost'));
    }
    cells.push(creator);

    const comments = el('div', 'ghux-prdash-comments');
    if (chips.open) comments.append(el('span', 'ghux-prdash-chip open', `${chips.open} open`));
    if (chips.resolved) comments.append(el('span', 'ghux-prdash-chip resolved', `${chips.resolved} resolved`));
    if (!chips.open && !chips.resolved) comments.append(el('span', 'ghux-prdash-muted', '—'));
    cells.push(comments);

    const reviewerCell = el('div', 'ghux-prdash-reviewers');
    if (reviewers.length) {
      const stack = el('span', 'ghux-prdash-stack');
      for (const r of reviewers) {
        const ring = el('span', `ghux-prdash-ring ${RING_CLASS[r.state] || 'pending'}`);
        ring.title = `${r.login}: ${STATE_LABEL[r.state] || r.state}`;
        ring.append(avatarImg(r.avatarUrl, r.login));
        stack.append(ring);
      }
      reviewerCell.append(stack, el('span', `ghux-prdash-rstate ${summary.cls}`, summary.text));
    } else {
      reviewerCell.append(el('span', 'ghux-prdash-muted', summary.text));
    }
    cells.push(reviewerCell);

    for (const cell of cells) cell.dataset.prUrl = pr.url;
    return cells;
  }

  function buildTable(prs) {
    const frame = el('div', 'ghux-prdash-frame');
    const count = el(
      'div',
      'ghux-prdash-count',
      `${prs.length} pull requests (open + recently closed) · GitHub GraphQL · refreshed ${relTime(cache.fetchedAt)}`
    );
    const wrap = el('div', 'ghux-prdash-tablewrap');
    const table = el('div', 'ghux-prdash-table');
    for (const heading of ['State', 'Pull request', 'Checks', 'Creator', 'Comments', 'Reviewers']) {
      table.append(el('div', 'ghux-prdash-th', heading));
    }
    const visible = applyFilters(prs);
    if (!visible.length) {
      const empty = el('div', 'ghux-prdash-empty', 'No pull requests match the current filters.');
      table.append(empty);
    }
    for (const pr of visible) {
      for (const cell of buildRow(pr)) table.append(cell);
    }
    table.addEventListener('click', (e) => {
      if (e.target.closest('a, button, input, select')) return;
      const cell = e.target.closest('[data-pr-url]');
      if (cell) location.assign(cell.dataset.prUrl);
    });
    wrap.append(table);
    frame.append(count, wrap);
    return frame;
  }

  function buildNotice(kind, message) {
    const notice = el('div', `ghux-prdash-notice ${kind}`);
    notice.textContent = message;
    return notice;
  }

  function findNativeBlocks() {
    const list =
      document.querySelector('.js-navigation-container') ||
      document.querySelector('[id^="issue_"]');
    if (!list) return [];
    const blocks = [list.closest('.Box') || list];
    const pagination = document.querySelector('.paginate-container');
    if (pagination) blocks.push(pagination);
    return blocks;
  }

  function unmarkNative() {
    document.querySelectorAll(`[${NATIVE_ATTR}]`).forEach((n) => n.removeAttribute(NATIVE_ATTR));
  }

  function render() {
    const html = document.documentElement;
    let root = document.getElementById(ROOT_ID);
    if (!isActive()) {
      if (root) root.remove();
      unmarkNative();
      delete html.dataset.ghuxPrdashView;
      return;
    }

    const blocks = findNativeBlocks();
    if (!blocks.length) {
      // Fail-safe: without a recognizable native list we change nothing.
      if (root) root.remove();
      delete html.dataset.ghuxPrdashView;
      return;
    }

    // Fast path: DOM intact and nothing changed — keep the existing nodes
    // (rebuilding here would destroy rows between mousedown and mouseup,
    // killing clicks) and only make sure native blocks stay marked/hidden.
    if (root && !dirty && root.isConnected) {
      if (status.kind === 'ready') {
        for (const b of blocks) b.setAttribute(NATIVE_ATTR, '');
        html.dataset.ghuxPrdashView = view;
      }
      return;
    }
    dirty = false;

    if (!root) {
      root = el('div', 'ghux-prdash');
      root.id = ROOT_ID;
      blocks[0].before(root);
    } else if (!root.isConnected || root.nextElementSibling !== blocks[0]) {
      blocks[0].before(root);
    }

    if (status.kind === 'ready' && view === 'native') {
      root.replaceChildren(buildCollapsedBar());
    } else {
      root.replaceChildren(buildToolbar());
    }

    if (status.kind === 'ready') {
      if (view === 'dash') root.append(buildTable(cache.prs));
      html.dataset.ghuxPrdashView = view;
      for (const b of blocks) b.setAttribute(NATIVE_ATTR, '');
    } else {
      delete html.dataset.ghuxPrdashView;
      unmarkNative();
      if (status.kind === 'loading') {
        root.append(buildNotice('loading', 'Loading pull requests…'));
      } else if (status.kind === 'no-token') {
        root.append(
          buildNotice('info', 'Add a GitHub token in the GHUX settings to enable the PR dashboard.')
        );
      } else if (status.kind === 'error') {
        root.append(buildNotice('error', `GHUX PR dashboard failed to load: ${status.message}`));
      }
    }
  }

  // Re-render only the table (keeps focus in the search box while typing).
  function renderTable() {
    const root = document.getElementById(ROOT_ID);
    if (!root || status.kind !== 'ready' || view !== 'dash') return render();
    root.querySelector('.ghux-prdash-frame')?.remove();
    root.append(buildTable(cache.prs));
  }

  function loadData(force) {
    const repo = repoFromPath();
    if (!repo) return;
    const key = `${repo.owner}/${repo.repo}`;
    if (!force && cache && cache.key === key && Date.now() - cache.fetchedAt < CACHE_TTL) {
      status = { kind: 'ready' };
      if (dirty) render();
      return;
    }
    status = { kind: 'loading' };
    dirty = true;
    render();
    chrome.storage.local.get({ githubToken: '' }, async (cfg) => {
      dirty = true;
      if (!cfg.githubToken) {
        status = { kind: 'no-token' };
        render();
        return;
      }
      try {
        const prs = await fetchPrs(repo.owner, repo.repo, cfg.githubToken);
        cache = { key, fetchedAt: Date.now(), prs };
        status = { kind: 'ready' };
      } catch (err) {
        status = { kind: 'error', message: String((err && err.message) || err) };
      }
      render();
    });
  }

  function refresh() {
    if (!isActive()) {
      dirty = true;
      render();
      return;
    }
    const root = document.getElementById(ROOT_ID);
    if (!root || !root.isConnected) dirty = true;
    loadData(false);
  }

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      refresh();
    });
  };

  new MutationObserver((mutations) => {
    for (const m of mutations) {
      const nodes = [...m.addedNodes, ...m.removedNodes];
      if (
        nodes.length &&
        nodes.every(
          (n) =>
            n.nodeType === 1 &&
            (n.id === ROOT_ID || n.querySelector?.(`#${ROOT_ID}`))
        )
      ) {
        continue;
      }
      schedule();
      return;
    }
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-ghux-page', 'data-ghux-pr-dash'],
    childList: true,
    subtree: true,
  });

  document.addEventListener('ghux:navigation', refresh);
  refresh();
})();
