import { createReadStream, watch } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import process from 'node:process';

const outputDirectory = path.resolve(process.cwd(), 'dist');
const contentDirectory = path.resolve(process.cwd(), 'content');
const listenIndex = process.argv.indexOf('--listen');
const hostIndex = process.argv.indexOf('--host');
const port = Number(listenIndex >= 0 ? process.argv[listenIndex + 1] : process.env.PORT || 3000);
const host = hostIndex >= 0 ? process.argv[hostIndex + 1] : process.env.HOST || '127.0.0.1';

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf'
};
const liveReloadClients = new Set();
let rebuildTimer;
let rebuildInProgress = false;
let rebuildQueued = false;

function sendNotFound(response) {
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('Not found');
}

function notifyReload() {
  for (const client of liveReloadClients) client.write('data: reload\n\n');
}

function rebuild() {
  if (rebuildInProgress) {
    rebuildQueued = true;
    return;
  }
  rebuildInProgress = true;
  const child = spawn(process.execPath, ['scripts/build.mjs'], {
    cwd: process.cwd(),
    stdio: 'inherit'
  });
  child.on('close', (code) => {
    rebuildInProgress = false;
    if (code === 0) {
      console.log('Content changed — preview reloaded.');
      notifyReload();
    }
    if (rebuildQueued) {
      rebuildQueued = false;
      rebuild();
    }
  });
}

function scheduleRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(rebuild, 120);
}

const server = createServer(async (request, response) => {
  try {
    const requestedPath = decodeURIComponent((request.url || '/').split('?')[0]);
    if (requestedPath === '/__livereload') {
      response.writeHead(200, {
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'content-type': 'text/event-stream'
      });
      response.write('retry: 1000\n\n');
      liveReloadClients.add(response);
      request.on('close', () => liveReloadClients.delete(response));
      return;
    }
    if (requestedPath === '/__livereload.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end('new EventSource("/__livereload").onmessage = () => window.location.reload();');
      return;
    }
    const relativePath = requestedPath.replace(/^\/+/, '');
    let file = path.resolve(outputDirectory, relativePath);

    if (!file.startsWith(outputDirectory + path.sep) && file !== outputDirectory) {
      sendNotFound(response);
      return;
    }

    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    const extension = path.extname(file).toLowerCase();
    if (extension === '.html') {
      const html = await readFile(file, 'utf8');
      response.writeHead(200, { 'content-type': contentTypes[extension] });
      response.end(html.replace('</body>', '<script src="/__livereload.js"></script></body>'));
      return;
    }
    response.writeHead(200, { 'content-type': contentTypes[extension] || 'application/octet-stream' });
    createReadStream(file).pipe(response);
  } catch {
    sendNotFound(response);
  }
});

server.listen(port, host, () => {
  console.log(`Preview with live reload listening on http://${host}:${port}`);
});

watch(contentDirectory, { recursive: true }, (_event, file) => {
  if (file && /\.(md|bib|ya?ml)$/i.test(file)) scheduleRebuild();
});
