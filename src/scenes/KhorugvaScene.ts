import Phaser from 'phaser';
import { LOGICAL_W, LOGICAL_H } from '../config';
import { setupMenuCamera, addTitle, addBack, addMenuItem, MENU_FONT } from './menuTheme';
import { myKhorugvaId, createKhorugva, watchKhorugva, memberList, callToGather, leaveKhorugva, BOT_USERNAME, APP_SHORT, type Khorugva, type KhMember } from '../khorugva';
import { CutoutCharacter } from '../anim/CutoutCharacter';
import { loadMemberCharDoc } from '../multiplayer/sharedChars';
import { getPlayerId } from '../multiplayer/lobby';

// «Хоругва» — збір загону до 5 гравців. Тепер побратими стоять НАВКОЛО ВОГНИЩА
// у своєму справжньому вигляді (idle), а не абстрактними квадратиками: док кожного
// тягнемо зі спільного каналу `shared_chars/{id}` (див. multiplayer/sharedChars).
// Нема хоругви → «Створити». Приєднання — deep-link ?startapp=kh_<id> з бота.

// Місця навколо вогнища (логічні координати; feetY — куди стають ступні).
// Менший масштаб + вище = далі вглиб (перспектива). Лідер — по центру, ближче.
const SPOTS: { x: number; feetY: number; s: number; face: number }[] = [
  { x: 640, feetY: 446, s: 0.80, face: -1 }, // лідер — по центру, ЗА вогнищем
  { x: 452, feetY: 460, s: 0.82, face: 1 },
  { x: 852, feetY: 460, s: 0.82, face: -1 },
  { x: 306, feetY: 478, s: 0.90, face: 1 },  // з боків — ближче до глядача (більші)
  { x: 986, feetY: 478, s: 0.90, face: -1 },
];

export class KhorugvaScene extends Phaser.Scene {
  private unwatch: (() => void) | null = null;
  private kh: Khorugva | null = null;
  private partyLayer: Phaser.GameObjects.Container | null = null;
  private partyChars: { char: CutoutCharacter; face: number }[] = [];
  private renderedKey = '';
  private status!: Phaser.GameObjects.Text;

  constructor() { super('Khorugva'); }

  create(): void {
    const f = setupMenuCamera(this, '#141017');
    // Фон-хатина з вогнищем (той самий, що в лоббі) — щоб було «навколо вогнища».
    const bg = this.add.image(LOGICAL_W / 2 + f.offX, LOGICAL_H / 2 + f.offY, 'menu_home').setScrollFactor(0).setDepth(0);
    bg.setScale(Math.max(LOGICAL_W / bg.width, LOGICAL_H / bg.height)).setTint(0xbfb6a6);
    addTitle(this, f, 'ХОРУГВА');
    addBack(this, f);
    this.kh = null;
    this.partyLayer = null;
    this.partyChars = [];
    this.renderedKey = '';

    this.status = this.add.text(f.cx, LOGICAL_H - 22 + f.offY, '', {
      fontFamily: MENU_FONT, fontSize: '18px', color: '#8a8496',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(60);

    const khId = myKhorugvaId();
    if (khId) this.attach(khId, f);
    else {
      const createBtn = addMenuItem(this, f.cx - 70, 250 + f.offY, 'Створити', () => {
        createBtn.disableInteractive().setAlpha(0.5);
        this.status.setText('Розгортаємо хоругву…');
        void createKhorugva()
          .then((id) => { createBtn.destroy(); this.status.setText(''); this.attach(id, f); })
          .catch((e) => { createBtn.setInteractive().setAlpha(1); this.status.setText('Не вдалося: ' + String(e?.message ?? e)); });
      });
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.unwatch?.(); this.unwatch = null; });
  }

  update(_t: number, dtMs: number): void {
    const dt = dtMs / 1000;
    for (const p of this.partyChars) p.char.tick(dt, p.face);
  }

  private attach(khId: string, f: { offX: number; offY: number; cx: number }): void {
    this.unwatch?.();
    this.unwatch = watchKhorugva(khId, (kh) => {
      if (!this.scene.isActive()) return;
      this.kh = kh;
      this.renderParty(f);
    });

    // «Оголосити збір» — бот сповіщає лише того, хто хоч раз ЗАПУСКАВ бота.
    addMenuItem(this, f.cx - 250, 540 + f.offY, 'Оголосити збір', () => {
      const nick = window.prompt('Телеграм-нік гравця (напр. @friend):', '@');
      if (!nick || nick.replace(/^@/, '').trim().length < 2) return;
      this.status.setText('Скликаємо…');
      void callToGather(nick, khId)
        .then((r) => this.status.setText(r.botSent
          ? `Гонець побіг до ${nick} — сповіщення в боті`
          : `${nick} ще не знайомий з ботом — кинь йому запрошення (кнопка праворуч)`))
        .catch((e) => this.status.setText('Не вдалося: ' + String(e?.message ?? e)));
    }, 26);

    // «Скопіювати запрошення» — прямий deep-link: працює будь-де.
    addMenuItem(this, f.cx + 40, 540 + f.offY, 'Скопіювати запрошення', () => {
      const link = `https://t.me/${BOT_USERNAME}/${APP_SHORT}?startapp=kh_${khId}`;
      const done = (): void => { this.status.setText('Запрошення скопійовано — кинь другу в чат'); };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(done, () => window.prompt('Скопіюй запрошення:', link));
      else window.prompt('Скопіюй запрошення:', link);
    }, 26);

    // «Покинути хоругву».
    addMenuItem(this, f.cx + 470, 540 + f.offY, 'Покинути', () => {
      void leaveKhorugva(khId).catch(() => { /* офлайн — все одно забуваємо */ }).then(() => {
        this.unwatch?.(); this.unwatch = null;
        this.scene.restart();
      });
    }, 22);
  }

  // Малюємо побратимів навколо вогнища у їхньому справжньому вигляді (idle).
  // Перебудова — лише коли ЗМІНИВСЯ склад загону (щоб не смикати текстури щоразу).
  private renderParty(f: { offX: number; offY: number; cx: number }): void {
    const members = memberList(this.kh);
    const key = members.map((m) => m.id).join(',');
    if (key === this.renderedKey && this.partyLayer) return;
    this.renderedKey = key;

    this.partyLayer?.destroy(true);
    this.partyChars = [];
    const layer = this.add.container(0, 0).setScrollFactor(0).setDepth(5);
    this.partyLayer = layer;

    // Лічильник побратимів — під заголовком.
    layer.add(this.add.text(f.cx, 118 + f.offY, `Побратимів: ${members.length}/5`, {
      fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '20px', color: '#8a8171',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(6));

    const myId = getPlayerId();
    members.slice(0, 5).forEach((m, i) => this.spawnMember(m, SPOTS[i], f, m.id === myId, layer));
  }

  private spawnMember(
    m: KhMember, spot: { x: number; feetY: number; s: number; face: number },
    f: { offX: number; offY: number }, isMe: boolean, layer: Phaser.GameObjects.Container,
  ): void {
    // Підпис імені — одразу (навіть поки вантажиться арт).
    const nameY = spot.feetY + 20 + f.offY;
    layer.add(this.add.text(spot.x + f.offX, nameY, isMe ? 'ти' : m.name, {
      fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '17px',
      color: isMe ? '#ffcf8f' : (m.id === this.kh?.leader ? '#e5cfa0' : '#c9bb9c'),
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(7).setShadow(1, 1, '#000', 4, false, true));

    void loadMemberCharDoc(m.id, m.charId ?? '').then(async (doc) => {
      if (!doc || !this.scene.isActive() || !layer.active) return;
      const char = await CutoutCharacter.load(this, doc, `kh_${m.id}_`).catch(() => null);
      if (!char || !this.scene.isActive() || !layer.active) return;
      char.setAnim('idle');
      char.tick(0, spot.face);
      const holder = this.add.container(spot.x + f.offX, 0, [char]).setScrollFactor(0).setScale(spot.s);
      holder.y = spot.feetY + f.offY - char.feetOffset() * spot.s;
      layer.add(holder);
      this.partyChars.push({ char, face: spot.face });
    });
  }
}
