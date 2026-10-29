/**
 * Host half of @local/fork-tree.
 *
 * 1. One idempotent rename pass per activation: forked sessions whose generated
 *    titles collide become distinguishable.
 *    Config: { renames: [{ sessionId, title }] }
 * 2. A read-only lineage endpoint for the Client half:
 *    GET /fork-tree/lineage.json -> { generatedAt, items: [{ id, parent, ... }] }
 */
export const inject = ['sessionController', 'webServer', 'workspaceController', 'workspaceRegistry'];

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const REPORT_PATH = join(tmpdir(), 'fork-tree-report.json');

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

function sendJson(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(value));
}

export function apply(ctx, config) {
  const list = Array.isArray(config && config.renames) ? config.renames : [];
  const targets = list.filter(function (item) {
    return item !== null && typeof item === 'object' &&
      typeof item.sessionId === 'string' && item.sessionId.length > 0 &&
      typeof item.title === 'string' && item.title.length > 0;
  });

  if (targets.length > 0) {
    ctx.effect(function () {
      let cancelled = false;
      (async function run() {
        for (const target of targets) {
          if (cancelled) return;
          try {
            const result = await ctx.sessionController.rename({
              sessionId: target.sessionId,
              title: target.title,
            });
            console.info('[fork-tree] renamed', target.sessionId, '->', target.title, result);
          } catch (err) {
            console.warn('[fork-tree] rename failed', target.sessionId, err);
          }
        }
      })();
      return function () {
        cancelled = true;
      };
    });
  }

  const moves = Array.isArray(config && config.reorder)
    ? config.reorder.filter(function (item) {
      return item !== null && typeof item === 'object' &&
        typeof item.sessionId === 'string' && item.sessionId.length > 0 &&
        typeof item.afterSessionId === 'string' && item.afterSessionId.length > 0;
    })
    : [];

  if (moves.length > 0) {
    ctx.effect(function () {
      let cancelled = false;
      (async function run() {
        for (const move of moves) {
          if (cancelled) return;
          try {
            const workspaces = ctx.workspaceRegistry.list();
            const workspace = workspaces.find(function (w) {
              return Array.isArray(w.sessionIds) && w.sessionIds.indexOf(move.sessionId) !== -1;
            });
            if (!workspace) continue;
            const ids = workspace.sessionIds.slice();
            const after = ids.indexOf(move.afterSessionId);
            if (after < 0) continue;
            const next = ids[after + 1];
            if (next === move.sessionId) continue;
            await ctx.workspaceController.insertSessionBefore({
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

  ctx.effect(function () {
    return ctx.webServer.register({
      kind: 'exact',
      path: '/fork-tree/lineage.json',
      async handler(req, res) {
        try {
          const controller = new AbortController();
          const value = await ctx.sessionController.list({}, controller.signal);
          const archived = new Set(Array.from(ctx.workspaceRegistry.archivedSessionIds || []));
          const listed = new Set();
          try {
            for (const workspace of ctx.workspaceRegistry.list()) {
              if (workspace && Array.isArray(workspace.sessionIds)) {
                for (const id of workspace.sessionIds) listed.add(id);
              }
            }
          } catch (err) {
            /* a registry race just falls back to the origin test below */
          }
          const items = (value && Array.isArray(value.items) ? value.items : []).map(function (s) {
            const isArchived = archived.has(s.sessionId);
            const isListed = listed.size === 0
              ? (isArchived === false && s.origin !== 'subagent')
              : (listed.has(s.sessionId) && isArchived === false);
            return {
              id: s.sessionId,
              parent: s.parentSessionId === undefined ? null : s.parentSessionId,
              updatedAt: s.updatedAt,
              running: s.running === true,
              blank: s.blank === true,
              origin: s.origin === undefined ? null : s.origin,
              archived: isArchived,
              displayed: isListed,
            };
          });
          sendJson(res, 200, { generatedAt: Date.now(), items });
        } catch (err) {
          console.warn('[fork-tree] lineage failed', err);
          sendJson(res, 500, { error: String(err && err.message ? err.message : err) });
        }
      },
    });
  }, 'fork-tree: lineage route');

  ctx.effect(function () {
    return ctx.webServer.register({
      kind: 'exact',
      path: '/fork-tree/report',
      async handler(req, res) {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'POST only' });
          return;
        }
        try {
          const raw = await readBody(req, 64 * 1024);
          const parsed = JSON.parse(raw || '{}');
          const record = { receivedAt: new Date().toISOString(), report: parsed };
          await writeFile(REPORT_PATH, JSON.stringify(record, null, 2), 'utf8');
          sendJson(res, 200, { ok: true, path: REPORT_PATH });
        } catch (err) {
          sendJson(res, 400, { error: String(err && err.message ? err.message : err) });
        }
      },
    });
  }, 'fork-tree: report route');

  ctx.effect(function () {
    return ctx.webServer.register({
      kind: 'exact',
      path: '/fork-tree/style.css',
      async handler(req, res) {
        try {
          const css = await readFile(new URL('./style.css', import.meta.url), 'utf8');
          res.writeHead(200, {
            'content-type': 'text/css; charset=utf-8',
            'cache-control': 'no-store',
          });
          res.end(css);
        } catch (err) {
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(String(err && err.message ? err.message : err));
        }
      },
    });
  }, 'fork-tree: style route');
}
