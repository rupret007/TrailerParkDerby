import { afterEach, describe, expect, it, vi } from 'vitest'
import indexHtml from '../index.html?raw'
import readme from '../README.md?raw'

// Import the real entry point with only browser services replaced. Keyboard events
// bubble through its document/window handlers; native button activation is checked
// separately by asserting defaults remain available and dispatching the click.
async function boot() {
  vi.resetModules()
  vi.useFakeTimers()
  type Modifiers = Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey'>>
  type TestEvent = {
    target: TestElement
    code: string
    key: string
    shiftKey: boolean
    ctrlKey: boolean
    metaKey: boolean
    altKey: boolean
    defaultPrevented: boolean
    preventDefault(): void
  }
  class EventHub {
    listeners = new Map<string, ((event: TestEvent) => void)[]>()
    addEventListener(type: string, listener: (event: TestEvent) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
    }
    emit(type: string, event: TestEvent) {
      for (const listener of this.listeners.get(type) ?? []) listener(event)
    }
  }
  class TestElement extends EventHub {
    attrs = new Map<string, string>()
    classes = new Set<string>()
    textContent = ''
    width = 960
    height = 640
    parent: TestElement | null = null
    focusOptions?: FocusOptions
    constructor(readonly id: string, readonly tagName = 'div') { super() }
    classList = {
      contains: (name: string) => this.classes.has(name),
      add: (name: string) => this.classes.add(name),
      remove: (name: string) => this.classes.delete(name),
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
    closest(selector: string): TestElement | null {
      return selector.split(',').map(s => s.trim()).includes(this.tagName)
        ? this : this.parent?.closest(selector) ?? null
    }
    contains(target: TestElement): boolean {
      return target === this || (target.parent !== null && this.contains(target.parent))
    }
    focus(options?: FocusOptions) {
      doc.activeElement = this
      this.focusOptions = options
      doc.emit('focusin', event(this))
    }
    getContext() { return {} } // No animation frames are advanced in these input tests.
  }
  const elements = new Map<string, TestElement>()
  for (const match of indexHtml.matchAll(/<([\w-]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new TestElement(match[2], match[1])
    if (/\bhidden(?:\s|>)/.test(match[0])) element.setAttribute('hidden', '')
    elements.set(element.id, element)
  }
  const get = (id: string) => {
    const element = elements.get(id)
    if (!element) throw new Error(`Missing fixture element: ${id}`)
    return element
  }
  const PAUSE_ACTIONS = ['btn-resume', 'btn-pause-mute', 'btn-reset-car', 'btn-restart']
  for (const id of PAUSE_ACTIONS) get(id).parent = get('pause-overlay')
  const doc = Object.assign(new EventHub(), {
    activeElement: null as TestElement | null,
    body: new TestElement('body'),
    getElementById: (id: string) => elements.get(id) ?? null,
    querySelectorAll: () => [],
  })
  const win = Object.assign(new EventHub(), {
    innerWidth: 960, innerHeight: 640,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  })
  function event(target = doc.activeElement!, code = '', shiftKey = false, modifiers: Modifiers = {}): TestEvent {
    return {
      target, code, key: code, shiftKey, defaultPrevented: false,
      ctrlKey: false, metaKey: false, altKey: false, ...modifiers,
      preventDefault() { this.defaultPrevented = true },
    }
  }
  vi.stubGlobal('document', doc)
  vi.stubGlobal('window', win)
  vi.stubGlobal('navigator', { userAgent: '', maxTouchPoints: 0 })
  for (const name of ['Node', 'Element', 'HTMLElement']) vi.stubGlobal(name, TestElement)
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  await import('./main')
  const click = (id: string) => get(id).emit('click', event(get(id)))
  const key = (code: string, type = 'keydown', shiftKey = false, modifiers: Modifiers = {}) => {
    const e = event(doc.activeElement!, code, shiftKey, modifiers)
    e.target.emit(type, e)
    doc.emit(type, e)
    win.emit(type, e)
    return e
  }
  const press = (code: string, shiftKey = false, modifiers: Modifiers = {}) => {
    const down = key(code, 'keydown', shiftKey, modifiers)
    key(code, 'keyup', shiftKey, modifiers)
    return down
  }
  click('btn-start')
  get('game').focus()
  return {
    get, click, press,
    active: () => doc.activeElement?.id,
    paused: () => !get('pause-overlay').attrs.has('hidden'),
    addInput(tag: string) {
      const input = new TestElement('future-input', tag)
      input.parent = get('pause-overlay')
      input.focus()
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('pause shortcuts through the installed input handlers', () => {
  it.each(['ctrlKey', 'metaKey', 'altKey'] as const)('leaves %s + P to the browser without changing game phase or focus', async (modifier) => {
    const h = await boot()
    expect(h.press('KeyP', false, { [modifier]: true }).defaultPrevented).toBe(false)
    expect(h.paused()).toBe(false)
    expect(h.active()).toBe('game')
    h.press('KeyP')
    expect(h.paused()).toBe(true)
    for (const action of ['btn-resume', 'btn-pause-mute', 'btn-reset-car', 'btn-restart']) {
      h.get(action).focus()
      expect(h.press('KeyP', false, { [modifier]: true }).defaultPrevented).toBe(false)
      expect(h.paused()).toBe(true)
      expect(h.active()).toBe(action)
    }
    h.press('KeyP')
    expect(h.paused()).toBe(false)
    expect(h.active()).toBe('game')
  })

  it('keeps Shift + P available as the uppercase pause shortcut', async () => {
    const h = await boot()
    h.press('KeyP', true)
    expect(h.paused()).toBe(true)
    h.press('KeyP', true)
    expect(h.paused()).toBe(false)
    expect(h.active()).toBe('game')
  })

  it.each(['btn-resume', 'btn-pause-mute', 'btn-reset-car', 'btn-restart'])('P → keyup → P resumes from %s', async (action) => {
    const h = await boot()
    h.press('KeyP')
    expect(h.paused()).toBe(true)
    expect(h.active()).toBe('btn-resume')
    for (let i = 0; i < ['btn-resume', 'btn-pause-mute', 'btn-reset-car', 'btn-restart'].indexOf(action); i++) h.press('Tab')
    expect(h.active()).toBe(action)
    h.press('KeyP')
    expect(h.paused()).toBe(false)
    expect(h.active()).toBe('game')
    expect(h.get('game').focusOptions).toEqual({ preventScroll: true })
  })

  it.each(['btn-resume', 'btn-pause-mute', 'btn-reset-car', 'btn-restart'])('P resumes mouse-opened pause from %s', async (action) => {
    const h = await boot()
    h.click('btn-pause')
    h.get(action).focus()
    h.press('KeyP')
    expect(h.paused()).toBe(false)
    expect(h.active()).toBe('game')
  })

  it.each(['btn-resume', 'btn-pause-mute', 'btn-reset-car', 'btn-restart'])('Escape still resumes from %s', async (action) => {
    const h = await boot()
    expect(h.press('Escape').defaultPrevented).toBe(true)
    expect(h.paused()).toBe(true)
    h.get(action).focus()
    expect(h.press('Escape').defaultPrevented).toBe(true)
    expect(h.paused()).toBe(false)
    expect(h.active()).toBe('game')
  })

  it('traps Tab in both directions and redirects focus back into the dialog', async () => {
    const h = await boot()
    h.press('KeyP')
    const cycles = {
      forward: ['btn-pause-mute', 'btn-reset-car', 'btn-restart', 'btn-resume'],
      backward: ['btn-restart', 'btn-reset-car', 'btn-pause-mute', 'btn-resume'],
    }
    for (const shift of [false, true]) {
      for (const expected of shift ? cycles.backward : cycles.forward) {
        expect(h.press('Tab', shift).defaultPrevented).toBe(true)
        expect(h.active()).toBe(expected)
      }
    }
    h.get('game').focus()
    expect(h.active()).toBe('btn-resume')
    h.press('KeyP')
    expect(h.press('Tab').defaultPrevented).toBe(false)
  })

  it.each(['Enter', 'Space'])('preserves %s defaults and both dialog click actions', async (code) => {
    const h = await boot()
    for (const action of ['btn-resume', 'btn-restart']) {
      h.press('KeyP')
      h.get(action).focus()
      expect(h.press(code).defaultPrevented).toBe(false)
      expect(h.paused()).toBe(true)
      h.click(action)
      expect(h.paused()).toBe(false)
      expect(h.active()).toBe(action === 'btn-resume' ? 'game' : 'btn-start')
      expect(h.get('overlay').attrs.has('hidden')).toBe(action === 'btn-resume')
    }
  })

  it.each(['input', 'textarea'])('does not intercept P typed in a future dialog %s', async (tag) => {
    const h = await boot()
    h.press('KeyP')
    h.addInput(tag)
    expect(h.press('KeyP').defaultPrevented).toBe(false)
    expect(h.paused()).toBe(true)
    expect(h.active()).toBe('future-input')
  })

  it('keeps the documented Esc / P pause/resume shortcut', () => {
    expect(readme).toContain('| `Esc` / `P` | Pause / resume |')
  })
})
