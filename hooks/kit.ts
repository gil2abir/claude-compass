// The pane's constants, its widget kit (bars, dots, spans) and the sea chart drawn before the first chart.
// Pure: no engine calls, no state.

import { wordWrap, str, glen } from './helpers'

export const PANE = 'compass'
export const TITLE = '🧭 compass'
export const PAST_KEEP = 2
export const FUTURE_KEEP = 3
export const GRILL_TOOL = 'mcp__compass__grill'
export const GOLD = '#E8B53A'
// ── the widget kit: indicators are drawn, information stays text ──

/** Pill colours, after the reference: a tinted fill with a bright label of the same hue. */
export const TONE = {
  gold: { fg: '#E8B53A', bg: '#3b321c' },
  green: { fg: '#86d4ab', bg: '#1d3a2f' },
  purple: { fg: '#b9a6f2', bg: '#2e2946' },
  red: { fg: '#f2a093', bg: '#442728' },
  blue: { fg: '#97b1f5', bg: '#243049' },
  cyan: { fg: '#83d6e8', bg: '#1b3940' },
  yellow: { fg: '#f0d27a', bg: '#3e381d' },
  gray: { fg: '#c4c4c4', bg: '#333438' },
  dim: { fg: '#8a8a8a', bg: '#2a2b2e' },
} as const
export type Tone = keyof typeof TONE
export const TRACK = '#3a3b3f'
export const PANEL = '#2b2c31'
export const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

/** A level as a smooth bar `cells` wide: whole blocks, then an eighth-block edge. */
export const barText = (frac: number, cells: number) => {
  const f = Math.max(0, Math.min(1, Number.isFinite(frac) ? frac : 0)) * cells
  // an edge that rounds up to a whole eighth is one more full block
  const eighths = Math.round(f * 8)
  const full = Math.floor(eighths / 8)
  const part = eighths % 8
  const edge = full < cells ? (part ? ' ▏▎▍▌▋▊▉'[part]! : ' ') : ''
  return `${'█'.repeat(full)}${edge}${' '.repeat(Math.max(0, cells - full - 1))}`.slice(0, cells)
}

/** A countdown as pixels going out: `left` lit of `total`. */
export const dotsText = (left: number, total: number) => `${'●'.repeat(Math.max(0, Math.min(total, left)))}${'·'.repeat(Math.max(0, total - Math.max(0, left)))}`

/** A short duration: 2h 40m, 1d 7h, 45s. */
export const span = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000))
  if (ms < 60000) return `${Math.max(0, Math.round(ms / 1000))}s`
  if (m < 60) return `${m}m`
  if (m < 1440) return `${Math.floor(m / 60)}h ${m % 60}m`
  return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`
}

// ── the sea chart: the flow tab before the first chart lands ──

export type ChartRun = [text: string, color: string, bold?: boolean]

export const SEA = {
  dark: '#E8B53A',
  light: '#9c7426',
  ring: '#7d5f33',
  tick: '#b08a45',
  letter: '#f5d88a',
  core: '#fff1c2',
  cloud: '#8e98a6',
  gull: '#e8e8e8',
  wave: '#4f86bd',
  deep: '#2e5f8f',
  hint: '#83d6e8',
  blank: '#000000',
} as const
export type SeaInk = keyof typeof SEA

export const HINTS = [
  'charting the course',
  'reading the stars',
  'taking soundings',
  'trimming the sails',
  'plotting the heading',
  'consulting the log',
]

/**
 * The opening sea chart, `width` by `height` cells, at moment `t` (ms): a 32-point compass rose
 * in the middle (each point dark on one side, light on the other, as on old charts), clouds,
 * seagulls, rolling waves, and a gull crossing the chart while the first chart is made.
 */
export const seaChart = (width: number, height: number, t: number, isCharting: boolean, note = 'waiting for your first prompt'): ChartRun[][] => {
  const W = Math.max(20, width)
  const H = Math.max(8, height)
  const grid: { ch: string; ink: SeaInk; bold?: boolean }[][] = Array.from({ length: H }, () => Array.from({ length: W }, () => ({ ch: ' ', ink: 'blank' as SeaInk })))
  const put = (x: number, y: number, ch: string, ink: SeaInk, bold = false) => {
    if (y >= 0 && y < H && x >= 0 && x < W) grid[y]![x] = { ch, ink, bold }
  }
  const text = (x: number, y: number, str: string, ink: SeaInk, bold = false) => [...str].forEach((c, i) => c !== ' ' && put(x + i, y, c, ink, bold))

  // the sky (clouds, gulls) on top, the sea at the bottom, the rose in between as big as fits
  const seaRows = H >= 18 ? 3 : 2
  const sky = H >= 16 ? 4 : H >= 11 ? 2 : 0
  const room = H - seaRows - sky - 3
  const fit = Math.max(5, Math.min(room, Math.floor((W - 8) / 2.1)))
  const roseRows = fit % 2 ? fit : fit - 1
  const ry = (roseRows - 1) / 2
  const rx = ry * 2.1
  const cx = Math.floor(W / 2)
  const cy = sky + 1 + Math.ceil(ry) + Math.max(0, Math.floor((room - roseRows) / 2))
  // 32 points: 4 cardinal, 4 intercardinal, 8 and 16 between, each a kite from the centre
  const POINTS: [number, number, number][] = []
  for (let k = 0; k < 32; k++) {
    const level = k % 8 === 0 ? 0 : k % 4 === 0 ? 1 : k % 2 === 0 ? 2 : 3
    POINTS.push([(k * Math.PI) / 16, [0.9, 0.7, 0.52, 0.4][level]!, [0.24, 0.17, 0.11, 0.08][level]!])
  }
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
    for (let x = Math.floor(cx - rx - 2); x <= Math.ceil(cx + rx + 2); x++) {
      const dx = (x - cx) / rx
      const dy = (y - cy) / ry
      const r = Math.hypot(dx, dy)
      const th = Math.atan2(dx, -dy)
      // the outer ring with a tick at each of the 32 points, the inner ring dotted
      if (Math.abs(r - 1) < 0.5 / ry) {
        const off = Math.abs(((((th * 16) / Math.PI) % 1) + 1.5) % 1 - 0.5)
        put(x, y, off < 0.12 ? '•' : '·', off < 0.12 ? 'tick' : 'ring', off < 0.12)
        continue
      }
      if (Math.abs(r - 0.93) < 0.4 / ry) {
        put(x, y, '∙', 'ring')
        continue
      }
      // longest point first; dark on its left half, light on its right, as on old charts
      for (const [a, len, half] of POINTS) {
        const along = dx * Math.sin(a) - dy * Math.cos(a)
        const perp = dx * Math.cos(a) + dy * Math.sin(a)
        if (along > 0 && along <= len && Math.abs(perp) <= half * (1 - along / len)) {
          const isMain = len >= 0.68
          put(x, y, perp < 0 ? (isMain ? '█' : '▓') : isMain ? '▒' : '░', perp < 0 ? 'dark' : 'light')
          break
        }
      }
    }
  }
  put(cx, cy, '✦', 'core', true)
  text(cx, Math.round(cy - ry) - 1, 'N', 'letter', true)
  text(cx, Math.round(cy + ry) + 1, 'S', 'letter', true)
  text(Math.round(cx - rx) - 2, cy, 'W', 'letter', true)
  text(Math.round(cx + rx) + 2, cy, 'E', 'letter', true)

  // clouds drifting slowly across the sky, gulls far off, and one gull crossing while compass works
  if (sky >= 4) {
    const drift = Math.floor(t / 3000)
    const lane = Math.max(1, W - 10)
    ;[' .--. ', '(    ).', '`-..-`'].forEach((row, i) => text((2 + drift) % lane, i, row, 'cloud'))
    ;[' .-~~-.', '(  __  )'].forEach((row, i) => text((((W - 12 - drift) % lane) + lane) % lane, i, row, 'cloud'))
    text(Math.floor(W * 0.3), 1, '⌄', 'gull')
    text(Math.floor(W * 0.72), 2, '⌄', 'gull')
  }
  const flap = Math.floor(t / 350) % 2 === 0
  const gx = (Math.floor(t / (isCharting ? 160 : 320)) % (W + 6)) - 3
  const gy = Math.max(0, Math.min(Math.max(0, sky - 1), 1 + Math.round(Math.sin(t / 900))))
  text(gx, gy, flap ? '\\v/' : '-v-', 'gull', true)

  // the sea: rolling waves along the bottom
  const phase = Math.floor(t / 300)
  const swell = '~^~ ˜ ~^~  ~ ˜^~ '
  for (let i = 0; i < seaRows; i++) {
    const y = H - seaRows + i
    for (let x = 0; x < W; x++) {
      const L = swell.length
      const c = swell[(((x + phase * (i % 2 ? -1 : 1) + i * 5) % L) + L) % L]!
      if (c !== ' ') put(x, y, c, i === seaRows - 1 ? 'deep' : 'wave')
    }
  }

  // the hint, centred under the rose
  const word = HINTS[Math.floor(t / 2800) % HINTS.length]!
  const dots = '.'.repeat(1 + (Math.floor(t / 450) % 3))
  const hint = isCharting ? `${SPIN[Math.floor(t / 120) % SPIN.length]} ${word}${dots}` : note
  // wrapped, never cut: a narrow pane gets it on two rows
  const hintRows = wordWrap(hint, W - 2)
  const hy = Math.min(H - seaRows - hintRows.length, Math.round(cy + ry) + 2)
  hintRows.forEach((row, i) => text(Math.max(0, Math.floor((W - glen(row)) / 2)), hy + i, row, 'hint', true))

  // runs of one ink per row
  return grid.map(row => {
    const runs: ChartRun[] = []
    for (const c of row) {
      const last = runs[runs.length - 1]
      const color = c.ink === 'blank' ? '' : SEA[c.ink]
      if (last && last[1] === color && !!last[2] === !!c.bold) last[0] += c.ch
      else runs.push([c.ch, color, c.bold])
    }
    return runs
  })
}
