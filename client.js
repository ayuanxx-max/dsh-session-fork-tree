/**
 * Client half of @local/fork-tree 鈥?session rows form a tree from Host lineage.
 *  - order: a fork sits directly under its parent (pre-order DFS); the movable
 *    slot is the row itself when its parent already holds several rows,
 *    otherwise the row's wrapper.
 *  - rails: connector drawn on the row via ::before/::after using measured
 *    --ft-rail-x / --ft-elbow-w, always visible (hover only brightens it).
 *  - hover: the ancestor chain brightens.
 *  - report: measurements POSTed to /fork-tree/report.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-fork-tree',
  factory(require) {
    const React = require('react');
    const STYLE_ID = 'fork-tree-style';
    const SLOT = 'sidebar.session.row.leading';
    const ACTION_SLOT = 'sidebar.workspaces.session.row.action';

    let lineage = { at: 0, parents: new Map(), byId: new Map() };
    let loading = false;
    let styled = false;
    let started = false;
    let lastReport = 0;

    // Cross-origin support: the page may be served from a custom scheme or a
    // different origin than the DSH host. The Host injects the base URL (and a
    // lineage snapshot) into window.__DSH_FORK_TREE__ at index render time.
    const injected = (typeof window !== 'undefined' && window.__DSH_FORK_TREE__) || null;

    // The page may be served from a custom scheme (desktop shells) or another
    // origin than the Host. Discover the Host base from, in order: the injected
    // boot data, the DSH boot global, or a same-page resource whose origin
    // answers the Host API. Empty string means "same origin".
    function discoverBase() {
      try {
        if (injected && typeof injected.base === 'string' && injected.base) {
          return injected.base.replace(/\/$/, '');
        }
        const boot = typeof window !== 'undefined' ? window.__DSH_BOOT__ : null;
        if (boot && typeof boot === 'object') {
          const keys = ['serverUrl', 'origin', 'url', 'apiBase', 'baseUrl', 'host'];
          for (const key of keys) {
            const value = boot[key];
            if (typeof value === 'string' && /^https?:\/\//.test(value)) return value.replace(/\/$/, '');
          }
        }
        if (typeof performance !== 'undefined' && performance.getEntriesByType) {
          const pageOrigin = typeof location !== 'undefined' ? location.origin : '';
          const entries = performance.getEntriesByType('resource');
          for (const entry of entries) {
            const name = String(entry && entry.name ? entry.name : '');
            const match = name.match(/^(https?:\/\/[^/]+)\//);
            if (!match) continue;
            if (match[1] === pageOrigin) continue;
            if (/\/api\b|:\d+\//.test(name)) return match[1];
          }
        }
      } catch (err) {
        /* fall through to same-origin */
      }
      return '';
    }

    let apiBase = discoverBase();

    function apiUrl(path) {
      return apiBase + path;
    }
    let orderTimer = 0;
    let reorderCount = 0;
    let gid = 0;
    let lastApply = 0;

    const rows = new Map();
    const toggles = new Map();
    // Collapsed sets, not expanded sets: a fork is VISIBLE by default and only
    // disappears when the user explicitly collapses its parent. Hiding new
    // children by default made sessions look like they had vanished.
    const collapsed = new Set();
    const wired = new WeakSet();
    const diagnostics = [];

    function ensureStyle() {
      let tag = document.getElementById(STYLE_ID);
      if (tag === null) {
        tag = document.createElement('style');
        tag.id = STYLE_ID;
        (document.head || document.documentElement).appendChild(tag);
      }
      return tag;
    }

    async function refreshStyle() {
      try {
        const res = await fetch(apiUrl('/fork-tree/style.css'), { credentials: 'same-origin' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        ensureStyle().textContent = await res.text();
        styled = true;
      } catch (err) {
        console.warn('[fork-tree] style fetch failed', err);
      }
    }

    async function load() {
      if (loading) return;
      loading = true;
      try {
        const res = await fetch(apiUrl('/fork-tree/lineage.json'), { credentials: 'same-origin' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const parents = new Map();
        const byId = new Map();
        for (const item of data.items || []) {
          parents.set(item.id, item.parent || null);
          byId.set(item.id, item);
        }
        lineage = { at: Date.now(), parents, byId };
        applyOrder();
        for (const [, row] of rows) applyLayout(row);
        prune();
        refreshToggles();
        applyVisibility();
        sendReport();
      } catch (err) {
        console.warn('[fork-tree] lineage fetch failed:', err);
      } finally {
        loading = false;
      }
    }

    /** Parent that is actually on screen; a hidden (archived) parent counts as absent. */
    function parentOf(id) {
      const parent = lineage.parents.get(id);
      if (!parent) return null;
      const info = lineage.byId.get(parent);
      if (info !== undefined && info.displayed === false) return null;
      return parent;
    }

    function depthOf(id) {
      let depth = 0;
      let current = id;
      const seen = new Set();
      while (depth < 8) {
        const parent = parentOf(current);
        if (!parent || seen.has(parent)) break;
        seen.add(parent);
        current = parent;
        depth += 1;
      }
      return depth;
    }

    function ancestorsOf(id) {
      const out = [];
      let current = id;
      const seen = new Set();
      while (out.length < 8) {
        const parent = parentOf(current);
        if (!parent || seen.has(parent)) break;
        seen.add(parent);
        current = parent;
        out.push(parent);
      }
      return out;
    }

    function rowOf(el, title) {
      // DSH 0.2.2 tags every tree row with `data-row-key="session:<id>"`.
      // Prefer that over walking the tree and guessing by class name: the class
      // names are CSS-module hashes and the wrapper depth changed between
      // releases (the sidebar rows now sit inside a Workspace group section).
      if (el !== null && typeof el.closest === 'function') {
        try {
          const keyed = el.closest('[data-row-key^="session:"]');
          if (keyed !== null) return keyed;
        } catch (err) {
          /* fall through to the measured climb */
        }
      }
      if (title) {
        let node = el;
        let best = null;
        for (let i = 0; i < 8 && node !== null; i += 1) {
          const parent = node.parentElement;
          if (parent === null) break;
          node = parent;
          if ((node.textContent || '').indexOf(title) === -1) break;
          best = node;
        }
        if (best !== null) return best;
      }
      let node = el;
      let fallback = null;
      for (let i = 0; i < 10 && node !== null; i += 1) {
        const parent = node.parentElement;
        if (parent === null) break;
        node = parent;
        if (i === 3 && fallback === null) fallback = node;
        if (String(node.className || '').indexOf('sessionRow') !== -1) return node;
      }
      return fallback === null ? el.parentElement : fallback;
    }

    function titleEl(row) {
      const labelled = row.querySelector('[class*="title"],[class*="Title"]');
      if (labelled !== null && (labelled.textContent || '').trim().length > 0) return labelled;
      const all = row.querySelectorAll('*');
      for (let i = 0; i < all.length; i += 1) {
        const el = all[i];
        if (el.children.length > 0) continue;
        const text = (el.textContent || '').trim();
        if (text.length > 0 && text.length < 160) return el;
      }
      return null;
    }

    function titleLeft(row) {
      const el = titleEl(row);
      if (el === null) return null;
      const a = row.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      return Math.round(b.left - a.left);
    }

    /**
     * Resolve the list container that owns this row.
     *
     * The container must be the closest ancestor whose DIRECT children each hold
     * at most one session row (those children are the per-row slot wrappers).
     * This keeps every workspace list separate: a looser rule could merge two
     * workspace groups and drag rows across them.
     */
    function slotOf(row) {
      let node = row;
      while (node && node.parentElement) {
        const parent = node.parentElement;
        const kids = Array.from(parent.children);
        let holders = 0;
        let safe = true;
        for (const kid of kids) {
          const inside = kid.hasAttribute('data-ft-session')
            ? 1
            : kid.querySelectorAll('[data-ft-session]').length;
          if (inside > 1) { safe = false; break; }
          if (inside === 1) holders += 1;
        }
        if (safe && holders >= 2) return { container: parent, slot: node };
        node = parent;
      }
      return null;
    }

    /**
     * Keep collapse/expand controls BELOW every session row of their group.
     * DSH renders its own "收起" node; when the group list is reordered with
     * CSS `order` that node can end up between sessions, so it is pinned to the
     * end of the nearest ancestor that actually contains session rows.
     */
    function pinFooters() {
      try {
        const nodes = document.querySelectorAll('button,[role="button"],div,span,a');
        for (const el of nodes) {
          if (el.children.length > 0) continue;
          const text = (el.textContent || '').trim();
          if (!/^(收起|展开|显示更多|显示更少|Show more|Show less)$/i.test(text)) continue;
          let parent = el.parentElement;
          let hops = 0;
          while (parent && hops < 4 && !parent.querySelector('[data-ft-session]')) {
            parent = parent.parentElement;
            hops += 1;
          }
          if (!parent) continue;
          const style = getComputedStyle(parent);
          if (style.display.indexOf('flex') === -1) {
            parent.style.display = 'flex';
            parent.style.flexDirection = 'column';
          }
          el.style.order = '999999';
        }
      } catch (err) {
        /* footer pinning is best-effort */
      }
    }

    function applyOrder() {
      const groups = new Map();
      for (const [id, row] of rows) {
        const info = slotOf(row);
        if (info === null) continue;
        if (!groups.has(info.container)) groups.set(info.container, []);
        groups.get(info.container).push({
          id,
          row,
          slot: info.slot,
          parent: parentOf(id),
          rank: 9999,
        });
      }
      for (const [container, entries] of groups) {
        if (entries.length < 2) continue;
        const index = new Map();
        Array.from(container.children).forEach(function (el, i) {
          index.set(el, i);
        });
        for (const entry of entries) {
          entry.rank = index.has(entry.slot) ? index.get(entry.slot) : 9999;
        }
        const byId = new Map(entries.map(function (e) { return [e.id, e]; }));
        // A parent that exists in the sidebar but is not part of this container
        // means we cannot order the group reliably: keep the native order
        // instead of pushing children above their parent.
        let incomplete = false;
        for (const entry of entries) {
          if (entry.parent && !byId.has(entry.parent) && rows.has(entry.parent)) incomplete = true;
        }
        if (incomplete) continue;
        const childrenOf = new Map();
        const roots = [];
        for (const entry of entries) {
          if (entry.parent && byId.has(entry.parent)) {
            if (!childrenOf.has(entry.parent)) childrenOf.set(entry.parent, []);
            childrenOf.get(entry.parent).push(entry);
          } else {
            roots.push(entry);
          }
        }
        const byRank = function (a, b) { return a.rank - b.rank; };
        roots.sort(byRank);
        for (const list of childrenOf.values()) list.sort(byRank);
        const ordered = [];
        const seen = new Set();
        (function walk(list) {
          for (const entry of list) {
            if (seen.has(entry.id)) continue;
            seen.add(entry.id);
            ordered.push(entry);
            const kids = childrenOf.get(entry.id);
            if (kids) walk(kids);
          }
        })(roots);
        for (const entry of entries) if (!seen.has(entry.id)) ordered.push(entry);

        let display = '';
        try {
          display = getComputedStyle(container).display;
        } catch (err) {
          display = '';
        }
        if (display.indexOf('flex') !== -1) {
          let same = true;
          for (let i = 0; i < ordered.length; i += 1) {
            if (ordered[i].slot.style.order !== String(i)) same = false;
          }
          if (!same) {
            reorderCount += 1;
            for (let i = 0; i < ordered.length; i += 1) ordered[i].slot.style.order = String(i);
          }
        } else {
          // Version-independent ordering: DSH lists are plain block containers
          // (newer builds dropped the flex layout), so `order` alone does
          // nothing. Convert the container to a flex column ONCE, pin every
          // non-session child to its native slot, and give the session rows the
          // tree order inside the same slot positions. No node is ever moved,
          // so React never sees a foreign insertion.
          let kids = [];
          try { kids = Array.from(container.children); } catch (err) { continue; }
          const want = new Set(ordered.map(function (e) { return e.slot; }));
          const positions = [];
          for (let i = 0; i < kids.length; i += 1) if (want.has(kids[i])) positions.push(i);
          if (positions.length !== ordered.length) continue;
          if (positions.length < 2) continue;
          container.style.display = 'flex';
          container.style.flexDirection = 'column';
          // Non-session children (the "收起" footer control and friends) are
          // pinned AFTER every session row: pinning them to their native index
          // let a late session slip below the footer and overflow the group.
          let maxPos = 0;
          for (const pos of positions) if (pos > maxPos) maxPos = pos;
          // Group headers must stay ABOVE their sessions, while a footer like
          // "收起" must stay BELOW them. Only the footer-like text is pinned to
          // the end; every other non-session child is pinned to the front.
          const isFooter = function (el) {
            const text = String(el.textContent || '').trim();
            return /收起|折叠|展开|more|less|show/i.test(text);
          };
          let head = 0;
          let tail = 0;
          for (let i = 0; i < kids.length; i += 1) {
            if (want.has(kids[i])) continue;
            if (isFooter(kids[i])) {
              kids[i].style.order = String(maxPos + 1 + tail);
              tail += 1;
            } else {
              head += 1;
              kids[i].style.order = String(-head);
            }
          }
          let changed = false;
          for (let i = 0; i < ordered.length; i += 1) {
            const slot = ordered[i].slot;
            // Same numbering as the flex branch (0..n-1). Writing the native
            // child index here made the two branches disagree: the first pass
            // used native positions, the next pass renumbered to 0..n-1 and
            // every row jumped — the visible "rows shuffling twice" on click.
            const value = String(i);
            if (slot.style.order !== value) { slot.style.order = value; changed = true; }
          }
          if (changed) reorderCount += 1;
        }
      }
      pinFooters();
      lastApply = Date.now();
    }

    let observerInstalled = false;

    /** Observe only the sidebar list, and only for row insertions. */
    function installObserver() {
      if (observerInstalled) return;
      try {
        const first = rows.values().next().value;
        const slot = first && first.parentElement;
        const container = slot && slot.parentElement;
        if (!container) return;
        observerInstalled = true;
        let timer = 0;
        new MutationObserver(function () {
          clearTimeout(timer);
          timer = setTimeout(function () {
            if (Date.now() - lastApply < 400) return;
            applyOrder();
          }, 150);
        }).observe(container, { childList: true });
      } catch (err) {
        /* observer is an optimisation only */
      }
    }

    /** Report how far the marker sits from the row's centre. */
    function alignToggle(row) {
      const btn = toggles.get(row);
      if (!btn || !btn.parentElement) return null;
      const rowBox = row.getBoundingClientRect();
      if (rowBox.height === 0) return null;
      const box = btn.getBoundingClientRect();
      if (box.height === 0) return null;
      const offset = (box.top + box.height / 2) - (rowBox.top + rowBox.height / 2);
      return {
        rowH: Math.round(rowBox.height),
        titleH: Math.round((btn.parentElement.getBoundingClientRect().height || 0)),
        btnTop: Math.round(box.top - rowBox.top),
        offset: Math.round(offset),
      };
    }

    /**
     * Per-row geometry baseline, measured ONCE before this plugin writes any
     * padding of its own.
     *
     * A single global "title x" cannot work on DSH 0.2.2: every Workspace group
     * carries its own `--dsh-workspace-indent`, and the row's own indent comes
     * from `padding-inline-start` + `border-inline-start`, so the title x
     * differs per group. Worse, a row inside a collapsed branch reports a
     * zero rect, which used to poison the cached base — that is what pushed a
     * grandchild row's title left of its parent and its rail to -8px.
     *
     * Everything below is row-local and derived from computed style, so it is
     * correct even while the row is hidden and never depends on another row.
     */
    const baseMetrics = new WeakMap();

    function metricsOf(row) {
      const cached = baseMetrics.get(row);
      if (cached !== undefined) return cached;
      let border = 3;
      let pad = 9;
      try {
        const cs = getComputedStyle(row);
        const b = parseFloat(cs.borderInlineStartWidth);
        const p = parseFloat(cs.paddingInlineStart);
        if (Number.isFinite(b)) border = b;
        if (Number.isFinite(p)) pad = p;
      } catch (err) {
        /* keep the defaults */
      }
      const seat = leadingSeat(row);
      let slotW = 16;
      if (seat !== null) {
        const w = seat.getBoundingClientRect().width;
        if (w > 0) slotW = w;
      }
      const title = titleEl(row);
      let gap = 6;
      if (title !== null) {
        try {
          const m = parseFloat(getComputedStyle(title).marginInlineStart);
          if (Number.isFinite(m)) gap = m;
        } catch (err) {
          /* keep the default */
        }
      }
      const value = { pad, titleX: border + pad + slotW + gap };
      baseMetrics.set(row, value);
      return value;
    }

    function applyLayout(row) {
      placeToggle(row);
      alignToggle(row);
      const id = row.getAttribute('data-ft-session');
      if (!id) return null;
      const depth = depthOf(id);
      if (depth <= 0) {
        row.removeAttribute('data-ft-depth');
        row.style.removeProperty('--ft-d');
        row.style.removeProperty('--ft-rail-x');
        row.style.removeProperty('--ft-elbow-w');
        row.style.removeProperty('--ft-shift');
        return null;
      }
      // The baseline must be read BEFORE `data-ft-depth` exists: the stylesheet
      // gives that attribute `padding-left: var(--ft-pad)`, which would zero
      // (or overwrite) the very padding this measurement needs.
      const metrics = metricsOf(row);
      row.setAttribute('data-ft-depth', String(depth));
      row.style.setProperty('--ft-d', String(depth));

      // Exact 16px steps, capped at 5 levels so a deep tree cannot eat the
      // sidebar width. No measurement pass, no correction nudge: the row's
      // natural indent is fixed, so pad → title position is linear and the
      // same numbers hold whether the row is visible right now or not.
      const step = 16;
      const level = Math.min(depth, 5);
      const railX = Math.round(metrics.titleX + step * (level - 1));
      // SPEC: openspec/changes/fix-fork-rail-geometry — the horizontal segment
      // is a fixed 10px at EVERY depth; the title absorbs the difference.
      const naturalElbow = step - 2;
      const elbowW = Math.min(10, naturalElbow);
      const shift = naturalElbow - elbowW;
      row.style.setProperty(
        '--ft-pad',
        Math.max(0, Math.round(metrics.pad + step * level - shift)) + 'px'
      );
      row.style.removeProperty('--ft-shift');
      row.style.setProperty('--ft-rail-x', railX + 'px');
      row.style.setProperty('--ft-elbow-w', elbowW + 'px');
      return { railX, elbowW, titleX: metrics.titleX, pad: metrics.pad };
    }

    function setHot(sessionId, on) {
      for (const id of ancestorsOf(sessionId)) {
        const row = rows.get(id);
        if (!row) continue;
        if (on) row.setAttribute('data-ft-hot', '1');
        else row.removeAttribute('data-ft-hot');
      }
    }

    function wireHover(row, sessionId) {
      if (wired.has(row)) return;
      wired.add(row);
      row.addEventListener('mouseenter', function () { setHot(sessionId, true); });
      row.addEventListener('mouseleave', function () { setHot(sessionId, false); });
    }

    /* ---------- collapse / expand ---------- */

    function childCount(id) {
      let count = 0;
      for (const [childId, parent] of lineage.parents) {
        if (parent !== id) continue;
        const info = lineage.byId.get(childId);
        // Archived sessions stay in the lineage but are not rendered anywhere;
        // they must not make a fork marker appear.
        if (info !== undefined && info.displayed === false) continue;
        // Only a row that actually exists in the sidebar counts as a fork.
        if (!rows.has(childId)) continue;
        count += 1;
      }
      return count;
    }

    function isVisible(id) {
      let parent = parentOf(id);
      let guard = 0;
      while (parent && guard < 12) {
        if (collapsed.has(parent)) return false;
        parent = parentOf(parent);
        guard += 1;
      }
      return true;
    }

    function applyVisibility() {
      const shown = [];
      for (const [id, row] of rows) {
        const visible = isVisible(id);
        const wasHidden = row.hasAttribute('data-ft-hidden');
        if (visible) {
          if (wasHidden) {
            row.removeAttribute('data-ft-hidden');
            shown.push(row);
          }
        } else if (!wasHidden) {
          row.setAttribute('data-ft-hidden', '1');
        }
      }
      // Rows measured while hidden report zero rects; re-measure once the
      // browser has laid them out again.
      if (shown.length > 0) {
        requestAnimationFrame(function () {
          for (const row of shown) applyLayout(row);
        });
      }
    }

    function updateToggle(id) {
      const row = rows.get(id);
      if (!row) return;
      const button = toggles.get(row);
      if (button === undefined) return;
      const open = !collapsed.has(id);
      button.textContent = open ? '−' : '+';
      button.setAttribute('data-open', open ? '1' : '0');
      button.title = open ? '收起分叉' : '展开分叉';
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      button.setAttribute('aria-label', open ? '收起分叉' : '展开分叉');
    }

    /** Right edge of the painted title text, in viewport coordinates. */
    function textRightOf(title) {
      let right = 0;
      const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node !== null) {
        const value = node.nodeValue || '';
        const host = node.parentElement;
        if (value.trim().length > 0 && (host === null || host.closest('.ft-toggle') === null)) {
          const range = document.createRange();
          range.selectNodeContents(node);
          const rect = range.getBoundingClientRect();
          if (rect.width > 0) right = Math.max(right, rect.right);
        }
        node = walker.nextNode();
      }
      return right;
    }

    /** Glue the marker to the end of the title text, never to the row edge. */
    function placeToggle(row) {
      const button = toggles.get(row);
      if (button === undefined) return;
      const title = titleEl(row);
      if (title === null) return;
      const right = textRightOf(title);
      if (right <= 0) return;
      const box = button.offsetParent !== null ? button.offsetParent : row;
      const boxRect = box.getBoundingClientRect();
      const width = box.clientWidth || boxRect.width;
      let x = Math.round(right - boxRect.left + 6);
      x = Math.max(0, Math.min(x, width - 18));
      button.style.setProperty('--ft-plus-x', x + 'px');
      const lineRect = title.getBoundingClientRect();
      if (lineRect.height > 0) {
        button.style.setProperty(
          '--ft-plus-y',
          Math.round(lineRect.top - boxRect.top + lineRect.height / 2) + 'px'
        );
      }
    }

    function ensureToggle(row, id) {
      if (childCount(id) === 0) {
        const stale = toggles.get(row);
        if (stale !== undefined) {
          stale.remove();
          toggles.delete(row);
        }
        return;
      }
      let button = toggles.get(row);
      if (button === undefined) {
        button = document.createElement('span');
        button.className = 'ft-toggle';
        button.setAttribute('role', 'button');
        button.setAttribute('tabindex', '0');
        const activate = function (event) {
          event.preventDefault();
          event.stopPropagation();
          if (collapsed.has(id)) collapsed.delete(id);
          else collapsed.add(id);
          updateToggle(id);
          applyVisibility();
          applyOrder();
          if (typeof window !== 'undefined') {
            requestAnimationFrame(function () {
              for (const [, other] of rows) applyLayout(other);
            });
          }
        };
        button.addEventListener('click', activate);
        // A double click must toggle twice without reaching the row's rename
        // gesture (the row renames on double click).
        button.addEventListener('dblclick', function (event) {
          event.preventDefault();
          event.stopPropagation();
        });
        button.addEventListener('mousedown', function (event) {
          event.stopPropagation();
        });
        button.addEventListener('keydown', function (event) {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          activate(event);
        });
        toggles.set(row, button);
      }
      // The marker lives in the ROW, never inside the title span. DSH measures
      // `scrollWidth - clientWidth` on the title to drive its hover marquee
      // (`useTitleMarquee` → placeTitle): an extra inline child inflated that
      // range, so on hover/click the title text was translated out of its clip
      // box and looked like it had disappeared. An absolutely positioned child
      // of the row leaves the title's own metrics untouched.
      const strays = row.querySelectorAll('.ft-toggle');
      for (const stray of strays) {
        if (stray !== button) stray.remove();
      }
      if (button.parentElement !== row) {
        try {
          row.appendChild(button);
        } catch (err) {
          /* React may own this subtree; skip the marker instead of crashing */
        }
      }
      try {
        if (getComputedStyle(row).position === 'static') row.style.position = 'relative';
      } catch (err) {
        /* keep the DOM as-is */
      }
      updateToggle(id);
      placeToggle(row);
    }

    function prune() {
      for (const [id, row] of Array.from(rows)) {
        if (row.isConnected) continue;
        rows.delete(id);
        const button = toggles.get(row);
        if (button !== undefined) {
          button.remove();
          toggles.delete(row);
        }
      }
    }

    function refreshToggles() {
      for (const [id, row] of rows) ensureToggle(row, id);
    }

    function leadingSeat(row) {
      const bySlot = row.querySelector('[data-slot="sidebar.session.row.leading"]');
      if (bySlot !== null) return bySlot;
      const title = titleEl(row);
      let node = title;
      while (node !== null && node !== row) {
        const prev = node.previousElementSibling;
        if (prev !== null) return prev;
        node = node.parentElement;
      }
      return null;
    }

    function applySeatOffset(row, depth) {
      const seat = leadingSeat(row);
      if (seat === null) return null;
      if (depth > 0) seat.style.transform = 'translateX(-1em)';
      else seat.style.removeProperty('transform');
      return seat;
    }

    function decorate(el, sessionId, title) {
      try {
        decorateUnsafe(el, sessionId, title);
      } catch (err) {
        if (!decorateFailed) {
          decorateFailed = true;
          console.warn('[fork-tree] decorate failed, degraded to safe mode', err);
        }
      }
    }

    let decorateFailed = false;

    function decorateUnsafe(el, sessionId, title) {
      if (typeof sessionId !== 'string') return;
      const row = rowOf(el, title);
      if (row === null) return;
      rows.set(sessionId, row);
      installObserver();
      row.setAttribute('data-ft-session', sessionId);
      wireHover(row, sessionId);
      const layout = applyLayout(row);
      // The leading seat hosts the working spinner / waiting clock; on a child
      // row the rail runs through that 16px cell, so shift the seat one
      // character left to clear the connector. Resolved from the row, because
      // which slot hosts us depends on the row's state.
      applySeatOffset(row, depthOf(sessionId));
      ensureToggle(row, sessionId);
      refreshToggles();
      applyVisibility();
      clearTimeout(orderTimer);
      orderTimer = setTimeout(applyOrder, 60);
      if (!lineage.parents.has(sessionId)) {
        // A brand-new session (e.g. a fresh fork) is not in the lineage yet:
        // refresh it now instead of waiting for the next poll.
        load().then(function () {
          applyLayout(row);
          applyOrder();
        });
      }
      if (diagnostics.length < 40) {
        diagnostics.push({ id: sessionId.slice(0, 16), depth: depthOf(sessionId), layout });
      }
      if (Date.now() - lastReport > 5000) sendReport();
    }

    function liveRows() {
      const out = [];
      for (const [id, row] of rows) {
        const info = slotOf(row);
        let slotIndex = -1;
        if (info !== null) {
          slotIndex = Array.prototype.indexOf.call(info.container.children, info.slot);
        }
        out.push({
          id: id.slice(0, 16),
          depth: row.getAttribute('data-ft-depth'),
          railX: row.style.getPropertyValue('--ft-rail-x'),
          left: Math.round(row.getBoundingClientRect().left),
          parentTitle: (function () {
            const pr = rows.get(ancestorsOf(id)[0]);
            if (!pr) return null;
            return titleLeft(pr);
          })(),
          parentLeft: (function () {
            const pr = rows.get(ancestorsOf(id)[0]);
            return pr ? Math.round(pr.getBoundingClientRect().left) : null;
          })(),
          elbowW: row.style.getPropertyValue('--ft-elbow-w'),
          pad: row.style.getPropertyValue('--ft-pad'),
          shiftW: row.style.getPropertyValue('--ft-shift'),
          aligned: (function () {
            const rail = parseFloat(row.style.getPropertyValue('--ft-rail-x'));
            const elbow = parseFloat(row.style.getPropertyValue('--ft-elbow-w'));
            const tx = titleLeft(row);
            if (!Number.isFinite(rail) || !Number.isFinite(elbow) || tx === null) return null;
            return Math.round(tx - (rail + elbow));
          })(),
          titleX: titleLeft(row),
          slotIndex,
          hot: row.getAttribute('data-ft-hot') === '1',
          hidden: row.hasAttribute('data-ft-hidden'),
          toggle: toggles.has(row),
          toggleIn: (function () {
            const button = toggles.get(row);
            if (!button || !button.parentElement) return null;
            return button.parentElement === row ? 'row' : String(button.parentElement.className || '').slice(0, 24);
          })(),
          grp: (function () {
            const info = slotOf(row);
            if (!info) return null;
            if (!info.container.__ftGrp) {
              info.container.__ftGrp = (typeof gid === 'number' ? gid += 1 : (gid = 1));
            }
            return info.container.__ftGrp;
          })(),
          y: Math.round(row.getBoundingClientRect().top),
          ord: (function () {
            const info = slotOf(row);
            return info ? (info.slot.style.order || null) : null;
          })(),
          sib: (function () {
            const info = slotOf(row);
            if (!info || !info.container) return null;
            const kids = Array.from(info.container.children);
            const i = kids.indexOf(info.slot);
            return { i, n: kids.length, first: kids[0] ? (kids[0].className || '').slice(0, 24) : '' };
          })(),
          flow: (function () {
            const info = slotOf(row);
            if (!info || !info.container) return null;
            try { return getComputedStyle(info.container).display; } catch (e) { return null; }
          })(),
          parent: (function () {
            const info = lineage.byId.get(id);
            const pr = (lineage.parents.get(id)) || null;
            return pr ? pr.slice(8, 16) : null;
          })(),
          centre: alignToggle(row),
          titleText: (function () {
            const el = titleEl(row);
            return el === null ? '' : String(el.textContent || '').replace('+', '').replace('\u2212', '').trim().slice(0, 24);
          })(),
          open: !collapsed.has(id),
          children: childCount(id),
          seat: (function () {
            const s = leadingSeat(row);
            if (s === null) return null;
            return { cls: String(s.className || '').slice(0, 40), tf: s.style.transform };
          })(),
          icons: (function () {
            const base = row.getBoundingClientRect().left;
            const out = [];
            const all = row.querySelectorAll('*');
            for (let i = 0; i < all.length && out.length < 6; i += 1) {
              const el = all[i];
              const r = el.getBoundingClientRect();
              if (r.width <= 0 || r.width > 24 || r.height <= 0 || r.height > 24) continue;
              out.push({
                tag: el.tagName,
                cls: String(el.className || '').slice(0, 28),
                x: Math.round(r.left - base),
                w: Math.round(r.width),
                tf: el.style.transform || '',
              });
            }
            return out;
          })(),
        });
      }
      return out;
    }

    function collapseInfo() {
    try {
      const all = document.querySelectorAll('body *');
      for (const el of all) {
        const text = (el.textContent || '').trim();
        if (text !== '收起') continue;
        if (el.children.length > 0) continue;
        const parent = el.parentElement;
        const kids = parent ? Array.from(parent.children) : [];
        let sessionKids = 0;
        for (const kid of kids) {
          if (kid === el) continue;
          if (kid.querySelector && kid.querySelector('[data-ft-session]')) sessionKids += 1;
        }
        return {
          tag: el.tagName,
          cls: String(el.className || '').slice(0, 60),
          parentCls: parent ? String(parent.className || '').slice(0, 60) : null,
          parentDisplay: parent ? getComputedStyle(parent).display : null,
          siblings: kids.length,
          sessionKids,
          order: el.style.order || null,
          parentOrderKids: kids.slice(0, 6).map(function (k) {
            return (String(k.className || '').slice(0, 18) || k.tagName) + ':' + (k.style.order || '-');
          }),
        };
      }
    } catch (err) {
      return { error: String(err && err.message ? err.message : err) };
    }
    return null;
  }

  function sendReport() {
      lastReport = Date.now();
      try {
        fetch(apiUrl('/fork-tree/report'), {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            at: lineage.at,
            count: lineage.parents.size,
            rows: rows.size,
            reorders: reorderCount,
            styled,
            diagnostics: diagnostics.slice(-20),
            live: liveRows(),
            collapse: collapseInfo(),
          }),
        }).catch(function () {});
      } catch (err) {
        /* optional */
      }
    }

    function DepthCell(props) {
      const sessionId = props.sessionId;
      const title = typeof props.displayTitle === 'string' ? props.displayTitle : '';
      const ref = React.useRef(null);
      React.useEffect(function () {
        try {
          const el = ref.current;
          if (el === null || typeof sessionId !== 'string') return;
          if (lineage.at === 0) load().then(function () { decorate(el, sessionId, title); });
          else decorate(el, sessionId, title);
        } catch (err) {
          /* never let a slot callback throw: React would unmount the row */
        }
      });
      return React.createElement('span', { ref, className: 'ft-cell', 'data-ft-id': sessionId });
    }

    function seedFromPage() {
      if (!injected || !Array.isArray(injected.items) || injected.items.length === 0) return;
      const parents = new Map();
      const byId = new Map();
      for (const item of injected.items) {
        parents.set(item.id, item.parent || null);
        byId.set(item.id, item);
      }
      lineage = { at: Date.now(), parents, byId };
    }

    function start() {
      seedFromPage();
      ensureStyle();
      refreshStyle();
      load();
      const idle = function (fn) {
        return function () {
          if (typeof document !== 'undefined' && document.hidden) return;
          fn();
        };
      };
      setInterval(idle(refreshStyle), 20000);
      setInterval(idle(load), 12000);
      // Rows are decorated from the slot callback as they mount, so a global
      // body observer is unnecessary: it fired on every chat token and forced a
      // full reorder each time. A scoped observer is installed lazily instead.
      installObserver();
      try {
        window.addEventListener('resize', function () {
          clearTimeout(orderTimer);
          orderTimer = setTimeout(function () {
            for (const [, row] of rows) applyLayout(row);
          }, 120);
        });
      } catch (err) {
        /* layout stays best-effort */
      }
      window.__ftReport = function () {
        return { at: lineage.at, rows: rows.size, styled, live: liveRows() };
      };
      console.info('[fork-tree] client ready');
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        if (started) return;
        started = true;
        try {
          start();
          for (const slot of [SLOT, ACTION_SLOT]) {
            ctx.slots.inject(slot, function () {
              return ctx.slots.register({
                name: slot,
                id: 'fork-tree-depth',
                order: slot === ACTION_SLOT ? 900 : 10,
              }, DepthCell);
            });
          }
        } catch (err) {
          console.warn('[fork-tree] client start failed', err);
        }
      },
    };
  },
});
