import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import * as gameLogic from './gameLogic'
import * as playerLabel from './playerLabel'
import mainSource from './main.ts?raw'

// Execute the actual entry point and installed handlers with deterministic browser
// services. The test-only bridge observes private state without a production API.
const executable = transpileModule(`${mainSource}
export const probe = {
  frame,
  state: () => ({ phase, muted, neonNight, spawnProtect, player: { ...player }, keys: [...keys] }),
};`, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText

function boot() {
  const listeners = new Map<string, EventListener[]>()
  const listen = (id: string, type: string, cb: EventListener) => {
    const key = `${id}:${type}`
    listeners.set(key, [...(listeners.get(key) ?? []), cb])
  }
  const context = new Proxy({
    measureText: (s: string) => ({ width: s.length * 7 }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
  }, { get: (object, key) => Reflect.get(object, key) ?? (() => {}) })
  class Element {
    width = 960
    height = 640
    clientWidth = 960
    textContent = ''
    attributes = new Map<string, string>()
    classes = new Set<string>()
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
    constructor(public id: string) {}
    addEventListener(type: string, cb: EventListener) { listen(this.id, type, cb) }
    setAttribute(name: string, value: string) { this.attributes.set(name, value) }
    removeAttribute(name: string) { this.attributes.delete(name) }
    toggleAttribute(name: string, force: boolean) {
      if (force) this.setAttribute(name, '')
      else this.removeAttribute(name)
    }
    focus() { document.activeElement = this }
    closest(selector: string) { return selector.includes('button') && this.id.startsWith('btn-') ? this : null }
    contains(target: Element) {
      return target === this || (this.id === 'pause-overlay' && ['btn-resume', 'btn-restart'].includes(target.id))
    }
    getContext() { return context }
  }
  const elements = new Map<string, Element>()
  const get = (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element(id))
    return elements.get(id)!
  }
  const document = {
    body: get('body'), activeElement: get('game'), hidden: false,
    getElementById: get, querySelectorAll: () => [],
    addEventListener: (type: string, cb: EventListener) => listen('document', type, cb),
  }
  const storageWrite = vi.fn()
  const exports: { probe?: {
    frame: (time: number) => void
    state: () => {
      phase: string; muted: boolean; neonNight: boolean; spawnProtect: number
      player: { x: number; y: number; speed: number; angle: number }; keys: string[]
    }
  } } = {}
  const browser = {
    exports,
    require: (name: string) => {
      if (name === './style.css') return {}
      if (name === './gameLogic') return gameLogic
      if (name === './playerLabel') return playerLabel
      throw new Error(`Unexpected import: ${name}`)
    },
    document, Element, HTMLElement: Element, Node: Element,
    window: {
      innerWidth: 960, innerHeight: 640,
      matchMedia: () => ({ matches: false, addEventListener() {} }),
      addEventListener: (type: string, cb: EventListener) => listen('window', type, cb),
    },
    navigator: { userAgent: '', maxTouchPoints: 0 },
    localStorage: { getItem: () => null, setItem: storageWrite },
    performance: { now: () => 1000 }, requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    setTimeout() {}, setInterval() {},
  }
  new Function(...Object.keys(browser), executable)(...Object.values(browser))
  const dispatch = (id: string, type: string, event: object) => {
    for (const cb of listeners.get(`${id}:${type}`) ?? []) cb(event as Event)
  }
  const key = (code: string, repeat = false, type = 'keydown') => {
    const event = { code, key: code, repeat, target: document.activeElement, preventDefault: vi.fn() }
    dispatch('document', type, event)
    dispatch('window', type, event)
    return event
  }
  dispatch('btn-start', 'click', { target: get('btn-start') })
  get('game').focus()
  let now = 1000
  return {
    get, key, storageWrite, state: exports.probe!.state,
    // Model the native button default: Enter keydown clicks its original target
    // unless a handler cancels it. Browser checks validate this activation path.
    enter: (repeat = false) => {
      const event = key('Enter', repeat)
      if (!event.preventDefault.mock.calls.length && event.target.id.startsWith('btn-')) {
        dispatch(event.target.id, 'click', { target: event.target })
      }
      return event
    },
    release: (code: string) => key(code, false, 'keyup'),
    tick: () => { now += 50; exports.probe!.frame(now) },
    active: () => document.activeElement.id,
  }
}

describe('one-shot shortcut auto-repeat', () => {
  it('toggles focused Mute only once while Enter is held, then allows a fresh press', () => {
    const h = boot()
    h.get('btn-mute').focus()
    expect(h.enter().preventDefault).not.toHaveBeenCalled()
    expect(h.state().muted).toBe(true)
    // HUD Mute hands focus back to the canvas mid-drive (T12), so the held
    // repeats below target the canvas and must still be cancelled.
    expect(h.active()).toBe('game')
    for (let i = 0; i < 3; i++) {
      const repeat = h.enter(true)
      expect(h.state().muted).toBe(true)
      expect(h.storageWrite).toHaveBeenCalledTimes(1)
      expect(repeat.preventDefault).toHaveBeenCalledTimes(1)
    }
    h.release('Enter')
    // A fresh press on Mute (player Tabs back to it) toggles again.
    h.get('btn-mute').focus()
    expect(h.enter().preventDefault).not.toHaveBeenCalled()
    expect(h.state().muted).toBe(false)
    expect(h.storageWrite).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['btn-pause', 'paused', 'btn-resume'],
    ['btn-restart', 'title', 'btn-start'],
  ])('does not activate the next focused action when Enter is held on %s', (action, phase, focus) => {
    const h = boot()
    if (action === 'btn-restart') h.key('Escape')
    h.get(action).focus()
    expect(h.enter().preventDefault).not.toHaveBeenCalled()
    expect(h.state().phase).toBe(phase)
    expect(h.active()).toBe(focus)
    for (let i = 0; i < 3; i++) {
      const repeat = h.enter(true)
      expect(h.state().phase).toBe(phase)
      expect(h.active()).toBe(focus)
      expect(repeat.preventDefault).toHaveBeenCalledTimes(1)
    }
    h.release('Enter')
    expect(h.enter().preventDefault).not.toHaveBeenCalled()
    expect(h.state().phase).toBe('playing')
  })

  it('ignores an Enter repeat that first arrives on Mute without blocking Space defaults', () => {
    const h = boot()
    h.get('btn-mute').focus()
    const repeat = h.enter(true)
    expect(h.state().muted).toBe(false)
    expect(h.storageWrite).not.toHaveBeenCalled()
    expect(repeat.preventDefault).toHaveBeenCalledTimes(1)
    expect(h.key('Space').preventDefault).not.toHaveBeenCalled()
    expect(h.key('Space', true).preventDefault).not.toHaveBeenCalled()
    h.release('Space')
    h.release('Enter')
    h.enter()
    expect(h.state().muted).toBe(true)
  })

  it.each(['Escape', 'KeyP', 'KeyPause'])('%s toggles only on fresh presses', (code) => {
    const h = boot()
    h.key(code)
    expect(h.state().phase).toBe('paused')
    expect(h.active()).toBe('btn-resume')
    // Escape must stay paused even after pause moved focus to Resume.
    h.key(code, true)
    expect(h.state().phase).toBe('paused')
    // P's dialog-focus routing is a separate item; exercise its canvas route too.
    h.get('game').focus()
    for (let i = 0; i < 3; i++) {
      h.key(code, true)
      expect(h.state().phase).toBe('paused')
    }
    h.release(code)
    h.key(code)
    expect(h.state().phase).toBe('playing')
    expect(h.active()).toBe('game')
    h.key(code, true)
    expect(h.state().phase).toBe('playing')
  })

  it.each(['KeyM', 'KeyN'])('%s toggles once, then works after keyup', (code) => {
    const h = boot()
    const value = () => code === 'KeyM' ? h.state().muted : h.state().neonNight
    const initial = value()
    h.key(code)
    expect(value()).toBe(!initial)
    for (let i = 0; i < 3; i++) {
      h.key(code, true)
      expect(value()).toBe(!initial)
    }
    if (code === 'KeyM') expect(h.storageWrite).toHaveBeenCalledTimes(1)
    h.release(code)
    h.key(code)
    expect(value()).toBe(initial)
    if (code === 'KeyM') expect(h.storageWrite).toHaveBeenCalledTimes(2)
  })

  it('held R neither resets a moving car nor renews spawn protection', () => {
    const h = boot()
    h.key('KeyR')
    const spawn = h.state().player
    expect(h.state().spawnProtect).toBe(gameLogic.SPAWN_PROTECT_SEC)
    h.key('KeyW')
    for (let i = 0; i < 20; i++) {
      h.tick()
      const beforeRepeat = h.state()
      h.key('KeyR', true)
      expect(h.state().player).toEqual(beforeRepeat.player)
      expect(h.state().spawnProtect).toBe(beforeRepeat.spawnProtect)
    }
    expect(h.state().spawnProtect).toBe(0)
    expect(h.state().player).not.toEqual(spawn)
    h.release('KeyR')
    h.key('KeyR')
    expect(h.state().player).toEqual(spawn)
    expect(h.state().spawnProtect).toBe(gameLogic.SPAWN_PROTECT_SEC)
  })

  it.each(['Escape', 'KeyP', 'KeyPause', 'KeyM', 'KeyN', 'KeyR'])(
    'ignores %s repeats even when the initial keydown was not received', (code) => {
      const h = boot()
      h.tick()
      const before = h.state()
      h.key(code, true)
      const after = h.state()
      expect({ ...after, keys: [] }).toEqual({ ...before, keys: [] })
    },
  )

  it.each([['KeyW', 'KeyA'], ['ArrowUp', 'ArrowRight']])(
    'keeps held gas/steer (%s/%s) active and releases them on keyup', (gas, steer) => {
      const h = boot()
      const angle = h.state().player.angle
      for (const code of [gas, steer]) h.key(code)
      for (let i = 0; i < 3; i++) {
        for (const code of [gas, steer]) {
          const event = h.key(code, true)
          expect(event.preventDefault).toHaveBeenCalledTimes(code.startsWith('Arrow') ? 1 : 0)
        }
        h.tick()
      }
      expect(h.state().player.speed).toBeGreaterThan(0)
      expect(h.state().player.angle).not.toBe(angle)
      expect(h.state().keys).toEqual(expect.arrayContaining([gas, steer]))
      h.release(gas)
      h.release(steer)
      expect(h.state().keys).toEqual([])
      const releasedAngle = h.state().player.angle
      h.tick()
      expect(h.state().player.angle).toBe(releasedAngle)
    },
  )
})
