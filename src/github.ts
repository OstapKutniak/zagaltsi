// GitHub API helper — publishes files directly from browser via Git Data API.
// Works from any computer; only requires a Personal Access Token stored in localStorage.

const OWNER = 'OstapKutniak';
const REPO  = 'zagaltsi';
const BRANCH = 'main';
const API = 'https://api.github.com';

export function getToken(): string | null { return localStorage.getItem('gh_pat'); }
export function setToken(t: string): void { localStorage.setItem('gh_pat', t.trim()); }
export function clearToken(): void { localStorage.removeItem('gh_pat'); }

function hdr(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

// fetch, стійкий до МЕРЕЖЕВИХ збоїв: коли fetch КИДАЄ (TypeError: Failed to fetch —
// VPN/проксі/розширення/офлайн заблокували зʼєднання), ретраїмо з беком, а як усе марно —
// кидаємо зрозуміле повідомлення (а не голий «Failed to fetch»).
async function netFetch(url: string, init: RequestInit, retries = 3): Promise<Response> {
  let lastErr: unknown;
  for (let a = 0; a < retries; a++) {
    try { return await fetch(url, init); }
    catch (e) { lastErr = e; if (a < retries - 1) await sleep(900 * (a + 1)); }
  }
  const msg = (lastErr as Error)?.message || String(lastErr);
  throw new Error(`Немає зʼєднання з api.github.com (${msg}). Імовірно блокує VPN/корпоративний проксі/розширення браузера — спробуй іншу мережу або вимкни блокувальники.`);
}

// fetch + ретрай на ТРАНЗІЄНТНИХ помилках (403/429 secondary rate limit, 5xx).
// Не-транзієнтні коди (401/404/422) повертаються як є — викликач сам вирішує.
async function apiFetch(url: string, init: RequestInit, h: HeadersInit, retries = 4): Promise<Response> {
  let res!: Response;
  for (let a = 0; a < retries; a++) {
    res = await netFetch(url, { ...init, headers: h });
    if (res.ok) return res;
    if (res.status === 403 || res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1200 * (a + 1));
      continue;
    }
    return res; // 401/404/422 — ретрай не допоможе
  }
  return res;
}

// Encode potentially large UTF-8 string to base64 without btoa Unicode bug
function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// Prompt user for PAT if not set; returns token or throws
export function requireToken(): string {
  let tok = getToken();
  if (!tok) {
    tok = prompt(
      'Введи GitHub Personal Access Token (repo → Contents → Read & Write).\n' +
      'Зберігається тільки в цьому браузері.'
    );
    if (!tok) throw new Error('Токен не введено');
    setToken(tok);
  }
  return tok;
}

// Створити blob із ретраєм. Великі ассети (base64 PNG) + кілька файлів за раз
// ловлять secondary rate limit GitHub (403/429) — тому послідовно й з беком.
async function createBlob(path: string, content: string, h: HeadersInit): Promise<string> {
  const MAX = 5;
  let lastErr = '';
  for (let attempt = 0; attempt < MAX; attempt++) {
    const r = await netFetch(`${API}/repos/${OWNER}/${REPO}/git/blobs`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ content: toBase64(content), encoding: 'base64' }),
    });
    if (r.ok) {
      const { sha } = await r.json() as { sha: string };
      return sha;
    }
    lastErr = `${r.status}`;
    // 403/429 = rate limit (зокрема secondary), 5xx = транзієнтна — чекаємо й пробуємо ще.
    if (r.status === 403 || r.status === 429 || r.status >= 500) {
      const ra = Number(r.headers.get('retry-after'));
      const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1500 * (attempt + 1);
      await new Promise((res) => setTimeout(res, waitMs));
      continue;
    }
    break; // інші коди (401/404/422) — ретрай не допоможе
  }
  throw new Error(`GitHub blob помилка: ${path} (${lastErr})`);
}

// Push multiple files in one commit using Git Data API (handles large files)
export async function ghCommit(files: Record<string, string>, message: string): Promise<void> {
  const token = requireToken();
  const h = hdr(token);

  // 1. HEAD sha
  const refRes = await netFetch(`${API}/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`, { headers: h });
  if (!refRes.ok) { if (refRes.status === 401) clearToken(); throw new Error(`GitHub ${refRes.status}: перевір токен`); }
  const { object: { sha: headSha } } = await refRes.json() as { object: { sha: string } };

  // 2. tree sha of HEAD commit
  const commitRes = await netFetch(`${API}/repos/${OWNER}/${REPO}/git/commits/${headSha}`, { headers: h });
  if (!commitRes.ok) throw new Error(`GitHub ${commitRes.status}: commits`);
  const { tree: { sha: baseSha } } = await commitRes.json() as { tree: { sha: string } };

  // 3. create blobs — ПОСЛІДОВНО (паралельні POST-и великих ассетів ловлять
  //    secondary rate limit GitHub → 403). З ретраєм на транзієнтних помилках.
  const treeItems: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }> = [];
  for (const [path, content] of Object.entries(files)) {
    const sha = await createBlob(path, content, h);
    treeItems.push({ path, mode: '100644', type: 'blob', sha });
  }

  // 4. new tree
  const treeRes = await apiFetch(`${API}/repos/${OWNER}/${REPO}/git/trees`,
    { method: 'POST', body: JSON.stringify({ base_tree: baseSha, tree: treeItems }) }, h);
  if (!treeRes.ok) throw new Error(`GitHub: tree ${treeRes.status} ${(await treeRes.text()).slice(0, 140)}`);
  const { sha: newTree } = await treeRes.json() as { sha: string };

  // 5. new commit
  const commitMk = await apiFetch(`${API}/repos/${OWNER}/${REPO}/git/commits`,
    { method: 'POST', body: JSON.stringify({ message, tree: newTree, parents: [headSha] }) }, h);
  if (!commitMk.ok) throw new Error(`GitHub: commit ${commitMk.status} ${(await commitMk.text()).slice(0, 140)}`);
  const { sha: newCommit } = await commitMk.json() as { sha: string };

  // 6. update ref — два РІЗНІ режими відмови:
  //    • 422 (non-fast-forward) = гілка зрушила → ребейзимо коміт на свіжий HEAD;
  //    • 403/429/5xx = secondary rate limit → ЧЕКАЄМО і повторюємо ТОЙ САМИЙ коміт
  //      (перестворювати коміт під тротлінгом = лити олію у вогонь).
  const refUrl = `${API}/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`;
  let pendingCommit = newCommit;
  let lastErr = '';
  const MAX_REF_TRIES = 6;
  for (let attempt = 0; attempt < MAX_REF_TRIES; attempt++) {
    const updRes = await netFetch(refUrl, { method: 'PATCH', headers: h, body: JSON.stringify({ sha: pendingCommit }) });
    if (updRes.ok) return;
    const status = updRes.status;
    lastErr = `${status} ${(await updRes.text()).slice(0, 140)}`;
    if (attempt === MAX_REF_TRIES - 1) break;

    if (status === 403 || status === 429 || status >= 500) {
      // Тротлінг — почекати (Retry-After або наростаючий бек) і повторити той самий коміт.
      const ra = Number(updRes.headers.get('retry-after'));
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1500 * (attempt + 1));
      continue;
    }
    // 422/інше — гілка зрушила: підтягнути HEAD, ребейзнути коміт, повторити.
    await sleep(500 * (attempt + 1));
    const ref2 = await apiFetch(`${API}/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`, { method: 'GET' }, h);
    if (!ref2.ok) { lastErr = `re-read ref ${ref2.status}`; continue; }
    const { object: { sha: newHead } } = await ref2.json() as { object: { sha: string } };
    const rebaseRes = await apiFetch(`${API}/repos/${OWNER}/${REPO}/git/commits`,
      { method: 'POST', body: JSON.stringify({ message, tree: newTree, parents: [newHead] }) }, h);
    if (!rebaseRes.ok) { lastErr = `rebase commit ${rebaseRes.status}`; continue; }
    pendingCommit = (await rebaseRes.json() as { sha: string }).sha;
  }
  throw new Error(`GitHub: не вдалось оновити ref — ${lastErr}`);
}
