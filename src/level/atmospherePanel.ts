// Спільна панель «Атмосфера» для редакторів (Мандр / Локації / Меню).
// Винесено з src/level/editor.ts без зміни поведінки: чотири секції-акордеони
// (Плановість per-layer, Погода-стак, Віньєтка, Кольоровий баланс) над об'єктом
// типу Atmosphere. Редактор дає getAtm() (створює atmosphere за потреби) і save().

import {
  type Atmosphere, type WeatherPhase, type LayerKey, type FogLayer, type BlendMode, type LayerTint,
  LAYER_KEYS, LAYER_LABELS, BLEND_MODES, BLEND_LABELS,
  DEFAULT_TOD_PHASE, DEFAULT_WEATHER_PHASE, DEFAULT_FOG_LAYER,
} from './atmosphere';

export interface AtmPanelOpts {
  // Які шари показувати у «Плановості» та «Тумані» (дефолт — усі LAYER_KEYS).
  layers?: LayerKey[];
  // Підписи шарів (дефолт — LAYER_LABELS; можна перекрити частину, напр. map → «Будівлі»).
  labels?: Partial<Record<LayerKey, string>>;
}

// Будує панель атмосфери в container. Повторний виклик перебудовує з поточного стану.
export function buildAtmospherePanel(panel: HTMLElement, getAtm: () => Atmosphere, save: () => void, opts?: AtmPanelOpts): void {
  const rerender = (): void => buildAtmospherePanel(panel, getAtm, save, opts);
  const keys: LayerKey[] = opts?.layers ?? LAYER_KEYS;
  const labelOf = (lk: LayerKey): string => opts?.labels?.[lk] ?? LAYER_LABELS[lk];

  function mkSlider(lbl: string, val: number, max: number, onChange: (v: number) => void): HTMLElement {
    const wr = document.createElement('div'); wr.style.cssText = 'display:flex;align-items:center;gap:4px';
    const sp = document.createElement('span'); sp.style.cssText = 'color:var(--muted);flex:0 0 50px;font-size:11px'; sp.textContent = lbl;
    const sl = document.createElement('input') as HTMLInputElement;
    sl.type = 'range'; sl.min = '0'; sl.max = String(max); sl.step = '1'; sl.value = String(Math.round(val * max)); sl.style.cssText = 'flex:1;accent-color:var(--sel)';
    const vl = document.createElement('span'); vl.style.cssText = 'flex:0 0 28px;text-align:right;color:var(--muted);font-size:11px'; vl.textContent = Math.round(val * 100) + '%';
    sl.addEventListener('input', () => { const v = Number(sl.value) / max; onChange(v); vl.textContent = Math.round(v * 100) + '%'; save(); });
    wr.appendChild(sp); wr.appendChild(sl); wr.appendChild(vl); return wr;
  }

  function mkColorPicker(lbl: string, val: string, onChange: (v: string) => void): HTMLElement {
    const wr = document.createElement('div'); wr.style.cssText = 'display:flex;align-items:center;gap:4px';
    const sp = document.createElement('span'); sp.style.cssText = 'color:var(--muted);flex:0 0 50px;font-size:11px'; sp.textContent = lbl;
    const inp = document.createElement('input') as HTMLInputElement;
    inp.type = 'color'; inp.value = val; inp.style.cssText = 'width:44px;height:22px;padding:1px;border:1px solid var(--line);border-radius:3px;cursor:pointer;background:none;flex:0 0 44px';
    inp.addEventListener('input', () => { onChange(inp.value); save(); });
    wr.appendChild(sp); wr.appendChild(inp); return wr;
  }

  // Будує секцію-акордеон (заголовок + ON/OFF + тіло). Секції статичні per-документ.
  function makeSection(label: string, enabled: boolean, onToggle: (v: boolean) => void): { wrap: HTMLElement; body: HTMLElement; setOpen: (v: boolean) => void } {
    const wrap = document.createElement('div'); wrap.style.cssText = 'border:1px solid var(--line);border-radius:6px;overflow:hidden';
    const hd   = document.createElement('div'); hd.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;background:var(--rail);padding:5px 6px';
    const arr  = document.createElement('span'); arr.style.cssText = 'font-size:11px;transition:transform .15s'; arr.textContent = '▶';
    const lbEl = document.createElement('span'); lbEl.style.cssText = 'font-size:12px;font-weight:600;flex:1'; lbEl.textContent = label;
    const onOff = document.createElement('button');
    onOff.textContent = enabled ? 'ВКЛ' : 'ВИКЛ';
    onOff.style.cssText = 'font-size:10px;padding:2px 7px;border-radius:4px;border:1px solid var(--line);cursor:pointer;background:' + (enabled ? 'var(--accent)' : 'var(--rail)') + ';color:' + (enabled ? '#1b1b1b' : 'var(--muted)');
    onOff.addEventListener('click', (e) => {
      e.stopPropagation();
      const nv = onOff.textContent === 'ВИКЛ';
      onOff.textContent = nv ? 'ВКЛ' : 'ВИКЛ';
      onOff.style.background = nv ? 'var(--accent)' : 'var(--rail)';
      onOff.style.color = nv ? '#1b1b1b' : 'var(--muted)';
      onToggle(nv); save(); rerender();
    });
    hd.appendChild(arr); hd.appendChild(lbEl); hd.appendChild(onOff);
    wrap.appendChild(hd);
    const body = document.createElement('div'); body.style.cssText = 'display:none;flex-direction:column;gap:4px;padding:6px';
    wrap.appendChild(body);
    let open = false;
    const setOpen = (v: boolean): void => {
      open = v; arr.style.transform = v ? 'rotate(90deg)' : ''; body.style.display = v ? 'flex' : 'none';
    };
    hd.addEventListener('click', () => setOpen(!open));
    return { wrap, body, setOpen };
  }

  function mkRangeAbs(lbl: string, val: number, min: number, max: number, suffix: string, onChange: (v: number) => void): HTMLElement {
    const wr = document.createElement('div'); wr.style.cssText = 'display:flex;align-items:center;gap:4px';
    const sp = document.createElement('span'); sp.style.cssText = 'color:var(--muted);flex:0 0 60px;font-size:11px'; sp.textContent = lbl;
    const sl = document.createElement('input') as HTMLInputElement;
    sl.type = 'range'; sl.min = String(min); sl.max = String(max); sl.step = '1'; sl.value = String(Math.round(val));
    sl.style.cssText = 'flex:1;accent-color:var(--sel)';
    const vl = document.createElement('span'); vl.style.cssText = 'flex:0 0 36px;text-align:right;color:var(--muted);font-size:11px'; vl.textContent = Math.round(val) + suffix;
    sl.addEventListener('input', () => { const v = Number(sl.value); onChange(v); vl.textContent = v + suffix; save(); });
    wr.appendChild(sp); wr.appendChild(sl); wr.appendChild(vl); return wr;
  }

  function mkDirPicker(val: number, onChange: (v: number) => void): HTMLElement {
    const wr = document.createElement('div'); wr.style.cssText = 'display:flex;align-items:center;gap:6px';
    const sp = document.createElement('span'); sp.style.cssText = 'color:var(--muted);flex:0 0 60px;font-size:11px'; sp.textContent = 'Напрямок';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 32 32');
    svg.style.cssText = 'width:26px;height:26px;flex:0 0 26px;border:1px solid var(--line);border-radius:50%;background:var(--bg)';
    const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ln.setAttribute('x1', '16'); ln.setAttribute('y1', '4');
    ln.setAttribute('stroke', 'var(--sel)'); ln.setAttribute('stroke-width', '2.5'); ln.setAttribute('stroke-linecap', 'round');
    svg.appendChild(ln);
    const updateArrow = (deg: number): void => {
      const rad = deg * Math.PI / 180;
      ln.setAttribute('x2', (16 + 12 * Math.sin(rad)).toFixed(1));
      ln.setAttribute('y2', (4  + 24 * Math.cos(rad)).toFixed(1));
    };
    updateArrow(val);
    const sl = document.createElement('input') as HTMLInputElement;
    sl.type = 'range'; sl.min = '-45'; sl.max = '45'; sl.step = '1'; sl.value = String(Math.round(val));
    sl.style.cssText = 'flex:1;accent-color:var(--sel)';
    const vl = document.createElement('span'); vl.style.cssText = 'flex:0 0 28px;text-align:right;color:var(--muted);font-size:11px'; vl.textContent = Math.round(val) + '°';
    sl.addEventListener('input', () => { const v = Number(sl.value); onChange(v); updateArrow(v); vl.textContent = v + '°'; save(); });
    wr.appendChild(sp); wr.appendChild(svg); wr.appendChild(sl); wr.appendChild(vl); return wr;
  }

  function mkBlendSelect(val: BlendMode, onChange: (v: BlendMode) => void): HTMLElement {
    const wr = document.createElement('div'); wr.style.cssText = 'display:flex;align-items:center;gap:4px';
    const sp = document.createElement('span'); sp.style.cssText = 'color:var(--muted);flex:0 0 60px;font-size:11px'; sp.textContent = 'Накладання';
    const sel = document.createElement('select') as HTMLSelectElement;
    sel.style.cssText = 'flex:1;background:var(--bg);border:1px solid var(--line);border-radius:4px;color:var(--ink);font-size:11px;padding:2px;font-family:inherit';
    BLEND_MODES.forEach((m) => { const o = document.createElement('option'); o.value = m; o.textContent = BLEND_LABELS[m]; sel.appendChild(o); });
    sel.value = val;
    sel.addEventListener('change', () => { onChange(sel.value as BlendMode); save(); });
    wr.appendChild(sp); wr.appendChild(sel); return wr;
  }

  panel.innerHTML = '';
  const atm = getAtm();

  // ── ПЛАНОВІСТЬ (per-layer tint) ────────────────────────────────────────────
  const todEnabled = !!(atm.tod?.enabled);
  const { wrap: todWrap, body: todBody, setOpen: todOpen } = makeSection('Плановість', todEnabled, (en) => {
    if (!atm.tod) atm.tod = { enabled: en, phases: [{ ...DEFAULT_TOD_PHASE }] };
    else atm.tod.enabled = en;
  });
  if (atm.tod?.enabled) {
    todOpen(true);
    const tod = atm.tod;
    if (!tod.phases.length) tod.phases.push({ ...DEFAULT_TOD_PHASE, layers: {} });
    const ph = tod.phases[0];
    if (!ph.layers) ph.layers = {};
    const layersDiv = document.createElement('div'); layersDiv.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    keys.forEach((lk: LayerKey) => {
      const lt = ph.layers![lk]; // undefined якщо не активний
      const lhd = document.createElement('div'); lhd.style.cssText = 'display:flex;align-items:center;gap:6px';
      const lcb = document.createElement('input'); lcb.type = 'checkbox'; lcb.checked = !!lt; // перевіряємо наявність запису, не alpha
      lcb.style.cssText = 'width:13px;height:13px;accent-color:var(--sel)';
      const llbl = document.createElement('span'); llbl.style.cssText = 'font-size:11px;font-weight:600;flex:1'; llbl.textContent = labelOf(lk);
      lhd.appendChild(lcb); lhd.appendChild(llbl);
      layersDiv.appendChild(lhd);
      // Тіло шару — без default-запису поки не увімкнено!
      const lbody = document.createElement('div'); lbody.style.cssText = 'display:flex;flex-direction:column;gap:3px;padding-left:10px';
      lbody.style.display = lt ? 'flex' : 'none';
      const cur = (): LayerTint => ph.layers![lk]!;
      if (lt) {
        lbody.appendChild(mkColorPicker('Відтінок', lt.color, (v) => { cur().color = v; }));
        lbody.appendChild(mkSlider('Сила', lt.alpha, 100, (v) => { cur().alpha = v; }));
        lbody.appendChild(mkBlendSelect(lt.blend, (v) => { cur().blend = v; }));
      }
      lcb.addEventListener('change', () => {
        if (!lcb.checked) { ph.layers![lk] = undefined; lbody.style.display = 'none'; }
        else { ph.layers![lk] = { color: '#ffffff', alpha: 0.3, blend: 'multiply' }; lbody.style.display = 'flex'; }
        save(); rerender();
      });
      layersDiv.appendChild(lbody);
    });
    todBody.appendChild(layersDiv);
  }
  panel.appendChild(todWrap);

  // ── ПОГОДА (СТАК: дощ / туман / блискавка вмикаються незалежно) ─────────────
  const wxEnabled = !!(atm.weather?.enabled);
  const { wrap: wxWrap, body: wxBody, setOpen: wxOpen } = makeSection('Погода', wxEnabled, (en) => {
    if (!atm.weather) atm.weather = { enabled: en, phases: [{ ...DEFAULT_WEATHER_PHASE }] };
    else atm.weather.enabled = en;
  });
  if (atm.weather?.enabled) {
    wxOpen(true);
    const wx = atm.weather;
    if (!wx.phases.length) wx.phases.push({ ...DEFAULT_WEATHER_PHASE });
    const ph = wx.phases[0];
    // Одноразова міграція: legacy exclusive type → явні тумблери стаку.
    if (ph.rain === undefined && ph.snow === undefined && ph.fog === undefined) {
      ph.rain = ph.type === 'rain'; ph.snow = ph.type === 'snow'; ph.fog = ph.type === 'fog';
    }
    delete ph.type;

    // Заголовок-тумблер модифікатора (чекбокс + назва); тіло малюється окремо, якщо ввімкнено.
    const modToggle = (label: string, on: boolean, set: (v: boolean) => void): HTMLElement => {
      const row = document.createElement('label'); row.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;cursor:pointer;margin-top:4px';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = on; cb.style.cssText = 'width:14px;height:14px;accent-color:var(--sel)';
      cb.addEventListener('change', () => { set(cb.checked); save(); rerender(); });
      row.appendChild(cb); row.appendChild(document.createTextNode(label));
      return row;
    };
    const modBody = (): HTMLElement => { const d = document.createElement('div'); d.style.cssText = 'display:flex;flex-direction:column;gap:3px;padding-left:12px'; return d; };

    // ── ДОЩ ──
    wxBody.appendChild(modToggle('Дощ', !!ph.rain, (v) => { ph.rain = v; }));
    if (ph.rain) {
      const rb = modBody();
      rb.appendChild(mkColorPicker('Колір', ph.rainColor ?? '#aaddff', (v) => { ph.rainColor = v; }));
      rb.appendChild(mkDirPicker(ph.rainDir ?? 15, (v) => { ph.rainDir = v; }));
      rb.appendChild(mkRangeAbs('Швидкість', ph.rainSpeed ?? 600, 50, 2000, ' px/s', (v) => { ph.rainSpeed = v; }));
      rb.appendChild(mkRangeAbs('Довжина', ph.rainDropLen ?? 16, 2, 80, ' px', (v) => { ph.rainDropLen = v; }));
      rb.appendChild(mkRangeAbs('Кількість', ph.rainDrops ?? 100, 10, 500, '%', (v) => { ph.rainDrops = v; }));
      const opLbl = document.createElement('div'); opLbl.textContent = 'Непрозорість шарів'; opLbl.style.cssText = 'color:var(--muted);font-size:11px;margin-top:2px';
      rb.appendChild(opLbl);
      rb.appendChild(mkSlider('Ближній', ph.rainNear ?? 1, 100, (v) => { ph.rainNear = v; }));
      rb.appendChild(mkSlider('Середній', ph.rainMid ?? 0.7, 100, (v) => { ph.rainMid = v; }));
      rb.appendChild(mkSlider('Дальній', ph.rainFar ?? 0.35, 100, (v) => { ph.rainFar = v; }));
      // Пилюка від крапель
      const splRow = document.createElement('label'); splRow.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);cursor:pointer;margin-top:2px';
      const splCb = document.createElement('input'); splCb.type = 'checkbox'; splCb.checked = !!ph.rainSplash; splCb.style.cssText = 'width:14px;height:14px;accent-color:var(--sel)';
      splCb.addEventListener('change', () => { ph.rainSplash = splCb.checked; save(); rerender(); });
      splRow.appendChild(splCb); splRow.appendChild(document.createTextNode('Пилюка від крапель'));
      rb.appendChild(splRow);
      if (ph.rainSplash) {
        rb.appendChild(mkRangeAbs('Розмір', (ph.splashSize ?? 1) * 100, 20, 300, '%', (v) => { ph.splashSize = v / 100; }));
        rb.appendChild(mkRangeAbs('Кількість', (ph.splashCount ?? 1) * 100, 20, 400, '%', (v) => { ph.splashCount = v / 100; }));
        rb.appendChild(mkRangeAbs('Інтенсивність', (ph.splashIntensity ?? 1) * 100, 0, 150, '%', (v) => { ph.splashIntensity = v / 100; }));
      }
      wxBody.appendChild(rb);
    }

    // ── ТУМАН (процедурний, per-layer) ──
    wxBody.appendChild(modToggle('Туман', !!ph.fog, (v) => { ph.fog = v; }));
    if (ph.fog) {
      if (!ph.fogLayers) ph.fogLayers = {};
      const fb = modBody();
      const hint = document.createElement('div'); hint.textContent = 'Шари (у кожному свій туман):'; hint.style.cssText = 'color:var(--muted);font-size:11px';
      fb.appendChild(hint);
      keys.forEach((lk: LayerKey) => {
        const fl = ph.fogLayers![lk];
        const lhd = document.createElement('label'); lhd.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer';
        const lcb = document.createElement('input'); lcb.type = 'checkbox'; lcb.checked = !!fl; lcb.style.cssText = 'width:13px;height:13px;accent-color:var(--sel)';
        const llbl = document.createElement('span'); llbl.style.cssText = 'font-size:11px;font-weight:600;flex:1'; llbl.textContent = labelOf(lk);
        lhd.appendChild(lcb); lhd.appendChild(llbl);
        lcb.addEventListener('change', () => {
          if (lcb.checked) ph.fogLayers![lk] = DEFAULT_FOG_LAYER();
          else delete ph.fogLayers![lk];
          save(); rerender();
        });
        fb.appendChild(lhd);
        if (fl) {
          const cur = (): FogLayer => ph.fogLayers![lk]!;
          const lb = document.createElement('div'); lb.style.cssText = 'display:flex;flex-direction:column;gap:3px;padding-left:10px';
          lb.appendChild(mkColorPicker('Колір', fl.color, (v) => { cur().color = v; }));
          lb.appendChild(mkSlider('Прозорість', fl.alpha, 100, (v) => { cur().alpha = v; }));
          lb.appendChild(mkRangeAbs('Швидкість', fl.speed, 0, 120, ' px/s', (v) => { cur().speed = v; }));
          lb.appendChild(mkRangeAbs('Напрямок', fl.dir, -180, 180, '°', (v) => { cur().dir = v; }));
          lb.appendChild(mkRangeAbs('Розмір', Math.round((fl.scale ?? 1) * 100), 30, 300, '%', (v) => { cur().scale = v / 100; }));
          const rnd = document.createElement('button'); rnd.textContent = 'Рандом патерна'; rnd.style.cssText = 'font-size:10px;padding:3px;border-radius:4px;border:1px solid var(--line);background:var(--rail);color:var(--ink);cursor:pointer;margin-top:2px';
          rnd.addEventListener('click', () => { cur().seed = Math.floor(Math.random() * 1000); save(); });
          lb.appendChild(rnd);
          fb.appendChild(lb);
        }
      });
      wxBody.appendChild(fb);
    }

    // ── БЛИСКАВКА ──
    wxBody.appendChild(modToggle('Блискавка', !!ph.lightning, (v) => { ph.lightning = v; }));
    if (ph.lightning) {
      const lb = modBody();
      const freqVal = ph.lightningFreq ?? (ph.lightningEvery ? Math.max(1, Math.min(10, Math.round(30 / ph.lightningEvery))) : 5);
      lb.appendChild(mkRangeAbs('Частота', freqVal, 1, 10, '', (v) => { ph.lightningFreq = v; delete ph.lightningEvery; }));
      lb.appendChild(mkRangeAbs('Рандом', (ph.lightningVary ?? 0.5) * 100, 0, 100, '%', (v) => { ph.lightningVary = v / 100; }));
      wxBody.appendChild(lb);
    }
  }
  panel.appendChild(wxWrap);

  // ── ВІНЬЄТКА ─────────────────────────────────────────────────────────────
  const vigEn = !!(atm.vignette?.enabled);
  const { wrap: vigWrap, body: vigBody, setOpen: vigOpen } = makeSection('Віньєтка', vigEn, (en) => {
    if (!atm.vignette) atm.vignette = { enabled: en, strength: 0.6, blend: 'multiply', color: '#000000' };
    else atm.vignette.enabled = en;
  });
  if (atm.vignette?.enabled) {
    vigOpen(true);
    const vig = atm.vignette;
    vigBody.appendChild(mkRangeAbs('Сила', (vig.strength ?? 0.6) * 100, 0, 100, '%', (v) => { vig.strength = v / 100; }));
    vigBody.appendChild(mkRangeAbs('Верх', Math.round((vig.top ?? 0.5) * 100), 0, 98, '%', (v) => { vig.top = v / 100; }));
    vigBody.appendChild(mkBlendSelect(vig.blend ?? 'multiply', (v) => { vig.blend = v; }));
    vigBody.appendChild(mkColorPicker('Колір', vig.color ?? '#000000', (v) => { vig.color = v; }));
  }
  panel.appendChild(vigWrap);

  // ── КОЛЬОРОВИЙ БАЛАНС ────────────────────────────────────────────────────
  const cbEn = !!(atm.colorBalance?.enabled);
  const { wrap: cbWrap, body: cbBody, setOpen: cbOpen } = makeSection('Кольоровий баланс', cbEn, (en) => {
    if (!atm.colorBalance) atm.colorBalance = { enabled: en, brightness: 1, contrast: 1, saturation: 1, hue: 0 };
    else atm.colorBalance.enabled = en;
  });
  if (atm.colorBalance?.enabled) {
    cbOpen(true);
    const cb = atm.colorBalance;
    const pct2 = (v: number, max: number): number => Math.round(v * max);
    cbBody.appendChild(mkRangeAbs('Яскравість', pct2(cb.brightness ?? 1, 100), 0, 200, '%', (v) => { cb.brightness = v / 100; }));
    cbBody.appendChild(mkRangeAbs('Контраст', pct2(cb.contrast ?? 1, 100), 0, 200, '%', (v) => { cb.contrast = v / 100; }));
    cbBody.appendChild(mkRangeAbs('Насиченість', pct2(cb.saturation ?? 1, 100), 0, 200, '%', (v) => { cb.saturation = v / 100; }));
    cbBody.appendChild(mkRangeAbs('Тон (Hue)', cb.hue ?? 0, 0, 360, '°', (v) => { cb.hue = v; }));
    const sepLbl = (t: string): HTMLElement => { const d = document.createElement('div'); d.textContent = t; d.style.cssText = 'color:var(--muted);font-size:11px;margin-top:4px;font-weight:600'; return d; };
    cbBody.appendChild(sepLbl('Тіні'));
    cbBody.appendChild(mkColorPicker('Відтінок', cb.shadowColor ?? '#000033', (v) => { cb.shadowColor = v; }));
    cbBody.appendChild(mkSlider('Сила', cb.shadowStrength ?? 0, 100, (v) => { cb.shadowStrength = v; }));
    cbBody.appendChild(sepLbl('Середні тони'));
    cbBody.appendChild(mkColorPicker('Відтінок', cb.midColor ?? '#003300', (v) => { cb.midColor = v; }));
    cbBody.appendChild(mkSlider('Сила', cb.midStrength ?? 0, 100, (v) => { cb.midStrength = v; }));
    cbBody.appendChild(sepLbl('Світлини'));
    cbBody.appendChild(mkColorPicker('Відтінок', cb.highlightColor ?? '#ffffee', (v) => { cb.highlightColor = v; }));
    cbBody.appendChild(mkSlider('Сила', cb.highlightStrength ?? 0, 100, (v) => { cb.highlightStrength = v; }));
    cbBody.appendChild(sepLbl('Деталізація'));
    cbBody.appendChild(mkSlider('Cavity', cb.cavity ?? 0, 100, (v) => { cb.cavity = v; }));
  }
  panel.appendChild(cbWrap);
}

// Зручний тип для WeatherPhase-параметрів прев'ю (реекспорт для редакторів).
export type { WeatherPhase };
