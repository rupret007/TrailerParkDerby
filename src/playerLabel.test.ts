import { describe, expect, it, vi } from 'vitest'
import mainSource from './main.ts?raw'
import indexHtml from '../index.html?raw'
import { drawPlayerLabel, placePlayerLabel, rotatedBounds, type Bounds } from './playerLabel'

describe('player identity in the gameplay renderer', () => {
  it('draws the player label in the gameplay frame after the cars', () => {
    const frame = mainSource.slice(mainSource.indexOf('function frame('), mainSource.indexOf('// Idle title'))
    expect(frame).toMatch(/drawCar\(player\)[\s\S]*drawPlayerLabel\(/)
  })

  it('makes the visual identity available in the canvas accessible name', () => {
    expect(indexHtml).toMatch(/aria-label="Trailer Park Derby race track[^"\n]*silver car labeled You/)
  })
})

const viewport = { x: 960, y: 640 }
const car = { left: 463, right: 497, top: 311, bottom: 329 }
const distantBed = { left: 100, right: 200, top: 100, bottom: 154 }
const intersects = (a: Bounds, b: Bounds) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

describe('readable player badge', () => {
  it('stays above the player with a gap and follows movement', () => {
    const label = placePlayerLabel(car, distantBed, 40, 22, viewport, 4)!
    expect((label.left + label.right) / 2).toBe(480)
    expect(label.bottom).toBe(car.top - 4)
    const moved = placePlayerLabel({ left: 483, right: 517, top: 321, bottom: 339 }, distantBed, 40, 22, viewport, 4)!
    expect(moved.left - label.left).toBe(20)
    expect(moved.top - label.top).toBe(10)
  })

  it.each([0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 2])(
    'keeps the badge off the deck when parked at trailer angle %s', angle => {
      const pose = { x: 480, y: 320, angle }
      const deck = rotatedBounds(pose, { left: -50, right: 50, top: -30, bottom: 30 })
      const parkedCar = rotatedBounds(pose, { left: -17, right: 17, top: -9, bottom: 9 })
      for (const scale of [1.25, 585 / 960, 390 / 960]) {
        const label = placePlayerLabel(parkedCar, deck, 40 / scale, 22 / scale, viewport, 4 / scale)!
        expect(label).toBeDefined()
        expect(intersects(label, deck)).toBe(false)
        expect(intersects(label, parkedCar)).toBe(false)
        expect(Math.hypot((label.left + label.right) / 2 - pose.x,
          (label.top + label.bottom) / 2 - pose.y)).toBeLessThan(120)
      }
    },
  )

  it('keeps the entire badge inside the canvas near its corners', () => {
    for (const x of [0, 920]) for (const y of [0, 600]) {
      const label = placePlayerLabel({ left: x, right: x + 34, top: y, bottom: y + 18 },
        distantBed, 100, 55, viewport, 10)!
      expect(label.left).toBeGreaterThanOrEqual(0)
      expect(label.top).toBeGreaterThanOrEqual(0)
      expect(label.right).toBeLessThanOrEqual(960)
      expect(label.bottom).toBeLessThanOrEqual(640)
    }
  })

  it.each([1.25, 585 / 960, 390 / 960])('draws one upright, contrasting You at scale %s', scale => {
    const ctx = {
      canvas: { width: 960, height: 640 }, font: '', fillStyle: '',
      save: vi.fn(), restore: vi.fn(), rotate: vi.fn(), fillRect: vi.fn(),
      measureText: vi.fn(() => ({ width: 28 / Math.min(1, scale) })),
      fillText: vi.fn(),
    }
    drawPlayerLabel(ctx as unknown as CanvasRenderingContext2D,
      { x: 480, y: 320, angle: Math.PI / 2, length: 34, width: 18 }, distantBed, scale)
    expect(ctx.fillText).toHaveBeenCalledExactlyOnceWith('You', expect.any(Number), expect.any(Number))
    expect(Number(ctx.font.match(/[\d.]+/)![0]) * scale).toBeGreaterThanOrEqual(14)
    expect(ctx.fillStyle).toBe('#ffe066')
    expect(ctx.fillRect).toHaveBeenCalledOnce()
    expect(ctx.rotate).not.toHaveBeenCalled()
    expect(ctx.save).toHaveBeenCalledOnce()
    expect(ctx.restore).toHaveBeenCalledOnce()
  })
})
