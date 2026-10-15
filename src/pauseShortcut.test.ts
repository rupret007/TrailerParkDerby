import { afterEach, describe, expect, it, vi } from 'vitest'
import indexHtml from '../index.html?raw'
import readme from '../README.md?raw'

// Import the real entry point with only browser services replaced. Keyboard events
// bubble through its document/window handlers; native button activation is checked
// separately by asserting defaults remain available and dispatching the click.
async function boot() {
  vi.resetModules()
  vi.useFakeTimers()
  type TestEvent = {
    target: TestElement
    code: string
    key: string
    shiftKey: boolean
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
  for (const id of ['btn-resume', 'btn-restart']) get(id).parent = get('pause-overlay')
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
  function event(target = doc.activeElement!, code = '', shiftKey = false): TestEvent {
    return {
      target, code, key: code, shiftKey, defaultPrevented: false,
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
  const key = (code: string, type = 'keydown', shiftKey = false) => {
    const e = event(doc.activeElement!, code, shiftKey)
    e.target.emit(type, e)
    doc.emit(type, e)
    win.emit(type, e)
    return e
  }
  const press = (code: string, shiftKey = false) => {
    const down = key(code, 'keydown', shiftKey)
    key(code, 'keyup', shiftKey)
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
  it.each(['btn-resume', 'btn-restart'])('P → keyup → P resumes from %s', async (action) => {
    const h = await boot()
    h.press('KeyP')
    expect(h.paused()).toBe(true)
    expect(h.active()).toBe('btn-resume')
    if (action === 'btn-restart') h.press('Tab')
    expect(h.active()).toBe(action)
    h.press('KeyP')
    expect(h.paused()).toBe(false)
    expect(h.active()).toBe('game')
    expect(h.get('game').focusOptions).toEqual({ preventScroll: true })
  })

  it.each(['btn-resume', 'btn-restart'])('P resumes mouse-opened pause from %s', async (action) => {
    const h = await boot()
    h.click('btn-pause')
    h.get(action).focus()
    h.press('KeyP')
    expect(h.paused()).toBe(false)
    expect(h.active()).toBe('game')
  })

  it.each(['btn-resume', 'btn-restart'])('Escape still resumes from %s', async (action) => {
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
    for (const shift of [false, true]) {
      expect(h.press('Tab', shift).defaultPrevented).toBe(true)
      expect(h.active()).toBe('btn-restart')
      expect(h.press('Tab', shift).defaultPrevented).toBe(true)
      expect(h.active()).toBe('btn-resume')
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
