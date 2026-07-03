// Редактор Бота (Telegram) — секція в правій панелі Редактора Меню.
// Остап сам правит вступ/тексти/кнопки бота і тисне «Опублікувати» (спільна
// публікація студії) → public/bot-config.json → воркер читає його ЖИВЦЕМ на
// кожне повідомлення. Жодного Cloudflare і жодного Claude для текстових правок.

import { idbGet, idbSet } from '../store';
import { registerPublisher } from '../publish';

interface BotCfg {
  intro: { photo: string; text: string };
  menuText: string;
  sections: [string, string][]; // [підпис, deep-link параметр]
  gatherText: string;
  updatedAt?: number;
}

// Куди можуть вести кнопки бота (deep-link параметри роутера гри, main.ts).
const PARAMS: [string, string][] = [
  ['zhytlo', 'Житло'], ['mandry', 'Мандри'], ['khorugva', 'Хоругва'],
  ['zavdannya', 'Завдання'], ['dosyagnennya', 'Досягнення'], ['inventar', 'Інвентар'],
];

const DEFAULT_CFG: BotCfg = {
  intro: { photo: 'https://ostapkutniak.github.io/zagaltsi/menu/home.png', text: '' },
  menuText: 'Хоругва кличе. Обирай, куди рушити:',
  sections: PARAMS.map(([p, l]) => [l, p]),
  gatherText: '{from} розгортає хоругву — стань під хоругву!',
};

let _init = false;
export function initBotEditor(container?: HTMLElement): void {
  if (_init) return; _init = true;
  const host = container ?? document.getElementById('mn-right')?.querySelector('.pane');
  if (!host) return;

  let cfg: BotCfg = JSON.parse(JSON.stringify(DEFAULT_CFG)) as BotCfg;

  // Дані: IDB zag_botcfg (локальні правки) ↔ опублікований bot-config.json (LWW).
  const load = async (): Promise<void> => {
    let remote: BotCfg | null = null;
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}bot-config.json?t=${Date.now()}`);
      if (r.ok) remote = await r.json() as BotCfg;
    } catch { /* ignore */ }
    const local = await idbGet<BotCfg>('zag_botcfg').catch(() => null);
    const lw = local?.updatedAt ?? 0, rw = remote?.updatedAt ?? 0;
    const src = (local && lw >= rw) ? local : (remote ?? local);
    if (src) cfg = { ...JSON.parse(JSON.stringify(DEFAULT_CFG)), ...src, intro: { ...DEFAULT_CFG.intro, ...(src.intro ?? {}) } };
    render();
  };

  let saveTimer = 0;
  const save = (): void => {
    cfg.updatedAt = Date.now();
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => { void idbSet('zag_botcfg', cfg); }, 250);
  };

  // ── Розмітка секції ─────────────────────────────────────────────────────────
  const head = document.createElement('button');
  head.className = 'header secToggle';
  head.textContent = 'Бот (Telegram)';
  head.style.marginTop = '6px';
  const body = document.createElement('div');
  body.className = 'secBody';
  body.style.cssText = 'display:none;flex-direction:column;gap:6px';
  head.addEventListener('click', () => {
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'flex';
    head.classList.toggle('open', !open);
  });
  host.appendChild(head); host.appendChild(body);
  // У перемикачі Редактора Історії секція вже вибрана табом — заголовок зайвий.
  if (container) { head.style.display = 'none'; body.style.display = 'flex'; }

  const lbl = (t: string): HTMLElement => {
    const e = document.createElement('label');
    e.textContent = t;
    e.style.cssText = 'font-size:12px;color:var(--muted);font-weight:600';
    return e;
  };
  const inputCss = 'background:var(--rail);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:5px 8px;font-size:13px;font-family:inherit;outline:none;width:100%;box-sizing:border-box';

  function render(): void {
    body.innerHTML = '';

    body.appendChild(lbl('Вступ (на /start, підпис під картинкою)'));
    const intro = document.createElement('textarea');
    intro.style.cssText = inputCss + ';min-height:84px;resize:vertical';
    intro.value = cfg.intro.text;
    intro.addEventListener('input', () => { cfg.intro.text = intro.value; save(); });
    body.appendChild(intro);

    body.appendChild(lbl('Картинка вступу (URL, порожньо = без картинки)'));
    const photo = document.createElement('input');
    photo.type = 'text'; photo.style.cssText = inputCss;
    photo.value = cfg.intro.photo;
    photo.addEventListener('input', () => { cfg.intro.photo = photo.value.trim(); save(); });
    body.appendChild(photo);

    body.appendChild(lbl('Текст меню (на будь-яке повідомлення)'));
    const mt = document.createElement('input');
    mt.type = 'text'; mt.style.cssText = inputCss;
    mt.value = cfg.menuText;
    mt.addEventListener('input', () => { cfg.menuText = mt.value; save(); });
    body.appendChild(mt);

    body.appendChild(lbl('Скликання хоругви ({from} = хто кличе)'));
    const gt = document.createElement('textarea');
    gt.style.cssText = inputCss + ';min-height:64px;resize:vertical';
    gt.value = cfg.gatherText;
    gt.addEventListener('input', () => { cfg.gatherText = gt.value; save(); });
    body.appendChild(gt);

    body.appendChild(lbl('Кнопки бота (підпис → куди веде)'));
    cfg.sections.forEach((s, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:4px;align-items:center';
      const name = document.createElement('input');
      name.type = 'text'; name.style.cssText = inputCss + ';flex:1';
      name.value = s[0];
      name.addEventListener('input', () => { s[0] = name.value; save(); });
      const sel = document.createElement('select');
      sel.style.cssText = inputCss + ';flex:0 0 130px;font-size:12px;padding:5px 4px';
      for (const [p, l] of PARAMS) {
        const o = document.createElement('option'); o.value = p; o.textContent = l; sel.appendChild(o);
      }
      sel.value = s[1];
      sel.addEventListener('change', () => { s[1] = sel.value; save(); });
      const del = document.createElement('button');
      del.textContent = '✕'; del.title = 'Прибрати';
      del.style.cssText = 'flex:0 0 26px;padding:4px;font-size:12px';
      del.addEventListener('click', () => { cfg.sections.splice(i, 1); save(); render(); });
      row.appendChild(name); row.appendChild(sel); row.appendChild(del);
      body.appendChild(row);
    });
    const add = document.createElement('button');
    add.textContent = 'Додати кнопку';
    add.style.cssText = 'width:100%;padding:6px;font-size:12px';
    add.addEventListener('click', () => { cfg.sections.push(['Нова', 'zhytlo']); save(); render(); });
    body.appendChild(add);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:11px;color:var(--muted);line-height:1.5';
    hint.textContent = 'Зміни підхоплюються ботом одразу після «Опублікувати» — передеплой воркера не потрібен.';
    body.appendChild(hint);
  }

  // Спільна публікація студії підбирає й бот-конфіг.
  registerPublisher(() => ({ 'public/bot-config.json': JSON.stringify(cfg, null, 2) }));

  void load();
}
