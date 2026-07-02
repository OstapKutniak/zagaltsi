// Редактор Звуку (вкладка студії): бібліотека процедурних звуків ліворуч
// (прослухати кожен соло), мікс лобі праворуч (слайдери, live), осцилограма
// в центрі. Мікс зберігається в IDB (zag_sound_mix) і публікується в sound.json —
// лобі гри читає його при старті.

import { idbGet, idbSet } from '../store';
import {
  type AmbienceMix, DEFAULT_MIX, startAmbience, stopAmbience, setMix,
  triggerThunder, triggerCrow, getAnalyser, isAmbienceRunning,
} from './ambience';
import { registerPublisher, wirePublishButton } from '../publish';

interface SoundDef { key: keyof AmbienceMix; name: string; hint: string; oneShot?: 'thunder' | 'crow' }
const SOUNDS: SoundDef[] = [
  { key: 'rain', name: 'Дощ', hint: 'фільтрований шум із поривами' },
  { key: 'fire', name: 'Вогнище', hint: 'шелест + випадкові тріски' },
  { key: 'crickets', name: 'Цвіркуни', hint: 'цвірінькання пачками' },
  { key: 'thunder', name: 'Блискавка (грім)', hint: 'низький розкат, тригериться під спалах', oneShot: 'thunder' },
  { key: 'crow', name: 'Ворона', hint: 'кар-кар серіями, зрідка', oneShot: 'crow' },
];

let _init = false;
export function initSoundEditor(prefix: string): void {
  if (_init) return; _init = true;
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(prefix + id) as T | null;

  let mix: AmbienceMix = { ...DEFAULT_MIX };
  const setStatus = (m: string): void => { const el = $('statusBar'); if (el) el.textContent = m; };

  void idbGet<AmbienceMix>('zag_sound_mix').then((m) => {
    if (m && typeof m.master === 'number') { mix = { ...DEFAULT_MIX, ...m }; renderMix(); }
  }).catch(() => {});

  // ── Бібліотека: картка на звук із ▶ прослуховуванням соло ──────────────────
  function renderList(): void {
    const list = $('list'); if (!list) return;
    list.innerHTML = '';
    for (const s of SOUNDS) {
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--rail);border:1px solid var(--line);border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:4px';
      const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;gap:8px';
      const nm = document.createElement('div'); nm.textContent = s.name; nm.style.cssText = 'font-size:13px;font-weight:600;flex:1';
      const play = document.createElement('button'); play.textContent = '▶';
      play.title = 'Прослухати соло';
      play.style.cssText = 'padding:4px 12px;font-size:13px';
      play.onclick = () => {
        // соло: усе в нуль, цей звук на робочій гучності
        const solo: AmbienceMix = { master: mix.master, rain: 0, fire: 0, crickets: 0, thunder: 0, crow: 0 };
        solo[s.key] = Math.max(0.5, mix[s.key]);
        startAmbience(solo); setMix(solo);
        if (s.oneShot === 'thunder') triggerThunder(60);
        if (s.oneShot === 'crow') triggerCrow();
        setStatus(`Соло: ${s.name} · «■ Стоп» щоб зупинити`);
      };
      row.appendChild(nm); row.appendChild(play);
      const hint = document.createElement('div'); hint.textContent = s.hint;
      hint.style.cssText = 'font-size:11px;color:var(--muted)';
      card.appendChild(row); card.appendChild(hint);
      list.appendChild(card);
    }
  }

  // ── Мікс: слайдери master + 5 звуків, live через setMix ────────────────────
  function renderMix(): void {
    const body = $('mixBody'); if (!body) return;
    body.innerHTML = '';
    const slider = (label: string, key: keyof AmbienceMix): void => {
      const wr = document.createElement('div'); wr.style.cssText = 'display:flex;align-items:center;gap:8px';
      const sp = document.createElement('span'); sp.textContent = label; sp.style.cssText = 'flex:0 0 110px;font-size:12px;color:var(--muted)';
      const sl = document.createElement('input'); sl.type = 'range'; sl.min = '0'; sl.max = '100'; sl.step = '1';
      sl.value = String(Math.round(mix[key] * 100)); sl.style.cssText = 'flex:1;accent-color:var(--sel)';
      const vl = document.createElement('span'); vl.textContent = sl.value + '%'; vl.style.cssText = 'flex:0 0 40px;text-align:right;font-size:12px;color:var(--muted)';
      sl.addEventListener('input', () => {
        mix[key] = Number(sl.value) / 100;
        vl.textContent = sl.value + '%';
        if (isAmbienceRunning()) setMix(mix);
      });
      wr.appendChild(sp); wr.appendChild(sl); wr.appendChild(vl);
      body.appendChild(wr);
    };
    slider('Загальна', 'master');
    slider('Дощ', 'rain');
    slider('Вогнище', 'fire');
    slider('Цвіркуни', 'crickets');
    slider('Грім', 'thunder');
    slider('Ворона', 'crow');
  }

  // ── Тулбар ──────────────────────────────────────────────────────────────────
  $('playAll')?.addEventListener('click', () => { startAmbience(mix); setMix(mix); setStatus('Грає мікс лобі'); });
  $('stop')?.addEventListener('click', () => { stopAmbience(); setStatus('Зупинено'); });
  $('thunder')?.addEventListener('click', () => { if (!isAmbienceRunning()) startAmbience(mix); triggerThunder(60); });
  $('crow')?.addEventListener('click', () => { if (!isAmbienceRunning()) startAmbience(mix); triggerCrow(); });

  $('saveMix')?.addEventListener('click', () => {
    void idbSet('zag_sound_mix', mix).then(() => setStatus('Мікс збережено локально — лобі підхопить'));
  });

  // Публікація: sound.json (мікс лобі) — «Оновити гру» кладе в studio-data.
  registerPublisher(async () => ({
    'public/studio-data/sound.json': JSON.stringify({ version: 1, lobby: mix }, null, 2),
  }));
  const exp = $('exportBtn') as HTMLButtonElement | null;
  if (exp) wirePublishButton(exp, setStatus, () => {});

  // ── Осцилограма живого міксу ────────────────────────────────────────────────
  const canvas = $('stage') as HTMLCanvasElement | null;
  if (canvas) {
    const ctx = canvas.getContext('2d')!;
    const loop = (): void => {
      if (canvas.clientWidth && (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight)) {
        canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
      }
      const w = canvas.width, h = canvas.height;
      ctx.fillStyle = '#141414'; ctx.fillRect(0, 0, w, h);
      const an = getAnalyser();
      if (an) {
        const data = new Uint8Array(an.fftSize);
        an.getByteTimeDomainData(data);
        ctx.strokeStyle = '#cbb98a'; ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let i = 0; i < data.length; i += 2) {
          const x = (i / data.length) * w;
          const y = (data[i] / 255) * h * 0.9 + h * 0.05;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '14px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('Натисни «▶ Мікс лобі» або ▶ на звуку в бібліотеці', w / 2, h / 2);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  renderList();
  renderMix();
}
