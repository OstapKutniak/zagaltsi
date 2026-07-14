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

// Простори SList: /shopping-parents/ — той самий додаток, але окрема PWA й
// окрема гілка в Firebase (для батьків). index.html і sw.js НЕ дублюються в
// репо — генеруються з public/shopping/ (посилання на style/app/icons
// переписуються на ../shopping/). Ручний у репо лише manifest.json.
function shoppingSpacesPlugin(): Plugin {
  const SPACES = ['shopping-parents'];
  const rewriteIndex = (html: string) => html
    .replace('href="style.css"', 'href="../shopping/style.css"')
    .replace('src="app.js"', 'src="../shopping/app.js"')
    .replace('href="icons/icon-192.png"', 'href="../shopping/icons/icon-192.png"');
  const srcDir = path.resolve(process.cwd(), 'public/shopping');
  return {
    name: 'shopping-spaces',
    // dev: віддаємо згенеровані файли, щоб простір можна було перевірити локально
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = (req.url || '').match(/^\/(shopping-[a-z]+)\/(index\.html)?(\?.*)?$|^\/(shopping-[a-z]+)\/(sw\.js)(\?.*)?$/);
        if (!m) { next(); return; }
        const space = m[1] || m[4];
        if (!SPACES.includes(space)) { next(); return; }
        if (m[5] === 'sw.js') {
          res.setHeader('Content-Type', 'text/javascript');
          res.end(fs.readFileSync(path.join(srcDir, 'sw.js'), 'utf8'));
        } else {
          res.setHeader('Content-Type', 'text/html');
          res.end(rewriteIndex(fs.readFileSync(path.join(srcDir, 'index.html'), 'utf8')));
        }
      });
    },
    // build: кладемо копії в dist/<простір>/
    closeBundle() {
      const dist = path.resolve(process.cwd(), 'dist');
      if (!fs.existsSync(path.join(dist, 'shopping'))) return;
      for (const space of SPACES) {
        const dir = path.join(dist, space);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'index.html'),
          rewriteIndex(fs.readFileSync(path.join(dist, 'shopping/index.html'), 'utf8')));
        fs.copyFileSync(path.join(dist, 'shopping/sw.js'), path.join(dir, 'sw.js'));
      }
    },
  };
}

// base: './' — щоб усе працювало з будь-якого підшляху на хостингу/в Telegram.
export default defineConfig({
  base: './',
  server: { host: true },
  plugins: [publishPlugin(), shoppingSpacesPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        studio: 'studio.html',
        rig: 'rig.html',
        level: 'level.html',
        bretwalda: 'bretwalda.html',
      },
    },
  },
});
