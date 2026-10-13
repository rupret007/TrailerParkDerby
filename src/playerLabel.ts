type Point = { x: number; y: number }
type Pose = Point & { angle: number }
export type Bounds = { left: number; top: number; right: number; bottom: number }

/** Conservative screen-aligned bounds of a rotated, local rectangle. */
export function rotatedBounds(pose: Pose, rect: Bounds): Bounds {
  const c = Math.cos(pose.angle)
  const s = Math.sin(pose.angle)
  const corners = [
    [rect.left, rect.top], [rect.right, rect.top],
    [rect.right, rect.bottom], [rect.left, rect.bottom],
  ].map(([x, y]) => ({ x: pose.x + x * c - y * s, y: pose.y + x * s + y * c }))
  return {
    left: Math.min(...corners.map(p => p.x)), right: Math.max(...corners.map(p => p.x)),
    top: Math.min(...corners.map(p => p.y)), bottom: Math.max(...corners.map(p => p.y)),
  }
}

function overlaps(a: Bounds, b: Bounds) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

export function placePlayerLabel(
  car: Bounds, bed: Bounds, width: number, height: number, viewport: Point, gap: number,
): Bounds | undefined {
  const x = (car.left + car.right) / 2
  const y = (car.top + car.bottom) / 2
  const candidates = [
    { x: x - width / 2, y: car.top - gap - height },
    { x: x - width / 2, y: car.bottom + gap },
    { x: car.left - gap - width, y: y - height / 2 },
    { x: car.right + gap, y: y - height / 2 },
    { x: x - width / 2, y: bed.top - gap - height },
    { x: x - width / 2, y: bed.bottom + gap },
    { x: bed.left - gap - width, y: y - height / 2 },
    { x: bed.right + gap, y: y - height / 2 },
  ].map(p => {
    const left = Math.max(gap, Math.min(viewport.x - width - gap, p.x))
    const top = Math.max(gap, Math.min(viewport.y - height - gap, p.y))
    return { left, top, right: left + width, bottom: top + height }
  })
  const clear = candidates.filter(p => !overlaps(p, bed) && !overlaps(p, car))
  // Prefer the familiar name-above-car placement; otherwise use the nearest clear side.
  if (clear[0] === candidates[0]) return clear[0]
  const distance = (p: Bounds) => Math.hypot((p.left + p.right) / 2 - x, (p.top + p.bottom) / 2 - y)
  return clear.sort((a, b) => distance(a) - distance(b))[0]
}

export function drawPlayerLabel(
  ctx: CanvasRenderingContext2D,
  player: Pose & { length: number; width: number },
  bed: Bounds,
  displayScale: number,
) {
  // Keep at least 14 CSS pixels of text when the game canvas shrinks on phones.
  const scale = Math.min(1, displayScale > 0 ? displayScale : 1)
  const fontSize = 14 / scale
  const padding = 4 / scale
  ctx.save()
  ctx.font = `bold ${fontSize}px sans-serif`
  const width = ctx.measureText('You').width + padding * 2
  const height = fontSize + padding * 2
  const car = rotatedBounds(player, {
    left: -player.length / 2, right: player.length / 2,
    top: -player.width / 2, bottom: player.width / 2,
  })
  const label = placePlayerLabel(car, bed, width, height,
    { x: ctx.canvas.width, y: ctx.canvas.height }, padding)
  if (label) {
    ctx.shadowBlur = 0
    ctx.fillStyle = '#081420'
    ctx.fillRect(label.left, label.top, width, height)
    ctx.fillStyle = '#ffe066'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('You', (label.left + label.right) / 2, (label.top + label.bottom) / 2)
  }
  ctx.restore()
}
