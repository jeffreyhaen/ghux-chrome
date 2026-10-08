// Per-file diff minimap: a thin strip at a file's right edge showing where
// additions (green) and deletions (red) are, compressed over the WHOLE file.
// The strip spans the file's currently visible height (clamped to the
// viewport) and grows/shrinks as the file scrolls in/out of view. Strips are
// position:fixed on <body> (like sticky.js): they track the viewport natively
// — fixed inside the file container would be unreliable on GitHub's diff view
// (content-visibility/contain/transform ancestors, see sticky.css).
// Scroll/resize only repositions (cheap rect math, style writes only when
// geometry changed — no per-frame jumps); DOM scans and marker rebuilds run
// on mutations/navigation only. Only for files worth mapping: fully expanded
// ("Expand all lines" used — no expander rows left), taller than the
// viewport, and mixed (context + changes); a new/deleted file is one solid
// color and says nothing. Click a marker: jump to the row.
(() => {
  const STRIP_W = 14;
  const STRIP_MARGIN = 4;
  const EDGE_GAP = 8;
  const FILE_SEL =
    'div:has(> table > tbody > tr.diff-line-row), div:has(> table.diff-table), .ghux-diff-wrapper';
  const CODE_CELL_SEL = '.blob-code, .diff-text-inner, .blob-code-inner';
  const META_ROW_SEL = '.blob-no-newline, [class*="no-newline"], [class*="hunk"]';
  const EXPANDER_SEL =
    'button[aria-label*="xpand" i], .js-expandable-line, td.blob-expander-cell';

  let tracked = [];
  let scanScheduled = false;
  let updateScheduled = false;

  const html = () => document.documentElement;
  const on = () =>
    html().dataset.ghuxPage === 'diff' && html().dataset.ghuxMinimap === 'on';

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      scan();
    });
  }

  function scheduleUpdate() {
    if (updateScheduled) return;
    updateScheduled = true;
    requestAnimationFrame(() => {
      updateScheduled = false;
      update();
    });
  }

  // --- row classification: classic classes first, computed background as
  // fallback for the React diff view (theme-independent hue check). Cached per
  // row element; React re-renders create new elements, so no stale entries.
  const kindCache = new WeakMap();

  function classifyCell(cell) {
    const cn = typeof cell.className === 'string' ? cell.className : '';
    if (/addition/i.test(cn)) return 'add';
    if (/deletion/i.test(cn)) return 'del';
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(
      getComputedStyle(cell).backgroundColor
    );
    if (!m || (m[4] !== undefined && parseFloat(m[4]) < 0.05)) return null;
    const [, r, g, b] = m.map(Number);
    if (g > r + 10 && g > b + 10) return 'add';
    if (r > g + 10 && r > b + 10) return 'del';
    return null;
  }

  // 'add' | 'del' | 'context' | null (not a content row: expander rows, hunk
  // headers (@@ ... @@) and meta rows like "No newline at end of file" — those
  // must not count as context, or a fully-new file would look "mixed" and get
  // a strip)
  function classifyRow(row) {
    if (kindCache.has(row)) return kindCache.get(row);
    let kind = null;
    const code = row.querySelector(CODE_CELL_SEL);
    if (code && !row.querySelector(META_ROW_SEL) && !code.textContent.trim().startsWith('@@')) {
      kind = 'context';
      for (const cell of row.cells || []) {
        const k = classifyCell(cell);
        if (k) {
          kind = k;
          break;
        }
      }
    }
    kindCache.set(row, kind);
    return kind;
  }

  function contentRows(el) {
    const rows = [];
    for (const row of el.querySelectorAll('tr')) {
      if (classifyRow(row) !== null) rows.push(row);
    }
    return rows;
  }

  function hasExpanders(el) {
    return !!el.querySelector(EXPANDER_SEL);
  }

  // Signature of everything marker geometry depends on: rebuild only on change
  // (expand/collapse, lazy render), not on every scroll frame.
  function sigOf(el, rows) {
    return `${el.offsetWidth}x${el.offsetHeight}:${rows.length}:${hasExpanders(el) ? 1 : 0}`;
  }

  function scan() {
    if (!on()) {
      while (tracked.length) removeEntry(tracked.pop());
      return;
    }
    const seen = new Set();
    for (const el of document.querySelectorAll(FILE_SEL)) {
      if (!el.isConnected) continue;
      seen.add(el);
      let e = tracked.find((t) => t.el === el);
      const rows = contentRows(el);
      const sig = sigOf(el, rows);
      if (!e) e = makeEntry(el);
      if (e.sig !== sig) {
        e.sig = sig;
        rebuild(e, rows);
      }
    }
    tracked = tracked.filter((e) => {
      if (seen.has(e.el) && e.el.isConnected) return true;
      removeEntry(e);
      return false;
    });
    update();
  }

  function makeEntry(el) {
    const strip = document.createElement('div');
    strip.className = 'ghux-mm';
    const view = document.createElement('div');
    view.className = 'ghux-mm-view';
    strip.appendChild(view);
    document.body.appendChild(strip);
    const e = { el, strip, view, markers: [], sig: '', visible: false, table: null, geom: '' };
    tracked.push(e);
    return e;
  }

  function removeEntry(e) {
    e.strip.remove();
  }

  const MAX_ROWS = 2500;

  function rebuild(e, rows) {
    for (const m of e.markers) m.node.remove();
    e.markers = [];
    if (rows.length > MAX_ROWS) {
      e.mixed = false;
      return;
    }
    const hasContext = rows.some((r) => classifyRow(r) === 'context');
    const changeRows = rows.filter((r) => {
      const k = classifyRow(r);
      return k === 'add' || k === 'del';
    });
    e.mixed = hasContext && changeRows.length > 0;
    e.expanded = !hasExpanders(e.el);
    if (!e.mixed) return;

    // Map rows against the table's extent: spacers/headers inside the wrapper
    // (split-view adds its own rows below the table) must not skew positions.
    e.table = rows[0]?.closest('table') || null;
    if (!e.table) return;
    const tableRect = e.table.getBoundingClientRect();
    if (tableRect.height <= 0) return;
    // Merge runs of same-kind rows into one segment marker: adjacent markers
    // would touch anyway, and this keeps the node count low on huge files.
    let run = null;
    const flush = () => {
      if (!run) return;
      const node = document.createElement('button');
      node.type = 'button';
      node.className = `ghux-mm-mark ${run.kind}`;
      node.style.top = `${((run.top - tableRect.top) / tableRect.height) * 100}%`;
      node.style.height = `${((run.bottom - run.top) / tableRect.height) * 100}%`;
      node.title = run.kind === 'add' ? 'Toegevoegd — spring erheen' : 'Verwijderd — spring erheen';
      const target = run.row;
      node.addEventListener('click', () => {
        if (target.isConnected) target.scrollIntoView({ block: 'center' });
      });
      e.strip.appendChild(node);
      e.markers.push({ node, row: run.row });
      run = null;
    };
    for (const row of changeRows) {
      const rect = row.getBoundingClientRect();
      const kind = classifyRow(row);
      if (run && run.kind === kind && rect.top <= run.bottom + 2) {
        run.bottom = Math.max(run.bottom, rect.bottom);
      } else {
        flush();
        run = { kind, top: rect.top, bottom: rect.bottom, row };
      }
    }
    flush();
  }

  function update() {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    for (const e of tracked) {
      const rect = e.el.getBoundingClientRect();
      let show =
        e.mixed &&
        e.expanded &&
        e.markers.length > 0 &&
        e.table?.isConnected &&
        rect.height > vh;
      let topV = 0;
      let stripH = 0;
      let leftV = 0;
      let viewTop = 0;
      let viewH = 0;
      if (show) {
        const tableRect = e.table.getBoundingClientRect();
        // Responsive: the strip spans the file's currently visible height,
        // clamped to the viewport — it grows as the file scrolls into view
        // and shrinks as it leaves. Markers stay compressed over the file.
        topV = Math.max(EDGE_GAP, tableRect.top + STRIP_MARGIN);
        stripH = Math.min(vh - EDGE_GAP, tableRect.bottom - STRIP_MARGIN) - topV;
        leftV = Math.min(rect.right, vw) - STRIP_W - STRIP_MARGIN;
        viewTop = Math.min(Math.max(-tableRect.top / tableRect.height, 0), 1);
        const viewBottom = Math.min(Math.max((vh - tableRect.top) / tableRect.height, 0), 1);
        viewH = Math.max(viewBottom - viewTop, 0);
        show = stripH > 80 && leftV > 0;
      }
      if (!show) {
        if (e.visible) {
          e.visible = false;
          e.geom = '';
          e.strip.classList.remove('ghux-on');
        }
        continue;
      }
      // Style writes only when the geometry actually changed: while the file
      // fills the viewport the strip stays pixel-identical — no jumpiness.
      const geom = `${Math.round(topV)}x${Math.round(stripH)}y${Math.round(leftV)}`;
      if (e.geom !== geom) {
        e.geom = geom;
        e.strip.style.top = `${Math.round(topV)}px`;
        e.strip.style.height = `${Math.round(stripH)}px`;
        e.strip.style.left = `${Math.round(leftV)}px`;
      }
      e.view.style.top = `${viewTop * 100}%`;
      e.view.style.height = `${viewH * 100}%`;
      if (!e.visible) {
        e.visible = true;
        e.strip.classList.add('ghux-on');
      }
    }
  }

  // Scroll/resize: reposition only — no DOM scans on the scroll hot path.
  window.addEventListener('scroll', scheduleUpdate, { passive: true, capture: true });
  window.addEventListener('resize', scheduleUpdate);

  // Feature flag / page changes: full rescan.
  new MutationObserver(scheduleScan).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-ghux-page', 'data-ghux-minimap'],
  });

  // Table/row mutations: lazy file rendering, expand/collapse, re-renders.
  let bodyScheduled = false;
  const bodyObserver = new MutationObserver((mutations) => {
    if (bodyScheduled || !on()) return;
    const relevant = mutations.some((m) =>
      [...m.addedNodes, ...m.removedNodes].some(
        (n) =>
          n.nodeType === 1 &&
          (n.tagName === 'TABLE' ||
            n.tagName === 'TR' ||
            n.querySelector?.('table, tr'))
      )
    );
    if (!relevant) return;
    bodyScheduled = true;
    requestAnimationFrame(() => {
      bodyScheduled = false;
      scheduleScan();
    });
  });
  if (document.body) observeBody();
  else document.addEventListener('DOMContentLoaded', observeBody, { once: true });

  function observeBody() {
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('ghux:navigation', scheduleScan);
  document.addEventListener('DOMContentLoaded', scheduleScan, { once: true });
  document.fonts?.ready.then(scheduleScan);

  scheduleScan();
})();
