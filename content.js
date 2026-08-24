const FEATURES = [
  {
    id: 'word-wrap',
    storageKey: 'wordWrapEnabled',
    defaultValue: false,
    attr: 'ghuxWrap',
  },
  {
    id: 'split-view',
    storageKey: 'splitViewEnabled',
    defaultValue: true,
    attr: 'ghuxSplit',
  },
  {
    id: 'diff-minimap',
    storageKey: 'diffMinimapEnabled',
    defaultValue: true,
    attr: 'ghuxMinimap',
  },
];

// Only diff "main pages" get GHUX treatment. Embedded diffs elsewhere
// (PR conversation comments, suggested changes, ...) stay untouched.
// Note: GitHub's new PR diff experience uses /pull/<n>/changes instead of
// /pull/<n>/files — same React diff view, both must match.
const DIFF_PAGE_RE =
  /^\/[^/]+\/[^/]+\/(?:pull\/\d+\/(?:files|changes|commits\/[0-9a-f]+)|commit\/[0-9a-f]+|compare\/\S)/i;

const isDiffPage = () => DIFF_PAGE_RE.test(location.pathname);

const state = {};

function refresh() {
  const root = document.documentElement;
  const diff = isDiffPage();
  if (diff) {
    root.dataset.ghuxPage = 'diff';
  } else {
    delete root.dataset.ghuxPage;
  }
  for (const feature of FEATURES) {
    const value = state[feature.storageKey];
    if (!diff || value === undefined) {
      delete root.dataset[feature.attr];
    } else {
      root.dataset[feature.attr] = value ? 'on' : 'off';
    }
  }
}

for (const feature of FEATURES) {
  chrome.storage.sync.get(
    { [feature.storageKey]: feature.defaultValue },
    (result) => {
      state[feature.storageKey] = result[feature.storageKey];
      refresh();
    }
  );
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  for (const feature of FEATURES) {
    const change = changes[feature.storageKey];
    if (change) state[feature.storageKey] = change.newValue;
  }
  refresh();
});

let lastRoute = `${location.pathname}${location.search}`;

function routeKey() {
  return `${location.pathname}${location.search}`;
}

function handleNavigation() {
  const nextRoute = routeKey();
  if (nextRoute === lastRoute) return;
  lastRoute = nextRoute;
  refresh();
  document.dispatchEvent(new CustomEvent('ghux:navigation'));
}

for (const eventName of ['turbo:load', 'turbo:render', 'popstate']) {
  document.addEventListener(eventName, handleNavigation);
}
window.addEventListener('hashchange', handleNavigation);

window.setInterval(handleNavigation, 250);

refresh();
