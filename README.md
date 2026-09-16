# TrailerParkDerby

Top-down oval arcade racer: circulate with AI traffic and **park on a moving flatbed trailer**.

## Play

```bash
npm i
npm run dev
```

Open the local URL Vite prints (usually `http://localhost:5173`).

Production build:

```bash
npm run build
npm run preview
```

## Goal

Drive onto the **moving trailer bed** and stay parked (~speed under control) for **~1.5 seconds** to score. Fall off or miss and retry. Chain parks for combo multipliers.

## Controls

| Input | Action |
|-------|--------|
| `W` / `↑` | Accelerate |
| `S` / `↓` | Brake / reverse |
| `A` `D` / `←` `→` | Steer |
| `Space` | Handbrake |
| `Enter` | Start (title screen) |
| `N` | Toggle neon night / day |
| `M` | Mute / unmute (saved) |
| `R` | Soft retry (reset car) |

## Features

- Oval Canvas2D track with AI cars
- Moving flatbed trailer target
- Score + combo, localStorage high score
- Neon boost pickups
- Neon night toggle
- Simple WebAudio beeps + mute
- Title + how-to overlay

Original vector art drawn in code — no external media.

## Stack

Vite + vanilla TypeScript.
