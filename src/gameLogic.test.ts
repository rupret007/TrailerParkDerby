import indexHtml from '../index.html?raw'
import mainTsSource from './main.ts?raw'
import styleCss from './style.css?raw'
import { describe, expect, it } from 'vitest'
import {
  AI_SPAWN_PHASES,
  aiLaneOffset,
  applySoftTrackPull,
  clamp,
  clampDt,
  collectBoost,
  comboTitle,
  COMBO_TITLES,
  createTrackGeom,
  decayParkTimer,
  DEFAULT_TRAILER,
  evaluatePark,
  finitePose,
  isBump,
  isNearMiss,
  isParkHoldReady,
  nearMissBonus,
  normalOnTrack,
  parseStoredInt,
  PLAYER_SPAWN_LANE,
  PLAYER_SPAWN_PHASE,
  spawnClearOfTraffic,
  nextPauseDialogFocus,
  PAUSE_DIALOG_ACTION_IDS,
  pauseHudPolicy,
  phaseAfterBlur,
  shouldSuppressTouchGesture,
  phaseAfterHidden,
  RESUME_FOCUS_TARGET_ID,
  pointInTrailerBed,
  pointOnTrack,
  shouldResetComboOnMiss,
  stepPlayer,
  TRAILER_BED_CAB_GAP,
  trailerBedLocalX,
  stepTrailerProgress,
  tangentOnTrack,
  tickBoostRemain,
  tickOrbRespawn,
  trackPhaseFromPosition,
  wrap01,
} from './gameLogic'

const geom = createTrackGeom(480, 320)

describe('wrap01 / clamp / parseStoredInt', () => {
  it('wraps progress into [0, 1)', () => {
    expect(wrap01(0)).toBe(0)
    expect(wrap01(1)).toBe(0)
    expect(wrap01(1.25)).toBeCloseTo(0.25)
    expect(wrap01(-0.25)).toBeCloseTo(0.75)
    expect(wrap01(Number.NaN)).toBe(0)
  })

  it('clamps inclusive', () => {
    expect(clamp(10, -80, 240)).toBe(10)
    expect(clamp(-200, -80, 240)).toBe(-80)
    expect(clamp(400, -80, 240)).toBe(240)
  })

  it('parses high scores and rejects garbage', () => {
    expect(parseStoredInt(null)).toBe(0)
    expect(parseStoredInt('')).toBe(0)
    expect(parseStoredInt('42')).toBe(42)
    expect(parseStoredInt('3.9')).toBe(3)
    expect(parseStoredInt('NaN')).toBe(0)
    expect(parseStoredInt('-4')).toBe(0)
    expect(parseStoredInt('nope', 7)).toBe(7)
  })
})

describe('combo titles', () => {
  it('maps combo 1..9 onto the trailer-park titles', () => {
    expect(comboTitle(1)).toBe('Single-Wide')
    expect(comboTitle(2)).toBe('Double-Wide')
    expect(comboTitle(9)).toBe('Trailer Royalty')
    expect(comboTitle(99)).toBe('Trailer Royalty')
    expect(comboTitle(0)).toBe('Single-Wide')
    expect(comboTitle(-3)).toBe('Single-Wide')
    expect(COMBO_TITLES).toHaveLength(9)
  })
})

describe('clockwise oval geometry', () => {
  it('places t=0 at the rightmost point', () => {
    const p = pointOnTrack(0, geom)
    expect(p.x).toBeCloseTo(480 + 340)
    expect(p.y).toBeCloseTo(320)
  })

  it('moves clockwise as t increases (canvas-up from the right apex)', () => {
    const a = pointOnTrack(0, geom)
    const b = pointOnTrack(0.02, geom)
    // canvas Y grows downward; clockwise from 3 o'clock heads toward 12 o'clock
    expect(b.y).toBeLessThan(a.y)
  })

  it('returns unit tangents', () => {
    for (const t of [0, 0.15, 0.5, 0.87]) {
      const tan = tangentOnTrack(t, geom)
      expect(Math.hypot(tan.x, tan.y)).toBeCloseTo(1, 8)
    }
  })

  it('normal is left-of-travel (inward-ish for clockwise)', () => {
    const tan = tangentOnTrack(0, geom)
    const n = normalOnTrack(0, geom)
    expect(n.x).toBeCloseTo(-tan.y)
    expect(n.y).toBeCloseTo(tan.x)
  })

  it('recovers phase from a point on the centerline', () => {
    for (const t of [0, 0.2, 0.5, 0.8]) {
      const p = pointOnTrack(t, geom)
      expect(trackPhaseFromPosition(p.x, p.y, geom)).toBeCloseTo(t, 5)
    }
  })
})

describe('trailer bed + park scoring', () => {
  const pose = { x: 400, y: 300, angle: 0 }
  const trailer = DEFAULT_TRAILER

  it('shares one cab-gap with the drawn deck so hit-test edges match the art', () => {
    expect(TRAILER_BED_CAB_GAP).toBe(0.12)
    const { start, end, mid } = trailerBedLocalX(trailer)
    expect(start).toBeCloseTo(-(trailer.cabL * 0.12))
    expect(end).toBeCloseTo(start - trailer.bedL)
    expect(mid).toBeCloseTo(start - trailer.bedL / 2)
    // Cab-side lip of the painted deck is in; a step toward the cab is not.
    expect(pointInTrailerBed(pose.x + start - 0.01, pose.y, pose, trailer)).toBe(true)
    expect(pointInTrailerBed(pose.x + start + 0.01, pose.y, pose, trailer)).toBe(false)
    // Tail of the painted deck is in; a step past the tail is not.
    expect(pointInTrailerBed(pose.x + end + 0.01, pose.y, pose, trailer)).toBe(true)
    expect(pointInTrailerBed(pose.x + end - 0.01, pose.y, pose, trailer)).toBe(false)
    expect(mainTsSource).toMatch(/const bedX = trailerBedLocalX\(trailer\)\.end/)
    expect(mainTsSource).not.toMatch(/-trailer\.cabL \* 0\.1[25]/)
  })

  it('accepts the bed center and rejects the cab / sides', () => {
    const bedMidX = trailerBedLocalX(trailer).mid
    expect(pointInTrailerBed(pose.x + bedMidX, pose.y, pose, trailer)).toBe(true)
    expect(pointInTrailerBed(pose.x + 20, pose.y, pose, trailer)).toBe(false)
    expect(pointInTrailerBed(pose.x + bedMidX, pose.y + 40, pose, trailer)).toBe(false)
  })

  it('requires slow-enough speed to start the park hold', () => {
    expect(isParkHoldReady(true, 20)).toBe(true)
    expect(isParkHoldReady(true, 54.9)).toBe(true)
    expect(isParkHoldReady(true, 55)).toBe(false)
    expect(isParkHoldReady(false, 10)).toBe(false)
  })

  it('scores a normal park then a perfect stack with the original formula', () => {
    const bedMidX = trailerBedLocalX(trailer).mid
    const normal = evaluatePark({ x: pose.x + bedMidX, y: pose.y + 12, speed: 40 }, pose, trailer, 3, 0)
    expect(normal.perfect).toBe(false)
    expect(normal.gained).toBe(300)
    expect(normal.nextCombo).toBe(4)
    expect(normal.nextStreak).toBe(0)

    const perfect = evaluatePark({ x: pose.x + bedMidX, y: pose.y, speed: 10 }, pose, trailer, 3, 2)
    expect(perfect.perfect).toBe(true)
    expect(perfect.nextStreak).toBe(3)
    expect(perfect.gained).toBe(300 + 50 * 3 * 3)
    expect(perfect.nextCombo).toBe(4)
  })

  it('caps combo at 9 and perfect streak at 5', () => {
    const bedMidX = trailerBedLocalX(trailer).mid
    const r = evaluatePark({ x: pose.x + bedMidX, y: pose.y, speed: 0 }, pose, trailer, 9, 5)
    expect(r.nextCombo).toBe(9)
    expect(r.nextStreak).toBe(5)
  })

  it('breaks combo only after leaving the bed past 0.4s of hold', () => {
    expect(shouldResetComboOnMiss(0.3, false)).toBe(false)
    expect(shouldResetComboOnMiss(0.41, false)).toBe(true)
    expect(shouldResetComboOnMiss(1.2, true)).toBe(false)
  })

  it('decays the park timer at 1.2x when not holding', () => {
    expect(decayParkTimer(1, 0.5)).toBeCloseTo(0.4)
    expect(decayParkTimer(0.1, 1)).toBe(0)
  })
})

describe('player step / frame-rate', () => {
  const idle = { accel: false, brake: false, left: false, right: false, handbrake: false }
  const gas = { ...idle, accel: true }

  it('accelerates and clamps to the unboosted cap', () => {
    const a = stepPlayer({ x: 0, y: 0, angle: 0, speed: 0 }, gas, 1, false)
    expect(a.speed).toBe(200)
    const b = stepPlayer({ x: 0, y: 0, angle: 0, speed: 230 }, gas, 1, false)
    expect(b.speed).toBe(240)
    const c = stepPlayer({ x: 0, y: 0, angle: 0, speed: 230 }, gas, 1, true)
    expect(c.speed).toBe(320)
  })

  it('reverses no faster than -80', () => {
    const r = stepPlayer({ x: 0, y: 0, angle: 0, speed: 0 }, { ...idle, brake: true }, 2, false)
    expect(r.speed).toBe(-80)
  })

  it('moves forward along heading', () => {
    const r = stepPlayer({ x: 10, y: 20, angle: 0, speed: 100 }, idle, 0.1, false)
    expect(r.x).toBeGreaterThan(10)
    expect(r.y).toBeCloseTo(20)
  })

  it('keeps 0.5s of gas almost identical at 30fps vs 120fps', () => {
    let slow = { x: 0, y: 0, angle: 0, speed: 0 }
    let fast = { x: 0, y: 0, angle: 0, speed: 0 }
    for (let i = 0; i < 15; i++) slow = stepPlayer(slow, gas, 1 / 30, false)
    for (let i = 0; i < 60; i++) fast = stepPlayer(fast, gas, 1 / 120, false)
    expect(Math.abs(slow.speed - fast.speed)).toBeLessThan(0.05)
    expect(Math.abs(slow.x - fast.x)).toBeLessThan(2)
  })

  it('caps huge / negative dt', () => {
    expect(clampDt(1)).toBe(0.05)
    expect(clampDt(-4)).toBe(0)
    expect(clampDt(Number.NaN)).toBe(0)
    expect(clampDt(0.016)).toBeCloseTo(0.016)
  })

  it('resets non-finite poses', () => {
    expect(finitePose({ x: Number.NaN, y: 1, angle: 0, speed: 0 })).toEqual({
      x: 0,
      y: 0,
      angle: 0,
      speed: 0,
    })
    expect(finitePose({ x: 3, y: 4, angle: 1, speed: 2 })).toEqual({ x: 3, y: 4, angle: 1, speed: 2 })
  })
})

describe('soft track pull', () => {
  it('does not move a car on the centerline', () => {
    const p = pointOnTrack(0.3, geom)
    const out = applySoftTrackPull({ x: p.x, y: p.y, speed: 100 }, geom, 1 / 60, 0.55)
    expect(out.x).toBeCloseTo(p.x)
    expect(out.y).toBeCloseTo(p.y)
    expect(out.speed).toBe(100)
  })

  it('pulls an off-track car inward and damps speed', () => {
    const p = pointOnTrack(0, geom)
    const out = applySoftTrackPull({ x: p.x + 200, y: p.y, speed: 100 }, geom, 1 / 60, 0.55)
    expect(out.x).toBeLessThan(p.x + 200)
    expect(out.speed).toBeLessThan(100)
    expect(out.speed).toBeCloseTo(98)
  })

  it('matches 60fps damping at dt=1/60 (legacy 0.98 per frame)', () => {
    const p = pointOnTrack(0, geom)
    const out = applySoftTrackPull({ x: p.x + 200, y: p.y, speed: 100 }, geom, 1 / 60, 0.55)
    expect(out.speed).toBeCloseTo(100 * 0.98)
  })
})

describe('near-miss / bump / boost clocks', () => {
  it('uses the original skim band and speed gate', () => {
    expect(isNearMiss(30, 100)).toBe(true)
    expect(isNearMiss(20, 100)).toBe(false)
    expect(isNearMiss(30, 80)).toBe(false)
    expect(isBump(25)).toBe(true)
    expect(isBump(26)).toBe(false)
    expect(nearMissBonus(4)).toBe(60)
  })

  it('ticks boost and orb respawn in game time', () => {
    expect(tickBoostRemain(3.5, 1)).toBeCloseTo(2.5)
    expect(tickBoostRemain(0.2, 1)).toBe(0)
    expect(tickOrbRespawn(0, 0.1, true)).toEqual({ alive: true, respawnIn: 0 })
    expect(tickOrbRespawn(1, 0.25, false)).toEqual({ alive: false, respawnIn: 0.75 })
    expect(tickOrbRespawn(0.1, 0.2, false)).toEqual({ alive: true, respawnIn: 0 })
    expect(collectBoost(true, 10)).toBe(true)
    expect(collectBoost(true, 22)).toBe(false)
    expect(collectBoost(false, 5)).toBe(false)
  })

  it('wraps trailer progress', () => {
    expect(stepTrailerProgress(0.99, 0.09, 2)).toBeGreaterThanOrEqual(0)
    expect(stepTrailerProgress(0.99, 0.09, 2)).toBeLessThan(1)
  })
})

describe('spawn clearance', () => {
  it('keeps the player off the four AI start phases', () => {
    expect(spawnClearOfTraffic(0.92, AI_SPAWN_PHASES)).toBe(false)
    expect(spawnClearOfTraffic(PLAYER_SPAWN_PHASE, AI_SPAWN_PHASES)).toBe(true)
  })

  it('uses the opposite lane from AI at the spawn phase so a sitting player is not bonked', () => {
    expect(Math.abs(PLAYER_SPAWN_LANE - aiLaneOffset(PLAYER_SPAWN_PHASE))).toBeGreaterThan(26)
  })
})

describe('pause phase machine', () => {
  it('pauses only while playing, never from the title screen', () => {
    expect(phaseAfterHidden('playing', true)).toBe('paused')
    expect(phaseAfterHidden('playing', false)).toBe('playing')
    expect(phaseAfterHidden('title', true)).toBe('title')
    expect(phaseAfterHidden('paused', true)).toBe('paused')
    expect(phaseAfterBlur('playing', true)).toBe('paused')
    expect(phaseAfterBlur('title', true)).toBe('title')
  })
})

describe('touch gesture suppression (zoom on title/pause, not on play surfaces)', () => {
  it('allows pinch-zoom/scroll gestures that originate inside a title or pause panel', () => {
    expect(shouldSuppressTouchGesture(true)).toBe(false)
  })

  it('still suppresses gestures outside a panel, e.g. the canvas or touch pads', () => {
    expect(shouldSuppressTouchGesture(false)).toBe(true)
  })
})

describe('shipped zoom-unlock surfaces (guards against reverting the actual fix)', () => {
  it('does not lock the viewport against pinch-zoom', () => {
    const viewport = indexHtml.match(/<meta name="viewport"[^>]*>/)?.[0] ?? ''
    expect(viewport).not.toBe('')
    expect(viewport).not.toMatch(/user-scalable\s*=\s*no/)
    expect(viewport).not.toMatch(/maximum-scale\s*=\s*1(\.0+)?\b/)
  })

  it('does not set touch-action: none on html, body', () => {
    const cssWithoutComments = styleCss.replace(/\/\*[\s\S]*?\*\//g, '')
    const htmlBodyRule = cssWithoutComments.match(/html,\s*body\s*\{[^}]*\}/)?.[0] ?? ''
    expect(htmlBodyRule).not.toBe('')
    expect(htmlBodyRule).not.toMatch(/touch-action:\s*none/)
    expect(htmlBodyRule).toMatch(/touch-action:\s*pinch-zoom/)
  })

  it('still suppresses gestures on the touch pads via preventDefault', () => {
    expect(mainTsSource).toMatch(
      /padRoot\.addEventListener\('touchstart',\s*\(e\)\s*=>\s*e\.preventDefault\(\),\s*\{ passive: false \}\)/,
    )
    expect(mainTsSource).toMatch(
      /padRoot\.addEventListener\('touchmove',\s*\(e\)\s*=>\s*e\.preventDefault\(\),\s*\{ passive: false \}\)/,
    )
  })

  it('wires the panel exemption into both the touchmove and gesturestart listeners', () => {
    expect(mainTsSource).toMatch(
      /isInZoomablePanel = \(target: EventTarget \| null\) => target instanceof Element && !!target\.closest\('\.panel'\)/,
    )
    const touchmoveHandler =
      mainTsSource.match(/document\.addEventListener\(\s*'touchmove',[\s\S]*?\{ passive: false \},?\s*\)/)?.[0] ?? ''
    expect(touchmoveHandler).toMatch(/shouldSuppressTouchGesture\(isInZoomablePanel\(e\.target\)\)/)
    const gesturestartHandler = mainTsSource.match(/document\.addEventListener\('gesturestart',[\s\S]*?\}\)/)?.[0] ?? ''
    expect(gesturestartHandler).toMatch(/shouldSuppressTouchGesture\(isInZoomablePanel\(e\.target\)\)/)
  })
})

describe('pause dialog focus policy (one Resume, HUD inert, Tab stays inside)', () => {
  it('hides and inerts covered HUD actions only while paused, and never labels them Resume', () => {
    expect(pauseHudPolicy('paused')).toEqual({
      hudInert: true,
      hudActionsHidden: true,
      pauseButtonVisible: false,
      pauseButtonLabel: 'Pause',
    })
    expect(pauseHudPolicy('playing')).toEqual({
      hudInert: false,
      hudActionsHidden: false,
      pauseButtonVisible: true,
      pauseButtonLabel: 'Pause',
    })
    expect(pauseHudPolicy('title')).toEqual({
      hudInert: false,
      hudActionsHidden: false,
      pauseButtonVisible: false,
      pauseButtonLabel: 'Pause',
    })
  })

  it('cycles Tab and Shift+Tab across the dialog Resume/Restart pair only', () => {
    expect(PAUSE_DIALOG_ACTION_IDS).toEqual(['btn-resume', 'btn-restart'])
    expect(nextPauseDialogFocus(PAUSE_DIALOG_ACTION_IDS, 'btn-resume', false)).toBe('btn-restart')
    expect(nextPauseDialogFocus(PAUSE_DIALOG_ACTION_IDS, 'btn-restart', false)).toBe('btn-resume')
    expect(nextPauseDialogFocus(PAUSE_DIALOG_ACTION_IDS, 'btn-resume', true)).toBe('btn-restart')
    expect(nextPauseDialogFocus(PAUSE_DIALOG_ACTION_IDS, 'btn-restart', true)).toBe('btn-resume')
    expect(nextPauseDialogFocus(PAUSE_DIALOG_ACTION_IDS, 'btn-pause', false)).toBe('btn-resume')
    expect(nextPauseDialogFocus(PAUSE_DIALOG_ACTION_IDS, 'btn-mute', true)).toBe('btn-restart')
    expect(nextPauseDialogFocus(PAUSE_DIALOG_ACTION_IDS, null, false)).toBe('btn-resume')
  })

  it('restores gameplay focus to the canvas, not a HUD button', () => {
    expect(RESUME_FOCUS_TARGET_ID).toBe('game')
  })
})

describe('shipped pause-dialog surfaces (guards against reverting the actual fix)', () => {
  it('does not relabel the HUD Pause control to Resume', () => {
    expect(mainTsSource).not.toMatch(/phase === 'paused' \? 'Resume'/)
    expect(mainTsSource).not.toMatch(/textContent = phase === 'paused' \? 'Resume'/)
    expect(mainTsSource).toMatch(/btnPause\.textContent = policy\.pauseButtonLabel/)
  })

  it('marks covered HUD controls inert and hidden while the pause overlay is open', () => {
    expect(mainTsSource).toMatch(/const policy = pauseHudPolicy\(phase\)/)
    expect(mainTsSource).toMatch(/hud\.setAttribute\('inert'/)
    expect(mainTsSource).toMatch(/hudActions\.setAttribute\('hidden'/)
    expect(mainTsSource).toMatch(/hudActions\.setAttribute\('aria-hidden',\s*'true'\)/)
  })

  it('keeps Tab inside the pause dialog and restores canvas focus on resume', () => {
    expect(mainTsSource).toMatch(/nextPauseDialogFocus\(PAUSE_DIALOG_ACTION_IDS,\s*activeId,\s*e\.shiftKey\)/)
    expect(mainTsSource).toMatch(/e\.key !== 'Tab'/)
    expect(mainTsSource).toMatch(
      /document\.getElementById\(RESUME_FOCUS_TARGET_ID\)\?\.focus\(\{ preventScroll: true \}\)/,
    )
  })

  it('ships one dialog Resume action and a programmatically focusable canvas', () => {
    const pauseOverlay = indexHtml.match(/id="pause-overlay"[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? ''
    expect(pauseOverlay).toMatch(/role="dialog"/)
    expect(pauseOverlay).toMatch(/id="btn-resume"[^>]*>RESUME</)
    expect(pauseOverlay).toMatch(/id="btn-restart"/)
    expect(pauseOverlay.match(/RESUME/g)?.length).toBe(1)
    expect(indexHtml).toMatch(/<canvas id="game"[^>]*tabindex="-1"/)
  })
})

describe('HUD hidden behind the title overlay (score/hint/Mute must not be a ghost control)', () => {
  it('wires a hud element lookup that syncChrome can hide', () => {
    expect(mainTsSource).toMatch(/const hud = document\.getElementById\('hud'\)/)
  })

  it('hides the HUD with the native hidden attribute while phase is title, and reveals it otherwise', () => {
    const syncChromeBody = mainTsSource.match(/function syncChrome\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(syncChromeBody).not.toBe('')
    const hudBlock = syncChromeBody.match(/if \(hud\) \{[\s\S]*?\n  \}/)?.[0] ?? ''
    expect(hudBlock).not.toBe('')
    // Must be driven by the title phase (not merely a static hide), so it un-hides once play starts.
    expect(hudBlock).toMatch(/phase === 'title'/)
    expect(hudBlock).toMatch(/hud\.toggleAttribute\('hidden',\s*hideHud\)/)
    expect(hudBlock).toMatch(/hud\.setAttribute\('aria-hidden',\s*hideHud \? 'true' : 'false'\)/)
  })

  it('calls syncChrome from every phase transition so the HUD re-syncs on Start/Pause/Resume/Restart', () => {
    for (const fn of ['startGame', 'pauseGame', 'resumeGame', 'restartToTitle']) {
      const body = mainTsSource.match(new RegExp(`function ${fn}\\(\\) \\{[\\s\\S]*?\\n\\}`))?.[0] ?? ''
      expect(body, `${fn} should exist`).not.toBe('')
      expect(body, `${fn} should call syncChrome()`).toMatch(/syncChrome\(\)/)
    }
  })

  it('keeps the global [hidden] rule forcing display:none so a hidden HUD is actually invisible', () => {
    const cssWithoutComments = styleCss.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(cssWithoutComments).toMatch(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/)
  })

  it('still ships the title-screen Mute control inside the HUD markup (so hiding #hud covers it)', () => {
    const hudMarkup = indexHtml.match(/<div id="hud">[\s\S]*?\n {6}<\/div>/)?.[0] ?? ''
    expect(hudMarkup).not.toBe('')
    expect(hudMarkup).toMatch(/id="btn-mute"/)
    expect(hudMarkup).toMatch(/id="score"/)
  })
})

describe('HUD controls off the racing line (T07)', () => {
  const cssWithoutComments = () => styleCss.replace(/\/\*[\s\S]*?\*\//g, '')

  it('anchors Pause/Mute in the top corner instead of the centered score stack', () => {
    const css = cssWithoutComments()
    const actionsRule = css.match(/#hud-actions\s*\{[^}]*\}/)?.[0] ?? ''
    expect(actionsRule).not.toBe('')
    expect(actionsRule).toMatch(/position:\s*absolute/)
    expect(actionsRule).not.toMatch(/position:\s*static/)
    expect(actionsRule).toMatch(/right:/)
  })

  it('uses a full-width HUD bar so score stays centered while actions sit in the corner', () => {
    const css = cssWithoutComments()
    const hudRule = css.match(/#hud\s*\{[^}]*\}/)?.[0] ?? ''
    expect(hudRule).not.toBe('')
    expect(hudRule).toMatch(/left:\s*0/)
    expect(hudRule).toMatch(/right:\s*0/)
    expect(hudRule).not.toMatch(/translateX\(-50%\)/)
  })

  it('insets Pause/Mute past the landscape GAS/BRAKE rail (same width token as the pad cluster)', () => {
    const css = cssWithoutComments()
    const landscapeActions =
      css.match(/body\.mode-mobile\.landscape\s+#hud-actions\s*\{[^}]*\}/)?.[0] ?? ''
    expect(landscapeActions).not.toBe('')
    expect(landscapeActions).toMatch(/right:\s*calc\(\s*min\(22vw,\s*140px\)\s*\+\s*8px\s*\)/)
    const padRail =
      css.match(
        /body\.mode-mobile\.landscape\s+\.pad-left-cluster,\s*body\.mode-mobile\.landscape\s+\.pad-right-cluster\s*\{[^}]*\}/,
      )?.[0] ?? ''
    expect(padRail).not.toBe('')
    expect(padRail).toMatch(/width:\s*min\(22vw,\s*140px\)/)
    expect(padRail).toMatch(/height:\s*100%/)
  })

  it('stacks the HUD above the touch pads so Pause/Mute are not under GAS/BRAKE chrome', () => {
    const css = cssWithoutComments()
    const hudRule = css.match(/#hud\s*\{[^}]*\}/)?.[0] ?? ''
    const padRule = css.match(/#touch-pad\s*\{[^}]*\}/)?.[0] ?? ''
    const hudZ = Number(hudRule.match(/z-index:\s*(\d+)/)?.[1])
    const padZ = Number(padRule.match(/z-index:\s*(\d+)/)?.[1])
    expect(hudZ).toBeGreaterThan(0)
    expect(padZ).toBeGreaterThan(0)
    expect(hudZ).toBeGreaterThan(padZ)
  })

  it('keeps the 44px Pause/Mute pair clear of the right rail at 844×390 landscape', () => {
    const css = cssWithoutComments()
    const landscapeActions =
      css.match(/body\.mode-mobile\.landscape\s+#hud-actions\s*\{[^}]*\}/)?.[0] ?? ''
    const rightExpr = landscapeActions.match(/right:\s*([^;]+);/)?.[1] ?? ''
    const minTok = rightExpr.match(/min\((\d+(?:\.\d+)?)vw,\s*(\d+(?:\.\d+)?)px\)/)
    const extraPx = Number(rightExpr.match(/\+\s*(\d+(?:\.\d+)?)px/)?.[1])
    expect(minTok).not.toBeNull()
    expect(Number.isFinite(extraPx)).toBe(true)
    const hudBtn = css.match(/\.hud-btn\s*\{[^}]*\}/)?.[0] ?? ''
    const gap = Number(
      (css.match(/#hud-actions\s*\{[^}]*\}/)?.[0] ?? '').match(/gap:\s*(\d+(?:\.\d+)?)px/)?.[1],
    )
    const minBtn = Number(hudBtn.match(/min-width:\s*(\d+(?:\.\d+)?)px/)?.[1])
    expect(minBtn).toBeGreaterThanOrEqual(44)
    expect(gap).toBeGreaterThan(0)
    const viewportW = 844
    const railW = Math.min((Number(minTok![1]) / 100) * viewportW, Number(minTok![2]))
    const inset = railW + extraPx
    const pairW = minBtn * 2 + gap
    const actionsRight = viewportW - inset
    const railLeft = viewportW - railW
    expect(actionsRight).toBeLessThanOrEqual(railLeft)
    expect(actionsRight - pairW).toBeGreaterThanOrEqual(0)
  })

  it('moves corner status into HTML on phone landscape so it clears the steer column', () => {
    expect(indexHtml).toMatch(/id="play-status"/)
    const css = cssWithoutComments()
    expect(css).toMatch(/body\.mode-mobile\.landscape\s+#play-status:not\(\[hidden\]\)/)
    expect(mainTsSource).toMatch(/function shouldUseHtmlPlayStatus\(\)/)
    expect(mainTsSource).toMatch(/syncPlayStatusOverlay\(\)/)
    const drawHud =
      mainTsSource.match(/function drawHudOverlay\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(drawHud).not.toBe('')
    expect(drawHud).toMatch(/syncPlayStatusOverlay\(\)/)
    expect(drawHud).toMatch(/if \(shouldUseHtmlPlayStatus\(\)\) return/)
    const returnAt = drawHud.indexOf('if (shouldUseHtmlPlayStatus()) return')
    const canvasStatusFill = drawHud.search(/fillRect\(\s*10,\s*H\s*-\s*28/)
    expect(returnAt).toBeGreaterThan(-1)
    expect(canvasStatusFill).toBeGreaterThan(returnAt)
    expect(drawHud.indexOf('syncPlayStatusOverlay()')).toBeLessThan(returnAt)
  })
})
