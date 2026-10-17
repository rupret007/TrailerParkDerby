/** Pure arcade math — no DOM. Numbers match the original loop at 60fps. */

export const TRACK = {
  rx: 340,
  ry: 210,
  halfWidth: 58,
}

export const PARK_HOLD_SEC = 1.5
export const PARK_MAX_SPEED = 55
export const PARK_SLOW_SPEED = 22
export const PARK_CENTER_X = 18
export const PARK_CENTER_Y = 10
export const MAX_COMBO = 9
export const MAX_PERFECT_STREAK = 5
export const NEAR_MISS_MIN = 28
export const NEAR_MISS_MAX = 48
export const NEAR_MISS_SPEED = 90
export const BUMP_DIST = 26
export const COMBO_BREAK_TIMER = 0.4

export const COMBO_TITLES = [
  'Single-Wide',
  'Double-Wide',
  'Triple-Wide',
  'Patio Set',
  'Satellite King',
  'Flamingo Lord',
  'HOA Nightmare',
  'Mobile Mansion',
  'Trailer Royalty',
] as const

export type Vec = { x: number; y: number }

export type TrackGeom = {
  cx: number
  cy: number
  rx: number
  ry: number
  halfWidth: number
}

export type TrailerSpec = {
  cabL: number
  bedL: number
  bedW: number
}

export type TrailerPose = {
  x: number
  y: number
  angle: number
}

export type DriveInput = {
  accel: boolean
  brake: boolean
  left: boolean
  right: boolean
  handbrake: boolean
}

export type PlayerPose = {
  x: number
  y: number
  angle: number
  speed: number
}

export type RunPhase = 'title' | 'playing' | 'paused'

export function createTrackGeom(cx: number, cy: number): TrackGeom {
  return { cx, cy, rx: TRACK.rx, ry: TRACK.ry, halfWidth: TRACK.halfWidth }
}

export function wrap01(t: number): number {
  if (!Number.isFinite(t)) return 0
  return ((t % 1) + 1) % 1
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

export function parseStoredInt(raw: string | null | undefined, fallback = 0): number {
  if (raw == null || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.floor(n)
}

export function comboTitle(c: number): string {
  return COMBO_TITLES[Math.min(COMBO_TITLES.length - 1, Math.max(0, c - 1))]
}

/** Clockwise oval: progress t increases → angle -t·2π. */
export function pointOnTrack(t: number, geom: TrackGeom): Vec {
  const a = -wrap01(t) * Math.PI * 2
  return { x: geom.cx + Math.cos(a) * geom.rx, y: geom.cy + Math.sin(a) * geom.ry }
}

export function tangentOnTrack(t: number, geom: TrackGeom): Vec {
  const a = -wrap01(t) * Math.PI * 2
  const dx = Math.sin(a) * geom.rx
  const dy = -Math.cos(a) * geom.ry
  const len = Math.hypot(dx, dy) || 1
  return { x: dx / len, y: dy / len }
}

export function normalOnTrack(t: number, geom: TrackGeom): Vec {
  const tan = tangentOnTrack(t, geom)
  return { x: -tan.y, y: tan.x }
}

export function trackPhaseFromPosition(x: number, y: number, geom: TrackGeom): number {
  const ang = Math.atan2((y - geom.cy) / geom.ry, (x - geom.cx) / geom.rx)
  return wrap01(-ang / (Math.PI * 2) + 1)
}

export function localTrailerCoords(px: number, py: number, pose: TrailerPose): Vec {
  const dx = px - pose.x
  const dy = py - pose.y
  const c = Math.cos(-pose.angle)
  const s = Math.sin(-pose.angle)
  return { x: dx * c - dy * s, y: dx * s + dy * c }
}

/** Hitch gap as a fraction of cab length — same number the flatbed is drawn with. */
export const TRAILER_BED_CAB_GAP = 0.12

/** Local-X span of the empty deck. `start` is the cab-side edge; `end` is the tail. */
export function trailerBedLocalX(trailer: TrailerSpec): { start: number; end: number; mid: number } {
  const start = -(trailer.cabL * TRAILER_BED_CAB_GAP)
  const end = start - trailer.bedL
  return { start, end, mid: start - trailer.bedL / 2 }
}

export function pointInTrailerBed(
  px: number,
  py: number,
  pose: TrailerPose,
  trailer: TrailerSpec,
): boolean {
  const { x: lx, y: ly } = localTrailerCoords(px, py, pose)
  const { start, end } = trailerBedLocalX(trailer)
  return lx <= start && lx >= end && Math.abs(ly) <= trailer.bedW / 2 - 2
}

export function isParkHoldReady(inBed: boolean, speed: number): boolean {
  return inBed && Math.abs(speed) < PARK_MAX_SPEED
}

export function evaluatePark(
  player: Pick<PlayerPose, 'x' | 'y' | 'speed'>,
  pose: TrailerPose,
  trailer: TrailerSpec,
  combo: number,
  perfectStreak: number,
): {
  perfect: boolean
  centered: boolean
  slow: boolean
  gained: number
  nextCombo: number
  nextStreak: number
} {
  const { x: lx, y: ly } = localTrailerCoords(player.x, player.y, pose)
  const bedMidX = trailerBedLocalX(trailer).mid
  const centered = Math.abs(lx - bedMidX) < PARK_CENTER_X && Math.abs(ly) < PARK_CENTER_Y
  const slow = Math.abs(player.speed) < PARK_SLOW_SPEED
  const perfect = centered && slow
  const nextStreak = perfect ? Math.min(MAX_PERFECT_STREAK, perfectStreak + 1) : 0
  let gained = 100 * combo
  if (perfect) gained += 50 * combo * nextStreak
  return {
    perfect,
    centered,
    slow,
    gained,
    nextCombo: Math.min(MAX_COMBO, combo + 1),
    nextStreak,
  }
}

export function shouldResetComboOnMiss(parkTimer: number, stillInBed: boolean): boolean {
  return !stillInBed && parkTimer > COMBO_BREAK_TIMER
}

export function decayParkTimer(parkTimer: number, dt: number): number {
  return Math.max(0, parkTimer - dt * 1.2)
}

export function isNearMiss(dist: number, speed: number): boolean {
  return dist > NEAR_MISS_MIN && dist < NEAR_MISS_MAX && Math.abs(speed) > NEAR_MISS_SPEED
}

export function isBump(dist: number): boolean {
  return dist < BUMP_DIST
}

export function nearMissBonus(combo: number): number {
  return 15 * combo
}

export function stepPlayer(player: PlayerPose, input: DriveInput, dt: number, boosted: boolean): PlayerPose {
  const maxSpeed = boosted ? 320 : 240
  const accelRate = boosted ? 280 : 200
  let speed = player.speed
  if (input.accel) speed += accelRate * dt
  if (input.brake) speed -= 260 * dt
  if (!input.accel && !input.brake) speed *= Math.pow(0.22, dt)
  if (input.handbrake) speed *= Math.pow(0.35, dt)
  speed = clamp(speed, -80, maxSpeed)

  const steerMul = input.handbrake ? 2.4 : 1.35
  const turn = (input.left ? -1 : 0) + (input.right ? 1 : 0)
  const speedFactor = Math.min(1, Math.abs(speed) / 80)
  const angle = player.angle + turn * steerMul * speedFactor * dt * (speed >= 0 ? 1 : -1)

  return {
    x: player.x + Math.cos(angle) * speed * dt,
    y: player.y + Math.sin(angle) * speed * dt,
    angle,
    speed,
  }
}

/**
 * Soft wall pull. Speed damping is dt-scaled so 60fps matches the old
 * `speed *= 0.98` per frame; higher refresh rates no longer over-damp.
 */
export function applySoftTrackPull(
  car: Pick<PlayerPose, 'x' | 'y' | 'speed'>,
  geom: TrackGeom,
  dt: number,
  strength: number,
): Pick<PlayerPose, 'x' | 'y' | 'speed'> {
  const t = trackPhaseFromPosition(car.x, car.y, geom)
  const center = pointOnTrack(t, geom)
  const dist = Math.hypot(car.x - center.x, car.y - center.y)
  const limit = geom.halfWidth + 12
  if (dist > limit) {
    const pull = (dist - limit) * strength * dt * 4
    const nx = (center.x - car.x) / (dist || 1)
    const ny = (center.y - car.y) / (dist || 1)
    return {
      x: car.x + nx * pull * 40,
      y: car.y + ny * pull * 40,
      speed: car.speed * Math.pow(0.98, dt * 60),
    }
  }
  return { x: car.x, y: car.y, speed: car.speed }
}

export function stepTrailerProgress(progress: number, speed: number, dt: number): number {
  return wrap01(progress + speed * dt * 0.12)
}

export function finitePose(p: PlayerPose): PlayerPose {
  if (Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.angle) && Number.isFinite(p.speed)) {
    return p
  }
  return { x: 0, y: 0, angle: 0, speed: 0 }
}

export function phaseAfterHidden(phase: RunPhase, hidden: boolean): RunPhase {
  if (hidden && phase === 'playing') return 'paused'
  return phase
}

export function phaseAfterBlur(phase: RunPhase, windowBlurred: boolean): RunPhase {
  if (windowBlurred && phase === 'playing') return 'paused'
  return phase
}

/** Title/pause text may be pinch-zoomed; active play surfaces keep gestures suppressed. */
export function shouldSuppressTouchGesture(targetIsInZoomablePanel: boolean): boolean {
  return !targetIsInZoomablePanel
}

/** Dialog actions that may receive Tab while paused. HUD Pause/Mute stay out. */
export const PAUSE_DIALOG_ACTION_IDS = ['btn-resume', 'btn-restart'] as const

/** Gameplay surface to restore after Resume so driving keys are not eaten by a button. */
export const RESUME_FOCUS_TARGET_ID = 'game'

export type PauseHudPolicy = {
  hudInert: boolean
  hudActionsHidden: boolean
  pauseButtonVisible: boolean
  pauseButtonLabel: 'Pause'
}

/** One Resume lives in the pause dialog; covered HUD controls stay inert and unlabeled as Resume. */
export function pauseHudPolicy(phase: RunPhase): PauseHudPolicy {
  const paused = phase === 'paused'
  return {
    hudInert: paused,
    hudActionsHidden: paused,
    pauseButtonVisible: phase === 'playing',
    pauseButtonLabel: 'Pause',
  }
}

/** Cycle Tab / Shift+Tab across pause-dialog actions; unknown focus starts at an end. */
export function nextPauseDialogFocus(
  actionIds: readonly string[],
  activeId: string | null,
  shiftKey: boolean,
): string {
  if (actionIds.length === 0) return ''
  const idx = activeId ? actionIds.indexOf(activeId) : -1
  if (idx < 0) return shiftKey ? actionIds[actionIds.length - 1]! : actionIds[0]!
  const next = (idx + (shiftKey ? -1 : 1) + actionIds.length) % actionIds.length
  return actionIds[next]!
}

export function clampDt(dt: number, max = 0.05): number {
  if (!Number.isFinite(dt) || dt < 0) return 0
  return Math.min(max, dt)
}

export function tickBoostRemain(remainSec: number, dt: number): number {
  return Math.max(0, remainSec - dt)
}

export function tickOrbRespawn(respawnIn: number, dt: number, alive: boolean): { alive: boolean; respawnIn: number } {
  if (alive) return { alive: true, respawnIn: 0 }
  const next = Math.max(0, respawnIn - dt)
  return next <= 0 ? { alive: true, respawnIn: 0 } : { alive: false, respawnIn: next }
}

export function collectBoost(nowAlive: boolean, pickupDist: number, radius = 22): boolean {
  return nowAlive && pickupDist < radius
}

export const DEFAULT_TRAILER: TrailerSpec = {
  cabL: 38,
  bedL: 100,
  bedW: 54,
}

/** Behind the pack, chasing the trailer at ~0.05. Must stay off AI phases 0.15/0.45/0.75/0.92. */
export const PLAYER_SPAWN_PHASE = 0.98
export const PLAYER_SPAWN_LANE = -32
export const AI_SPAWN_PHASES = [0.15, 0.45, 0.75, 0.92]
export const SPAWN_PROTECT_SEC = 0.8

/** AI lane at a phase: (phase * 7) % 1 > 0.5 ? 14 : -10 */
export function aiLaneOffset(phase: number): number {
  return (wrap01(phase) * 7) % 1 > 0.5 ? 14 : -10
}

export function minPhaseGap(a: number, b: number): number {
  const d = Math.abs(wrap01(a) - wrap01(b))
  return Math.min(d, 1 - d)
}

export function spawnClearOfTraffic(spawnPhase: number, aiPhases: number[], minGap = 0.05): boolean {
  return aiPhases.every((p) => minPhaseGap(spawnPhase, p) >= minGap)
}
