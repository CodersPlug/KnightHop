// =============================================================
//  Pink Knight Hop — v1.2  (6yo-friendly UX pass)
// =============================================================

const GW = 1024;
const GH = 576;
const VERSION = '1.2';
const GAME_ID = 'knightHop';
const PLAY_STORAGE_KEY = 'phaserlab_daily_plays';
const MAX_PLAYS_PER_DAY = 5;

const BOARD_SIZE = 8;
const GAME_SECONDS = 45;
const HUD_H = 50;
const TIMER_H = 26;
const BOARD_TOP = HUD_H + TIMER_H + 12;
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
    tick:   () => tone(600,600,'sine',0.04,0.08),
    endWin: () => { tone(523,523,'sine',0.12,0.22); setTimeout(()=>tone(659,659,'sine',0.12,0.22),120); setTimeout(()=>tone(784,784,'sine',0.2,0.26),240); },
    endBoop:() => tone(320,240,'sine',0.22,0.18),
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
function timerColor(ratio) {
  if (ratio>0.5) return 0x44dd44;
  if (ratio>0.25) return 0xff9900;
  return 0xff3333;
}

// ── Textures ──────────────────────────────────────────────────
function makeTextures(scene) {
  // Knight — poster-style pink horse (Safari-safe: no fillPath)
  if (!scene.textures.exists('knight')) {
    const g = scene.make.graphics({x:0,y:0,add:false});
    g.fillStyle(C.knightDark,1); g.fillEllipse(24,50,20,6);      // shadow
    g.fillStyle(C.knightDark,1); g.fillRoundedRect(10,20,28,28,10); // body dark
    g.fillStyle(C.knight,1);     g.fillRoundedRect(8,16,30,30,12);  // body
    g.fillStyle(C.knightDark,1); g.fillTriangle(8,20,4,6,16,16);    // ear dark
    g.fillStyle(C.knight,1);     g.fillTriangle(10,18,6,4,18,14);   // ear
    g.fillStyle(0xffffff,1);     g.fillCircle(30,24,5);             // eye white
    g.fillStyle(0x333333,1);     g.fillCircle(31,24,2.5);           // pupil
    g.fillStyle(0xffeeaa,1);     g.fillCircle(32,23,1);             // eye shine
    g.fillStyle(C.knightDark,1); g.fillRoundedRect(34,10,10,14,4); // mane
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
    this.timeRemaining = GAME_SECONDS;
    this.startTime = this.time.now;
    this.lastTickSecond = -1;
    this.validMoves = [];
    this.coinCol = -1;
    this.coinRow = -1;

    this._buildBoard();
    this._buildHUD();
    this._buildTimerBar();

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
    this.add.image(28, HUD_H/2, 'coin').setScale(0.85).setDepth(30);
    this.scoreText = this.add.text(54, HUD_H/2, '0', {
      fontSize:'34px', fontFamily:'Arial Black, sans-serif',
      color:'#ffd700', stroke:'#6b3fa0', strokeThickness:4,
    }).setOrigin(0,0.5).setDepth(30);
  }

  _buildTimerBar() {
    const y = HUD_H + TIMER_H/2;
    this.timerBg   = this.add.graphics().setDepth(30);
    this.timerFill = this.add.graphics().setDepth(31);
    this._drawTimerBar(1);
  }

  _drawTimerBar(ratio) {
    const x=BOARD_LEFT, y=HUD_H+2, h=TIMER_H-4, w=BOARD_PX;
    const fw = Math.max(0, w*ratio);
    const col = timerColor(ratio);
    this.timerBg.clear();
    this.timerBg.fillStyle(0x2d1b69,0.7);
    this.timerBg.fillRoundedRect(x-2,y-2,w+4,h+4,9);
    this.timerFill.clear();
    if (fw>0) {
      this.timerFill.fillStyle(col,1);
      this.timerFill.fillRoundedRect(x,y,fw,h,7);
      // Sheen stripe
      this.timerFill.fillStyle(0xffffff,0.18);
      this.timerFill.fillRoundedRect(x,y,fw,h*0.45,7);
    }
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

    this._spawnCoin();
    this._refreshHighlights(); // re-highlight including new coin position
  }

  endGame() {
    if (this.isOver) return;
    this.isOver = true;
    if (this._hlTween) this._hlTween.stop();
    this.hlGraphics.clear();
    if (this.score>=10) SFX.endWin(); else SFX.endBoop();
    this.time.delayedCall(400, ()=>this.scene.start('EndScene',{score:this.score}));
  }

  update() {
    if (this.isOver) return;
    const elapsed = (this.time.now-this.startTime)/1000;
    this.timeRemaining = Math.max(0, GAME_SECONDS-elapsed);
    const ratio = this.timeRemaining/GAME_SECONDS;
    this._drawTimerBar(ratio);

    if (this.timeRemaining<=5 && this.timeRemaining>0) {
      const sec=Math.ceil(this.timeRemaining);
      if (sec!==this.lastTickSecond) { this.lastTickSecond=sec; SFX.tick(); }
      const shake=Math.sin(this.time.now/40)*2;
      this.timerFill.x=shake; this.timerBg.x=shake;
    } else {
      this.timerFill.x=0; this.timerBg.x=0;
    }
    if (this.timeRemaining<=0) this.endGame();
  }
}

// ── END ───────────────────────────────────────────────────────
class EndScene extends Phaser.Scene {
  constructor() { super('EndScene'); }
  preload() { makeTextures(this); }
  create(data) {
    const score=(data&&data.score)||0;
    addBg(this);
    this.add.rectangle(GW/2,GH/2,GW,GH,0x2d1b69,0.38);
    if (score>=10) this._confetti();

    this.add.text(GW/2, GH/2-140, '⏰', {fontSize:'60px'}).setOrigin(0.5);
    this.add.text(GW/2, GH/2-70, '¡Se acabó el tiempo!', {
      fontSize:'36px', fontFamily:'Arial Black', color:'#ffb3d9', stroke:'#ffffff', strokeThickness:5,
    }).setOrigin(0.5);

    this.add.image(GW/2-56,GH/2+12,'coin').setScale(1.6);
    this.add.text(GW/2+10,GH/2+12,String(score),{
      fontSize:'70px', fontFamily:'Arial Black', color:'#ffd700', stroke:'#6b3fa0', strokeThickness:6,
    }).setOrigin(0,0.5);

    const stars = score>=10?3:score>=5?2:1;
    for (let i=0;i<3;i++)
      this.add.text(GW/2-44+i*44, GH/2+90, i<stars?'⭐':'☆',{
        fontSize:'36px', color:i<stars?'#ffd700':'#ffffff44',
      }).setOrigin(0.5);

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
