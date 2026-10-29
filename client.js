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
    let orderTimer = 0;
    let lastApply = 0;

    const rows = new Map();
    const toggles = new Map();
    const expanded = new Set();
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
        const res = await fetch('/fork-tree/style.css', { credentials: 'same-origin' });
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
        const res = await fetch('/fork-tree/lineage.json', { credentials: 'same-origin' });
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
        console.warn('[fork-tree] lineage fetch failed', err);
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

    function slotOf(row) {
      const parent = row.parentElement;
      if (parent === null) return null;
      if (parent.querySelectorAll('[data-ft-session]').length >= 2) {
        return { container: parent, slot: row };
      }
      const grand = parent.parentElement;
      if (grand === null) return null;
      return { container: grand, slot: parent };
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
          for (let i = 0; i < ordered.length; i += 1) ordered[i].slot.style.order = String(i);
        } else {
          let cursor = ordered[0].slot;
          for (let i = 1; i < ordered.length; i += 1) {
            const slot = ordered[i].slot;
            if (slot === cursor) continue;
            try {
              container.insertBefore(slot, cursor.nextSibling);
            } catch (err) {
              break;
            }
            cursor = slot;
          }
        }
      }
      lastApply = Date.now();
    }

    function applyLayout(row) {
      const id = row.getAttribute('data-ft-session');
      if (!id) return null;
      const depth = depthOf(id);
      if (depth <= 0) {
        row.removeAttribute('data-ft-depth');
        row.style.removeProperty('--ft-d');
        row.style.removeProperty('--ft-rail-x');
        row.style.removeProperty('--ft-elbow-w');
        return null;
      }
      row.setAttribute('data-ft-depth', String(depth));
      row.style.setProperty('--ft-d', String(depth));

      const childX = titleLeft(row);
      if (childX === null) return null;
      const parentRow = rows.get(ancestorsOf(id)[0]);
      let railX = childX - 8;
      if (parentRow) {
        const px = titleLeft(parentRow);
        if (px !== null) {
          const delta = parentRow.getBoundingClientRect().left - row.getBoundingClientRect().left;
          railX = Math.round(px + delta);
        }
      }
      const elbowW = Math.max(4, childX - railX - 2);
      row.style.setProperty('--ft-rail-x', railX + 'px');
      row.style.setProperty('--ft-elbow-w', elbowW + 'px');
      return { railX, elbowW, childX };
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
        if (!expanded.has(parent)) return false;
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
          row.removeAttribute('data-ft-hidden');
          if (wasHidden) shown.push(row);
        } else {
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
      button.textContent = '+';
      button.setAttribute('data-open', open ? '1' : '0');
      button.title = open ? '收起分叉' : '展开分叉';
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      button.setAttribute('aria-label', open ? '收起分叉' : '展开分叉');
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
      // Inside the title element, immediately after its text: the marker hugs
      // the name and cannot be displaced by hover-only row actions.
      const title = titleEl(row);
      if (title !== null) {
        if (button.parentElement !== title) title.appendChild(button);
      } else if (button.parentElement === null) {
        row.appendChild(button);
      }
      updateToggle(id);
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
      if (typeof sessionId !== 'string') return;
      const row = rowOf(el, title);
      if (row === null) return;
      rows.set(sessionId, row);
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
          elbowW: row.style.getPropertyValue('--ft-elbow-w'),
          titleX: titleLeft(row),
          slotIndex,
          hot: row.getAttribute('data-ft-hot') === '1',
          hidden: row.hasAttribute('data-ft-hidden'),
          toggle: toggles.has(row),
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

    function sendReport() {
      lastReport = Date.now();
      try {
        fetch('/fork-tree/report', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            at: lineage.at,
            count: lineage.parents.size,
            rows: rows.size,
            styled,
            diagnostics: diagnostics.slice(-20),
            live: liveRows(),
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
        const el = ref.current;
        if (el === null || typeof sessionId !== 'string') return;
        if (lineage.at === 0) load().then(function () { decorate(el, sessionId, title); });
        else decorate(el, sessionId, title);
      });
      return React.createElement('span', { ref, className: 'ft-cell', 'data-ft-id': sessionId });
    }

    function start() {
      ensureStyle();
      refreshStyle();
      load();
      setInterval(refreshStyle, 15000);
      setInterval(load, 10000);
      setInterval(function () {
        for (const [id, row] of rows) {
          applyLayout(row);
          applySeatOffset(row, depthOf(id));
        }
      }, 20000);
      try {
        let t = 0;
        new MutationObserver(function () {
          if (Date.now() - lastApply < 300) return;
          clearTimeout(t);
          t = setTimeout(function () {
            applyOrder();
            for (const [id, row] of rows) {
              applyLayout(row);
              applySeatOffset(row, depthOf(id));
            }
          }, 120);
        }).observe(document.body, { childList: true, subtree: true });
      } catch (err) {
        /* observer is an optimisation only */
      }
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
