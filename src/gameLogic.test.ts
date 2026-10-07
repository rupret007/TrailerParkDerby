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
  phaseAfterBlur,
  phaseAfterHidden,
  pointInTrailerBed,
  pointOnTrack,
  shouldResetComboOnMiss,
  stepPlayer,
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

  it('accepts the bed center and rejects the cab / sides', () => {
    const bedMidX = -(trailer.cabL * 0.15 + trailer.bedL / 2)
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
    const bedMidX = -(trailer.cabL * 0.15 + trailer.bedL / 2)
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
    const bedMidX = -(trailer.cabL * 0.15 + trailer.bedL / 2)
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
