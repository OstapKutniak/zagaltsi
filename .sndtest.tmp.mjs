import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
const pg = await b.newPage();
pg.on('pageerror', (e) => console.log('PAGEERR:', e.message.slice(0, 130)));
await pg.goto('http://127.0.0.1:5173/studio.html', { waitUntil: 'domcontentloaded' });
const out = await pg.evaluate(async () => {
  const m = await import('/src/sound/ambience.ts');
  const zero = { master: 1 };
  for (const k of m.MIX_KEYS) zero[k] = 0;
  m.startAmbience({ ...zero });
  const an = m.getAnalyser();
  const rms = () => {
    const d = new Uint8Array(an.fftSize);
    an.getByteTimeDomainData(d);
    let s = 0; for (const v of d) { const x = (v - 128) / 128; s += x * x; }
    return Math.sqrt(s / d.length);
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const measure = async (dur, step = 90) => {
    let peak = 0;
    for (let t = 0; t < dur; t += step) { await wait(step); peak = Math.max(peak, rms()); }
    return Math.round(peak * 1000) / 1000;
  };
  const res = {};
  // луп-канали
  for (const k of ['rain', 'fire', 'wind', 'crickets', 'frogs']) {
    m.setMix({ ...zero, [k]: 1 });
    await wait(150);
    res[k] = await measure(1300);
    m.setMix({ ...zero });
    await wait(150);
  }
  // one-shot канали
  const shots = { crow: m.triggerCrow, owl: m.triggerOwl, creak: m.triggerCreak, bell: m.triggerBell, dog: m.triggerDog, thunder: () => m.triggerThunder(60) };
  for (const [k, fn] of Object.entries(shots)) {
    m.setMix({ ...zero, [k]: 1 });
    await wait(80);
    fn();
    res[k] = await measure(k === 'thunder' ? 2500 : k === 'bell' ? 2000 : 1200);
    m.setMix({ ...zero });
    await wait(120);
  }
  m.stopAmbience();
  return res;
});
console.log('peak RMS по каналах (0 = тиша):');
console.log(JSON.stringify(out));
await b.close();
