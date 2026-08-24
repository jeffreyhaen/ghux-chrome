// Sticky horizontal scrollbar per file diff: while a file's own bar(s) sit
// below the viewport (and the file is in view), show a fixed 1:1 copy at the
// viewport bottom, synced both ways. Split view: two parts mirroring the
// left/right .ghux-hscroll bars from split.js (same widths, same thumbs —
// scrolling either copy drives the real bars, so split sync keeps working).
// Unified view (wrap off): one part mirroring the container's native bar.
(() => {
  const BAR_HEIGHT = 16;
  const ACTIVE_SELECTOR =
    'div:has(> table > tbody > tr.diff-line-row), div:has(> table.diff-table), .ghux-diff-wrapper';

  let tracked = [];
  let scheduled = false;

  const html = () => document.documentElement;
  // Part of split-view enhancements: rides on the split-view flag, no own toggle.
  const on = () =>
    html().dataset.ghuxPage === 'diff' && html().dataset.ghuxSplit === 'on';
  const wrapOff = () => html().dataset.ghuxWrap === 'off';

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      refresh();
    });
  }

  function refresh() {
    const keep = on() ? collect() : [];
    tracked = tracked.filter((e) => {
      if (!keep.includes(e)) removeEntry(e);
      return keep.includes(e);
    });
    for (const e of keep) if (!tracked.includes(e)) tracked.push(e);
    update();
  }

  // Diff files are .js-updatable-content re-render targets: collect() matches
  // on element identity, so a container replaced by GitHub never matches an
  // existing entry and the orphan's clone is removed by the filter above.
  function collect() {
    const entries = [];
    for (const el of document.querySelectorAll(ACTIVE_SELECTOR)) {
      if (el.classList.contains('ghux-diff-wrapper')) {
        const row = el.querySelector(':scope > .ghux-hscroll-row');
        // Keep BOTH bars (even range-less ones, e.g. the left side of a new
        // file) so the clone's parts line up with their panes; a range-less
        // part simply shows no thumb, like the natural bar.
        const bars = row ? [...row.querySelectorAll('.ghux-hscroll')] : [];
        if (bars.some(hasRange)) entries.push(getEntry(el, bars));
      } else if (wrapOff() && hasRange(el)) {
        entries.push(getEntry(el, [el]));
      }
    }
    return entries;
  }

  function hasRange(el) {
    return el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1;
  }

  function getEntry(el, targets) {
    const found = tracked.find((e) => e.el === el);
    if (found) {
      found.targets = targets;
      return found;
    }
    return makeEntry(el, targets);
  }

  function makeEntry(el, targets) {
    const bar = document.createElement('div');
    bar.className = 'ghux-sticky-row';
    bar.setAttribute('role', 'presentation');
    const parts = targets.map((target, i) => {
      const part = document.createElement('div');
      part.className = 'ghux-sticky-part';
      part.appendChild(document.createElement('div'));
      part.addEventListener('scroll', () => {
        const t = targets[i];
        if (t.isConnected && t.scrollLeft !== part.scrollLeft) {
          t.scrollLeft = part.scrollLeft;
        }
      });
      bar.appendChild(part);
      return part;
    });
    document.body.appendChild(bar);
    return { el, targets, bar, parts, visible: false, sig: '' };
  }

  function removeEntry(e) {
    e.bar.remove();
  }

  // Mirror manual scrolling of a real bar into the visible clone.
  document.addEventListener(
    'scroll',
    (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (
        t.classList.contains('ghux-hscroll') ||
        (wrapOff() && t.matches(ACTIVE_SELECTOR) && !t.classList.contains('ghux-diff-wrapper'))
      ) {
        mirror(t);
      }
    },
    true
  );

  function mirror(target) {
    for (const e of tracked) {
      if (!e.visible) continue;
      const i = e.targets.indexOf(target);
      if (i >= 0 && e.parts[i].scrollLeft !== target.scrollLeft) {
        e.parts[i].scrollLeft = target.scrollLeft;
      }
    }
  }

  // Divider drags change side widths without firing scroll events.
  window.addEventListener('mousemove', () => {
    for (const e of tracked) if (e.visible) syncGeometry(e, false);
  });

  function syncGeometry(e, includePos = true) {
    const rect = includePos ? e.el.getBoundingClientRect() : null;
    const sig =
      (includePos ? `${Math.round(rect.left)}:${Math.round(rect.width)}:` : e.sig.split(':').slice(0, 2).join(':') + ':') +
      e.targets.map((t) => `${t.clientWidth}x${t.scrollWidth}`).join(',');
    if (sig === e.sig) return;
    e.sig = sig;
    if (includePos) {
      e.bar.style.left = Math.round(rect.left) + 'px';
      e.bar.style.width = Math.round(rect.width) + 'px';
    }
    e.parts.forEach((part, i) => {
      part.style.width = e.targets[i].clientWidth + 'px';
      part.firstElementChild.style.width = e.targets[i].scrollWidth + 'px';
    });
  }

  function rowHeightOf(e) {
    if (e.targets.length === 1) return BAR_HEIGHT;
    const row = e.targets[0].closest('.ghux-hscroll-row');
    return row?.offsetHeight || BAR_HEIGHT + 1;
  }

  function update() {
    const vh = window.innerHeight;
    for (const e of tracked) {
      if (!e.el.isConnected || !e.targets.some((t) => t.isConnected && hasRange(t))) {
        if (e.visible) {
          e.visible = false;
          e.bar.classList.remove('ghux-on');
        }
        continue;
      }
      const rect = e.el.getBoundingClientRect();
      const show =
        rect.top < vh && rect.bottom > 0 && rect.bottom - rowHeightOf(e) > vh;
      if (show) {
        syncGeometry(e, true);
        if (!e.visible) {
          e.visible = true;
          // class first: scrollLeft is ignored while display:none
          e.bar.classList.add('ghux-on');
          e.parts.forEach((part, i) => {
            const max = e.targets[i].scrollWidth - part.clientWidth;
            part.scrollLeft = Math.min(e.targets[i].scrollLeft, Math.max(0, max));
          });
        }
      } else if (e.visible) {
        e.visible = false;
        e.bar.classList.remove('ghux-on');
      }
    }
  }

  window.addEventListener('scroll', schedule, { passive: true, capture: true });
  window.addEventListener('resize', schedule);

  new MutationObserver(schedule).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-ghux-page', 'data-ghux-wrap', 'data-ghux-split'],
  });

  let bodyScheduled = false;
  const bodyObserver = new MutationObserver((mutations) => {
    if (bodyScheduled || !on()) return;
    const relevant = mutations.some((m) =>
      [...m.addedNodes, ...m.removedNodes].some(
        (n) => n.nodeType === 1 && (n.tagName === 'TABLE' || n.querySelector?.('table'))
      )
    );
    if (!relevant) return;
    bodyScheduled = true;
    requestAnimationFrame(() => {
      bodyScheduled = false;
      schedule();
    });
  });
  if (document.body) observeBody();
  else document.addEventListener('DOMContentLoaded', observeBody, { once: true });

  function observeBody() {
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('ghux:navigation', schedule);
  document.addEventListener('DOMContentLoaded', schedule, { once: true });
  document.fonts?.ready.then(schedule);

  schedule();
})();
