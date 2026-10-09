// SPDX-License-Identifier: AGPL-3.0-or-later
export const GALLERY_CSS = `
:root {
  color-scheme: light dark;
  --bg: #f4f5f7; --panel: #fff; --panel-2: #eef1f5; --text: #18202b;
  --muted: #5d6876; --line: #cbd2dc; --accent: #2855c7; --accent-soft: #e7edff;
  --good: #1d704d; --bad: #ae2535; --shadow: 0 10px 28px rgb(28 37 53 / 10%);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #11151b; --panel: #1a2029; --panel-2: #222a35; --text: #edf1f7;
    --muted: #aab4c2; --line: #3b4655; --accent: #91adff; --accent-soft: #25345f;
    --good: #78d9ae; --bad: #ff9aa8; --shadow: 0 12px 32px rgb(0 0 0 / 28%);
  }
}
* { box-sizing: border-box; }
html, body { overflow-x: hidden; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 15px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
button, input, a, summary { min-height: 44px; font: inherit; }
button { color: inherit; }
a { display: inline-flex; align-items: center; color: var(--accent); overflow-wrap: anywhere; }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
.skip {
  position: fixed; z-index: 20; top: 8px; left: 8px; padding: 8px 12px;
  border-radius: 8px; background: var(--panel); transform: translateY(-150%);
}
.skip:focus { transform: none; }
.shell { width: min(1480px, 100%); margin: 0 auto; padding: 20px; }
.topbar {
  padding: 22px; border: 1px solid var(--line); border-radius: 16px;
  background: var(--panel); box-shadow: var(--shadow);
}
.eyebrow {
  margin: 0 0 5px; color: var(--accent); font-size: 12px; font-weight: 750;
  letter-spacing: .08em; text-transform: uppercase;
}
h1 { margin: 0; overflow-wrap: anywhere; font-size: clamp(22px, 4vw, 34px); line-height: 1.1; }
.status, .meta, .actions, .chips, .artifact-row { display: flex; flex-wrap: wrap; gap: 8px; }
.status { margin-top: 12px; }
.badge, .chip {
  display: inline-flex; align-items: center; padding: 5px 10px; border: 1px solid var(--line);
  border-radius: 999px; background: var(--panel-2); color: var(--text); font-size: 13px;
}
.badge { min-height: 32px; }
.badge.durable { color: var(--good); border-color: currentColor; font-weight: 700; }
.runfacts {
  display: grid; grid-template-columns: repeat(4, minmax(110px, 1fr));
  gap: 10px; margin: 18px 0 0;
}
.runfacts div { min-width: 0; padding: 10px; border-left: 2px solid var(--line); }
dt { color: var(--muted); font-size: 12px; }
dd { margin: 2px 0 0; overflow-wrap: anywhere; font-weight: 650; }
.controls {
  position: sticky; z-index: 5; top: 0; display: grid;
  grid-template-columns: minmax(230px, 1fr) auto; gap: 12px; margin: 16px 0;
  padding: 12px; border: 1px solid var(--line); border-radius: 13px;
  background: color-mix(in srgb, var(--panel) 94%, transparent); backdrop-filter: blur(10px);
}
.search {
  width: 100%; border: 1px solid var(--line); border-radius: 9px;
  padding: 0 13px; background: var(--panel); color: var(--text);
}
.chip { min-height: 44px; cursor: pointer; }
.chip[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.keyboard, .muted { color: var(--muted); }
.keyboard { grid-column: 1 / -1; font-size: 12px; }
kbd { padding: 1px 5px; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 5px; background: var(--panel-2); }
.spec {
  margin: 18px 0 28px; overflow: clip; border: 1px solid var(--line);
  border-radius: 16px; background: var(--panel);
}
.spec-head {
  display: flex; justify-content: space-between; align-items: center; gap: 16px;
  padding: 16px 18px; border-bottom: 1px solid var(--line);
}
.spec-head h2 { margin: 0; overflow-wrap: anywhere; font-size: 20px; }
.spec-head p { margin: 2px 0 0; color: var(--muted); }
.cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; padding: 16px; }
.card { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 13px; background: var(--panel); }
.card:last-child:nth-child(odd) { grid-column: 1 / -1; }
.media {
  position: relative; display: grid; place-items: center; min-height: 230px; max-height: 520px;
  overflow: hidden; padding: 18px; background:
    linear-gradient(45deg, var(--panel-2) 25%, transparent 25%) 0 0/18px 18px,
    linear-gradient(-45deg, var(--panel-2) 25%, transparent 25%) 0 0/18px 18px, var(--bg);
}
.placeholder { width: min(100%, 900px); max-height: 480px; border: 1px solid var(--line); background: var(--panel); box-shadow: var(--shadow); }
.media.has-overview-image .placeholder { visibility: hidden; }
.placeholder-copy { padding: 16px; text-align: center; color: var(--muted); }
.overview-image { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: contain; }
.card-body { padding: 14px; }
.card-title { display: flex; justify-content: space-between; align-items: start; gap: 12px; }
.card-title h3 { margin: 0; overflow-wrap: anywhere; font-size: 18px; }
.kind { color: var(--muted); white-space: nowrap; font-size: 12px; }
.meta { margin: 10px 0; }
.meta span { padding: 4px 7px; border-radius: 6px; background: var(--panel-2); font-size: 12px; }
.action {
  display: inline-flex; align-items: center; justify-content: center; min-height: 44px;
  padding: 7px 12px; border: 1px solid var(--line); border-radius: 8px;
  background: var(--panel); color: var(--accent); text-decoration: none; font-weight: 650; cursor: pointer;
}
.js-observer .load-action { display: none; }
details { margin-top: 10px; }
summary { min-height: 44px; padding: 10px 0; cursor: pointer; color: var(--accent); font-weight: 650; }
.detailgrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 4px 0 0; }
.detailgrid div { min-width: 0; padding: 8px; overflow-wrap: anywhere; border-radius: 7px; background: var(--panel-2); }
.artifacts {
  margin: 0 16px 16px; padding: 14px; border: 1px dashed var(--line);
  border-radius: 11px; background: var(--panel-2);
}
.artifacts h3 { margin: 0 0 5px; font-size: 15px; }
.artifacts p { margin: 4px 0 10px; color: var(--muted); }
.artifact-group + .artifact-group { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--line); }
.artifact-preview { padding: 9px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); color: var(--text); }
.artifact-preview.absent { color: var(--muted); }
.video-layout {
  display: grid; grid-template-columns: minmax(280px, 2fr) minmax(240px, 1fr);
  gap: 16px; align-items: start; margin: 12px 0 0;
}
.video-frame { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 10px; background: #10141c; box-shadow: var(--shadow); }
video { display: block; width: 100%; min-height: 44px; aspect-ratio: 16 / 9; background: #10141c; }
.artifact-warning, .broken {
  padding: 10px 12px; border-left: 5px solid var(--bad);
  border-radius: 6px; background: var(--panel); color: var(--text);
}
.empty { min-height: 180px; padding: 24px; border: 1px solid var(--line); border-radius: 13px; background: var(--panel); }
.hidden { display: none !important; }
dialog {
  width: min(96vw, 1400px); height: min(94vh, 1000px); padding: 0;
  border: 1px solid var(--line); border-radius: 14px; background: var(--panel); color: var(--text);
}
dialog::backdrop { background: rgb(0 0 0 / 72%); }
.dialog-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--line); }
.dialog-head h2 { margin: 0; overflow-wrap: anywhere; font-size: 18px; }
.inspection-surface { width: 100%; height: calc(100% - 65px); overflow: auto; overscroll-behavior: contain; }
.inspection-image { display: block; max-width: none; max-height: none; }
.debug {
  position: fixed; z-index: 30; right: 10px; bottom: 10px; display: none;
  padding: 10px 12px; border: 2px solid var(--accent); border-radius: 8px;
  background: var(--panel); color: var(--text); font-weight: 750;
}
.debug.active { display: block; }
footer { margin: 26px 0 8px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--muted); }
@media (max-width: 760px) {
  .shell { padding: 10px; }
  .topbar { padding: 16px; }
  .runfacts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .controls { grid-template-columns: minmax(0, 1fr); }
  .chips { flex-wrap: nowrap; max-width: 100%; overflow-x: auto; padding-bottom: 2px; }
  .chip { flex: 0 0 auto; }
  .cards { grid-template-columns: minmax(0, 1fr); padding: 10px; }
  .card:last-child:nth-child(odd) { grid-column: auto; }
  .spec-head { flex-wrap: wrap; align-items: start; }
  .media { min-height: 160px; padding: 10px; }
  .detailgrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .actions .action { flex: 1 1 130px; }
  .artifacts { margin: 0 10px 10px; }
  .video-layout { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  * { scroll-behavior: auto !important; }
}
`.trim()

export const GALLERY_SCRIPT = `
(() => {
  const search = document.querySelector('#search');
  const cards = Array.from(document.querySelectorAll('.card[data-search]'));
  const live = [];
  let activeFilter = 'all';
  let returnFocus = null;
  let reconcile = () => {};

  const sourceFor = (card) => card.querySelector('[data-original]');
  const unload = (card) => {
    const image = card.querySelector('.overview-image');
    if (image) image.remove();
    card.querySelector('.media')?.classList.remove('has-overview-image');
    const index = live.indexOf(card);
    if (index !== -1) live.splice(index, 1);
  };
  const trim = () => {
    const center = window.innerHeight / 2;
    live.sort((left, right) => {
      const leftBox = left.getBoundingClientRect();
      const rightBox = right.getBoundingClientRect();
      return Math.abs(leftBox.top + leftBox.height / 2 - center) - Math.abs(rightBox.top + rightBox.height / 2 - center);
    });
    while (live.length > 3) unload(live[live.length - 1]);
  };
  const load = (card) => {
    if (!card || card.classList.contains('hidden') || card.querySelector('.overview-image')) return;
    const source = sourceFor(card);
    const media = card.querySelector('.media');
    if (!source || !media) return;
    const image = document.createElement('img');
    image.className = 'overview-image';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.alt = source.dataset.alt;
    image.width = Number(source.dataset.width);
    image.height = Number(source.dataset.height);
    image.src = source.href;
    media.append(image);
    media.classList.add('has-overview-image');
    live.push(card);
    trim();
  };
  const apply = () => {
    const query = search.value.trim().toLowerCase();
    cards.forEach((card) => {
      const textMatch = !query || card.dataset.search.includes(query);
      const filterMatch = activeFilter === 'all' || card.dataset.tags.split(' ').includes(activeFilter);
      const hidden = !(textMatch && filterMatch);
      card.classList.toggle('hidden', hidden);
      if (hidden) unload(card);
    });
    document.querySelectorAll('.spec').forEach((spec) => {
      spec.classList.toggle('hidden', !spec.querySelector('.card:not(.hidden)'));
    });
    reconcile();
  };

  search.addEventListener('input', apply);
  document.querySelectorAll('[data-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      activeFilter = button.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach((item) => {
        item.setAttribute('aria-pressed', String(item === button));
      });
      apply();
    });
  });
  document.querySelectorAll('.load-action').forEach((button) => {
    button.addEventListener('click', () => load(button.closest('.card')));
  });

  if ('IntersectionObserver' in window) {
    document.documentElement.classList.add('js-observer');
    const near = new Set();
    reconcile = () => {
      const center = window.innerHeight / 2;
      const closest = Array.from(near)
        .filter((card) => !card.classList.contains('hidden'))
        .sort((left, right) => {
          const leftBox = left.getBoundingClientRect();
          const rightBox = right.getBoundingClientRect();
          return Math.abs(leftBox.top + leftBox.height / 2 - center) - Math.abs(rightBox.top + rightBox.height / 2 - center);
        })
        .slice(0, 3);
      live.slice().forEach((card) => {
        if (!closest.includes(card)) unload(card);
      });
      closest.forEach(load);
    };
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) near.add(entry.target);
        else near.delete(entry.target);
      });
      reconcile();
    }, { rootMargin: '600px 0px' });
    cards.forEach((card) => observer.observe(card));
    let scheduled = false;
    window.addEventListener('scroll', () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        reconcile();
      });
    }, { passive: true });
  } else {
    load(cards.find((card) => sourceFor(card)));
  }

  const dialog = document.querySelector('#inspection-dialog');
  const inspectionSurface = dialog.querySelector('.inspection-surface');
  const inspectionTitle = dialog.querySelector('h2');
  document.querySelectorAll('[data-inspect]').forEach((button) => {
    button.addEventListener('click', () => {
      const source = document.querySelector('#' + button.dataset.inspect);
      if (!source) return;
      returnFocus = button;
      inspectionTitle.textContent = source.dataset.name + ' — 1:1 inspection';
      inspectionSurface.replaceChildren();
      const image = document.createElement('img');
      image.className = 'inspection-image';
      image.alt = source.dataset.alt;
      image.width = Number(source.dataset.width);
      image.height = Number(source.dataset.height);
      image.src = source.href;
      inspectionSurface.append(image);
      dialog.showModal();
      dialog.querySelector('[data-close]').focus();
    });
  });
  dialog.addEventListener('close', () => {
    inspectionSurface.replaceChildren();
    // The close event is queued, so input handled before it may already have
    // moved focus somewhere deliberate. Restore only when focus is still
    // nowhere useful: on the body, or stranded inside the closed dialog.
    const active = document.activeElement;
    if (!active || active === document.body || dialog.contains(active)) returnFocus?.focus();
    returnFocus = null;
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== search && !dialog.open) {
      event.preventDefault();
      search.focus();
    }
    if (event.key === 'Escape' && !dialog.open) {
      search.value = '';
      activeFilter = 'all';
      document.querySelectorAll('[data-filter]').forEach((item) => {
        item.setAttribute('aria-pressed', String(item.dataset.filter === 'all'));
      });
      apply();
      search.blur();
    }
  });

  const debug = document.querySelector('#debug-overlay');
  const updateDebug = () => {
    debug.classList.toggle('active', location.hash === '#debug');
    debug.textContent = 'Live overview images: ' + document.querySelectorAll('.overview-image').length + ' / 3';
  };
  new MutationObserver(updateDebug).observe(document.querySelector('#gallery-content'), { childList: true, subtree: true });
  window.addEventListener('hashchange', updateDebug);
  updateDebug();
})();
`.trim()
