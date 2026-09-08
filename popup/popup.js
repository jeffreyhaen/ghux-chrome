const toggles = [
  { el: document.getElementById('wordWrap'), key: 'wordWrapEnabled', defaultValue: false },
  { el: document.getElementById('splitView'), key: 'splitViewEnabled', defaultValue: true },
  { el: document.getElementById('diffMinimap'), key: 'diffMinimapEnabled', defaultValue: true },
  { el: document.getElementById('quickApprove'), key: 'quickApproveEnabled', defaultValue: true },
  { el: document.getElementById('prCommits'), key: 'prCommitsEnabled', defaultValue: true },
  { el: document.getElementById('repoCleanup'), key: 'repoCleanupEnabled', defaultValue: false },
  { el: document.getElementById('prDashboard'), key: 'prDashboardEnabled', defaultValue: true },
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

const tokenInput = document.getElementById('token');
const tokenStatus = document.getElementById('tokenStatus');

chrome.storage.local.get({ githubToken: '' }, (result) => {
  if (result.githubToken) {
    tokenInput.value = result.githubToken;
    tokenStatus.textContent = 'Token saved — quick review actions use the GitHub API.';
  } else {
    tokenStatus.textContent = 'No token — quick review actions use form automation.';
  }
});

document.getElementById('saveToken').addEventListener('click', () => {
  const token = tokenInput.value.trim();
  chrome.storage.local.set({ githubToken: token }, () => {
    tokenStatus.textContent = token
      ? 'Token saved — quick review actions use the GitHub API.'
      : 'Token cleared — quick review actions use form automation.';
  });
});
