/**
 * Host half of @local/fork-tree.
 *
 * Cross-platform notes:
 *  - Only Node built-ins (fs/path/os) and WHATWG URL are used; no shell, no
 *    Windows-only paths.
 *  - Routes answer CORS preflight and set `access-control-allow-origin: *`, so
 *    a page served from a custom scheme (Tauri/Electron) or another origin can
 *    still read them.
 *  - The page gets a boot script (window.__DSH_FORK_TREE__) carrying the host
 *    base URL and a lineage snapshot, so the Client half renders even when the
 *    page origin differs from the DSH host.
 *  - `apply` is guarded: an internal error never blocks the DSH boot.
 */
export const inject = ['sessionController', 'webServer'];

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const REPORT_PATH = join(tmpdir(), 'fork-tree-report.json');
const SEP = ' \u00b7 ';
const FORK = '\u5206\u53c9';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function sendJson(res, status, value) {
  res.writeHead(status, Object.assign({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  }, CORS));
  res.end(JSON.stringify(value));
}

function preflight(req, res) {
  if (req.method !== 'OPTIONS') return false;
  res.writeHead(204, CORS);
  res.end();
  return true;
}

function readBody(req, limitBytes) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isAutoTitle(title, parentTitle) {
  if (!title) return true;
  if (!parentTitle) return false;
  if (title === parentTitle) return true;
  return new RegExp('^' + escapeRe(parentTitle) + ' \\(\\d+\\)$').test(title);
}

async function summaryItems(ctx) {
  const value = await ctx.sessionController.list({}, new AbortController().signal);
  const items = value && Array.isArray(value.items) ? value.items : [];
  return items.map(function (s) {
    return {
      id: s.sessionId,
      parent: s.parentSessionId === undefined ? null : s.parentSessionId,
      updatedAt: s.updatedAt,
      running: s.running === true,
      blank: s.blank === true,
      origin: s.origin === undefined ? null : s.origin,
    };
  });
}

async function titleOf(ctx, sessionId) {
  try {
    const value = await ctx.sessionController.projections({ sessionId });
    if (value && value.values && typeof value.values.title === 'string') return value.values.title;
  } catch (err) {
    /* fall back to the event scan */
  }
  try {
    const inspection = await ctx.sessionController.inspect(sessionId);
    const events = Array.isArray(inspection && inspection.events) ? inspection.events : [];
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event.type !== 'session/title' && event.type !== 'session/rename') continue;
      const data = event.data || {};
      if (typeof data.title === 'string') return data.title;
    }
  } catch (err) {
    /* unknown title */
  }
  return '';
}

function applyInner(ctx, config) {
  const settings = config && typeof config === 'object' ? config : {};

  // --- explicit one-shot renames (manual repairs only) ---
  const renames = Array.isArray(settings.renames)
    ? settings.renames.filter(function (item) {
      return item !== null && typeof item === 'object' &&
        typeof item.sessionId === 'string' && item.sessionId.length > 0 &&
        typeof item.title === 'string' && item.title.length > 0;
    })
    : [];

  if (renames.length > 0) {
    ctx.effect(function () {
      let cancelled = false;
      (async function run() {
        for (const item of renames) {
          if (cancelled) return;
          try {
            await ctx.sessionController.rename({ sessionId: item.sessionId, title: item.title });
            console.info('[fork-tree] renamed', item.sessionId, '->', item.title);
          } catch (err) {
            console.warn('[fork-tree] rename failed', item.sessionId, err);
          }
        }
      })();
      return function () {
        cancelled = true;
      };
    });
  }

  // --- automatic fork naming, only for still-default titles ---
  if (settings.autoName !== false) {
    ctx.effect(function () {
      let cancelled = false;
      let timer = 0;

      async function pass() {
        if (cancelled) return;
        try {
          const items = await summaryItems(ctx);
          const byParent = new Map();
          for (const item of items) {
            if (!item.parent) continue;
            if (item.origin === 'subagent') continue;
            if (!byParent.has(item.parent)) byParent.set(item.parent, []);
            byParent.get(item.parent).push(item);
          }
          for (const [parentId, children] of byParent) {
            const parentTitle = await titleOf(ctx, parentId);
            if (!parentTitle) continue;
            children.sort(function (a, b) {
              return (a.updatedAt || 0) - (b.updatedAt || 0);
            });
            for (let i = 0; i < children.length; i += 1) {
              if (cancelled) return;
              const child = children[i];
              const title = await titleOf(ctx, child.id);
              if (!isAutoTitle(title, parentTitle)) continue;
              const next = parentTitle + SEP + FORK + (i + 1);
              if (next === title) continue;
              try {
                await ctx.sessionController.rename({ sessionId: child.id, title: next });
                console.info('[fork-tree] auto-named', child.id, '->', next);
              } catch (err) {
                console.warn('[fork-tree] auto-name failed', child.id, err);
              }
            }
          }
        } catch (err) {
          console.warn('[fork-tree] auto-name scan failed', err);
        }
        if (!cancelled) timer = setTimeout(pass, 60000);
      }

      pass();
      return function () {
        cancelled = true;
        clearTimeout(timer);
      };
    });
  }

  // --- optional persisted ordering (needs workspace services) ---
  const moves = Array.isArray(settings.reorder)
    ? settings.reorder.filter(function (item) {
      return item !== null && typeof item === 'object' &&
        typeof item.sessionId === 'string' && item.sessionId.length > 0 &&
        typeof item.afterSessionId === 'string' && item.afterSessionId.length > 0;
    })
    : [];

  if (moves.length > 0) {
    const registry = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : ctx.workspaceRegistry;
    const controller = typeof ctx.get === 'function' ? ctx.get('workspaceController') : ctx.workspaceController;
    if (!registry || !controller) {
      console.info('[fork-tree] workspace reordering skipped: service unavailable in this profile');
    } else {
      ctx.effect(function () {
        let cancelled = false;
        (async function run() {
          for (const move of moves) {
            if (cancelled) return;
            try {
              const workspaces = registry.list();
              const workspace = workspaces.find(function (w) {
                return Array.isArray(w.sessionIds) && w.sessionIds.indexOf(move.sessionId) !== -1;
              });
              if (!workspace) continue;
              const ids = workspace.sessionIds.slice();
              const after = ids.indexOf(move.afterSessionId);
              if (after < 0) continue;
              const next = ids[after + 1];
              if (next === move.sessionId) continue;
              await controller.insertSessionBefore({
                workspaceId: workspace.id,
                sessionId: move.sessionId,
                beforeSessionId: next,
              });
              console.info('[fork-tree] moved', move.sessionId, 'after', move.afterSessionId);
            } catch (err) {
              console.warn('[fork-tree] move failed', move.sessionId, err);
            }
          }
        })();
        return function () {
          cancelled = true;
        };
      });
    }
  }

  // --- cached lineage, also embedded into the page for cross-origin cases ---
  const cache = { at: 0, items: [] };

  async function refreshCache() {
    try {
      cache.items = await summaryItems(ctx);
      cache.at = Date.now();
    } catch (err) {
      /* keep the previous snapshot */
    }
  }

  refreshCache();
  ctx.effect(function () {
    const timer = setInterval(refreshCache, 10000);
    return function () {
      clearInterval(timer);
    };
  });

  let baseUrl = '';
  try {
    const webApp = typeof ctx.get === 'function' ? ctx.get('webApp') : ctx.webApp;
    if (webApp && typeof webApp.getAdvertisedUrl === 'function') baseUrl = webApp.getAdvertisedUrl();
  } catch (err) {
    baseUrl = '';
  }

  try {
    if (ctx.webServer && typeof ctx.webServer.tapIndex === 'function') {
      ctx.effect(function () {
        return ctx.webServer.tapIndex(function (html) {
          const boot = JSON.stringify({ base: baseUrl, items: cache.items }).replace(/</g, '\\u003c');
          const script = '<script>window.__DSH_FORK_TREE__=' + boot + ';</script>';
          const src = String(html);
          if (src.indexOf('</head>') !== -1) return src.replace('</head>', script + '</head>');
          if (src.indexOf('</body>') !== -1) return src.replace('</body>', script + '</body>');
          return script + src;
        });
      }, 'fork-tree: boot data');
    }
  } catch (err) {
    console.warn('[fork-tree] boot injection unavailable', err);
  }

  // --- lineage ---
  ctx.effect(function () {
    return ctx.webServer.register({
      kind: 'exact',
      path: '/fork-tree/lineage.json',
      async handler(req, res) {
        if (preflight(req, res)) return;
        try {
          await refreshCache();
          sendJson(res, 200, { generatedAt: cache.at, items: cache.items });
        } catch (err) {
          console.warn('[fork-tree] lineage failed', err);
          sendJson(res, 500, { error: String(err && err.message ? err.message : err) });
        }
      },
    });
  }, 'fork-tree: lineage route');

  // --- client diagnostics ---
  ctx.effect(function () {
    return ctx.webServer.register({
      kind: 'exact',
      path: '/fork-tree/report',
      async handler(req, res) {
        if (preflight(req, res)) return;
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'POST only' });
          return;
        }
        try {
          const raw = await readBody(req, 64 * 1024);
          const parsed = JSON.parse(raw || '{}');
          await writeFile(REPORT_PATH, JSON.stringify({ receivedAt: new Date().toISOString(), report: parsed }, null, 2), 'utf8');
          sendJson(res, 200, { ok: true, path: REPORT_PATH });
        } catch (err) {
          sendJson(res, 400, { error: String(err && err.message ? err.message : err) });
        }
      },
    });
  }, 'fork-tree: report route');

  // --- live styles ---
  ctx.effect(function () {
    return ctx.webServer.register({
      kind: 'exact',
      path: '/fork-tree/style.css',
      async handler(req, res) {
        if (preflight(req, res)) return;
        try {
          const css = await readFile(new URL('./style.css', import.meta.url), 'utf8');
          res.writeHead(200, Object.assign({ 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' }, CORS));
          res.end(css);
        } catch (err) {
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(String(err && err.message ? err.message : err));
        }
      },
    });
  }, 'fork-tree: style route');
}

/**
 * Activation guard: a plugin must never block the DSH boot.
 */
export function apply(ctx, config) {
  try {
    applyInner(ctx, config);
  } catch (err) {
    console.warn('[fork-tree] activation skipped to protect the boot:', err);
  }
}
