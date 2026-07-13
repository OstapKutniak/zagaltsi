import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import {
  getDatabase, ref, get, push, set, update, remove, onValue,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js';

// ── FIREBASE ────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: 'AIzaSyBvg2av881ZTi9op-bzwicL70vh2UENItw',
  authDomain: 'horugva-ff8bd.firebaseapp.com',
  databaseURL: 'https://horugva-ff8bd-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'horugva-ff8bd',
  storageBucket: 'horugva-ff8bd.firebasestorage.app',
  messagingSenderId: '1011491870660',
  appId: '1:1011491870660:web:e02210da9c21bb38a5b691',
};
const db = getDatabase(initializeApp(firebaseConfig));
const APP_VERSION = 23; // бампати разом із CACHE у sw.js — клієнти зі старішою версією самі перезавантажаться
// ── ПРОСТІР (space) ─────────────────────────────────────────
// Один код обслуговує кілька родин: /shopping/ — наш простір,
// /shopping-parents/ — батьки. Кожен простір = своя гілка в БД,
// своя PWA і свій service worker; index/sw для батьків генеруються
// на білді з основних (див. vite.config.ts → shoppingSpacesPlugin).
const SPACE = location.pathname.includes('shopping-parents') ? 'shopping-parents' : 'shopping';
// ── PUSH-сповіщення ─────────────────────────────────────────
const WORKER_URL = 'https://shopping-push.priko1isf.workers.dev'; // Cloudflare Worker (поштар пушів)
const VAPID_PUBLIC = 'BDL_rAqfpmJS7p0v1jcUCDHiNTmOAFQI4TT7zll7UfrFUOiEXmMwr8jMb106WwzLJFg21tGxm6cWQ-zTECn4Fsg';
const PUSH_PATH = `${SPACE}/push`;

const CATS_PATH = `${SPACE}/categories`;
const PRODS_PATH = `${SPACE}/products`;
const LIST_PATH = `${SPACE}/list`;
const ARCH_PATH = `${SPACE}/archive`;
const STORES_PATH = `${SPACE}/stores`; // обрані філії для порівняння цін (спільні на два телефони)

// ── ICONS (inline SVG, viewBox 0 0 24 24) ───────────────────
const ICONS = {
  // базові
  tag:'<path d="M3 12l9-9 9 9-9 9z"/><circle cx="12" cy="9" r="1.5" class="fill"/>',
  cart:'<circle cx="9" cy="20" r="1.4" class="fill"/><circle cx="17" cy="20" r="1.4" class="fill"/><path d="M3 4h2l2.5 11h10L20 7H6.5"/>',
  bag:'<path d="M6 8h12l-1 12H7z"/><path d="M9 8a3 3 0 016 0"/>',
  box:'<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
  pencil:'<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  swap:'<path d="M4 9h13l-4-4M20 15H7l4 4"/>',
  trash:'<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
  // їжа
  bowl:'<path d="M3 11h18a9 9 0 01-18 0z"/><path d="M8 11V8M12 11V6.5M16 11V8"/>',
  pasta:'<path d="M4 7.5c2.5-2.2 5.5-2.2 8 0s5.5 2.2 8 0"/><path d="M4 12c2.5-2.2 5.5-2.2 8 0s5.5 2.2 8 0"/><path d="M4 16.5c2.5-2.2 5.5-2.2 8 0s5.5 2.2 8 0"/>',
  egg:'<path d="M12 3c3.5 0 6.5 5 6.5 10a6.5 6.5 0 01-13 0C5.5 8 8.5 3 12 3z"/>',
  milk:'<path d="M8 3h8v3l2 4v9a2 2 0 01-2 2H8a2 2 0 01-2-2v-9l2-4z"/><path d="M6 10h12"/><path d="M8 6h8"/>',
  cereal:'<path d="M3 12h18a9 9 0 01-18 0z"/><circle cx="9" cy="9" r="1" class="fill"/><circle cx="13" cy="8" r="1" class="fill"/><circle cx="16.5" cy="10" r="1" class="fill"/>',
  coffee:'<path d="M4 9h13v6a5 5 0 01-5 5H9a5 5 0 01-5-5z"/><path d="M17 10.5h1.5a2.5 2.5 0 010 5H17"/><path d="M8 6c0-1 1-1.2 1-2.2M12 6c0-1 1-1.2 1-2.2"/>',
  water:'<path d="M9.5 3h5M10.5 3v3M13.5 3v3"/><path d="M10.5 6c-2 2-3.5 3.2-3.5 5.2V19a2 2 0 002 2h6a2 2 0 002-2v-7.8c0-2-1.5-3.2-3.5-5.2z"/><path d="M7 13h10"/>',
  salt:'<path d="M9 9.5h6L16 20H8z"/><path d="M10 9.5V6.5a2 2 0 014 0v3"/><circle cx="11" cy="13" r="0.7" class="fill"/><circle cx="13.2" cy="15" r="0.7" class="fill"/><circle cx="11.4" cy="17" r="0.7" class="fill"/>',
  sugar:'<rect x="4.5" y="12" width="6.5" height="6.5" rx="1"/><rect x="13" y="12" width="6.5" height="6.5" rx="1"/><rect x="8.75" y="5" width="6.5" height="6.5" rx="1"/>',
  bread:'<path d="M3 11c0-2.5 2-4.5 4.5-4.5h9A4.5 4.5 0 0121 11c0 1.2-.7 2.1-1.5 2.5V18h-15v-4.5C3.7 13.1 3 12.2 3 11z"/><path d="M9 6.5L8 11M14.5 6.5l-1 4.5"/>',
  butter:'<rect x="4" y="10" width="16" height="7" rx="1.5"/><path d="M7 10V8.5A1.5 1.5 0 018.5 7h7A1.5 1.5 0 0117 8.5V10"/>',
  cheese:'<path d="M21 9L3 14.5V19h18z"/><circle cx="8" cy="16.5" r="1"/><circle cx="13" cy="15.5" r="1"/><circle cx="17.5" cy="16.5" r="1"/>',
  yogurt:'<path d="M7 8.5h10L15.5 21h-7z"/><ellipse cx="12" cy="8.5" rx="5" ry="1.8"/><path d="M14 5l3-2"/>',
  chicken:'<path d="M12.5 4a6 6 0 016 6c0 3.5-2.8 5.5-6.3 5.2L9.5 18"/><path d="M12.5 4C9 4 6.5 6.5 6.7 10c.2 2.6 2 4.6 5.5 5.2"/><circle cx="6.8" cy="19.2" r="1.5"/><circle cx="9.2" cy="20.4" r="1.5"/>',
  meat:'<ellipse cx="12" cy="12" rx="9" ry="6.5"/><ellipse cx="14.5" cy="12" rx="3" ry="2.2"/>',
  fish:'<path d="M16 12c0 3-3 6-7 6-3.5 0-6-3-7-6 1-3 3.5-6 7-6 4 0 7 3 7 6z"/><path d="M16 12l5.5-4v8z"/><circle cx="6.5" cy="10.8" r="0.9" class="fill"/>',
  sack:'<path d="M7.5 8.5c-2.2 2.8-3.5 5-3.5 7.5a4.5 4.5 0 004.5 4.5h7a4.5 4.5 0 004.5-4.5c0-2.5-1.3-4.7-3.5-7.5"/><path d="M7.5 8.5C7.5 6.6 9.5 5.5 12 5.5s4.5 1.1 4.5 3-2 3-4.5 3-4.5-1.1-4.5-3z"/>',
  grain:'<path d="M7.5 8.5c-2.2 2.8-3.5 5-3.5 7.5a4.5 4.5 0 004.5 4.5h7a4.5 4.5 0 004.5-4.5c0-2.5-1.3-4.7-3.5-7.5"/><path d="M7.5 8.5C7.5 6.6 9.5 5.5 12 5.5s4.5 1.1 4.5 3-2 3-4.5 3-4.5-1.1-4.5-3z"/><circle cx="10" cy="15" r="0.8" class="fill"/><circle cx="14" cy="14.5" r="0.8" class="fill"/><circle cx="12" cy="17.5" r="0.8" class="fill"/>',
  oil:'<path d="M10 3h4v4l2 3v9a2 2 0 01-2 2h-4a2 2 0 01-2-2v-9l2-3z"/><path d="M8 14h8"/>',
  potato:'<ellipse cx="12" cy="12" rx="8.5" ry="6" transform="rotate(-18 12 12)"/><circle cx="9" cy="11" r="0.7" class="fill"/><circle cx="14.5" cy="13.5" r="0.7" class="fill"/><circle cx="12.5" cy="9.5" r="0.7" class="fill"/>',
  onion:'<path d="M12 8c4 0 7 2.6 7 6.2a7 7 0 01-14 0C5 10.6 8 8 12 8z"/><path d="M12 8c-1.4-1.5-1.9-3-1-5M12 8c1.4-1.5 1.9-3 1-5"/><path d="M9.5 14c0 2.6.9 4.6 2.5 6.5 1.6-1.9 2.5-3.9 2.5-6.5"/>',
  garlic:'<path d="M12 6.5c1 2 5.5 3 5.5 8a5.5 5.5 0 01-11 0c0-5 4.5-6 5.5-8z"/><path d="M12 6.5V3.5"/><path d="M12 20v-6.5"/>',
  tomato:'<circle cx="12" cy="13.5" r="7.5"/><path d="M12 6c-1-1.6-2.8-2.2-4.3-1.7C9 5.4 10.2 6 12 6zM12 6c1-1.6 2.8-2.2 4.3-1.7C15 5.4 13.8 6 12 6z"/><path d="M12 6V3.8"/>',
  cucumber:'<rect x="2.5" y="9.7" width="19" height="5" rx="2.5" transform="rotate(-32 12 12)"/><circle cx="9" cy="14" r="0.6" class="fill"/><circle cx="13" cy="11.6" r="0.6" class="fill"/><circle cx="16.4" cy="9.4" r="0.6" class="fill"/>',
  apple:'<path d="M12 7c-4-2-8 1-8 6 0 4 3 8 5.5 8 1 0 1.7-.6 2.5-.6s1.5.6 2.5.6C17 21 20 17 20 13c0-5-4-8-8-6z"/><path d="M12 7c0-2 1-3.5 3-4"/>',
  banana:'<path d="M5.5 4.5l1.8 1C7.3 13 11.5 17.3 19 18l1.2 1.7c-1.2.8-2.7 1.3-4.7 1.3C9 21 4.5 15.5 4.5 8c0-1.4.4-2.6 1-3.5z"/>',
  tea:'<path d="M5.5 10h13v5a5 5 0 01-5 5h-3a5 5 0 01-5-5z"/><path d="M8.5 7c0-1.2 1.2-1.4 1.2-2.6M12 7c0-1.2 1.2-1.4 1.2-2.6M15.5 7c0-1.2 1.2-1.4 1.2-2.6"/>',
  chocolate:'<rect x="5" y="4" width="14" height="16" rx="1.5"/><path d="M12 4v16M5 12h14"/>',
  cookie:'<circle cx="12" cy="12" r="8"/><circle cx="9" cy="10" r="1" class="fill"/><circle cx="14" cy="9" r="1" class="fill"/><circle cx="15" cy="14" r="1" class="fill"/><circle cx="10" cy="15" r="1" class="fill"/>',
  sauce:'<path d="M9.5 8h5l1.5 2.5V19a2 2 0 01-2 2h-4a2 2 0 01-2-2v-8.5z"/><path d="M10.5 8V5.5h3V8"/><path d="M12 3.2v2.3"/>',
  jar:'<rect x="6" y="8" width="12" height="13" rx="2"/><path d="M6 11.5h12"/><path d="M8 8V6.5A1.5 1.5 0 019.5 5h5A1.5 1.5 0 0116 6.5V8"/>',
  sausage:'<rect x="2.5" y="9.5" width="19" height="5.5" rx="2.75" transform="rotate(-24 12 12)"/><path d="M3.5 17.5L2 19M20.5 6.5L22 5"/>',
  // господарче
  spray:'<rect x="7" y="11" width="8" height="10" rx="2"/><path d="M9 11V7.5h4.5l1.5 2"/><path d="M17.5 5.5l2-1.2M18 8.5l2.2.5M18.5 7h2.7"/>',
  dishsoap:'<path d="M10 3.5h4v3l2 3V19a2 2 0 01-2 2h-4a2 2 0 01-2-2V9.5l2-3z"/><circle cx="12" cy="14" r="2.3"/>',
  laundry:'<rect x="5" y="7" width="14" height="14" rx="2"/><path d="M8 7V4.5h8V7"/><circle cx="12" cy="14" r="3.2"/><path d="M9.5 12.8c1.5 1.2 3.5 1.2 5 0"/>',
  sponge:'<rect x="4" y="8" width="16" height="9" rx="2.5"/><circle cx="8.5" cy="11" r="0.8" class="fill"/><circle cx="13" cy="14" r="0.8" class="fill"/><circle cx="16" cy="10.8" r="0.8" class="fill"/>',
  trashbag:'<path d="M9 8.5c-2.8 2.7-4 5.3-4 8a7 7 0 0014 0c0-2.7-1.2-5.3-4-8"/><path d="M9 8.5L8 5M15 8.5L16 5"/><path d="M9 8.5h6"/>',
  paper:'<ellipse cx="10" cy="8" rx="6.5" ry="4.5"/><ellipse cx="10" cy="8" rx="2.2" ry="1.5"/><path d="M3.5 8v8c0 2.5 3 4.5 6.5 4.5s6.5-2 6.5-4.5V8"/><path d="M16.5 13H21v5h-4"/>',
  napkin:'<rect x="4" y="9" width="16" height="10" rx="1.5"/><path d="M4 12h16"/><path d="M8 9L12 5l4 4"/>',
  broom:'<path d="M13.5 3l-3 9.5"/><path d="M10.5 12.5c-2.5 1.5-4 4-5 8.5 4.5-.5 7.5-1.5 9.5-4z"/><path d="M10.5 12.5l4.5 4.5"/>',
  bucket:'<path d="M5 8h14l-1.5 12h-11z"/><path d="M5 8a7 4 0 0114 0"/>',
  bulb:'<path d="M9 18c-.5-2.5-3-3.5-3-7a6 6 0 0112 0c0 3.5-2.5 4.5-3 7z"/><path d="M9.5 21h5"/>',
  battery:'<rect x="3" y="8" width="16" height="8" rx="2"/><path d="M21 11v2"/><path d="M7 11v2M11 11v2"/>',
  // ліки
  pill:'<rect x="2.5" y="8.5" width="19" height="7" rx="3.5"/><path d="M12 8.5v7"/>',
  pills:'<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9.3" cy="9.3" r="1" class="fill"/><circle cx="14.7" cy="9.3" r="1" class="fill"/><circle cx="9.3" cy="14.7" r="1" class="fill"/><circle cx="14.7" cy="14.7" r="1" class="fill"/>',
  health:'<rect x="4" y="4" width="16" height="16" rx="5"/><path d="M12 9v6M9 12h6"/>',
  vitamins:'<rect x="6" y="7" width="12" height="14" rx="2"/><path d="M8 7V4.5h8V7"/><circle cx="10" cy="13" r="1" class="fill"/><circle cx="14" cy="15.5" r="1" class="fill"/><circle cx="13" cy="11" r="1" class="fill"/>',
  bandage:'<g transform="rotate(-25 12 12)"><rect x="2.5" y="8.5" width="19" height="7" rx="3.5"/><circle cx="10.5" cy="12" r="0.7" class="fill"/><circle cx="13.5" cy="12" r="0.7" class="fill"/><circle cx="12" cy="10.5" r="0.7" class="fill"/><circle cx="12" cy="13.5" r="0.7" class="fill"/></g>',
  thermometer:'<path d="M10 13.5V5a2 2 0 014 0v8.5a4.5 4.5 0 11-4 0z"/><circle cx="12" cy="17.5" r="1.5" class="fill"/>',
  drops:'<path d="M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z"/>',
  syrup:'<path d="M9 9h6l1 2v8a2 2 0 01-2 2h-4a2 2 0 01-2-2v-8z"/><path d="M10 9V6h4v3"/><path d="M12 13v4M10 15h4"/>',
  // гігієна
  toothpaste:'<path d="M8 9h8v10a2 2 0 01-2 2h-4a2 2 0 01-2-2z"/><path d="M8 9V6h8v3"/><path d="M10 6V3.5h4V6"/><path d="M10 13h4"/>',
  toothbrush:'<path d="M4 20L15 9"/><path d="M15 9l4.5-4.5"/><path d="M15.8 5.2l1.6 1.6M17.5 3.5l1.6 1.6M14 7l1.6 1.6"/>',
  shampoo:'<rect x="8" y="9" width="8" height="12" rx="2"/><path d="M10 9V6.5h4V9M12 6.5v-2h3.5"/><path d="M10 14h4"/>',
  showergel:'<path d="M8 21V11.5a4 4 0 018 0V21z"/><path d="M10 7.5h4v-2h-4z"/><path d="M8 16h8"/>',
  deo:'<rect x="8" y="8.5" width="8" height="12.5" rx="2"/><path d="M8 8.5c0-4.5 8-4.5 8 0"/><path d="M10 5h4"/>',
  soap:'<rect x="4" y="10" width="16" height="8.5" rx="4.25"/><circle cx="16" cy="5.5" r="1.3"/><circle cx="12" cy="4" r="0.8"/>',
  razor:'<rect x="7" y="3" width="10" height="4.5" rx="1.5"/><path d="M9.5 7.5v2M14.5 7.5v2M12 7.5v2"/><path d="M10.5 9.5h3l-.8 9.5c0 1-.4 1.5-.7 1.5s-.7-.5-.7-1.5z"/>',
  cotton:'<circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/>',
  pads:'<rect x="8" y="3" width="8" height="18" rx="4"/><path d="M8 9H5.5a1.5 1.5 0 000 3H8M16 12h2.5a1.5 1.5 0 000-3H16"/>',
  cream:'<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M5 13h14"/><path d="M7 10V8.5A1.5 1.5 0 018.5 7h7A1.5 1.5 0 0117 8.5V10"/>',
  perfume:'<rect x="7.5" y="10" width="9" height="11" rx="2.5"/><path d="M10.5 10V8h3v2"/><path d="M10.5 5.5h3"/><path d="M17.5 6.5l2-1M18 9l2.2.3"/>',
};
const ic = k => `<svg viewBox="0 0 24 24">${ICONS[k] || ICONS.tag}</svg>`;

const COLORS = [
  '#2D9CDB','#2F80ED','#6a5ae0','#9B51E0','#EB5C8B','#eb3b7e','#EB5757','#F2994A',
  '#F2C94C','#9E9D24','#27AE60','#1ABC9C','#4CAF7D','#5D4037','#607D8B','#9E9E9E',
];

// ── DEFAULTS (сідяться в базу при першому запуску) ──────────
const DEFAULT_CATS = {
  food:    { name: 'Їжа',        color: '#2D9CDB', icon: 'bowl',   order: 0 },
  house:   { name: 'Господарче', color: '#F2994A', icon: 'spray',  order: 1 },
  meds:    { name: 'Ліки',       color: '#1ABC9C', icon: 'health', order: 2 },
  hygiene: { name: 'Гігієна',    color: '#EB5C8B', icon: 'soap',   order: 3 },
};
const DEFAULT_PRODS = [
  // Їжа
  ['food','Макарони','pasta'],['food','Яйця','egg'],['food','Молоко','milk'],['food','Кранч','cereal'],
  ['food','Кава','coffee'],['food','Вода','water'],['food','Сіль','salt'],['food','Цукор','sugar'],
  ['food','Хліб','bread'],['food','Масло','butter'],['food','Сир','cheese'],['food','Йогурт','yogurt'],
  ['food','Сметана','jar'],['food','Курка','chicken'],['food','Фарш','meat'],['food','Риба','fish'],
  ['food','Ковбаса','sausage'],['food','Рис','sack'],['food','Гречка','grain'],['food','Борошно','sack'],
  ['food','Олія','oil'],['food','Картопля','potato'],['food','Цибуля','onion'],['food','Часник','garlic'],
  ['food','Помідори','tomato'],['food','Огірки','cucumber'],['food','Яблука','apple'],['food','Банани','banana'],
  ['food','Чай','tea'],['food','Шоколад','chocolate'],['food','Печиво','cookie'],['food','Кетчуп','sauce'],
  ['food','Майонез','sauce'],
  // Господарче
  ['house','Засіб для посуду','dishsoap'],['house','Засіб для прання','laundry'],['house','Губки','sponge'],
  ['house','Пакети для сміття','trashbag'],['house','Туалетний папір','paper'],['house','Серветки','napkin'],
  ['house','Засіб для підлоги','bucket'],['house','Засіб для скла','spray'],['house','Лампочки','bulb'],
  ['house','Батарейки','battery'],
  // Ліки
  ['meds','Знеболювальне','pill'],['meds','Вітаміни','vitamins'],['meds','Пластир','bandage'],
  ['meds','Краплі','drops'],['meds','Сироп','syrup'],
  // Гігієна
  ['hygiene','Зубна паста','toothpaste'],['hygiene','Зубна щітка','toothbrush'],['hygiene','Шампунь','shampoo'],
  ['hygiene','Гель для душу','showergel'],['hygiene','Дезодорант','deo'],['hygiene','Мило','soap'],
  ['hygiene','Бритви','razor'],['hygiene','Ватні диски','cotton'],['hygiene','Прокладки','pads'],
  ['hygiene','Крем','cream'],
];

// ── STATE ──────────────────────────────────────────────────
let cats = {};      // id → {name,color,icon,order}
let prods = {};     // id → {name,icon,cat,order}
let listMap = {};   // id → {pid,name,icon,cat,ts,done,doneTs,day,archDay,archKey}
let archMap = {};   // 'YYYY-MM-DD' → { key → {name,icon,catName,catColor,catIcon,ts} }
let state = { tab: 'list' };
let collapsedCats = new Set();
let addCurCat = null;       // активна категорія в шторці додавання
let addEditMode = false;
let addSearch = '';
let addSelect = null;       // null = звичайний режим; Set(pid) = мультивибір (затиск)
let openActionsId = null;   // позиція списку з відкритими діями (затиск)
let catFormId = null;       // null = нова
let catFormSel = { color: COLORS[0], icon: 'tag' };
let prodFormId = null;
let prodFormSel = { icon: 'tag', cat: null };
let renderTimer = null;
const SWIPE_TABS = ['list', 'add', 'archive'];
const MONTHS = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
const MONTHS_GEN = ['січня','лютого','березня','квітня','травня','червня','липня','серпня','вересня','жовтня','листопада','грудня'];
const WEEKDAYS_SHORT = ['нд','пн','вт','ср','чт','пт','сб'];

const $ = id => document.getElementById(id);
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const catOf = item => cats[item.cat] || { name: 'Інше', color: '#9E9E9E', icon: 'tag' };

// ── INIT ───────────────────────────────────────────────────
let swReg = null;
document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator)
    navigator.serviceWorker.register(`/zagaltsi/${SPACE}/sw.js`, { scope: `/zagaltsi/${SPACE}/` })
      .then(r => { swReg = r; refreshPushSub(); }).catch(() => {});
  // iOS тримає PWA замороженим — при поверненні у форграунд перевіряємо оновлення SW
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { flushNotify(); return; } // згорнули додаток — одразу шлемо накопичене
    if (swReg) swReg.update().catch(() => {});
    refreshListOrder(); // повернення в додаток = свіже пересортування
    renderList();
  });
  window.addEventListener('pagehide', flushNotify);
  initSwipeLayout();
  initSheetDrag();
  initPricePanel();
  bindEvents();
  seedIfEmpty().finally(subscribe);
  renderAll();
  updateTabs(); // показати цінову панель на стартовій вкладці «Список»
  // перевірка зміни дня раз на хвилину — опівночі куплене йде зі списку
  setInterval(purgeOldDone, 60000);
});

async function seedIfEmpty() {
  try {
    const snap = await get(ref(db, CATS_PATH));
    if (snap.exists()) return;
    const prodObj = {};
    DEFAULT_PRODS.forEach(([cat, name, icon], i) => {
      prodObj[`p${String(i).padStart(3,'0')}`] = { name, icon, cat, order: i };
    });
    await update(ref(db, SPACE), { categories: DEFAULT_CATS, products: prodObj });
  } catch (e) { console.warn('seed failed', e); }
}

// ── SYNC ───────────────────────────────────────────────────
function subscribe() {
  // автооновлення: хтось із новішою версією підняв {space}/meta/version → старі клієнти перезавантажуються
  onValue(ref(db, `${SPACE}/meta/version`), s => {
    const v = s.val() || 0;
    if (v > APP_VERSION) {
      const last = +sessionStorage.getItem('verReload') || 0;
      if (Date.now() - last > 60000) {
        sessionStorage.setItem('verReload', String(Date.now()));
        swReg?.update().catch(() => {});
        setTimeout(() => location.reload(), 400);
      }
    } else if (v < APP_VERSION) {
      set(ref(db, `${SPACE}/meta/version`), APP_VERSION).catch(() => {});
    }
  });
  onValue(ref(db, CATS_PATH), s => { cats = s.val() || {}; scheduleRender(); });
  onValue(ref(db, PRODS_PATH), s => { prods = s.val() || {}; scheduleRender(); });
  onValue(ref(db, LIST_PATH), s => {
    listMap = s.val() || {};
    if (!listOrder) refreshListOrder(); // перший прихід даних — фіксуємо порядок
    purgeOldDone();
    scheduleRender();
  });
  onValue(ref(db, ARCH_PATH), s => { archMap = s.val() || {}; scheduleRender(); });
  onValue(ref(db, STORES_PATH), s => { storeSel = s.val() || {}; renderStoresSheet(); ppFetchKey = ''; refreshPrices(); });
  // індикатор з'єднання з базою (зелена/червона крапка в налаштуваннях)
  onValue(ref(db, '.info/connected'), s => {
    const ok = !!s.val();
    const dot = $('sync-dot'), sub = $('sync-sub');
    if (dot) dot.style.background = ok ? 'var(--done)' : 'var(--danger)';
    if (sub) sub.textContent = ok ? 'Онлайн · база доступна' : 'Немає з’єднання з базою!';
  });
}
function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(renderAll, 80); }

// куплене вчора (і раніше) зникає зі списку; в архіві залишається
function purgeOldDone() {
  const today = dayKey();
  const upd = {};
  Object.entries(listMap).forEach(([id, it]) => {
    if (it.done && it.day && it.day < today) upd[id] = null;
  });
  if (Object.keys(upd).length) update(ref(db, LIST_PATH), upd).catch(() => {});
}

// ── PUSH: підписка і надсилання подій ──────────────────────
function deviceId() {
  let id = localStorage.getItem('shop-device');
  if (!id) { id = 'd' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); localStorage.setItem('shop-device', id); }
  return id;
}
const b64uToU8 = s => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, c => c.charCodeAt(0));
};

async function enableNotifications() {
  if (!('Notification' in window) || !('PushManager' in window)) {
    toast('Сповіщення працюють лише з іконки на екрані «Домів»'); return;
  }
  try {
    const reg = swReg || await navigator.serviceWorker.ready;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Дозвіл на сповіщення не надано'); renderNotifyRow(); return; }
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToU8(VAPID_PUBLIC) });
    await set(ref(db, `${PUSH_PATH}/${deviceId()}`), {
      sub: JSON.stringify(sub.toJSON()),
      ua: navigator.userAgent.slice(0, 90),
      ts: Date.now(),
    });
    toast('Сповіщення увімкнено');
  } catch (e) {
    toast('Не вдалося увімкнути сповіщення');
    console.warn('push subscribe failed', e);
  }
  renderNotifyRow();
}
async function renderNotifyRow() {
  const sub = $('notify-sub');
  if (!sub) return;
  if (!('Notification' in window) || !('PushManager' in window)) { sub.textContent = 'Доступно лише в додатку з екрана «Домів»'; return; }
  if (Notification.permission === 'granted') {
    const s = await (swReg || await navigator.serviceWorker.ready).pushManager.getSubscription().catch(() => null);
    let devices = '';
    try {
      const snap = await get(ref(db, PUSH_PATH));
      const n = snap.exists() ? Object.keys(snap.val()).length : 0;
      devices = ` · у базі ${n} ${plural(n, 'пристрій', 'пристрої', 'пристроїв')}`;
    } catch {}
    sub.textContent = (s ? 'Увімкнено на цьому пристрої' : 'Натисни, щоб увімкнути') + devices;
  } else if (Notification.permission === 'denied') {
    sub.textContent = 'Заборонено в налаштуваннях iOS';
  } else sub.textContent = 'Натисни, щоб увімкнути';
}

// iOS може мовчки «загубити»/ротувати підписку між запусками — тоді в базі
// лишається мертвий endpoint, воркер його чистить, і слати стає нікому.
// Тому на кожному запуску (якщо дозвіл уже є) пересубскрибаємось і
// перезаписуємо свіжу підписку в базу. Без дозволу — нічого не робимо.
async function refreshPushSub() {
  if (!('Notification' in window) || !('PushManager' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const reg = swReg || await navigator.serviceWorker.ready;
    let s = await reg.pushManager.getSubscription();
    // підписка під чужий/старий серверний ключ — Apple відхилить JWT, перевипускаємо
    try {
      const cur = s?.options?.applicationServerKey && new Uint8Array(s.options.applicationServerKey);
      const want = b64uToU8(VAPID_PUBLIC);
      if (cur && (cur.length !== want.length || cur.some((b, i) => b !== want[i]))) {
        await s.unsubscribe().catch(() => {});
        s = null;
      }
    } catch {}
    if (!s) s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToU8(VAPID_PUBLIC) });
    await set(ref(db, `${PUSH_PATH}/${deviceId()}`), {
      sub: JSON.stringify(s.toJSON()),
      ua: navigator.userAgent.slice(0, 90),
      ts: Date.now(),
    });
  } catch (e) { console.warn('push refresh failed', e); }
}

// тестовий пуш: воркер шле на всі пристрої, крім цього — результат у підпис рядка
async function testPush() {
  const sub = $('testpush-sub');
  sub.textContent = 'Надсилаю…';
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      body: JSON.stringify({ event: 'test', names: ['Перевірка зв’язку — все працює'], from: deviceId(), space: SPACE }),
    });
    const j = await res.json();
    if (j.errors?.length) sub.textContent = ('Помилка: ' + j.errors[0]).slice(0, 140);
    else if (!j.sent) sub.textContent = `Надіслано 0 — інший телефон не підписаний${j.dead ? ` (мертвих підписок прибрано: ${j.dead})` : ''}`;
    else sub.textContent = `Надіслано на ${j.sent} ${plural(j.sent, 'пристрій', 'пристрої', 'пристроїв')} — глянь інший телефон`;
  } catch (e) {
    sub.textContent = 'Воркер недоступний: ' + e.message;
  }
}

// черга подій: збираємо кілька дій в одне сповіщення (8с тиші або згортання)
let notifyQueue = { added: [], bought: [] };
let notifyTimer = null;
function queueNotify(kind, name) {
  if (!WORKER_URL) return;
  notifyQueue[kind].push(name);
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(flushNotify, 8000);
}
function unqueueNotify(kind, name) {
  const i = notifyQueue[kind].indexOf(name);
  if (i >= 0) notifyQueue[kind].splice(i, 1);
}
function flushNotify() {
  clearTimeout(notifyTimer);
  const q = notifyQueue;
  notifyQueue = { added: [], bought: [] };
  ['added', 'bought'].forEach(kind => {
    if (!q[kind].length || !WORKER_URL) return;
    const payload = JSON.stringify({ event: kind, names: q[kind], from: deviceId(), space: SPACE });
    if (navigator.sendBeacon) navigator.sendBeacon(WORKER_URL, payload);
    else fetch(WORKER_URL, { method: 'POST', body: payload }).catch(() => {});
  });
}

// ── LIST ACTIONS ───────────────────────────────────────────
const listEntryFor = pid => Object.entries(listMap).find(([, it]) => it.pid === pid && !it.done);
function addToList(pid, { silent } = {}) {
  const p = prods[pid];
  if (!p) return false;
  if (listEntryFor(pid)) { if (!silent) toast(`«${p.name}» вже у списку`); return false; }
  const item = { pid, name: p.name, icon: p.icon, cat: p.cat, ts: Date.now(), done: false };
  set(push(ref(db, LIST_PATH)), item);
  queueNotify('added', p.name);
  return true;
}
function removeFromList(id) {
  const it = listMap[id];
  if (it) {
    unqueueNotify('added', it.name);
    // явне видалення прибирає і слід в архіві (на відміну від опівнічного очищення)
    if (it.done && it.archDay && it.archKey)
      remove(ref(db, `${ARCH_PATH}/${it.archDay}/${it.archKey}`)).catch(() => {});
  }
  remove(ref(db, `${LIST_PATH}/${id}`));
}

// Без await: локальна луна Firebase застосовується синхронно, тож список
// оновлюється миттєво; підтвердження сервера не чекаємо (воно доганяє само).
function toggleDone(id) {
  const it = listMap[id];
  if (!it) return;
  if (!it.done) {
    const c = catOf(it);
    const day = dayKey();
    const archRef = push(ref(db, `${ARCH_PATH}/${day}`));
    set(archRef, { name: it.name, icon: it.icon, catName: c.name, catColor: c.color, catIcon: c.icon, ts: Date.now() }).catch(() => {});
    update(ref(db, `${LIST_PATH}/${id}`), { done: true, doneTs: Date.now(), day, archDay: day, archKey: archRef.key }).catch(() => {});
    queueNotify('bought', it.name);
  } else {
    if (it.archDay && it.archKey) remove(ref(db, `${ARCH_PATH}/${it.archDay}/${it.archKey}`)).catch(() => {});
    update(ref(db, `${LIST_PATH}/${id}`), { done: false, doneTs: null, day: null, archDay: null, archKey: null }).catch(() => {});
    unqueueNotify('bought', it.name);
  }
}

// ── RENDER ─────────────────────────────────────────────────
function renderAll() {
  renderHeader();
  renderList();
  renderArchive();
  if (state.tab === 'add') { renderAddChips(); renderAddGrid(); }
}

function renderHeader() {
  const remaining = Object.values(listMap).filter(it => !it.done).length;
  $('total-amount').innerHTML = `${remaining} <span>${plural(remaining, 'позиція', 'позиції', 'позицій')}</span>`;
  $('total-label').textContent = remaining ? 'Треба купити' : 'Все куплено';
}
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function sortedCats() {
  return Object.entries(cats).sort((a, b) => (a[1].order ?? 99) - (b[1].order ?? 99));
}

// «Заморожений» порядок списку: галочка не кидає продукт одразу вниз —
// пересортування (куплене в кінець) відбувається лише при refreshListOrder():
// відкриття додатка, перемикання вкладки; при згортанні категорії порядок
// оновлюється, але застосується при наступному перемальовуванні (щоб не
// обривати CSS-анімацію згортання).
let listOrder = null; // Map id → ранг
function refreshListOrder() {
  const items = Object.entries(listMap).map(([id, it]) => ({ id, ...it }));
  items.sort((a, b) => (a.done - b.done) || (a.ts - b.ts));
  listOrder = new Map(items.map((it, i) => [it.id, i]));
}
// нові/невідомі позиції — в кінець своєї категорії (куплені після активних)
const listRank = it => listOrder?.has(it.id)
  ? listOrder.get(it.id)
  : 1e9 + (it.done ? 5e8 : 0) + it.ts / 1e6;

function renderList() {
  const wrap = $('list-wrap');
  const items = Object.entries(listMap).map(([id, it]) => ({ id, ...it }));
  if (!items.length) {
    wrap.innerHTML = `<div class="empty">${ic('cart')}<div>Список порожній.<br>Натисни + внизу, щоб додати покупки.</div></div>`;
    refreshPrices();
    return;
  }
  const byCat = new Map();
  items.forEach(it => {
    const k = cats[it.cat] ? it.cat : '_other';
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k).push(it);
  });
  const order = sortedCats().map(([id]) => id).filter(id => byCat.has(id));
  if (byCat.has('_other')) order.push('_other');

  let html = '';
  order.forEach(cid => {
    const c = cats[cid] || { name: 'Інше', color: '#9E9E9E', icon: 'tag' };
    const arr = byCat.get(cid);
    arr.sort((a, b) => listRank(a) - listRank(b));
    const remaining = arr.filter(i => !i.done).length;
    const collapsed = collapsedCats.has(cid);
    html += `<div class="lcat ${collapsed ? 'collapsed' : ''} ${remaining ? '' : 'alldone'}" data-cid="${cid}">
      <div class="lcat-head" data-cid="${cid}">
        <div class="lcat-ic" style="--c:${c.color}">${ic(c.icon)}</div>
        <div class="lcat-name">${esc(c.name)}</div>
        <div class="lcat-count ${remaining ? '' : 'alldone'}" style="--c:${c.color}">${remaining || '✓'}</div>
        <span class="lcat-chevron">▼</span>
      </div>
      <div class="lcat-items"><div class="lcat-items-in">` +
      arr.map(it => {
        const sub = [it.variant, it.place].filter(Boolean).join(' · ');
        return `
        <div class="litem ${it.done ? 'done' : ''} ${it.id === openActionsId ? 'open' : ''}" data-id="${it.id}">
          <div class="litem-ic" style="--c:${c.color}">${ic(it.icon)}</div>
          <div class="litem-name">${esc(it.name)}${sub ? `<div class="litem-sub">${esc(sub)}</div>` : ''}</div>
          <div class="litem-actions">
            <button class="lact lact-edit" data-id="${it.id}" title="Уточнити">${ic('pencil')}</button>
            <button class="lact lact-swap" data-id="${it.id}" title="Замінити">${ic('swap')}</button>
            <button class="lact lact-del" data-id="${it.id}" title="Видалити">${ic('trash')}</button>
          </div>
          <button class="litem-check" data-id="${it.id}"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></button>
        </div>`;
      }).join('') +
      `</div></div></div>`;
  });
  wrap.innerHTML = html;

  // закрити кнопки дій без перемальовування — інакше CSS-анімація виїзду обривається
  const closeActions = () => {
    wrap.querySelectorAll('.litem.open').forEach(r => r.classList.remove('open'));
    openActionsId = null;
  };
  wrap.querySelectorAll('.lcat-head').forEach(el => {
    el.addEventListener('click', () => {
      const cid = el.dataset.cid;
      collapsedCats.has(cid) ? collapsedCats.delete(cid) : collapsedCats.add(cid);
      refreshListOrder(); // куплене осяде вниз при наступному перемальовуванні
      // без renderList: клас перемикається на живому DOM, щоб CSS плавно згорнув висоту
      el.parentElement.classList.toggle('collapsed', collapsedCats.has(cid));
    });
    // затиск заголовка → барабан цін перемикається на магазини цієї категорії
    // (клік-згортання після затиску глушиться глобально через lpUntil)
    longPress(el, () => setPpCat(el.dataset.cid));
  });
  wrap.querySelectorAll('.litem-check').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation();
    // оптимістичний відгук: рядок сіріє/зеленіє миттєво, база доганяє
    const row = el.closest('.litem');
    row.classList.toggle('done');
    const cat = row.closest('.lcat');
    cat.classList.toggle('alldone', !cat.querySelector('.litem:not(.done)'));
    const svg = el.querySelector('svg');
    svg.style.animation = 'none'; svg.offsetWidth;
    svg.style.animation = 'popIn 0.3s ease-out both';
    toggleDone(el.dataset.id);
  }));
  wrap.querySelectorAll('.litem').forEach(row => {
    const id = row.dataset.id;
    row.addEventListener('click', () => {
      if (openActionsId) { closeActions(); return; }
      openItemSheet(id);
    });
    longPress(row, () => {
      const wasOpen = openActionsId === id;
      closeActions();
      if (!wasOpen) { openActionsId = id; row.classList.add('open'); }
    });
  });
  wrap.querySelectorAll('.lact-edit').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); closeActions(); openItemSheet(b.dataset.id);
  }));
  wrap.querySelectorAll('.lact-swap').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); closeActions(); openReplaceSheet(b.dataset.id);
  }));
  wrap.querySelectorAll('.lact-del').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); closeActions(); removeFromList(b.dataset.id);
  }));
  refreshPrices(); // оновити ціни/полоски після перемальовування списку
}

// ── ITEM DETAIL (уточнення) ────────────────────────────────
let itemSheetId = null;
function openItemSheet(id) {
  const it = listMap[id];
  if (!it) return;
  itemSheetId = id;
  const c = catOf(it);
  $('item-title').innerHTML = `<span class="sheet-item-ic" style="--c:${c.color};display:inline-flex;vertical-align:middle;margin-right:8px">${ic(it.icon)}</span>${esc(it.name)}`;
  $('item-which').textContent = `${whichWord(it.name)} саме`;
  $('item-variant').value = it.variant || '';
  $('item-place').value = it.place || '';
  $('item-overlay').classList.add('open');
  renderVariantSuggest(it.name);
}
// підказки реальних варіантів товару (з Сільпо) — тап підставляє в «Яке саме»
async function renderVariantSuggest(name) {
  const box = $('item-suggest');
  if (!box) return;
  box.innerHTML = '';
  const s = STORE_SETS.food.find(x => x.key === 'silpo');
  try {
    const r = await fetch(`${WORKER_PRICE}/suggest?chain=silpo&branch=${encodeURIComponent(branchOf(s))}&q=${encodeURIComponent(name)}`);
    const names = await r.json();
    if (!Array.isArray(names) || !itemSheetId) return;
    const base = name.trim().toLowerCase().slice(0, 5);
    box.innerHTML = names.slice(0, 8).map(full => {
      const parts = String(full).split(/\s+/);
      // прибрати провідне узагальнене слово: «Молоко Яготинське…» → «Яготинське…»
      const v = (parts[0] && parts[0].toLowerCase().slice(0, 5) === base) ? parts.slice(1).join(' ') : full;
      return `<button class="vsug" data-v="${esc(v)}">${esc(v)}</button>`;
    }).join('');
    box.querySelectorAll('.vsug').forEach(b =>
      b.addEventListener('click', () => { $('item-variant').value = b.dataset.v; }));
  } catch {}
}
function saveItemSheet() {
  if (!itemSheetId) return;
  // шторка їде вниз одразу, запис у базу доганяє у фоні
  update(ref(db, `${LIST_PATH}/${itemSheetId}`), {
    variant: $('item-variant').value.trim() || null,
    place: $('item-place').value.trim() || null,
  }).catch(() => {});
  $('item-overlay').classList.remove('open');
}

// ── REPLACE (заміна іншим продуктом) ───────────────────────
// Сітка як у додаванні: алфавіт + пошук. Без пошуку — своя категорія,
// з пошуком — по всіх продуктах.
let replaceItemId = null;
function openReplaceSheet(id) {
  const it = listMap[id];
  if (!it) return;
  replaceItemId = id;
  $('replace-title').textContent = `Замінити «${it.name}»`;
  $('replace-search').value = '';
  renderReplaceGrid();
  $('replace-overlay').classList.add('open');
}
function renderReplaceGrid() {
  const it = listMap[replaceItemId];
  if (!it) return;
  const q = $('replace-search').value.trim().toLowerCase();
  let entries = Object.entries(prods).filter(([pid]) => pid !== it.pid && !listEntryFor(pid));
  entries = q
    ? entries.filter(([, p]) => p.name.toLowerCase().includes(q))
    : entries.filter(([, p]) => p.cat === it.cat);
  entries.sort((a, b) => a[1].name.localeCompare(b[1].name, 'uk'));
  $('replace-grid').innerHTML = entries.map(([pid, p]) => {
    const c = cats[p.cat] || { color: '#9E9E9E' };
    return `<button class="ptile" data-pid="${pid}">
      <div class="ptile-circle" style="--c:${c.color}">${ic(p.icon)}</div>
      <div class="ptile-name">${esc(p.name)}</div>
    </button>`;
  }).join('') || '<div class="empty" style="grid-column:1/-1">Нічого не знайдено</div>';
  $('replace-grid').querySelectorAll('.ptile[data-pid]').forEach(tile =>
    tile.addEventListener('click', () => {
      const p = prods[tile.dataset.pid];
      const it = listMap[replaceItemId];
      if (p && it) {
        update(ref(db, `${LIST_PATH}/${replaceItemId}`), { pid: tile.dataset.pid, name: p.name, icon: p.icon, cat: p.cat }).catch(() => {});
        // якщо товар уже куплений — оновлюємо і його запис в архіві (ts лишається)
        if (it.done && it.archDay && it.archKey) {
          const c = cats[p.cat] || { name: 'Інше', color: '#9E9E9E', icon: 'tag' };
          update(ref(db, `${ARCH_PATH}/${it.archDay}/${it.archKey}`),
            { name: p.name, icon: p.icon, catName: c.name, catColor: c.color, catIcon: c.icon }).catch(() => {});
        }
        toast(`Замінено на «${p.name}»`);
      }
      $('replace-overlay').classList.remove('open');
    }));
}

// ── КАЛЕНДАР АРХІВУ (барабан: скролиш «Липень 2026» — архів їде сам) ──
const DRUM_ROW = 44; // висота рядка барабана, синхронно зі style.css
let drumMonths = [];          // 'YYYY-MM', новіші згори
let drumScrollTimer = null;
let drumIgnoreScroll = false; // програмна установка скролу не сіпає архів

function toggleCalDrum() {
  const ov = $('cal-drum-overlay');
  if (ov.classList.contains('open')) { closeCalDrum(); return; }
  drumMonths = [...new Set(Object.keys(archMap).map(d => d.slice(0, 7)))].sort().reverse();
  if (!drumMonths.length) { toast('Архів порожній'); return; }
  const sc = $('cal-drum-scroll');
  sc.innerHTML = drumMonths.map(mk => {
    const [y, m] = mk.split('-').map(Number);
    return `<div class="drum-item" data-mk="${mk}">${MONTHS[m - 1]} ${y}</div>`;
  }).join('');
  // тап по сусідньому місяцю докручує барабан до нього
  sc.querySelectorAll('.drum-item').forEach((el, i) =>
    el.addEventListener('click', () => sc.scrollTo({ top: i * DRUM_ROW, behavior: 'smooth' })));
  ov.classList.add('open');
  // стартуємо з місяця, який зараз видно вгорі архіву
  const idx = Math.max(0, drumMonths.indexOf(topVisibleMonth()));
  drumIgnoreScroll = true;
  sc.scrollTop = idx * DRUM_ROW;
  markDrumSel(idx);
  requestAnimationFrame(() => { drumIgnoreScroll = false; });
}
function closeCalDrum() { $('cal-drum-overlay').classList.remove('open'); }

function topVisibleMonth() {
  const scr = $('archive-screen');
  let cur = null;
  document.querySelectorAll('#arch-wrap .arch-month').forEach(h => {
    if (cur === null || h.offsetTop <= scr.scrollTop + 60) cur = h.dataset.mk;
  });
  return cur;
}
function markDrumSel(idx) {
  $('cal-drum-scroll').querySelectorAll('.drum-item').forEach((el, i) => el.classList.toggle('sel', i === idx));
}
function onDrumScroll() {
  if (drumIgnoreScroll) return;
  const sc = $('cal-drum-scroll');
  const idx = Math.max(0, Math.min(drumMonths.length - 1, Math.round(sc.scrollTop / DRUM_ROW)));
  markDrumSel(idx);
  clearTimeout(drumScrollTimer);
  drumScrollTimer = setTimeout(() => {
    const head = document.querySelector(`#arch-wrap .arch-month[data-mk="${drumMonths[idx]}"]`);
    if (head) $('archive-screen').scrollTo({ top: Math.max(0, head.offsetTop - 6), behavior: 'smooth' });
  }, 120);
}

function renderArchive() {
  const wrap = $('arch-wrap');
  const days = Object.keys(archMap).sort().reverse();
  if (!days.length) {
    wrap.innerHTML = `<div class="empty">${ic('box')}<div>Архів порожній.<br>Куплене з галочкою з'являтиметься тут по днях.</div></div>`;
    return;
  }
  // групуємо по місяцях
  const byMonth = new Map();
  days.forEach(d => {
    const mk = d.slice(0, 7);
    if (!byMonth.has(mk)) byMonth.set(mk, []);
    byMonth.get(mk).push(d);
  });
  let html = '';
  byMonth.forEach((ds, mk) => {
    const [y, m] = mk.split('-').map(Number);
    html += `<div class="arch-month" data-mk="${mk}">${MONTHS[m-1]} ${y}</div><div class="arch-grid">` +
      ds.map(d => {
        const cnt = Object.keys(archMap[d] || {}).length;
        const dt = new Date(d + 'T12:00:00');
        return `<button class="arch-day" data-day="${d}">
          <div class="arch-circle">${dt.getDate()}</div>
          <div class="arch-cnt">${cnt} ${plural(cnt, 'покупка', 'покупки', 'покупок')}</div>
        </button>`;
      }).join('') + `</div>`;
  });
  wrap.innerHTML = html;
  wrap.querySelectorAll('.arch-day').forEach(el => el.addEventListener('click', () => openDaySheet(el.dataset.day)));
}

function openDaySheet(day) {
  const dt = new Date(day + 'T12:00:00');
  $('day-title').textContent = `${dt.getDate()} ${MONTHS_GEN[dt.getMonth()]} ${dt.getFullYear()}`;
  const entries = Object.values(archMap[day] || {}).sort((a, b) => a.ts - b.ts);
  const byCat = new Map();
  entries.forEach(e => {
    const k = e.catName || 'Інше';
    if (!byCat.has(k)) byCat.set(k, { color: e.catColor || '#9E9E9E', icon: e.catIcon || 'tag', items: [] });
    byCat.get(k).items.push(e);
  });
  let html = '';
  byCat.forEach((g, name) => {
    html += `<div class="day-group">
      <div class="day-cat">
        <div class="day-cat-ic" style="--c:${g.color}">${ic(g.icon)}</div>
        <div class="day-cat-name">${esc(name)}</div>
        <span class="lcat-chevron">▼</span>
      </div>
      <div class="day-items"><div class="day-items-in">` +
      g.items.map(e => {
        const t = new Date(e.ts);
        return `<div class="day-item">
          <div class="day-item-ic" style="--c:${g.color}">${ic(e.icon)}</div>
          <div class="day-item-name">${esc(e.name)}</div>
          <div class="day-item-time">${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}</div>
        </div>`;
      }).join('') +
      `</div></div></div>`;
  });
  $('day-list').innerHTML = html || '<div class="empty">Порожньо</div>';
  // категорії дня згортаються/розгортаються, як у списку (та сама анімація)
  $('day-list').querySelectorAll('.day-cat').forEach(el =>
    el.addEventListener('click', () => el.parentElement.classList.toggle('collapsed')));
  $('day-overlay').classList.add('open');
}

// ── ЦІНОВА ПАНЕЛЬ (порівняння списку по магазинах) ─────────
// Закріплена знизу вкладки «Список»: барабан магазинів (Середня/Сільпо/Новус/
// Ашан), під ним ≈ ціна списку в обраному магазині + скільки позицій там нема
// (їх у списку підсвічує червона полоска). Ціни бере воркер shopping-price.
const WORKER_PRICE = 'https://shopping-price.priko1isf.workers.dev';
const PP_ITEM = 120; // ширина рядка барабана, синхронно зі style.css
// Магазини за категоріями. Без фокуса барабан показує УСІ магазини всіх
// категорій (ALL_STORES). Затиск на заголовку категорії в списку звужує його до
// магазинів цієї категорії — ліки → аптеки, господарче → Епіцентр/Бонус/Аврора,
// гігієна → EVA/Watsons/Простор; повторний затиск повертає «усі». Кожен запис:
//   { key, name, color, chain?, branch?, pick? }
//   без chain — псевдо-магазин «Середня» (ціни не тягне)
//   pick:true — можна обрати конкретну філію в налаштуваннях (є /stores у воркері)
// Магазини за замовчуванням — Русанівка/Осокорки, Київ.
const AVG = { key: 'avg', name: 'Середня', color: '#8a8a90' };
const STORE_SETS = {
  food: [
    AVG,
    { key: 'silpo',  name: 'Сільпо',  color: '#2D9CDB', chain: 'silpo',  branch: '1edb6b1b-2d1b-66f4-9b4b-eb10f39e9fe0', pick: true },
    { key: 'fora',   name: 'Фора',    color: '#27AE60', chain: 'fora',   branch: '148', pick: true },
    { key: 'novus',  name: 'Новус',   color: '#EB5C8B', chain: 'novus',  branch: '48201070', pick: true },
    { key: 'auchan', name: 'Ашан',    color: '#F2994A', chain: 'auchan', branch: '48246414', pick: true },
  ],
  house: [
    AVG,
    { key: 'epicentr', name: 'Епіцентр', color: '#E30613', chain: 'epicentr' },
    { key: 'bonus',    name: 'Бонус',    color: '#F5A623', chain: 'bonus' },
    { key: 'aurora',   name: 'Аврора',   color: '#00A0E3', chain: 'aurora' },
  ],
  meds: [
    AVG,
    { key: 'podorozhnyk', name: 'Подорожник',       color: '#F39200', chain: 'podorozhnyk' },
    { key: 'anc',         name: 'АНЦ',              color: '#0071BC', chain: 'anc' },
    { key: 'dobrogo',     name: 'Доброго дня',      color: '#E6007E', chain: 'dobrogo' },
    { key: 'algofarm',    name: 'Альгофарм',        color: '#00A651', chain: 'algofarm' },
  ],
  hygiene: [
    AVG,
    { key: 'eva',     name: 'EVA',     color: '#EC008C', chain: 'eva' },
    { key: 'prostor', name: 'Простор', color: '#00AEEF', chain: 'prostor' },
  ],
};
// набір «усі магазини» — стан барабана без фокуса: «Середня» в центрі, одразу
// праворуч продуктові («Їжа»), а господарче (Епіцентр/Бонус/Аврора) — в кінці,
// тобто найближче ліворуч від центру (барабан зациклений). Порядок явний.
const ALL_ORDER = ['food', 'meds', 'hygiene', 'house'];
const ALL_STORES = [AVG, ...ALL_ORDER.flatMap(k => STORE_SETS[k].filter(s => s.key !== 'avg'))];
// активна категорія барабана (null → «усі магазини»); задається затиском категорії
let ppCat = null;
const curStores = () => STORE_SETS[ppCat] || ALL_STORES;
const pickableStores = () => Object.values(STORE_SETS).flat().filter(s => s.pick);
let ppSel = 'avg';
let ppData = {};       // storeKey → { nameLower → {price,title,oldPrice} | null }
let ppFetchKey = '';   // хеш назв, для яких уже тягнули ціни
let ppScrollTimer = null;
let storeSel = {};     // chain → {id,name,city,address}, обране в налаштуваннях (з Firebase)

// Зациклений барабан: список магазинів рендериться PP_REP копій поспіль,
// стартує в середній копії; докрутившись до краю — безшовно телепортується
// на ту саму позицію в середині (та сама картинка, тож стрибок непомітний).
const PP_REP = 7;
let ppPositioned = false;
function initPricePanel() {
  $('pp-track').addEventListener('scroll', onPpScroll);
  renderDrum();
}
// (пере)малювати стрічку магазинів під активну категорію
function renderDrum() {
  const track = $('pp-track');
  const one = curStores().map(s =>
    `<div class="pp-item" data-key="${s.key}"><span class="pp-dot" style="--c:${s.color}"></span>${esc(s.name)}</div>`).join('');
  track.innerHTML = one.repeat(PP_REP);
  track.querySelectorAll('.pp-item').forEach((el, i) =>
    el.addEventListener('click', () => track.scrollTo({ left: i * PP_ITEM, behavior: 'smooth' })));
}
// затиск на категорії в списку → барабан перемикається на її магазини, панель
// підсвічується кольором категорії; повторний затиск тієї ж категорії — скидає.
function setPpCat(cid) {
  if (!cats[cid]) return;                 // лише реальні категорії (не «Інше»)
  ppCat = ppCat === cid ? null : cid;
  ppSel = 'avg';
  const c = ppCat && cats[ppCat];
  $('price-panel').style.background = c ? hexA(c.color, 0.13) : '';
  renderDrum();
  ppStart();
  ppFetchKey = '';                        // інший набір магазинів → перезапит цін
  refreshPrices();
}
// поставити барабан у центральну копію (виклик, коли панель уже видима)
function ppStart() {
  const track = $('pp-track'), N = curStores().length;
  track.scrollLeft = N * ((PP_REP - 1) >> 1) * PP_ITEM;
  markPpSel(track.scrollLeft / PP_ITEM);
}
// підсвітити центральний магазин (і його копії — вони поза видимою зоною)
function markPpSel(rawIdx) {
  const N = curStores().length, sel = ((Math.round(rawIdx) % N) + N) % N;
  $('pp-track').querySelectorAll('.pp-item').forEach((el, j) => el.classList.toggle('sel', (j % N) === sel));
}
function onPpScroll() {
  const track = $('pp-track');
  markPpSel(track.scrollLeft / PP_ITEM);
  clearTimeout(ppScrollTimer);
  ppScrollTimer = setTimeout(() => {
    const N = curStores().length;
    const raw = Math.round(track.scrollLeft / PP_ITEM);
    const sel = ((raw % N) + N) % N;
    if (curStores()[sel].key !== ppSel) { ppSel = curStores()[sel].key; renderPriceTotals(); }
    // повернути в середню копію, якщо відкотилися на цілий список від центру
    const target = N * ((PP_REP - 1) >> 1) + sel;
    if (Math.abs(raw - target) >= N) {
      const prev = track.style.scrollBehavior;
      track.style.scrollBehavior = 'auto';
      track.scrollLeft = target * PP_ITEM;
      track.style.scrollBehavior = prev;
      markPpSel(target);
    }
  }, 90);
}
// запит ціни для позиції: уточнення (variant) звужує пошук до конкретного товару
function itemQuery(it) {
  const v = (it.variant || '').trim();
  return v ? `${it.name} ${v}` : it.name;
}
// активні позиції; у режимі фокуса категорії — лише позиції цієї категорії
// (барабан показує її магазини, тож і ≈ ціна рахується по її товарах)
const activeItems = () => Object.values(listMap).filter(it => !it.done && (!ppCat || it.cat === ppCat));
// філія магазину: обрана в налаштуваннях або дефолтна
const branchOf = s => (storeSel[s.key] && storeSel[s.key].id) || s.branch;

async function refreshPrices() {
  if (state.tab !== 'list') return;
  const items = activeItems();
  const queries = [...new Set(items.map(itemQuery))];
  // ключ враховує і запити, і обрані філії — зміна магазину змушує перезапит
  const key = (ppCat || 'food') + '#' + queries.map(n => n.toLowerCase()).sort().join('|') + '@'
    + curStores().filter(s => s.chain).map(branchOf).join(',');
  if (!queries.length) { ppFetchKey = ''; renderPriceTotals(); return; }
  if (key === ppFetchKey) { renderPriceTotals(); return; } // дані вже є — лише перемалювати
  ppFetchKey = key;
  $('pp-amount').classList.add('load');
  await Promise.all(curStores().filter(s => s.chain).map(async s => {
    try {
      const r = await fetch(`${WORKER_PRICE}/prices`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain: s.chain, branch: branchOf(s), queries }),
      });
      const j = await r.json();
      const map = {};
      Object.entries(j.results || {}).forEach(([n, v]) => { map[n.toLowerCase()] = v; });
      ppData[s.key] = map;
    } catch { ppData[s.key] = null; }
  }));
  if (key !== ppFetchKey) return; // список змінився, поки тягнули — не чіпаємо
  $('pp-amount').classList.remove('load');
  renderPriceTotals();
}

function priceFor(storeKey, qLower) {
  if (storeKey === 'avg') {
    const vals = curStores().filter(s => s.chain)
      .map(s => ppData[s.key] && ppData[s.key][qLower]).filter(v => v && v.price != null).map(v => v.price);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  const v = ppData[storeKey] && ppData[storeKey][qLower];
  return v && v.price != null ? v.price : null;
}

function renderPriceTotals() {
  const items = activeItems();
  let total = 0, missing = 0;
  items.forEach(it => { const p = priceFor(ppSel, itemQuery(it).toLowerCase()); if (p == null) missing++; else total += p; });
  const amt = $('pp-amount'), note = $('pp-note');
  if (!items.length || missing === items.length) { amt.textContent = '≈ —'; note.textContent = ''; }
  else {
    amt.textContent = `≈ ${Math.round(total)} ₴`;
    note.textContent = missing ? `нема ${missing} ${plural(missing, 'позиції', 'позиції', 'позицій')}` : '';
  }
  applyUnavail();
}
// червона полоска на позиціях, яких нема в обраному магазині (крім «Середня»)
function applyUnavail() {
  document.querySelectorAll('#list-wrap .litem').forEach(row => {
    const it = listMap[row.dataset.id];
    const bad = it && !it.done && ppSel !== 'avg' && priceFor(ppSel, itemQuery(it).toLowerCase()) == null;
    row.classList.toggle('unavail', !!bad);
  });
}

// ── ВИБІР МАГАЗИНІВ (налаштування → «Мої магазини») ────────
let storePickChain = null, storePickList = [];
function openStoresSheet() { renderStoresSheet(); $('stores-overlay').classList.add('open'); }
function renderStoresSheet() {
  const el = $('stores-list');
  if (!el) return;
  el.innerHTML = pickableStores().map(s => {
    const cur = storeSel[s.key];
    const sub = cur ? esc([cur.city, cur.address].filter(Boolean).join(', ') || cur.name) : 'За замовчуванням';
    return `<div class="sheet-item" data-key="${s.key}">
      <div class="sheet-item-ic" style="--c:${s.color}">${ic('cart')}</div>
      <div class="si-name">${esc(s.name)}<div class="si-sub">${sub}</div></div>
      <span class="si-arrow">›</span>
    </div>`;
  }).join('');
  el.querySelectorAll('.sheet-item[data-key]').forEach(row =>
    row.addEventListener('click', () => openStorePicker(row.dataset.key)));
}
async function openStorePicker(key) {
  const s = Object.values(STORE_SETS).flat().find(x => x.key === key);
  storePickChain = s;
  $('storepick-title').textContent = s.name;
  $('storepick-search').value = '';
  $('storepick-list').innerHTML = '<div class="empty" style="padding:24px">Завантаження…</div>';
  $('storepick-overlay').classList.add('open');
  try {
    const r = await fetch(`${WORKER_PRICE}/stores?chain=${s.chain}`);
    const d = await r.json();
    storePickList = Array.isArray(d) ? d : [];
  } catch { storePickList = []; }
  renderStorePickList();
}
function renderStorePickList() {
  const s = storePickChain;
  if (!s) return;
  const q = $('storepick-search').value.trim().toLowerCase();
  let list = storePickList;
  if (q) list = list.filter(x => `${x.city || ''} ${x.address || ''} ${x.name || ''}`.toLowerCase().includes(q));
  list = list.slice(0, 80);
  const cur = storeSel[s.key];
  $('storepick-list').innerHTML = list.map(x => {
    const label = esc([x.city, x.address].filter(Boolean).join(', ') || x.name);
    const sel = cur && String(cur.id) === String(x.id);
    return `<div class="sheet-item ${sel ? 'sel' : ''}" data-id="${esc(String(x.id))}">
      <div class="si-name">${label}</div>
      ${sel ? '<span class="si-arrow" style="color:var(--active-ink)">✓</span>' : '<span class="si-arrow">›</span>'}
    </div>`;
  }).join('') || '<div class="empty" style="padding:24px">Нічого не знайдено</div>';
  $('storepick-list').querySelectorAll('.sheet-item[data-id]').forEach(row =>
    row.addEventListener('click', () => {
      const x = storePickList.find(y => String(y.id) === row.dataset.id);
      if (x) set(ref(db, `${STORES_PATH}/${s.key}`),
        { id: String(x.id), name: x.name || s.name, city: x.city || '', address: x.address || '' }).catch(() => {});
      $('storepick-overlay').classList.remove('open');
      toast(`${s.name}: ${x ? (x.city || x.name) : ''}`);
    }));
}

// ── ADD VIEW (середня сторінка Список | + | Архів) ─────────
// Свіжий стан при кожному вході на сторінку (пошук/редагування/мультивибір скидаються)
function prepAdd() {
  addSearch = '';
  $('add-search').value = '';
  addEditMode = false;
  addSelect = null;
  $('btn-edit-prods').classList.remove('on');
  if (!addCurCat || !cats[addCurCat]) addCurCat = sortedCats()[0]?.[0] || null;
  renderAddChips();
  renderAddGrid();
}
// «закрити додавання» = плавно поїхати на сторінку списку
function closeAdd() { addSelect = null; renderAddCommit(); setTab('list'); }

function renderAddCommit() {
  const bar = $('add-commit');
  if (!addSelect) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  $('add-commit-btn').textContent = `Додати до списку (${addSelect.size})`;
}
function commitAddSelect() {
  if (!addSelect || !addSelect.size) return;
  let n = 0;
  addSelect.forEach(pid => { if (addToList(pid, { silent: true })) n++; });
  toast(n ? `Додано: ${n} ${plural(n, 'позиція', 'позиції', 'позицій')}` : 'Все обране вже у списку');
  closeAdd(); // плавно їде на сторінку списку
}

function renderAddChips() {
  const el = $('add-chips');
  el.innerHTML = sortedCats().map(([id, c]) =>
    `<button class="chip ${id === addCurCat && !addSearch ? 'on' : ''}" data-cid="${id}" style="--c:${c.color}">
      <span class="chip-ic">${ic(c.icon)}</span>${esc(c.name)}
    </button>`).join('') +
    `<button class="chip add" id="chip-new-cat">+</button>`;
  el.querySelectorAll('.chip[data-cid]').forEach(chip => {
    chip.addEventListener('click', () => {
      addCurCat = chip.dataset.cid;
      if (addEditMode) { openCatForm(addCurCat); return; }
      addSearch = ''; $('add-search').value = '';
      renderAddChips(); renderAddGrid();
    });
    longPress(chip, () => openCatForm(chip.dataset.cid));
  });
  $('chip-new-cat').addEventListener('click', () => openCatForm(null));
}

function renderAddGrid() {
  const grid = $('add-grid');
  grid.classList.toggle('editing', addEditMode);
  const q = addSearch.trim().toLowerCase();
  let entries = Object.entries(prods);
  if (q) entries = entries.filter(([, p]) => p.name.toLowerCase().includes(q));
  else entries = entries.filter(([, p]) => p.cat === addCurCat);
  entries.sort((a, b) => a[1].name.localeCompare(b[1].name, 'uk'));

  let html = entries.map(([pid, p]) => {
    const c = cats[p.cat] || { color: '#9E9E9E' };
    const sel = addSelect?.has(pid);
    return `<button class="ptile ${sel ? 'sel' : ''}" data-pid="${pid}">
      <div class="ptile-circle" style="--c:${c.color}">${ic(p.icon)}
        <span class="ptile-badge"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></span>
        <span class="ptile-edit-dot"><svg viewBox="0 0 24 24"><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></span>
      </div>
      <div class="ptile-name">${esc(p.name)}</div>
    </button>`;
  }).join('');
  if (!q) html += `<button class="ptile new" id="ptile-new"><div class="ptile-circle">+</div><div class="ptile-name">Новий</div></button>`;
  grid.innerHTML = html;
  renderAddCommit();

  grid.querySelectorAll('.ptile[data-pid]').forEach(tile => {
    const pid = tile.dataset.pid;
    tile.addEventListener('click', () => {
      if (addEditMode) { openProdForm(pid); return; }
      if (addSelect) {
        // мультивибір: тап перемикає позначку
        addSelect.has(pid) ? addSelect.delete(pid) : addSelect.add(pid);
        tile.classList.toggle('sel', addSelect.has(pid));
        if (!addSelect.size) addSelect = null;
        renderAddCommit();
        return;
      }
      // звичайний режим: тап одразу додає, шторка без пауз плавно їде вниз,
      // а предмет уже в списку під нею (локальна луна Firebase — синхронна)
      if (addToList(pid)) {
        toast(`Додано: ${prods[pid]?.name || ''}`);
        closeAdd();
      }
    });
    longPress(tile, () => {
      if (addEditMode) { openProdForm(pid); return; }
      if (!addSelect) addSelect = new Set();
      addSelect.add(pid);
      tile.classList.add('sel');
      renderAddCommit();
    });
  });
  const newTile = $('ptile-new');
  if (newTile) newTile.addEventListener('click', () => openProdForm(null));
}

// ── CATEGORY MANAGER / FORM ────────────────────────────────
function openCatsSheet() {
  const el = $('cats-list');
  el.innerHTML = sortedCats().map(([id, c]) => {
    const cnt = Object.values(prods).filter(p => p.cat === id).length;
    return `<div class="sheet-item" data-cid="${id}">
      <div class="sheet-item-ic" style="--c:${c.color}">${ic(c.icon)}</div>
      <div class="si-name">${esc(c.name)}<div class="si-sub">${cnt} ${plural(cnt, 'продукт', 'продукти', 'продуктів')}</div></div>
      <span class="si-arrow">›</span>
    </div>`;
  }).join('') +
  `<div class="sheet-item" id="cats-new"><div class="sheet-item-ic" style="--c:#c9c9d2">${ic('tag')}</div><div class="si-name" style="color:var(--active-ink)">Нова категорія</div></div>`;
  el.querySelectorAll('.sheet-item[data-cid]').forEach(row =>
    row.addEventListener('click', () => { $('cats-overlay').classList.remove('open'); openCatForm(row.dataset.cid); }));
  $('cats-new').addEventListener('click', () => { $('cats-overlay').classList.remove('open'); openCatForm(null); });
  $('cats-overlay').classList.add('open');
}

function openCatForm(cid) {
  catFormId = cid;
  const c = cid ? cats[cid] : null;
  catFormSel = { color: c?.color || COLORS[Math.floor(Math.random() * COLORS.length)], icon: c?.icon || 'tag' };
  $('cat-form-title').textContent = c ? 'Редагувати категорію' : 'Нова категорія';
  $('cat-form-name').value = c?.name || '';
  $('cat-form-delete').style.display = c ? '' : 'none';
  renderCatFormPickers();
  $('cat-form-overlay').classList.add('open');
}
function renderCatFormPickers() {
  $('cat-form-colors').innerHTML = COLORS.map(col =>
    `<button class="color-sw ${col === catFormSel.color ? 'sel' : ''}" data-col="${col}" style="--c:${col}"></button>`).join('');
  $('cat-form-colors').querySelectorAll('.color-sw').forEach(sw =>
    sw.addEventListener('click', () => { catFormSel.color = sw.dataset.col; renderCatFormPickers(); }));
  $('cat-form-icons').innerHTML = Object.keys(ICONS).map(k =>
    `<button class="icon-cell ${k === catFormSel.icon ? 'sel' : ''}" data-ic="${k}">${ic(k)}</button>`).join('');
  $('cat-form-icons').querySelectorAll('.icon-cell').forEach(cell =>
    cell.addEventListener('click', () => { catFormSel.icon = cell.dataset.ic; renderCatFormPickers(); }));
}
function saveCatForm() {
  const name = $('cat-form-name').value.trim();
  if (!name) { toast('Введи назву категорії'); return; }
  if (catFormId) {
    update(ref(db, `${CATS_PATH}/${catFormId}`), { name, color: catFormSel.color, icon: catFormSel.icon }).catch(() => {});
  } else {
    const order = Math.max(-1, ...Object.values(cats).map(c => c.order ?? 0)) + 1;
    set(push(ref(db, CATS_PATH)), { name, color: catFormSel.color, icon: catFormSel.icon, order }).catch(() => {});
  }
  $('cat-form-overlay').classList.remove('open');
}
async function deleteCatForm() {
  if (!catFormId) return;
  const cnt = Object.values(prods).filter(p => p.cat === catFormId).length;
  if (!confirm(`Видалити категорію разом з ${cnt} ${plural(cnt, 'продуктом', 'продуктами', 'продуктами')}?`)) return;
  const upd = {};
  Object.entries(prods).forEach(([pid, p]) => { if (p.cat === catFormId) upd[`products/${pid}`] = null; });
  upd[`categories/${catFormId}`] = null;
  await update(ref(db, 'shopping'), upd);
  if (addCurCat === catFormId) addCurCat = null;
  $('cat-form-overlay').classList.remove('open');
}

// ── PRODUCT FORM ───────────────────────────────────────────
function openProdForm(pid) {
  prodFormId = pid;
  const p = pid ? prods[pid] : null;
  prodFormSel = { icon: p?.icon || 'tag', cat: p?.cat || addCurCat || sortedCats()[0]?.[0] };
  $('prod-form-title').textContent = p ? 'Редагувати продукт' : 'Новий продукт';
  $('prod-form-name').value = p?.name || (addSearch.trim() || '');
  $('prod-form-delete').style.display = p ? '' : 'none';
  renderProdFormPickers();
  $('prod-form-overlay').classList.add('open');
}
function renderProdFormPickers() {
  $('prod-form-cats').innerHTML = sortedCats().map(([id, c]) =>
    `<button class="chip ${id === prodFormSel.cat ? 'on' : ''}" data-cid="${id}" style="--c:${c.color}">
      <span class="chip-ic">${ic(c.icon)}</span>${esc(c.name)}
    </button>`).join('');
  $('prod-form-cats').querySelectorAll('.chip').forEach(chip =>
    chip.addEventListener('click', () => { prodFormSel.cat = chip.dataset.cid; renderProdFormPickers(); }));
  $('prod-form-icons').innerHTML = Object.keys(ICONS).map(k =>
    `<button class="icon-cell ${k === prodFormSel.icon ? 'sel' : ''}" data-ic="${k}">${ic(k)}</button>`).join('');
  $('prod-form-icons').querySelectorAll('.icon-cell').forEach(cell =>
    cell.addEventListener('click', () => { prodFormSel.icon = cell.dataset.ic; renderProdFormPickers(); }));
}
function saveProdForm() {
  const name = $('prod-form-name').value.trim();
  if (!name) { toast('Введи назву продукту'); return; }
  if (!prodFormSel.cat) { toast('Обери категорію'); return; }
  if (prodFormId) {
    update(ref(db, `${PRODS_PATH}/${prodFormId}`), { name, icon: prodFormSel.icon, cat: prodFormSel.cat }).catch(() => {});
    // оновити назву/іконку в активному списку
    const upd = {};
    Object.entries(listMap).forEach(([id, it]) => {
      if (it.pid === prodFormId) { upd[`${id}/name`] = name; upd[`${id}/icon`] = prodFormSel.icon; upd[`${id}/cat`] = prodFormSel.cat; }
    });
    if (Object.keys(upd).length) update(ref(db, LIST_PATH), upd).catch(() => {});
  } else {
    const order = Math.max(0, ...Object.values(prods).map(p => p.order ?? 0)) + 1;
    set(push(ref(db, PRODS_PATH)), { name, icon: prodFormSel.icon, cat: prodFormSel.cat, order }).catch(() => {});
  }
  $('prod-form-overlay').classList.remove('open');
}
function deleteProdForm() {
  if (!prodFormId) return;
  remove(ref(db, `${PRODS_PATH}/${prodFormId}`)).catch(() => {});
  $('prod-form-overlay').classList.remove('open');
}

// ── EVENTS ─────────────────────────────────────────────────
function bindEvents() {
  $('btn-edit-prods').addEventListener('click', () => {
    addEditMode = !addEditMode;
    $('btn-edit-prods').classList.toggle('on', addEditMode);
    renderAddGrid();
    toast(addEditMode ? 'Режим редагування: тапни продукт чи категорію' : 'Режим додавання');
  });
  $('btn-calendar').addEventListener('click', toggleCalDrum);
  $('cal-drum-scroll').addEventListener('scroll', onDrumScroll);
  $('cal-drum-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeCalDrum(); });
  $('add-search').addEventListener('input', e => { addSearch = e.target.value; renderAddChips(); renderAddGrid(); });
  $('add-commit-btn').addEventListener('click', commitAddSelect);
  $('add-commit-cancel').addEventListener('click', () => { addSelect = null; renderAddCommit(); renderAddGrid(); });
  $('item-done').addEventListener('click', saveItemSheet);
  $('replace-search').addEventListener('input', renderReplaceGrid);

  $('btn-cats').addEventListener('click', openCatsSheet);
  $('btn-settings').addEventListener('click', () => { renderNotifyRow(); $('settings-overlay').classList.add('open'); });
  $('btn-notify').addEventListener('click', enableNotifications);
  $('btn-test-push').addEventListener('click', testPush);
  $('btn-stores').addEventListener('click', () => { $('settings-overlay').classList.remove('open'); openStoresSheet(); });
  $('storepick-search').addEventListener('input', renderStorePickList);
  $('btn-clear-done').addEventListener('click', () => {
    const upd = {};
    Object.entries(listMap).forEach(([id, it]) => { if (it.done) upd[id] = null; });
    if (Object.keys(upd).length) update(ref(db, LIST_PATH), upd);
    $('settings-overlay').classList.remove('open');
    toast('Куплене прибрано зі списку');
  });

  $('cat-form-done').addEventListener('click', saveCatForm);
  $('cat-form-delete').addEventListener('click', deleteCatForm);
  $('prod-form-done').addEventListener('click', saveProdForm);
  $('prod-form-delete').addEventListener('click', deleteProdForm);

  document.querySelectorAll('.tabbar [data-tab]').forEach(tab =>
    tab.addEventListener('click', () => setTab(tab.dataset.tab)));

  document.querySelectorAll('.sheet-overlay').forEach(ov =>
    ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('open'); }));
}

function setTab(t) {
  if (t === 'add' && state.tab !== 'add') prepAdd(); // свіжий стан сторінки додавання
  state.tab = t;
  refreshListOrder();
  renderList();
  updateTabs();
  syncTabs();
}

function updateTabs() {
  document.querySelectorAll('.tabbar [data-tab]').forEach(t => t.classList.toggle('active', t.dataset.tab === state.tab));
  if (state.tab !== 'archive') closeCalDrum();
  // права кнопка шапки — своя на кожній сторінці
  $('btn-cats').style.display = state.tab === 'list' ? '' : 'none';
  $('btn-edit-prods').style.display = state.tab === 'add' ? '' : 'none';
  $('btn-calendar').style.display = state.tab === 'archive' ? '' : 'none';
  // цінова панель — лише на «Списку»
  $('price-panel').style.display = state.tab === 'list' ? '' : 'none';
  if (state.tab === 'list') { if (!ppPositioned) { ppStart(); ppPositioned = true; } refreshPrices(); }
}

// ── SWIPE між екранами ─────────────────────────────────────
function syncTabs() {
  const cur = SWIPE_TABS.indexOf(state.tab);
  SWIPE_TABS.forEach((t, i) => {
    const s = $(t + '-screen');
    s.style.transition = '';
    s.style.transform = `translateX(${(i - cur) * 100}%)`;
    s.classList.toggle('active', t === state.tab);
  });
}
function initSwipeLayout() {
  syncTabs();
  const wrap = $('screen-wrap');
  let swX = 0, swY = 0, swActive = false, swLocked = false;
  wrap.addEventListener('touchstart', e => {
    // чіпси категорій і пошук мають власний горизонтальний скрол — не перехоплюємо
    if (e.target.closest('.add-chips') || e.target.closest('.add-search')) { swActive = false; return; }
    swX = e.touches[0].clientX; swY = e.touches[0].clientY;
    swActive = true; swLocked = false;
  }, { passive: true });
  wrap.addEventListener('touchmove', e => {
    if (!swActive) return;
    const dx = e.touches[0].clientX - swX, dy = e.touches[0].clientY - swY;
    if (!swLocked) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (Math.abs(dy) >= Math.abs(dx)) { swActive = false; return; }
      swLocked = true;
    }
    e.preventDefault();
    const cur = SWIPE_TABS.indexOf(state.tab), W = wrap.offsetWidth;
    SWIPE_TABS.forEach((t, i) => {
      const s = $(t + '-screen');
      s.style.transition = 'none';
      s.style.transform = `translateX(${(i - cur) * W + dx}px)`;
    });
  }, { passive: false });
  wrap.addEventListener('touchend', e => {
    if (!swActive || !swLocked) { swActive = false; return; }
    swActive = false;
    const dx = e.changedTouches[0].clientX - swX;
    const threshold = wrap.offsetWidth * 0.28;
    const cur = SWIPE_TABS.indexOf(state.tab);
    let next = cur;
    if (dx < -threshold && cur < SWIPE_TABS.length - 1) next = cur + 1;
    else if (dx > threshold && cur > 0) next = cur - 1;
    if (next !== cur) setTab(SWIPE_TABS[next]);
    else syncTabs();
  }, { passive: true });
}

// ── ШТОРКИ: закриття свайпом за полоску ────────────────────
// Тягнеш полоску вниз — шторка їде за пальцем; відпустив нижче порога —
// закривається (CSS довозить), інакше пружинить назад.
function initSheetDrag() {
  document.querySelectorAll('.sheet-overlay').forEach(ov => {
    const sheet = ov.querySelector('.sheet');
    const handle = sheet?.querySelector('.sheet-handle');
    if (!handle) return;
    let y0 = 0, dragging = false;
    handle.addEventListener('touchstart', e => {
      y0 = e.touches[0].clientY; dragging = true;
      sheet.style.transition = 'none';
    }, { passive: true });
    handle.addEventListener('touchmove', e => {
      if (!dragging) return;
      sheet.style.transform = `translateY(${Math.max(0, e.touches[0].clientY - y0)}px)`;
    }, { passive: true });
    handle.addEventListener('touchend', e => {
      if (!dragging) return;
      dragging = false;
      const dy = e.changedTouches[0].clientY - y0;
      sheet.style.transition = '';
      sheet.style.transform = '';
      if (dy > 70) ov.classList.remove('open'); // з поточної позиції плавно вниз
    }, { passive: true });
  });
}

// ── HELPERS ────────────────────────────────────────────────
// #RRGGBB → rgba(...,a): напівпрозорий тінт панелі під колір категорії
function hexA(hex, a) {
  const h = String(hex).replace('#', '');
  const s = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(s, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
// Клік, що прилітає ПІСЛЯ спрацьованого затиску, гасимо глобально —
// інакше він одразу закривав кнопки дій / знімав щойно поставлену позначку.
let lpUntil = 0;
document.addEventListener('click', e => {
  if (Date.now() < lpUntil) { e.stopPropagation(); e.preventDefault(); }
}, true);

function longPress(el, fn, ms = 430) {
  let timer = null, fired = false;
  const start = () => {
    fired = false;
    timer = setTimeout(() => { fired = true; lpUntil = Date.now() + 700; fn(); }, ms);
  };
  const cancel = () => clearTimeout(timer);
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchmove', cancel, { passive: true });
  el.addEventListener('touchend', e => { cancel(); if (fired) e.preventDefault(); }, { passive: false });
  // мишка (десктоп/прев'ю)
  el.addEventListener('mousedown', e => { if (e.button === 0) start(); });
  el.addEventListener('mouseup', cancel);
  el.addEventListener('mouseleave', cancel);
  el.addEventListener('contextmenu', e => e.preventDefault());
}

// рід першого слова назви: Який/Яка/Яке/Які
const GENDER_EX = { 'яйця': 'p', 'яблука': 'p', 'сіль': 'f', 'краплі': 'p' };
function whichWord(name) {
  const w = (name || '').trim().split(/\s+/)[0].toLowerCase();
  const g = GENDER_EX[w] || (/[иії]$/.test(w) ? 'p' : /[ая]$/.test(w) ? 'f' : /[ое]$/.test(w) ? 'n' : 'm');
  return { p: 'Які', f: 'Яка', n: 'Яке', m: 'Який' }[g];
}

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}
