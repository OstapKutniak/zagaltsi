import { emptyRig, sampleTrack, type RigDoc, type RigPart, type Clip, type Keyframe } from './format';

// ---- Веб-ріг-редактор (cutout). Vanilla TS + Canvas2D. ----
// Завантаж PNG-частини -> постав pivot/ієрархію/шари -> зроби кліпи з ключів обертання
// -> Play для перевірки -> Export JSON (його читає гра).

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('stage');
const ctx = canvas.getContext('2d')!;

const state = {
  doc: emptyRig() as RigDoc,
  images: new Map<string, HTMLImageElement>(),
  selected: null as string | null,
  clip: null as string | null, // null = режим bind-пози
  time: 0,
  playing: false,
  zoom: 1,
  origin: { x: 0, y: 0 },
};

// ---------- утиліти моделі ----------
const part = (name: string | null): RigPart | undefined => state.doc.parts.find((p) => p.name === name);
const clipObj = (name: string | null): Clip | undefined => state.doc.clips.find((c) => c.name === name);

function effective(p: RigPart): { rotation: number; x: number; y: number } {
  const c = clipObj(state.clip);
  if (c) {
    const track = c.tracks[p.name];
    if (track && track.length) return sampleTrack(track, state.time);
  }
  return { rotation: p.rotation, x: p.x, y: p.y };
}

interface WorldT {
  px: number; // світова позиція півота
  py: number;
  rot: number; // світовий кут (рад)
}

function computeWorld(): Map<string, WorldT> {
  const out = new Map<string, WorldT>();
  // топологічний порядок: батьки перед дітьми
  const pending = [...state.doc.parts];
  let guard = 0;
  while (pending.length && guard++ < 9999) {
    const p = pending.shift()!;
    if (p.parent && !out.has(p.parent)) {
      pending.push(p);
      continue;
    }
    const e = effective(p);
    const rad = (e.rotation * Math.PI) / 180;
    if (!p.parent) {
      out.set(p.name, { px: state.origin.x + e.x, py: state.origin.y + e.y, rot: rad });
    } else {
      const pw = out.get(p.parent)!;
      const cos = Math.cos(pw.rot);
      const sin = Math.sin(pw.rot);
      out.set(p.name, {
        px: pw.px + (e.x * cos - e.y * sin),
        py: pw.py + (e.x * sin + e.y * cos),
        rot: pw.rot + rad,
      });
    }
  }
  return out;
}

// ---------- рендер ----------
function resize(): void {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  state.origin.x = canvas.width * 0.5;
  state.origin.y = canvas.height * 0.62;
}

function draw(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(state.origin.x, state.origin.y);
  ctx.scale(state.zoom, state.zoom);
  ctx.translate(-state.origin.x, -state.origin.y);

  // підлога-орієнтир
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(0, state.origin.y);
  ctx.lineTo(canvas.width, state.origin.y);
  ctx.stroke();

  const world = computeWorld();
  const sorted = [...state.doc.parts].sort((a, b) => a.z - b.z);
  for (const p of sorted) {
    const w = world.get(p.name);
    if (!w) continue;
    const img = state.images.get(p.image);
    ctx.save();
    ctx.translate(w.px, w.py);
    ctx.rotate(w.rot);
    if (img) {
      ctx.drawImage(img, -p.pivotX * img.width, -p.pivotY * img.height);
    } else {
      ctx.fillStyle = 'rgba(200,120,120,0.4)';
      ctx.fillRect(-20, -40, 40, 80); // плейсхолдер, якщо картинку ще не підвантажено
    }
    ctx.restore();
  }

  // маркери вибраної частини
  const sel = part(state.selected);
  if (sel) {
    const w = world.get(sel.name);
    if (w) {
      if (sel.parent && world.get(sel.parent)) {
        const pw = world.get(sel.parent)!;
        ctx.strokeStyle = '#ffd000';
        ctx.beginPath();
        ctx.moveTo(pw.px, pw.py);
        ctx.lineTo(w.px, w.py);
        ctx.stroke();
      }
      ctx.fillStyle = '#ffd000';
      ctx.beginPath();
      ctx.arc(w.px, w.py, 4 / state.zoom, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// курсор -> світові координати
function toWorld(ev: MouseEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  const cx = ev.clientX - r.left;
  const cy = ev.clientY - r.top;
  return {
    x: (cx - state.origin.x) / state.zoom + state.origin.x,
    y: (cy - state.origin.y) / state.zoom + state.origin.y,
  };
}

function hitTest(wx: number, wy: number): string | null {
  const world = computeWorld();
  const sorted = [...state.doc.parts].sort((a, b) => b.z - a.z); // спереду назад
  for (const p of sorted) {
    const w = world.get(p.name);
    const img = state.images.get(p.image);
    if (!w) continue;
    const iw = img ? img.width : 40;
    const ih = img ? img.height : 80;
    // інверсна трансформація точки у простір картинки
    const dx = wx - w.px;
    const dy = wy - w.py;
    const cos = Math.cos(-w.rot);
    const sin = Math.sin(-w.rot);
    const lx = dx * cos - dy * sin + p.pivotX * iw;
    const ly = dx * sin + dy * cos + p.pivotY * ih;
    if (lx >= 0 && lx <= iw && ly >= 0 && ly <= ih) return p.name;
  }
  return null;
}

// ---------- редагування пози ----------
function applyPose(p: RigPart, next: { rotation?: number; x?: number; y?: number }): void {
  const cur = effective(p);
  const val = { rotation: next.rotation ?? cur.rotation, x: next.x ?? cur.x, y: next.y ?? cur.y };
  const c = clipObj(state.clip);
  if (c) {
    upsertKey(c, p.name, state.time, val);
  } else {
    p.rotation = val.rotation;
    p.x = val.x;
    p.y = val.y;
  }
}

function upsertKey(c: Clip, partName: string, t: number, v: { rotation: number; x: number; y: number }): void {
  const track = (c.tracks[partName] ??= []);
  const eps = 0.02;
  const existing = track.find((k) => Math.abs(k.t - t) < eps);
  if (existing) {
    existing.rotation = v.rotation;
    existing.x = v.x;
    existing.y = v.y;
  } else {
    track.push({ t, rotation: v.rotation, x: v.x, y: v.y });
    track.sort((a, b) => a.t - b.t);
  }
}

// ---------- UI ----------
function refreshPartsList(): void {
  const list = $('partsList');
  list.innerHTML = '';
  for (const p of state.doc.parts) {
    const div = document.createElement('div');
    div.className = 'part' + (p.name === state.selected ? ' sel' : '');
    div.innerHTML = `<span>${p.name}</span><span style="color:#7a6f95">z${p.z}</span>`;
    div.onclick = () => {
      state.selected = p.name;
      refreshAll();
    };
    list.appendChild(div);
  }
}

function refreshParentSel(): void {
  const sel = $<HTMLSelectElement>('parentSel');
  const p = part(state.selected);
  sel.innerHTML = '<option value="">(немає)</option>';
  for (const o of state.doc.parts) {
    if (p && o.name === p.name) continue;
    const opt = document.createElement('option');
    opt.value = o.name;
    opt.textContent = o.name;
    sel.appendChild(opt);
  }
  if (p) sel.value = p.parent ?? '';
}

function refreshClipSel(): void {
  const sel = $<HTMLSelectElement>('clipSel');
  sel.innerHTML = '<option value="">(bind-поза)</option>';
  for (const c of state.doc.clips) {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.textContent = c.name;
    sel.appendChild(opt);
  }
  sel.value = state.clip ?? '';
}

function refreshSelectedControls(): void {
  const p = part(state.selected);
  const c = clipObj(state.clip);
  $<HTMLInputElement>('zVal').value = p ? String(p.z) : '0';
  $<HTMLInputElement>('pivotX').value = p ? String(p.pivotX) : '0.5';
  $<HTMLInputElement>('pivotY').value = p ? String(p.pivotY) : '0.5';
  const e = p ? effective(p) : { rotation: 0, x: 0, y: 0 };
  $<HTMLInputElement>('poseRot').value = String(Math.round(e.rotation));
  $('rotLabel').textContent = String(Math.round(e.rotation));
  const tl = $<HTMLInputElement>('timeline');
  tl.max = String(c ? c.duration : 1);
  tl.disabled = !c;
  tl.value = String(state.time);
  $('timeLabel').textContent = state.time.toFixed(2);
  $<HTMLInputElement>('clipDuration').value = String(c ? c.duration : 1);
  $<HTMLInputElement>('clipLoop').checked = c ? c.loop : false;
  $<HTMLButtonElement>('playPause').textContent = state.playing ? '⏸ Pause' : '▶ Play';
  refreshKeyList();
}

function refreshKeyList(): void {
  const box = $('keyList');
  box.innerHTML = '';
  const c = clipObj(state.clip);
  const p = part(state.selected);
  if (!c || !p) return;
  const track = c.tracks[p.name] ?? [];
  for (const k of track) {
    const span = document.createElement('span');
    span.className = 'k';
    span.textContent = `${k.t.toFixed(2)}s`;
    span.onclick = () => {
      state.time = k.t;
      refreshAll();
    };
    box.appendChild(span);
  }
}

function refreshAll(): void {
  refreshPartsList();
  refreshParentSel();
  refreshClipSel();
  refreshSelectedControls();
}

function status(msg: string): void {
  $('status').textContent = msg;
}

// ---------- завантаження картинок ----------
$<HTMLInputElement>('fileInput').addEventListener('change', (ev) => {
  const files = (ev.target as HTMLInputElement).files;
  if (!files) return;
  let z = state.doc.parts.length;
  for (const file of Array.from(files)) {
    const img = new Image();
    img.onload = () => draw();
    img.src = URL.createObjectURL(file);
    state.images.set(file.name, img);
    if (!part(file.name)) {
      state.doc.parts.push({
        name: file.name.replace(/\.[^.]+$/, ''),
        image: file.name,
        parent: null,
        z: z++,
        pivotX: 0.5,
        pivotY: 0.5,
        x: 0,
        y: 0,
        rotation: 0,
      });
    }
  }
  // зв'язати щойно додані частини з їх іменем-без-розширення
  for (const p of state.doc.parts) {
    if (!state.images.has(p.image)) {
      const match = [...state.images.keys()].find((k) => k.replace(/\.[^.]+$/, '') === p.name);
      if (match) p.image = match;
    }
  }
  status(`Завантажено картинок: ${state.images.size}`);
  refreshAll();
});

// ---------- контролери частини ----------
$<HTMLSelectElement>('parentSel').addEventListener('change', (ev) => {
  const p = part(state.selected);
  if (p) p.parent = (ev.target as HTMLSelectElement).value || null;
});
$<HTMLInputElement>('zVal').addEventListener('input', (ev) => {
  const p = part(state.selected);
  if (p) p.z = Number((ev.target as HTMLInputElement).value);
});
$<HTMLInputElement>('pivotX').addEventListener('input', (ev) => {
  const p = part(state.selected);
  if (p) p.pivotX = Number((ev.target as HTMLInputElement).value);
});
$<HTMLInputElement>('pivotY').addEventListener('input', (ev) => {
  const p = part(state.selected);
  if (p) p.pivotY = Number((ev.target as HTMLInputElement).value);
});
$<HTMLButtonElement>('deletePart').addEventListener('click', () => {
  const p = part(state.selected);
  if (!p) return;
  state.doc.parts = state.doc.parts.filter((x) => x !== p);
  for (const o of state.doc.parts) if (o.parent === p.name) o.parent = null;
  for (const c of state.doc.clips) delete c.tracks[p.name];
  state.selected = null;
  refreshAll();
});

// ---------- кліпи / анімація ----------
$<HTMLSelectElement>('clipSel').addEventListener('change', (ev) => {
  state.clip = (ev.target as HTMLSelectElement).value || null;
  state.time = 0;
  state.playing = false;
  refreshSelectedControls();
});
$<HTMLButtonElement>('newClip').addEventListener('click', () => {
  const name = prompt('Назва кліпу (напр. idle, walk, punch):', 'walk');
  if (!name) return;
  if (clipObj(name)) {
    status('Кліп з такою назвою вже є');
    return;
  }
  state.doc.clips.push({ name, duration: 1, loop: true, tracks: {} });
  state.clip = name;
  state.time = 0;
  refreshAll();
});
$<HTMLButtonElement>('renameClip').addEventListener('click', () => {
  const c = clipObj(state.clip);
  if (!c) return;
  const name = prompt('Нова назва кліпу:', c.name);
  if (!name) return;
  c.name = name;
  state.clip = name;
  refreshAll();
});
$<HTMLButtonElement>('delClip').addEventListener('click', () => {
  const c = clipObj(state.clip);
  if (!c) return;
  state.doc.clips = state.doc.clips.filter((x) => x !== c);
  state.clip = null;
  refreshAll();
});
$<HTMLInputElement>('clipDuration').addEventListener('input', (ev) => {
  const c = clipObj(state.clip);
  if (c) c.duration = Math.max(0.1, Number((ev.target as HTMLInputElement).value));
  refreshSelectedControls();
});
$<HTMLInputElement>('clipLoop').addEventListener('change', (ev) => {
  const c = clipObj(state.clip);
  if (c) c.loop = (ev.target as HTMLInputElement).checked;
});
$<HTMLInputElement>('timeline').addEventListener('input', (ev) => {
  state.time = Number((ev.target as HTMLInputElement).value);
  state.playing = false;
  refreshSelectedControls();
});
$<HTMLInputElement>('poseRot').addEventListener('input', (ev) => {
  const p = part(state.selected);
  if (!p) return;
  applyPose(p, { rotation: Number((ev.target as HTMLInputElement).value) });
  $('rotLabel').textContent = (ev.target as HTMLInputElement).value;
  refreshKeyList();
});
$<HTMLButtonElement>('setKey').addEventListener('click', () => {
  const p = part(state.selected);
  const c = clipObj(state.clip);
  if (!p || !c) {
    status('Спершу вибери кліп і частину');
    return;
  }
  const e = effective(p);
  upsertKey(c, p.name, state.time, e);
  refreshKeyList();
});
$<HTMLButtonElement>('delKey').addEventListener('click', () => {
  const p = part(state.selected);
  const c = clipObj(state.clip);
  if (!p || !c) return;
  const track = c.tracks[p.name];
  if (!track) return;
  c.tracks[p.name] = track.filter((k) => Math.abs(k.t - state.time) >= 0.02);
  refreshKeyList();
});
$<HTMLButtonElement>('playPause').addEventListener('click', () => {
  if (!clipObj(state.clip)) {
    status('Вибери кліп, щоб програти');
    return;
  }
  state.playing = !state.playing;
  refreshSelectedControls();
});

// ---------- canvas взаємодія ----------
let drag: { name: string; startWX: number; startWY: number; baseX: number; baseY: number } | null = null;

canvas.addEventListener('mousedown', (ev) => {
  const w = toWorld(ev);
  const hit = hitTest(w.x, w.y);
  if (hit) {
    state.selected = hit;
    const p = part(hit)!;
    const e = effective(p);
    drag = { name: hit, startWX: w.x, startWY: w.y, baseX: e.x, baseY: e.y };
    refreshAll();
  }
});
window.addEventListener('mousemove', (ev) => {
  if (!drag) return;
  const p = part(drag.name);
  if (!p) return;
  const w = toWorld(ev);
  let dwx = w.x - drag.startWX;
  let dwy = w.y - drag.startWY;
  // зсув у системі батька
  const pw = p.parent ? computeWorld().get(p.parent) : undefined;
  if (pw) {
    const cos = Math.cos(-pw.rot);
    const sin = Math.sin(-pw.rot);
    const rx = dwx * cos - dwy * sin;
    const ry = dwx * sin + dwy * cos;
    dwx = rx;
    dwy = ry;
  }
  applyPose(p, { x: drag.baseX + dwx, y: drag.baseY + dwy });
});
window.addEventListener('mouseup', () => {
  drag = null;
});
canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  state.zoom = Math.min(3, Math.max(0.2, state.zoom * (ev.deltaY < 0 ? 1.1 : 0.9)));
}, { passive: false });

// ---------- експорт / імпорт ----------
$<HTMLButtonElement>('exportBtn').addEventListener('click', () => {
  const json = JSON.stringify(state.doc, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'rig.json';
  a.click();
  status('Експортовано rig.json');
});
$<HTMLButtonElement>('copyBtn').addEventListener('click', async () => {
  await navigator.clipboard.writeText(JSON.stringify(state.doc, null, 2));
  status('JSON скопійовано в буфер');
});
$<HTMLButtonElement>('importBtn').addEventListener('click', () => $<HTMLInputElement>('importInput').click());
$<HTMLInputElement>('importInput').addEventListener('change', (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      state.doc = JSON.parse(String(reader.result)) as RigDoc;
      state.selected = state.doc.parts[0]?.name ?? null;
      state.clip = null;
      status('Імпортовано. Підвантаж ті самі PNG, якщо картинок не видно.');
      refreshAll();
    } catch {
      status('Помилка читання JSON');
    }
  };
  reader.readAsText(file);
});

// ---------- цикл ----------
let lastTs = 0;
function loop(ts: number): void {
  const dt = (ts - lastTs) / 1000 || 0;
  lastTs = ts;
  if (state.playing) {
    const c = clipObj(state.clip);
    if (c) {
      state.time += dt;
      if (state.time > c.duration) state.time = c.loop ? state.time % c.duration : c.duration;
      const tl = $<HTMLInputElement>('timeline');
      tl.value = String(state.time);
      $('timeLabel').textContent = state.time.toFixed(2);
    }
  }
  draw();
  requestAnimationFrame(loop);
}

window.addEventListener('resize', resize);
resize();
refreshAll();
requestAnimationFrame(loop);
status('Готово. Кинь PNG-частини через «Вибрати файли».');
