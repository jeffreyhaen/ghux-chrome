// Adds a per-repository delete button (trash icon) next to the Star dropdown
// on your own profile's repositories tab (/<you>?tab=repositories). Deletion
// goes through the GitHub API and requires typing the full "owner/repo" name
// to confirm, mirroring GitHub's own delete flow. Requires a token with the
// delete_repo scope (classic) or Administration: write (fine-grained).
(() => {
  const UI_ATTR = 'data-ghux-delete-ui';
  const LIST_SELECTOR = '#user-repositories-list';
  const LINK_SELECTOR = 'a[itemprop="name codeRepository"]';
  const TRASH_PATH =
    'M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.75 1.75 0 0 1 10.595 15H5.405a1.75 1.75 0 0 1-1.741-1.576l-.66-6.6a.75.75 0 1 1 1.492-.149Z';

  function isActive() {
    return document.documentElement.dataset.ghuxCleanup === 'on';
  }

  function isOwnProfile() {
    const login = document
      .querySelector('meta[name="user-login"]')
      ?.getAttribute('content');
    if (!login) return false;
    const owner = location.pathname.split('/')[1] || '';
    return owner.toLowerCase() === login.toLowerCase();
  }

  function repoRef(link) {
    const m = (link.getAttribute('href') || '').match(/^\/([^/]+)\/([^/]+)\/?$/);
    return m ? { owner: m[1], name: m[2] } : null;
  }

  function octiconTrash() {
    return `<svg class="octicon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="${TRASH_PATH}"></path></svg>`;
  }

  // The Star button and its caret live in the starring container; the delete
  // button goes right next to them.
  function buttonHost(item) {
    return (
      item.querySelector('.starring-container') ||
      item.querySelector('a[href$="/stargazers"]')?.parentElement ||
      item.lastElementChild
    );
  }

  function addButton(item, ref) {
    if (item.querySelector(`[${UI_ATTR}]`)) return;
    const host = buttonHost(item);
    if (!host) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm btn-danger ghux-repo-delete-btn';
    btn.setAttribute(UI_ATTR, '');
    btn.setAttribute('aria-label', `Delete repository ${ref.owner}/${ref.name}`);
    btn.title = `Delete ${ref.owner}/${ref.name}`;
    btn.innerHTML = octiconTrash();
    btn.addEventListener('click', () => openDialog(ref, item));
    host.append(btn);
  }

  function notify(message, danger) {
    const toast = document.createElement('div');
    toast.setAttribute(UI_ATTR, '');
    toast.style.cssText =
      'position:fixed;top:16px;right:16px;z-index:99999;padding:12px 16px;' +
      'border-radius:6px;font-size:13px;max-width:320px;' +
      `background:var(--bgColor-${danger ? 'danger' : 'success'}-muted,${danger ? '#ffebe9' : '#dafbe1'});` +
      `color:var(--fgColor-${danger ? 'danger' : 'success'},${danger ? '#cf222e' : '#1a7f37'});` +
      `border:1px solid var(--borderColor-${danger ? 'danger' : 'success'}-muted,${danger ? '#ff818266' : '#4ac26b66'});` +
      'box-shadow:var(--shadow-resting-medium,0 8px 24px rgba(0,0,0,.2));';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  }

  async function deleteRepo(ref, token) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${ref.owner}/${ref.name}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        }
      );
      if (res.status === 204) return { ok: true };
      const data = await res.json().catch(() => ({}));
      let message = `${res.status} — ${data.message || 'unknown error'}`;
      if (res.status === 403 && /admin rights/i.test(data.message || '')) {
        message +=
          '. Token lacks permission: add the delete_repo scope (classic token)' +
          ' or Administration: read/write on this repository (fine-grained token). ' +
          'For fine-grained tokens, also check Repository access covers this repo.';
      }
      return { ok: false, message };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  }

  let overlay = null;

  function buildDialog() {
    overlay = document.createElement('div');
    overlay.className = 'ghux-repo-delete-overlay';
    overlay.setAttribute(UI_ATTR, '');
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="ghux-repo-delete-dialog" role="dialog" aria-modal="true" aria-label="Delete repository">
        <div class="ghux-repo-delete-header">Delete repository</div>
        <div class="ghux-repo-delete-body">
          <p class="ghux-repo-delete-warning">
            This will permanently delete the repository
            <strong class="ghux-repo-delete-name"></strong>,
            including all issues, pull requests, releases and workflows.
            This cannot be undone.
          </p>
          <p class="ghux-repo-delete-instruction"></p>
          <input type="text" class="ghux-repo-delete-input" autocomplete="off" spellcheck="false">
          <div class="ghux-repo-delete-error" hidden></div>
          <p class="ghux-repo-delete-notoken" hidden>
            No GitHub token configured. Add a token with the
            <code>delete_repo</code> scope in the GHUX popup to delete repositories.
          </p>
        </div>
        <div class="ghux-repo-delete-footer">
          <button type="button" class="btn ghux-repo-delete-cancel">Cancel</button>
          <button type="button" class="btn btn-danger ghux-repo-delete-confirm" disabled>Delete this repository</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeDialog();
    });
    overlay.querySelector('.ghux-repo-delete-cancel').addEventListener('click', closeDialog);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay && !overlay.hidden) closeDialog();
    });
    return overlay;
  }

  function closeDialog() {
    if (overlay) overlay.hidden = true;
  }

  function openDialog(ref, item) {
    chrome.storage.local.get({ githubToken: '' }, (cfg) => {
      const fullName = `${ref.owner}/${ref.name}`;
      const dlg = overlay || buildDialog();
      const input = dlg.querySelector('.ghux-repo-delete-input');
      const confirm = dlg.querySelector('.ghux-repo-delete-confirm');
      const error = dlg.querySelector('.ghux-repo-delete-error');
      const notoken = dlg.querySelector('.ghux-repo-delete-notoken');

      dlg.querySelector('.ghux-repo-delete-name').textContent = fullName;
      dlg.querySelector('.ghux-repo-delete-instruction').innerHTML =
        `To confirm, type <strong>${fullName}</strong> below:`;
      input.value = '';
      input.disabled = !cfg.githubToken;
      confirm.disabled = true;
      confirm.textContent = 'Delete this repository';
      error.hidden = true;
      notoken.hidden = !!cfg.githubToken;
      dlg.hidden = false;
      input.focus();

      input.oninput = () => {
        confirm.disabled =
          input.value.trim().toLowerCase() !== fullName.toLowerCase();
      };

      confirm.onclick = async () => {
        confirm.disabled = true;
        input.disabled = true;
        confirm.textContent = 'Deleting…';
        error.hidden = true;
        const result = await deleteRepo(ref, cfg.githubToken);
        if (result.ok) {
          closeDialog();
          item.classList.add('ghux-repo-deleted');
          setTimeout(() => item.remove(), 400);
          notify(`GHUX: ${fullName} deleted.`, false);
        } else {
          confirm.textContent = 'Delete this repository';
          input.disabled = false;
          error.textContent = `Delete failed: ${result.message}`;
          error.hidden = false;
        }
      };
    });
  }

  function render() {
    if (!isActive() || !isOwnProfile()) {
      document.querySelectorAll(`.ghux-repo-delete-btn`).forEach((n) => n.remove());
      return;
    }
    const list = document.querySelector(LIST_SELECTOR);
    if (!list) return;
    const viewer = document
      .querySelector('meta[name="user-login"]')
      ?.getAttribute('content');
    list.querySelectorAll(LINK_SELECTOR).forEach((link) => {
      const ref = repoRef(link);
      if (!ref || !viewer) return;
      if (ref.owner.toLowerCase() !== viewer.toLowerCase()) return;
      const item = link.closest('li');
      if (item) addButton(item, ref);
    });
  }

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      render();
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
            (n.hasAttribute?.(UI_ATTR) || n.querySelector?.(`[${UI_ATTR}]`))
        )
      ) {
        continue;
      }
      schedule();
      return;
    }
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-ghux-page', 'data-ghux-cleanup'],
    childList: true,
    subtree: true,
  });

  document.addEventListener('ghux:navigation', render);
  render();
})();
