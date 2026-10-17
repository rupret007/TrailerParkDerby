import { describe, expect, it } from 'vitest'
import { AI_SPAWN_PHASES, createTrackGeom, PLAYER_SPAWN_PHASE, spawnClearOfTraffic } from './gameLogic'
import { loadMainGame } from './testSupport/mainHarness'

describe('Start resets the live rival pack', () => {
  it('restores all existing rival poses after the title preview moves traffic into the spawn', () => {
    const runtime = loadMainGame()
    const rivals = [...runtime.game.aiCars]
    const initial = rivals.map((car) => ({ ...car }))

    // Exercise the real title animation until Miss Patty reaches the player's phase.
    const seconds = ((PLAYER_SPAWN_PHASE - AI_SPAWN_PHASES[3] + 1) % 1) / 0.05
    const frames = Math.ceil(seconds / 0.016)
    for (let i = 1; i <= frames; i += 1) runtime.game.titlePreview(i * 16)
    expect(runtime.game.aiCars).not.toEqual(initial)
    expect(spawnClearOfTraffic(PLAYER_SPAWN_PHASE, rivals.map((car) => car.aiPhase))).toBe(false)
    // Speed is mutable run state too; Start must restore it along with phase and pose.
    for (const car of rivals) car.speed += 35

    runtime.element('btn-start').click()

    expect(runtime.game.state.phase).toBe('playing')
    expect(runtime.game.trailer.progress).toBe(0.05)
    expect(runtime.game.player.speed).toBe(0)
    expect(runtime.game.aiCars).toEqual(initial)
    runtime.game.aiCars.forEach((car, i) => {
      expect(car).toBe(rivals[i])
      expect(car.aiPhase).toBeCloseTo(AI_SPAWN_PHASES[i], 12)
      expect(car.speed).toBeCloseTo(140 + AI_SPAWN_PHASES[i] * 40, 12)
    })
    expect(spawnClearOfTraffic(PLAYER_SPAWN_PHASE, rivals.map((car) => car.aiPhase))).toBe(true)
    // The centerline spawn must leave room for the player's parked start position.
    expect(Math.min(...rivals.map((car) => Math.hypot(
      car.x - runtime.game.player.x, car.y - runtime.game.player.y,
    )))).toBeGreaterThan(26)
  })

  it('also resets the same pack after Restart returns to the title', () => {
    const runtime = loadMainGame()
    const initial = runtime.game.aiCars.map((car) => ({ ...car }))
    runtime.element('btn-start').click()
    runtime.element('btn-pause').click()
    runtime.element('btn-restart').click()
    expect(runtime.game.state.phase).toBe('title')
    for (let i = 1; i <= 120; i += 1) runtime.game.titlePreview(i * 16)
    expect(runtime.game.aiCars).not.toEqual(initial)

    runtime.element('btn-start').click()

    expect(runtime.game.aiCars).toEqual(initial)
  })

  it('uses the canvas dimensions for reset positions', () => {
    const runtime = loadMainGame()
    const geom = createTrackGeom(480, 320)
    runtime.game.aiCars[0].x = -1000
    runtime.game.aiCars[0].y = -1000
    runtime.element('btn-start').click()
    for (const car of runtime.game.aiCars) {
      expect(Math.abs(car.x - geom.cx)).toBeLessThanOrEqual(geom.rx)
      expect(Math.abs(car.y - geom.cy)).toBeLessThanOrEqual(geom.ry)
    }
  })
})
