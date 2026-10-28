// SPDX-License-Identifier: AGPL-3.0-or-later
export const VIEWER_CSS = `
.viewer-open:not(:disabled) { cursor: zoom-in; }
.viewer-open:disabled { cursor: default; }
.media.viewer-open { width: 100%; border: 0; color: inherit; font: inherit; text-align: inherit; }
.viewer-dialog {
  width: min(96vw, 1400px); height: min(94vh, 1000px); max-width: none; max-height: none;
  padding: 0; border: 1px solid var(--line); border-radius: 14px;
  background: var(--panel); color: var(--text);
}
.viewer-dialog[open] { display: flex; flex-direction: column; }
.viewer-dialog [hidden] { display: none; }
.viewer-dialog::backdrop { background: rgb(0 0 0 / 72%); }
.dialog-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px 12px; padding: 10px 14px; border-bottom: 1px solid var(--line); }
.dialog-head h2 { flex: 1 1 180px; margin: 0; overflow-wrap: anywhere; font-size: 18px; }
.dialog-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.viewer-help { margin: 0; padding: 4px 14px; color: var(--muted); font-size: 12px; }
@media (pointer: coarse) { .viewer-navigation-help { display: none; } }
.inspection-surface { display: flex; flex: 1 1 auto; min-height: 0; width: 100%; overflow: auto; overscroll-behavior: contain; overflow-anchor: none; background: var(--panel-2); }
.inspection-image { display: block; flex: none; max-width: none; max-height: none; margin: auto; outline: 1px solid var(--line); cursor: default; }
.inspection-image.zoomable { cursor: zoom-in; }
.inspection-image.actual { cursor: zoom-out; }
`.trim()

export const VIEWER_DIALOG = `<dialog class="viewer-dialog" id="inspection-dialog" aria-labelledby="inspection-title">
  <div class="dialog-head"><h2 id="inspection-title">Screenshot viewer</h2><div class="dialog-actions"><button class="action" type="button" data-viewer-prev hidden disabled>Previous</button><span data-viewer-position role="status" aria-live="polite" hidden></span><button class="action" type="button" data-viewer-next hidden disabled>Next</button><button class="action" type="button" data-viewer-toggle>Actual pixels</button><form method="dialog"><button class="action" type="submit" data-close>Close</button></form></div></div>
  <p class="viewer-help">Actual pixels shows one image pixel per viewing device pixel. Click the image to zoom at that point. <span class="viewer-navigation-help" hidden></span></p>
  <div class="inspection-surface" tabindex="0"></div>
</dialog>`

export const VIEWER_SCRIPT = `
(() => {
  const dialog = document.querySelector('#inspection-dialog');
  const surface = dialog.querySelector('.inspection-surface');
  const title = dialog.querySelector('#inspection-title');
  const toggleButton = dialog.querySelector('[data-viewer-toggle]');
  const previousButton = dialog.querySelector('[data-viewer-prev]');
  const nextButton = dialog.querySelector('[data-viewer-next]');
  const position = dialog.querySelector('[data-viewer-position]');
  const help = dialog.querySelector('.viewer-help');
  const navigationHelp = dialog.querySelector('.viewer-navigation-help');
  let image = null;
  let returnFocus = null;
  let initialOpener = null;
  let currentCard = null;
  let openerKind = null;
  let actual = false;
  let generation = 0;
  let lastPointerUp = null;
  const dpr = () => window.devicePixelRatio > 0 && Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1;
  const clamp = (value, max) => Math.max(0, Math.min(value, max));
  const pointAtCenter = () => {
    const rect = image.getBoundingClientRect();
    const box = surface.getBoundingClientRect();
    return {
      x: clamp((box.left + box.width / 2 - rect.left) / rect.width, 1),
      y: clamp((box.top + box.height / 2 - rect.top) / rect.height, 1),
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    };
  };
  const align = (anchor) => {
    const rect = image.getBoundingClientRect();
    surface.scrollLeft = clamp(surface.scrollLeft + rect.left + anchor.x * rect.width - anchor.clientX, surface.scrollWidth - surface.clientWidth);
    surface.scrollTop = clamp(surface.scrollTop + rect.top + anchor.y * rect.height - anchor.clientY, surface.scrollHeight - surface.clientHeight);
  };
  const size = (anchor) => {
    if (!image || !dialog.open) return;
    const width = image.naturalWidth / dpr();
    const height = image.naturalHeight / dpr();
    const fit = Math.min(surface.clientWidth / width, surface.clientHeight / height, 1);
    if (fit === 1) actual = false;
    image.style.width = width * (actual ? 1 : fit) + 'px';
    image.style.height = height * (actual ? 1 : fit) + 'px';
    image.classList.toggle('actual', actual);
    image.classList.toggle('zoomable', fit < 1 && !actual);
    toggleButton.hidden = fit === 1;
    help.hidden = fit === 1;
    toggleButton.textContent = actual ? 'Fit to window' : 'Actual pixels';
    if (anchor) {
      align(anchor);
    } else {
      surface.scrollLeft = 0;
      surface.scrollTop = 0;
    }
  };
  const ready = async (token, anchor) => {
    await new Promise(requestAnimationFrame);
    if (token === generation && dialog.open && image) {
      if (anchor) align(anchor);
      dialog.dataset.viewerState = 'ready';
    }
  };
  const toggle = (anchor) => {
    if (!image?.naturalWidth || toggleButton.hidden || dialog.dataset.viewerState !== 'ready') return;
    dialog.removeAttribute('data-viewer-state');
    const token = ++generation;
    actual = !actual;
    size(anchor);
    void ready(token, anchor);
  };
  const eligibleCards = () => Array.from(document.querySelectorAll('.card:not(.hidden)')).filter((card) => {
    const source = card.querySelector('[data-original]');
    const opener = card.querySelector('[data-viewer-open]:not(:disabled)');
    return source && source.href && opener && document.getElementById(opener.dataset.viewerOpen) === source;
  });
  const matchingOpener = (card) => card?.querySelector(openerKind === 'text'
    ? '[data-inspect]:not(:disabled)'
    : '.media[data-viewer-open]:not(:disabled)');
  const updateNavigation = () => {
    const gallery = currentCard !== null;
    previousButton.hidden = nextButton.hidden = position.hidden = navigationHelp.hidden = !gallery;
    navigationHelp.textContent = gallery ? 'While fitted, Left and Right move between shots; in actual pixels, focus the image to pan with arrow keys.' : '';
    if (!gallery) {
      previousButton.disabled = nextButton.disabled = true;
      return;
    }
    const cards = eligibleCards();
    const index = cards.indexOf(currentCard);
    const nextPosition = index < 0 ? '' : (index + 1) + ' of ' + cards.length;
    if (position.textContent !== nextPosition) position.textContent = nextPosition;
    previousButton.disabled = index <= 0;
    nextButton.disabled = index < 0 || index >= cards.length - 1;
  };
  const showSource = async (source, opener, card, open) => {
    const uri = source.href || source.src;
    if (!uri) return;
    const token = ++generation;
    dialog.removeAttribute('data-viewer-state');
    returnFocus = opener;
    currentCard = card;
    actual = false;
    title.textContent = (source.dataset.name || source.alt || 'Screenshot') + ' — Screenshot';
    surface.replaceChildren();
    image = document.createElement('img');
    image.className = 'inspection-image';
    image.alt = source.dataset.alt || source.alt || 'Screenshot';
    image.src = uri;
    surface.append(image);
    updateNavigation();
    if (open) {
      initialOpener = opener;
      dialog.showModal();
      watchDpr();
      dialog.querySelector('[data-close]').focus();
    }
    const pending = image;
    try { await pending.decode(); } catch { return; }
    if (token !== generation || !dialog.open) return;
    size();
    void ready(token);
  };
  const navigate = (offset) => {
    if (!dialog.open || !currentCard || actual) return;
    const cards = eligibleCards();
    const index = cards.indexOf(currentCard);
    const target = index < 0 ? null : cards[index + offset];
    if (!target) return;
    const opener = matchingOpener(target);
    const source = target.querySelector('[data-original]');
    if (opener && source) void showSource(source, opener, target, false);
  };
  previousButton.addEventListener('click', () => navigate(-1));
  nextButton.addEventListener('click', () => navigate(1));
  dialog.addEventListener('keydown', (event) => {
    if (!currentCard || actual || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        event.target.closest('input, textarea, select, [contenteditable]')) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    navigate(event.key === 'ArrowLeft' ? -1 : 1);
  });
  document.querySelectorAll('[data-viewer-open]').forEach((button) => {
    const source = document.getElementById(button.dataset.viewerOpen);
    if (!source) return;
    button.disabled = false;
    button.addEventListener('click', () => {
      const card = button.closest('.card');
      openerKind = button.matches('[data-inspect]') ? 'text' : 'preview';
      void showSource(source, button, card, true);
    });
  });
  toggleButton.addEventListener('click', () => { if (image) toggle(pointAtCenter()); });
  surface.addEventListener('pointerup', (event) => {
    lastPointerUp = event.target === image ? { clientX: event.clientX, clientY: event.clientY } : null;
  });
  surface.addEventListener('click', (event) => {
    const pointer = event.isTrusted ? lastPointerUp : null;
    lastPointerUp = null;
    if (event.target !== image || toggleButton.hidden) return;
    const rect = image.getBoundingClientRect();
    const clientX = pointer?.clientX ?? event.clientX;
    const clientY = pointer?.clientY ?? event.clientY;
    toggle({ x: clamp((clientX - rect.left) / rect.width, 1), y: clamp((clientY - rect.top) / rect.height, 1), clientX, clientY });
  });
  const refresh = () => {
    if (!image || !dialog.open || !image.naturalWidth) return;
    dialog.removeAttribute('data-viewer-state');
    const token = ++generation;
    const anchor = actual ? pointAtCenter() : null;
    size(anchor);
    void ready(token, anchor);
  };
  window.addEventListener('resize', refresh);
  let unwatchDpr = () => {};
  const watchDpr = () => {
    unwatchDpr();
    const query = window.matchMedia('(resolution: ' + dpr() + 'dppx)');
    const onChange = () => {
      if (!dialog.open) return;
      watchDpr();
      refresh();
    };
    query.addEventListener('change', onChange);
    unwatchDpr = () => query.removeEventListener('change', onChange);
  };
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    unwatchDpr();
    ++generation;
    dialog.removeAttribute('data-viewer-state');
    surface.replaceChildren();
    image = null;
    currentCard = null;
    // The close event is queued; focus may already have moved elsewhere.
    const active = document.activeElement;
    if (!active || active === document.body || active === initialOpener || dialog.contains(active)) returnFocus?.focus();
    returnFocus = null;
    initialOpener = null;
  });
})();
`.trim()
