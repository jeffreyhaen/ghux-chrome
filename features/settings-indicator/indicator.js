(() => {
  const SELECTOR = [
    'button[aria-label="View options"]',
    'button[aria-label="Diff settings"]',
    'summary:has(> svg[aria-label="Diff settings"])',
    'button[data-testid="diff-view-options"]',
    'button[data-testid="view-options"]',
    'button:has(svg.octicon-gear)',
  ].join(', ');
  const INDICATOR_ATTR = 'data-ghux-settings-indicator';
  const ORIGINAL_LABEL = 'ghuxOriginalAriaLabel';
  const ORIGINAL_TITLE = 'ghuxOriginalTitle';

  const GHUX_NODE = 'data-ghux-menu-node';
  const TEMPLATE_RE = /^(Hide whitespace|Compact line height)$/i;

  const MENU_FEATURES = [
    { storageKey: 'wordWrapEnabled', defaultValue: false, label: 'Word wrap' },
    { storageKey: 'splitViewEnabled', defaultValue: true, label: 'Split view enhancements' },
    { storageKey: 'diffMinimapEnabled', defaultValue: true, label: 'Diff minimap' },
  ];

  function isActive() {
    return document.documentElement.dataset.ghuxPage === 'diff';
  }

  function restore(button) {
    if (!button.hasAttribute(INDICATOR_ATTR)) return;
    button.classList.remove('ghux-settings-indicator');
    button.removeAttribute(INDICATOR_ATTR);

    const label = button.dataset[ORIGINAL_LABEL];
    if (label) button.setAttribute('aria-label', label);
    else button.removeAttribute('aria-label');
    delete button.dataset[ORIGINAL_LABEL];

    const title = button.dataset[ORIGINAL_TITLE];
    if (title) button.setAttribute('title', title);
    else button.removeAttribute('title');
    delete button.dataset[ORIGINAL_TITLE];
  }

  function updateBadge() {
    const active = isActive();
    document.querySelectorAll(`[${INDICATOR_ATTR}]`).forEach((button) => {
      if (!active) restore(button);
    });
    if (!active) return;

    document.querySelectorAll(SELECTOR).forEach((button) => {
      if (button.hasAttribute(INDICATOR_ATTR)) return;
      const originalLabel = button.getAttribute('aria-label') || '';
      const label = originalLabel || 'View options';
      const title = button.getAttribute('title') || '';
      button.dataset[ORIGINAL_LABEL] = originalLabel;
      button.dataset[ORIGINAL_TITLE] = title;
      button.setAttribute('aria-label', `${label} — GHUX settings active`);
      button.setAttribute('title', 'GitHub + GHUX settings');
      button.setAttribute(INDICATOR_ATTR, '');
      button.classList.add('ghux-settings-indicator');
    });
  }

  function toggle(feature) {
    chrome.storage.sync.get({ [feature.storageKey]: feature.defaultValue }, (result) => {
      chrome.storage.sync.set({ [feature.storageKey]: !result[feature.storageKey] });
    });
  }

  function clearGhuxNodes(root) {
    root.querySelectorAll(`[${GHUX_NODE}]`).forEach((n) => n.remove());
  }

  function menuCandidates(ul) {
    return [...ul.querySelectorAll('[role="menuitemradio"], [role="menuitemcheckbox"]')]
      .filter((el) => TEMPLATE_RE.test(el.textContent.trim()));
  }

  function templateFor(ul, checked) {
    const items = menuCandidates(ul);
    const wanted = String(checked);
    const el = items.find((i) => (i.getAttribute('aria-checked') || 'false') === wanted) || items[0];
    return el ? el.closest('li') || el : null;
  }

  function makeDivider() {
    const li = document.createElement('li');
    li.setAttribute(GHUX_NODE, '');
    li.setAttribute('role', 'separator');
    li.style.cssText =
      'list-style:none;height:1px;margin:8px 0;padding:0;background:var(--borderColor-muted,#3d444d);';
    return li;
  }

  function makeHeading(text) {
    const li = document.createElement('li');
    li.setAttribute(GHUX_NODE, '');
    li.textContent = text;
    li.style.cssText =
      'list-style:none;padding:4px 16px 0;font-size:12px;font-weight:600;color:var(--fgColor-muted,#9198a1);';
    return li;
  }

  function buildItem(ul, feature, checked) {
    const template = templateFor(ul, checked);
    if (!template) return null;
    const item = template.cloneNode(true);
    item.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    item.removeAttribute('id');
    for (const attr of ['data-testid', 'aria-describedby', 'aria-labelledby']) {
      item.querySelectorAll(`[${attr}]`).forEach((n) => n.removeAttribute(attr));
      item.removeAttribute(attr);
    }
    item.setAttribute(GHUX_NODE, '');

    const clickable = item.matches('[role]')
      ? item
      : item.querySelector('[role="menuitemradio"], [role="menuitemcheckbox"], button, a');
    if (clickable) {
      clickable.setAttribute('role', 'menuitemcheckbox');
      clickable.setAttribute('aria-checked', String(checked));
      clickable.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(feature);
      });
    }

    const label =
      item.querySelector('[class*="ActionListItem-label"]') ||
      [...item.querySelectorAll('span')].find((s) => s.textContent.trim() && !s.querySelector('*'));
    if (label) label.textContent = feature.label;
    return item;
  }

  function renderReactMenus(values) {
    const uls = [...document.querySelectorAll('ul[class*="ActionList"]')].filter(
      (ul) => menuCandidates(ul).length
    );
    uls
      .filter((ul) => !uls.some((other) => other !== ul && ul.contains(other)))
      .forEach((ul) => {
        clearGhuxNodes(ul);
        ul.append(makeDivider(), makeHeading('GHUX'));
        for (const feature of MENU_FEATURES) {
          const item = buildItem(ul, feature, !!values[feature.storageKey]);
          if (item) ul.append(item);
        }
      });
  }

  function classicItem(feature, checked) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dropdown-item btn-link';
    btn.setAttribute(GHUX_NODE, '');
    btn.setAttribute('role', 'menuitemcheckbox');
    btn.setAttribute('aria-checked', String(checked));
    btn.textContent = (checked ? '✓ ' : '\u00a0\u00a0 ') + feature.label;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggle(feature);
    });
    return btn;
  }

  function renderClassicMenus(values) {
    document.querySelectorAll('details details-menu.dropdown-menu').forEach((menu) => {
      if (!/whitespace/i.test(menu.textContent)) return;
      clearGhuxNodes(menu);
      const divider = document.createElement('div');
      divider.className = 'dropdown-divider';
      divider.setAttribute(GHUX_NODE, '');
      const header = document.createElement('div');
      header.className = 'dropdown-header';
      header.setAttribute(GHUX_NODE, '');
      header.textContent = 'GHUX';
      menu.append(divider, header);
      for (const feature of MENU_FEATURES) {
        menu.append(classicItem(feature, !!values[feature.storageKey]));
      }
    });
  }

  let rendering = false;

  function renderAll() {
    updateBadge();
    if (!isActive() || rendering) return;
    rendering = true;
    const defaults = Object.fromEntries(
      MENU_FEATURES.map((f) => [f.storageKey, f.defaultValue])
    );
    chrome.storage.sync.get(defaults, (values) => {
      renderReactMenus(values);
      renderClassicMenus(values);
      rendering = false;
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (MENU_FEATURES.some((f) => changes[f.storageKey])) renderAll();
  });

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      renderAll();
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
            (n.hasAttribute?.(GHUX_NODE) || n.querySelector?.(`[${GHUX_NODE}]`))
        )
      ) {
        continue;
      }
      schedule();
      return;
    }
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-ghux-page'],
    childList: true,
    subtree: true,
  });

  document.addEventListener('ghux:navigation', renderAll);
  renderAll();
})();
