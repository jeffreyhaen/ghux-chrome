const wordWrap = document.getElementById('wordWrap');

chrome.storage.sync.get({ wordWrapEnabled: true }, (result) => {
  wordWrap.checked = result.wordWrapEnabled;
});

wordWrap.addEventListener('change', () => {
  chrome.storage.sync.set({ wordWrapEnabled: wordWrap.checked });
});
