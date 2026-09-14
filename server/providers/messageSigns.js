/**
 * Electronic message signs (DMS / VMS boards).
 *
 *   GET /api/signs — active message signs with their currently posted text
 *
 * One layer, many agencies, in the shape the CCTV provider uses: adding an
 * agency is one entry in SIGN_PACKS plus its loader. Packs fail independently
 * and each has its own env kill switch.
 */
import { loadNe511Signs } from './messageSigns/ne511.js';

/** Refresh interval for the cached sign list. */
export const SIGNS_CACHE_MS = 60 * 1000;

/** Env kill switch: unset or anything but "0" means enabled. */
const envEnabled = (name) => String(process.env[name] || '1').trim() !== '0';

/**
 * Agency packs, in merge order. Each resolves normalized sign records.
 */
export const SIGN_PACKS = [
  {
    name: 'ne511',
    enabled: () => envEnabled('SIGNS_NE511_ENABLED'),
    load: loadNe511Signs,
  },
];

/**
 * Load every enabled pack, tolerating individual failures.
 *
 * @param {object} [options]
 * @param {Array} [options.packs]
 * @returns {Promise<Array<object>>} Normalized signs, deduplicated by id.
 */
export async function loadAllSigns({ packs = SIGN_PACKS } = {}) {
  const active = packs.filter((pack) => pack.enabled());
  const settled = await Promise.allSettled(active.map((pack) => pack.load()));
  const signs = [];
  for (const [index, result] of settled.entries()) {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      signs.push(...result.value);
      continue;
    }
    console.warn(
      `[Signs] pack ${active[index].name} failed:`,
      result.reason?.message || result.reason,
    );
  }
  return Array.from(new Map(signs.map((sign) => [sign.id, sign])).values());
}

/**
 * Vite plugin serving the message-sign route.
 *
 * @returns {{name:string, configureServer:Function, configurePreviewServer:Function}}
 */
export function messageSignsProxy({ cacheMs = SIGNS_CACHE_MS } = {}) {
  /** @type {{at:number, signs:Array<object>}|null} */
  let cache = null;
  /** @type {Promise<Array<object>>|null} */
  let inFlight = null;

  const getSigns = async () => {
    if (cache && Date.now() - cache.at < cacheMs) return cache.signs;
    // Collapse concurrent refreshes onto one upstream round.
    if (!inFlight) {
      inFlight = loadAllSigns()
        .then((signs) => {
          // Keep the last good list when a refresh comes back empty.
          cache =
            signs.length || !cache
              ? { at: Date.now(), signs }
              : { at: Date.now(), signs: cache.signs };
          return cache.signs;
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  };

  const installMiddleware = (server) => {
    server.middlewares.use('/api/signs', async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname !== '/' && url.pathname !== '') {
        res.writeHead(404, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      try {
        const signs = await getSigns();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        // Each record carries its own provider and license, so a
        // mixed-agency response stays attributable per sign.
        res.end(JSON.stringify({ signs }));
      } catch (error) {
        console.error('[Signs]', error?.message || String(error));
        res.writeHead(502, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify({ error: 'Message sign proxy error' }));
      }
    });
  };

  return {
    name: 'message-signs-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
