# EMBERLINE — Tactical FPS (three.js)

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Jasonrichh/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Jasonrichh/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based tactical first-person shooter in the browser, built with
[three.js](https://threejs.org/) 0.187.0. Made for the
[make.fun threejs-fps-02 bounty](https://make.fun/bounty/threejs-fps-02).

Two crews fight over the old **Cinderworks Yard** at dusk. Plant the Igniter at
Site A or Site B — or wipe the other crew out. Win rounds, earn credits, buy
better steel. First crew to 5 rounds takes the yard.

## Play

```sh
node serve.ts
# open http://localhost:8080
```

No build step, no network: `game/` is plain static files (ES modules, three.js
vendored under `game/vendor/three/`). Desktop Chrome or any browser with
WebGL 2.

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look · Right-click aims (scope on the DMR) |
| Click | Fire · R reload |
| Shift | Walk silently · Space jump · Ctrl crouch |
| B then 1–5 | Buy menu (SMG, rifle, shotgun, DMR, Kevlar) |
| E | Plant / defuse the Igniter (hold) |
| Q | Swap weapon · Tab scoreboard |

## The game

- **5v5, single-player vs bots** — you + 4 EMBER bots vs 5 VOLT bots with a
  waypoint-graph AI: they push sites, hold angles, strafe and burst-fire,
  plant the Igniter, rotate to defuse, and buy better guns in later rounds.
- **Round-based tactics** — 12 s buy phase, 100 s rounds, first to 5.
  Economy: $800 start, +$300 per elimination, +$300 plant, +$3,250 round win,
  +$1,900 loss (+$500 per consecutive loss). Survive and you keep your loadout.
- **Accuracy beats spray** — first-shot accuracy, spread bloom while firing
  or moving, damage falloff with range, 2×+ headshots, recoil, scoped DMR.
- **The yard** — an original industrial map: a mid foundry hall with an
  S-shaped passage, shipping containers, crates, barrels, two plant sites with
  hazard rings and light beacons, a dusk sky with skyline silhouettes and
  blinking chimney beacons. All art is procedural (canvas textures, no asset
  files); all sound is synthesised with WebAudio.
- **HUD** — health + armor, ammo, credits, round timer, team scores with
  alive pips, live minimap, kill feed, objective line, plant/defuse progress,
  hitmarkers and damage vignette.

## Shots

Screenshots in `screenshots/` are real renders of this code, staged with
`?shot=start|play|buy|end&seed=7` (see `shots.json`):

1. `1-start.jpg` — title menu over the yard
2. `2-play.jpg` — mid-round firefight at the foundry hall
3. `3-buy.jpg` — buy phase
4. `4-end.jpg` — round won at Site A

## Entry

`main.ts` (Node 22, standard library only) copies `game/` and `screenshots/`
to the output directory and writes `dossier.json` with `buildDossier` from
`vendor/makefun-threejs.ts` (the kit's library, unchanged):

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## License

MIT — see [LICENSE](LICENSE).
