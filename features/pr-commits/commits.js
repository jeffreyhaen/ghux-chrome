// Groups commit activity on the PR conversation page. Consecutive push
// blocks ("<user> added N commits"), including blocks separated only by
// GitHub's "N hidden items" placeholder, collapse into a single GHUX summary
// row. The 3 most recent commits of the whole run stay visible; the rest is
// hidden until the row is expanded.
//
// Detection is structural instead of class based, because GitHub ships both
// the classic timeline and the newer React pull request experience: commit
// rows are found through their commit icon + sha link, everything else is
// derived from the surrounding element structure. Nothing is removed from the
// DOM - hiding uses a data attribute + CSS - so GitHub's own behaviour
// (permalinks, "load more", hydration) keeps working.
(() => {
  const GROUP_CLASS = 'ghux-commits-group';
  const FOLD_ATTR = 'data-ghux-commit';
  const PREVIEW_COUNT = 3;
  // Runs at or below this size are left untouched: collapsing a handful of
  // commits is not worth an extra row.
  const MIN_COMMITS = 5;

  const COMMENTISH = [
    '.js-comment-container',
    '.timeline-comment',
    '.review-comment',
    '[data-testid*="comment"]',
  ].join(', ');

  const ICONS = {
    push: 'M1 2.5a2.5 2.5 0 1 1 3 2.45v6.1a2.5 2.5 0 1 1-1.5 0v-6.1A2.5 2.5 0 0 1 1 2.5Zm11.5 9.55v-4.3a2.75 2.75 0 0 0-2.75-2.75H8.06l1.22 1.22a.75.75 0 1 1-1.06 1.06L5.97 5.03a.75.75 0 0 1 0-1.06l2.25-2.25a.75.75 0 0 1 1.06 1.06L8.06 4h1.69A4.25 4.25 0 0 1 14 8.25v3.8a2.5 2.5 0 1 1-1.5 0ZM3.5 2.5a1 1 0 1 0-2 0 1 1 0 0 0 2 0Zm-1 10a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm11 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
    caret: 'M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z',
  };

  const RELATIVE_UNITS = [
    ['year', 31536000000],
    ['month', 2592000000],
    ['week', 604800000],
    ['day', 86400000],
    ['hour', 3600000],
    ['minute', 60000],
  ];

  const PUSH_RE = /(?:added|pushed)\s+([\d,]+)\s+commits?/i;
  const HIDDEN_RE = /([\d,]+)\s+hidden items?/i;

  const expanded = new Set();
  let applied = [];
  let lastSignature = '';

  function isActive() {
    const root = document.documentElement;
    return root.dataset.ghuxPage === 'pr' && root.dataset.ghuxCommits === 'on';
  }

  function searchRoot() {
    return (
      document.querySelector('.js-discussion') ||
      document.querySelector('[data-testid="issue-timeline"]') ||
      document.querySelector('#discussion_bucket') ||
      document.body
    );
  }

  function shaIn(el) {
    for (const a of el.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/(?:commit|commits)\/([0-9a-f]{7,40})(?:$|[?#])/i);
      if (m) return m[1].slice(0, 7);
    }
    return '';
  }

  // From the commit icon, walk up to the element that represents the whole
  // commit row: the smallest ancestor holding the sha link, plus any wrapper
  // that only adds decoration (avatar, badge) and no extra text.
  function commitRowFor(icon) {
    let el = icon.parentElement;
    while (el && el !== document.body && !shaIn(el)) el = el.parentElement;
    if (!el || el === document.body) return null;
    const text = el.textContent.trim();
    let parent = el.parentElement;
    while (
      parent &&
      parent !== document.body &&
      parent.textContent.trim() === text
    ) {
      el = parent;
      parent = parent.parentElement;
    }
    return { el, sha: shaIn(el) };
  }

  function commitRows(root) {
    const rows = [];
    const seen = new Set();
    for (const icon of root.querySelectorAll('.octicon-git-commit')) {
      if (icon.closest(`.${GROUP_CLASS}`)) continue;
      const row = commitRowFor(icon);
      if (!row || seen.has(row.el)) continue;
      if (row.el.matches(COMMENTISH) || row.el.querySelector(COMMENTISH)) continue;
      seen.add(row.el);
      rows.push(row);
    }
    return rows;
  }

  // Lowest common ancestor of all commit rows: its children are the timeline
  // entries we can safely reason about (push blocks, hidden-items
  // placeholders, comments, events).
  function commonAncestor(elements) {
    let node = elements[0];
    for (const el of elements.slice(1)) {
      while (node && !node.contains(el)) node = node.parentElement;
    }
    return node;
  }

  function unitsOf(container, rows) {
    const units = [];
    for (const child of container.children) {
      if (child.classList.contains(GROUP_CLASS)) continue;
      const inside = rows.filter((row) => child === row.el || child.contains(row.el));
      const text = child.textContent || '';
      let kind = 'other';
      if (inside.length) kind = 'commits';
      else if (HIDDEN_RE.test(text) && text.trim().length < 300) kind = 'hidden';
      units.push({ el: child, kind, rows: inside, text });
    }
    return units;
  }

  function findRuns(units) {
    const runs = [];
    let current = null;
    for (const unit of units) {
      if (unit.kind === 'other') {
        current = null;
        continue;
      }
      if (!current) {
        if (unit.kind !== 'commits') continue;
        current = [];
        runs.push(current);
      }
      current.push(unit);
    }
    return runs
      .map((run) => {
        while (run.length && run[run.length - 1].kind !== 'commits') run.pop();
        return run;
      })
      .filter(
        (run) =>
          run.reduce((total, unit) => total + unit.rows.length, 0) > MIN_COMMITS
      );
  }

  function relativeText(el) {
    const time = el.querySelector('relative-time, time-ago, time');
    if (!time) return '';
    const raw =
      time.getAttribute('datetime') ||
      time.getAttribute('title') ||
      time.getAttribute('data-timestamp') ||
      '';
    const ms = raw ? Date.parse(raw) : NaN;
    if (!Number.isNaN(ms)) {
      const diff = Date.now() - ms;
      const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
      for (const [unit, size] of RELATIVE_UNITS) {
        if (Math.abs(diff) >= size) return rtf.format(-Math.round(diff / size), unit);
      }
      return rtf.format(0, 'minute');
    }
    return time.textContent.trim();
  }

  function headerIn(unit) {
    // The push header is the deepest element still describing the whole push.
    const candidates = [unit.el, ...unit.el.querySelectorAll('*')];
    let best = null;
    for (const el of candidates) {
      const text = el.textContent || '';
      if (!PUSH_RE.test(text)) continue;
      if (unit.rows.some((row) => el === row.el || el.contains(row.el))) {
        if (!best) best = el;
        continue;
      }
      if (!best || best.contains(el)) best = el;
    }
    return best;
  }

  function summarize(run) {
    const rows = run.flatMap((unit) => unit.rows);
    let counted = 0;
    let pushes = 0;
    let firstTime = '';
    let lastTime = '';
    const names = [];
    const avatars = [];
    for (const unit of run) {
      if (unit.kind !== 'commits') continue;
      const header = headerIn(unit);
      const m = (header ? header.textContent : unit.text).match(PUSH_RE);
      if (m) {
        counted += Number(m[1].replace(/,/g, ''));
        pushes += 1;
      }
      const scope = header || unit.el;
      const when = relativeText(scope);
      if (when) {
        if (!firstTime) firstTime = when;
        lastTime = when;
      }
      const link = scope.querySelector('a.author, a[data-hovercard-type="user"], a[href^="/"]');
      const name = link ? link.textContent.trim() : '';
      if (name && /^[\w.-]+$/.test(name) && !names.includes(name)) names.push(name);
      if (/and others/i.test(scope.textContent) && !names.includes('others')) {
        names.push('others');
      }
      for (const img of [scope, unit.el].flatMap((el) => [
        ...el.querySelectorAll('img[src*="avatar"], img.avatar'),
      ])) {
        const src = img.getAttribute('src') || '';
        if (src && !avatars.includes(src) && avatars.length < 3) avatars.push(src);
      }
    }
    return {
      rows,
      total: Math.max(counted, rows.length),
      pushes: pushes || run.filter((u) => u.kind === 'commits').length,
      names,
      avatars,
      firstTime,
      lastTime,
      firstSha: rows.length ? rows[0].sha : '',
      lastSha: rows.length ? rows[rows.length - 1].sha : '',
    };
  }

  function hiddenCountIn(run) {
    for (const unit of run) {
      if (unit.kind !== 'hidden') continue;
      const m = unit.text.match(HIDDEN_RE);
      if (m) return m[1];
    }
    return '';
  }

  function signatureOf(info, run) {
    return [info.firstSha, info.lastSha, info.total, run.length, info.pushes].join(':');
  }

  function octicon(path, cls) {
    return `<svg class="octicon ${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="${path}"></path></svg>`;
  }

  function authorLabel(names) {
    if (!names.length) return 'Someone';
    if (names.length === 1) return names[0];
    if (names.includes('others')) return `${names[0]} and others`;
    return `${names[0]} and ${names.length - 1} other${names.length > 2 ? 's' : ''}`;
  }

  function timeLabel(info) {
    if (info.firstTime && info.lastTime && info.firstTime !== info.lastTime) {
      return `${info.firstTime} → ${info.lastTime}`;
    }
    return info.lastTime || info.firstTime || '';
  }

  function buildGroupRow(info) {
    const row = document.createElement('div');
    row.className = GROUP_CLASS;
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    const avatars = info.avatars
      .map((src) => `<img class="ghux-commits-avatar" src="${src}" alt="">`)
      .join('');
    const details = [
      timeLabel(info),
      info.pushes > 1 ? `${info.pushes} pushes` : '',
      info.hidden ? `${info.hidden} hidden items` : '',
    ].filter(Boolean);
    const range =
      info.firstSha && info.lastSha
        ? `<span class="ghux-commits-range">${info.firstSha}…${info.lastSha}</span>`
        : '';
    row.innerHTML = `
      <span class="ghux-commits-badge">${octicon(ICONS.push, 'octicon-repo-push')}</span>
      <span class="ghux-commits-caret">${octicon(ICONS.caret, 'octicon-chevron-right')}</span>
      <span class="ghux-commits-avatars">${avatars}</span>
      <span class="ghux-commits-text"><strong>${authorLabel(info.names)}</strong> pushed <strong>${
      info.total
    }</strong> commit${info.total === 1 ? '' : 's'}${
      details.length ? ` · ${details.join(' · ')}` : ''
    }</span>
      <span class="ghux-commits-hint"></span>
      ${range}
    `;
    return row;
  }

  // Fold everything inside el except the branches leading to a kept element.
  // A kept element keeps its whole subtree, so a preview commit row stays
  // intact instead of being emptied out from the inside.
  function collectFolds(el, keep, out) {
    if (keep.includes(el)) return;
    if (!keep.some((k) => el.contains(k))) {
      out.push(el);
      return;
    }
    for (const child of el.children) {
      if (child.classList.contains(GROUP_CLASS)) continue;
      collectFolds(child, keep, out);
    }
  }

  function applyState(entry) {
    const isOpen = expanded.has(entry.signature);
    for (const el of entry.folded) el.removeAttribute(FOLD_ATTR);
    entry.folded = [];
    if (!isOpen) {
      const keep = entry.info.rows
        .slice(Math.max(0, entry.info.rows.length - PREVIEW_COUNT))
        .map((row) => row.el);
      const folds = [];
      for (const unit of entry.run) collectFolds(unit.el, keep, folds);
      for (const el of folds) el.setAttribute(FOLD_ATTR, 'folded');
      entry.folded = folds;
    }
    entry.groupEl.classList.toggle('is-open', isOpen);
    entry.groupEl.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    const hidden = Math.max(0, entry.info.rows.length - PREVIEW_COUNT);
    const hint = entry.groupEl.querySelector('.ghux-commits-hint');
    if (hint) hint.textContent = isOpen ? 'collapse' : `show ${hidden} more`;
  }

  function toggleRun(entry) {
    if (expanded.has(entry.signature)) expanded.delete(entry.signature);
    else expanded.add(entry.signature);
    applyState(entry);
  }

  function cleanup() {
    document.querySelectorAll(`.${GROUP_CLASS}`).forEach((el) => el.remove());
    document
      .querySelectorAll(`[${FOLD_ATTR}]`)
      .forEach((el) => el.removeAttribute(FOLD_ATTR));
    applied = [];
    lastSignature = '';
  }

  function build() {
    const root = searchRoot();
    if (!root) return;
    const rows = commitRows(root);
    if (rows.length <= MIN_COMMITS) {
      if (applied.length) cleanup();
      return;
    }
    const container = commonAncestor(rows.map((row) => row.el));
    if (!container) return;
    const runs = findRuns(unitsOf(container, rows));
    const infos = runs.map((run) => summarize(run));
    const signature = runs.map((run, i) => signatureOf(infos[i], run)).join('|');
    if (
      signature === lastSignature &&
      applied.length === runs.length &&
      applied.every((entry) => entry.groupEl.isConnected)
    ) {
      return;
    }

    cleanup();
    runs.forEach((run, i) => {
      const info = infos[i];
      info.hidden = hiddenCountIn(run);
      const first = run[0].el;
      if (!first.parentNode) return;

      const groupEl = buildGroupRow(info);
      first.parentNode.insertBefore(groupEl, first);

      const entry = {
        run,
        info,
        signature: signatureOf(info, run),
        groupEl,
        folded: [],
      };
      groupEl.addEventListener('click', () => toggleRun(entry));
      groupEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleRun(entry);
        }
      });

      applied.push(entry);
      applyState(entry);
    });
    lastSignature = signature;
    revealHashTarget();
  }

  // A permalink may point at a commit inside a collapsed run: open that run so
  // the target is reachable.
  function revealHashTarget() {
    const hash = location.hash.slice(1);
    if (!hash) return;
    let target = null;
    try {
      target = document.getElementById(hash) || document.querySelector(`[name="${CSS.escape(hash)}"]`);
    } catch {
      target = document.getElementById(hash);
    }
    if (!target) return;
    const entry = applied.find((item) =>
      item.run.some((unit) => unit.el === target || unit.el.contains(target))
    );
    if (!entry || expanded.has(entry.signature)) return;
    expanded.add(entry.signature);
    applyState(entry);
    target.scrollIntoView({ block: 'center' });
  }

  function refresh() {
    if (!isActive()) {
      if (applied.length || document.querySelector(`.${GROUP_CLASS}`)) cleanup();
      return;
    }
    build();
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
      const target = m.target;
      if (target.nodeType === 1 && target.closest?.(`.${GROUP_CLASS}`)) continue;
      if (m.type === 'attributes' && m.attributeName === FOLD_ATTR) continue;
      const nodes = [...m.addedNodes, ...m.removedNodes];
      if (
        nodes.length &&
        nodes.every((n) => n.nodeType === 1 && n.classList?.contains(GROUP_CLASS))
      ) {
        continue;
      }
      schedule();
      return;
    }
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-ghux-page', 'data-ghux-commits'],
    childList: true,
    subtree: true,
  });

  document.addEventListener('ghux:navigation', () => {
    lastSignature = '';
    refresh();
  });
  window.addEventListener('hashchange', revealHashTarget);
  refresh();
})();
