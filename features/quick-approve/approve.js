// Adds an "Approve" split button (Azure DevOps style) to the Reviewers
// sidebar section on PR conversation pages, and replaces the native
// "Submit review" control on the PR diff pages (/files, /changes).
// On the conversation page, actions submit through the form or the
// GitHub API when a token is configured.
// On diff pages the native control stays in the DOM but is hidden
// behind the GHUX button, and every action runs through GitHub's own
// review form so pending inline comments are submitted together with
// the review. Falls back to the PR diff tab when no review form is on
// the page (#ghux-review-<actionId>).
(() => {
  const WRAP_ATTR = 'data-ghux-approve-btn';
  const HIDE_ATTR = 'data-ghux-hide-submit';
  const REVIEW_DIALOG = '#review-changes-modal';
  const SUBMIT_LABELS = /submit review|review changes/i;

  const EVENTS = {
    approve: /approve/i,
    reject: /reject|request/i,
  };

  const ICONS = {
    check:
      'M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z',
    comment:
      'M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z',
    clock:
      'M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm7-3.25v2.992l2.028.812a.75.75 0 0 1-.557 1.392l-2.5-1A.75.75 0 0 1 7 8.25v-3.5a.75.75 0 0 1 1.5 0Z',
    triangle:
      'M4.427 7.427l3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z',
  };

  const ACTIONS = [
    {
      id: 'approve',
      event: 'approve',
      label: 'Approve',
      icon: 'check',
      color: 'success',
    },
    {
      id: 'approve-suggestions',
      event: 'approve',
      label: 'Approve with suggestions',
      icon: 'comment',
      color: 'success',
      body: 'Approved with suggestions',
    },
    {
      id: 'request-changes',
      event: 'reject',
      label: 'Wait for author',
      icon: 'clock',
      color: 'attention',
      body: 'Wait for author',
      dividerBefore: true,
    },
  ];

  const DIFF_EXTRA_ACTIONS = [
    {
      id: 'open-review-dialog',
      label: 'Open review dialog\u2026',
      icon: 'comment',
      color: 'muted',
      dividerBefore: true,
      openDialogOnly: true,
    },
  ];

  function isActive() {
    const root = document.documentElement;
    const page = root.dataset.ghuxPage;
    return (page === 'pr' || page === 'diff') && root.dataset.ghuxApprove === 'on';
  }

  function isDiff() {
    return document.documentElement.dataset.ghuxPage === 'diff';
  }

  function findReviewersSection() {
    const sidebar =
      document.querySelector('#partial-discussion-sidebar') ||
      document.querySelector('[data-testid="issue-sidebar"]') ||
      document;
    const candidates = sidebar.querySelectorAll(
      '.discussion-sidebar-item, [data-testid*="reviewer" i]'
    );
    for (const item of candidates) {
      if (/reviewers/i.test(item.textContent)) return item;
    }
    return null;
  }

  // A review form is any form posting to the PR's /reviews endpoint. This
  // works in both the classic and the new React PR experience.
  function reviewForms() {
    return [...document.querySelectorAll('form')].filter((f) =>
      /\/reviews(?:\?|$)/.test(f.action || '')
    );
  }

  function formFor(eventKey) {
    for (const form of reviewForms()) {
      const radio = [...form.querySelectorAll('input[type="radio"]')].find(
        (r) => EVENTS[eventKey].test(r.value) && !r.disabled
      );
      if (radio) return { radio, form };
    }
    return null;
  }

  function isReviewDialogOpen() {
    const classic = document.querySelector(REVIEW_DIALOG);
    if (classic?.open) return true;
    return [...document.querySelectorAll('[role="dialog"], dialog[open]')].some(
      (d) => SUBMIT_LABELS.test(d.textContent)
    );
  }

  function openReviewDialog({ force = false } = {}) {
    // Never click the toggle when the dialog is already (opening) — a second
    // click would close it again.
    if (isReviewDialogOpen() || (!force && reviewForms().length)) return true;

    const classic = document.querySelector(REVIEW_DIALOG);
    if (classic) {
      const summary = classic.querySelector('summary');
      if (summary) summary.click();
      else classic.open = true;
      return true;
    }
    // New PR experience: a plain button opens a React-rendered dialog.
    const btn = [...document.querySelectorAll('button, summary')].find((b) => {
      if (b.closest(`[${WRAP_ATTR}]`)) return false;
      const label = `${(b.textContent || '').trim()} ${
        b.getAttribute('aria-label') || ''
      }`;
      return SUBMIT_LABELS.test(label);
    });
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }

  function fillBody(form, body) {
    const textarea = form.querySelector('textarea');
    if (!textarea) return;
    // Native setter, so React-controlled inputs pick the value up too.
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    ).set.call(textarea, body);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function submitButton(form) {
    return (
      form.querySelector('button[type="submit"]') ||
      form.querySelector('input[type="submit"]') ||
      [...form.querySelectorAll('button')].find((b) =>
        /submit review/i.test(b.textContent)
      )
    );
  }

  function submitReview(action) {
    const found = formFor(action.event) || (openReviewDialog() && formFor(action.event));
    if (!found) return false;
    if (action.body) fillBody(found.form, action.body);
    if (!found.radio.checked) found.radio.click();
    const submit = submitButton(found.form);
    if (!submit || submit.disabled) return false;
    submit.click();
    return true;
  }

  function navigateToFiles(action) {
    const match = location.pathname.match(/^(\/[^/]+\/[^/]+\/pull\/\d+)/i);
    if (!match) return false;
    const tab = /\/changes\/?$/i.test(location.pathname) ? 'changes' : 'files';
    location.assign(`${match[1]}/${tab}#ghux-review-${action.id}`);
    return true;
  }

  const API_EVENTS = { approve: 'APPROVE', reject: 'REQUEST_CHANGES' };

  function parsePrRef() {
    const m = location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
    return m ? { owner: m[1], repo: m[2], number: m[3] } : null;
  }

  async function submitViaApi(action, token) {
    const pr = parsePrRef();
    if (!pr) return { ok: false, message: 'not a pull request page' };
    try {
      const res = await fetch(
        `https://api.github.com/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/reviews`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            event: API_EVENTS[action.event],
            ...(action.body ? { body: action.body } : {}),
          }),
        }
      );
      if (res.ok) return { ok: true };
      const data = await res.json().catch(() => ({}));
      const detail =
        (data.errors && data.errors[0] && data.errors[0].message) ||
        data.message ||
        'unknown error';
      return {
        ok: false,
        message: `${res.status} — ${detail} (${pr.owner}/${pr.repo}#${pr.number})`,
      };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  }

  function notify(message) {
    const toast = document.createElement('div');
    toast.setAttribute('data-ghux-toast', '');
    toast.style.cssText =
      'position:fixed;top:16px;right:16px;z-index:99999;padding:12px 16px;' +
      'border-radius:6px;font-size:13px;max-width:320px;' +
      'background:var(--bgColor-attention-muted,#fff8c5);' +
      'color:var(--fgColor-attention,#9a6700);' +
      'border:1px solid var(--borderColor-attention-muted,#d4a72c);' +
      'box-shadow:var(--shadow-resting-medium,0 8px 24px rgba(0,0,0,.2));';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  }

  function markDone(btn) {
    btn.disabled = true;
    btn.textContent = 'Submitting…';
  }

  function markFailed(btn, message) {
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = message;
    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = original;
    }, 3000);
  }

  function runDomAction(action, mainBtn) {
    const deadline = Date.now() + 4000;
    const attempt = () => {
      if (submitReview(action)) return;
      if (Date.now() < deadline) return setTimeout(attempt, 300);
      if (!navigateToFiles(action)) {
        markFailed(mainBtn, 'Review form not found');
        notify('GHUX: no review form found on this page.');
      }
    };
    attempt();
  }

  function runAction(action, mainBtn) {
    markDone(mainBtn);
    if (isDiff()) return runDomAction(action, mainBtn);
    chrome.storage.local.get({ githubToken: '' }, (cfg) => {
      if (!cfg.githubToken) return runDomAction(action, mainBtn);
      submitViaApi(action, cfg.githubToken).then((result) => {
        if (result.ok) return location.reload();
        markFailed(mainBtn, 'Failed');
        notify(`GHUX: review failed — ${result.message}`);
      });
    });
  }

  function autoReviewFromHash() {
    const m = location.hash.match(/^#ghux-review-([\w-]+)$/);
    if (!m) return;
    const action = ACTIONS.find((a) => a.id === m[1]);
    if (!action) return;
    history.replaceState(null, '', location.pathname + location.search);
    const deadline = Date.now() + 15000;
    const attempt = () => {
      if (submitReview(action)) return;
      if (Date.now() < deadline) return setTimeout(attempt, 300);
      notify(`GHUX: could not ${action.label} — review form not found.`);
    };
    setTimeout(attempt, 500);
  }

  function octicon(name) {
    return `<svg class="octicon octicon-${name}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="${ICONS[name]}"></path></svg>`;
  }

  function buildMenuItem(action, mainBtn) {
    const li = document.createElement('li');
    if (action.dividerBefore) {
      const divider = document.createElement('li');
      divider.className = 'dropdown-divider';
      divider.setAttribute('role', 'separator');
      li.appendChild(divider);
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dropdown-item btn-link';
    btn.innerHTML = `<span class="ghux-review-icon ghux-fg-${action.color}">${octicon(action.icon)}</span>${action.label}`;
    btn.title = action.body ? `Posts comment: "${action.body}"` : '';
    btn.addEventListener('click', () => {
      const details = btn.closest('details');
      if (details) details.removeAttribute('open');
      if (action.openDialogOnly) return openReviewDialog({ force: true });
      runAction(action, mainBtn);
    });
    li.appendChild(btn);
    return li;
  }

  function buildWidget({ inline = false } = {}) {
    const wrap = document.createElement('div');
    wrap.setAttribute(WRAP_ATTR, '');
    wrap.className = inline
      ? 'ghux-review-split ghux-review-inline'
      : 'ghux-review-split mt-2';

    const mainBtn = document.createElement('button');
    mainBtn.type = 'button';
    mainBtn.className = 'btn btn-sm btn-primary ghux-review-main';
    mainBtn.innerHTML = `${octicon('check')} Approve`;
    mainBtn.addEventListener('click', () => runAction(ACTIONS[0], mainBtn));

    const details = document.createElement('details');
    details.className = 'details-reset details-overlay ghux-review-menu';
    const summary = document.createElement('summary');
    summary.className = 'btn btn-sm btn-primary ghux-review-toggle';
    summary.setAttribute('aria-haspopup', 'true');
    summary.setAttribute('aria-label', 'More review options');
    summary.innerHTML = octicon('triangle');
    details.appendChild(summary);

    const menu = document.createElement('ul');
    menu.className = 'dropdown-menu dropdown-menu-sw';
    const menuActions = inline ? [...ACTIONS, ...DIFF_EXTRA_ACTIONS] : ACTIONS;
    for (const action of menuActions) {
      menu.appendChild(buildMenuItem(action, mainBtn));
    }
    details.appendChild(menu);

    wrap.append(mainBtn, details);
    return wrap;
  }

  function findDiffSubmitReviewAnchor() {
    const candidates = [...document.querySelectorAll('button, summary')].filter(
      (b) => {
        if (!(b instanceof HTMLElement)) return false;
        if (b.closest(`[${WRAP_ATTR}]`)) return false;
        if (b.closest('form')) return false;
        if (b.closest('dialog, [role="dialog"]')) return false;
        const rect = b.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const label = `${(b.textContent || '').trim()} ${
          b.getAttribute('aria-label') || ''
        }`;
        return SUBMIT_LABELS.test(label);
      }
    );
    return candidates[0] || null;
  }

  function restoreHiddenAnchors() {
    document.querySelectorAll(`[${HIDE_ATTR}]`).forEach((n) =>
      n.removeAttribute(HIDE_ATTR)
    );
  }

  function nativeReviewTarget(anchor) {
    const group = anchor.closest('.ButtonGroup, .btn-group');
    if (group) return group;
    const parent = anchor.parentElement;
    if (
      !parent ||
      parent === document.body ||
      parent.children.length < 2 ||
      parent.children.length > 3
    ) {
      return anchor;
    }
    const controls = [...parent.children].every((child) =>
      /^(BUTTON|DETAILS|SUMMARY)$/.test(child.tagName)
    );
    return controls ? parent : anchor;
  }

  function render() {
    if (!isActive()) {
      restoreHiddenAnchors();
      document.querySelectorAll(`[${WRAP_ATTR}]`).forEach((n) => n.remove());
      return;
    }
    const onDiff = isDiff();
    const existing = document.querySelector(`[${WRAP_ATTR}]`);
    if (existing && existing.isConnected) {
      // Already injected and valid
      return;
    }
    restoreHiddenAnchors();
    document.querySelectorAll(`[${WRAP_ATTR}]`).forEach((n) => n.remove());
    const anchor = onDiff
      ? findDiffSubmitReviewAnchor()
      : findReviewersSection();
    if (!anchor) return;
    if (onDiff) {
      const target = nativeReviewTarget(anchor);
      const parent = target.parentElement;
      if (!parent) return;
      target.setAttribute(HIDE_ATTR, '');
      parent.insertBefore(buildWidget({ inline: true }), target);
    } else {
      anchor.append(buildWidget());
    }
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
    // If the widget is already rendered on the page, do nothing!
    if (document.querySelector(`[${WRAP_ATTR}]`)) return;

    for (const m of mutations) {
      const nodes = [...m.addedNodes, ...m.removedNodes];
      if (
        nodes.length &&
        nodes.every(
          (n) =>
            n.nodeType === 1 &&
            (n.hasAttribute?.(WRAP_ATTR) ||
              n.hasAttribute?.('data-ghux-toast') ||
              n.querySelector?.(`[${WRAP_ATTR}]`))
        )
      ) {
        continue;
      }
      schedule();
      return;
    }
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-ghux-page', 'data-ghux-approve'],
    childList: true,
    subtree: true,
  });

  document.addEventListener('ghux:navigation', render);
  render();
  autoReviewFromHash();
})();
