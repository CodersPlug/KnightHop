# Pink Knight Hop

A touch-first Phaser 3 coin-collecting game for ~6-year-olds. Hop the pink knight around an 8×8 chessboard using L-jumps and grab as many coins as you can in 45 seconds.

**Live:** https://codersplug.github.io/KnightHop/

## Play

- Tap a **glowing gold cell** to L-jump the knight there
- Collect coins (+1 each) — one coin on the board at a time
- Beat the timer bar before it drains!

## Tech

- Phaser 3.88.2 (CDN), no build step
- 1024×576 logical canvas, `Phaser.Scale.FIT`
- Shared daily play limit (`phaserlab_daily_plays`, 5/day across CodersPlug games)

## Local dev

```bash
cd KnightHop
python3 -m http.server 3000
# open http://localhost:3000
```

## Deploy

Push to `main` — GitHub Actions deploys to Pages automatically.
