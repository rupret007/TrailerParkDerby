import './style.css'

const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const overlay = document.getElementById('overlay') as HTMLDivElement
const btnStart = document.getElementById('btn-start') as HTMLButtonElement
const scoreEl = document.getElementById('score') as HTMLSpanElement
const comboEl = document.getElementById('combo') as HTMLSpanElement
const bestEl = document.getElementById('best') as HTMLSpanElement

const W = canvas.width
const H = canvas.height
const CX = W / 2
const CY = H / 2

/** Oval track geometry (centerline + half-widths) */
const TRACK = {
  rx: 340,
  ry: 210,
  halfWidth: 58,
}

const HS_KEY = 'trailerParkDerby_highScore'
const MUTE_KEY = 'trailerParkDerby_mute'

type Vec = { x: number; y: number }

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
}

interface BoostOrb {
  x: number
  y: number
  alive: boolean
  respawnAt: number
}

const keys = new Set<string>()
let running = false
let muted = localStorage.getItem(MUTE_KEY) === '1'
let neonNight = true
let score = 0
let combo = 1
let best = Number(localStorage.getItem(HS_KEY) || '0')
let parkTimer = 0
let message = ''
let messageT = 0
let boostUntil = 0
let lastTs = 0
let audioCtx: AudioContext | null = null
let perfectStreak = 0
let nearMissCd = 0
type Spark = { x: number; y: number; vx: number; vy: number; life: number; color: string }
const sparks: Spark[] = []
const touch = { accel: false, brake: false, left: false, right: false, handbrake: false }

const player: Car = {
  x: CX - TRACK.rx,
  y: CY,
  angle: -Math.PI / 2,
  speed: 0,
  color: '#ff6b4a',
  isPlayer: true,
  aiPhase: 0,
  width: 18,
  length: 32,
}

const aiCars: Car[] = [
  makeAi('#4ad0ff', 0.15),
  makeAi('#b07aff', 0.45),
  makeAi('#7aff9a', 0.75),
]

const trailer = {
  progress: 0.05,
  speed: 0.09, // laps per second-ish along param
  bedW: 52,
  bedL: 90,
  cabL: 28,
}

const boosts: BoostOrb[] = [
  { x: 0, y: 0, alive: true, respawnAt: 0 },
  { x: 0, y: 0, alive: true, respawnAt: 0 },
]

bestEl.textContent = String(best)

function makeAi(color: string, phase: number): Car {
  const p = pointOnTrack(phase)
  const t = tangentOnTrack(phase)
  return {
    x: p.x,
    y: p.y,
    angle: Math.atan2(t.y, t.x),
    speed: 140 + phase * 40,
    color,
    isPlayer: false,
    aiPhase: phase,
    width: 16,
    length: 30,
  }
}

function pointOnTrack(t: number): Vec {
  const a = t * Math.PI * 2
  return { x: CX + Math.cos(a) * TRACK.rx, y: CY + Math.sin(a) * TRACK.ry }
}

function tangentOnTrack(t: number): Vec {
  const a = t * Math.PI * 2
  // derivative of ellipse
  const dx = -Math.sin(a) * TRACK.rx
  const dy = Math.cos(a) * TRACK.ry
  const len = Math.hypot(dx, dy) || 1
  return { x: dx / len, y: dy / len }
}

function normalOnTrack(t: number): Vec {
  const tan = tangentOnTrack(t)
  return { x: -tan.y, y: tan.x }
}

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new AudioContext()
  }
  if (audioCtx.state === 'suspended') void audioCtx.resume()
}

function beep(freq: number, dur = 0.08, type: OscillatorType = 'square', gain = 0.04) {
  if (muted) return
  ensureAudio()
  if (!audioCtx) return
  const t0 = audioCtx.currentTime
  const osc = audioCtx.createOscillator()
  const g = audioCtx.createGain()
  osc.type = type
  osc.frequency.value = freq
  g.gain.value = gain
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g)
  g.connect(audioCtx.destination)
  osc.start(t0)
  osc.stop(t0 + dur)
}

function flash(msg: string) {
  message = msg
  messageT = 1.6
}

function resetPlayerNearStart() {
  const p = pointOnTrack(0.92)
  const tan = tangentOnTrack(0.92)
  const n = normalOnTrack(0.92)
  player.x = p.x + n.x * 18
  player.y = p.y + n.y * 18
  player.angle = Math.atan2(tan.y, tan.x)
  player.speed = 0
  parkTimer = 0
}

function placeBoosts() {
  boosts[0] = orbAt(0.28)
  boosts[1] = orbAt(0.68)
}

function orbAt(t: number): BoostOrb {
  const p = pointOnTrack(t)
  const n = normalOnTrack(t)
  return { x: p.x - n.x * 22, y: p.y - n.y * 22, alive: true, respawnAt: 0 }
}

function startGame() {
  running = true
  overlay.classList.add('hidden')
  score = 0
  combo = 1
  parkTimer = 0
  boostUntil = 0
  perfectStreak = 0
  nearMissCd = 0
  sparks.length = 0
  trailer.progress = 0.05
  placeBoosts()
  resetPlayerNearStart()
  scoreEl.textContent = '0'
  comboEl.textContent = '1'
  ensureAudio()
  beep(440, 0.1, 'triangle', 0.05)
  beep(660, 0.12, 'triangle', 0.04)
  lastTs = performance.now()
  requestAnimationFrame(frame)
}

btnStart.addEventListener('click', startGame)

window.addEventListener('keydown', (e) => {
  keys.add(e.code)
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
    e.preventDefault()
  }
  if (e.code === 'Enter' && !running) startGame()
  if (e.code === 'KeyN') neonNight = !neonNight
  if (e.code === 'KeyM') {
    muted = !muted
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
    flash(muted ? 'Muted' : 'Sound on')
  }
  if (e.code === 'KeyR' && running) {
    resetPlayerNearStart()
    flash('Retry')
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


/** Trailer bed AABB in local coords: length along +x (behind cab), width along y */
function pointInTrailerBed(px: number, py: number): boolean {
  const pose = trailerPose()
  const dx = px - pose.x
  const dy = py - pose.y
  const c = Math.cos(-pose.angle)
  const s = Math.sin(-pose.angle)
  const lx = dx * c - dy * s
  const ly = dx * s + dy * c
  // bed sits behind cab (negative local x)
  const bedStart = -(trailer.cabL * 0.15)
  const bedEnd = -(trailer.cabL * 0.15 + trailer.bedL)
  return lx <= bedStart && lx >= bedEnd && Math.abs(ly) <= trailer.bedW / 2 - 2
}

function updatePlayer(dt: number) {
  const accel = keys.has('KeyW') || keys.has('ArrowUp') || touch.accel
  const brake = keys.has('KeyS') || keys.has('ArrowDown') || touch.brake
  const left = keys.has('KeyA') || keys.has('ArrowLeft') || touch.left
  const right = keys.has('KeyD') || keys.has('ArrowRight') || touch.right
  const handbrake = keys.has('Space') || touch.handbrake

  const boosted = performance.now() < boostUntil
  const maxSpeed = boosted ? 320 : 240
  const accelRate = boosted ? 280 : 200

  if (accel) player.speed += accelRate * dt
  if (brake) player.speed -= 260 * dt
  if (!accel && !brake) player.speed *= Math.pow(0.22, dt) // drag
  if (handbrake) player.speed *= Math.pow(0.35, dt)

  player.speed = Math.max(-80, Math.min(maxSpeed, player.speed))

  const steerMul = handbrake ? 2.4 : 1.35
  const turn = (left ? -1 : 0) + (right ? 1 : 0)
  const speedFactor = Math.min(1, Math.abs(player.speed) / 80)
  player.angle += turn * steerMul * speedFactor * dt * (player.speed >= 0 ? 1 : -1)

  player.x += Math.cos(player.angle) * player.speed * dt
  player.y += Math.sin(player.angle) * player.speed * dt

  // Soft keep near track (don't hard-wall — arcade feel)
  softTrackPull(player, dt, 0.55)
}

function softTrackPull(car: Car, dt: number, strength: number) {
  // Closest-ish phase via angle from center
  const ang = Math.atan2((car.y - CY) / TRACK.ry, (car.x - CX) / TRACK.rx)
  const t = ((ang / (Math.PI * 2)) + 1) % 1
  const center = pointOnTrack(t)
  const dist = Math.hypot(car.x - center.x, car.y - center.y)
  const limit = TRACK.halfWidth + 12
  if (dist > limit) {
    const pull = (dist - limit) * strength * dt * 4
    const nx = (center.x - car.x) / (dist || 1)
    const ny = (center.y - car.y) / (dist || 1)
    car.x += nx * pull * 40
    car.y += ny * pull * 40
    car.speed *= 0.98
  }
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
  trailer.progress = (trailer.progress + trailer.speed * dt * 0.12) % 1
}

function updateBoosts(now: number) {
  for (const b of boosts) {
    if (!b.alive && now >= b.respawnAt) {
      b.alive = true
    }
    if (b.alive) {
      const d = Math.hypot(player.x - b.x, player.y - b.y)
      if (d < 22) {
        b.alive = false
        b.respawnAt = now + 6000
        boostUntil = now + 3500
        flash('BOOST!')
        beep(880, 0.08, 'sawtooth', 0.035)
        beep(1200, 0.1, 'sawtooth', 0.03)
      }
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
    s.vx *= 0.96
    s.vy *= 0.96
    if (s.life <= 0) sparks.splice(i, 1)
  }
}

function updateNearMiss(dt: number) {
  nearMissCd = Math.max(0, nearMissCd - dt)
  if (nearMissCd > 0) return
  for (const c of aiCars) {
    const d = Math.hypot(c.x - player.x, c.y - player.y)
    if (d > 28 && d < 48 && Math.abs(player.speed) > 90) {
      const bonus = 15 * combo
      score += bonus
      scoreEl.textContent = String(score)
      if (score > best) {
        best = score
        localStorage.setItem(HS_KEY, String(best))
        bestEl.textContent = String(best)
      }
      flash(`NEAR MISS +${bonus}`)
      beep(990, 0.05, 'square', 0.03)
      nearMissCd = 1.1
      break
    }
  }
}

function updateParking(dt: number) {
  const onBed =
    pointInTrailerBed(player.x, player.y) &&
    Math.abs(player.speed) < 55

  if (onBed) {
    parkTimer += dt
    if (parkTimer >= 1.5) {
      const pose = trailerPose()
      // local bed coords for centering
      const dx = player.x - pose.x
      const dy = player.y - pose.y
      const c = Math.cos(-pose.angle)
      const s = Math.sin(-pose.angle)
      const lx = dx * c - dy * s
      const ly = dx * s + dy * c
      const bedMidX = -(trailer.cabL * 0.15 + trailer.bedL / 2)
      const centered = Math.abs(lx - bedMidX) < 18 && Math.abs(ly) < 10
      const slow = Math.abs(player.speed) < 22
      const perfect = centered && slow

      let gained = 100 * combo
      if (perfect) {
        perfectStreak = Math.min(5, perfectStreak + 1)
        gained += 50 * combo * perfectStreak
      } else {
        perfectStreak = 0
      }

      score += gained
      combo = Math.min(9, combo + 1)
      scoreEl.textContent = String(score)
      comboEl.textContent = String(combo)
      spawnParkSparks(perfect)
      if (score > best) {
        best = score
        localStorage.setItem(HS_KEY, String(best))
        bestEl.textContent = String(best)
        flash(perfect ? `PERFECT x${perfectStreak}! +${gained} NEW BEST` : `PARKED! +${gained} NEW BEST`)
      } else {
        flash(perfect ? `PERFECT x${perfectStreak}! +${gained}` : `PARKED! +${gained}`)
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
    if (parkTimer > 0.25 && pointInTrailerBed(player.x, player.y) === false) {
      if (parkTimer > 0.4) {
        combo = 1
        perfectStreak = 0
        comboEl.textContent = '1'
        flash('Fell off — retry')
        beep(180, 0.15, 'square', 0.04)
      }
    }
    parkTimer = Math.max(0, parkTimer - dt * 1.2)
  }
}

function drawTrack() {
  // infield
  ctx.fillStyle = neonNight ? '#0a1220' : '#1a3020'
  ctx.fillRect(0, 0, W, H)

  // outer dirt
  ctx.beginPath()
  ctx.ellipse(CX, CY, TRACK.rx + TRACK.halfWidth + 18, TRACK.ry + TRACK.halfWidth + 18, 0, 0, Math.PI * 2)
  ctx.fillStyle = neonNight ? '#1a1420' : '#3a2a18'
  ctx.fill()

  // asphalt ring
  ctx.beginPath()
  ctx.ellipse(CX, CY, TRACK.rx + TRACK.halfWidth, TRACK.ry + TRACK.halfWidth, 0, 0, Math.PI * 2)
  ctx.fillStyle = neonNight ? '#1c2438' : '#2a2e34'
  ctx.fill()

  // infield hole
  ctx.beginPath()
  ctx.ellipse(CX, CY, TRACK.rx - TRACK.halfWidth, TRACK.ry - TRACK.halfWidth, 0, 0, Math.PI * 2)
  ctx.fillStyle = neonNight ? '#0c1828' : '#244028'
  ctx.fill()

  // lane dashes
  ctx.strokeStyle = neonNight ? 'rgba(120,200,255,0.35)' : 'rgba(255,220,80,0.45)'
  ctx.lineWidth = 2
  ctx.setLineDash([12, 14])
  ctx.beginPath()
  ctx.ellipse(CX, CY, TRACK.rx, TRACK.ry, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])

  // neon edge glow
  if (neonNight) {
    ctx.strokeStyle = 'rgba(80,180,255,0.55)'
    ctx.lineWidth = 3
    ctx.shadowColor = '#4ab0ff'
    ctx.shadowBlur = 16
    ctx.beginPath()
    ctx.ellipse(CX, CY, TRACK.rx + TRACK.halfWidth, TRACK.ry + TRACK.halfWidth, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.ellipse(CX, CY, TRACK.rx - TRACK.halfWidth, TRACK.ry - TRACK.halfWidth, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.shadowBlur = 0
  }

  // trailer park props in infield
  drawProps()
}

function drawProps() {
  const trailers = [
    { x: CX - 40, y: CY - 20, a: 0.3, c: '#6a7a90' },
    { x: CX + 50, y: CY + 10, a: -0.5, c: '#8a6a50' },
    { x: CX - 10, y: CY + 40, a: 1.1, c: '#5a8a6a' },
  ]
  for (const t of trailers) {
    ctx.save()
    ctx.translate(t.x, t.y)
    ctx.rotate(t.a)
    ctx.fillStyle = t.c
    ctx.fillRect(-28, -10, 56, 20)
    ctx.fillStyle = neonNight ? '#ffd080' : '#fff2c0'
    ctx.fillRect(-20, -6, 8, 6)
    ctx.fillRect(4, -6, 8, 6)
    ctx.restore()
  }
}

function drawCar(car: Car) {
  ctx.save()
  ctx.translate(car.x, car.y)
  ctx.rotate(car.angle)
  // body
  ctx.fillStyle = car.color
  if (neonNight) {
    ctx.shadowColor = car.color
    ctx.shadowBlur = car.isPlayer ? 18 : 10
  }
  roundRect(-car.length / 2, -car.width / 2, car.length, car.width, 4)
  ctx.fill()
  ctx.shadowBlur = 0
  // windshield
  ctx.fillStyle = neonNight ? '#c8f0ff' : '#a0d0e8'
  ctx.fillRect(car.length * 0.05, -car.width * 0.32, car.length * 0.28, car.width * 0.64)
  // lights
  ctx.fillStyle = '#ffe080'
  ctx.fillRect(car.length / 2 - 3, -car.width / 2 + 2, 4, 5)
  ctx.fillRect(car.length / 2 - 3, car.width / 2 - 7, 4, 5)
  if (car.isPlayer) {
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 1.5
    ctx.strokeRect(-car.length / 2, -car.width / 2, car.length, car.width)
  }
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

function drawTrailer() {
  const pose = trailerPose()
  ctx.save()
  ctx.translate(pose.x, pose.y)
  ctx.rotate(pose.angle)

  // cab
  ctx.fillStyle = neonNight ? '#3a8cff' : '#2a5a9a'
  if (neonNight) {
    ctx.shadowColor = '#4a9fff'
    ctx.shadowBlur = 14
  }
  roundRect(-4, -16, trailer.cabL, 32, 5)
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.fillStyle = '#9ad8ff'
  ctx.fillRect(trailer.cabL * 0.35, -10, 10, 20)

  // flatbed
  const bedX = -trailer.cabL * 0.15 - trailer.bedL
  ctx.fillStyle = neonNight ? '#c45a20' : '#8a4010'
  if (neonNight) {
    ctx.shadowColor = '#ff8040'
    ctx.shadowBlur = 12
  }
  ctx.fillRect(bedX, -trailer.bedW / 2, trailer.bedL, trailer.bedW)
  ctx.shadowBlur = 0
  // bed rails
  ctx.strokeStyle = neonNight ? '#ffd090' : '#d0a060'
  ctx.lineWidth = 2
  ctx.strokeRect(bedX + 2, -trailer.bedW / 2 + 2, trailer.bedL - 4, trailer.bedW - 4)
  // target chevrons
  ctx.fillStyle = 'rgba(255,255,120,0.35)'
  for (let i = 0; i < 3; i++) {
    const cx = bedX + 18 + i * 22
    ctx.beginPath()
    ctx.moveTo(cx, 0)
    ctx.lineTo(cx - 8, -10)
    ctx.lineTo(cx - 8, 10)
    ctx.closePath()
    ctx.fill()
  }

  // wheels
  ctx.fillStyle = '#111'
  ctx.fillRect(-8, -trailer.bedW / 2 - 4, 14, 6)
  ctx.fillRect(-8, trailer.bedW / 2 - 2, 14, 6)
  ctx.fillRect(bedX + 10, -trailer.bedW / 2 - 4, 14, 6)
  ctx.fillRect(bedX + 10, trailer.bedW / 2 - 2, 14, 6)

  ctx.restore()
}

function drawBoosts(now: number) {
  for (const b of boosts) {
    if (!b.alive) continue
    const pulse = 1 + Math.sin(now / 180) * 0.15
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
    const pct = Math.min(1, parkTimer / 1.5)
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
    ctx.fillStyle = `rgba(255,240,180,${Math.min(1, messageT)})`
    ctx.font = 'bold 22px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(message, CX, H - 36)
  }

  // corner status
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = 'rgba(200,220,255,0.7)'
  const bits = [
    neonNight ? 'NEON' : 'DAY',
    muted ? 'MUTE' : 'SFX',
    performance.now() < boostUntil ? 'BOOST' : '',
  ].filter(Boolean)
  ctx.fillText(bits.join(' · '), 16, H - 14)
}

function frame(ts: number) {
  if (!running) return
  const dt = Math.min(0.05, (ts - lastTs) / 1000)
  lastTs = ts

  updatePlayer(dt)
  updateAi(dt)
  updateTrailer(dt)
  updateBoosts(ts)
  updateParking(dt)
  updateNearMiss(dt)
  updateSparks(dt)
  if (messageT > 0) messageT -= dt

  drawTrack()
  drawTrailer()
  drawBoosts(ts)
  for (const c of aiCars) drawCar(c)
  drawCar(player)
  drawSparks()
  drawHudOverlay()

  requestAnimationFrame(frame)
}

// Idle title preview loop
function titlePreview(ts: number) {
  if (running) return
  const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016)
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
  for (const [id, key] of Object.entries(map)) {
    const el = document.getElementById(id)
    if (!el) continue
    const down = (e: Event) => {
      e.preventDefault()
      touch[key] = true
      ensureAudio()
    }
    const up = (e: Event) => {
      e.preventDefault()
      touch[key] = false
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointerleave', up)
    el.addEventListener('pointercancel', up)
  }
}

bindTouchPad()

placeBoosts()
lastTs = performance.now()
requestAnimationFrame(titlePreview)
