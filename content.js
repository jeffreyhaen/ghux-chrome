const FEATURES = [
  {
    id: 'word-wrap',
    storageKey: 'wordWrapEnabled',
    defaultValue: false,
    apply(on) {
      document.documentElement.dataset.ghuxWrap = on ? 'on' : 'off';
    },
  },
  {
    id: 'split-view',
    storageKey: 'splitViewEnabled',
    defaultValue: true,
    apply(on) {
      document.documentElement.dataset.ghuxSplit = on ? 'on' : 'off';
    },
  },
];

for (const feature of FEATURES) {
  chrome.storage.sync.get(
    { [feature.storageKey]: feature.defaultValue },
    (result) => feature.apply(result[feature.storageKey])
  );
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  for (const feature of FEATURES) {
    const change = changes[feature.storageKey];
    if (change) feature.apply(change.newValue);
  }
});
