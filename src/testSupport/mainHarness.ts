import { ModuleKind, transpileModule } from 'typescript'
import mainSource from '../main.ts?raw'
import * as gameLogic from '../gameLogic'
import * as playerLabel from '../playerLabel'

type Car = {
  x: number; y: number; angle: number; speed: number; aiPhase: number
  color: string; width: number; length: number; name?: string; kind?: string
}

type RadioState = {
  phase: gameLogic.RunPhase; parkTimer: number; message: string; messageT: number; radioT: number
}

type GameAccess = {
  aiCars: Car[]
  player: Car
  trailer: { progress: number }
  state: RadioState
  setRadioState: (state: Partial<RadioState>) => void
  updateRadio: (dt: number) => void
  titlePreview: (time: number) => void
}

/** Run the shipped entry point with in-memory browser boundaries and no animation loop. */
export function loadMainGame() {
  const noop = () => {}
  const context = new Proxy<Record<string, unknown>>({}, {
    get: (target, key: string) => target[key] ?? (key === 'measureText'
      ? () => ({ width: 0 })
      : key.startsWith('create') ? () => ({ addColorStop: noop }) : noop),
  })
  function makeElement() {
    const classes = new Set<string>()
    const listeners = new Map<string, Array<() => void>>()
    return {
      width: 960, height: 640, clientWidth: 960, textContent: '', hidden: false,
      classList: {
        add: (name: string) => { classes.add(name) },
        remove: (name: string) => { classes.delete(name) },
        contains: (name: string) => classes.has(name),
        toggle: (name: string, force = !classes.has(name)) => {
          if (force) classes.add(name)
          else classes.delete(name)
          return force
        },
      },
      setAttribute: noop, removeAttribute: noop, toggleAttribute: noop, focus: noop,
      getContext: () => context,
      addEventListener: (event: string, listener: () => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener])
      },
      click: () => { for (const listener of listeners.get('click') ?? []) listener() },
    }
  }
  const elements = new Map<string, ReturnType<typeof makeElement>>()
  function element(id: string) {
    if (!elements.has(id)) elements.set(id, makeElement())
    return elements.get(id)!
  }
  let beepCount = 0
  class FakeAudioContext {
    state = 'running'
    currentTime = 0
    destination = {}
    createOscillator() {
      return {
        frequency: { value: 0 }, connect: noop, stop: noop,
        start: () => { beepCount += 1 },
      }
    }
    createGain() {
      return {
        gain: { setValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop,
      }
    }
  }
  const modules: Record<string, unknown> = {
    './gameLogic': gameLogic, './playerLabel': playerLabel, './style.css': {},
  }
  const bindings = {
    require: (id: string) => {
      if (!(id in modules)) throw new Error(`Unexpected module: ${id}`)
      return modules[id]
    },
    exports: {},
    document: { getElementById: element, body: makeElement(), querySelectorAll: () => [], addEventListener: noop },
    window: {
      innerWidth: 960, innerHeight: 640, AudioContext: FakeAudioContext,
      matchMedia: () => ({ matches: false, addEventListener: noop }), addEventListener: noop,
    },
    navigator: { userAgent: '', platform: '', maxTouchPoints: 0 },
    localStorage: { getItem: () => null, setItem: noop },
    performance: { now: () => 0 }, requestAnimationFrame: noop, cancelAnimationFrame: noop, setInterval: noop,
  }
  const compiled = transpileModule(mainSource, {
    compilerOptions: { module: ModuleKind.CommonJS },
  }).outputText
  // Test access stays outside the shipped game. All behavior above executes unchanged.
  const access = new Function(...Object.keys(bindings), `${compiled}
    return {
      aiCars, player, trailer, updateRadio, titlePreview,
      get state() { return { phase, parkTimer, message, messageT, radioT }; },
      setRadioState(next) {
        if ('phase' in next) phase = next.phase;
        if ('parkTimer' in next) parkTimer = next.parkTimer;
        if ('message' in next) message = next.message;
        if ('messageT' in next) messageT = next.messageT;
        if ('radioT' in next) radioT = next.radioT;
      }
    };
  `)(...Object.values(bindings)) as GameAccess
  return { game: access, element, get beepCount() { return beepCount } }
}
