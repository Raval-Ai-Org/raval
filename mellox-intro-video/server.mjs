import http from 'node:http';
import { createReadStream, watch as watchDirectory } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectDir = path.dirname(fileURLToPath(import.meta.url));
export const referenceDir = path.resolve(projectDir, '../video-clone/temp');

const rootFiles = new Set([
  'index.html', 'app.js', 'app.mjs', 'film.js', 'film.mjs', 'style.css',
  'styles.css', 'config.js', 'config.mjs', 'config.json', 'film-config.js',
  'film-config.mjs', 'copy.json', 'brand-tokens.json',
]);
const mediaTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8',
};

function allowedProjectPath(relative) {
  if (!relative || relative.includes('\\') || relative.split('/').some(p => p.startsWith('.'))) return false;
  return rootFiles.has(relative) || (relative.startsWith('assets/') && Boolean(mediaTypes[path.extname(relative).toLowerCase()]));
}

async function fileForRequest(url) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(url, 'http://127.0.0.1').pathname); }
  catch { return null; }
  const referenceFiles = {
    '/reference/ref.mp4': 'ref.mp4',
    '/reference/ref_audio.mp3': 'ref_audio.mp3',
  };
  const referenceFile = referenceFiles[pathname];
  const base = referenceFile ? referenceDir : projectDir;
  const relative = referenceFile || (pathname === '/' ? 'index.html' : pathname.slice(1));
  if (!referenceFile && !allowedProjectPath(relative)) return null;
  const candidate = path.resolve(base, relative);
  try {
    // Check the real path as well, so a symlink cannot expose another directory.
    const [resolvedBase, resolvedFile] = await Promise.all([realpath(base), realpath(candidate)]);
    if (!resolvedFile.startsWith(resolvedBase + path.sep)) return null;
    const details = await stat(resolvedFile);
    return details.isFile() ? { filename: resolvedFile, size: details.size, relative } : null;
  } catch { return null; }
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
  return { start, end };
}

/** Only explicitly listed film files and the two reference assets are exposed. */
export async function startServer({ port = 0, watch = false } = {}) {
  const listeners = new Set();
  let watcher;
  let reloadTimer;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
      return;
    }
    if (req.url === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (req.url === '/__events' && watch) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      listeners.add(res);
      req.on('close', () => listeners.delete(res));
      return;
    }
    try {
      const file = await fileForRequest(req.url);
      if (!file) { res.writeHead(404).end('Not found'); return; }
      const type = mediaTypes[path.extname(file.filename).toLowerCase()] || 'application/octet-stream';
      const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes' };
      if (file.relative === 'index.html' && watch && !req.url.includes('render=1') && !req.headers.range) {
        const html = await readFile(file.filename, 'utf8');
        const reload = '<script>new EventSource("/__events").onmessage=()=>location.reload();</script>';
        const body = html.includes('</body>') ? html.replace('</body>', reload + '</body>') : html + reload;
        res.writeHead(200, { ...headers, 'Content-Length': Buffer.byteLength(body) });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }
      let selected;
      if (req.headers.range) {
        selected = parseRange(req.headers.range, file.size);
        if (!selected) { res.writeHead(416, { 'Content-Range': `bytes */${file.size}` }).end(); return; }
        headers['Content-Range'] = `bytes ${selected.start}-${selected.end}/${file.size}`;
      }
      headers['Content-Length'] = selected ? selected.end - selected.start + 1 : file.size;
      res.writeHead(selected ? 206 : 200, headers);
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(file.filename, selected || {});
      stream.on('error', error => res.destroy(error));
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      if (!res.headersSent) res.writeHead(500);
      res.end('Unable to serve film asset');
      console.error(error.message);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  if (watch) {
    watcher = watchDirectory(projectDir, { recursive: true }, (_event, filename) => {
      const relative = String(filename || '').split(path.sep).join('/');
      if (!allowedProjectPath(relative)) return;
      // app.mjs polls this file and redraws at the current playhead. Let it
      // preserve the position instead of replacing the whole preview page.
      if (relative === 'config.json') return;
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        for (const response of listeners) response.write('data: reload\n\n');
      }, 120);
    });
  }
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    server, url,
    async close() {
      clearTimeout(reloadTimer);
      watcher?.close();
      for (const response of listeners) response.end();
      listeners.clear();
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--port');
  const port = index < 0 ? 4177 : Number(process.argv[index + 1]);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Use --port followed by a number from 0 to 65535.');
  const instance = await startServer({ port, watch: true });
  console.log(`Mellox film preview: ${instance.url}`);
  console.log('Edit the film configuration or animation source to reload the preview. Ctrl+C stops it.');
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await instance.close();
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}
