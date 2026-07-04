import Phaser from 'phaser';
import { LOGICAL_H } from '../config';
import { setupMenuCamera, addTitle, addBack, addMenuItem, MENU_FONT } from './menuTheme';
import { myKhorugvaId, createKhorugva, watchKhorugva, memberList, cacheMembers, callToGather, leaveKhorugva, BOT_USERNAME, APP_SHORT, type Khorugva } from '../khorugva';
import { drawKhSlot } from './khPortraits';

// «Хоругва» — збір загону до 5 гравців.
// Нема хоругви → кнопка «Створити». Є → 5 слотів-портретів (лідер перший),
// поле ніку (@nick) + «Оголосити збір»: виклик у Firebase + сповіщення через
// бот-воркер (як задеплоєний). Гравець із бота тисне «Приєднатись» → deep-link
// ?startapp=kh_<id> → займає слот.
export class KhorugvaScene extends Phaser.Scene {
  private unwatch: (() => void) | null = null;
  private kh: Khorugva | null = null;
  private slotLayer: Phaser.GameObjects.Container | null = null;
  private status!: Phaser.GameObjects.Text;

  constructor() { super('Khorugva'); }

  create(): void {
    const f = setupMenuCamera(this, '#141017');
    addTitle(this, f, 'ХОРУГВА');
    addBack(this, f);
    this.kh = null;
    this.slotLayer = null;

    this.status = this.add.text(f.cx, LOGICAL_H - 46 + f.offY, '', {
      fontFamily: MENU_FONT, fontSize: '20px', color: '#8a8496',
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

  private attach(khId: string, f: { offX: number; offY: number; cx: number }): void {
    this.unwatch?.();
    this.unwatch = watchKhorugva(khId, (kh) => {
      if (!this.scene.isActive()) return;
      this.kh = kh;
      this.renderSlots(f);
    });

    // «Оголосити збір» (нік питаємо системним prompt — простенько, працює скрізь).
    // УВАГА: бот може сповістити лише того, хто хоч раз ЗАПУСКАВ бота — інакше
    // Telegram не дає писати. Для решти — «Скопіювати запрошення» (пряме посилання).
    addMenuItem(this, f.cx - 250, 440 + f.offY, 'Оголосити збір', () => {
      const nick = window.prompt('Телеграм-нік гравця (напр. @friend):', '@');
      if (!nick || nick.replace(/^@/, '').trim().length < 2) return;
      this.status.setText('Скликаємо…');
      void callToGather(nick, khId)
        .then((r) => this.status.setText(r.botSent
          ? `Гонець побіг до ${nick} — сповіщення в боті`
          : `${nick} ще не знайомий з ботом — кинь йому запрошення (кнопка праворуч)`))
        .catch((e) => this.status.setText('Не вдалося: ' + String(e?.message ?? e)));
    }, 30);

    // «Скопіювати запрошення» — прямий deep-link: працює будь-де (чат, смс),
    // навіть якщо друг ніколи не відкривав бота.
    addMenuItem(this, f.cx + 40, 440 + f.offY, 'Скопіювати запрошення', () => {
      const link = `https://t.me/${BOT_USERNAME}/${APP_SHORT}?startapp=kh_${khId}`;
      const done = (): void => { this.status.setText('Запрошення скопійовано — кинь другу в чат'); };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(done, () => window.prompt('Скопіюй запрошення:', link));
      else window.prompt('Скопіюй запрошення:', link);
    }, 30);

    // «Покинути хоругву» — вийти зі слота і забути загін на цьому пристрої.
    addMenuItem(this, f.cx - 60, 496 + f.offY, 'Покинути', () => {
      void leaveKhorugva(khId).catch(() => { /* офлайн — все одно забуваємо */ }).then(() => {
        this.unwatch?.(); this.unwatch = null;
        this.scene.restart();
      });
    }, 24);
  }

  private renderSlots(f: { offX: number; offY: number; cx: number }): void {
    // ВЕСЬ вміст — у slotLayer: інакше при кожному watch-оновленні старі портрети
    // лишалися під новими (виглядало, ніби приєднання «не працює»).
    this.slotLayer?.destroy(true);
    this.slotLayer = this.add.container(0, 0).setScrollFactor(0);
    const members = memberList(this.kh);
    cacheMembers(members); // паті поїде з нами на Мандри/у Локацію (миттєвий HUD)
    const size = 132, gap = 28;
    const total = 5 * size + 4 * gap;
    const x0 = f.cx - total / 2, y = 210 + f.offY;
    for (let i = 0; i < 5; i++) drawKhSlot(this, x0 + i * (size + gap), y, size, members[i] ?? null, this.slotLayer);
    // підписи під зайнятими слотами
    members.slice(0, 5).forEach((m, i) => {
      this.slotLayer!.add(this.add.text(x0 + i * (size + gap) + size / 2, y + size + 18, m.name, {
        fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '18px', color: '#c9bb9c',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(51));
    });
    this.slotLayer.add(this.add.text(f.cx, y - 28, `Побратимів: ${members.length}/5`, {
      fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '18px', color: '#8a8171',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(51));
  }
}
