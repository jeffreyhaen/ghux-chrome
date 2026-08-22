const toggles = [
  { el: document.getElementById('wordWrap'), key: 'wordWrapEnabled', defaultValue: false },
  { el: document.getElementById('splitView'), key: 'splitViewEnabled', defaultValue: true },
];

const defaults = Object.fromEntries(toggles.map((t) => [t.key, t.defaultValue]));

chrome.storage.sync.get(defaults, (result) => {
  for (const t of toggles) t.el.checked = result[t.key];
});

for (const t of toggles) {
  t.el.addEventListener('change', () => {
    chrome.storage.sync.set({ [t.key]: t.el.checked });
  });
}
