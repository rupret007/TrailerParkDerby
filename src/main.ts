import './style.css'
import {
  applySoftTrackPull,
  clampDt,
  collectBoost,
  comboTitle,
  createTrackGeom,
  decayParkTimer,
  evaluatePark,
  finitePose,
  isBump,
  isNearMiss,
  isParkHoldReady,
  nearMissBonus,
  normalOnTrack as normalOnTrackAt,
  PARK_HOLD_SEC,
  parseStoredInt,
  PLAYER_SPAWN_LANE,
  PLAYER_SPAWN_PHASE,
  SPAWN_PROTECT_SEC,
  phaseAfterBlur,
  phaseAfterHidden,
  pointInTrailerBed as pointInTrailerBedAt,
  pointOnTrack as pointOnTrackAt,
  shouldResetComboOnMiss,
  stepPlayer,
  stepTrailerProgress,
  tangentOnTrack as tangentOnTrackAt,
  tickBoostRemain,
  tickOrbRespawn,
  TRACK,
  type RunPhase,
} from './gameLogic'

const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const overlay = document.getElementById('overlay') as HTMLDivElement
const pauseOverlay = document.getElementById('pause-overlay') as HTMLDivElement
const btnStart = document.getElementById('btn-start') as HTMLButtonElement
const btnResume = document.getElementById('btn-resume') as HTMLButtonElement
const btnRestart = document.getElementById('btn-restart') as HTMLButtonElement
const btnPause = document.getElementById('btn-pause') as HTMLButtonElement
const btnMute = document.getElementById('btn-mute') as HTMLButtonElement
const scoreEl = document.getElementById('score') as HTMLSpanElement
const comboEl = document.getElementById('combo') as HTMLSpanElement
const bestEl = document.getElementById('best') as HTMLSpanElement
const announceEl = document.getElementById('announce')

const W = canvas.width
const H = canvas.height
const CX = W / 2
const CY = H / 2
const geom = createTrackGeom(CX, CY)

const HS_KEY = 'trailerParkDerby_highScore'
const MUTE_KEY = 'trailerParkDerby_mute'

const PARK_LINES = [
  'That’s a DOUBLE-WIDE PARK!',
  'Your lawn chairs salute you!',
  'HOA: reluctantly impressed.',
  'Parked harder than Uncle Kevin’s truck.',
  'Satellite dish has entered the chat.',
  'Somebody call the county fair!',
  'Grill still running. Respect.',
]

const PERFECT_LINES = [
  'SURGICAL. Like parallel parking a burrito.',
  'Centered like Grandma’s ceramic flamingos.',
  'The flatbed blushed.',
  'Perfect enough to make the neighbors mad.',
  'That park had a warranty.',
]

const FAIL_LINES = [
  'Fell off — the trailer filed a complaint.',
  'Gravity: undefeated.',
  'That’s going in the HOA newsletter.',
  'Roadside assistance denied.',
  'You parked… emotionally.',
]

const NEAR_LINES = [
  'NEAR MISS — almost collected a cousin!',
  'Skimmed ‘em like a bad rumor!',
  'Paint traded. Feelings unchanged.',
  'That was a courtesy bump in spirit only.',
]

const TAGLINES = [
  'Oval night race · park the moving flatbed',
  'Where the HOA fears to tread',
  'Flamingos optional. Skill not.',
  'Park it or explain it to the neighbors',
  'Boost orbs: legally distinct from energy drinks',
]

const AI_NAMES = ['Cousin Ricky', 'Darlene', 'Big Earl', 'Miss Patty']

interface Car {
  x: number
  y: number
  angle: number
  speed: number
  color: string
  isPlayer: boolean
  aiPhase: number
  width: number
  length: number
  name?: string
  kind?: 'sedan' | 'van'
}

interface BoostOrb {
  x: number
  y: number
  alive: boolean
  respawnIn: number
}

const keys = new Set<string>()
let phase: RunPhase = 'title'
let muted = localStorage.getItem(MUTE_KEY) === '1'
let neonNight = true
let score = 0
let combo = 1
let best = parseStoredInt(localStorage.getItem(HS_KEY))
let parkTimer = 0
let message = ''
let messageT = 0
let boostRemain = 0
let lastTs = 0
let audioCtx: AudioContext | null = null
let perfectStreak = 0
let nearMissCd = 0
const motionMq = window.matchMedia('(prefers-reduced-motion: reduce)')
let reduceMotion = motionMq.matches
motionMq.addEventListener('change', () => {
  reduceMotion = motionMq.matches
})
type Spark = { x: number; y: number; vx: number; vy: number; life: number; color: string }
const sparks: Spark[] = []
const touch = { accel: false, brake: false, left: false, right: false, handbrake: false }
let shakeT = 0
let radioT = 8
let hornCd = 0
let lastGasTap = 0

const player: Car = {
  x: CX - TRACK.rx,
  y: CY,
  angle: Math.PI / 2, // face clockwise travel on left straight (up → toward top when CW)
  speed: 0,
  color: '#e8f0ff', // player: pale/silver distinct
  isPlayer: true,
  aiPhase: 0,
  width: 18,
  length: 34,
  kind: 'sedan',
}

const aiCars: Car[] = [
  makeAi('#c42828', 0.15, AI_NAMES[0], 'sedan'), // red sedan
  makeAi('#1a1a1e', 0.45, AI_NAMES[1], 'sedan'), // black car
  makeAi('#e6c200', 0.75, AI_NAMES[2], 'van'), // yellow van
  makeAi('#3d5c3a', 0.92, AI_NAMES[3], 'sedan'), // beat-up green
]

const trailer = {
  progress: 0.05,
  speed: 0.09, // laps per second-ish along param
  bedW: 54,
  bedL: 100,
  cabL: 38,
}

const boosts: BoostOrb[] = [
  { x: 0, y: 0, alive: true, respawnIn: 0 },
  { x: 0, y: 0, alive: true, respawnIn: 0 },
]

bestEl.textContent = String(best)

/** Solid play-mode detection: real phones/tablets get touch UI; desktop keeps keyboard. */
function isIosLike(): boolean {
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return true
  // iPadOS desktop UA still has touch + Mac
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

function isMobilePlay(): boolean {
  if (isIosLike()) return true
  if (/Android|Mobile/i.test(navigator.userAgent || '')) return true
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const fineHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches
  if (coarse && !fineHover) return true
  if (navigator.maxTouchPoints > 0 && window.matchMedia('(max-width: 900px)').matches && !fineHover) {
    return true
  }
  return false
}

function isLandscape(): boolean {
  return window.matchMedia('(orientation: landscape)').matches || window.innerWidth > window.innerHeight
}

function applyPlayMode() {
  const mobile = isMobilePlay()
  document.body.classList.toggle('mode-mobile', mobile)
  document.body.classList.toggle('mode-desktop', !mobile)
  document.body.classList.toggle('landscape', isLandscape())

  const pad = document.getElementById('touch-pad')
  const orient = document.getElementById('orient-hint')
  if (pad) {
    const showPads = mobile && phase === 'playing'
    if (showPads) {
      pad.classList.remove('hidden')
      pad.removeAttribute('hidden')
    } else {
      pad.classList.add('hidden')
      pad.setAttribute('hidden', '')
      touch.accel = touch.brake = touch.left = touch.right = touch.handbrake = false
    }
  }
  if (orient) {
    const showOrient = mobile && !isLandscape()
    orient.classList.toggle('hidden', !showOrient)
    if (showOrient) orient.removeAttribute('hidden')
    else orient.setAttribute('hidden', '')
  }
  const hint = document.getElementById('hint')
  if (hint) {
    hint.textContent = mobile
      ? 'Touch: steer left · Gas/Brake right · park ~1.5s'
      : 'Park on the moving trailer · hold ~1.5s'
  }
}


function makeAi(
  color: string,
  phase: number,
  name = 'Rival',
  kind: 'sedan' | 'van' = 'sedan',
): Car {
  const p = pointOnTrack(phase)
  const tan = tangentOnTrack(phase)
  const isVan = kind === 'van'
  return {
    x: p.x,
    y: p.y,
    angle: Math.atan2(tan.y, tan.x),
    speed: 140 + phase * 40,
    color,
    isPlayer: false,
    aiPhase: phase,
    width: isVan ? 20 : 16,
    length: isVan ? 36 : 30,
    name,
    kind,
  }
}

function pick<T>(arr: T[]): T {
  return arr[(Math.random() * arr.length) | 0]
}

function horn() {
  if (hornCd > 0) return
  hornCd = 0.35
  beep(180, 0.12, 'sawtooth', 0.05)
  beep(140, 0.18, 'sawtooth', 0.04)
  flash(pick(['HONK!', 'MOVE IT, EARL!', 'Coming through!', 'Watch the flamingos!']))
}

function pointOnTrack(t: number) {
  return pointOnTrackAt(t, geom)
}

function tangentOnTrack(t: number) {
  return tangentOnTrackAt(t, geom)
}

function normalOnTrack(t: number) {
  return normalOnTrackAt(t, geom)
}

function setOverlayHidden(el: HTMLElement, hidden: boolean) {
  el.classList.toggle('hidden', hidden)
  if (hidden) el.setAttribute('hidden', '')
  else el.removeAttribute('hidden')
}

function syncChrome() {
  if (btnPause) {
    const show = phase === 'playing' || phase === 'paused'
    btnPause.hidden = !show
    btnPause.setAttribute('aria-hidden', show ? 'false' : 'true')
    btnPause.textContent = phase === 'paused' ? 'Resume' : 'Pause'
    btnPause.setAttribute('aria-label', phase === 'paused' ? 'Resume game' : 'Pause game')
  }
  if (btnMute) {
    btnMute.setAttribute('aria-pressed', muted ? 'true' : 'false')
    btnMute.textContent = muted ? 'Unmute' : 'Mute'
    btnMute.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound')
  }
}

function ensureAudio() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    if (!audioCtx) audioCtx = new AC()
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume().catch(() => {
        /* autoplay / gesture — ignore */
      })
    }
  } catch {
    audioCtx = null
  }
}

function beep(freq: number, dur = 0.08, type: OscillatorType = 'square', gain = 0.04) {
  if (muted) return
  ensureAudio()
  if (!audioCtx || audioCtx.state !== 'running') return
  try {
    const t0 = audioCtx.currentTime
    const osc = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    osc.type = type
    osc.frequency.value = freq
    g.gain.setValueAtTime(Math.max(0.0001, gain), t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.01, dur))
    osc.connect(g)
    g.connect(audioCtx.destination)
    osc.start(t0)
    osc.stop(t0 + dur)
  } catch {
    /* closed context / autoplay — never break the loop */
  }
}

function flash(msg: string, hold = 2.1) {
  message = msg
  messageT = hold
  if (announceEl) announceEl.textContent = msg
}

function shake(amount = 0.35) {
  shakeT = Math.max(shakeT, amount)
}

let spawnProtect = 0

function resetPlayerNearStart() {
  const t = PLAYER_SPAWN_PHASE
  const p = pointOnTrack(t)
  const tan = tangentOnTrack(t)
  const n = normalOnTrack(t)
  player.x = p.x + n.x * PLAYER_SPAWN_LANE
  player.y = p.y + n.y * PLAYER_SPAWN_LANE
  player.angle = Math.atan2(tan.y, tan.x)
  player.speed = 0
  parkTimer = 0
  spawnProtect = SPAWN_PROTECT_SEC
}

function placeBoosts() {
  boosts[0] = orbAt(0.28)
  boosts[1] = orbAt(0.68)
}

function orbAt(t: number): BoostOrb {
  const p = pointOnTrack(t)
  const n = normalOnTrack(t)
  return { x: p.x - n.x * 22, y: p.y - n.y * 22, alive: true, respawnIn: 0 }
}

function clearTouch() {
  touch.accel = touch.brake = touch.left = touch.right = touch.handbrake = false
  document.querySelectorAll('.pad.is-down').forEach((el) => el.classList.remove('is-down'))
}

function startGame() {
  phase = 'playing'
  setOverlayHidden(overlay, true)
  setOverlayHidden(pauseOverlay, true)
  score = 0
  combo = 1
  parkTimer = 0
  boostRemain = 0
  perfectStreak = 0
  nearMissCd = 0
  sparks.length = 0
  shakeT = 0
  radioT = 6 + Math.random() * 4
  hornCd = 0
  trailer.progress = 0.05
  placeBoosts()
  resetPlayerNearStart()
  scoreEl.textContent = '0'
  comboEl.textContent = '1'
  keys.clear()
  clearTouch()
  syncChrome()
  applyPlayMode()
  ensureAudio()
  beep(440, 0.1, 'triangle', 0.05)
  beep(660, 0.12, 'triangle', 0.04)
  flash(pick(['Engines warm. Flamingos nervous.', 'Flatbed’s moving — don’t embarrass the county.', 'Go park something ridiculous.']), 2.0)
  lastTs = performance.now()
  requestAnimationFrame(frame)
}

function pauseGame() {
  if (phase !== 'playing') return
  phase = 'paused'
  keys.clear()
  clearTouch()
  setOverlayHidden(pauseOverlay, false)
  syncChrome()
  applyPlayMode()
  btnResume?.focus()
}

function resumeGame() {
  if (phase !== 'paused') return
  phase = 'playing'
  setOverlayHidden(pauseOverlay, true)
  keys.clear()
  clearTouch()
  syncChrome()
  applyPlayMode()
  lastTs = performance.now()
  requestAnimationFrame(frame)
}

function restartToTitle() {
  phase = 'title'
  keys.clear()
  clearTouch()
  setOverlayHidden(pauseOverlay, true)
  setOverlayHidden(overlay, false)
  parkTimer = 0
  boostRemain = 0
  shakeT = 0
  messageT = 0
  syncChrome()
  applyPlayMode()
  btnStart?.focus()
  lastTs = performance.now()
  requestAnimationFrame(titlePreview)
}

function toggleMute() {
  muted = !muted
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  syncChrome()
  flash(muted ? 'Muted' : 'Sound on')
}

btnStart.addEventListener('click', startGame)
btnResume?.addEventListener('click', resumeGame)
btnRestart?.addEventListener('click', restartToTitle)
btnPause?.addEventListener('click', () => {
  if (phase === 'playing') pauseGame()
  else if (phase === 'paused') resumeGame()
})
btnMute?.addEventListener('click', toggleMute)

window.addEventListener('keydown', (e) => {
  const onUi = e.target instanceof HTMLElement && !!e.target.closest('button, a, input, textarea')
  if (!onUi) {
    keys.add(e.code)
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault()
    }
  }
  if (e.code === 'Escape') {
    if (phase === 'playing') {
      e.preventDefault()
      pauseGame()
    } else if (phase === 'paused') {
      e.preventDefault()
      resumeGame()
    }
    return
  }
  if ((e.code === 'KeyP' || e.code === 'KeyPause') && !onUi) {
    if (phase === 'playing') pauseGame()
    else if (phase === 'paused') resumeGame()
  }
  if (e.code === 'Enter' && phase === 'title' && !onUi) startGame()
  if (e.code === 'KeyN' && !onUi) neonNight = !neonNight
  if (e.code === 'KeyM' && !onUi) toggleMute()
  if (e.code === 'KeyH' && phase === 'playing' && !onUi) {
    horn()
  }
  if (e.code === 'KeyR' && phase === 'playing' && !onUi) {
    resetPlayerNearStart()
    flash(pick(['Retry — pride intact', 'Retry — flamingos judging', 'Retry — HOA watching']))
    beep(220, 0.1)
  }
})

window.addEventListener('keyup', (e) => keys.delete(e.code))

function trailerPose() {
  const t = trailer.progress
  const p = pointOnTrack(t)
  const tan = tangentOnTrack(t)
  const angle = Math.atan2(tan.y, tan.x)
  return { x: p.x, y: p.y, angle, tan }
}


function pointInTrailerBed(px: number, py: number): boolean {
  return pointInTrailerBedAt(px, py, trailerPose(), trailer)
}

function updatePlayer(dt: number) {
  const next = stepPlayer(
    player,
    {
      accel: keys.has('KeyW') || keys.has('ArrowUp') || touch.accel,
      brake: keys.has('KeyS') || keys.has('ArrowDown') || touch.brake,
      left: keys.has('KeyA') || keys.has('ArrowLeft') || touch.left,
      right: keys.has('KeyD') || keys.has('ArrowRight') || touch.right,
      handbrake: keys.has('Space') || touch.handbrake,
    },
    dt,
    boostRemain > 0,
  )
  const pulled = applySoftTrackPull(next, geom, dt, 0.55)
  const safe = finitePose({ ...next, ...pulled })
  player.x = safe.x
  player.y = safe.y
  player.angle = safe.angle
  player.speed = safe.speed
}

function updateAi(dt: number) {
  for (const car of aiCars) {
    car.aiPhase = (car.aiPhase + (car.speed / 900) * dt) % 1
    const p = pointOnTrack(car.aiPhase)
    const n = normalOnTrack(car.aiPhase)
    const lane = (car.aiPhase * 7) % 1 > 0.5 ? 14 : -10
    const targetX = p.x + n.x * lane
    const targetY = p.y + n.y * lane
    const tan = tangentOnTrack(car.aiPhase)
    car.angle = Math.atan2(tan.y, tan.x)
    car.x += (targetX - car.x) * Math.min(1, 8 * dt)
    car.y += (targetY - car.y) * Math.min(1, 8 * dt)
  }
}

function updateTrailer(dt: number) {
  trailer.progress = stepTrailerProgress(trailer.progress, trailer.speed, dt)
}

function updateBoosts(dt: number) {
  boostRemain = tickBoostRemain(boostRemain, dt)
  for (const b of boosts) {
    const clock = tickOrbRespawn(b.respawnIn, dt, b.alive)
    b.alive = clock.alive
    b.respawnIn = clock.respawnIn
    const d = Math.hypot(player.x - b.x, player.y - b.y)
    if (collectBoost(b.alive, d)) {
      b.alive = false
      b.respawnIn = 6
      boostRemain = 3.5
      flash('BOOST!')
      beep(880, 0.08, 'sawtooth', 0.035)
      beep(1200, 0.1, 'sawtooth', 0.03)
    }
  }
}

function spawnParkSparks(perfect: boolean) {
  const n = perfect ? 28 : 14
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const sp = 40 + Math.random() * 120
    sparks.push({
      x: player.x,
      y: player.y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 0.45 + Math.random() * 0.35,
      color: perfect ? '#ffe066' : '#7affb0',
    })
  }
}

function updateSparks(dt: number) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i]
    s.life -= dt
    s.x += s.vx * dt
    s.y += s.vy * dt
    s.vx *= Math.pow(0.96, dt * 60)
    s.vy *= Math.pow(0.96, dt * 60)
    if (s.life <= 0) sparks.splice(i, 1)
  }
}

function updateNearMiss(dt: number) {
  nearMissCd = Math.max(0, nearMissCd - dt)
  if (spawnProtect > 0 || nearMissCd > 0) return
  for (const c of aiCars) {
    const d = Math.hypot(c.x - player.x, c.y - player.y)
    if (isNearMiss(d, player.speed)) {
      const bonus = nearMissBonus(combo)
      score += bonus
      scoreEl.textContent = String(score)
      if (score > best) {
        best = score
        localStorage.setItem(HS_KEY, String(best))
        bestEl.textContent = String(best)
      }
      const who = c.name || 'a rival'
      flash(`${pick(NEAR_LINES)} (${who}) +${bonus}`)
      beep(990, 0.05, 'square', 0.03)
      nearMissCd = 1.1
      break
    }
  }
}

function updateBumps(dt: number) {
  hornCd = Math.max(0, hornCd - dt)
  if (spawnProtect > 0) return
  for (const c of aiCars) {
    const d = Math.hypot(c.x - player.x, c.y - player.y)
    if (isBump(d)) {
      // soft shove
      const ang = Math.atan2(player.y - c.y, player.x - c.x)
      player.x += Math.cos(ang) * 40 * dt
      player.y += Math.sin(ang) * 40 * dt
      player.speed *= 0.92
      shake(0.28)
      if (nearMissCd <= 0.05) {
        flash(`Bonked ${c.name || 'somebody'} — no insurance claims`)
        beep(90, 0.1, 'square', 0.045)
        nearMissCd = 0.7
      }
    }
  }
}

function updateRadio(dt: number) {
  if (phase !== 'playing') return
  radioT -= dt
  if (radioT > 0) return
  radioT = 10 + Math.random() * 14
  if (messageT > 0.4) return
  flash(
    pick([
      'RADIO: “Keep the flamingos upright.”',
      'RADIO: “Trailer’s moving. You heard me.”',
      'RADIO: “Boost orbs are not snacks.”',
      'RADIO: “Darlene says hi. Aggressively.”',
      'RADIO: “Park pretty or park twice.”',
    ]),
    2.0,
  )
  beep(520, 0.04, 'triangle', 0.02)
  beep(780, 0.05, 'triangle', 0.02)
}

function updateParking(dt: number) {
  const inBed = pointInTrailerBed(player.x, player.y)
  const onBed = isParkHoldReady(inBed, player.speed)

  if (onBed) {
    parkTimer += dt
    if (parkTimer >= PARK_HOLD_SEC) {
      const pose = trailerPose()
      const result = evaluatePark(player, pose, trailer, combo, perfectStreak)
      const perfect = result.perfect
      const gained = result.gained
      perfectStreak = result.nextStreak
      score += gained
      combo = result.nextCombo
      scoreEl.textContent = String(score)
      comboEl.textContent = String(combo)
      if (!reduceMotion) spawnParkSparks(perfect)
      const title = comboTitle(combo)
      const line = perfect ? pick(PERFECT_LINES) : pick(PARK_LINES)
      const head = perfect ? `PERFECT x${perfectStreak}` : 'PARKED'
      if (score > best) {
        best = score
        localStorage.setItem(HS_KEY, String(best))
        bestEl.textContent = String(best)
        flash(`${head} · ${title} +${gained} NEW BEST — ${line}`, 2.6)
      } else {
        flash(`${head} · ${title} +${gained} — ${line}`, 2.4)
      }
      beep(523, 0.09, 'triangle', 0.05)
      beep(659, 0.09, 'triangle', 0.05)
      beep(784, 0.14, 'triangle', 0.05)
      if (perfect) beep(988, 0.16, 'triangle', 0.045)
      parkTimer = 0
      const n = { x: -Math.sin(pose.angle), y: Math.cos(pose.angle) }
      player.x += n.x * 70
      player.y += n.y * 70
      player.speed = 40
    }
  } else {
    if (shouldResetComboOnMiss(parkTimer, inBed)) {
      combo = 1
      perfectStreak = 0
      comboEl.textContent = '1'
      flash(pick(FAIL_LINES))
      beep(180, 0.15, 'square', 0.04)
    }
    parkTimer = decayParkTimer(parkTimer, dt)
  }
}

function asphaltNoise(seed: number): void {
  // subtle asphalt speckles (deterministic-ish from seed)
  ctx.save()
  ctx.globalAlpha = neonNight ? 0.07 : 0.1
  for (let i = 0; i < 180; i++) {
    const u = ((seed * 1103515245 + i * 12345) >>> 0) % 1000 / 1000
    const v = ((seed * 1664525 + i * 67890) >>> 0) % 1000 / 1000
    const a = u * Math.PI * 2
    const rr = TRACK.rx - TRACK.halfWidth + v * TRACK.halfWidth * 2
    const x = CX + Math.cos(a) * rr * (0.92 + (i % 7) * 0.02)
    const y = CY + Math.sin(a) * (rr * (TRACK.ry / TRACK.rx)) * (0.92 + (i % 5) * 0.02)
    ctx.fillStyle = i % 3 === 0 ? '#000' : '#fff'
    ctx.fillRect(x, y, 1.2, 1.2)
  }
  ctx.restore()
}

function drawTrack() {
  // outer grass / grounds
  const grassOut = neonNight ? '#0d1a12' : '#3d7a3a'
  const grassIn = neonNight ? '#102418' : '#4a8f45'
  const asphalt = neonNight ? '#1a1e26' : '#2c3038'
  const asphaltHi = neonNight ? '#242a34' : '#3a3f48'
  ctx.fillStyle = grassOut
  ctx.fillRect(0, 0, W, H)

  // sunny day sky-ish vignette at corners
  if (!neonNight) {
    const g = ctx.createRadialGradient(CX, CY, 120, CX, CY, 520)
    g.addColorStop(0, 'rgba(255,245,200,0.12)')
    g.addColorStop(1, 'rgba(80,140,200,0.18)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  } else {
    const g = ctx.createRadialGradient(CX, CY * 0.3, 40, CX, CY, 520)
    g.addColorStop(0, 'rgba(20,40,80,0.55)')
    g.addColorStop(1, 'rgba(0,0,0,0.35)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }

  // outer apron / runoff grass ring
  ctx.beginPath()
  ctx.ellipse(CX, CY, TRACK.rx + TRACK.halfWidth + 36, TRACK.ry + TRACK.halfWidth + 36, 0, 0, Math.PI * 2)
  ctx.fillStyle = neonNight ? '#152216' : '#356b34'
  ctx.fill()

  // dark asphalt oval (outer edge)
  ctx.beginPath()
  ctx.ellipse(CX, CY, TRACK.rx + TRACK.halfWidth + 4, TRACK.ry + TRACK.halfWidth + 4, 0, 0, Math.PI * 2)
  ctx.fillStyle = asphalt
  ctx.fill()

  // slightly lighter racing surface
  ctx.beginPath()
  ctx.ellipse(CX, CY, TRACK.rx + TRACK.halfWidth - 2, TRACK.ry + TRACK.halfWidth - 2, 0, 0, Math.PI * 2)
  ctx.fillStyle = asphaltHi
  ctx.fill()

  asphaltNoise(42)

  // infield grass hole
  ctx.beginPath()
  ctx.ellipse(CX, CY, TRACK.rx - TRACK.halfWidth, TRACK.ry - TRACK.halfWidth, 0, 0, Math.PI * 2)
  ctx.fillStyle = grassIn
  ctx.fill()

  // soft infield shade
  ctx.beginPath()
  ctx.ellipse(CX, CY, (TRACK.rx - TRACK.halfWidth) * 0.72, (TRACK.ry - TRACK.halfWidth) * 0.72, 0, 0, Math.PI * 2)
  ctx.fillStyle = neonNight ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,200,0.08)'
  ctx.fill()

  // white concrete walls (inner + outer)
  const wall = neonNight ? '#d8dee8' : '#f2f4f7'
  ctx.strokeStyle = wall
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.ellipse(CX, CY, TRACK.rx + TRACK.halfWidth + 1, TRACK.ry + TRACK.halfWidth + 1, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(CX, CY, TRACK.rx - TRACK.halfWidth - 1, TRACK.ry - TRACK.halfWidth - 1, 0, 0, Math.PI * 2)
  ctx.stroke()
  // wall shadow lip
  ctx.strokeStyle = neonNight ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.2)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.ellipse(CX, CY, TRACK.rx + TRACK.halfWidth - 3, TRACK.ry + TRACK.halfWidth - 3, 0, 0, Math.PI * 2)
  ctx.stroke()

  // lane markings (dashed centerline + outer guide)
  ctx.strokeStyle = neonNight ? 'rgba(255,230,120,0.55)' : 'rgba(255,255,255,0.75)'
  ctx.lineWidth = 2.5
  ctx.setLineDash([14, 16])
  ctx.beginPath()
  ctx.ellipse(CX, CY, TRACK.rx, TRACK.ry, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([8, 18])
  ctx.strokeStyle = neonNight ? 'rgba(200,210,230,0.25)' : 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.ellipse(CX, CY, TRACK.rx + TRACK.halfWidth * 0.45, TRACK.ry + TRACK.halfWidth * 0.45, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])

  // start/finish stripe across bottom-ish of oval (t≈0 right → CW)
  ctx.save()
  const sf = pointOnTrack(0)
  const sft = tangentOnTrack(0)
  ctx.translate(sf.x, sf.y)
  ctx.rotate(Math.atan2(sft.y, sft.x))
  for (let i = -4; i <= 4; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#fff' : '#111'
    ctx.fillRect(-6, i * 8 - TRACK.halfWidth + 8, 12, 8)
  }
  ctx.restore()

  if (neonNight) {
    ctx.strokeStyle = 'rgba(80,180,255,0.35)'
    ctx.lineWidth = 2
    ctx.shadowColor = '#4ab0ff'
    ctx.shadowBlur = reduceMotion ? 0 : 14
    ctx.beginPath()
    ctx.ellipse(CX, CY, TRACK.rx + TRACK.halfWidth + 1, TRACK.ry + TRACK.halfWidth + 1, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.shadowBlur = 0
  }

  drawProps()
}

function drawTree(x: number, y: number, s: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = neonNight ? '#1a1210' : '#3a2818'
  ctx.fillRect(-2 * s, 0, 4 * s, 10 * s)
  ctx.fillStyle = neonNight ? '#0e2214' : '#1f5a28'
  ctx.beginPath()
  ctx.arc(0, -2 * s, 10 * s, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(-6 * s, 2 * s, 7 * s, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(6 * s, 2 * s, 7 * s, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawLightPole(x: number, y: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.strokeStyle = neonNight ? '#9aa8b8' : '#6a7580'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(0, 18)
  ctx.lineTo(0, -28)
  ctx.stroke()
  ctx.strokeStyle = neonNight ? '#c0cad4' : '#889'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, -28)
  ctx.lineTo(14, -34)
  ctx.stroke()
  if (neonNight) {
    ctx.fillStyle = 'rgba(255,240,180,0.85)'
    ctx.shadowColor = '#ffe8a0'
    ctx.shadowBlur = 22
    ctx.beginPath()
    ctx.arc(14, -34, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
    const glow = ctx.createRadialGradient(14, -34, 2, 14, -10, 50)
    glow.addColorStop(0, 'rgba(255,230,150,0.28)')
    glow.addColorStop(1, 'rgba(255,230,150,0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(14, -10, 50, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.fillStyle = '#ddd'
    ctx.beginPath()
    ctx.arc(14, -34, 4, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function drawBleachers(x: number, y: number, w: number, rows: number, ang: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(ang)
  for (let r = 0; r < rows; r++) {
    const yy = r * 7
    ctx.fillStyle = neonNight ? `rgba(60,70,90,${0.55 + r * 0.08})` : `rgba(120,110,100,${0.55 + r * 0.08})`
    ctx.fillRect(-w / 2, -yy, w, 6)
    // crowd dots
    for (let i = 0; i < Math.floor(w / 6); i++) {
      if ((i + r) % 3 === 0) continue
      ctx.fillStyle = neonNight
        ? `hsl(${(i * 47 + r * 19) % 360},40%,${45 + (i % 3) * 10}%)`
        : `hsl(${(i * 47 + r * 19) % 360},35%,${30 + (i % 4) * 8}%)`
      ctx.beginPath()
      ctx.arc(-w / 2 + 4 + i * 6, -yy + 2, 1.6, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

function drawProps() {
  // Trees outside oval
  const trees = [
    [70, 70, 1.1],
    [110, H - 80, 0.9],
    [W - 90, 90, 1.2],
    [W - 70, H - 100, 1.0],
    [40, CY, 0.85],
    [W - 45, CY + 40, 1.05],
    [CX - 200, 40, 0.7],
    [CX + 210, H - 50, 0.8],
  ] as const
  for (const [x, y, s] of trees) drawTree(x, y, s)

  // Stadium lights
  drawLightPole(CX - 300, 55)
  drawLightPole(CX + 300, 55)
  drawLightPole(CX - 300, H - 55)
  drawLightPole(CX + 300, H - 55)
  drawLightPole(60, CY - 80)
  drawLightPole(W - 60, CY - 80)

  // Bleachers on north side
  drawBleachers(CX, 48, 220, 4, 0)
  drawBleachers(CX - 160, 70, 90, 3, -0.15)
  drawBleachers(CX + 160, 70, 90, 3, 0.15)

  // Infield trailer-park leftovers (smaller, keep vibe)
  const trailers = [
    { x: CX - 36, y: CY - 16, a: 0.25, c: '#7a8696' },
    { x: CX + 44, y: CY + 14, a: -0.4, c: '#8a6a50' },
  ]
  for (const tr of trailers) {
    ctx.save()
    ctx.translate(tr.x, tr.y)
    ctx.rotate(tr.a)
    ctx.fillStyle = tr.c
    ctx.fillRect(-22, -8, 44, 16)
    ctx.fillStyle = neonNight ? '#ffd080' : '#fff2c0'
    ctx.fillRect(-14, -5, 6, 5)
    ctx.fillRect(4, -5, 6, 5)
    ctx.restore()
  }

  // Plastic flamingos
  const birds = [
    { x: CX - 70, y: CY + 8 },
    { x: CX + 78, y: CY - 30 },
    { x: CX + 20, y: CY + 55 },
  ]
  for (const b of birds) {
    ctx.save()
    ctx.translate(b.x, b.y)
    ctx.fillStyle = '#ff4fa3'
    ctx.beginPath()
    ctx.ellipse(0, 0, 7, 4, -0.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#ff4fa3'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(-2, 2)
    ctx.quadraticCurveTo(-6, 14, -1, 18)
    ctx.stroke()
    ctx.fillStyle = '#ffb020'
    ctx.fillRect(5, -2, 5, 2)
    ctx.restore()
  }

  // Satellite dish
  ctx.save()
  ctx.translate(CX - 5, CY - 55)
  ctx.fillStyle = neonNight ? '#9ab0c8' : '#708090'
  ctx.beginPath()
  ctx.arc(0, 0, 12, Math.PI * 0.15, Math.PI * 1.1)
  ctx.strokeStyle = neonNight ? '#c8e0ff' : '#606870'
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.fillStyle = '#445'
  ctx.fillRect(-1, 0, 2, 16)
  ctx.restore()

  // infield "King of the Hill" plaque
  ctx.save()
  ctx.translate(CX, CY + 8)
  ctx.fillStyle = neonNight ? 'rgba(20,30,40,0.65)' : 'rgba(255,255,255,0.45)'
  roundRect(-48, -12, 96, 24, 4)
  ctx.fill()
  ctx.fillStyle = neonNight ? '#9ec8ff' : '#1a3a5c'
  ctx.font = 'bold 11px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('KING OF THE HILL', 0, 1)
  ctx.restore()
}

function drawCar(car: Car) {
  if (!car.isPlayer && car.name) {
    ctx.save()
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(220,235,255,0.75)'
    ctx.fillText(car.name, car.x, car.y - 24)
    ctx.restore()
  }
  ctx.save()
  ctx.translate(car.x, car.y)
  ctx.rotate(car.angle)

  const L = car.length
  const Wd = car.width
  const van = car.kind === 'van'

  // wheels (motion slant)
  const spin = reduceMotion ? 0 : (performance.now() / 40) % 6
  ctx.fillStyle = '#0c0c0e'
  const wheel = (wx: number, wy: number) => {
    ctx.save()
    ctx.translate(wx, wy)
    ctx.rotate(0.08 * Math.sin(spin))
    ctx.fillRect(-5, -2.5, 10, 5)
    ctx.restore()
  }
  wheel(-L * 0.28, -Wd / 2 - 1)
  wheel(-L * 0.28, Wd / 2 + 1)
  wheel(L * 0.28, -Wd / 2 - 1)
  wheel(L * 0.28, Wd / 2 + 1)

  // body — sedan taper vs van box
  ctx.fillStyle = car.color
  if (neonNight) {
    ctx.shadowColor = car.color
    ctx.shadowBlur = car.isPlayer ? 16 : 8
  }
  ctx.beginPath()
  if (van) {
    // boxy van
    roundRect(-L / 2, -Wd / 2, L, Wd, 3)
  } else {
    // sedan-ish silhouette
    ctx.moveTo(-L / 2 + 2, -Wd / 2 + 2)
    ctx.lineTo(L * 0.15, -Wd / 2)
    ctx.lineTo(L / 2 - 1, -Wd / 2 + 3)
    ctx.lineTo(L / 2, Wd / 2 - 3)
    ctx.lineTo(L * 0.15, Wd / 2)
    ctx.lineTo(-L / 2 + 2, Wd / 2 - 2)
    ctx.closePath()
  }
  ctx.fill()
  ctx.shadowBlur = 0

  // roof / cabin
  ctx.fillStyle = van
    ? (neonNight ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.18)')
    : (neonNight ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0.2)')
  if (van) {
    roundRect(-L * 0.42, -Wd * 0.42, L * 0.72, Wd * 0.84, 2)
    ctx.fill()
  } else {
    roundRect(-L * 0.18, -Wd * 0.38, L * 0.42, Wd * 0.76, 2)
    ctx.fill()
  }

  // windshield
  ctx.fillStyle = neonNight ? 'rgba(180,220,255,0.85)' : 'rgba(140,190,220,0.9)'
  if (van) {
    ctx.fillRect(L * 0.22, -Wd * 0.34, L * 0.16, Wd * 0.68)
  } else {
    ctx.beginPath()
    ctx.moveTo(L * 0.08, -Wd * 0.32)
    ctx.lineTo(L * 0.28, -Wd * 0.28)
    ctx.lineTo(L * 0.28, Wd * 0.28)
    ctx.lineTo(L * 0.08, Wd * 0.32)
    ctx.closePath()
    ctx.fill()
  }

  // rear window
  ctx.fillStyle = neonNight ? 'rgba(120,150,180,0.55)' : 'rgba(100,130,160,0.55)'
  ctx.fillRect(-L * 0.42, -Wd * 0.28, L * 0.14, Wd * 0.56)

  // headlights / taillights
  ctx.fillStyle = '#ffe9a0'
  ctx.fillRect(L / 2 - 3, -Wd / 2 + 2, 3, 4)
  ctx.fillRect(L / 2 - 3, Wd / 2 - 6, 3, 4)
  ctx.fillStyle = '#ff4040'
  ctx.fillRect(-L / 2, -Wd / 2 + 2, 3, 4)
  ctx.fillRect(-L / 2, Wd / 2 - 6, 3, 4)

  // wear marks
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(-L * 0.1, -Wd * 0.2)
  ctx.lineTo(L * 0.05, -Wd * 0.15)
  ctx.stroke()

  if (car.isPlayer) {
    ctx.strokeStyle = neonNight ? '#fff' : '#1a3a6a'
    ctx.lineWidth = 2
    ctx.strokeRect(-L / 2, -Wd / 2, L, Wd)
    // roof stripe
    ctx.fillStyle = neonNight ? '#4af' : '#246'
    ctx.fillRect(-L * 0.05, -2, L * 0.22, 4)
  }

  ctx.restore()
}

function drawTrailer() {
  const pose = trailerPose()
  ctx.save()
  ctx.translate(pose.x, pose.y)
  ctx.rotate(pose.angle)

  const bedX = -trailer.cabL * 0.12 - trailer.bedL

  // hitch
  ctx.fillStyle = '#666'
  ctx.fillRect(-6, -3, 10, 6)
  ctx.strokeStyle = '#333'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(2, 0, 4, 0, Math.PI * 2)
  ctx.stroke()

  // flatbed (empty) — steel gray deck
  ctx.fillStyle = neonNight ? '#5a6068' : '#6a7078'
  if (neonNight) {
    ctx.shadowColor = '#8899aa'
    ctx.shadowBlur = 10
  }
  ctx.fillRect(bedX, -trailer.bedW / 2, trailer.bedL, trailer.bedW)
  ctx.shadowBlur = 0
  // deck planks
  ctx.strokeStyle = 'rgba(0,0,0,0.2)'
  ctx.lineWidth = 1
  for (let i = 1; i < 6; i++) {
    const px = bedX + (trailer.bedL * i) / 6
    ctx.beginPath()
    ctx.moveTo(px, -trailer.bedW / 2 + 2)
    ctx.lineTo(px, trailer.bedW / 2 - 2)
    ctx.stroke()
  }
  // rails
  ctx.strokeStyle = neonNight ? '#c8d0d8' : '#d8e0e8'
  ctx.lineWidth = 2.5
  ctx.strokeRect(bedX + 2, -trailer.bedW / 2 + 2, trailer.bedL - 4, trailer.bedW - 4)

  // target chevrons on empty bed
  ctx.fillStyle = 'rgba(255,210,60,0.45)'
  for (let i = 0; i < 4; i++) {
    const cx = bedX + 16 + i * 20
    ctx.beginPath()
    ctx.moveTo(cx, 0)
    ctx.lineTo(cx - 9, -11)
    ctx.lineTo(cx - 9, 11)
    ctx.closePath()
    ctx.fill()
  }
  // center target ring
  ctx.strokeStyle = 'rgba(255,80,80,0.55)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(bedX + trailer.bedL * 0.55, 0, 10, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(bedX + trailer.bedL * 0.55, 0, 4, 0, Math.PI * 2)
  ctx.stroke()

  // white cab (tow truck)
  ctx.fillStyle = neonNight ? '#eef2f6' : '#f5f7fa'
  if (neonNight) {
    ctx.shadowColor = '#ffffff'
    ctx.shadowBlur = 12
  }
  roundRect(-2, -17, trailer.cabL, 34, 5)
  ctx.fill()
  ctx.shadowBlur = 0

  // checkered pattern on cab side
  const cell = 5
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 4; col++) {
      if ((row + col) % 2 === 0) {
        ctx.fillStyle = '#111'
        ctx.fillRect(4 + col * cell, -12 + row * cell, cell, cell)
      }
    }
  }

  // windshield
  ctx.fillStyle = neonNight ? '#7ec8ff' : '#5aa0c8'
  ctx.fillRect(trailer.cabL * 0.55, -12, 12, 24)
  // roof light bar
  ctx.fillStyle = '#c62828'
  ctx.fillRect(trailer.cabL * 0.2, -19, trailer.cabL * 0.45, 3)
  ctx.fillStyle = '#f5d76e'
  ctx.fillRect(trailer.cabL * 0.35, -19, 6, 3)

  // wheels
  ctx.fillStyle = '#111'
  ctx.fillRect(6, -trailer.bedW / 2 - 5, 16, 7)
  ctx.fillRect(6, trailer.bedW / 2 - 2, 16, 7)
  ctx.fillRect(bedX + 14, -trailer.bedW / 2 - 5, 16, 7)
  ctx.fillRect(bedX + 14, trailer.bedW / 2 - 2, 16, 7)
  ctx.fillRect(bedX + trailer.bedL - 28, -trailer.bedW / 2 - 5, 16, 7)
  ctx.fillRect(bedX + trailer.bedL - 28, trailer.bedW / 2 - 2, 16, 7)

  ctx.restore()
}

function roundRect(x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawBoosts(now: number) {
  for (const b of boosts) {
    if (!b.alive) continue
    const pulse = reduceMotion ? 1 : 1 + Math.sin(now / 180) * 0.15
    ctx.save()
    ctx.translate(b.x, b.y)
    ctx.fillStyle = neonNight ? '#40ffd0' : '#20c090'
    if (neonNight) {
      ctx.shadowColor = '#40ffd0'
      ctx.shadowBlur = 20
    }
    ctx.beginPath()
    ctx.arc(0, 0, 10 * pulse, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#061810'
    ctx.font = 'bold 10px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowBlur = 0
    ctx.fillText('B', 0, 1)
    ctx.restore()
  }
}

function drawSparks() {
  for (const s of sparks) {
    ctx.globalAlpha = Math.max(0, Math.min(1, s.life * 2))
    ctx.fillStyle = s.color
    if (neonNight) {
      ctx.shadowColor = s.color
      ctx.shadowBlur = 8
    }
    ctx.beginPath()
    ctx.arc(s.x, s.y, 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.globalAlpha = 1
  }
}

function drawHudOverlay() {
  // park progress bar
  if (parkTimer > 0) {
    const pct = Math.min(1, parkTimer / PARK_HOLD_SEC)
    const bw = 160
    const bx = CX - bw / 2
    const by = 28
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(bx - 4, by - 4, bw + 8, 18)
    ctx.fillStyle = neonNight ? '#3a4a60' : '#333'
    ctx.fillRect(bx, by, bw, 10)
    ctx.fillStyle = pct >= 1 ? '#7affb0' : '#5ad0ff'
    ctx.fillRect(bx, by, bw * pct, 10)
    ctx.fillStyle = '#fff'
    ctx.font = '12px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('PARKING…', CX, by - 8)
  }

  if (messageT > 0) {
    const alpha = reduceMotion ? 1 : Math.min(1, messageT)
    ctx.font = 'bold 20px sans-serif'
    ctx.textAlign = 'center'
    const tw = Math.min(W - 40, ctx.measureText(message).width + 24)
    ctx.fillStyle = `rgba(0,0,0,${0.62 * alpha})`
    ctx.fillRect(CX - tw / 2, H - 56, tw, 30)
    ctx.fillStyle = `rgba(255,244,200,${alpha})`
    ctx.fillText(message, CX, H - 36)
  }

  // corner status
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'left'
  const bits = [
    neonNight ? 'NEON' : 'DAY',
    muted ? 'MUTE' : 'SFX',
    boostRemain > 0 ? 'BOOST' : '',
    phase === 'playing' ? comboTitle(combo) : '',
  ].filter(Boolean)
  const status = bits.join(' · ')
  const sw = ctx.measureText(status).width + 16
  ctx.fillStyle = 'rgba(0,0,0,0.62)'
  ctx.fillRect(10, H - 28, sw, 20)
  ctx.fillStyle = '#e8f2ff'
  ctx.fillText(status, 18, H - 14)
}

function frame(ts: number) {
  if (phase !== 'playing') return
  const dt = clampDt((ts - lastTs) / 1000)
  lastTs = ts

  spawnProtect = Math.max(0, spawnProtect - dt)
  updatePlayer(dt)
  updateAi(dt)
  updateTrailer(dt)
  updateBoosts(dt)
  updateParking(dt)
  updateNearMiss(dt)
  updateBumps(dt)
  updateRadio(dt)
  updateSparks(dt)
  if (shakeT > 0) shakeT = Math.max(0, shakeT - dt)
  if (messageT > 0) messageT -= dt

  ctx.save()
  if (shakeT > 0 && !reduceMotion) {
    const mag = shakeT * 10
    ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag)
  }
  drawTrack()
  drawTrailer()
  drawBoosts(ts)
  for (const c of aiCars) drawCar(c)
  drawCar(player)
  drawSparks()
  ctx.restore()
  drawHudOverlay()

  requestAnimationFrame(frame)
}

// Idle title preview loop
function titlePreview(ts: number) {
  if (phase !== 'title') return
  const dt = clampDt((ts - lastTs) / 1000 || 0.016)
  lastTs = ts
  trailer.progress = (trailer.progress + 0.04 * dt) % 1
  for (const car of aiCars) {
    car.aiPhase = (car.aiPhase + 0.05 * dt) % 1
    const p = pointOnTrack(car.aiPhase)
    const n = normalOnTrack(car.aiPhase)
    car.x = p.x + n.x * 8
    car.y = p.y + n.y * 8
    const tan = tangentOnTrack(car.aiPhase)
    car.angle = Math.atan2(tan.y, tan.x)
  }
  drawTrack()
  drawTrailer()
  drawBoosts(ts)
  for (const c of aiCars) drawCar(c)
  requestAnimationFrame(titlePreview)
}


function bindTouchPad() {
  const map: Record<string, keyof typeof touch> = {
    'pad-accel': 'accel',
    'pad-brake': 'brake',
    'pad-left': 'left',
    'pad-right': 'right',
    'pad-hb': 'handbrake',
  }
  // Stop iOS from scrolling/zooming while thumbs are on pads
  const padRoot = document.getElementById('touch-pad')
  if (padRoot) {
    padRoot.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false })
    padRoot.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false })
  }

  for (const [id, key] of Object.entries(map)) {
    const el = document.getElementById(id)
    if (!el) continue
    const set = (down: boolean, e?: Event) => {
      if (e) e.preventDefault()
      touch[key] = down
      el.classList.toggle('is-down', down)
      if (down) ensureAudio()
    }
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      try {
        el.setPointerCapture((e as PointerEvent).pointerId)
      } catch {
        /* ignore */
      }
      if (key === 'accel') {
        const now = performance.now()
        if (now - lastGasTap < 320) horn()
        lastGasTap = now
      }
      set(true, e)
    })
    el.addEventListener('pointerup', (e) => set(false, e))
    el.addEventListener('pointercancel', (e) => set(false, e))
    el.addEventListener('lostpointercapture', () => set(false))
    // iOS Safari sometimes drops pointerup if we only listen leave
    el.addEventListener('pointerleave', (e) => {
      if ((e as PointerEvent).buttons === 0) set(false, e)
    })
    el.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') e.preventDefault()
    })
  }
}

function bindMobileChrome() {
  applyPlayMode()
  const onResize = () => {
    applyPlayMode()
    clearTouch()
  }
  window.addEventListener('resize', onResize)
  window.addEventListener('orientationchange', () => {
    // iOS fires before dimensions settle
    clearTouch()
    setTimeout(onResize, 250)
  })
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', applyPlayMode)
  }
  document.addEventListener('visibilitychange', () => {
    clearTouch()
    if (phaseAfterHidden(phase, document.hidden) === 'paused') pauseGame()
  })
  window.addEventListener('blur', () => {
    clearTouch()
    if (phaseAfterBlur(phase, true) === 'paused') pauseGame()
  })
  document.addEventListener(
    'touchmove',
    (e) => {
      const t = e.target
      if (t instanceof Element && t.closest('.panel')) return
      e.preventDefault()
    },
    { passive: false },
  )
  document.addEventListener('gesturestart', (e) => e.preventDefault())
  // First Start tap unlocks WebAudio on iOS
  btnStart.addEventListener(
    'touchend',
    () => {
      ensureAudio()
    },
    { passive: true },
  )
}

bindTouchPad()
bindMobileChrome()

function rotateTagline() {
  const el = document.getElementById('tagline')
  if (!el) return
  el.textContent = pick(TAGLINES)
  if (reduceMotion) return
  setInterval(() => {
    el.textContent = pick(TAGLINES)
  }, 4200)
}
rotateTagline()

syncChrome()
btnStart?.focus({ preventScroll: true })
placeBoosts()
lastTs = performance.now()
requestAnimationFrame(titlePreview)
