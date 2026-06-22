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
    const r = await fetch(`${API}/repos/${OWNER}/${REPO}/git/blobs`, {
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
  const refRes = await fetch(`${API}/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`, { headers: h });
  if (!refRes.ok) { clearToken(); throw new Error(`GitHub ${refRes.status}: перевір токен`); }
  const { object: { sha: headSha } } = await refRes.json() as { object: { sha: string } };

  // 2. tree sha of HEAD commit
  const commitRes = await fetch(`${API}/repos/${OWNER}/${REPO}/git/commits/${headSha}`, { headers: h });
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
  const treeRes = await fetch(`${API}/repos/${OWNER}/${REPO}/git/trees`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ base_tree: baseSha, tree: treeItems }),
  });
  if (!treeRes.ok) throw new Error('GitHub: помилка tree');
  const { sha: newTree } = await treeRes.json() as { sha: string };

  // 5. new commit
  const newCommitRes = await fetch(`${API}/repos/${OWNER}/${REPO}/git/commits`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ message, tree: newTree, parents: [headSha] }),
  });
  if (!newCommitRes.ok) throw new Error('GitHub: помилка commit');
  const { sha: newCommit } = await newCommitRes.json() as { sha: string };

  // 6. update ref (retry once — GitHub Actions may push between our read and write)
  let updRes = await fetch(`${API}/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
    method: 'PATCH', headers: h,
    body: JSON.stringify({ sha: newCommit }),
  });
  if (!updRes.ok) {
    // Branch moved forward; rebase our commit on top of the new HEAD and retry
    const ref2 = await fetch(`${API}/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`, { headers: h });
    if (!ref2.ok) throw new Error('GitHub: помилка update ref');
    const { object: { sha: newHead } } = await ref2.json() as { object: { sha: string } };
    const retry = await fetch(`${API}/repos/${OWNER}/${REPO}/git/commits`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ message, tree: newTree, parents: [newHead] }),
    });
    if (!retry.ok) throw new Error('GitHub: помилка retry commit');
    const { sha: retryCommit } = await retry.json() as { sha: string };
    updRes = await fetch(`${API}/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ sha: retryCommit }),
    });
    if (!updRes.ok) throw new Error('GitHub: помилка update ref (retry)');
  }
}
