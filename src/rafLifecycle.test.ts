import { afterEach, describe, expect, it, vi } from 'vitest'
import indexHtml from '../index.html?raw'

// Import the real entry point and drive its registered handlers. Only browser
// services are faked; production scheduling, physics and drawing all execute.
async function boot() {
  vi.resetModules()
  const pending = new Map<number, FrameRequestCallback>()
  let nextId = 0
  let now = 1000
  let activeElement: TestElement | null = null
  class TestElement extends EventTarget {
    attrs = new Map<string, string>()
    classes = new Set<string>()
    width = 960
    height = 640
    clientWidth = 960
    textContent = ''
    hidden = false
    classList = {
      add: (name: string) => { this.classes.add(name) },
      remove: (name: string) => { this.classes.delete(name) },
      contains: (name: string) => this.classes.has(name),
      toggle: (name: string, force = !this.classes.has(name)) => {
        if (force) this.classes.add(name)
        else this.classes.delete(name)
        return force
      },
    }
    constructor(readonly id: string) { super() }
    setAttribute(name: string, value: string) { this.attrs.set(name, value) }
    removeAttribute(name: string) { this.attrs.delete(name) }
    toggleAttribute(name: string, force: boolean) {
      if (force) this.attrs.set(name, '')
      else this.attrs.delete(name)
    }
    focus() { activeElement = this }
    closest(selector: string) {
      return selector.includes('button') && this.id.startsWith('btn-') ? this : null
    }
    contains(target: TestElement) {
      return target === this || (this.id === 'pause-overlay' && ['btn-resume', 'btn-restart'].includes(target.id))
    }
    getContext() { return context }
  }
  const elements = new Map([...indexHtml.matchAll(/id="([^"]+)"/g)].map((m) => [m[1], new TestElement(m[1])]))
  const get = (id: string) => {
    const element = elements.get(id)
    if (!element) throw new Error(`Missing fixture element: ${id}`)
    return element
  }
  const paintFrame = vi.fn()
  const fillRect = vi.fn((...args: number[]) => {
    // The track starts each render with its grass background. The vignette
    // also covers the full canvas, so count only the initial grass paint.
    if (context.fillStyle === '#0d1a12' && args.join() === '0,0,960,640') paintFrame()
  })
  const context = new Proxy<Record<string, unknown>>({
    canvas: get('game'),
    fillRect,
    measureText: (value: string) => ({ width: value.length * 7 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  }, { get: (target, key: string) => key in target ? target[key] : () => {} })
  const doc = Object.assign(new EventTarget(), {
    body: new TestElement('body'),
    hidden: false,
    getElementById: (id: string) => elements.get(id) ?? null,
    querySelectorAll: () => [],
  })
  Object.defineProperty(doc, 'activeElement', { get: () => activeElement })
  const win = Object.assign(new EventTarget(), {
    innerWidth: 960, innerHeight: 640,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  })
  vi.stubGlobal('document', doc)
  vi.stubGlobal('window', win)
  for (const name of ['Element', 'HTMLElement', 'Node']) vi.stubGlobal(name, TestElement)
  vi.stubGlobal('navigator', { userAgent: '', platform: '', maxTouchPoints: 0 })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
  vi.stubGlobal('performance', { now: () => now })
  vi.stubGlobal('setInterval', vi.fn())
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.set(++nextId, callback)
    return nextId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { pending.delete(id) })
  const logic = await import('./gameLogic')
  const clock = vi.spyOn(logic, 'clampDt')
  const player = vi.spyOn(logic, 'stepPlayer')
  const trailer = vi.spyOn(logic, 'stepTrailerProgress')
  await import('./main')
  return {
    pending, clock, player, trailer, fillRect, paintFrame,
    click: (id: string) => get(id).dispatchEvent(new Event('click')),
    keydown: (code: string, repeat = false) => win.dispatchEvent(Object.assign(new Event('keydown'), { code, repeat })),
    escape: () => win.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Escape' })),
    blur: () => win.dispatchEvent(new Event('blur')),
    visibility: (hidden: boolean) => {
      doc.hidden = hidden
      doc.dispatchEvent(new Event('visibilitychange'))
    },
    elapse: (ms: number) => { now += ms },
    tick: (ms = 16) => {
      now += ms
      // rAF snapshots handles once per display frame. Newly queued callbacks
      // wait for the next frame, and canceled handles never run.
      for (const id of [...pending.keys()]) {
        const callback = pending.get(id)
        if (!callback) continue
        pending.delete(id)
        callback(now)
      }
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('animation scheduling through production phase handlers', () => {
  it.each(['Escape', 'KeyP', 'Pause', 'KeyPause'])('keeps gameplay frozen while %s is held and resumes once on a new press', async (code) => {
    const h = await boot()
    h.click('btn-start')
    h.tick()
    h.keydown(code)
    expect(h.pending.size).toBe(0)
    h.player.mockClear()
    h.clock.mockClear()
    h.paintFrame.mockClear()
    for (let i = 0; i < 4; i++) {
      h.keydown(code, true)
      h.tick(250)
      expect(h.pending.size).toBe(0)
    }
    expect(h.player).not.toHaveBeenCalled()
    expect(h.clock).not.toHaveBeenCalled()
    expect(h.paintFrame).not.toHaveBeenCalled()
    h.keydown(code)
    h.keydown(code, true)
    expect(h.pending.size).toBe(1)
    h.tick(20)
    expect(h.clock.mock.calls).toEqual([[0.02]])
    expect(h.player).toHaveBeenCalledTimes(1)
    expect(h.paintFrame).toHaveBeenCalledTimes(1)
    expect(h.pending.size).toBe(1)
  })

  it('keeps one callback when Start is clicked before the first title frame', async () => {
    const h = await boot()
    expect(h.pending.size).toBe(1)
    h.click('btn-start')
    expect(h.pending.size).toBe(1)
    h.tick()
    expect(h.player).toHaveBeenCalledTimes(1)
    expect(h.pending.size).toBe(1)
  })

  it('does not multiply callbacks or clock ticks after rapid pause/resume', async () => {
    const h = await boot()
    h.tick()
    h.click('btn-start')
    h.tick()
    h.clock.mockClear()
    h.player.mockClear()
    h.trailer.mockClear()
    h.fillRect.mockClear()
    h.paintFrame.mockClear()
    for (let i = 0; i < 8; i++) {
      h.escape()
      h.escape()
      expect(h.pending.size).toBe(1)
      h.tick(20)
      expect(h.pending.size).toBe(1)
    }
    expect(h.clock.mock.calls).toEqual(Array.from({ length: 8 }, () => [0.02]))
    expect(h.player).toHaveBeenCalledTimes(8)
    expect(h.trailer).toHaveBeenCalledTimes(8)
    expect(h.paintFrame).toHaveBeenCalledTimes(8)
  })

  it.each(['button', 'hidden', 'blur'] as const)('freezes updates and rendering on %s pause, then resets the resume clock', async (reason) => {
    const h = await boot()
    h.click('btn-start')
    h.tick()
    if (reason === 'button') h.click('btn-pause')
    else if (reason === 'hidden') h.visibility(true)
    else h.blur()
    expect(h.pending.size).toBe(0)
    h.clock.mockClear()
    h.player.mockClear()
    h.trailer.mockClear()
    h.fillRect.mockClear()
    h.tick(5000)
    h.tick(5000)
    expect(h.pending.size).toBe(0)
    expect(h.clock).not.toHaveBeenCalled()
    expect(h.player).not.toHaveBeenCalled()
    expect(h.trailer).not.toHaveBeenCalled()
    expect(h.fillRect).not.toHaveBeenCalled()
    h.visibility(false)
    expect(h.pending.size).toBe(0)
    h.click('btn-resume')
    h.click('btn-resume') // A redundant Resume must also be harmless.
    expect(h.pending.size).toBe(1)
    h.tick(20)
    expect(h.clock.mock.calls).toEqual([[0.02]])
    expect(h.player).toHaveBeenCalledTimes(1)
    expect(h.player.mock.calls[0][2]).toBeCloseTo(0.02)
    expect(h.trailer).toHaveBeenCalledTimes(1)
    expect(h.pending.size).toBe(1)
  })

  it('keeps title and play clocks single after queued restart/start sequences', async () => {
    const h = await boot()
    // No display frame occurs between these transitions, so neither old chain
    // can rely on observing an intermediate phase to retire itself.
    for (let i = 0; i < 8; i++) {
      h.click('btn-start')
      h.click('btn-pause')
      h.click('btn-restart')
      expect(h.pending.size).toBe(1)
    }
    h.tick(20)
    expect(h.clock.mock.calls).toEqual([[0.02]])
    expect(h.player).not.toHaveBeenCalled()
    expect(h.paintFrame).toHaveBeenCalledTimes(1)
    expect(h.pending.size).toBe(1)
    h.click('btn-start')
    h.click('btn-pause')
    h.click('btn-restart')
    h.click('btn-start')
    h.tick(20)
    h.tick(20)
    expect(h.clock.mock.calls).toEqual([[0.02], [0.02], [0.02]])
    expect(h.player).toHaveBeenCalledTimes(2)
    expect(h.paintFrame).toHaveBeenCalledTimes(3)
    expect(h.pending.size).toBe(1)
  })

  it('resets the title clock on restart and does not invent time at a repeated timestamp', async () => {
    const h = await boot()
    h.click('btn-start')
    h.tick()
    h.click('btn-pause')
    h.elapse(5000)
    h.click('btn-restart')
    h.clock.mockClear()
    h.player.mockClear()
    h.tick(20)
    h.tick(0)
    expect(h.clock.mock.calls).toEqual([[0.02], [0]])
    expect(h.player).not.toHaveBeenCalled()
    expect(h.pending.size).toBe(1)
  })
})
