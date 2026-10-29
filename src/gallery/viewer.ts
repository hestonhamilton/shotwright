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
.pair-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 14px; border-bottom: 1px solid var(--line); }
.pair-controls button[aria-pressed="true"] { border-color: var(--text); background: var(--panel-2); }
.pair-controls label { display: flex; align-items: center; gap: 8px; }
.pair-controls input { width: min(28vw, 180px); }
.pair-details { padding: 4px 14px; color: var(--muted); font-size: 12px; }
.pair-surface { display: flex; flex: 1 1 auto; min-height: 0; width: 100%; gap: 8px; padding: 8px; box-sizing: border-box; background: var(--panel-2); }
.pair-pane { position: relative; flex: 1 1 0; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; overflow-anchor: none; background: var(--panel); }
.pair-pane-label { position: sticky; top: 0; left: 0; z-index: 2; display: block; width: max-content; padding: 2px 6px; background: var(--panel); }
.pair-stage { position: relative; flex: none; background-color: #aaa; background-image: linear-gradient(45deg,#ddd 25%,transparent 25%),linear-gradient(-45deg,#ddd 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ddd 75%),linear-gradient(-45deg,transparent 75%,#ddd 75%); background-size: 16px 16px; background-position: 0 0,0 8px,8px -8px,-8px 0; }
.pair-stage img { position: absolute; top: 0; left: 0; max-width: none; max-height: none; }
.pair-overlay { flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; }
.pair-overlay .pair-stage { margin: auto; }
.pair-layer-b { position: absolute; inset: 0; }
.pair-error { margin: auto; }
@media (max-width: 624px) { .pair-surface.side-by-side { flex-direction: column; } }
`.trim()

export const VIEWER_DIALOG = `<dialog class="viewer-dialog" id="inspection-dialog" aria-labelledby="inspection-title">
  <div class="dialog-head"><h2 id="inspection-title">Screenshot viewer</h2><div class="dialog-actions"><button class="action" type="button" data-viewer-prev hidden disabled>Previous</button><span data-viewer-position role="status" aria-live="polite" hidden></span><button class="action" type="button" data-viewer-next hidden disabled>Next</button><button class="action" type="button" data-viewer-toggle>Actual pixels</button><form method="dialog"><button class="action" type="submit" data-close>Close</button></form></div></div>
  <p class="viewer-help">Actual pixels shows one image pixel per viewing device pixel. Click the image to zoom at that point. <span class="viewer-navigation-help" hidden></span></p>
  <div class="pair-controls" hidden><button class="action" type="button" data-pair-mode="side" aria-pressed="true" disabled>Side by side</button><button class="action" type="button" data-pair-mode="swipe" aria-pressed="false" disabled>Swipe</button><button class="action" type="button" data-pair-mode="onion" aria-pressed="false" disabled>Onion skin</button><label data-pair-range-wrap hidden><span data-pair-range-label>Swipe</span><input data-pair-range type="range" min="0" max="100" value="50" disabled aria-label="Swipe reveal"><output data-pair-percent>50%</output></label></div>
  <div class="pair-details" hidden></div>
  <div class="inspection-surface" tabindex="0"></div>
  <div class="pair-surface side-by-side" hidden><div class="pair-pane" data-pair-pane="a"><span class="pair-pane-label">A</span><div class="pair-stage"><img alt="A screenshot"></div></div><div class="pair-pane" data-pair-pane="b"><span class="pair-pane-label">B</span><div class="pair-stage"><img alt="B screenshot"></div></div><div class="pair-pane pair-overlay" hidden><div class="pair-stage"><img alt="A screenshot"><div class="pair-layer-b"><img alt="B screenshot"></div></div></div><p class="pair-error" hidden>Comparison images unavailable.</p></div>
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
  const pairControls = dialog.querySelector('.pair-controls');
  const pairSurface = dialog.querySelector('.pair-surface');
  const pairDetails = dialog.querySelector('.pair-details');
  const pairRangeWrap = dialog.querySelector('[data-pair-range-wrap]');
  const pairRange = dialog.querySelector('[data-pair-range]');
  const pairPercent = dialog.querySelector('[data-pair-percent]');
  const pairRangeLabel = dialog.querySelector('[data-pair-range-label]');
  const pairModes = Array.from(dialog.querySelectorAll('[data-pair-mode]'));
  const pairPanes = Array.from(dialog.querySelectorAll('[data-pair-pane]'));
  const overlayPane = dialog.querySelector('.pair-overlay');
  const pairError = dialog.querySelector('.pair-error');
  const pairImages = Array.from(pairSurface.querySelectorAll('img'));
  let viewerMode = 'closed';
  let pairMode = 'side';
  let pairSources = null;
  let pairSyncFrame = 0;
  let pairPendingOrigin = null;
  const pairEcho = new WeakMap();
  const pairValues = { swipe: '50', onion: '50' };
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
  const clearPair = () => {
    pairSources = null;
    pairPendingOrigin = null;
    if (pairSyncFrame) cancelAnimationFrame(pairSyncFrame);
    pairSyncFrame = 0;
    for (const item of pairImages) { item.removeAttribute('src'); item.style.cssText = ''; }
    pairControls.hidden = pairDetails.hidden = pairSurface.hidden = true;
    pairError.hidden = true;
    pairModes.forEach((button) => { button.disabled = true; });
    pairRange.disabled = true;
  };
  const clearSingle = () => {
    surface.replaceChildren();
    image = null;
    lastPointerUp = null;
    currentCard = null;
    openerKind = null;
    previousButton.hidden = nextButton.hidden = position.hidden = navigationHelp.hidden = true;
  };
  const pairStage = (pane) => pane.querySelector('.pair-stage');
  const pairSize = () => {
    if (viewerMode !== 'pair' || !pairSources || !dialog.open) return;
    const dimensions = pairSources.map((item) => ({ width: item.naturalWidth / dpr(), height: item.naturalHeight / dpr() }));
    const stageWidth = Math.max(...dimensions.map((item) => item.width));
    const stageHeight = Math.max(...dimensions.map((item) => item.height));
    let fit;
    if (pairMode === 'side') {
      fit = Math.min(1, ...pairPanes.flatMap((pane, index) => [pane.clientWidth / dimensions[index].width, (pane.clientHeight - pairStage(pane).offsetTop) / dimensions[index].height]));
    } else {
      fit = Math.min(1, overlayPane.clientWidth / stageWidth, overlayPane.clientHeight / stageHeight);
    }
    const scale = actual ? 1 : Math.max(0, fit);
    pairPanes.forEach((pane, index) => {
      const stage = pairStage(pane);
      stage.style.width = dimensions[index].width * scale + 'px';
      stage.style.height = dimensions[index].height * scale + 'px';
      const img = stage.querySelector('img');
      img.style.width = stage.style.width;
      img.style.height = stage.style.height;
    });
    const stage = pairStage(overlayPane);
    stage.style.width = stageWidth * scale + 'px';
    stage.style.height = stageHeight * scale + 'px';
    stage.querySelectorAll('img').forEach((img, index) => {
      img.style.width = dimensions[index].width * scale + 'px';
      img.style.height = dimensions[index].height * scale + 'px';
    });
    const toggleWasHidden = toggleButton.hidden;
    toggleButton.hidden = fit >= 1;
    toggleButton.textContent = actual ? 'Fit to window' : 'Actual pixels';
    pairDetails.textContent = 'A ' + pairSources[0].naturalWidth + '×' + pairSources[0].naturalHeight + ' · B ' + pairSources[1].naturalWidth + '×' + pairSources[1].naturalHeight + (pairSources[0].naturalWidth !== pairSources[1].naturalWidth || pairSources[0].naturalHeight !== pairSources[1].naturalHeight ? ' · aligned at top left' : '');
    if (toggleWasHidden !== toggleButton.hidden) pairSize();
  };
  const pairReveal = () => {
    pairPercent.textContent = pairRange.value + '%';
    const layer = overlayPane.querySelector('.pair-layer-b');
    layer.style.clipPath = pairMode === 'swipe' ? 'inset(0 ' + (100 - Number(pairRange.value)) + '% 0 0)' : '';
    layer.style.opacity = pairMode === 'onion' ? String(Number(pairRange.value) / 100) : '1';
  };
  const setPairMode = (mode) => {
    if (pairMode === 'swipe' || pairMode === 'onion') pairValues[pairMode] = pairRange.value;
    pairMode = mode;
    if (mode !== 'side') overlayPane.querySelectorAll('img').forEach((img, index) => { if (!img.hasAttribute('src')) img.src = pairSources[index].src; });
    pairSurface.classList.toggle('side-by-side', mode === 'side');
    pairPanes.forEach((pane) => { pane.hidden = mode !== 'side'; pane.scrollLeft = pane.scrollTop = 0; });
    overlayPane.hidden = mode === 'side';
    overlayPane.scrollLeft = overlayPane.scrollTop = 0;
    pairRangeWrap.hidden = mode === 'side';
    pairRangeLabel.textContent = mode === 'swipe' ? 'Swipe' : 'Onion skin';
    pairRange.setAttribute('aria-label', mode === 'swipe' ? 'Swipe reveal' : 'Onion skin opacity');
    pairRange.value = mode === 'side' ? '50' : pairValues[mode];
    pairModes.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.pairMode === mode)));
    pairReveal();
    pairSize();
  };
  pairModes.forEach((button) => button.addEventListener('click', () => { if (viewerMode === 'pair' && pairSources) setPairMode(button.dataset.pairMode); }));
  pairRange.addEventListener('input', pairReveal);
  pairPanes.forEach((pane) => pane.addEventListener('scroll', () => {
    if (viewerMode !== 'pair' || pairMode !== 'side') return;
    const echo = pairEcho.get(pane);
    if (echo && Math.abs(pane.scrollLeft - echo.x) < 1 && Math.abs(pane.scrollTop - echo.y) < 1) { pairEcho.delete(pane); return; }
    pairEcho.delete(pane);
    pairPendingOrigin = pane;
    if (pairSyncFrame) return;
    pairSyncFrame = requestAnimationFrame(() => {
      pairSyncFrame = 0;
      const origin = pairPendingOrigin;
      pairPendingOrigin = null;
      if (viewerMode !== 'pair' || pairMode !== 'side' || !origin) return;
      const other = pairPanes.find((item) => item !== origin);
      other.scrollLeft = clamp(origin.scrollLeft, other.scrollWidth - other.clientWidth);
      other.scrollTop = clamp(origin.scrollTop, other.scrollHeight - other.clientHeight);
      pairEcho.set(other, { x: other.scrollLeft, y: other.scrollTop });
    });
  }));
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
    viewerMode = 'single';
    clearPair();
    surface.hidden = help.hidden = false;
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
    if (viewerMode !== 'single' || !dialog.open || !currentCard || actual) return;
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
    if (viewerMode !== 'single' || !currentCard || actual || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
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
  document.querySelectorAll('[data-viewer-pair-a]').forEach((button) => {
    const a = document.getElementById(button.dataset.viewerPairA);
    const b = document.getElementById(button.dataset.viewerPairB);
    if (!a?.src || !b?.src) return;
    button.disabled = false;
    button.addEventListener('click', async () => {
      const token = ++generation;
      clearSingle(); clearPair();
      viewerMode = 'pair';
      returnFocus = initialOpener = button;
      actual = false;
      title.textContent = button.dataset.pairName + ' — A/B comparison';
      surface.hidden = help.hidden = true;
      toggleButton.hidden = true;
      pairSurface.hidden = pairControls.hidden = pairDetails.hidden = false;
      pairError.hidden = true;
      pairValues.swipe = pairValues.onion = '50';
      pairImages.slice(0, 2).forEach((img, index) => { img.src = (index === 0 ? a : b).src; });
      setPairMode('side');
      dialog.showModal(); watchDpr();
      dialog.querySelector('[data-close]').focus();
      try { await Promise.all(pairImages.slice(0, 2).map((img) => img.decode())); }
      catch {
        if (token === generation && viewerMode === 'pair' && dialog.open) { pairPanes.forEach((pane) => { pane.hidden = true; }); overlayPane.hidden = true; pairError.hidden = false; pairDetails.textContent = 'Comparison images unavailable.'; toggleButton.hidden = true; dialog.dataset.viewerState = 'unavailable'; }
        return;
      }
      if (token !== generation || viewerMode !== 'pair' || !dialog.open) return;
      pairSources = pairImages.slice(0, 2);
      pairModes.forEach((control) => { control.disabled = false; });
      pairRange.disabled = false;
      pairSize();
      await new Promise(requestAnimationFrame);
      if (token === generation && dialog.open) dialog.dataset.viewerState = 'ready';
    });
  });
  toggleButton.addEventListener('click', () => {
    if (viewerMode === 'single' && image) toggle(pointAtCenter());
    else if (viewerMode === 'pair' && pairSources && dialog.dataset.viewerState === 'ready') { actual = !actual; pairSize(); }
  });
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
    if (viewerMode === 'pair') { pairSize(); return; }
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
    clearSingle(); clearPair();
    viewerMode = 'closed';
    surface.hidden = help.hidden = false;
    // The close event is queued; focus may already have moved elsewhere.
    const active = document.activeElement;
    if (!active || active === document.body || active === initialOpener || dialog.contains(active)) returnFocus?.focus();
    returnFocus = null;
    initialOpener = null;
  });
})();
`.trim()
