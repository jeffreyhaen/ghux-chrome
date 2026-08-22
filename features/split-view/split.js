(() => {
  const SPLIT_ATTR = 'data-ghux-split';
  const WRAP_ATTR = 'data-ghux-wrap';
  const RATIO_VAR = '--ghux-split';
  const RATIO_KEY = 'splitRatio';
  const DONE_ATTR = 'data-ghux-split-done';
  const MIN_RATIO = 0.15;
  const MAX_RATIO = 0.85;

  const hasStorage = typeof chrome !== 'undefined' && !!chrome.storage?.sync;

  const splitOn = () => document.documentElement.getAttribute(SPLIT_ATTR) === 'on';
  const wrapOff = () => document.documentElement.getAttribute(WRAP_ATTR) === 'off';

  const clamp = (v) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, v));

  function setRatio(v) {
    document.documentElement.style.setProperty(RATIO_VAR, clamp(v));
  }

  function loadRatio() {
    if (!hasStorage) return;
    chrome.storage.sync.get({ [RATIO_KEY]: 0.5 }, (r) => setRatio(r[RATIO_KEY]));
  }

  function saveRatio(v) {
    if (hasStorage) chrome.storage.sync.set({ [RATIO_KEY]: clamp(v) });
  }

  function scan(root = document) {
    if (!splitOn()) return;
    root
      .querySelectorAll('table:has(> tbody > tr > td.right-side-diff-cell)')
      .forEach(enhance);
  }

  function enhance(table) {
    if (table.hasAttribute(DONE_ATTR)) return;
    const wrapper = table.parentElement;
    if (!wrapper) return;
    table.setAttribute(DONE_ATTR, '1');
    wrapper.classList.add('ghux-diff-wrapper');
    ensureColumns(table);
    addScrollbars(table);
    addDivider(table, wrapper);
    new ResizeObserver(() => {
      layoutTable(table);
      refreshSpacers(table);
    }).observe(table);
  }

  function ensureColumns(table) {
    const group = table.querySelector(':scope > colgroup');
    const sides = ['numL', 'left', 'numR', 'right'];
    if (group && group.children.length >= 4) {
      group.classList.add('ghux-cols');
      [...group.children].slice(0, 4).forEach((col, i) => {
        col.dataset.ghuxOrigWidth = col.style.width || '';
        col.dataset.side = sides[i];
      });
    } else {
      const injected = document.createElement('colgroup');
      injected.className = 'ghux-cols ghux-cols-own';
      for (let i = 0; i < 4; i++) {
        const col = document.createElement('col');
        col.dataset.side = sides[i];
        injected.appendChild(col);
      }
      table.prepend(injected);
    }
    layoutTable(table);
  }

  function currentRatio() {
    const v = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(RATIO_VAR)
    );
    return Number.isFinite(v) ? v : 0.5;
  }

  function codeRow(table) {
    return [...table.tBodies[0].children].find(
      (r) => r.tagName === 'TR' && r.querySelector(':scope > td.diff-text-cell')
    );
  }

  function numberColumnsWidth(table) {
    if (table.dataset.ghuxNumW) return parseFloat(table.dataset.ghuxNumW);
    const row = codeRow(table);
    if (!row) return 0;
    const w = row.children[0].getBoundingClientRect().width +
      row.children[2].getBoundingClientRect().width;
    if (w > 0) table.dataset.ghuxNumW = String(w);
    return w;
  }

  function layoutTable(table) {
    const group = table.querySelector(':scope > colgroup.ghux-cols');
    const wrapper = table.parentElement;
    if (!group || !wrapper) return;
    const numW = numberColumnsWidth(table);
    if (numW <= 0) return;
    const usable = wrapper.clientWidth - numW;
    if (usable <= 0) return;
    const ratio = currentRatio();
    const left = Math.round(usable * ratio);
    if (group.dataset.w === `${numW}:${left}`) return;
    group.dataset.w = `${numW}:${left}`;
    const widths = { numL: numW / 2, left, numR: numW / 2, right: usable - left };
    group.querySelectorAll('col[data-side]').forEach((col) => {
      col.style.width = widths[col.dataset.side] + 'px';
    });
    wrapper.style.setProperty('--ghux-numw', numW / 2 + 'px');
    wrapper.style.setProperty('--ghux-leftw', left + numW / 2 + 'px');
    wrapper.style.setProperty('--ghux-rightw', usable - left + numW / 2 + 'px');
  }

  const SIDES = ['left', 'right'];

  function sideBar(wrapper, side) {
    return wrapper.querySelector(`:scope > .ghux-hscroll-row > .ghux-hscroll[data-side="${side}"]`);
  }

  function sideInners(table, side) {
    return table.querySelectorAll(`td.${side}-side-diff-cell .diff-text-inner`);
  }

  function layoutAll() {
    document.querySelectorAll(`table[${DONE_ATTR}]`).forEach((t) => {
      layoutTable(t);
      refreshSpacers(t);
      SIDES.forEach((side) => {
        const bar = sideBar(t.parentElement, side);
        if (bar && bar.scrollLeft > 0) {
          sideInners(t, side).forEach((i) => {
            if (i.scrollLeft !== bar.scrollLeft) i.scrollLeft = bar.scrollLeft;
          });
        }
      });
    });
  }

  function addScrollbars(table) {
    const row = document.createElement('div');
    row.className = 'ghux-hscroll-row';
    SIDES.forEach((side) => {
      const bar = document.createElement('div');
      bar.className = 'ghux-hscroll';
      bar.dataset.side = side;
      bar.appendChild(document.createElement('div'));
      row.appendChild(bar);
    });
    table.after(row);
    refreshSpacers(table);
  }

  // Give every line of a side the same scroll range as the longest line
  // (via a --ghux-pad ::after spacer), so the side scrolls as one block.
  // maxExtra is a high-water mark: it never shrinks while scrolling, which
  // keeps the range stable while GitHub virtualizes rows in and out.
  function refreshSpacers(table) {
    const wrapper = table.parentElement;
    if (!wrapper) return;
    SIDES.forEach((side) => {
      const bar = sideBar(wrapper, side);
      if (!bar || !bar.clientWidth) return;
      const hwKey = side === 'left' ? 'ghuxHwL' : 'ghuxHwR';
      const items = [];
      let max = parseFloat(table.dataset[hwKey] || '0');
      sideInners(table, side).forEach((i) => {
        const extra = i.scrollWidth - i.clientWidth - (i.__ghuxPad || 0);
        items.push([i, extra]);
        if (extra > max) max = extra;
      });
      if (bar.scrollLeft > max) max = bar.scrollLeft;
      table.dataset[hwKey] = String(max);
      bar.firstElementChild.style.width = bar.clientWidth + Math.max(0, max) + 'px';
      items.forEach(([i, extra]) => {
        const pad = Math.max(0, Math.round(max - extra));
        if (pad !== (i.__ghuxPad || 0)) {
          i.__ghuxPad = pad;
          i.style.setProperty('--ghux-pad', pad + 'px');
        }
      });
    });
  }

  function refreshAllSpacers() {
    document.querySelectorAll(`table[${DONE_ATTR}]`).forEach(refreshSpacers);
  }

  function addDivider(table, wrapper) {
    const handle = document.createElement('div');
    handle.className = 'ghux-divider';
    handle.title = 'Drag to resize split';
    wrapper.appendChild(handle);

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      handle.classList.add('ghux-dragging');
      const rect = wrapper.getBoundingClientRect();
      const numW = numberColumnsWidth(table);
      const usable = rect.width - numW;
      const ratioAt = (clientX) => (clientX - rect.left - numW / 2) / usable;

      const onMove = (ev) => {
        setRatio(ratioAt(ev.clientX));
        layoutAll();
      };
      const onUp = (ev) => {
        handle.classList.remove('ghux-dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        saveRatio(ratioAt(ev.clientX));
        resetScrolls();
        layoutAll();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function resetScrolls() {
    document
      .querySelectorAll('.diff-text-inner, .ghux-hscroll')
      .forEach((i) => (i.scrollLeft = 0));
  }

  document.addEventListener(
    'scroll',
    (e) => {
      if (!splitOn() || !wrapOff()) return;
      const el = e.target;
      if (!(el instanceof Element)) return;
      const isBar = el.classList.contains('ghux-hscroll');
      const isInner = el.classList.contains('diff-text-inner');
      if (!isBar && !isInner) return;
      const wrapper = el.closest('.ghux-diff-wrapper');
      if (!wrapper) return;
      let side;
      if (isBar) {
        side = el.dataset.side;
      } else {
        const td = el.closest('td');
        if (td?.classList.contains('left-side-diff-cell')) side = 'left';
        else if (td?.classList.contains('right-side-diff-cell')) side = 'right';
        else return;
      }
      const v = el.scrollLeft;
      const table = wrapper.querySelector(`table[${DONE_ATTR}]`);
      if (!table) return;
      sideInners(table, side).forEach((i) => {
        if (i.scrollLeft !== v) i.scrollLeft = v;
      });
      const bar = sideBar(wrapper, side);
      if (bar && bar.scrollLeft !== v) bar.scrollLeft = v;
    },
    true
  );

  function teardown() {
    document.querySelectorAll('.ghux-hscroll-row, .ghux-divider').forEach((n) => n.remove());
    document.querySelectorAll('colgroup.ghux-cols.ghux-cols-own').forEach((n) => n.remove());
    document.querySelectorAll('colgroup.ghux-cols col[data-ghux-orig-width]').forEach((col) => {
      col.style.width = col.dataset.ghuxOrigWidth;
      delete col.dataset.ghuxOrigWidth;
      delete col.dataset.side;
    });
    document.querySelectorAll('colgroup.ghux-cols').forEach((n) => {
      n.classList.remove('ghux-cols');
      delete n.dataset.w;
    });
    document.querySelectorAll('.ghux-diff-wrapper').forEach((n) => {
      n.classList.remove('ghux-diff-wrapper');
      n.style.removeProperty('--ghux-numw');
      n.style.removeProperty('--ghux-leftw');
      n.style.removeProperty('--ghux-rightw');
    });
    document.querySelectorAll(`table[${DONE_ATTR}]`).forEach((t) => {
      t.removeAttribute(DONE_ATTR);
      delete t.dataset.ghuxNumW;
      delete t.dataset.ghuxHwL;
      delete t.dataset.ghuxHwR;
    });
    document.querySelectorAll('.diff-text-inner').forEach((i) => {
      i.__ghuxPad = 0;
      i.style.removeProperty('--ghux-pad');
    });
    resetScrolls();
  }

  new MutationObserver(() => {
    if (splitOn()) {
      scan();
      if (!wrapOff()) resetScrolls();
      requestAnimationFrame(layoutAll);
    } else {
      teardown();
    }
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: [SPLIT_ATTR, WRAP_ATTR],
  });

  let scanScheduled = false;
  const dirtyTables = new Set();
  const bodyObserver = new MutationObserver((mutations) => {
    if (!splitOn() || scanScheduled) return;
    let relevant = false;
    for (const m of mutations) {
      // content changes inside an enhanced table (e.g. async syntax highlighting
      // swapping spans) can make lines wider -> pads/ranges must be recomputed
      const t = (m.target instanceof Element ? m.target : m.target.parentElement)
        ?.closest?.(`table[${DONE_ATTR}]`);
      if (t) dirtyTables.add(t);
      if (
        [...m.addedNodes].some(
          (n) =>
            n.nodeType === 1 &&
            (n.tagName === 'TABLE' || n.tagName === 'TR' || n.querySelector?.('table'))
        )
      ) relevant = true;
    }
    if (!relevant && dirtyTables.size === 0) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      if (relevant) scan();
      layoutAll();
      dirtyTables.clear();
    });
  });
  if (document.body) observeBody();
  else document.addEventListener('DOMContentLoaded', observeBody, { once: true });

  function observeBody() {
    bodyObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // Safety net: initial scan at document_start can run before any diff table exists
  document.addEventListener('DOMContentLoaded', () => {
    scan();
    layoutAll();
  }, { once: true });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layoutAll, 150);
  });

  document.fonts?.ready.then(refreshAllSpacers);

  loadRatio();
  scan();
})();
