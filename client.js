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
    let loadTimer = 0;
    let reorderCount = 0;
    let gid = 0;
    let lastApply = 0;

    const rows = new Map();
    const toggles = new Map();
    // Collapsed sets, not expanded sets: a fork is VISIBLE by default and only
    // disappears when the user explicitly collapses its parent. Hiding new
    // children by default made sessions look like they had vanished.
    // Default is COLLAPSED at every fork point: a session that has forks shows
    // `+` and its children stay hidden until the user opens it. `expanded`
    // therefore stores the exceptions (what the user opened), not the closes, so
    // a brand-new fork shows up closed instead of flooding the sidebar.
    const expanded = new Set();
    // Ids we opened automatically (ancestors of the session being viewed). They
    // are remembered so the user can collapse them again and stay collapsed.
    const autoExpanded = new Set();
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

    /**
     * Debounced lineage refresh for rows that are not in the snapshot yet (a
     * brand-new fork). Several rows mount at once, so one refresh must serve
     * all of them instead of one fetch per row.
     */
    function scheduleLoad() {
      clearTimeout(loadTimer);
      loadTimer = setTimeout(function () {
        load().then(function () {
          // Depths changed with the new lineage: invalidate every row's
          // decoration signature and re-apply the geometry once.
          for (const [, row] of rows) {
            row.__ftSig = '';
            applyLayout(row);
          }
          applyVisibility();
          applyOrder();
        });
      }, 120);
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
     * True for a collapse/expand control ("收起" / "展开" / "Show more").
     *
     * Anchored on purpose: a workspace heading such as "已展开的会话" must stay a
     * heading. A wrapper that merely CONTAINS such a control still counts, so a
     * `.list > footerWrap > button` structure is pinned as a footer too.
     */
    const FOOTER_TEXT = /^(收起|折叠|展开|显示更多|显示更少|Show more|Show less)$/i;

    function footerLike(el) {
      const text = String(el.textContent || '').trim();
      if (text.length === 0 || text.length > 24) return false;
      return FOOTER_TEXT.test(text);
    }

    function applyOrder() {
      if (typeof window !== 'undefined') window.__ftPasses = (window.__ftPasses || 0) + 1;
      // Ordering is the point of this plugin: DSH 0.2.2 only nests
      // `origin === 'subagent'` forks, so a user fork otherwise keeps its list
      // position and a child's indent points at a parent far away. Disable with
      // window.__DSH_FORK_TREE_ORDER__ = false.
      if (typeof window !== 'undefined' && window.__DSH_FORK_TREE_ORDER__ === false) {
        lastApply = Date.now();
        return;
      }
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
        let kids = [];
        try { kids = Array.from(container.children); } catch (err) { continue; }
        const want = new Set(ordered.map(function (e) { return e.slot; }));
        const positions = [];
        for (let i = 0; i < kids.length; i += 1) if (want.has(kids[i])) positions.push(i);
        if (positions.length !== ordered.length) continue;
        if (positions.length < 2) continue;
        const isFlex = display.indexOf('flex') !== -1;
        // A host node the plugin does not own may live in this container: the
        // group's "···" overflow button, the menu it opens, a toast, a drag
        // placeholder. Re-numbering those with `order` is what made a menu hop
        // out of its anchor and, on the upgraded sidebar, look like it closed on
        // click. Two rules: never touch such a container's layout, and when the
        // host node sits BETWEEN rows, only permute the rows themselves.
        const firstRow = positions[0];
        const lastRow = positions[positions.length - 1];
        const modeByContainer = applyOrder.modes || (applyOrder.modes = new WeakMap());
        let mode = modeByContainer.get(container);
        if (!mode) {
          let pop = false;
          for (let i = 0; i < kids.length; i += 1) {
            if (want.has(kids[i])) continue;
            try {
              if (kids[i].matches && kids[i].matches('[aria-haspopup],[role="menu"],[role="menuitem"],[role="dialog"]')) { pop = true; break; }
            } catch (err) { /* detached node */ }
          }
          // Sticky: decided once, before any transient node can appear. A group
          // section that owns a popover control is always slot-preserving, so a
          // menu opening later never flips the layout maths underneath itself.
          mode = pop ? 'inplace' : 'banded';
          modeByContainer.set(container, mode);
        }
        let interlopers = false;
        let oddInterlopers = false;
        for (let i = 0; i < kids.length; i += 1) {
          if (want.has(kids[i])) continue;
          if (i > firstRow && i < lastRow) {
            interlopers = true;
            if (!footerLike(kids[i])) oddInterlopers = true;
          }
        }
        // Slot-preserving containers are re-planned on every pass: every node the
        // plugin does not own keeps its rank, so a menu that appears gets its own
        // slot instead of floating to the top (which is what pushed the anchor
        // down and made the menu look like it had closed).
        if (mode === 'banded' && oddInterlopers) continue;
        const inPlace = mode === 'inplace';
        if (inPlace && !isFlex) continue;
        const plan = new Map();
        if (inPlace) {
          // Slot-preserving mode: the k-th child keeps rank k, so every node the
          // plugin does not own stays exactly where the host rendered it, and
          // only session rows change places.
          let next = 0;
          for (let i = 0; i < kids.length; i += 1) {
            plan.set(want.has(kids[i]) ? ordered[next++].slot : kids[i], String(i));
          }
        } else {
          // Banded mode: headings first, sessions 0..n-1, footers last. Both keep
          // their native relative order, so each group's values ASCEND.
          const heads = [];
          const foots = [];
          for (let i = 0; i < kids.length; i += 1) {
            if (want.has(kids[i])) continue;
            if (footerLike(kids[i])) foots.push(kids[i]);
            else heads.push(kids[i]);
          }
          for (let i = 0; i < heads.length; i += 1) plan.set(heads[i], String(i - heads.length));
          for (let i = 0; i < ordered.length; i += 1) plan.set(ordered[i].slot, String(i));
          for (let i = 0; i < foots.length; i += 1) plan.set(foots[i], String(ordered.length + i));
        }
        // Write only when the DOM does not already show the tree. Converting an
        // already-correct block list to flex, or re-writing the same values on
        // every pass, is what made rows look like they "shuffled twice" on click.
        const orderOf = function (el) { return el.style.order === '' ? '0' : el.style.order; };
        let need = !isFlex;
        for (const [el, value] of plan) {
          if (orderOf(el) !== value) { need = true; break; }
        }
        if (!need) continue;
        if (!isFlex) {
          // DSH lists are plain block containers (newer builds dropped the flex
          // layout), where `order` does nothing. Convert ONCE and drive the whole
          // group with `order`; no node is ever moved, so React never sees a
          // foreign insertion. Containers that host popovers never get here.
          container.style.display = 'flex';
          container.style.flexDirection = 'column';
        }
        let changed = false;
        for (const [el, value] of plan) {
          if (el.style.order === value) continue;
          el.style.order = value;
          if (want.has(el)) changed = true;
        }
        if (changed) reorderCount += 1;
      }
      lastApply = Date.now();
    }

    if (typeof window !== 'undefined') window.__ftApply = applyOrder;

    const observedContainers = new WeakSet();
    let applyScheduled = false;

    /** Coalesce every trigger into one pass before the browser paints. */
    function scheduleApply() {
      if (applyScheduled) return;
      applyScheduled = true;
      const run = function () {
        applyScheduled = false;
        applyOrder();
      };
      if (typeof queueMicrotask === 'function') queueMicrotask(run);
      else Promise.resolve().then(run);
    }

    /**
     * Watch EVERY container that holds rows, insertions only. A host node dropped
     * among the rows (a menu, a toast) must get its slot before paint: left at the
     * default `order: 0` it sorts to the top of the group, pushes the "···" anchor
     * down and makes the just-opened menu look like it closed.
     */
    function installObserver() {
      const dbg = (typeof window !== 'undefined') ? (window.__ftObs = window.__ftObs || { calls: 0, observed: 0, err: '' }) : null;
      if (dbg) dbg.calls += 1;
      try {
        const seen = new Set();
        for (const [, row] of rows) {
          const info = slotOf(row);
          const container = info && info.container;
          if (!container || seen.has(container)) continue;
          seen.add(container);
          if (observedContainers.has(container)) continue;
          observedContainers.add(container);
          if (dbg) dbg.observed += 1;
          new MutationObserver(scheduleApply).observe(container, { childList: true });
        }
      } catch (err) {
        if (dbg) dbg.err = String((err && err.message) || err);
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

    /** The row the conversation pane currently shows, if the row exposes it. */
    function isActiveRow(row) {
      try {
        if (row.getAttribute('aria-current') === 'true') return true;
        if (row.hasAttribute('data-active')) return true;
        if (row.querySelector('[aria-current="true"],[data-active="true"]') !== null) return true;
      } catch (err) {
        /* optional */
      }
      return false;
    }

    /**
     * A fork point starts closed; a session without forks never hides anything.
     * `childCount` only counts mounted child rows, so a fork that lives in
     * another workspace cannot hide a row that has no `+` to reveal it.
     */
    function isVisible(id) {
      let parent = parentOf(id);
      let guard = 0;
      while (parent && guard < 12) {
        if (childCount(parent) > 0 && !expanded.has(parent)) return false;
        parent = parentOf(parent);
        guard += 1;
      }
      return true;
    }

    function applyVisibility() {
      // The session being viewed must not start hidden: open its ancestor chain
      // once, and only once, so the user can close it again afterwards.
      for (const [id, row] of rows) {
        if (!isActiveRow(row)) continue;
        let parent = parentOf(id);
        let guard = 0;
        while (parent && guard < 12) {
          if (!autoExpanded.has(parent)) {
            autoExpanded.add(parent);
            expanded.add(parent);
            updateToggle(parent);
          }
          parent = parentOf(parent);
          guard += 1;
        }
      }
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
      const open = expanded.has(id);
      button.textContent = open ? '−' : '+';
      button.setAttribute('data-open', open ? '1' : '0');
      const kids = childCount(id);
      button.title = open ? '收起分叉' : '展开分叉' + (kids > 0 ? ' (' + kids + ')' : '');
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
          // Default is closed, so the button OPENS the branch; clicking again
          // closes it. Either way it is a user decision, so it leaves
          // `autoExpanded` alone.
          if (expanded.has(id)) expanded.delete(id);
          else expanded.add(id);
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
      // The attribute must be on the row BEFORE the container lookup: slotOf()
      // counts children holding a session row, and an unmarked row made it walk
      // past the real list and observe the wrong node.
      row.setAttribute('data-ft-session', sessionId);
      installObserver();
      wireHover(row, sessionId);
      // One decoration per row state. React re-renders a row for hover, status
      // and time updates; recomputing geometry and re-measuring text ranges on
      // every one of those made the sidebar (and its menus) feel laggy.
      const depth = depthOf(sessionId);
      let width = 0;
      try {
        width = Math.round(row.getBoundingClientRect().width);
      } catch (err) {
        width = 0;
      }
      const signature = depth + '|' + width + '|' + String(title || '');
      if (row.__ftSig === signature) {
        if (!lineage.parents.has(sessionId)) scheduleLoad();
        return;
      }
      row.__ftSig = signature;
      const layout = applyLayout(row);
      // The leading seat hosts the working spinner / waiting clock; on a child
      // row the rail runs through that 16px cell, so shift the seat one
      // character left to clear the connector. Resolved from the row, because
      // which slot hosts us depends on the row's state.
      applySeatOffset(row, depth);
      ensureToggle(row, sessionId);
      // A newly mounted child turns its parent into a fork point. Give the
      // parent its `+` right away: with branches collapsed by default, a parent
      // that never re-renders would otherwise hide this row with no control on
      // screen to reveal it.
      const forkParent = parentOf(sessionId);
      if (forkParent) {
        const forkRow = rows.get(forkParent);
        if (forkRow) ensureToggle(forkRow, forkParent);
      }
      applyVisibility();
      clearTimeout(orderTimer);
      orderTimer = setTimeout(applyOrder, 60);
      if (!lineage.parents.has(sessionId)) scheduleLoad();
      if (diagnostics.length < 40) {
        diagnostics.push({ id: sessionId.slice(0, 16), depth, layout });
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
          open: expanded.has(id),
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
