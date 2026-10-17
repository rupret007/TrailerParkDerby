import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { stepPlayer, stepTrailerProgress } from './gameLogic'
import indexHtml from '../index.html?raw'

// Exercise the shipped pause controls and real game state with deterministic
// browser services. Native browser layout and button activation are not simulated.
function browserFixture(storedMute = '0') {
  type Listener = (event: Event) => void
  class Target {
    listeners = new Map<string, Listener[]>()
    addEventListener(type: string, listener: Listener) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
    }
    dispatch(type: string, event: Event) {
      for (const listener of this.listeners.get(type) ?? []) listener(event)
    }
  }
  class Element extends Target {
    attrs = new Map<string, string>()
    classes = new Set<string>()
    textContent = ''
    hidden = false
    width = 960
    height = 640
    clientWidth = 960
    constructor(public id: string, public tagName: string) { super() }
    classList = {
      contains: (name: string) => this.classes.has(name),
      add: (name: string) => { this.classes.add(name) },
      remove: (name: string) => { this.classes.delete(name) },
      toggle: (name: string, force = !this.classes.has(name)) => {
        if (force) this.classes.add(name)
        else this.classes.delete(name)
        return force
      },
    }
    setAttribute(name: string, value: string) { this.attrs.set(name, value) }
    removeAttribute(name: string) { this.attrs.delete(name) }
    toggleAttribute(name: string, force: boolean) {
      if (force) this.setAttribute(name, '')
      else this.removeAttribute(name)
    }
    closest(selector: string) {
      return selector.split(',').some(tag => tag.trim().toUpperCase() === this.tagName) ? this : null
    }
    contains(target: Element) {
      return this === target || (this.id === 'pause-overlay' && ['btn-resume', 'btn-pause-mute', 'btn-reset-car', 'btn-restart'].includes(target.id))
    }
    focus() {
      if (document.activeElement === this) return
      document.activeElement = this
      document.dispatch('focusin', eventFor(this))
    }
    getContext() { return context }
  }
  const elements = new Map<string, Element>()
  for (const match of indexHtml.matchAll(/<(\w+)\b[^>]*\bid="([^"]+)"/g)) {
    elements.set(match[2], new Element(match[2], match[1].toUpperCase()))
  }
  const get = (id: string) => elements.get(id)!
  const document = Object.assign(new Target(), {
    body: new Element('body', 'BODY'), activeElement: null as Element | null,
    hidden: false, getElementById: get, querySelectorAll: () => [],
  })
  const window = Object.assign(new Target(), {
    innerWidth: 960, innerHeight: 640,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  })
  const context = new Proxy<Record<string, unknown>>({
    canvas: get('game'), measureText: () => ({ width: 24 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  }, { get: (object, key: string) => object[key] ?? (() => {}) })
  function eventFor(target: Element | null, code = '', shiftKey = false) {
    const event = {
      target, code, key: code === 'Space' ? ' ' : code, shiftKey,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true },
    }
    return event as unknown as KeyboardEvent
  }
  let now = 1000
  let handle = 0
  const frames = new Map<number, FrameRequestCallback>()
  vi.stubGlobal('document', document)
  vi.stubGlobal('window', window)
  for (const name of ['Element', 'HTMLElement', 'Node']) vi.stubGlobal(name, Element)
  vi.stubGlobal('navigator', { userAgent: 'Android Mobile', maxTouchPoints: 1 })
  const storage = new Map([['trailerParkDerby_mute', storedMute]])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  })
  vi.stubGlobal('performance', { now: () => now })
  vi.stubGlobal('setInterval', vi.fn())
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++handle, callback)
    return handle
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  return {
    get, document, storage,
    click(id: string) { get(id).dispatch('click', eventFor(get(id))) },
    key(type: 'keydown' | 'keyup', code: string, shiftKey = false, modifiers: { ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean } = {}) {
      const event = Object.assign(eventFor(document.activeElement, code, shiftKey), modifiers)
      document.activeElement?.dispatch(type, event)
      document.dispatch(type, event)
      window.dispatch(type, event)
      return event
    },
    tick() {
      now += 1000 / 60
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach(callback => callback(now))
    },
  }
}

describe('Mute and Reset car in the pause dialog', () => {
  let browser: ReturnType<typeof browserFixture>
  let physics: MockInstance<typeof stepPlayer>
  let trailerClock: MockInstance<typeof stepTrailerProgress>

  beforeEach(async () => {
    vi.resetModules()
    browser = browserFixture()
    const logic = await import('./gameLogic')
    physics = vi.spyOn(logic, 'stepPlayer')
    trailerClock = vi.spyOn(logic, 'stepTrailerProgress')
    await import('./main')
    browser.tick()
    browser.click('btn-start')
    browser.get('game').focus()
    browser.tick()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('toggles and persists sound from pause, synchronizes both controls, and stays paused', () => {
    browser.click('btn-pause')
    browser.get('btn-pause-mute').focus()
    const updates = physics.mock.calls.length
    for (const muted of [true, false]) {
      browser.click('btn-pause-mute')
      expect(browser.storage.get('trailerParkDerby_mute')).toBe(muted ? '1' : '0')
      for (const id of ['btn-mute', 'btn-pause-mute']) {
        expect(browser.get(id).attrs.get('aria-pressed')).toBe(String(muted))
        expect(browser.get(id).attrs.get('aria-label')).toBe(muted ? 'Unmute sound' : 'Mute sound')
      }
      expect(browser.get('btn-mute').textContent).toBe(muted ? 'Unmute' : 'Mute')
      expect(browser.get('btn-pause-mute').textContent).toBe(muted ? 'UNMUTE' : 'MUTE')
      expect(browser.get('pause-overlay').attrs.has('hidden')).toBe(false)
      expect(browser.get('hud').attrs.has('inert')).toBe(true)
      expect(browser.document.activeElement?.id).toBe('btn-pause-mute')
      browser.tick()
      expect(physics).toHaveBeenCalledTimes(updates)
    }
  })

  it('loads a saved mute preference into the pause control before its first activation', async () => {
    vi.restoreAllMocks()
    vi.resetModules()
    browser = browserFixture('1')
    await import('./main')
    browser.click('btn-start')
    browser.click('btn-pause')
    expect(browser.get('btn-pause-mute').attrs.get('aria-pressed')).toBe('true')
    expect(browser.get('btn-pause-mute').textContent).toBe('UNMUTE')
    browser.click('btn-pause-mute')
    expect(browser.storage.get('trailerParkDerby_mute')).toBe('0')
    expect(browser.get('btn-mute').attrs.get('aria-pressed')).toBe('false')
  })

  it('keeps both new actions reachable in the forward and reverse focus cycle', () => {
    browser.click('btn-pause')
    for (const id of ['btn-pause-mute', 'btn-reset-car', 'btn-restart', 'btn-resume']) {
      expect(browser.key('keydown', 'Tab').defaultPrevented).toBe(true)
      expect(browser.document.activeElement?.id).toBe(id)
    }
    for (const id of ['btn-restart', 'btn-reset-car', 'btn-pause-mute', 'btn-resume']) {
      expect(browser.key('keydown', 'Tab', true).defaultPrevented).toBe(true)
      expect(browser.document.activeElement?.id).toBe(id)
    }
    browser.get('btn-mute').focus()
    expect(browser.document.activeElement?.id).toBe('btn-resume')
  })

  it.each(['button', 'KeyR'] as const)('%s resets the player and resumes the same scored race', async (action) => {
    const logic = await import('./gameLogic')
    // Make a park available so the real scoring path establishes nonzero score
    // and combo. Reset must preserve these, unlike restarting a race.
    const parkReady = vi.spyOn(logic, 'isParkHoldReady').mockReturnValue(true)
    for (let i = 0; i < 100; i++) browser.tick()
    parkReady.mockRestore()
    const score = browser.get('score').textContent
    const combo = browser.get('combo').textContent
    expect(Number(score)).toBeGreaterThan(0)
    expect(Number(combo)).toBeGreaterThan(1)
    const player = physics.mock.lastCall![0]
    player.x = 100
    player.y = 100
    player.speed = 80
    const progress = trailerClock.mock.results.at(-1)!.value
    browser.click('btn-pause')
    browser.get('btn-reset-car').focus()
    if (action === 'button') browser.click('btn-reset-car')
    else expect(browser.key('keydown', 'KeyR').defaultPrevented).toBe(true)

    const geom = logic.createTrackGeom(480, 320)
    const spawn = logic.pointOnTrack(logic.PLAYER_SPAWN_PHASE, geom)
    const normal = logic.normalOnTrack(logic.PLAYER_SPAWN_PHASE, geom)
    const tangent = logic.tangentOnTrack(logic.PLAYER_SPAWN_PHASE, geom)
    expect(player.x).toBeCloseTo(spawn.x + normal.x * logic.PLAYER_SPAWN_LANE)
    expect(player.y).toBeCloseTo(spawn.y + normal.y * logic.PLAYER_SPAWN_LANE)
    expect(player.angle).toBeCloseTo(Math.atan2(tangent.y, tangent.x))
    expect(player.speed).toBe(0)
    expect(browser.get('score').textContent).toBe(score)
    expect(browser.get('combo').textContent).toBe(combo)
    expect(browser.get('overlay').attrs.has('hidden')).toBe(true)
    expect(browser.get('pause-overlay').attrs.has('hidden')).toBe(true)
    expect(browser.get('hud').attrs.has('inert')).toBe(false)
    expect(browser.document.activeElement?.id).toBe('game')
    expect(browser.get('announce').textContent).toMatch(/^Retry/)
    trailerClock.mockClear()
    physics.mockClear()
    browser.tick()
    expect(trailerClock.mock.calls[0][0]).toBe(progress)
    expect(physics.mock.calls.length).toBeGreaterThan(0)
    browser.key('keydown', 'KeyW')
    browser.tick()
    expect(physics.mock.lastCall![1].accel).toBe(true)
    expect(player.speed).toBeGreaterThan(0)
  })

  it.each(['ctrlKey', 'metaKey', 'altKey'] as const)('leaves %s + R (browser reload) alone while paused', (modifier) => {
    const player = physics.mock.lastCall![0]
    player.x = 100
    player.y = 100
    player.speed = 80
    browser.click('btn-pause')
    expect(browser.key('keydown', 'KeyR', false, { [modifier]: true }).defaultPrevented).toBe(false)
    expect(player).toMatchObject({ x: 100, y: 100, speed: 80 })
    expect(browser.get('pause-overlay').attrs.has('hidden')).toBe(false)
  })

  it('ignores Reset car when the game is not paused', () => {
    const player = physics.mock.lastCall![0]
    player.x = 100
    player.y = 100
    player.speed = 80
    browser.click('btn-reset-car')
    expect(player).toMatchObject({ x: 100, y: 100, speed: 80 })
    expect(browser.get('pause-overlay').attrs.has('hidden')).toBe(true)
  })
})
