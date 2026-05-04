// Mini serveur statique de dev — reproduit la prod : public/ est servi à la racine.
// /data/ et /scripts/ sont aussi servis (pour le pipeline de build local).
// Usage: node scripts/server.js  →  http://localhost:8080

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8090;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.mjs':  'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.gltf': 'model/gltf+json',
    '.bin':  'application/octet-stream',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg':  'image/svg+xml',
    '.mp3':  'audio/mpeg',
    '.wav':  'audio/wav',
    '.woff2':'font/woff2',
};

function resolveTarget(reqPath) {
    if (reqPath === '/') return path.join(ROOT, 'public', 'index.html');
    if (reqPath.startsWith('/data/'))    return path.join(ROOT, reqPath);
    if (reqPath.startsWith('/scripts/')) return path.join(ROOT, reqPath);
    return path.join(ROOT, 'public', reqPath);
}

http.createServer((req, res) => {
    const reqPath = decodeURIComponent(req.url.split('?')[0]);
    let target = path.normalize(resolveTarget(reqPath));
    if (!target.startsWith(ROOT)) {
        res.writeHead(403); res.end('Forbidden'); return;
    }
    fs.stat(target, (err, stat) => {
        if (err) { res.writeHead(404); res.end('Not found: ' + reqPath); return; }
        if (stat.isDirectory()) target = path.join(target, 'index.html');
        fs.readFile(target, (err, data) => {
            if (err) { res.writeHead(404); res.end('Not found'); return; }
            const ext = path.extname(target).toLowerCase();
            res.writeHead(200, {
                'Content-Type': MIME[ext] || 'application/octet-stream',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
            });
            res.end(data);
        });
    });
}).listen(PORT, () => {
    console.log(`→ http://localhost:${PORT}/                            (site)`);
    console.log(`→ http://localhost:${PORT}/scripts/build-visemes.html  (build visemes)`);
});
