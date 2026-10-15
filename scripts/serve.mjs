import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Use --port with a port from 1 to 65535.');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png' };

createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const segments = pathname.split(/[\\/]/).filter(Boolean);
    // Serve only the public application, never secrets, tests, scripts or repository files.
    const publicRootFiles = new Set(['index.html', 'script.js', 'styles.css', 'viviz-logo.jpeg', 'favicon.ico']);
    if (segments.some(segment => segment.startsWith('.')) || !(segments.length === 0 || publicRootFiles.has(segments[0]) || ['lib', 'data'].includes(segments[0])) || segments.includes('staging')) {
      response.writeHead(404).end('Not found');
      return;
    }
    const candidate = resolve(root, ...segments, ...(segments.length ? [] : ['index.html']));
    const path = await realpath(candidate);
    if (!path.startsWith(`${root}${sep}`) || !(await stat(path)).isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    const content = await readFile(path);
    response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => process.stdout.write(`Cloud Compare: http://127.0.0.1:${port}\n`));
