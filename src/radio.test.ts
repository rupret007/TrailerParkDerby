import { describe, expect, it } from 'vitest'
import { loadMainGame } from './testSupport/mainHarness'

describe('radio announcements during parking', () => {
  it.each([0.01, 0.5, 1.49])('preserves the announcement and stays silent during a %ss park hold', (parkTimer) => {
    const runtime = loadMainGame()
    runtime.element('btn-start').click()
    const announcement = runtime.element('announce').textContent
    const beforeBeeps = runtime.beepCount
    runtime.game.setRadioState({ parkTimer, messageT: 0, radioT: 0 })

    runtime.game.updateRadio(0.016)

    expect(runtime.game.state.message).toBe(announcement)
    expect(runtime.element('announce').textContent).toBe(announcement)
    expect(runtime.game.state.parkTimer).toBe(parkTimer)
    expect(runtime.beepCount).toBe(beforeBeeps)
    expect(runtime.game.state.radioT).toBeGreaterThan(0)

    // Once the hold clears, the next scheduled line is audible and announced.
    const nextRadio = runtime.game.state.radioT
    runtime.game.setRadioState({ parkTimer: 0 })
    runtime.game.updateRadio(nextRadio + 0.016)
    expect(runtime.element('announce').textContent).toMatch(/^RADIO:/)
    expect(runtime.game.state.messageT).toBe(2)
    expect(runtime.beepCount).toBe(beforeBeeps + 2)
  })

  it('preserves a fresh flash even after the park hold ends', () => {
    const runtime = loadMainGame()
    runtime.element('btn-start').click()
    const announcement = runtime.element('announce').textContent
    const beforeBeeps = runtime.beepCount
    runtime.game.setRadioState({ parkTimer: 0, messageT: 0.41, radioT: 0 })

    runtime.game.updateRadio(0.016)

    expect(runtime.element('announce').textContent).toBe(announcement)
    expect(runtime.game.state.messageT).toBe(0.41)
    expect(runtime.beepCount).toBe(beforeBeeps)
  })

  it.each(['title', 'paused'] as const)('does not advance or announce radio while %s', (phase) => {
    const runtime = loadMainGame()
    runtime.game.setRadioState({ phase, parkTimer: 0, messageT: 0, radioT: 0 })

    runtime.game.updateRadio(0.016)

    expect(runtime.game.state.radioT).toBe(0)
    expect(runtime.element('announce').textContent).toBe('')
    expect(runtime.beepCount).toBe(0)
  })
})
