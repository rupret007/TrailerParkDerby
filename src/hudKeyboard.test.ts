import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { stepPlayer } from './gameLogic'
import indexHtml from '../index.html?raw'

// Exercise the real entry point and physics with deterministic browser services.
// This does not simulate native button activation; it checks that key handlers
// leave its default action available. Native activation needs a browser check.
function browserFixture() {
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
  function eventFor(target: Element | null, code = '', shiftKey = false, repeat = false) {
    const event = {
      target, code, key: code === 'Space' ? ' ' : code, shiftKey, repeat,
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
  vi.stubGlobal('navigator', { userAgent: '', maxTouchPoints: 0 })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
  vi.stubGlobal('performance', { now: () => now })
  vi.stubGlobal('setInterval', vi.fn())
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++handle, callback)
    return handle
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  return {
    get, document,
    click(id: string) { get(id).dispatch('click', eventFor(get(id))) },
    key(type: 'keydown' | 'keyup', code: string, shiftKey = false, repeat = false) {
      const event = eventFor(document.activeElement, code, shiftKey, repeat)
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

describe('HUD keyboard input during play', () => {
  let browser: ReturnType<typeof browserFixture>
  let physics: MockInstance<typeof stepPlayer>
  const idleInput = { accel: false, brake: false, left: false, right: false, handbrake: false }
  function input() {
    browser.tick()
    return physics.mock.lastCall?.[1]
  }

  beforeEach(async () => {
    vi.resetModules()
    browser = browserFixture()
    physics = vi.spyOn(await import('./gameLogic'), 'stepPlayer')
    await import('./main')
    browser.click('btn-start')
    browser.get('game').focus()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each([
    ['KeyW', 'accel'], ['ArrowUp', 'accel'], ['KeyS', 'brake'], ['ArrowDown', 'brake'],
    ['KeyA', 'left'], ['ArrowLeft', 'left'], ['KeyD', 'right'], ['ArrowRight', 'right'],
  ])('%s drives from focused Mute and releases even after focus changes', (code, action) => {
    browser.get('btn-mute').focus()
    const event = browser.key('keydown', code)
    expect(input()).toEqual({ ...idleInput, [action]: true })
    expect(browser.document.activeElement?.id).toBe('game')
    if (code.startsWith('Arrow')) expect(event.defaultPrevented).toBe(true)
    browser.get('btn-pause').focus()
    browser.key('keyup', code)
    expect(input()).toEqual(idleInput)
  })

  it('Mute activation returns focus to play so Space brakes without toggling sound again', () => {
    browser.get('btn-mute').focus()
    browser.click('btn-mute')
    expect(browser.get('btn-mute').attrs.get('aria-pressed')).toBe('true')
    expect(browser.document.activeElement?.id).toBe('game')
    browser.key('keydown', 'KeyW')
    expect(input()).toEqual({ ...idleInput, accel: true })
    expect(physics.mock.results.at(-1)?.value.speed).toBeGreaterThan(0)
    browser.key('keyup', 'KeyW')
    expect(browser.key('keydown', 'Space').defaultPrevented).toBe(true)
    expect(input()).toEqual({ ...idleInput, handbrake: true })
    browser.key('keyup', 'Space')
    expect(input()).toEqual(idleInput)
    expect(browser.get('btn-mute').attrs.get('aria-pressed')).toBe('true')
  })

  it.each(['btn-mute', 'btn-pause'])('keeps deliberate %s focus when held driving keys repeat', (id) => {
    browser.key('keydown', 'KeyW')
    browser.key('keydown', 'ArrowLeft')
    expect(input()).toEqual({ ...idleInput, accel: true, left: true })
    // The browser moves focus here when the player Tabs to a HUD action.
    expect(browser.key('keydown', 'Tab').defaultPrevented).toBe(false)
    browser.get(id).focus()
    for (let i = 0; i < 3; i++) {
      browser.key('keydown', 'KeyW', false, true)
      expect(browser.key('keydown', 'ArrowLeft', false, true).defaultPrevented).toBe(true)
      expect(browser.document.activeElement?.id).toBe(id)
      expect(input()).toEqual({ ...idleInput, accel: true, left: true })
    }
    for (const code of ['Enter', 'Space']) {
      expect(browser.key('keydown', code).defaultPrevented).toBe(false)
      expect(input()).toEqual({ ...idleInput, accel: true, left: true })
      browser.key('keyup', code)
    }
    browser.key('keyup', 'KeyW')
    browser.key('keyup', 'ArrowLeft')
    expect(input()).toEqual(idleInput)
    expect(browser.document.activeElement?.id).toBe(id)
    browser.click(id)
    expect(browser.document.activeElement?.id).toBe(id === 'btn-mute' ? 'game' : 'btn-resume')
    if (id === 'btn-mute') expect(browser.get(id).attrs.get('aria-pressed')).toBe('true')
  })

  it('driving from focused Mute hands subsequent Space to the handbrake', () => {
    browser.get('btn-mute').focus()
    browser.key('keydown', 'KeyW')
    browser.key('keydown', 'ArrowRight')
    expect(browser.key('keydown', 'Space').defaultPrevented).toBe(true)
    expect(input()).toEqual({ ...idleInput, accel: true, right: true, handbrake: true })
    expect(physics.mock.results.at(-1)?.value.speed).toBeGreaterThan(0)
    for (const code of ['KeyW', 'ArrowRight', 'Space']) browser.key('keyup', code)
    expect(input()).toEqual(idleInput)
    expect(browser.get('btn-mute').attrs.get('aria-pressed')).toBe('false')
  })

  it.each(['btn-mute', 'btn-pause'])('leaves native Enter/Space activation and Tab available on %s', (id) => {
    browser.get(id).focus()
    for (const code of ['Enter', 'Space', 'Tab']) {
      expect(browser.key('keydown', code).defaultPrevented).toBe(false)
      expect(input()).toEqual(idleInput)
      browser.key('keyup', code)
      expect(browser.document.activeElement?.id).toBe(id)
    }
    if (id === 'btn-pause') {
      browser.key('keydown', 'ArrowUp')
      expect(input()).toEqual({ ...idleInput, accel: true })
      expect(browser.document.activeElement?.id).toBe('game')
      browser.key('keyup', 'ArrowUp')
      expect(input()).toEqual(idleInput)
    }
    browser.click(id)
    expect(browser.document.activeElement?.id).toBe(id === 'btn-mute' ? 'game' : 'btn-resume')
  })

  it('clears held HUD driving keys on pause and keeps dialog activation and focus trap working', () => {
    browser.get('btn-mute').focus()
    browser.key('keydown', 'KeyW')
    browser.key('keydown', 'ArrowLeft')
    browser.key('keydown', 'Space')
    expect(input()).toEqual({ ...idleInput, accel: true, left: true, handbrake: true })
    browser.click('btn-pause')
    expect(browser.document.activeElement?.id).toBe('btn-resume')
    browser.get('btn-mute').focus()
    expect(browser.document.activeElement?.id).toBe('btn-resume')
    expect(browser.key('keydown', 'Tab').defaultPrevented).toBe(true)
    expect(browser.document.activeElement?.id).toBe('btn-pause-mute')
    expect(browser.key('keydown', 'Tab', true).defaultPrevented).toBe(true)
    expect(browser.document.activeElement?.id).toBe('btn-resume')
    expect(browser.key('keydown', 'Tab', true).defaultPrevented).toBe(true)
    expect(browser.document.activeElement?.id).toBe('btn-restart')
    expect(browser.key('keydown', 'Tab').defaultPrevented).toBe(true)
    expect(browser.document.activeElement?.id).toBe('btn-resume')
    for (const code of ['Enter', 'Space']) {
      expect(browser.key('keydown', code).defaultPrevented).toBe(false)
      browser.key('keyup', code)
    }
    const updates = physics.mock.calls.length
    browser.tick()
    expect(physics).toHaveBeenCalledTimes(updates)
    browser.click('btn-resume')
    expect(browser.document.activeElement?.id).toBe('game')
    expect(input()).toEqual(idleInput)
    browser.key('keyup', 'KeyW')
    browser.key('keyup', 'ArrowLeft')
    browser.key('keydown', 'Escape')
    browser.click('btn-restart')
    expect(browser.document.activeElement?.id).toBe('btn-start')
    browser.click('btn-start')
    expect(input()).toEqual(idleInput)
  })
})
