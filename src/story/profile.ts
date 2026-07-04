// Профіль гравця: золото / досвід / отримані предмети — куди складаються НАГОРОДИ
// за квести. Поки простий localStorage-стор; коли зʼявиться економіка/крамниця —
// вони читатимуть звідси. grantReward викликає життєвий цикл квесту при завершенні.

const LS = 'zag_profile';

export interface Profile { gold: number; xp: number; items: string[] }

export function loadProfile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem(LS) ?? '{}') as Partial<Profile>;
    return { gold: p.gold ?? 0, xp: p.xp ?? 0, items: Array.isArray(p.items) ? p.items : [] };
  } catch { return { gold: 0, xp: 0, items: [] }; }
}
function saveProfile(p: Profile): void {
  try { localStorage.setItem(LS, JSON.stringify(p)); } catch { /* ignore */ }
}

export interface RewardLike { gold?: number; xp?: number; itemId?: string; note?: string }
export function grantReward(r?: RewardLike | null): void {
  if (!r) return;
  const p = loadProfile();
  if (r.gold) p.gold += r.gold;
  if (r.xp) p.xp += r.xp;
  if (r.itemId && !p.items.includes(r.itemId)) p.items.push(r.itemId);
  saveProfile(p);
}

// Короткий підпис нагороди для тосту («+50 золота, +10 досвіду, Оберіг»).
export function rewardLabel(r?: RewardLike | null): string {
  if (!r) return '';
  const parts: string[] = [];
  if (r.gold) parts.push(`+${r.gold} золота`);
  if (r.xp) parts.push(`+${r.xp} досвіду`);
  if (r.itemId) parts.push(r.itemId);
  if (r.note) parts.push(r.note);
  return parts.join(', ');
}
