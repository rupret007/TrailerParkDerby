# TrailerParkDerby

Public browser arcade: top-down oval race with AI traffic. Score by parking on a **moving flatbed trailer** and holding ~1.5s with speed under control. Chain parks for combo (up to Trailer Royalty). Centered + slow parks stack a perfect-streak bonus.

**Live (GitHub Pages, from `main` only):** https://rupret007.github.io/TrailerParkDerby/

Desktop and phones (HTTPS). On a phone, use the on-screen pads; rotate to landscape if the track feels tight. Audio needs a tap/click to unlock on iOS.

## Quick start

Node 22. From the repo:

```bash
npm ci
npm test
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173/TrailerParkDerby/`). Root `/` redirects there.

```bash
npm run build
npm run preview   # http://localhost:4173/TrailerParkDerby/
```

No env vars. `package.json` `"private": true` means do not publish to npm — the GitHub repo is public.

## Controls

| Input | Action |
|-------|--------|
| `W` / `↑` | Accelerate |
| `S` / `↓` | Brake / reverse |
| `A` `D` / `←` `→` | Steer |
| `Space` | Handbrake |
| `Enter` | Start (title) |
| `Esc` / `P` | Pause / resume |
| `N` | Neon night / day |
| `M` | Mute / unmute (saved) |
| `H` | Horn |
| `R` | Soft retry (reset car) |

Pause overlay: Resume or Restart (title). Tab hide / window blur also pauses. Phone: left steer pads, right Gas / Brake / Handbrake; HUD Pause + Mute; double-tap Gas to honk.

## Features

- Oval Canvas2D track, named AI rivals, moving flatbed target
- Score + combo, localStorage high score
- Perfect park streak, near-miss skim points, neon boost orbs
- Pause / resume / restart; spawn opposite the AI pack with brief bump immunity
- Frame-rate–independent off-track damping; boost/orb clocks in game time
- Touch pads, landscape hint, mute + pause chrome
- WebAudio beeps, announcer one-liners, combo titles (Single-Wide → Trailer Royalty)
- Reduced-motion (no shake/sparks/pulses), live-region announcer, labeled controls
- Vector art drawn in code — no external media

## Build / test

CI (pull requests and non-`main` pushes) uses Node 22:

```bash
npm ci
npm test        # vitest, src/**/*.test.ts
npm run build   # tsc && vite build
```

GitHub Pages deploys from **`main` only** (`npm ci` + `npm run build`, then `dist/`). This branch is not auto-published.

## Status / limits

- Browser-only; no accounts, backend, or secrets
- High score and mute are per-device (`localStorage`)
- Phone play is landscape-first; portrait shows a rotate hint
- Physical iPhone thumbs / iOS audio unlock / real reduced-motion: not verified in this pass
