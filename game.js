// =============================================================
//  Pink Knight Hop — chess knight L-jumps, coin rush for ~6yo
// =============================================================

const GW = 1024;
const GH = 576;
const VERSION = '1.0';
const GAME_ID = 'knightHop';
const PLAY_STORAGE_KEY = 'phaserlab_daily_plays';
const MAX_PLAYS_PER_DAY = 5;

const BOARD_SIZE = 8;
const GAME_SECONDS = 45;
const TIMER_H = 52;
const HUD_H = 44;
const BOARD_TOP = HUD_H + TIMER_H + 8;
const BOARD_PX = Math.min(GW - 40, GH - BOARD_TOP - 20);
const BOARD_LEFT = (GW - BOARD_PX) / 2;
const CELL_PX = BOARD_PX / BOARD_SIZE;
const TIMER_BAR_H = 18;

const KNIGHT_OFFSETS = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
];

const C = {
  pink: 0xffb3d9,
  cream: 0xfff5f0,
  knight: 0xff6eb4,
  knightShadow: 0xe04090,
  gold: 0xffd700,
  purple: 0x6b3fa0,
  bgTop: '#c878d8',
  bgBottom: '#f8b4e8',
};

// ── SFX (Web Audio) ───────────────────────────────────────────
const SFX = (() => {
  let ctx = null;
  const get = () => {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  };
  const tone = (freq, freqEnd, type, dur, vol) => {
    try {
      const c = get();
      const o = c.createOscillator();
      const g = c.createGain();
      o.connect(g);
      g.connect(c.destination);
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, c.currentTime);
      if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, c.currentTime + dur);
      g.gain.setValueAtTime(vol || 0.22, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      o.start(c.currentTime);
      o.stop(c.currentTime + dur + 0.01);
    } catch (_) {}
  };
  return {
    coin: () => tone(880, 1320, 'sine', 0.14, 0.24),
    jump: () => tone(180, 120, 'triangle', 0.08, 0.14),
    tick: () => tone(600, 600, 'sine', 0.04, 0.08),
    endWin: () => {
      tone(523, 523, 'sine', 0.12, 0.22);
      setTimeout(() => tone(659, 659, 'sine', 0.12, 0.22), 120);
      setTimeout(() => tone(784, 784, 'sine', 0.2, 0.26), 240);
    },
    endBoop: () => tone(320, 240, 'sine', 0.22, 0.18),
  };
})();

// ── Daily play limit (shared with PhaserLab via localStorage) ───
const DailyPlays = {
  today() { return new Date().toISOString().slice(0, 10); },
  load() {
    const empty = { date: this.today(), count: 0, versions: {} };
    try {
      const raw = localStorage.getItem(PLAY_STORAGE_KEY);
      if (!raw) return empty;
      const data = JSON.parse(raw);
      if (!data.versions) data.versions = {};
      let dirty = false;
      if (data.date !== this.today()) {
        data.date = this.today();
        data.count = 0;
        dirty = true;
      }
      if (data.versions[GAME_ID] !== VERSION) {
        data.count = 0;
        data.versions[GAME_ID] = VERSION;
        dirty = true;
      }
      if (dirty) this.persist(data);
      return data;
    } catch (_) {
      return empty;
    }
  },
  persist(data) {
    if (!data.versions) data.versions = {};
    data.versions[GAME_ID] = VERSION;
    localStorage.setItem(PLAY_STORAGE_KEY, JSON.stringify(data));
  },
  get() { return this.load(); },
  remaining() { return Math.max(0, MAX_PLAYS_PER_DAY - this.load().count); },
  canPlay() { return this.remaining() > 0; },
  record() {
    const data = this.load();
    data.count++;
    this.persist(data);
  },
  reset() { localStorage.removeItem(PLAY_STORAGE_KEY); },
};

function tryStartGame(fromScene, stopScenes = []) {
  if (!DailyPlays.canPlay()) {
    stopScenes.forEach(k => fromScene.scene.stop(k));
    fromScene.scene.start('DailyLimitScene');
    return;
  }
  DailyPlays.record();
  stopScenes.forEach(k => fromScene.scene.stop(k));
  fromScene.scene.start('GameScene');
}

// ── Board helpers ─────────────────────────────────────────────
function cellCenter(col, row) {
  return {
    x: BOARD_LEFT + (col + 0.5) * CELL_PX,
    y: BOARD_TOP + (row + 0.5) * CELL_PX,
  };
}

function getValidMoves(col, row) {
  return KNIGHT_OFFSETS
    .map(([dc, dr]) => ({ col: col + dc, row: row + dr }))
    .filter(({ col: c, row: r }) => c >= 0 && c < BOARD_SIZE && r >= 0 && r < BOARD_SIZE);
}

function colRowFromPoint(x, y) {
  const col = Math.floor((x - BOARD_LEFT) / CELL_PX);
  const row = Math.floor((y - BOARD_TOP) / CELL_PX);
  if (col < 0 || col >= BOARD_SIZE || row < 0 || row >= BOARD_SIZE) return null;
  return { col, row };
}

function lerpColor(c1, c2, t) {
  const a = Phaser.Display.Color.ValueToColor(c1);
  const b = Phaser.Display.Color.ValueToColor(c2);
  const r = Phaser.Display.Color.Interpolate.ColorWithColor(a, b, 100, Math.floor(t * 100));
  return Phaser.Display.Color.GetColor(r.r, r.g, r.b);
}

function timerBarColor(ratio) {
  if (ratio > 0.5) return '#ffd700';
  if (ratio > 0.25) return '#ff8800';
  return '#ff3333';
}

// ── Visual helpers ────────────────────────────────────────────
function makeGradientTexture(scene, key, topHex, bottomHex) {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  const steps = 40;
  for (let i = 0; i < steps; i++) {
    g.fillStyle(lerpColor(topHex, bottomHex, i / (steps - 1)));
    g.fillRect(0, Math.floor(i * GH / steps), GW, Math.ceil(GH / steps) + 1);
  }
  g.generateTexture(key, GW, GH);
  g.destroy();
}

function addPinkBackground(scene, depth = -100) {
  makeGradientTexture(scene, 'bgGrad', C.bgTop, C.bgBottom);
  scene.add.image(GW / 2, GH / 2, 'bgGrad').setDepth(depth);
}

function buildStyledPlayButton(scene, x, y, radius, onTap) {
  const glow = scene.add.circle(x, y, radius + 14, 0xff6eb4, 0.25);
  scene.tweens.add({ targets: glow, scale: 1.15, alpha: 0.12, duration: 700, yoyo: true, repeat: -1 });
  const shadow = scene.add.ellipse(x, y + radius * 0.55, radius * 1.6, radius * 0.35, 0x000000, 0.15);
  const btn = scene.add.circle(x, y, radius, 0xff6eb4).setInteractive({ useHandCursor: true });
  scene.add.circle(x, y - radius * 0.22, radius * 0.72, 0xffb3e0, 0.45);
  const icon = scene.add.text(x, y + 2, '\u25B6', {
    fontSize: Math.floor(radius * 0.75) + 'px', color: '#ffffff',
  }).setOrigin(0.5);
  scene.tweens.add({ targets: btn, scale: 1.06, duration: 550, yoyo: true, repeat: -1 });
  btn.on('pointerdown', onTap);
  return btn;
}

function makeTextures(scene) {
  if (!scene.textures.exists('knight')) {
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    const w = 48;
    const h = 52;
    g.fillStyle(C.knightShadow, 1);
    g.fillEllipse(26, 44, 20, 8);
    g.fillStyle(C.knightShadow, 1);
    g.beginPath();
    g.moveTo(8, 42);
    g.lineTo(10, 28);
    g.lineTo(14, 18);
    g.lineTo(22, 10);
    g.lineTo(34, 8);
    g.lineTo(40, 14);
    g.lineTo(42, 22);
    g.lineTo(38, 30);
    g.lineTo(30, 36);
    g.lineTo(18, 40);
    g.closePath();
    g.fillPath();
    g.fillStyle(C.knight, 1);
    g.beginPath();
    g.moveTo(6, 40);
    g.lineTo(8, 26);
    g.lineTo(12, 16);
    g.lineTo(20, 8);
    g.lineTo(32, 6);
    g.lineTo(38, 12);
    g.lineTo(40, 20);
    g.lineTo(36, 28);
    g.lineTo(28, 34);
    g.lineTo(16, 38);
    g.closePath();
    g.fillPath();
    g.fillStyle(C.knightShadow, 1);
    g.beginPath();
    g.moveTo(12, 14);
    g.quadraticCurveTo(8, 6, 14, 4);
    g.quadraticCurveTo(18, 8, 16, 16);
    g.closePath();
    g.fillPath();
    g.fillStyle(0xffffff, 1);
    g.fillCircle(34, 14, 3);
    g.fillStyle(0x333333, 1);
    g.fillCircle(35, 14, 1.5);
    g.generateTexture('knight', w, h);
    g.destroy();
  }

  if (!scene.textures.exists('coin')) {
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    const r = 18;
    g.fillStyle(0xc9a020, 1);
    g.fillCircle(r, r, r);
    g.fillStyle(0xffd700, 1);
    g.fillCircle(r, r, r - 2);
    g.fillStyle(0xffee88, 0.7);
    g.fillEllipse(r - 5, r - 6, 8, 6);
    g.lineStyle(2, 0xffaa00, 0.6);
    g.strokeCircle(r, r, r - 2);
    g.generateTexture('coin', r * 2, r * 2);
    g.destroy();
  }
}

function addDecorativeStrip(scene) {
  const y = BOARD_TOP + BOARD_PX + 14;
  const colors = [0xff6eb4, 0xffd700, 0xffb3d9, 0xc878d8, 0xffee88];
  for (let i = 0; i < 12; i++) {
    const x = BOARD_LEFT + (i + 0.5) * (BOARD_PX / 12);
    scene.add.circle(x, y, 6, colors[i % colors.length], 0.7);
  }
}

function spawnConfetti(scene, count = 28) {
  const colors = [0xff6eb4, 0xffd700, 0xffb3d9, 0xc878d8, 0xffee88];
  for (let i = 0; i < count; i++) {
    const piece = scene.add.circle(
      Phaser.Math.Between(40, GW - 40), -20,
      Phaser.Math.Between(4, 10), colors[i % colors.length], 0.9
    );
    scene.tweens.add({
      targets: piece,
      y: GH + 30,
      angle: Phaser.Math.Between(-360, 360),
      duration: Phaser.Math.Between(2000, 4000),
      delay: Phaser.Math.Between(0, 1200),
      onComplete: () => piece.destroy(),
    });
  }
}

function starCountForScore(score) {
  if (score >= 10) return 3;
  if (score >= 5) return 2;
  return 1;
}

// ── Menu ─────────────────────────────────────────────────────
class MenuScene extends Phaser.Scene {
  constructor() { super('MenuScene'); }

  preload() { makeTextures(this); }

  create() {
    addPinkBackground(this);

    const knight = this.add.image(GW / 2, GH / 2 - 130, 'knight').setScale(2.5);
    this.tweens.add({
      targets: knight, y: knight.y - 8, duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.inOut',
    });

    this.add.text(GW / 2, GH / 2 - 20, 'Pink Knight Hop', {
      fontSize: '46px', fontFamily: 'Arial Black, sans-serif',
      color: '#ffd700', stroke: '#ff6eb4', strokeThickness: 8,
    }).setOrigin(0.5);

    this.add.text(GW / 2, GH / 2 + 36, '\uD83E\uDE99  Collect coins!', {
      fontSize: '22px', fontFamily: 'Arial, sans-serif', color: '#ffffff',
    }).setOrigin(0.5);

    const rem = DailyPlays.remaining();
    const startX = GW / 2 - (MAX_PLAYS_PER_DAY - 1) * 22;
    for (let i = 0; i < MAX_PLAYS_PER_DAY; i++) {
      this.add.text(startX + i * 44, GH / 2 + 78, i < rem ? '\u2B50' : '\u2606', {
        fontSize: '28px', color: i < rem ? '#ffd700' : '#ffffff44',
      }).setOrigin(0.5);
    }

    buildStyledPlayButton(this, GW / 2, GH / 2 + 150, 64, () => tryStartGame(this));

    const versionLabel = this.add.text(8, GH - 6, 'v' + VERSION, {
      fontSize: '13px', fontFamily: 'monospace', color: '#ffffff88',
    }).setOrigin(0, 1).setInteractive();
    let holdEvt = null;
    versionLabel.on('pointerdown', () => {
      holdEvt = this.time.delayedCall(3000, () => { DailyPlays.reset(); this.scene.restart(); });
    });
    const cancelHold = () => { if (holdEvt) { holdEvt.remove(); holdEvt = null; } };
    versionLabel.on('pointerup', cancelHold);
    versionLabel.on('pointerout', cancelHold);
  }
}

// ── Main game ─────────────────────────────────────────────────
class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  preload() { makeTextures(this); }

  create() {
    addPinkBackground(this);
    this.score = 0;
    this.knightCol = 3;
    this.knightRow = 3;
    this.isJumping = false;
    this.isOver = false;
    this.timeRemaining = GAME_SECONDS;
    this.startTime = this.time.now;
    this.lastTickSecond = -1;
    this.validMoves = [];

    this.buildBoard();
    this.buildHUD();
    this.buildTimerBar();
    addDecorativeStrip(this);

    const { x, y } = cellCenter(this.knightCol, this.knightRow);
    this.knight = this.add.image(x, y, 'knight').setDepth(20);
    this.knight.setScale(CELL_PX / 52);

    this.highlightLayer = this.add.container(0, 0).setDepth(5);
    this.coinSprite = null;
    this.spawnCoin();

    this.refreshHighlights();

    this.input.on('pointerdown', (pointer) => this.onBoardTap(pointer.x, pointer.y));
  }

  buildBoard() {
    const frame = this.add.graphics().setDepth(1);
    frame.lineStyle(5, 0xffd700, 0.8);
    frame.strokeRoundedRect(BOARD_LEFT - 6, BOARD_TOP - 6, BOARD_PX + 12, BOARD_PX + 12, 12);
    frame.lineStyle(2, C.purple, 0.5);
    frame.strokeRoundedRect(BOARD_LEFT - 3, BOARD_TOP - 3, BOARD_PX + 6, BOARD_PX + 6, 10);

    this.cellRects = [];
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const light = (col + row) % 2 === 0;
        const color = light ? C.pink : C.cream;
        const { x, y } = cellCenter(col, row);
        const rect = this.add.rectangle(x, y, CELL_PX - 2, CELL_PX - 2, color).setDepth(2);
        rect.setData('col', col);
        rect.setData('row', row);
        this.cellRects.push(rect);
      }
    }
  }

  buildHUD() {
    this.add.image(28, HUD_H / 2, 'coin').setScale(0.9).setDepth(30);
    this.scoreText = this.add.text(52, HUD_H / 2, '0', {
      fontSize: '32px', fontFamily: 'Arial Black, sans-serif', color: '#ffd700',
      stroke: '#6b3fa0', strokeThickness: 4,
    }).setOrigin(0, 0.5).setDepth(30);
  }

  buildTimerBar() {
    const barY = HUD_H + TIMER_H / 2;
    this.timerBarX = BOARD_LEFT;
    this.timerBarY = barY;
    this.timerBarW = BOARD_PX;

    this.timerBarBg = this.add.graphics().setDepth(30);
    this.timerBarFill = this.add.graphics().setDepth(31);
    this.drawTimerBar(1);
  }

  drawTimerBar(ratio) {
    const x = this.timerBarX;
    const y = this.timerBarY - TIMER_BAR_H / 2;
    const w = this.timerBarW;
    const h = TIMER_BAR_H;
    const fillW = Math.max(0, w * ratio);
    const color = Phaser.Display.Color.HexStringToColor(timerBarColor(ratio)).color;

    this.timerBarBg.clear();
    this.timerBarBg.fillStyle(0x2d1b69, 0.6);
    this.timerBarBg.fillRoundedRect(x - 2, y - 2, w + 4, h + 4, 10);
    this.timerBarBg.lineStyle(2, 0x4a2060, 0.9);
    this.timerBarBg.strokeRoundedRect(x - 2, y - 2, w + 4, h + 4, 10);

    this.timerBarFill.clear();
    if (fillW > 0) {
      this.timerBarFill.fillStyle(color, 1);
      this.timerBarFill.fillRoundedRect(x, y, fillW, h, 8);
    }
  }

  refreshHighlights() {
    this.validMoves = getValidMoves(this.knightCol, this.knightRow);
    this.highlightLayer.removeAll(true);

    this.validMoves.forEach(({ col, row }) => {
      const { x, y } = cellCenter(col, row);
      const glow = this.add.circle(x, y, CELL_PX * 0.38, 0xffd700, 0.35);
      const ring = this.add.circle(x, y, CELL_PX * 0.32, 0xffee88, 0.2);
      ring.setStrokeStyle(2, 0xffd700, 0.7);
      this.highlightLayer.add([glow, ring]);
      this.tweens.add({
        targets: [glow, ring],
        scale: 1.08,
        alpha: { from: 0.35, to: 0.55 },
        duration: 600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      });
    });
  }

  spawnCoin() {
    if (this.coinSprite) {
      this.coinSprite.destroy();
      this.coinSprite = null;
    }
    const occupied = new Set([`${this.knightCol},${this.knightRow}`]);
    const empties = [];
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const key = `${col},${row}`;
        if (!occupied.has(key)) empties.push({ col, row });
      }
    }
    if (!empties.length) return;
    const spot = Phaser.Utils.Array.GetRandom(empties);
    const { x, y } = cellCenter(spot.col, spot.row);
    this.coinCol = spot.col;
    this.coinRow = spot.row;
    this.coinSprite = this.add.image(x, y, 'coin').setDepth(15).setScale(CELL_PX / 40);
    this.tweens.add({
      targets: this.coinSprite,
      y: y - 4,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
    this.tweens.add({
      targets: this.coinSprite,
      angle: 360,
      duration: 4000,
      repeat: -1,
    });
  }

  onBoardTap(x, y) {
    if (this.isOver || this.isJumping) return;
    const cell = colRowFromPoint(x, y);
    if (!cell) return;
    const valid = this.validMoves.some(m => m.col === cell.col && m.row === cell.row);
    if (!valid) return;
    this.jumpTo(cell.col, cell.row);
  }

  jumpTo(col, row) {
    this.isJumping = true;
    SFX.jump();
    const from = cellCenter(this.knightCol, this.knightRow);
    const to = cellCenter(col, row);
    this.knightCol = col;
    this.knightRow = row;

    this.tweens.add({
      targets: this.knight,
      x: to.x,
      y: to.y,
      duration: 180,
      ease: 'Quad.out',
      onComplete: () => {
        this.isJumping = false;
        this.refreshHighlights();
        if (this.coinSprite && col === this.coinCol && row === this.coinRow) {
          this.collectCoin();
        }
      },
    });
    this.tweens.add({
      targets: this.knight,
      scaleX: this.knight.scaleX * 1.15,
      scaleY: this.knight.scaleY * 1.15,
      duration: 90,
      yoyo: true,
      ease: 'Sine.out',
    });
  }

  collectCoin() {
    if (!this.coinSprite) return;
    const { x, y } = cellCenter(this.coinCol, this.coinRow);
    this.coinSprite.destroy();
    this.coinSprite = null;
    this.score++;
    this.scoreText.setText(String(this.score));
    SFX.coin();

    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 * i) / 6;
      const dot = this.add.circle(x, y, 5, 0xffd700, 1).setDepth(25);
      this.tweens.add({
        targets: dot,
        x: x + Math.cos(angle) * 36,
        y: y + Math.sin(angle) * 36,
        alpha: 0,
        scale: 0.2,
        duration: 350,
        onComplete: () => dot.destroy(),
      });
    }

    this.spawnCoin();
  }

  endGame() {
    if (this.isOver) return;
    this.isOver = true;
    if (this.score >= 10) SFX.endWin();
    else SFX.endBoop();
    this.time.delayedCall(400, () => {
      this.scene.start('EndScene', { score: this.score });
    });
  }

  update() {
    if (this.isOver) return;

    const elapsed = (this.time.now - this.startTime) / 1000;
    this.timeRemaining = Math.max(0, GAME_SECONDS - elapsed);
    const ratio = this.timeRemaining / GAME_SECONDS;
    this.drawTimerBar(ratio);

    if (this.timeRemaining <= 5 && this.timeRemaining > 0) {
      const sec = Math.ceil(this.timeRemaining);
      if (sec !== this.lastTickSecond) {
        this.lastTickSecond = sec;
        SFX.tick();
      }
      const shake = Math.sin(this.time.now / 40) * 2;
      this.timerBarFill.x = shake;
      this.timerBarBg.x = shake;
    } else {
      this.timerBarFill.x = 0;
      this.timerBarBg.x = 0;
    }

    if (this.timeRemaining <= 0) this.endGame();
  }
}

// ── End screen ────────────────────────────────────────────────
class EndScene extends Phaser.Scene {
  constructor() { super('EndScene'); }

  preload() { makeTextures(this); }

  create(data) {
    const score = (data && data.score) || 0;
    addPinkBackground(this);
    this.add.rectangle(GW / 2, GH / 2, GW, GH, 0x2d1b69, 0.4);

    if (score >= 15) spawnConfetti(this);

    this.add.text(GW / 2, GH / 2 - 130, "\u23F0", { fontSize: '64px' }).setOrigin(0.5);
    this.add.text(GW / 2, GH / 2 - 60, "Time's up!", {
      fontSize: '40px', fontFamily: 'Arial Black, sans-serif',
      color: '#ffb3d9', stroke: '#ffffff', strokeThickness: 5,
    }).setOrigin(0.5);

    this.add.image(GW / 2 - 50, GH / 2 + 10, 'coin').setScale(1.4);
    this.add.text(GW / 2 + 20, GH / 2 + 10, String(score), {
      fontSize: '64px', fontFamily: 'Arial Black, sans-serif', color: '#ffd700',
      stroke: '#6b3fa0', strokeThickness: 6,
    }).setOrigin(0, 0.5);

    const stars = starCountForScore(score);
    for (let i = 0; i < 3; i++) {
      this.add.text(GW / 2 - 44 + i * 44, GH / 2 + 80, i < stars ? '\u2B50' : '\u2606', {
        fontSize: '36px', color: i < stars ? '#ffd700' : '#ffffff44',
      }).setOrigin(0.5);
    }

    buildStyledPlayButton(this, GW / 2 - 80, GH / 2 + 160, 52, () => tryStartGame(this, ['EndScene']));

    const home = this.add.circle(GW / 2 + 80, GH / 2 + 160, 48, 0xc878d8)
      .setInteractive({ useHandCursor: true });
    home.setStrokeStyle(2, 0xffffff, 0.4);
    this.add.text(GW / 2 + 80, GH / 2 + 160, '\u2B50', { fontSize: '32px' }).setOrigin(0.5);
    home.on('pointerdown', () => this.scene.start('MenuScene'));
  }
}

// ── Daily limit screen ─────────────────────────────────────────
class DailyLimitScene extends Phaser.Scene {
  constructor() { super('DailyLimitScene'); }

  preload() { makeTextures(this); }

  create() {
    addPinkBackground(this);
    this.add.rectangle(GW / 2, GH / 2, GW, GH, 0x2d1b69, 0.45);

    for (let i = 0; i < 8; i++) {
      this.add.text(Phaser.Math.Between(60, GW - 60), Phaser.Math.Between(40, 200), '\u2728', {
        fontSize: Phaser.Math.Between(18, 28) + 'px', color: '#ffffff55',
      }).setOrigin(0.5);
    }

    const moon = this.add.text(GW / 2, GH / 2 - 100, '\uD83C\uDF19', { fontSize: '96px' })
      .setOrigin(0.5).setInteractive();
    this.add.text(GW / 2, GH / 2 + 10, '\u00A1Hasta ma\u00F1ana!', {
      fontSize: '44px', fontFamily: 'Arial Black, sans-serif',
      color: '#f8b4e8', stroke: '#2d1b69', strokeThickness: 6,
    }).setOrigin(0.5);
    this.add.text(GW / 2, GH / 2 + 80, '\uD83D\uDE34', { fontSize: '48px' }).setOrigin(0.5);

    const home = this.add.circle(GW / 2, GH / 2 + 170, 52, 0xff6eb4)
      .setInteractive({ useHandCursor: true });
    home.setStrokeStyle(2, 0xffffff, 0.35);
    this.add.text(GW / 2, GH / 2 + 170, '\u2B50', { fontSize: '40px' }).setOrigin(0.5);
    home.on('pointerdown', () => this.scene.start('MenuScene'));

    this.add.text(8, GH - 6, 'v' + VERSION, {
      fontSize: '13px', fontFamily: 'monospace', color: '#ffffff44',
    }).setOrigin(0, 1);

    let holdEvt = null;
    moon.on('pointerdown', () => {
      holdEvt = this.time.delayedCall(3000, () => { DailyPlays.reset(); this.scene.start('MenuScene'); });
    });
    const cancelHold = () => { if (holdEvt) { holdEvt.remove(); holdEvt = null; } };
    moon.on('pointerup', cancelHold);
    moon.on('pointerout', cancelHold);
  }
}

// ── Boot ──────────────────────────────────────────────────────
new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#4a2060',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GW,
    height: GH,
  },
  scene: [MenuScene, GameScene, EndScene, DailyLimitScene],
});
