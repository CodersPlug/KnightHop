// =============================================================
//  Pink Knight Hop — v1.4  (goal-based: collect 10 coins)
// =============================================================

const GW = 1024;
const GH = 576;
const VERSION = '1.5';
const HINT_IDLE_MS = 4000; // show solution-path hint after this many ms of no taps
const GAME_ID = 'knightHop';
const PLAY_STORAGE_KEY = 'phaserlab_daily_plays';
const MAX_PLAYS_PER_DAY = 5;

const BOARD_SIZE = 8;
const COIN_GOAL = 10;
const HUD_H = 58;
const BOARD_TOP = HUD_H + 10;
const BOARD_PX = Math.min(GW - 40, GH - BOARD_TOP - 20);
const BOARD_LEFT = (GW - BOARD_PX) / 2;
const CELL_PX = BOARD_PX / BOARD_SIZE;

const KNIGHT_OFFSETS = [
  [-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1],
];

const C = {
  light:      0xffe8f0,  // light board square
  dark:       0xf5c0d8,  // dark board square
  knight:     0xff6eb4,
  knightDark: 0xe04090,
  gold:       0xffd700,
  goldDark:   0xcc9900,
  jumpGreen:  0x44dd44,  // valid-move highlight fill
  jumpDark:   0x229922,  // valid-move border
  coinReach:  0xffee00,  // cell tint when coin is reachable
  purple:     0x6b3fa0,
};

// ── SFX ──────────────────────────────────────────────────────
const SFX = (() => {
  let ctx = null;
  const get = () => { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); return ctx; };
  const tone = (f, fe, type, dur, vol) => {
    try {
      const c=get(), o=c.createOscillator(), g=c.createGain();
      o.connect(g); g.connect(c.destination);
      o.type = type||'sine';
      o.frequency.setValueAtTime(f, c.currentTime);
      if (fe) o.frequency.exponentialRampToValueAtTime(fe, c.currentTime+dur);
      g.gain.setValueAtTime(vol||0.22, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime+dur);
      o.start(c.currentTime); o.stop(c.currentTime+dur+0.01);
    } catch(_) {}
  };
  return {
    coin:   () => { tone(660,1320,'sine',0.08,0.24); setTimeout(()=>tone(880,1760,'sine',0.12,0.2),80); },
    jump:   () => tone(180,120,'triangle',0.08,0.14),
    win:    () => { [523,659,784,1046].forEach((f,i)=>setTimeout(()=>tone(f,f,'sine',0.18,0.28),i*110)); },
    hint:   () => tone(880,1100,'sine',0.06,0.1),
  };
})();

// ── Daily play limit ──────────────────────────────────────────
const DailyPlays = {
  today() { return new Date().toISOString().slice(0,10); },
  load() {
    const empty={date:this.today(),count:0,versions:{}};
    try {
      const raw=localStorage.getItem(PLAY_STORAGE_KEY);
      if (!raw) return empty;
      const data=JSON.parse(raw);
      if (!data.versions) data.versions={};
      let dirty=false;
      if (data.date!==this.today()){data.date=this.today();data.count=0;dirty=true;}
      if (data.versions[GAME_ID]!==VERSION){data.count=0;data.versions[GAME_ID]=VERSION;dirty=true;}
      if (dirty) this.persist(data);
      return data;
    } catch(_){return empty;}
  },
  persist(data) { if(!data.versions)data.versions={}; data.versions[GAME_ID]=VERSION; localStorage.setItem(PLAY_STORAGE_KEY,JSON.stringify(data)); },
  remaining() { return Math.max(0,MAX_PLAYS_PER_DAY-this.load().count); },
  canPlay()   { return this.remaining()>0; },
  record()    { const d=this.load(); d.count++; this.persist(d); },
  reset()     { localStorage.removeItem(PLAY_STORAGE_KEY); },
};

function tryStartGame(scene, stop=[]) {
  if (!DailyPlays.canPlay()) { stop.forEach(k=>scene.scene.stop(k)); scene.scene.start('DailyLimitScene'); return; }
  DailyPlays.record();
  stop.forEach(k=>scene.scene.stop(k));
  scene.scene.start('GameScene');
}

// ── Board helpers ─────────────────────────────────────────────
function cellCenter(col,row) {
  return { x: BOARD_LEFT+(col+0.5)*CELL_PX, y: BOARD_TOP+(row+0.5)*CELL_PX };
}
function getValidMoves(col,row) {
  return KNIGHT_OFFSETS.map(([dc,dr])=>({col:col+dc,row:row+dr}))
    .filter(({col:c,row:r})=>c>=0&&c<BOARD_SIZE&&r>=0&&r<BOARD_SIZE);
}
function colRowFromPoint(x,y) {
  const col=Math.floor((x-BOARD_LEFT)/CELL_PX);
  const row=Math.floor((y-BOARD_TOP)/CELL_PX);
  if (col<0||col>=BOARD_SIZE||row<0||row>=BOARD_SIZE) return null;
  return {col,row};
}
// Shortest knight-move path from (startCol,startRow) to (goalCol,goalRow), BFS.
// Returns an array of {col,row} including both endpoints, or null if none.
function bfsKnightPath(startCol,startRow,goalCol,goalRow) {
  if (startCol===goalCol && startRow===goalRow) return [{col:startCol,row:startRow}];
  const key=(c,r)=>c+','+r;
  const visited=new Set([key(startCol,startRow)]);
  const prev=new Map();
  const queue=[{col:startCol,row:startRow}];
  while (queue.length) {
    const cur=queue.shift();
    for (const {col,row} of getValidMoves(cur.col,cur.row)) {
      const k=key(col,row);
      if (visited.has(k)) continue;
      visited.add(k);
      prev.set(k,cur);
      if (col===goalCol && row===goalRow) {
        const path=[{col,row}];
        let ck=k;
        while (prev.has(ck)) {
          const p=prev.get(ck);
          path.unshift(p);
          ck=key(p.col,p.row);
        }
        return path;
      }
      queue.push({col,row});
    }
  }
  return null;
}

// ── Textures ──────────────────────────────────────────────────
function makeTextures(scene) {
  // Knight body + kid face overlay (shared KidAvatar)
  if (scene.textures.exists('knight')) scene.textures.remove('knight');
  {
    const g = scene.make.graphics({x:0,y:0,add:false});
    g.fillStyle(C.knightDark,1); g.fillEllipse(24,50,20,6);
    g.fillStyle(C.knightDark,1); g.fillRoundedRect(10,20,28,28,10);
    g.fillStyle(C.knight,1);     g.fillRoundedRect(8,16,30,30,12);
    g.fillStyle(C.knightDark,1); g.fillTriangle(8,20,4,6,16,16);
    g.fillStyle(C.knight,1);     g.fillTriangle(10,18,6,4,18,14);
    g.fillStyle(C.knightDark,1); g.fillRoundedRect(34,10,10,14,4);
    if (typeof KidAvatar !== 'undefined') {
      KidAvatar.drawHead(g, 26, 26, 12, KidAvatar.load());
    } else {
      g.fillStyle(0xffffff,1); g.fillCircle(30,24,5);
      g.fillStyle(0x333333,1); g.fillCircle(31,24,2.5);
    }
    g.generateTexture('knight',52,56);
    g.destroy();
  }

  // Coin — big shiny gold star-coin
  if (!scene.textures.exists('coin')) {
    const g = scene.make.graphics({x:0,y:0,add:false});
    const r=22;
    g.fillStyle(C.goldDark,1); g.fillCircle(r,r,r);
    g.fillStyle(C.gold,1);     g.fillCircle(r,r,r-2);
    g.fillStyle(0xffff88,0.9); g.fillCircle(r-6,r-7,7);   // big shine
    g.fillStyle(0xffffff,0.6); g.fillCircle(r-8,r-9,3);   // tiny shine
    g.lineStyle(3,C.goldDark,1); g.strokeCircle(r,r,r-2);
    // $ symbol in gold coin
    g.fillStyle(C.goldDark,0.7);
    g.fillRect(r-2,r-9,4,18);
    g.fillRect(r-6,r-9,12,4);
    g.fillRect(r-6,r-1,12,4);
    g.fillRect(r-6,r+5,12,4);
    g.generateTexture('coin',r*2,r*2);
    g.destroy();
  }
}

// ── Play button ───────────────────────────────────────────────
function buildPlayButton(scene, x, y, radius, onTap) {
  const glow = scene.add.circle(x,y,radius+16,0xff6eb4,0.25);
  scene.tweens.add({targets:glow,scale:1.18,alpha:0.1,duration:700,yoyo:true,repeat:-1});
  scene.add.ellipse(x,y+radius*0.55,radius*1.6,radius*0.35,0x000000,0.15);
  const btn = scene.add.circle(x,y,radius,0xff6eb4).setInteractive({useHandCursor:true});
  scene.add.circle(x,y-radius*0.22,radius*0.72,0xffb3e0,0.45);
  scene.add.text(x,y+3,'▶',{fontSize:Math.floor(radius*0.75)+'px',color:'#ffffff'}).setOrigin(0.5);
  scene.tweens.add({targets:btn,scale:1.08,duration:550,yoyo:true,repeat:-1});
  btn.on('pointerdown',onTap);
  return btn;
}

function addBg(scene) {
  scene.add.rectangle(GW/2,GH/2,GW,GH,0xf8b4e8).setDepth(-100);
  scene.add.rectangle(GW/2,GH*0.3,GW,GH*0.55,0xc878d8,0.55).setDepth(-100);
}

// ── MENU ─────────────────────────────────────────────────────
class MenuScene extends Phaser.Scene {
  constructor() { super('MenuScene'); }
  preload() { makeTextures(this); }
  create() {
    addBg(this);

    // Mini tutorial strip — board squares demo
    this._buildHowToPlay();

    this.add.text(GW/2, 42, '🪙 × 10 = 🏆', {
      fontSize:'26px', fontFamily:'Arial Black, sans-serif',
      color:'#ffffff', stroke:'#6b3fa0', strokeThickness:5,
    }).setOrigin(0.5).setY(GH/2 + 110);

    this.add.text(GW/2, 42, 'Pink Knight Hop', {
      fontSize:'40px', fontFamily:'Arial Black, sans-serif',
      color:'#ffd700', stroke:'#ff6eb4', strokeThickness:8,
    }).setOrigin(0.5);

    const rem = DailyPlays.remaining();
    const sx = GW/2-(MAX_PLAYS_PER_DAY-1)*22;
    for (let i=0;i<MAX_PLAYS_PER_DAY;i++) {
      this.add.text(sx+i*44, GH-52, i<rem?'⭐':'☆', {
        fontSize:'28px', color: i<rem?'#ffd700':'#ffffff44',
      }).setOrigin(0.5);
    }

    buildPlayButton(this, GW/2, GH-80, 52, ()=>tryStartGame(this));

    const vl = this.add.text(8,GH-6,'v'+VERSION,{fontSize:'13px',fontFamily:'monospace',color:'#ffffff88'})
      .setOrigin(0,1).setInteractive();
    let hold=null;
    vl.on('pointerdown',()=>{ hold=this.time.delayedCall(3000,()=>{DailyPlays.reset();this.scene.restart();}); });
    const cancel=()=>{ if(hold){hold.remove();hold=null;} };
    vl.on('pointerup',cancel); vl.on('pointerout',cancel);
  }

  _buildHowToPlay() {
    // Show 3 demo squares + coin + arrow to explain the game
    const demoY = GH/2 - 10;
    const sq = 72, gap = 16;
    const labels = ['🐴','🟢','🏆'];
    const colors = [0xffe8f0, 0x44dd44, 0xffe8f0];
    const xPositions = [GW/2 - sq - gap, GW/2, GW/2 + sq + gap];

    // Outer wrapper
    this.add.rectangle(GW/2, demoY, sq*3+gap*4+40, sq+60, 0x000000, 0.25)
      .setStrokeStyle(2,0xffffff,0.2);

    this.add.text(GW/2, demoY - sq/2 - 18, '¿Cómo jugar?', {
      fontSize:'16px', fontFamily:'Arial Black', color:'#ffffff', stroke:'#000000', strokeThickness:3,
    }).setOrigin(0.5);

    xPositions.forEach((x,i) => {
      // Square
      this.add.rectangle(x, demoY, sq, sq, colors[i])
        .setStrokeStyle(3, i===1?C.jumpDark:0xaaaaaa, 1);
      // Icon
      this.add.text(x, demoY, labels[i], {fontSize:'36px'}).setOrigin(0.5);
      // Arrow between squares
      if (i<2) {
        this.add.text(x+sq/2+gap/2, demoY, '→', {
          fontSize:'26px', color:'#ffffff', stroke:'#000000', strokeThickness:3,
        }).setOrigin(0.5);
      }
    });

    // Captions
    ['Tu caballo','¡Saltá aquí!','¡Moneda!'].forEach((t,i) => {
      this.add.text(xPositions[i], demoY+sq/2+12, t, {
        fontSize:'12px', fontFamily:'Arial, sans-serif', color:'#ffffff',
        stroke:'#000000', strokeThickness:2,
      }).setOrigin(0.5);
    });

    // Animated bounce arrow pointing at the green square
    const arrow = this.add.text(xPositions[1], demoY-sq/2-30, '👆', {fontSize:'30px'}).setOrigin(0.5);
    this.tweens.add({targets:arrow, y:arrow.y+8, duration:500, yoyo:true, repeat:-1});
  }
}

// ── GAME ─────────────────────────────────────────────────────
class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }
  preload() { makeTextures(this); }

  create() {
    addBg(this);
    this.score = 0;
    this.knightCol = 3;
    this.knightRow = 3;
    this.isJumping = false;
    this.isOver = false;
    this.validMoves = [];
    this.coinCol = -1;
    this.coinRow = -1;
    this.hintMarkers = [];
    this.hintTweens = [];
    this.idleTimer = null;

    this._buildBoard();
    this._buildHUD();

    // Knight sprite
    const { x, y } = cellCenter(this.knightCol, this.knightRow);
    this.knight = this.add.image(x, y, 'knight').setDepth(20).setScale(CELL_PX/56);

    // Coin sprite and sparkle ring
    this.coinSprite = null;
    this.coinRing = null;
    this._spawnCoin();
    this._refreshHighlights();

    // "Tap a green square!" hint — shown for first 3 seconds
    this.hintText = this.add.text(GW/2, BOARD_TOP + BOARD_PX + 14, '👆 ¡Tocá un cuadrado verde!', {
      fontSize:'20px', fontFamily:'Arial Black, sans-serif',
      color:'#44dd44', stroke:'#000000', strokeThickness:4,
    }).setOrigin(0.5).setDepth(50);
    this.tweens.add({ targets:this.hintText, alpha:{from:0.5,to:1}, duration:400, yoyo:true, repeat:-1 });
    this.time.delayedCall(3500, () => {
      this.tweens.add({ targets:this.hintText, alpha:0, duration:600, onComplete:()=>this.hintText.destroy() });
    });

    this.input.on('pointerdown', (p) => this._onTap(p.x, p.y));
    this._armIdleHint();
  }

  // ── Idle hint: after a few quiet seconds, reveal the path to the coin ──
  _armIdleHint() {
    if (this.idleTimer) { this.idleTimer.remove(); this.idleTimer = null; }
    this.idleTimer = this.time.delayedCall(HINT_IDLE_MS, () => this._showHint());
  }

  _clearHintMarkers() {
    this.hintMarkers.forEach(o => o.destroy());
    this.hintMarkers = [];
    this.hintTweens.forEach(t => t.stop());
    this.hintTweens = [];
  }

  _showHint() {
    if (this.isOver || this.isJumping) { this._armIdleHint(); return; }
    this._clearHintMarkers();

    const directlyReachable = this.validMoves.some(m => m.col===this.coinCol && m.row===this.coinRow);
    if (directlyReachable) { this._armIdleHint(); return; } // already obvious — coin cell glows gold

    const path = bfsKnightPath(this.knightCol, this.knightRow, this.coinCol, this.coinRow);
    if (path && path.length >= 2) {
      SFX.hint();
      this._drawHintPath(path);
    }
    this._armIdleHint(); // keep refreshing until the player moves
  }

  _drawHintPath(path) {
    // path[0] = knight's current cell. path[1] = the next square to tap (already
    // a legal move, highlighted green). path[2+] = the rest of the route preview.
    const next = path[1];
    const { x: nx, y: ny } = cellCenter(next.col, next.row);

    const ring = this.add.circle(nx, ny, CELL_PX*0.4, 0x00e5ff, 0)
      .setStrokeStyle(5, 0x00e5ff, 1).setDepth(12);
    const ringTween = this.tweens.add({
      targets: ring, scale: { from:0.85, to:1.18 }, alpha: { from:0.9, to:0.25 },
      duration: 480, yoyo: true, repeat: -1,
    });

    const arrow = this.add.text(nx, ny - CELL_PX*0.72, '⬇️', {
      fontSize: Math.floor(CELL_PX*0.42)+'px',
    }).setOrigin(0.5).setDepth(13);
    const arrowTween = this.tweens.add({
      targets: arrow, y: ny - CELL_PX*0.5, duration: 420, yoyo: true, repeat: -1,
    });

    this.hintMarkers.push(ring, arrow);
    this.hintTweens.push(ringTween, arrowTween);

    // Faint numbered footprints for the rest of the route, if the coin is more
    // than one jump away — shows the whole solution path, not just the next step.
    for (let i = 2; i < path.length; i++) {
      const { col, row } = path[i];
      const { x, y } = cellCenter(col, row);
      const dot = this.add.circle(x, y, CELL_PX*0.22, 0xffffff, 0.35)
        .setStrokeStyle(2, 0xffffff, 0.55).setDepth(11);
      const label = this.add.text(x, y, String(i), {
        fontSize: Math.floor(CELL_PX*0.22)+'px', fontFamily: 'Arial Black, sans-serif', color: '#6b3fa0',
      }).setOrigin(0.5).setDepth(12);
      this.hintMarkers.push(dot, label);
    }
  }

  _buildBoard() {
    // Frame
    const g = this.add.graphics().setDepth(1);
    g.lineStyle(5, C.gold, 0.9);
    g.strokeRoundedRect(BOARD_LEFT-6, BOARD_TOP-6, BOARD_PX+12, BOARD_PX+12, 12);

    // Cells — just plain light/dark, no tinting yet
    this.cellRects = [];
    for (let row=0;row<BOARD_SIZE;row++) {
      for (let col=0;col<BOARD_SIZE;col++) {
        const light = (col+row)%2===0;
        const {x,y} = cellCenter(col,row);
        const r = this.add.rectangle(x,y,CELL_PX-1,CELL_PX-1, light?C.light:C.dark).setDepth(2);
        r.setData('col',col); r.setData('row',row);
        this.cellRects.push(r);
      }
    }

    // Highlight layer — full-cell green fills drawn here
    this.hlGraphics = this.add.graphics().setDepth(3);
  }

  _buildHUD() {
    // Coin icon + "X / 10" progress display, centered at top
    this.add.image(GW/2 - 100, HUD_H/2, 'coin').setScale(0.9).setDepth(30);

    this.scoreText = this.add.text(GW/2 - 72, HUD_H/2, '0', {
      fontSize:'36px', fontFamily:'Arial Black, sans-serif',
      color:'#ffd700', stroke:'#6b3fa0', strokeThickness:4,
    }).setOrigin(0, 0.5).setDepth(30);

    this.add.text(GW/2 - 30, HUD_H/2, '/', {
      fontSize:'30px', fontFamily:'Arial Black', color:'#ffffff88',
    }).setOrigin(0, 0.5).setDepth(30);

    this.add.text(GW/2 + 4, HUD_H/2, String(COIN_GOAL), {
      fontSize:'36px', fontFamily:'Arial Black, sans-serif',
      color:'#ffffff', stroke:'#6b3fa0', strokeThickness:4,
    }).setOrigin(0, 0.5).setDepth(30);

    // Coin dots progress strip (10 hollow circles fill as you collect)
    this.coinDots = [];
    const dotSpacing = 28;
    const dotsX0 = GW/2 + 80;
    for (let i = 0; i < COIN_GOAL; i++) {
      const dot = this.add.circle(dotsX0 + i*dotSpacing, HUD_H/2, 9, C.gold, 0.2)
        .setStrokeStyle(2, C.gold, 0.7).setDepth(30);
      this.coinDots.push(dot);
    }
  }

  _updateProgressDots() {
    this.coinDots.forEach((dot, i) => {
      if (i < this.score) {
        dot.setFillStyle(C.gold, 1);
        dot.setStrokeStyle(2, C.goldDark, 1);
      }
    });
  }

  // ── Highlights: paint full cells green (and gold for reachable coin) ──
  _refreshHighlights() {
    this.validMoves = getValidMoves(this.knightCol, this.knightRow);
    this.hlGraphics.clear();

    // Kill old tween references
    if (this._hlTween) { this._hlTween.stop(); this._hlTween = null; }

    // Draw green fills
    this.validMoves.forEach(({col,row}) => {
      const {x,y} = cellCenter(col,row);
      const isCoin = (col===this.coinCol && row===this.coinRow);
      // Full-cell fill
      this.hlGraphics.fillStyle(isCoin ? C.coinReach : C.jumpGreen, 0.72);
      this.hlGraphics.fillRect(x-CELL_PX/2+1, y-CELL_PX/2+1, CELL_PX-2, CELL_PX-2);
      // Thick border
      this.hlGraphics.lineStyle(4, isCoin ? C.goldDark : C.jumpDark, 1);
      this.hlGraphics.strokeRect(x-CELL_PX/2+2, y-CELL_PX/2+2, CELL_PX-4, CELL_PX-4);
    });

    // Pulse the highlight layer alpha
    this._hlTween = this.tweens.add({
      targets: this.hlGraphics,
      alpha: { from:0.8, to:1 },
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
  }

  _spawnCoin() {
    if (this.coinSprite) { this.coinSprite.destroy(); this.coinSprite=null; }
    if (this.coinRing)   { this.coinRing.destroy();   this.coinRing=null;   }
    if (this._ringTween) { this._ringTween.stop(); this._ringTween=null; }

    const occupied = new Set([`${this.knightCol},${this.knightRow}`]);
    const empties = [];
    for (let row=0;row<BOARD_SIZE;row++)
      for (let col=0;col<BOARD_SIZE;col++)
        if (!occupied.has(`${col},${row}`)) empties.push({col,row});
    if (!empties.length) return;

    const spot = Phaser.Utils.Array.GetRandom(empties);
    const {x,y} = cellCenter(spot.col, spot.row);
    this.coinCol = spot.col;
    this.coinRow = spot.row;

    // Big pulsing ring around the coin
    this.coinRing = this.add.circle(x, y, CELL_PX*0.44, C.gold, 0.3)
      .setStrokeStyle(4, C.gold, 0.9).setDepth(14);
    this._ringTween = this.tweens.add({
      targets: this.coinRing,
      scale: { from:0.85, to:1.15 },
      alpha: { from:0.25, to:0.6 },
      duration: 550,
      yoyo: true,
      repeat: -1,
    });

    // Coin — bigger than before
    const scale = (CELL_PX*0.75) / 44;
    this.coinSprite = this.add.image(x,y,'coin').setDepth(15).setScale(scale);
    this.tweens.add({ targets:this.coinSprite, y:y-5, duration:700, yoyo:true, repeat:-1, ease:'Sine.inOut' });
    this.tweens.add({ targets:this.coinSprite, angle:8, duration:400, yoyo:true, repeat:-1 });
  }

  _onTap(x,y) {
    if (this.isOver||this.isJumping) return;
    this._clearHintMarkers();
    this._armIdleHint();
    const cell = colRowFromPoint(x,y);
    if (!cell) return;
    const valid = this.validMoves.some(m=>m.col===cell.col&&m.row===cell.row);
    if (!valid) {
      // Wiggle the knight to signal "wrong tap"
      this.tweens.add({ targets:this.knight, x:this.knight.x+6, duration:50, yoyo:true, repeat:3 });
      return;
    }
    this._jumpTo(cell.col, cell.row);
  }

  _jumpTo(col,row) {
    this.isJumping = true;
    SFX.jump();
    const to = cellCenter(col,row);
    this.knightCol = col;
    this.knightRow = row;

    // Arc jump: go up in the middle
    const midX = (this.knight.x + to.x)/2;
    const midY = Math.min(this.knight.y, to.y) - CELL_PX*0.6;
    this.tweens.add({
      targets: this.knight,
      x: [this.knight.x, midX, to.x],
      y: [this.knight.y, midY, to.y],
      duration: 220,
      ease: 'Quad.inOut',
      onComplete: () => {
        this.isJumping = false;
        const hasCoin = col===this.coinCol && row===this.coinRow;
        this._refreshHighlights();
        if (hasCoin) this._collectCoin();
        this._armIdleHint();
      },
    });
    // Squish on landing
    this.tweens.add({ targets:this.knight, scaleX:this.knight.scaleX*0.8, scaleY:this.knight.scaleY*1.2, duration:110, yoyo:true });
  }

  _collectCoin() {
    if (!this.coinSprite) return;
    const {x,y} = cellCenter(this.coinCol, this.coinRow);
    if (this.coinSprite) { this.coinSprite.destroy(); this.coinSprite=null; }
    if (this.coinRing)   { this.coinRing.destroy();   this.coinRing=null;   }
    this.score++;
    this.scoreText.setText(String(this.score));
    SFX.coin();
    this._updateProgressDots();

    // Score pop
    const pop = this.add.text(x,y-16,'+1',{
      fontSize:'26px', fontFamily:'Arial Black', color:'#ffd700', stroke:'#000000', strokeThickness:4,
    }).setOrigin(0.5).setDepth(50);
    this.tweens.add({ targets:pop, y:y-50, alpha:0, duration:700, onComplete:()=>pop.destroy() });

    // Burst
    for (let i=0;i<8;i++) {
      const a=(Math.PI*2*i)/8;
      const dot=this.add.circle(x,y,6,C.gold,1).setDepth(25);
      this.tweens.add({ targets:dot, x:x+Math.cos(a)*44, y:y+Math.sin(a)*44, alpha:0, scale:0.3, duration:400, onComplete:()=>dot.destroy() });
    }

    // Score text bounce
    this.tweens.add({ targets:this.scoreText, scaleX:1.4, scaleY:1.4, duration:100, yoyo:true });

    if (this.score >= COIN_GOAL) {
      this.time.delayedCall(300, () => this.endGame());
      return;
    }

    this._spawnCoin();
    this._refreshHighlights();
  }

  endGame() {
    if (this.isOver) return;
    this.isOver = true;
    if (this.idleTimer) { this.idleTimer.remove(); this.idleTimer = null; }
    this._clearHintMarkers();
    if (this._hlTween) this._hlTween.stop();
    this.hlGraphics.clear();
    SFX.win();
    this.time.delayedCall(500, ()=>this.scene.start('EndScene',{score:this.score}));
  }

  update() {}
}

// ── END ───────────────────────────────────────────────────────
class EndScene extends Phaser.Scene {
  constructor() { super('EndScene'); }
  preload() { makeTextures(this); }
  create(data) {
    addBg(this);
    this.add.rectangle(GW/2,GH/2,GW,GH,0x2d1b69,0.35);
    this._confetti();

    // Big trophy
    this.add.text(GW/2, GH/2-150, '🏆', {fontSize:'80px'}).setOrigin(0.5);

    this.add.text(GW/2, GH/2-54, '¡Lo lograste!', {
      fontSize:'48px', fontFamily:'Arial Black', color:'#ffd700',
      stroke:'#6b3fa0', strokeThickness:7,
    }).setOrigin(0.5);

    // 10 coin icons in a row
    for (let i=0;i<COIN_GOAL;i++) {
      this.add.image(GW/2 - (COIN_GOAL/2-0.5)*36 + i*36, GH/2+18, 'coin').setScale(0.7);
    }

    // 3 stars — always, it's always a win
    for (let i=0;i<3;i++)
      this.add.text(GW/2-44+i*44, GH/2+80, '⭐', {fontSize:'40px'}).setOrigin(0.5);

    buildPlayButton(this, GW/2-80, GH/2+170, 52, ()=>tryStartGame(this,['EndScene']));
    const home=this.add.circle(GW/2+80,GH/2+170,48,0xc878d8).setInteractive({useHandCursor:true});
    home.setStrokeStyle(2,0xffffff,0.4);
    this.add.text(GW/2+80,GH/2+170,'🏠',{fontSize:'30px'}).setOrigin(0.5);
    home.on('pointerdown',()=>this.scene.start('MenuScene'));
  }
  _confetti() {
    const colors=[0xff6eb4,0xffd700,0xffb3d9,0xc878d8,0xffee88];
    for (let i=0;i<30;i++) {
      const p=this.add.circle(Phaser.Math.Between(40,GW-40),-20,Phaser.Math.Between(4,10),colors[i%colors.length],0.9);
      this.tweens.add({targets:p,y:GH+30,angle:Phaser.Math.Between(-360,360),duration:Phaser.Math.Between(2000,4000),delay:Phaser.Math.Between(0,1200),onComplete:()=>p.destroy()});
    }
  }
}

// ── DAILY LIMIT ───────────────────────────────────────────────
class DailyLimitScene extends Phaser.Scene {
  constructor() { super('DailyLimitScene'); }
  preload() { makeTextures(this); }
  create() {
    addBg(this);
    this.add.rectangle(GW/2,GH/2,GW,GH,0x2d1b69,0.45);
    this.add.text(GW/2,GH/2-100,'🌙',{fontSize:'96px'}).setOrigin(0.5).setInteractive()
      .on('pointerdown',()=>{ const h=this.time.delayedCall(3000,()=>{DailyPlays.reset();this.scene.start('MenuScene');}); this.once('pointerup',()=>h.remove()); });
    this.add.text(GW/2,GH/2+10,'¡Hasta mañana!',{fontSize:'44px',fontFamily:'Arial Black',color:'#f8b4e8',stroke:'#2d1b69',strokeThickness:6}).setOrigin(0.5);
    this.add.text(GW/2,GH/2+80,'😴',{fontSize:'48px'}).setOrigin(0.5);
    const home=this.add.circle(GW/2,GH/2+170,52,0xff6eb4).setInteractive({useHandCursor:true});
    this.add.text(GW/2,GH/2+170,'⭐',{fontSize:'40px'}).setOrigin(0.5);
    home.on('pointerdown',()=>this.scene.start('MenuScene'));
    this.add.text(8,GH-6,'v'+VERSION,{fontSize:'13px',fontFamily:'monospace',color:'#ffffff44'}).setOrigin(0,1);
  }
}

class BootScene extends Phaser.Scene {
  constructor() { super('BootScene'); }
  create() { this.scene.start('MenuScene'); }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#c878d8',
  scale: { mode:Phaser.Scale.FIT, autoCenter:Phaser.Scale.CENTER_BOTH, width:GW, height:GH },
  scene: [BootScene, MenuScene, GameScene, EndScene, DailyLimitScene],
  input: { activePointers: 1 },
});
