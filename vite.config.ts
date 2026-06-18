import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

function publishPlugin(): Plugin {
  return {
    name: 'publish-api',
    configureServer(server) {
      server.middlewares.use('/api/publish', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const payload = JSON.parse(body) as { character?: unknown; level?: unknown };
            const pub = path.resolve(process.cwd(), 'public');
            const changed: string[] = [];
            if (payload.character) {
              fs.writeFileSync(path.join(pub, 'character.json'), JSON.stringify(payload.character));
              changed.push('public/character.json');
            }
            if (payload.level) {
              fs.writeFileSync(path.join(pub, 'level.json'), JSON.stringify(payload.level));
              changed.push('public/level.json');
            }
            if (changed.length) {
              execSync(`git add ${changed.join(' ')}`, { cwd: process.cwd() });
              try {
                execSync('git commit -m "studio: publish to game"', { cwd: process.cwd() });
              } catch { /* nothing new to commit — that's fine */ }
              execSync('git push', { cwd: process.cwd() });
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: String(e) }));
          }
        });
      });
    },
  };
}

// base: './' — щоб усе працювало з будь-якого підшляху на хостингу/в Telegram.
export default defineConfig({
  base: './',
  server: { host: true },
  plugins: [publishPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        studio: 'studio.html',
        rig: 'rig.html',
        level: 'level.html',
      },
    },
  },
});
