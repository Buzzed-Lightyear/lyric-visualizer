/** The D overlay: AudioFrame bars plus whatever status lines App builds. */

import type { AudioFrame } from './audioMath'

type TextCtx = CanvasRenderingContext2D & {
  letterSpacing: string
  wordSpacing: string
  fontKerning: CanvasFontKerning
  direction: CanvasDirection
}

/**
 * The overlay shares the text layer's canvas, whose context carries
 * voice-specific state (letterSpacing above all: inherited, it stretches
 * the overlay with wide-tracked voices). Reset every piece of inherited
 * text and paint state; the harness renders the overlay on a clean and a
 * polluted context and requires identical pixels.
 */
function resetTextState(ctx: TextCtx): void {
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.filter = 'none'
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
  ctx.shadowColor = 'rgba(0, 0, 0, 0)'
  ctx.letterSpacing = '0px'
  ctx.wordSpacing = '0px'
  ctx.fontKerning = 'auto'
  ctx.direction = 'ltr'
  ctx.lineWidth = 1
  ctx.lineJoin = 'miter'
}

export function drawDebug(
  ctx: CanvasRenderingContext2D,
  frame: AudioFrame,
  lines: string[],
): void {
  const bars: [string, number][] = [
    ['level', frame.level],
    ['bass', frame.bass],
    ['mid', frame.mid],
    ['high', frame.high],
    ['beat', frame.beat],
  ]
  const x = 12
  const y = 12
  const labelW = 44
  const barW = 160
  const barH = 10
  const gap = 18

  ctx.save()
  resetTextState(ctx as TextCtx)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
  ctx.fillRect(x - 8, y - 8, 560, bars.length * gap + lines.length * gap + 14)
  ctx.font = '11px monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  bars.forEach(([name, value], i) => {
    const rowY = y + i * gap
    ctx.fillStyle = '#9fb4d8'
    ctx.fillText(name, x, rowY)
    ctx.fillText(value.toFixed(2), x + labelW + barW + 6, rowY)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'
    ctx.fillRect(x + labelW, rowY, barW, barH)
    ctx.fillStyle = name === 'beat' ? '#ffb45a' : '#7fd1a8'
    ctx.fillRect(x + labelW, rowY, barW * value, barH)
  })
  ctx.fillStyle = '#9fb4d8'
  lines.forEach((text, i) => {
    ctx.fillText(text, x, y + bars.length * gap + 6 + i * gap)
  })
  ctx.restore()
}
