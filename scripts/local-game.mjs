import {readFile} from 'node:fs/promises';
import {pcmFromWav} from '../server/validation.js';

const base = '/_preview/bleach';
const directory = new URL('../private-assets/bleach/', import.meta.url);

// This router belongs to the loopback preview process, never the hosted Worker.
// It does not activate drafts, change review attestations, or accept recordings.
export async function createLocalGameHandler() {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
  const routes = new Map();
  for (const [name, mime] of Object.entries({
    'index.html': 'text/html; charset=utf-8',
    'game.css': 'text/css; charset=utf-8',
    'game.js': 'text/javascript; charset=utf-8',
    'controller.js': 'text/javascript; charset=utf-8',
  })) {
    const value = {mime, bytes: await readFile(new URL('local-game/' + name, import.meta.url))};
    routes.set(base + '/' + name, value);
    if (name === 'index.html') { routes.set(base, value); routes.set(base + '/', value); }
  }
  const sounds = [];
  for (const sound of manifest.sounds) {
    if (!/^[a-z0-9-]+\.wav$/.test(sound.file) || !/^bleach-[a-z0-9-]+$/.test(sound.id)) throw new Error('Invalid local sample path');
    const bytes = await readFile(new URL(sound.file, directory));
    const samples = pcmFromWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
    const url = base + '/audio/' + sound.id + '.wav';
    routes.set(url, {mime: 'audio/wav', bytes});
    sounds.push({id: sound.id, title: sound.title, duration: samples.length / 16000, url});
  }
  routes.set(base + '/catalog.json', {mime: 'application/json; charset=utf-8', bytes: Buffer.from(JSON.stringify({
    localOnly: true, category: 'Anime', subcategory: 'Bleach', language: 'Japanese', sounds,
  }))});
  return function localGame(req, res, url) {
    if (url.pathname !== base && !url.pathname.startsWith(base + '/')) return false;
    const headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"};
    if ((req.headers.origin && req.headers.origin !== url.origin) || req.headers['sec-fetch-site'] === 'cross-site') {
      res.writeHead(403, headers).end('Local preview only'); return true;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {res.writeHead(405, {...headers, Allow: 'GET, HEAD'}).end(); return true;}
    const asset = routes.get(url.pathname);
    if (!asset) {res.writeHead(404, headers).end('Local sample not found'); return true;}
    res.writeHead(200, {...headers, 'Content-Type': asset.mime, 'Content-Length': asset.bytes.length});
    res.end(req.method === 'HEAD' ? undefined : asset.bytes);
    return true;
  };
}
