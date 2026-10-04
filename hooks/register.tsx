import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelForkResult, Register, RenderElement } from 'claude-code'

import type {
  CompassAction,
  CompassAlt,
  CompassChatMsg,
  CompassPeer,
  CompassAgentTodo,
  CompassGrillQ,
  CompassLane,
  CompassMap,
  CompassMilestone,
  CompassPulse,
  CompassState,
  CompassStats,
  CompassStep,
  CompassStepKind,
  CompassTab,
  CompassTask,
} from '../types'

// 🧭 compass — where we were, where we are, where we're headed.
//
// Encoding follows the research brief:
// · version tree of states, dead ends as pruned branches (VisTrails, Trrack)
// · milestone chunking + fisheye around "now" (Heer'08 graphical histories, Furnas'86 DOI)
// · overview first, details on demand: one accordion level, no deeper (Shneiderman'96)
// · ≤4 hues, every colour doubled by a glyph (Healey, Ware)
// The grill tab runs mattpocock/skills `grilling`: a design tree asked in rounds of its
// frontier, each question with a recommendation; facts are the agent's, decisions the user's.

const PANE = 'compass'
const TITLE = '🧭 compass'
const PAST_KEEP = 2
const FUTURE_KEEP = 3
const GRILL_TOOL = 'mcp__compass__grill'
const GOLD = '#E8B53A'
// ── the widget kit: indicators are drawn, information stays text ──

/** Pill colours, after the reference: a tinted fill with a bright label of the same hue. */
const TONE = {
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
type Tone = keyof typeof TONE
const TRACK = '#3a3b3f'
const PANEL = '#2b2c31'
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

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

const SEA = {
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
type SeaInk = keyof typeof SEA

const HINTS = [
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

/** Handlers of the pill buttons drawn this render, by key: a pill's 'press' post runs its own. */
const presses = new Map<string, () => unknown>()

/** How long every new item waits in the outbox, so it can still be reordered or removed. */
const SEND_GRACE_MS = 8000
/** When the sea chart was last drawn: while it shows, it redraws a few times a second. */
let splashAt = 0
/** The docked pane's width, as its last render saw it: the row under the prompt spans it too. */
let paneCols = 0
/** The agent row whose ✉ opened the thread: several sessions may share its name. */
let threadAt: string | null = null
/** The user's latest request, whole: the first chart is drawn from it before the turn ends. */
let lastRequest = ''

const EMPTY_STATS: CompassStats = {
  startedAt: 0,
  turns: 0,
  busyMs: 0,
  tools: {},
  errors: 0,
  files: [],
  tokensIn: 0,
  tokensOut: 0,
  tokensCached: 0,
  refreshes: 0,
  costUsd: 0,
  contextPct: 0,
  own: { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
}

const mapA = atom({ plugin: 'compass', key: 'map' } as const, null)
const grillA = atom({ plugin: 'compass', key: 'grill' } as const, [])
const grillRoundA = atom({ plugin: 'compass', key: 'grillRound' } as const, 1)
const grillConfirmA = atom({ plugin: 'compass', key: 'grillConfirm' } as const, null)
const agentTodosA = atom({ plugin: 'compass', key: 'agentTodos' } as const, [])
const userTasksA = atom({ plugin: 'compass', key: 'userTasks' } as const, [])
const actionsA = atom({ plugin: 'compass', key: 'actions' } as const, [])
const peersA = atom({ plugin: 'compass', key: 'peers' } as const, [])
const peersAtA = atom({ plugin: 'compass', key: 'peersAt' } as const, 0)
const selfNameA = atom({ plugin: 'compass', key: 'selfName' } as const, '')
const remoteA = atom({ plugin: 'compass', key: 'isRemoteOnline' } as const, false)
const chatA = atom({ plugin: 'compass', key: 'chat' } as const, [])
const chatSeenA = atom({ plugin: 'compass', key: 'chatSeen' } as const, {})
const tickA = atom({ plugin: 'compass', key: 'tick' } as const, 0)
const incomingA = atom({ plugin: 'compass', key: 'incoming' } as const, null)
const steersA = atom({ plugin: 'compass', key: 'steers' } as const, [])
const btwA = atom({ plugin: 'compass', key: 'btw' } as const, [])
const statsA = atom({ plugin: 'compass', key: 'stats' } as const, EMPTY_STATS)
const tabA = atom({ plugin: 'compass', key: 'tab' } as const, 'flow')
const selectedA = atom({ plugin: 'compass', key: 'selected' } as const, null)
const unfoldedA = atom({ plugin: 'compass', key: 'unfolded' } as const, [])
const refreshingA = atom({ plugin: 'compass', key: 'isRefreshing' } as const, false)
const busyA = atom({ plugin: 'compass', key: 'isBusy' } as const, false)
const errorA = atom({ plugin: 'compass', key: 'lastError' } as const, null)
const liveA = atom({ plugin: 'compass', key: 'live' } as const, [])
const LIVE_KEEP = 200

// Text-presentation symbols only (no emoji), one per tab subject.
const TABS: { id: CompassTab; icon: string; label: string }[] = [
  { id: 'flow', icon: '├', label: 'flow' },
  { id: 'live', icon: '↯', label: 'live' },
  { id: 'tasks', icon: '☑', label: 'tasks' },
  { id: 'grill', icon: '?', label: 'grill' },
  { id: 'chat', icon: '⇄', label: 'agents' },
  { id: 'stats', icon: '∑', label: 'stats' },
  { id: 'recap', icon: '≡', label: 'recap' },
]

/** The flow tab's key: every mark, its colour, and what it means in plain words. */
const LEGEND: { glyph: string; color?: string; dim?: boolean; hue: string; text: string }[] = [
  { glyph: '●', color: 'green', hue: 'green', text: 'finished step' },
  { glyph: '◉', color: 'cyan', hue: 'cyan', text: 'where we are now' },
  { glyph: '○', dim: true, hue: 'grey', text: 'planned, not started' },
  { glyph: '✗', color: 'red', hue: 'red', text: 'dead end: tried, then dropped' },
  { glyph: '!', color: 'red', hue: 'red', text: 'blocked: waiting on you' },
  { glyph: '◆', color: 'magenta', hue: 'pink', text: 'a decision that was made' },
  { glyph: '⊕', color: 'green', hue: 'green', text: 'an experiment that was kept' },
  { glyph: '◌', color: 'magenta', hue: 'pink', text: 'a /btw side question of yours' },
  { glyph: '├', dim: true, hue: '', text: 'side branch off the main line' },
  { glyph: '│', dim: true, hue: '', text: 'solid rail: history' },
  { glyph: '┊', dim: true, hue: '', text: 'dotted rail: still ahead' },
  { glyph: '+n', dim: true, hue: '', text: 'n rows folded, click to open' },
  { glyph: '?', color: 'yellow', hue: 'yellow', text: 'a question for you (grill tab)' },
  { glyph: '☐', color: 'cyan', hue: 'cyan', text: 'the task being done now' },
  { glyph: '⇄', color: 'cyan', hue: 'cyan', text: 'came from another agent' },
]

// Empty-state art, one per tab subject.
const ART: Record<CompassTab, string[]> = {
  flow: ['      N', '   ╲  │  ╱', ' W ── ◈ ── E', '   ╱  │  ╲', '      S'],
  live: ['  ▁▂▅▂▁▇▁▃▁▁▆▂', '  ─────┼──────', '       now'],
  tasks: ['  ┌───────────┐', '  │ ☑ ─────── │', '  │ ☐ ─────   │', '  │ ☐ ────────│', '  └───────────┘'],
  grill: ['     ╭───╮', '  ┌──┤ ? ├──┐', '  ▼  ╰───╯  ▼', '  A   ➡     B'],
  stats: ['   ▁▃▅▇▅▆█▃', '  ─────────'],
  chat: ['   ╭────╮   ╭────╮', '   │ ◆  │ ⇄ │ ◆  │', '   ╰────╯   ╰────╯'],
  recap: ['  ╭──────────╮', '  │ ≡≡≡≡≡≡≡≡ │', '  │ ≡≡≡≡≡    │', '  ╰──────────╯'],
}

type Mark = { glyph: string; color?: string; dim?: boolean }

const STEP_MARK: Record<CompassState, Mark> = {
  done: { glyph: '●', color: 'green' },
  active: { glyph: '◉', color: 'cyan' },
  pending: { glyph: '○', dim: true },
  abandoned: { glyph: '✗', color: 'red', dim: true },
  blocked: { glyph: '!', color: 'red' },
}

const markOf = (kind: CompassStepKind, state: CompassState): Mark => {
  if (kind === 'decision') return { glyph: '◆', color: 'magenta' }
  if (kind === 'aside') return { glyph: '◌', color: 'magenta', dim: true }
  if (kind === 'attempt' && state === 'done') return { glyph: '⊕', color: 'green' }
  return STEP_MARK[state]
}

// ── pure helpers ─────────────────────────────────────────────────────────

/** A tool call in a few words for the live tab: the command, the file's name, the pattern, the task. */
export const pulseWhat = (input: Record<string, unknown>): string => {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p
  const pick =
    s('description') && (input.tool === 'Agent' || input.tool === 'Monitor' || input.tool === 'Bash' && !s('command')) ? s('description')
    : s('command') ? s('command')
    : s('file_path') ? base(s('file_path'))
    : s('notebook_path') ? base(s('notebook_path'))
    : s('pattern') ? s('pattern')
    : s('url') ? s('url').replace(/^https?:\/\//, '')
    : s('query') ? s('query')
    : s('subject') ? s('subject')
    : s('description') || s('prompt') || s('skill') || s('to') || ''
  return pick.replace(/\s+/g, ' ').trim()
}

/** The background task id a tool's answer names (a shell's, a monitor's, an agent's), if any. */
export const bgIdOf = (text: string): string | undefined =>
  /(?:\bID|task[ _-]?id|agentId|shell[ _-]?id)\s*[:=]\s*["'`]?([A-Za-z0-9_-]{4,})/i.exec(text)?.[1] ?? /\(task ([A-Za-z0-9_-]{4,})\b/.exec(text)?.[1]


/** User-perceived characters, so a cut never splits an emoji or an accent (no "�"). */
const graphemes = (text: string): string[] => {
  try {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), g => g.segment)
  } catch {
    return Array.from(text)
  }
}

const clip = (text: string, n: number) => {
  const g = graphemes(text)
  return g.length > n ? `${g.slice(0, Math.max(1, n - 1)).join('')}…` : text
}

const clipLeft = (text: string, n: number) => {
  const g = graphemes(text)
  return g.length > n ? `…${g.slice(g.length - n + 1).join('')}` : text
}

/** Model text made safe for one terminal row: no emoji, controls, zero-width or replacement chars. */
export const plain = (text: string) =>
  text
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufe00-\ufe0f\ufffd]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

/** Rows of at most `width` cells, broken between words; only a word wider than a row is split. */
export const wordWrap = (text: string, width: number): string[] => {
  const w = Math.max(4, width)
  const rows: string[] = []
  let row = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const g = graphemes(word)
    if (g.length > w) {
      if (row) rows.push(row)
      for (let i = 0; i < g.length; i += w) rows.push(g.slice(i, i + w).join(''))
      row = rows.pop() ?? ''
      continue
    }
    const joined = row ? `${row} ${word}` : word
    if (graphemes(joined).length > w) {
      rows.push(row)
      row = word
    } else row = joined
  }
  if (row) rows.push(row)
  return rows.length ? rows : ['']
}

/** A message's lead: its first sentence or line, whole; long ones end at a word with "…". */
export const leadOf = (text: string, max = 140) => {
  const flat = plain(text)
  const first = /^(.+?[.!?])(\s|$)/.exec(flat)?.[1] ?? flat
  if (graphemes(first).length <= max) return { lead: first, hasMore: first.length < flat.length }
  const cut = wordWrap(first, max - 1)[0] ?? ''
  return { lead: `${cut}…`, hasMore: true }
}

const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  return `${(s / 3600).toFixed(1)}h`
}

const kfmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)

const str = (v: unknown, n: number) => (typeof v === 'string' ? clip(plain(v), n) : '')

const strs = (v: unknown, max: number, n: number) =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && plain(x) !== '').slice(0, max).map(x => clip(plain(x), n))

const objs = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : []

const oneOf = <T extends string>(v: unknown, all: readonly T[], fallback: T): T =>
  all.includes(v as T) ? (v as T) : fallback

const STATES = ['done', 'active', 'pending', 'abandoned', 'blocked'] as const
const KINDS = ['step', 'attempt', 'decision', 'aside'] as const
const LANES = ['now', 'next', 'later', 'done'] as const

/** Closes a JSON text the model cut short (an output cap mid-object), so most of it still reads. */
export const repairJson = (src: string) => {
  let out = ''
  const closers: string[] = []
  let isInString = false
  let isEscaped = false
  for (const ch of src) {
    out += ch
    if (isInString) {
      if (isEscaped) isEscaped = false
      else if (ch === '\\') isEscaped = true
      else if (ch === '"') isInString = false
      continue
    }
    if (ch === '"') isInString = true
    else if (ch === '{') closers.push('}')
    else if (ch === '[') closers.push(']')
    else if (ch === '}' || ch === ']') closers.pop()
  }
  if (isInString) out += '"'
  out = out.replace(/[\s,:]+$/, '').replace(/([{,])\s*"[^"]*"$/, '$1').replace(/[\s,]+$/, '')
  return out + closers.reverse().join('')
}

/** The first JSON object in a reply: fenced, chatty or cut short. */
export const parseLoose = (text: string): Record<string, unknown> | null => {
  const start = text.indexOf('{')
  if (start < 0) return null
  const body = text.slice(start)
  const end = body.lastIndexOf('}')
  for (const candidate of [end >= 0 ? body.slice(0, end + 1) : '', repairJson(body)]) {
    if (!candidate) continue
    try {
      const v: unknown = JSON.parse(candidate)
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as Record<string, unknown>
    } catch {
      // try the next reading
    }
  }
  return null
}

type GrillDraft = Pick<CompassGrillQ, 'id' | 'title' | 'body' | 'options' | 'rec' | 'dependsOn' | 'mode' | 'from' | 'blocking'>

const grillDrafts = (v: unknown, fallbackMode: 'plan' | 'work'): GrillDraft[] =>
  objs(v)
    .slice(0, 12)
    .map((q, i) => ({
      id: str(q.id, 32) || `g${i}`,
      title: str(q.title, 40) || '…',
      body: str(q.body, 400),
      options: strs(q.options, 4, 40),
      rec: str(q.recommendation ?? q.rec, 160),
      dependsOn: strs(q.dependsOn, 6, 32),
      mode: q.mode === 'plan' || q.mode === 'work' ? q.mode : fallbackMode,
      from: str(q.from, 30),
      blocking: q.blocking === true,
    }))

/** Coerces a fork reply into a CompassMap, plus any decisions it inferred for the grill. */
/**
 * Exactly one "now", whatever the model wrote: the first active milestone stays active and holds
 * the one active step; any other milestone or step marked active waits as pending.
 */
export const oneNow = (milestones: CompassMilestone[]): CompassMilestone[] => {
  // blocked steps (waiting on the user) may sit beside the active one; only "active" is limited
  const live = (st: CompassState) => st === 'active'
  const at = milestones.findIndex(m => live(m.state))
  return milestones.map((m, i) => {
    const isHere = i === at
    let seen = false
    const steps = m.steps.map((st): CompassStep => {
      if (!live(st.state)) return st
      if (isHere && !seen) {
        seen = true
        return st
      }
      return { ...st, state: 'pending' }
    })
    return { ...m, state: live(m.state) && !isHere ? 'pending' : m.state, steps }
  })
}

export const parseMap = (text: string, at: number): (CompassMap & { grill: GrillDraft[]; moot: string[] }) | null => {
  const o = parseLoose(text)
  if (!o || !Array.isArray(o.milestones)) return null
  const milestones: CompassMilestone[] = objs(o.milestones)
    .slice(0, 10)
    .map((m, i) => ({
      id: str(m.id, 24) || `m${i}`,
      label: str(m.label, 40) || '…',
      state: oneOf(m.state, STATES, 'pending'),
      why: str(m.why, 80),
      steps: objs(m.steps)
        .slice(0, 14)
        .map((s, j): CompassStep => ({
          id: str(s.id, 24) || `m${i}s${j}`,
          label: str(s.label, 40) || '…',
          kind: oneOf(s.kind, KINDS, 'step'),
          state: oneOf(s.state, STATES, 'pending'),
          why: str(s.why, 80),
        })),
    }))
  const tasks: CompassTask[] = objs(o.tasks)
    .slice(0, 30)
    .map((t, i) => ({
      id: str(t.id, 24) || `t${i}`,
      text: str(t.text, 70) || '…',
      lane: oneOf(t.lane, LANES, 'next'),
      by: t.by === 'user' ? 'user' : 'agent',
      from: str(t.from, 30),
    }))
  const a = o.alt && typeof o.alt === 'object' ? (o.alt as Record<string, unknown>) : null
  const altSteps = a ? strs(a.steps, 4, 40) : []
  const alt: CompassAlt | null = a && str(a.label, 40) && altSteps.length ? { label: str(a.label, 40), why: str(a.why, 80), steps: altSteps } : null
  return { goal: str(o.goal, 60), milestones: oneNow(milestones), tasks, recap: strs(o.recap, 7, 140), at, alt, grill: grillDrafts(o.grill, 'work'), moot: strs(o.moot, 12, 32) }
}

/** The active milestone and its active (or blocked) step: the "you are here". */
export const locate = (map: CompassMap | null) => {
  const ms = map?.milestones ?? []
  const milestone = ms.find(m => m.state === 'active') ?? ms.find(m => m.state === 'blocked') ?? ms.find(m => m.state === 'pending') ?? ms[ms.length - 1]
  const steps = milestone?.steps ?? []
  const step = steps.find(s => s.state === 'active') ?? steps.find(s => s.state === 'blocked')
  const after = step ? steps.slice(steps.indexOf(step) + 1) : steps
  const nextStep = after.find(s => s.state === 'pending' && s.kind !== 'aside')
  const nextMilestone = milestone ? ms.slice(ms.indexOf(milestone) + 1).find(m => m.state === 'pending') : undefined
  return { milestone, step, upcoming: nextStep?.label ?? nextMilestone?.label }
}

/**
 * What lies ahead on the planned course, as the fork's left card shows it: the active milestone's
 * pending steps, then the milestones after it (so the card is never empty when the active milestone
 * has no steps left).
 */
export const plannedAhead = (map: CompassMap, n = 4): string[] => {
  const { milestone } = locate(map)
  const steps = (milestone?.steps ?? []).filter(st => st.state === 'pending' && st.kind !== 'aside').map(st => `○ ${st.label}`)
  const ms = map.milestones
  const later = milestone ? ms.slice(ms.indexOf(milestone) + 1).filter(m => m.state === 'pending').map(m => `⚑ M${ms.indexOf(m) + 1} ${m.label}`) : []
  return [...steps, ...later].slice(0, n)
}

/**
 * Which option the recommendation names: the one whose text it starts with, the longest match
 * winning ("GitHub rules + HTML ids" over "GitHub rules only"); -1 when it names none.
 */
export const recIndex = (rec: string, options: string[]): number => {
  const r = rec.toLowerCase()
  let best = -1
  let bestLen = 0
  options.forEach((o, i) => {
    const t = o.toLowerCase()
    let n = 0
    while (n < t.length && n < r.length && t[n] === r[n]) n += 1
    // the whole option, or at least its first 12 letters, opens the recommendation
    if ((n === t.length || n >= 12) && n > bestLen) {
      best = i
      bestLen = n
    }
  })
  return best
}

/** `goal › milestone › [step] → next`, clipped from the left so "now" survives. */
export const crumb = (map: CompassMap | null, width: number) => {
  if (!map) return 'charting…'
  const { milestone, step, upcoming } = locate(map)
  const head = [map.goal, milestone?.label ?? ''].filter(Boolean).map(plain).join(' › ')
  const here = step ? ` › [${plain(step.label)}]` : ''
  const tail = upcoming ? ` → ${plain(upcoming)}` : ''
  const full = `${head}${here}${tail}`
  if (full.length <= width) return full
  return clipLeft(`${plain(milestone?.label ?? '')}${here}${tail}`, width)
}

export type GistPart = { text: string; tone: 'brand' | 'past' | 'now' | 'blocked' | 'next' | 'sep' | 'ask' | 'need' | 'queue' }

const glen = (t: string) => graphemes(t).length

/**
 * The status-line gist: the active cut of the workflow — the last step done, the step now,
 * the step next — then only what needs the user. Fits `budget` cells exactly; plain glyphs only.
 */
export const gist = (map: CompassMap | null, asks: number, queued: number, budget: number, incoming: string | null = null): GistPart[] => {
  const brand: GistPart = { text: '◈ compass', tone: 'brand' }
  if (!map && !incoming) return [brand, { text: '  charting…', tone: 'past' }]
  if (!map) map = { goal: '', milestones: [], tasks: [], recap: [], at: 0 }
  const { milestone, step, upcoming } = locate(map)
  const steps = (milestone?.steps ?? []).filter(s => s.kind !== 'aside')
  const here = step ? steps.indexOf(step) : -1
  const pastStep = [...(here >= 0 ? steps.slice(0, here) : steps)].reverse().find(s => s.state === 'done')
  const pastMilestone = [...map.milestones].reverse().find(m => m.state === 'done')
  const isBlocked = step?.state === 'blocked'
  let past = plain(pastStep?.label ?? pastMilestone?.label ?? '')
  let now = plain(step?.label ?? milestone?.label ?? '')
  let ahead = plain(upcoming ?? '')
  if (incoming) {
    // a turn just started on a new request: it is "now" until the chart catches up
    past = now || past
    now = plain(incoming)
    ahead = 'updating…'
  }
  const progress = here >= 0 && steps.length > 1 ? `step ${here + 1}/${steps.length}` : ''
  // what needs the user: words when they fit, a glyph when they do not
  const needs = (isShort: boolean): GistPart[] => [
    // blocked: the step itself turns red; the words only when there is room
    ...(isBlocked && !isShort ? [{ text: '! needs you', tone: 'need' as const }] : []),
    ...(asks ? [{ text: isShort ? `?${asks}` : `? ${asks} to answer`, tone: 'ask' as const }] : []),
    ...(map?.alt && !map.altPick ? [{ text: isShort ? '⑂' : '⑂ 2 ways', tone: 'ask' as const }] : []),
    ...(queued && !isShort ? [{ text: `${queued} queued`, tone: 'queue' as const }] : []),
  ]
  // every label is shown whole or not at all: a cut label reads as noise, a dropped one is still on the map
  const build = (showPast: boolean, nowText: string, showAhead: boolean, isShort: boolean) => {
    const parts: GistPart[] = [brand, { text: '  ', tone: 'sep' }]
    if (showPast && past) parts.push({ text: `✓ ${past}`, tone: 'past' }, { text: ' › ', tone: 'sep' })
    if (nowText) parts.push({ text: `● ${nowText}`, tone: isBlocked ? 'blocked' : 'now' })
    if (showAhead && ahead) parts.push({ text: ' › ', tone: 'sep' }, { text: `○ ${ahead}`, tone: 'next' })
    for (const r of needs(isShort)) parts.push({ text: '  ', tone: 'sep' }, r)
    return parts
  }
  const size = (parts: GistPart[]) => parts.reduce((n, p) => n + glen(p.text), 0)
  const tries: [boolean, string, boolean, boolean][] = [
    [true, now, true, false],
    [false, now, true, false],
    [false, now, false, false],
    [true, now, true, true],
    [false, now, true, true],
    [false, now, false, true],
    [false, progress, false, true],
    [false, '', false, true],
  ]
  for (const t of tries) {
    const parts = build(...t)
    if (size(parts) <= budget) return parts
  }
  return [brand]
}

export type HintPart = { text?: string; bar?: number; color?: string; isDim?: boolean; isBold?: boolean }
export type HintChip = { key: string; tone: Tone; parts: HintPart[]; width: number }

const BAR_CELLS = 5
const partWidth = (x: HintPart) => (x.bar !== undefined ? BAR_CELLS : glen(x.text ?? ''))

/**
 * The row under the prompt as one panel of chips, after the reference: the course in one chip
 * (✓ last │ ● now │ ○ next), step progress in another, then what needs the user. When room runs
 * short, parts leave from inside a chip first (last step, next step, long labels), then whole
 * chips by priority, so every chip stays one unit. `room` counts the panel's own padding.
 */
export const hintChips = (map: CompassMap | null, asks: number, queued: number, room: number, incoming: string | null = null, blocking = 0, hasTurns = false): HintChip[] => {
  const SEP: HintPart = { text: ' │ ', isDim: true }
  const chip = (key: string, tone: Tone, parts: HintPart[]): HintChip => ({ key, tone, parts, width: 2 + parts.reduce((n, x) => n + partWidth(x), 0) })
  const BRAND = 11
  const fits = (chips: HintChip[]) => 1 + BRAND + chips.reduce((n, c) => n + 1 + c.width, 0) + 1 <= room
  if (!map && !incoming) {
    const wait = [chip('wait', 'dim', [{ text: hasTurns ? '◌ no chart yet · ↻ update in the pane' : '◌ charting after your first prompt' }])]
    return fits(wait) ? wait : []
  }
  const { milestone, step, upcoming } = locate(map)
  const steps = (milestone?.steps ?? []).filter(s => s.kind !== 'aside')
  const done = steps.filter(s => s.state === 'done').length
  const past = incoming ? plain(step?.label ?? '') : plain([...steps].reverse().find(s => s.state === 'done')?.label ?? '')
  const isBlocked = step?.state === 'blocked'
  const nowText = plain(incoming ?? step?.label ?? milestone?.label ?? '')
  const ahead = plain(incoming ? 'updating…' : (upcoming ?? ''))
  const course = (withPast: boolean, withNext: boolean) => {
    const parts: HintPart[] = []
    if (withPast && past) parts.push({ text: `✓ ${past}`, color: TONE.green.fg }, SEP)
    parts.push({ text: `${isBlocked ? '!' : '●'} ${nowText}`, color: isBlocked ? TONE.red.fg : '#e6e6e6', isBold: true })
    if (withNext && ahead) parts.push(SEP, { text: `○ ${ahead}`, isDim: true })
    return chip('course', isBlocked ? 'red' : 'blue', parts)
  }
  const mNo = map && milestone ? map.milestones.indexOf(milestone) + 1 : 0
  const progress =
    steps.length > 1 && !incoming
      ? chip('steps', 'green', [{ text: `⚑ M${mNo} `, isBold: true }, { bar: done / steps.length }, { text: ` ${done}/${steps.length}`, isBold: true }, { text: ' steps', isDim: true }])
      : null
  const needs = (isShort: boolean, keep: string[]) =>
    [
      isBlocked ? chip('need', 'red', [{ text: isShort ? '!' : '! needs you', isBold: true }]) : null,
      blocking ? chip('block', 'red', [{ text: isShort ? `⏸ ${blocking}` : `⏸ ${blocking} waits on you`, isBold: true }]) : null,
      asks - blocking > 0 ? chip('ask', 'yellow', [{ text: isShort ? `? ${asks - blocking}` : `? ${asks - blocking} open`, isBold: true }]) : null,
      map?.alt && !map.altPick ? chip('fork', 'purple', [{ text: isShort ? '⑂' : '⑂ 2 ways', isBold: true }]) : null,
      queued ? chip('queue', 'gray', [{ text: isShort ? `⇣ ${queued}` : `⇣ ${queued} queued` }]) : null,
    ].filter((c): c is HintChip => c !== null && keep.includes(c.key))
  const ALL = ['need', 'block', 'ask', 'fork', 'queue']
  const p = progress ? [progress] : []
  // richest first; each step down gives up the least: parts of a chip, then words, then whole chips
  const tries: HintChip[][] = [
    [course(true, true), ...p, ...needs(false, ALL)],
    [course(false, true), ...p, ...needs(false, ALL)],
    [course(false, false), ...p, ...needs(false, ALL)],
    [course(false, false), ...p, ...needs(true, ALL)],
    [course(false, false), ...needs(true, ALL)],
    [course(false, false), ...needs(true, ['need', 'block', 'ask', 'fork'])],
    [course(false, false), ...needs(true, ['need', 'block', 'ask'])],
    [course(false, false)],
    needs(true, ['need', 'block', 'ask']),
  ]
  return tries.find(fits) ?? []
}

/** Tasks the board shows: the agent's list, plus user tasks it has not picked up yet. */
export const boardOf = (map: CompassMap | null, userTasks: { id: string; text: string }[]) => {
  const tasks = map?.tasks ?? []
  const known = tasks.map(t => t.text.toLowerCase())
  const queued = userTasks
    .filter(u => !known.some(k => k.includes(u.text.toLowerCase().slice(0, 24))))
    .map((u): CompassTask & { isQueued: true } => ({ id: u.id, text: u.text, lane: 'now', by: 'user', from: '', isQueued: true }))
  const all: (CompassTask & { isQueued?: true })[] = [...queued, ...tasks]
  const byLane = (lane: CompassLane) => all.filter(t => t.lane === lane).sort((a, b) => (a.by === b.by ? 0 : a.by === 'user' ? -1 : 1))
  return { now: byLane('now'), next: byLane('next'), later: byLane('later'), done: byLane('done') }
}

/** The grilling frontier: open questions whose prerequisites are all settled. */
export const frontierOf = (items: CompassGrillQ[]) => {
  const ids = new Set(items.map(q => q.id))
  const settled = new Set(items.filter(q => q.state === 'settled' || q.state === 'parked').map(q => q.id))
  const isReady = (q: CompassGrillQ) => q.dependsOn.every(d => !ids.has(d) || settled.has(d))
  const live = items.filter(q => q.state !== 'settled' && q.state !== 'parked')
  return {
    parked: items.filter(q => q.state === 'parked'),
    ask: live.filter(q => q.state === 'open' && isReady(q)),
    handled: live.filter(q => q.state === 'answered' || q.state === 'followup'),
    waiting: live.filter(q => q.state === 'open' && !isReady(q)),
    sent: live.filter(q => q.state === 'sent'),
    settled: items.filter(q => q.state === 'settled'),
  }
}

/** Adds or re-asks questions by id; a re-asked question keeps its number and follow-ups. */
export const mergeGrill = (items: CompassGrillQ[], drafts: GrillDraft[], topic: string, source: 'agent' | 'map', at: number) => {
  let list = [...items]
  const dismissed = items.filter(q => q.answer === 'dismissed').map(q => q.title.toLowerCase())
  for (const d of drafts) {
    if (dismissed.includes(d.title.toLowerCase())) continue
    if (source === 'map' && list.some(q => q.id !== d.id && (isSameWay(q.title, d.title) || isSameWay(`${q.title} ${q.body}`, `${d.title} ${d.body}`)))) continue
    const same = list.find(q => q.id === d.id) ?? (source === 'map' ? list.find(q => q.title.toLowerCase() === d.title.toLowerCase()) : undefined)
    if (same) {
      if (source === 'map') continue
      list = list.map((q): CompassGrillQ =>
        q === same ? { ...q, ...d, topic: topic || q.topic, state: q.state === 'settled' || q.state === 'parked' ? q.state : 'open', answer: q.state === 'settled' ? q.answer : '', at } : q,
      )
    } else {
      const n = list.reduce((m, q) => Math.max(m, q.n), 0) + 1
      list.push({ ...d, n, topic, source, state: 'open', answer: '', followups: [], at })
    }
  }
  return list.slice(-60)
}

/** One round's answers, in the grilling shape the agent reads back. */
export const roundMessage = (round: number, handled: CompassGrillQ[]) =>
  [
    `🧭 [compass grill · round ${round} — answers from the user]`,
    ...handled.map(q =>
      q.state === 'followup'
        ? `❓ Q${q.n} (${q.id}) ${q.title} → FOLLOW-UP from the user: "${q.followups[q.followups.length - 1] ?? ''}". Keep it open: answer the follow-up, then re-ask it with ${GRILL_TOOL} (same id) with a clarified body.`
        : `❓ Q${q.n} (${q.id}) ${q.title} → ${q.answer}`,
    ),
    'These settle the decisions above. Recompute the frontier and post the next round with the grill tool, or askConfirm when the frontier is empty. Look facts up yourself; do not act on a plan before the user confirms.',
  ].join('\n')

/**
 * Compact ASD-STE100 (Simplified Technical English) for every word compass writes with a model:
 * labels, reasons, recap lines, grill questions. Relayed text (the user's words, messages,
 * commands, names) stays as it is.
 */
export const STE = [
  'Write every label, reason, recap line, task and question in ASD-STE100 Simplified Technical English, compact:',
  '- Labels: verb first, imperative, no punctuation ("Add the CLI flag", "Fix the parser test"). Reasons and recap: short sentences, max 20 words, one idea each.',
  '- Active voice. Simple present, simple past or simple future only. No "has been", "would have", stacked modals.',
  '- Common words with one meaning; use the same word for the same thing. "use" not "utilize", "start" not "initiate", "stop" not "terminate", "do" not "execute", "to" not "in order to", "before" not "prior to".',
  '- No -ing words as nouns, no noun stacks of more than 3 words, no phrasal verbs when a single verb exists, no contractions, no "e.g.", "i.e." or "etc.".',
  '- Keep names, file paths, commands, ids, numbers and the user\'s own quoted words exactly as they are.',
].join('\n')

const GRILL_GUIDE = `# Compass grill — ask the user asynchronously
The user answers your questions in the compass pane's grill tab while you work. Use the ${GRILL_TOOL} tool, following the grilling method:
- Keep a design tree of the decisions in play: when planning, and whenever several options are on the table for work in progress.
- Work in rounds. The frontier is every decision whose prerequisites are settled. Post the whole frontier in one call: each question with a stable id, a short title, a body with the choices, and your recommended answer. A question that depends on another still-open one waits for a later round (or name it in dependsOn).
- Facts are your job: read files, run tools, dispatch sub-agents rather than asking. Decisions are the user's: never answer them yourself.
- Do not block: after posting, continue only with work that does not depend on the open answers, else end your turn. Answers arrive as a new user turn, one round at a time.
- A follow-up keeps its question open: answer it, then re-ask the question with the same id and a clarified body.
- When the frontier is empty, call the tool with askConfirm; do not act on a plan until the user confirms the shared understanding.
- Mark each question blocking: true only when work truly waits on it; otherwise blocking: false and keep working on your recommendation, ready to adjust when the answer comes.
- Keep checking as the work moves: new goals, ideas, trade-offs, or second-order effects down the road that the user should decide or know about are new questions.
- The user answers what they want, when they want, in any order. A parked question means: do not wait for it and do not ask again now; proceed with your recommendation and keep it open. A dismissed question is dropped.
- Write each title, body, option and recommendation in ASD-STE100 Simplified Technical English: short active sentences (max 20 words), common words with one meaning, titles of at most 5 words; keep names, paths and commands exact.`

const mapPrompt = (
  prev: CompassMap | null,
  todos: CompassAgentTodo[],
  userTasks: string[],
  steers: string[],
  btw: string[],
  grill: CompassGrillQ[],
  inbox: CompassChatMsg[] = [],
) =>
  [
    'You are COMPASS, a silent observer of this session. Do NOT continue the task, call tools, or address the user.',
    'Reply with ONLY one minified JSON object (no prose, no fence). Be terse: the whole reply must stay under 2500 characters.',
    STE,
    '{"goal":s,"milestones":[{"id":s,"label":s,"state":"done|active|pending|abandoned","why":s,"steps":[{"id":s,"label":s,"kind":"step|attempt|decision|aside","state":"done|active|pending|abandoned|blocked","why":s}]}],"tasks":[{"id":s,"text":s,"lane":"now|next|later|done","by":"agent|user","from":s}],"recap":[s],"moot":[s],"alt":{"label":s,"why":s,"steps":[s]}|null,"grill":[{"id":s,"title":s,"body":s,"options":[s],"recommendation":s,"dependsOn":[s],"from":s,"blocking":b}]}',
    'Model = version tree + phase chunking:',
    '- goal: the session goal, ≤6 words.',
    '- milestones: 3-7 phases in order — done ones, exactly ONE active, then planned pending ones. abandoned = a dropped phase (why = reason ≤6 words).',
    '- steps (per milestone, chronological): ≤5 per done milestone (merge small ones). The active milestone holds exactly one step with state active (or blocked when waiting on the user), then planned pending steps.',
    '  kind step = committed work; attempt = exploratory try (done = adopted, abandoned = dead end, why = reason); decision = a choice that was made (why = rationale ≤8 words); aside = a /btw side question the user asked, placed where it was asked.',
    '- every label ≤5 words, verb first, no punctuation. why ≤8 words or "".',
    '- tasks: the running task list. KEEP every previous task id; move finished work to done; add newly revealed work; lane now ≤3, next ≤5, later = deferred ideas/backlog/follow-ups. User-added tasks keep by "user" and go to now unless finished.',
    '- recap: 3-6 bullets, ≤18 words each, what happened and where things stand.',
    '- alt: when the last turns show the work could go another way (a different goal, requirement or approach the user hinted at or the agent raised), the single most plausible OTHER trajectory from now: label ≤5 words, why ≤10 words (what it trades off), steps 2-4 labels ≤5 words, verb first. The main trajectory is the active milestone\'s pending steps. Otherwise null.',
    '- from: when a task or grill question originated in another agent\'s or session\'s message, that sender\'s name; else "".',
    '- grill: decision or steering points the user should decide or know about that are NOT already in the grill list below: open choices, new goals or ideas raised, trade-offs, implications and second-order effects down the road. Frontier only (nothing that depends on an unanswered question). ≤3, each with a recommendation and blocking (true only when work is waiting on the answer). Usually [] when nothing new came up.',
    '- moot: ids from the grill list below that the conversation has since settled or made irrelevant (else []).',
    '- steps that wait on an open blocking grill question: state blocked, why "waiting on Q<n>".',
    prev ? `Previous map — keep ids stable: ${JSON.stringify({ m: prev.milestones.map(m => [m.id, m.label, m.state]), t: prev.tasks.map(t => [t.id, t.text, t.lane, t.by]) })}` : '',
    todos.length ? `Agent TodoWrite list (ground truth for task status): ${JSON.stringify(todos.map(t => `${t.status}: ${t.text}`))}` : '',
    userTasks.length ? `User-added tasks (by "user"): ${JSON.stringify(userTasks)}` : '',
    steers.length ? `User steering directives, newest last — reflect them in pending steps: ${JSON.stringify(steers)}` : '',
    btw.length ? `User /btw side questions this session (kind aside): ${JSON.stringify(btw)}` : '',
    prev?.declined?.length
      ? `Forks the user already decided (both the chosen and the other side): never offer these, or their reverse, as alt again, even while the work waits on an event or a decision: ${JSON.stringify(prev.declined)}`
      : '',
    grill.length ? `Grill list already tracked (do not repeat; [id, Q number, title, state, blocking]): ${JSON.stringify(grill.map(q => [q.id, q.n, q.title, q.state, !!q.blocking]))}` : '',
    inbox.length ? `Messages received from other agents/sessions (sender: text): ${JSON.stringify(inbox.slice(-8).map(m => `${m.peer}: ${m.text.slice(0, 160)}`))}` : '',
  ]
    .filter(Boolean)
    .join('\n')

// ── shared actions (top level: $ is passed only to functions declared here) ──

let inflight = false
let turnStartedAt = 0
/** Set by any event; the session-long poller started in session.start does the work,
 *  because a hook's own dispatch may be abandoned before a model call finishes. */
let isWanted = false
/** When the user last acted in the pane: a quick reconcile follows once they pause. */
let paneActedAt = 0
/** Each full chart bumps this; a reconcile made across one is dropped. */
let chartEpoch = 0
let isReconciling = false
// a new request gets a quick chart of its own (haiku) within seconds; a full chart that started
// before the request and lands after the quick one is stale, and the one started after it wins
let requestAt = 0
let quickAt = 0
let landedFrom = 0
let isQuickCharting = false
let quickWhat = ''
// the course check while Claude works: at most every PULSE_EVERY_MS, and only after new tool calls
const PULSE_EVERY_MS = 12_000
let pulseAt = 0
let pulseSeen = 0
let checkedAt = 0
const RECONCILE_AFTER_MS = 2_500
let lastRefreshAt = 0
// the first request of a turn is on the wire within a few seconds; the fork then sees the new prompt
const MID_TURN_FIRST_MS = 3_000
const MID_TURN_EVERY_MS = 180_000

const wantRefresh = () => {
  isWanted = true
}

/** A map from an older compass build counts as no map. */
const isCurrent = (map: CompassMap | null): map is CompassMap =>
  !!map && Array.isArray(map.milestones) && Array.isArray(map.tasks)

const FILE_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit)$/

/** Rebuilds the session's counters from the transcript, so a mid-session start sees everything. */
/** How many transcript messages the last chart saw: a resume compares against it. */
let chartedMessages = 0

async function hydrate($: EngineInterface) {
  const messages = await $.session.messages()
  chartedMessages = messages.length
  const tools: Record<string, number> = {}
  const files = new Set<string>()
  let errors = 0
  let turns = 0
  let todos: CompassAgentTodo[] | null = null
  for (const m of messages) {
    if (m.role === 'user' && m.text.trim() && !m.toolResults?.length) turns += 1
    for (const u of m.toolUses) {
      tools[u.tool] = (tools[u.tool] ?? 0) + 1
      if (u.isError) errors += 1
      if (FILE_TOOLS.test(u.tool) && typeof u.input.file_path === 'string') files.add(u.input.file_path)
      if (u.tool === 'TodoWrite' && Array.isArray(u.input.todos)) {
        todos = (u.input.todos as { content?: unknown; status?: unknown }[]).map(t => ({
          text: String(t.content ?? ''),
          status: t.status === 'completed' || t.status === 'in_progress' ? t.status : 'pending',
        }))
      }
    }
  }
  const usage = await $.session.usage()
  await update($, statsA, s => ({
    ...EMPTY_STATS,
    ...s,
    startedAt: usage.startedAt || s.startedAt,
    turns: Math.max(turns, s.turns),
    // never shrink after a compaction drops early messages
    tools: Object.fromEntries([...new Set([...Object.keys(tools), ...Object.keys(s.tools)])].map(k => [k, Math.max(tools[k] ?? 0, s.tools[k] ?? 0)])),
    errors: Math.max(errors, s.errors),
    files: [...new Set([...s.files, ...files])],
    costUsd: usage.cost?.usd ?? s.costUsd ?? 0,
    contextPct: usage.context.percent ?? s.contextPct ?? 0,
    limits: (usage.rateLimits ?? []).map(r => ({ kind: r.kind, pct: r.percentUsed, resetsAt: r.resetsAt ?? '' })),
  }))
  if (todos) {
    const found = todos
    await update($, agentTodosA, () => found)
  }
}

// ── persistence: $.state lives as long as the process. The snapshot lives inside Claude Code's
// own folder for this session (beside <session-id>.jsonl, with its tool-results/ and subagents/),
// so it resumes, forks away and is cleaned up exactly when the session's transcript is ──

const SNAP_VERSION = 1
let lastSnapSig = ''
/** <config>/projects/<project>/<session-id>.jsonl, from the classic events once one arrives. */
/** The key this session's compass is saved under in the plugin's own store. */
async function snapKey($: EngineInterface) {
  return `snap:${await $.session.id()}`
}

/** How many sessions' compasses the store keeps; the oldest go first. */
const SNAP_KEEP = 12

type Snap = {
  v: number
  at: number
  messages: number
  map: CompassMap
  grill: CompassGrillQ[]
  grillRound: number
  grillConfirm: string | null
  agentTodos: CompassAgentTodo[]
  userTasks: { id: string; text: string; at: number }[]
  steers: { text: string; at: number }[]
  btw: string[]
  stats: CompassStats
  chat: CompassChatMsg[]
  actions: CompassAction[]
}

/** Saves the session's compass when something in it changed; cheap enough for the poller. */
async function snapshot($: EngineInterface) {
  const map = await read($, mapA)
  if (!isCurrent(map)) return
  const [grill, grillRound, grillConfirm, agentTodos, userTasks, steers, btw, stats, chat, actions] = await Promise.all([
    read($, grillA),
    read($, grillRoundA),
    read($, grillConfirmA),
    read($, agentTodosA),
    read($, userTasksA),
    read($, steersA),
    read($, btwA),
    read($, statsA),
    read($, chatA),
    read($, actionsA),
  ])
  const sig = JSON.stringify([map.at, grill.map(q => q.state + q.id), grillRound, grillConfirm, userTasks.length, steers.length, btw.length, chat.length, actions.map(a => a.status), stats.turns, stats.refreshes])
  if (sig === lastSnapSig) return
  lastSnapSig = sig
  const id = await $.session.id()
  const snap: Snap = {
    v: SNAP_VERSION,
    at: Date.now(),
    messages: chartedMessages,
    map,
    grill,
    grillRound,
    grillConfirm,
    agentTodos,
    userTasks,
    steers,
    btw,
    stats,
    chat: chat.slice(-60),
    actions: actions.filter(a => a.status === 'queued' || Date.now() - a.at < 600_000).slice(-20),
  }
  try {
    await $.store.set(await snapKey($), { ...snap, sessionId: id })
    // keep the store small: the most recent sessions only
    const keys = (await $.store.keys()).filter(k => k.startsWith('snap:'))
    for (const k of keys.slice(0, Math.max(0, keys.length - SNAP_KEEP))) await $.store.delete(k)
  } catch {
    // no store here: the compass lives for this session only
  }
}

/** Runs the poller's periodic work; a failure waits for the next tick. */
async function quietly($: EngineInterface, job: 'snapshot' | 'flush') {
  try {
    if (job === 'snapshot') await snapshot($)
    else await flushOutbox($)
  } catch {
    // the next tick tries again
  }
}

/** restore(), with a failure read as "nothing saved". */
async function quietRestore($: EngineInterface) {
  try {
    return await restore($)
  } catch {
    return null
  }
}

/** Puts a saved compass back; null when this session has none. */
async function restore($: EngineInterface): Promise<Snap | null> {
  const id = await $.session.id()
  let snap: (Snap & { sessionId?: string }) | undefined
  try {
    const saved = await $.store.get(await snapKey($))
    snap = saved as (Snap & { sessionId?: string }) | undefined
  } catch {
    return null
  }
  if (!snap || snap.v !== SNAP_VERSION || snap.sessionId !== id || !isCurrent(snap.map)) return null
  await update($, mapA, () => snap.map)
  await update($, grillA, () => snap.grill ?? [])
  await update($, grillRoundA, () => snap.grillRound ?? 1)
  await update($, grillConfirmA, () => snap.grillConfirm ?? null)
  await update($, agentTodosA, () => snap.agentTodos ?? [])
  await update($, userTasksA, () => snap.userTasks ?? [])
  await update($, steersA, () => snap.steers ?? [])
  await update($, btwA, () => snap.btw ?? [])
  await update($, statsA, s => ({ ...EMPTY_STATS, ...snap.stats, own: snap.stats?.own ?? s.own ?? EMPTY_STATS.own }))
  await update($, chatA, () => snap.chat ?? [])
  await update($, actionsA, () => snap.actions ?? [])
  chartedMessages = snap.messages ?? 0
  lastSnapSig = ''
  return snap
}

async function addBtw($: EngineInterface, text: string) {
  const t = clip(text.trim(), 120)
  if (t) await update($, btwA, list => (list.includes(t) ? list : [...list, t].slice(-30)))
}

async function countOwn($: EngineInterface, reply: ModelForkResult) {
  if (!('usage' in reply)) return
  const u = reply.usage
  await update($, statsA, s => {
    const own = s.own ?? EMPTY_STATS.own
    return {
      ...s,
      own: {
        calls: own.calls + 1,
        input: own.input + u.input_tokens,
        output: own.output + u.output_tokens,
        cacheRead: own.cacheRead + (u.cache_read_input_tokens ?? 0),
        cacheWrite: own.cacheWrite + (u.cache_creation_input_tokens ?? 0),
      },
    }
  })
}

/** Steers that went into the session: a queued one can still be cancelled, so the chart ignores it. */
async function sentSteers($: EngineInterface) {
  const held = new Set((await read($, actionsA)).filter(a => a.status === 'queued' && a.kind === 'steer').map(a => a.label))
  return (await read($, steersA)).filter(x => !held.has(clip(x.text, 80)))
}

/**
 * The saved conversation in brief: its first request and the recent exchanges, a few thousand
 * characters. Used when the session has made no request in this process yet (a resume, or a
 * restart), so the shared-context fork has nothing to branch from.
 */
export const transcriptDigest = (messages: readonly { role: string; text: string; toolUses: readonly { tool: string }[]; toolResults?: readonly unknown[] }[], cap = 12_000) => {
  const isAsk = (m: { role: string; text: string; toolResults?: readonly unknown[] }) => m.role === 'user' && !!m.text.trim() && !m.toolResults?.length
  const first = messages.find(isAsk)?.text ?? ''
  const lines: string[] = []
  let size = 0
  for (const m of [...messages].reverse()) {
    const tools = [...new Set(m.toolUses.map(u => u.tool))]
    const text = plain(m.text)
    if (!text && !tools.length) continue
    const line = `${m.role === 'user' ? (isAsk(m) ? 'USER' : 'tool results') : 'CLAUDE'}: ${clip(text, isAsk(m) ? 600 : 300)}${tools.length ? ` [used: ${tools.join(', ')}]` : ''}`
    if (size + line.length > cap) break
    lines.unshift(line)
    size += line.length
  }
  return first || lines.length ? `The session's first request: ${clip(plain(first), 800)}\nThe recent conversation, oldest first:\n${lines.join('\n')}` : ''
}

/** Marks a pane action: the chart is reconciled with it shortly, without waiting for the session. */
async function paneActed($: EngineInterface) {
  paneActedAt = await $.clock.now()
}

/** Instant, no model: steps waiting on a question the user just handled stop waiting. */
async function unblockOn($: EngineInterface, n: number) {
  const tag = new RegExp(`waiting on Q${n}\\b`)
  await editMap($, mp => ({
    ...mp,
    milestones: mp.milestones.map(ms => ({
      ...ms,
      steps: ms.steps.map((st): CompassStep => (st.state === 'blocked' && tag.test(st.why) ? { ...st, state: 'pending', why: '' } : st)),
    })),
  }))
}

/**
 * A quick reconcile (haiku, small prompt): brings the chart in line with what the user just did in
 * the pane (answers, parks, dismissals, task moves, steers, fork picks), without inventing any
 * session progress. Dropped if a full chart lands meanwhile: at every session event the full chart,
 * which sees the same actions, is the one that counts.
 */
async function reconcile($: EngineInterface) {
  const stored = await read($, mapA)
  if (!isCurrent(stored) || inflight || isReconciling) return
  isReconciling = true
  const epoch = chartEpoch
  try {
    const grill = await read($, grillA)
    const acts = (await read($, actionsA)).filter(a => a.at > stored.at - 1000).map(a => `${a.status === 'queued' ? 'queued' : 'sent'}: ${a.label}`)
    const prompt = [
      'You are COMPASS. Reply with ONLY one minified JSON object in the same shape as the chart below (goal, milestones, tasks, recap, alt, moot).',
      STE,
      'The user just acted in the compass pane (below). Update the chart to reflect ONLY what those actions imply: steps no longer waiting on a question that is answered, parked or dismissed; pending steps a steer or a chosen branch changes; tasks the user moved or added; grill questions the answers made moot (moot: their ids). Do NOT mark work done or add progress the session has not made. Keep every id.',
      `The chart: ${JSON.stringify({ goal: stored.goal, milestones: stored.milestones, tasks: stored.tasks, recap: stored.recap, alt: stored.alt ?? null })}`,
      `The grill ([id, Q, title, state, answer]): ${JSON.stringify(grill.map(q => [q.id, q.n, q.title, q.state, q.answer]))}`,
      acts.length ? `The user's pane actions since this chart: ${JSON.stringify(acts)}` : '',
    ].filter(Boolean).join('\n')
    const reply = await $.model.complete({ model: 'haiku', system: 'You are COMPASS. Reply with ONLY one minified JSON object, no prose.', prompt, maxTokens: 2500, effort: 'low' })
    await countOwn($, reply)
    if (!reply.isAnswered || epoch !== chartEpoch) return
    const map = parseMap(reply.text, await $.clock.now())
    if (!map || !map.milestones.length) return
    const { grill: _ignored, moot, ...charted } = map
    void _ignored
    const at = await $.clock.now()
    await update($, mapA, m => (m && isCurrent(m) && epoch === chartEpoch ? { ...m, goal: charted.goal || m.goal, milestones: charted.milestones, tasks: charted.tasks, recap: charted.recap.length ? charted.recap : m.recap, reconciledAt: at } : m))
    if (moot.length) await update($, grillA, list => list.map((q): CompassGrillQ => (moot.includes(q.id) && (q.state === 'open' || q.state === 'parked') ? { ...q, state: 'settled', answer: q.answer || 'settled by your answers' } : q)))
  } catch {
    // the next session event charts it in full
  } finally {
    isReconciling = false
  }
}

/**
 * The quick chart (haiku, small prompt), for what moves the course between full charts:
 * - request: the user's new request becomes the work now
 * - pulse: the tool calls since the chart, checked every few seconds while Claude works
 * - turn: the turn just ended, before the slower full chart lands
 * It says when nothing moved ({"same":true}) and never marks done what the session has not shown.
 * The full chart replaces it when it lands; one that started before the user's request is stale.
 */
async function quickChart($: EngineInterface, why: 'request' | 'pulse' | 'turn', request = '') {
  const stored = await read($, mapA)
  if (!isCurrent(stored) || isQuickCharting) return
  isQuickCharting = true
  quickWhat = why === 'request' ? 'charting your new message' : why === 'turn' ? 'catching up with the turn' : 'checking the course'
  const startedAt = Date.now()
  const since = Math.max(stored.at, stored.reconciledAt ?? 0, checkedAt) - 1000
  await update($, tickA, n => n + 1)
  try {
    const live = await read($, liveA)
    pulseSeen = live.filter(p => p.status !== 'running').length
    pulseAt = await $.clock.now()
    const calls = live
      .filter(p => p.at >= since && p.status !== 'running')
      .slice(-30)
      .map(p => `${p.tool}${p.agent ? ' (subagent)' : ''} ${p.status === 'ok' || p.status === 'bgdone' ? 'ok' : p.status}: ${clip(p.what, 90)}`)
    const last = why === 'request' ? '' : [...(await $.session.messages())].reverse().find(m => m.role === 'assistant' && typeof m.text === 'string' && m.text.trim())?.text ?? ''
    const chart = `The chart: ${JSON.stringify({ goal: stored.goal, milestones: stored.milestones, tasks: stored.tasks, recap: stored.recap, alt: stored.alt ?? null })}`
    const shape = 'You are COMPASS. Reply with ONLY one minified JSON object in the same shape as the chart below (goal, milestones, tasks, recap, alt, moot).'
    const keep = `Keep every existing id; new ids are short and unique. Keep the goal unless the work changed it.\n${STE}`
    const prompt = (why === 'request'
      ? [
          shape,
          'The user just sent the session a new request (below). Update the chart so it shows that request as the work now: if it continues the active milestone, add its steps there; otherwise add a new milestone for it after the finished ones. Mark the new work active (its first step active, the rest pending) and the step that was active before pending unless the request finishes it. Do NOT mark anything done the session has not shown.',
          keep,
          chart,
          `The new request: ${JSON.stringify(clip(request, 1500))}`,
        ]
      : [
          shape,
          `Below is what the session did since this chart was drawn${why === 'turn' ? ' (its turn just ended)' : ' (Claude is still working)'}: its tool calls, oldest first, and Claude's latest words. Decide whether the course moved: a step finished, the work moved on to another step, a new step or milestone appeared, or the plan changed.`,
          'If "now" and what comes next are unchanged, reply exactly {"same":true}. Otherwise reply the updated chart: mark a step done only when these calls or words show it finished, mark the step being worked on active, add steps the work clearly took on, and do NOT invent progress.',
          keep,
          chart,
          calls.length ? `Tool calls since: ${JSON.stringify(calls)}` : 'No tool calls since.',
          last ? `Claude's latest words: ${JSON.stringify(clip(last, 1500))}` : '',
        ]
    ).filter(Boolean).join('\n')
    const reply = await $.model.complete({ model: 'haiku', system: 'You are COMPASS. Reply with ONLY one minified JSON object, no prose.', prompt, maxTokens: 2500, effort: 'low' })
    await countOwn($, reply)
    // a full chart that started after this one already landed: it saw more, it counts
    if (!reply.isAnswered || landedFrom > startedAt) return
    if (why !== 'request' && /^\s*\{\s*"same"\s*:\s*true\s*\}\s*$/.test(reply.text)) {
      checkedAt = Date.now()
      return
    }
    const map = parseMap(reply.text, await $.clock.now())
    if (!map || !map.milestones.length) return
    const { grill: _ignored, moot: _moot, ...charted } = map
    void _ignored
    void _moot
    const at = await $.clock.now()
    await update($, mapA, m => (m && isCurrent(m) ? { ...m, goal: charted.goal || m.goal, milestones: charted.milestones, tasks: charted.tasks, recap: charted.recap.length ? charted.recap : m.recap, reconciledAt: at } : m))
    checkedAt = Date.now()
    if (why === 'request') {
      quickAt = Date.now()
      await update($, incomingA, () => null)
    }
  } catch {
    // the next full chart covers it
  } finally {
    isQuickCharting = false
  }
}

async function refresh($: EngineInterface) {
  if (inflight) return
  inflight = true
  chartEpoch += 1
  paneActedAt = 0
  lastRefreshAt = await $.clock.now()
  const startedAt = Date.now() - 1500
  // charted after its turn ended, a chart has the whole request in hand
  const isAfterTurn = !(await read($, busyA))
  await update($, refreshingA, () => true)
  try {
    await hydrate($)
    const stored = await read($, mapA)
    const prompt = mapPrompt(
      isCurrent(stored) ? stored : null,
      await read($, agentTodosA),
      (await read($, userTasksA)).map(u => u.text),
      (await sentSteers($)).slice(-6).map(s => s.text),
      await read($, btwA),
      await read($, grillA),
      (await read($, chatA)).filter(m => m.dir === 'in'),
    )
    const turnsAt = (await read($, statsA)).turns
    const chartStartedAt = await $.clock.now()
    let reply: ModelForkResult = await $.model.fork({ prompt })
    // the very first turn has no answer yet to fork from: chart from the request itself, fast,
    // so the first chart lands while Claude is still working; the turn's end charts it in full
    // the fork failed or had nothing to branch from: the first turn of a new session, a session
    // resumed or restarted before its next request, or one too long to fork (an API error or an
    // empty reply). Chart from a digest of the conversation with the fast model; the next turn's
    // end tries the shared, cached context again. An interrupted turn (aborted) is left alone.
    let isQuick = false
    const forkFailed = reply.isAnswered ? '' : reply.reason
    if (!reply.isAnswered && reply.reason !== 'aborted') {
      const saved = transcriptDigest(await $.session.messages())
      const brief = saved || (lastRequest ? `The session's first request: ${lastRequest}` : '')
      if (brief) {
        isQuick = true
        reply = await $.model.complete({
          model: 'haiku',
          system: 'You are COMPASS. Reply with ONLY one minified JSON object, no prose.',
          prompt: `${prompt}\nYou cannot see the session itself; this is what it holds. Chart it from this (if it is only a first request, chart the plan it implies: the first milestone active, its first step active, the rest pending).\n${brief}${lastRequest && saved ? `\nThe user's latest request: ${JSON.stringify(lastRequest)}` : ''}`,
          maxTokens: 2500,
          effort: 'low',
        })
      }
    }
    await countOwn($, reply)
    let map = reply.isAnswered ? parseMap(reply.text, await $.clock.now()) : null
    if (reply.isAnswered && !map) {
      // one retry, asking for less: the usual cause is a reply cut short
      reply = await $.model.fork({ prompt: `${prompt}\nYour previous reply was not valid JSON. Reply again with ONLY the JSON object, at most 1500 characters.` })
      await countOwn($, reply)
      map = reply.isAnswered ? parseMap(reply.text, await $.clock.now()) : null
    }
    if (!reply.isAnswered) {
      // nothing to fork and nothing saved: a brand-new session, which is no error
      const why = forkFailed && forkFailed !== 'nothing-to-fork' ? forkFailed : reply.reason
      await update($, errorA, () => (why === 'nothing-to-fork' ? null : `chart not updated (${why}); kept the last one · ↻ to retry`))
      return
    }
    if (!map) {
      await update($, errorA, () => "map not updated: the model's summary wasn't valid JSON; kept the last one · ↻ to retry")
      return
    }
    // started before the user's latest request, landing after its quick chart: that chart is newer
    if (startedAt < requestAt && quickAt > startedAt) return
    landedFrom = startedAt
    const { grill: inferred, moot, ...charted } = map
    const prevMap = isCurrent(stored) ? stored : null
    const latest = await read($, mapA)
    const declined = (isCurrent(latest) ? latest.declined : null) ?? prevMap?.declined ?? []
    const sameMilestone = prevMap && locate(prevMap).milestone?.id === locate(charted).milestone?.id
    // the fork on screen stays while the new chart offers none, unless the user decided it meanwhile
    // (this chart may have started before the pick: its own copy of the map still shows the fork open)
    const picked = isCurrent(latest) && latest.altPick
    const kept = !charted.alt && sameMilestone && prevMap.alt && !prevMap.altPick && !picked && !isDecided(prevMap.alt, declined) ? prevMap.alt : null
    const alt = (charted.alt && !isDecided(charted.alt, declined) ? charted.alt : null) ?? kept
    await update($, mapA, () => ({ ...charted, alt, declined, turns: turnsAt }))
    // the chart now includes the request the turn started on
    await update($, incomingA, inc => (inc && (isAfterTurn || inc.at <= startedAt) ? null : inc))
    // the chart's own suggestions: not from the quick first chart (it saw no conversation), not
    // when Claude posted questions while this chart was being made (it could not see them), and
    // never one that repeats a question already there
    const postedMeanwhile = (await read($, grillA)).some(q => q.source === 'agent' && q.at >= chartStartedAt)
    if (inferred.length && !isQuick && !postedMeanwhile) {
      const at = await $.clock.now()
      await update($, grillA, list => mergeGrill(list, inferred, charted.goal, 'map', at))
    }
    // what the conversation settled leaves the open list, so the grill never asks it again
    if (moot.length) await update($, grillA, list => list.map((q): CompassGrillQ => (moot.includes(q.id) && q.state !== 'settled' ? { ...q, state: 'settled', answer: q.answer || 'settled in the session' } : q)))
    await update($, errorA, () => null)
    await update($, statsA, s => ({ ...s, refreshes: s.refreshes + 1 }))
    // user tasks the agent has adopted no longer need to be shown as queued
    await update($, userTasksA, list => list.filter(u => !charted.tasks.some(t => t.text.toLowerCase().includes(u.text.toLowerCase().slice(0, 24)))))
  } catch (err) {
    await update($, errorA, () => `map not updated: ${err instanceof Error ? err.message.slice(0, 60) : 'failed'}`)
  } finally {
    inflight = false
    await update($, refreshingA, () => false)
  }
}

const LANES_ORDER = LANES
const ROUTE_GLYPH = { queued: '⋯', sent: '↗', rejected: '✗' } as const

/** The outbox list with one action changed: what `update` writes when an action moves on. */
const patched = (id: string, patch: Partial<CompassAction>) => (list: CompassAction[]) => list.map((a): CompassAction => (a.id === id ? { ...a, ...patch } : a))

/** Writes into the running turn now; the model reads it at its next step. */
async function appendNow($: EngineInterface, a: CompassAction) {
  try {
    const r = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: a.text }] } })
    if ('deny' in r && r.deny) throw new Error(r.deny)
    const sentNow: Partial<CompassAction> = { status: 'sent', route: 'running turn', at: Date.now() }
    await update($, actionsA, patched(a.id, sentNow))
    $.ui.toast(`↗ sent into the running turn · ${clip(a.label, 50)}`)
  } catch (err) {
    await reject($, a, err)
  }
}

async function reject($: EngineInterface, a: CompassAction, err: unknown) {
  const reason = err instanceof Error ? err.message.slice(0, 60) : String(err).slice(0, 60)
  const rejected: Partial<CompassAction> = { status: 'rejected', reason, at: Date.now() }
  await update($, actionsA, patched(a.id, rejected))
  const prev = a.prev
  if (a.ref && (LANES as readonly string[]).includes(prev)) {
    await editMap($, mp => ({ ...mp, tasks: mp.tasks.map(x => (x.id === a.ref ? { ...x, lane: prev as CompassLane } : x)) }))
  }
  $.ui.toast(`✗ rejected · ${clip(a.label, 40)} · ${reason}${a.ref && prev ? ' · rolled back' : ''}`)
}

/** Records an action and routes it; every outcome is a toast and a row in the activity strip. */
async function enqueue($: EngineInterface, kind: CompassAction['kind'], label: string, text: string, ref = '', prev = '') {
  const t = text.trim()
  if (!t) return
  const a: CompassAction = { id: `a${Date.now()}${Math.floor(Math.random() * 1e4)}`, kind, label: clip(label.trim() || t, 80), text: t, status: 'queued', route: '', reason: '', at: await $.clock.now(), ref, prev }
  await update($, actionsA, list => [...list, a].slice(-40))
  const isBusy = await read($, busyA)
  if (kind === 'note') {
    const withPrompt: Partial<CompassAction> = { route: 'next prompt' }
    await update($, actionsA, patched(a.id, withPrompt))
    $.ui.toast(`⋯ queued for your next prompt · ${clip(a.label, 44)}`)
    return
  }
  const routed: Partial<CompassAction> = { route: kind === 'steer' && isBusy ? 'running turn' : 'new turn' }
  await update($, actionsA, patched(a.id, routed))
  $.ui.toast(`⋯ sends in ${SEND_GRACE_MS / 1000}s · ${clip(a.label, 44)} · ✕ in the pane cancels`)
}

/** ⚡ send now: into the running turn, or as a turn of its own when idle. */
async function forceAction($: EngineInterface, id: string) {
  const a = (await read($, actionsA)).find(x => x.id === id)
  if (!a || a.status !== 'queued') return
  if (a.kind === 'message') return sendMessage($, a)
  if (await read($, busyA)) return appendNow($, a)
  try {
    const sentTurn: Partial<CompassAction> = { status: 'sent', route: 'new turn', at: Date.now() }
    await update($, actionsA, patched(a.id, sentTurn))
    await $.prompt.submit({ text: a.text })
    $.ui.toast(`↗ sent now as a new turn · ${clip(a.label, 44)}`)
  } catch (err) {
    await reject($, a, err)
  }
}

/** The outbox's two queues: a new turn of its own, or context riding the user's next prompt. */
export const queueOf = (a: CompassAction) => (a.route === 'next prompt' ? 'prompt' : 'turn')

/** Swaps a queued item with its neighbour in the same queue: the order they are sent in. */
export const moveIn = (list: CompassAction[], id: string, dir: -1 | 1) => {
  const i = list.findIndex(a => a.id === id)
  const a = list[i]
  if (!a || a.status !== 'queued') return list
  let j = i + dir
  while (j >= 0 && j < list.length && !(list[j]!.status === 'queued' && queueOf(list[j]!) === queueOf(a))) j += dir
  if (j < 0 || j >= list.length) return list
  const swapped = [...list]
  swapped[i] = list[j]!
  swapped[j] = a
  return swapped
}

async function moveAction($: EngineInterface, id: string, dir: -1 | 1) {
  await update($, actionsA, list => moveIn(list, id, dir))
}

const words = (t: string) => new Set(t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2))

/** Whether two ways read as the same one: most of their words in common. */
export const isSameWay = (a: string, b: string) => {
  const x = words(a)
  const y = words(b)
  if (!x.size || !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase()
  const shared = [...x].filter(w => y.has(w)).length
  return shared / Math.min(x.size, y.size) >= 0.6
}

/** A new branch that repeats a fork the user already decided (either side of it) is no branch. */
export const isDecided = (alt: CompassAlt, decided: string[]) =>
  decided.some(d => isSameWay(alt.label, d) || isSameWay(alt.steps.join(' '), d))

/** At a fork: stay on the planned path (a quiet note) or take the branch (a steer, redrawn at once). */
async function pickTrajectory($: EngineInterface, way: 'main' | 'branch') {
  await paneActed($)
  const stored = await read($, mapA)
  const map = isCurrent(stored) ? stored : null
  const alt = map?.alt
  if (!map || !alt) return
  const { milestone } = locate(map)
  if (way === 'main') {
    const planned = milestone?.steps.filter(s => s.state === 'pending').map(s => s.label).join(' ') ?? ''
    await editMap($, mp => ({ ...mp, altPick: 'main', declined: [...(mp.declined ?? []), alt.label, alt.steps.join(' '), ...(planned ? [planned] : [])].slice(-16) }))
    const ahead = plannedAhead(map).map(x => x.replace(/^[○⚑]\s*/u, ''))
    await queueNote($, `Stay on the planned course${ahead.length ? `: ${ahead.join(' → ')}` : ''}; not "${alt.label}"`)
    return
  }
  const before = JSON.stringify({ id: milestone?.id ?? '', steps: milestone?.steps ?? [], declined: map.declined ?? [] })
  const planned = milestone?.steps.filter(s => s.state === 'pending').map(s => s.label).join(' ') ?? ''
  await editMap($, mp => ({
    ...mp,
    altPick: 'branch',
    declined: [...(mp.declined ?? []), alt.label, alt.steps.join(' '), ...(planned ? [planned] : [])].slice(-16),
    milestones: mp.milestones.map(ms =>
      ms.id !== milestone?.id
        ? ms
        : {
            ...ms,
            steps: [
              ...ms.steps.map((s): CompassStep => (s.state === 'pending' ? { ...s, state: 'abandoned', why: 'not chosen' } : s)),
              ...alt.steps.map((label, i): CompassStep => ({ id: `alt${Date.now()}${i}`, label, kind: 'step', state: 'pending', why: '' })),
            ],
          },
    ),
  }))
  const t = `Change direction: ${alt.label}${alt.why ? ` (${alt.why})` : ''}. Next: ${alt.steps.join(' → ')}`
  const sent = { text: t, at: Date.now() }
  await update($, steersA, list => [...list, sent].slice(-20))
  await enqueue($, 'steer', t, `🧭 [compass — steering from the user] ${t}\nRe-plan from here accordingly.`, 'alt', before)
}

/** Drops a queued item before it is sent, undoing what the pane did for it. */
async function removeAction($: EngineInterface, id: string) {
  await paneActed($)
  const a = (await read($, actionsA)).find(x => x.id === id)
  if (!a || a.status !== 'queued') return
  await update($, actionsA, list => list.filter(x => x.id !== id))
  if (a.ref && (LANES as readonly string[]).includes(a.prev)) {
    await editMap($, mp => ({ ...mp, tasks: mp.tasks.map(x => (x.id === a.ref ? { ...x, lane: a.prev as CompassLane } : x)) }))
  }
  if (a.ref.startsWith('u')) await update($, userTasksA, list => list.filter(u => u.id !== a.ref))
  if (a.ref === 'grill') {
    // the round never went out: its questions are answered again, ready to change or resend
    try {
      const was = new Map(JSON.parse(a.prev) as [string, CompassGrillQ['state']][])
      await update($, grillA, list => list.map((q): CompassGrillQ => (was.has(q.id) ? { ...q, state: was.get(q.id)! } : q)))
      await update($, grillRoundA, r => Math.max(1, r - 1))
    } catch {
      // nothing to restore
    }
  }
  if (a.ref === 'plan') {
    try {
      const was = JSON.parse(a.prev) as { milestones: CompassMilestone[]; tasks: CompassTask[] }
      await editMap($, mp => ({ ...mp, milestones: was.milestones, tasks: was.tasks }))
    } catch {
      // nothing to restore
    }
  }
  if (a.ref === 'alt') {
    try {
      const was = JSON.parse(a.prev) as { id: string; steps: CompassStep[]; declined?: string[] }
      await editMap($, mp => ({ ...mp, altPick: undefined, declined: was.declined, milestones: mp.milestones.map(ms => (ms.id === was.id ? { ...ms, steps: was.steps } : ms)) }))
    } catch {
      // nothing to restore
    }
  }
  if (a.kind === 'steer') await update($, steersA, list => list.filter(x => clip(x.text, 80) !== a.label))
  $.ui.toast(`✕ removed · ${clip(a.label, 50)}`)
}

/** The poller's job: queued steers and turns go out together once the session is idle. */
async function flushOutbox($: EngineInterface) {
  const t = await $.clock.now()
  const queued = (await read($, actionsA)).filter(a => a.status === 'queued' && a.kind !== 'note')
  if (queued.some(a => t - a.at < SEND_GRACE_MS) || isReconciling || isQuickCharting || (await read($, refreshingA))) await update($, tickA, n => n + 1)
  // messages to other agents go when their wait is over, whether or not Claude is working
  for (const a of queued) if (a.kind === 'message' && t - a.at >= SEND_GRACE_MS) await sendMessage($, a)
  const waiting = queued.filter(a => a.kind !== 'message')
  if (await read($, busyA)) {
    for (const a of waiting) if (a.route === 'running turn' && t - a.at >= SEND_GRACE_MS) await appendNow($, a)
    return
  }
  const due = waiting.filter(a => t - a.at >= SEND_GRACE_MS)
  if (!due.length) return
  const ids = new Set(due.map(a => a.id))
  await update($, actionsA, list => list.map((a): CompassAction => (ids.has(a.id) ? { ...a, status: 'sent', route: 'new turn', at: Date.now() } : a)))
  try {
    await $.prompt.submit({ text: due.map(a => a.text).join('\n\n') })
  } catch (err) {
    for (const a of due) await reject($, a, err)
  }
}

/** Immediate course change: rides the running turn, or starts one. */
async function steer($: EngineInterface, text: string, ref = '', prev = '') {
  const t = text.trim()
  if (!t) return
  await paneActed($)
  const sent = { text: t, at: Date.now() }
  await update($, steersA, list => [...list, sent].slice(-20))
  await enqueue($, 'steer', t, `🧭 [compass — steering from the user] ${t}\nAdjust the plan and your next steps accordingly from now on.`, ref, prev)
}

/** Quiet instruction: rides the user's next prompt, unless forced out with ⚡. */
async function queueNote($: EngineInterface, text: string, ref = '', prev = '') {
  await enqueue($, 'note', text, `🧭 [compass — task update from the user] ${text.trim()}`, ref, prev)
}

const LANE_NAME: Record<CompassLane, string> = { now: 'DOING', next: 'TO DO', done: 'DONE', later: 'BACKLOG' }

/** Moves a card (optimistically) and tells the agent; a rejection rolls it back. */
async function moveTask($: EngineInterface, id: string, lane: CompassLane) {
  await paneActed($)
  const stored = await read($, mapA)
  const map = isCurrent(stored) ? stored : null
  const user = (await read($, userTasksA)).find(u => u.id === id)
  const task = map?.tasks.find(t => t.id === id)
  if (!task && !user) return
  const text = task?.text ?? user!.text
  const prev = task?.lane ?? 'now'
  if (prev === lane) return
  if (user && !task) {
    await update($, userTasksA, list => list.filter(u => u.id !== id))
    await editMap($, mp => ({ ...mp, tasks: [...mp.tasks, { id, text, lane, by: 'user', from: '' }] }))
  } else {
    await editMap($, mp => ({ ...mp, tasks: mp.tasks.map(x => (x.id === id ? { ...x, lane } : x)) }))
  }
  const say =
    lane === 'done' ? `Task is done or no longer needed: ${text}` : lane === 'now' ? `Prioritize this task now: ${text}` : lane === 'later' ? `Defer to the backlog, not now: ${text}` : `Move task to TO DO (next): ${text}`
  await enqueue($, 'note', `${clip(text, 40)} → ${LANE_NAME[lane]}`, `🧭 [compass — task update from the user] ${say}`, id, prev)
}

/** Peers from the built-in ListAgents tool; Remote Control counts as online when it lists any. */
export const parsePeers = (text: string) => {
  const peers: CompassPeer[] = []
  let group = ''
  const self = /This session is (.+?) \[/.exec(text)?.[1] ?? ''
  for (const line of text.split('\n')) {
    const head = /^(\S[^:]*?)\s*\(\d+\):\s*$/.exec(line)
    if (head) {
      group = head[1]!.trim()
      continue
    }
    const row = /^\s+(.+?) \[([0-9a-z_-]+)\]\s+·\s+(.*)$/i.exec(line)
    if (!row) continue
    // a renamed session adds "says it was <old name> until <when>" before its kind
    const parts = row[3]!.split('·').map(x => x.trim()).filter(x => !/^says it was /i.test(x))
    if (peers.some(p => p.id === row[2])) continue
    peers.push({ name: row[1]!.trim(), id: row[2]!, group, kind: parts[0] ?? '', status: parts[1] ?? '', since: parts.slice(2).join(' · ') })
  }
  const isRemote = /remote control/i.test(text) && !/remote control is (not|off|disconnected)/i.test(text)
  return { peers, self, isRemote }
}

/** Who sent an inbound delivery: its display name (from-name) and its reply address (from). */
export const senderOf = (text: string) => {
  const addr = /\bfrom="([^"]+)"/.exec(text)?.[1] ?? ''
  const name = /\bfrom-name="([^"]+)"/.exec(text)?.[1] ?? ''
  return { name: name || addr, addr }
}

/** The chat thread a recipient belongs to: "Name [id]" drops its id, a known address maps to its name. */
export const peerKey = (to: string, chat: CompassChatMsg[]) => {
  const t = to.trim()
  const known = chat.find(m => m.addr && m.addr === t)
  return known ? known.peer : t.replace(/\s*\[[0-9a-z_-]+\]\s*$/i, '')
}

/** The body of an inbound delivery, envelope tags stripped. */
export const bodyOf = (text: string) => text.replace(/<[^>]+>/g, '').trim()

async function refreshPeers($: EngineInterface) {
  await update($, peersAtA, () => Date.now())
  try {
    const r = await $.tool.call({ tool: 'ListAgents' })
    const text = typeof r.text === 'string' ? r.text : ''
    if (!text) return
    const { peers, self, isRemote } = parsePeers(text)
    await update($, peersA, () => peers)
    if (self) await update($, selfNameA, () => self)
    await update($, remoteA, was => isRemote || (was && peers.some(p => /remote/i.test(`${p.group} ${p.kind}`))))
  } catch {
    // ListAgents unavailable here: the tab says so
  }
}

async function chatSend($: EngineInterface, peer: string, text: string) {
  const t = text.trim()
  if (!t) return
  const at = Date.now()
  const to = peer
  const chat = await read($, chatA)
  // "Name [id]" picks one of several sessions that share a name; the thread is the name's
  peer = peerKey(to, chat)
  try {
    const addr = to.trim() !== peer ? to : chat.findLast(m => m.peer === peer && m.addr)?.addr
    const r = await $.session.send({ to: addr ?? peer, text: t })
    const isOk = r.isDelivered === true
    await update($, chatA, list => [...list, { peer, dir: 'out' as const, text: t, at, status: isOk ? ('sent' as const) : ('rejected' as const) }].slice(-200))
    $.ui.toast(isOk ? `↗ sent to ${peer}` : `✗ not delivered to ${peer} · ${r.reason ?? ''}`)
  } catch (err) {
    await update($, chatA, list => [...list, { peer, dir: 'out' as const, text: t, at, status: 'rejected' as const }].slice(-200))
    $.ui.toast(`✗ rejected · ${peer} · ${err instanceof Error ? err.message.slice(0, 60) : 'failed'}`)
  }
}

/** A message to another agent or session waits in the outbox like everything else, then goes by SendMessage. */
async function queueMessage($: EngineInterface, peer: string, text: string) {
  const t = text.trim()
  if (!t) return
  const a: CompassAction = { id: `a${Date.now()}${Math.floor(Math.random() * 1e4)}`, kind: 'message', label: clip(`✉ ${peer}: ${t}`, 80), text: t, status: 'queued', route: 'agent', reason: '', at: await $.clock.now(), ref: '', prev: '', to: peer }
  await update($, actionsA, list => [...list, a].slice(-40))
  $.ui.toast(`⋯ to ${clip(peer, 24)} in ${SEND_GRACE_MS / 1000}s · ✕ in the pane cancels`)
}

/** A message too long to read at a glance: more than 160 characters or more than two sentences. */
export const needsGist = (text: string) => {
  const flat = plain(text)
  return graphemes(flat).length > 160 || (flat.match(/[.!?](\s|$)/g)?.length ?? 0) > 2
}

/** One summary line for a long inbound message (haiku, compact STE); the thread shows it until opened. */
async function gistOf($: EngineInterface, peer: string, at: number, text: string) {
  try {
    const reply = await $.model.complete({
      model: 'haiku',
      system: 'You are COMPASS. Reply with ONLY the summary line: no quotes, no preface.',
      prompt: `Another Claude session sent the user this message. Write one line of at most 20 words: what it reports, and what it asks the user to decide or do, if anything.\n${STE}\nThe message:\n${text}`,
      maxTokens: 120,
      effort: 'low',
    })
    await countOwn($, reply)
    const gist = reply.isAnswered ? clip(plain(reply.text).replace(/^["'“]+|["'”]+$/g, ''), 160) : ''
    if (gist) await update($, chatA, list => list.map(m => (m.peer === peer && m.at === at && m.dir === 'in' ? { ...m, gist } : m)))
  } catch {
    // no summary: the thread shows the message's first sentence
  }
}

/** Sends a queued message now; the thread records it either way. */
async function sendMessage($: EngineInterface, a: CompassAction) {
  const sent: Partial<CompassAction> = { status: 'sent', at: Date.now() }
  await update($, actionsA, patched(a.id, sent))
  await chatSend($, a.to ?? '', a.text)
}

async function addUserTask($: EngineInterface, text: string) {
  await paneActed($)
  const t = text.trim()
  if (!t) return
  const id = `u${Date.now()}`
  await update($, userTasksA, list => [...list, { id, text: clip(t, 70), at: Date.now() }])
  await queueNote($, `New task added by the user — prioritize it next: ${t}`, id)
}

/** Packs the handled questions into one round; the poller sends it when the agent is idle. */
async function sendRound($: EngineInterface) {
  const items = await read($, grillA)
  const { handled } = frontierOf(items)
  if (!handled.length) return
  const round = await read($, grillRoundA)
  const before = JSON.stringify(handled.map(q => [q.id, q.state]))
  await enqueue($, 'turn', `grill round ${round}: ${handled.length} answer${handled.length > 1 ? 's' : ''}`, roundMessage(round, handled), 'grill', before)
  const ids = new Set(handled.map(q => q.id))
  await update($, grillA, list => list.map((q): CompassGrillQ => (ids.has(q.id) ? { ...q, state: q.state === 'followup' ? 'sent' : 'settled' } : q)))
  await update($, grillRoundA, r => r + 1)
  await update($, selectedA, () => null)
}

/** Sets a question aside: the session goes on without it (on the recommendation) and does not ask again now. */
async function parkGrill($: EngineInterface, id: string) {
  const q = (await read($, grillA)).find(x => x.id === id)
  if (!q || q.state === 'settled' || q.state === 'parked') return
  await update($, grillA, list => list.map((x): CompassGrillQ => (x.id === id ? { ...x, state: 'parked' } : x)))
  await unblockOn($, q.n)
  await paneActed($)
  await queueNote($, `Parked grill question Q${q.n} "${q.title}": do not wait for it or ask again now; proceed with ${q.rec ? `the recommendation (${q.rec})` : 'your best judgement'} and keep it open`)
  const { ask, handled } = frontierOf(await read($, grillA))
  await update($, selectedA, () => (ask[0] ? `g:${ask[0].id}` : null))
  if (!ask.length && handled.length) await sendRound($)
}

/** Brings a parked question back: the user means to answer it. */
async function unparkGrill($: EngineInterface, id: string) {
  const q = (await read($, grillA)).find(x => x.id === id)
  if (!q || q.state !== 'parked') return
  await update($, grillA, list => list.map((x): CompassGrillQ => (x.id === id ? { ...x, state: 'open' } : x)))
  await paneActed($)
  await update($, selectedA, () => `g:${id}`)
  await queueNote($, `Reopened grill question Q${q.n} "${q.title}": the user will answer it`)
}

/** Drops a question that no longer matters; the agent hears it with the next prompt, and it is not asked again. */
async function dismissGrill($: EngineInterface, id: string) {
  const q = (await read($, grillA)).find(x => x.id === id)
  if (!q || q.state === 'settled') return
  await update($, grillA, list => list.map((x): CompassGrillQ => (x.id === id ? { ...x, state: 'settled', answer: 'dismissed' } : x)))
  await unblockOn($, q.n)
  await paneActed($)
  await queueNote($, `Dismissed grill question Q${q.n} "${q.title}": no longer relevant, drop it`)
  const { ask, handled } = frontierOf(await read($, grillA))
  await update($, selectedA, () => (ask[0] ? `g:${ask[0].id}` : null))
  if (!ask.length && handled.length) await sendRound($)
}

/** Records an answer (or a follow-up, when it starts with "?"); a fully handled frontier goes out. */
async function answerGrill($: EngineInterface, id: string, text: string) {
  const t = text.trim()
  if (!t) return
  const isFollowup = t.startsWith('?')
  await update($, grillA, list =>
    list.map((q): CompassGrillQ =>
      q.id !== id
        ? q
        : isFollowup
          ? { ...q, state: 'followup', followups: [...q.followups, t.slice(1).trim()] }
          : { ...q, state: 'answered', answer: clip(t, 200) },
    ),
  )
  if (!isFollowup) {
    const q = (await read($, grillA)).find(x => x.id === id)
    if (q) await unblockOn($, q.n)
  }
  await paneActed($)
  const { ask } = frontierOf(await read($, grillA))
  await update($, selectedA, () => (ask[0] ? `g:${ask[0].id}` : null))
  if (!ask.length) await sendRound($)
}

function editMap($: EngineInterface, fn: (m: CompassMap) => CompassMap) {
  return update($, mapA, m => (m && isCurrent(m) ? fn(m) : m))
}

function toggleIn($: EngineInterface, key: string) {
  return update($, unfoldedA, list => (list.includes(key) ? list.filter(k => k !== key) : [...list, key]))
}

async function togglePane($: EngineInterface) {
  const isShown = (await $.ui.panes()).some(p => p.id === PANE)
  if (isShown) {
    await $.ui.close({ id: PANE })
    return false
  }
  await $.ui.open({ id: PANE, title: TITLE, columns: 46 })
  if (!isCurrent(await read($, mapA))) wantRefresh()
  return true
}

// ── the module ───────────────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'compass',
      description: '🧭 Toggle the session map pane (args: refresh | steer <text> | task <text>)',
      argumentHint: '[refresh | steer <text> | task <text>]',
    })
    try {
      await $.tool.register({
      name: 'grill',
      description:
        "Post a round of grilling questions to the user's compass grill tab without blocking. Post the whole frontier (decisions whose prerequisites are settled), each with your recommended answer. Re-posting an id re-asks it. Answers arrive later as a new user turn. Use for planning and for open choices in the work in progress; never for facts you can look up.",
      inputSchema: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'What is being grilled, ≤5 words' },
          mode: { type: 'string', enum: ['plan', 'work'], description: 'plan = designing ahead; work = a choice inside the work in progress' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Stable id; reuse it to re-ask or update' },
                title: { type: 'string', description: '≤5 words' },
                body: { type: 'string', description: 'The question, with the choices' },
                options: { type: 'array', items: { type: 'string' }, description: '2-4 short choices, if any' },
                recommendation: { type: 'string', description: 'Your recommended answer' },
                dependsOn: { type: 'array', items: { type: 'string' }, description: 'Ids that must be settled first' },
                blocking: { type: 'boolean', description: 'true only when your work waits on this answer; false when you keep going on your recommendation' },
              },
              required: ['id', 'title', 'body', 'recommendation'],
            },
          },
          settle: { type: 'array', items: { type: 'string' }, description: 'Ids that became moot or were settled elsewhere' },
          askConfirm: { type: 'boolean', description: 'The frontier is empty: ask the user to confirm the shared understanding' },
        },
      },
    })
    } catch {
      $.ui.toast('compass: the grill tool could not be registered')
    }
    const now = await $.clock.now()
    await update($, statsA, s => (s.startedAt ? s : { ...s, startedAt: now }))
    await update($, busyA, () => false)
    await update($, refreshingA, () => false)
    $.ui.status(undefined)
    // resume: reopen the saved chart; chart afresh only when there is none,
    // or the transcript moved on while compass was not watching
    if (!isCurrent(await read($, mapA))) {
      const snap = await quietRestore($)
      if (!snap) wantRefresh()
      else {
        const count = (await $.session.messages()).length
        const isBehind = count > snap.messages + 2
        if (isBehind) wantRefresh()
        $.ui.toast(`🧭 compass restored from ${ago(Date.now() - snap.at)} ago${isBehind ? ' · catching up' : ''}`)
      }
    }
    void refreshPeers($)
    // a reload (or a resume) may have missed a turn's end: chart again when the chart is behind
    {
      const m = await read($, mapA)
      const turns = (await read($, statsA)).turns
      if (m && isCurrent(m) && typeof m.turns === 'number' && turns > m.turns) wantRefresh()
    }
    let ticks = 0
    // the sea chart's gull and waves move only while it is on screen
    $.clock.every(250, async () => {
      if ((await $.clock.now()) - splashAt < 1500) await update($, tickA, n => n + 1)
    })
    $.clock.every(1000, async () => {
      if (++ticks % 5 === 0) void quietly($, 'snapshot')
      if ((await read($, tabA)) === 'chat' && Date.now() - (await read($, peersAtA)) > 15_000) void refreshPeers($)
      void quietly($, 'flush')
      if ((await read($, liveA)).some(p => p.status === 'running' || p.status === 'bg') && ['flow', 'live'].includes(await read($, tabA))) await update($, tickA, n => n + 1)
      // while Claude works: once new tool calls have finished, check the course with haiku
      const clockNow = await $.clock.now()
      if (!isQuickCharting && (await read($, busyA)) && clockNow - pulseAt > PULSE_EVERY_MS && clockNow - turnStartedAt > PULSE_EVERY_MS) {
        const done = (await read($, liveA)).filter(p => p.status !== 'running').length
        if (done > pulseSeen) void quickChart($, 'pulse')
      }
      if (inflight) return
      // during a long turn: chart once the new prompt is in, then every few minutes
      if (!isWanted && turnStartedAt && (await read($, busyA))) {
        const t = await $.clock.now()
        const since = t - Math.max(turnStartedAt, lastRefreshAt)
        // the very first chart starts at once: nothing is on screen yet
        const firstAfter = isCurrent(await read($, mapA)) ? MID_TURN_FIRST_MS : 1_000
        if ((lastRefreshAt < turnStartedAt && t - turnStartedAt > firstAfter) || since > MID_TURN_EVERY_MS) isWanted = true
      }
      if (!isWanted) {
        if (paneActedAt && (await $.clock.now()) - paneActedAt > RECONCILE_AFTER_MS) {
          paneActedAt = 0
          void reconcile($)
        }
        return
      }
      isWanted = false
      void refresh($)
    })
    return next(e)
  })

  // the agent posts grilling rounds here and keeps working
  on('tool.call', { tool: GRILL_TOOL }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const mode = input.mode === 'plan' ? 'plan' : 'work'
    const drafts = grillDrafts(input.questions, mode)
    const topic = str(input.topic, 40)
    const settle = strs(input.settle, 20, 32)
    const at = await $.clock.now()
    await update($, grillA, list =>
      mergeGrill(list, drafts, topic, 'agent', at).map((q): CompassGrillQ => (settle.includes(q.id) ? { ...q, state: 'settled', answer: q.answer || 'moot' } : q)),
    )
    if (input.askConfirm === true) await update($, grillConfirmA, () => topic || 'the plan')
    const { ask, waiting } = frontierOf(await read($, grillA))
    if (ask.length) {
      await update($, selectedA, s => (s?.startsWith('g:') ? s : `g:${ask[0]!.id}`))
      $.ui.toast(`? ${ask.length} question${ask.length > 1 ? 's' : ''} in the grill tab`)
    }
    // a plugin tool's result is a string (or blocks): the model reads it as the tool's answer
    const text = `Posted to the user's compass grill tab: ${ask.length} on the frontier, ${waiting.length} waiting on prerequisites${input.askConfirm === true ? ', plus a confirmation request' : ''}. Do not wait: for blocking ones, continue only with work that does not depend on them; for the others, go on with your recommendation. The user answers when they choose, in any order, and may park or dismiss; answers arrive as a new user turn, parks and dismissals as notes.`
    return { result: text as never, text }
  })

  on('command.run', { command: 'compass' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ')
    if (verb === 'refresh') {
      wantRefresh()
      return { text: '🧭 recharting…' }
    }
    if (verb === 'steer' && arg) {
      await steer($, arg)
      return { text: `🧭 steering — ${arg}` }
    }
    if (verb === 'task' && arg) {
      await addUserTask($, arg)
      return { text: `🧭 task added — ${arg}` }
    }
    const isOpen = await togglePane($)
    return { text: isOpen ? '🧭 compass opened.' : '🧭 compass closed.' }
  })

  // /clear: a new conversation in the same session, so the compass starts over
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      lastSnapSig = ''
      // the cleared conversation's chart must not come back on a later resume
      try {
        await $.store.delete(await snapKey($))
      } catch {
        // no store: nothing saved to come back
      }
      await update($, mapA, () => null)
      await update($, grillA, () => [])
      await update($, grillRoundA, () => 1)
      await update($, grillConfirmA, () => null)
      await update($, agentTodosA, () => [])
      await update($, userTasksA, () => [])
      await update($, actionsA, () => [])
      await update($, chatA, () => [])
      await update($, incomingA, () => null)
      await update($, steersA, () => [])
      await update($, btwA, () => [])
      await update($, selectedA, () => null)
      await update($, errorA, () => null)
      await update($, liveA, () => [])
      const now = await $.clock.now()
      await update($, statsA, () => ({ ...EMPTY_STATS, startedAt: now }))
    }
    return next(e)
  })

  // other agents' and sessions' messages: the chat tab's inbox, and attribution for the map
  on('session.receive', async ($, e, next) => {
    const kind = e.origin.kind
    if (kind === 'bridge') await update($, remoteA, () => true)
    if (kind === 'peer' || kind === 'coordinator' || kind === 'peer-send-message' || kind === 'bridge') {
      const from = senderOf(e.text)
      const peer = ('teammate' in e.origin ? e.origin.teammate : '') || from.name || (kind === 'bridge' ? 'remote control' : 'peer')
      const addr = from.addr && from.addr !== peer ? from.addr : undefined
      const text = clip(bodyOf(e.text), 4000)
      const at = Date.now()
      await update($, chatA, list => [...list, { peer, dir: 'in' as const, text, at, status: 'received' as const, addr }].slice(-200))
      if (kind !== 'bridge' && needsGist(text)) void gistOf($, peer, at, text)
      if (kind !== 'bridge' || from.name) $.ui.toast(`◂ inbound from ${peer}`)
    }
    return next(e)
  })

  // the model's own SendMessage calls: the outbound half of each thread (the pane's sends log themselves)
  on('session.send', async ($, e, next) => {
    const sent = await next(e)
    if (e.origin?.kind === 'model' && !e.agentId) {
      const isOk = sent.isDelivered === true
      const out = { dir: 'out' as const, text: clip(e.text.trim(), 600), at: Date.now(), status: isOk ? ('sent' as const) : ('rejected' as const) }
      await update($, chatA, list => [...list, { ...out, peer: peerKey(e.to, list) }].slice(-200))
      $.ui.toast(isOk ? `▸ outbound to ${peerKey(e.to, await read($, chatA))}` : `✗ not delivered to ${e.to} · ${sent.reason ?? ''}`)
    }
    return sent
  })

  // the pane's window moved: redraw so the outbox stays pinned to its bottom
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)
    await update($, tickA, n => n + 1)
    return moved
  })

  // the board posts moves and selections; its data is input to validate
  on('ui.message', async ($, e, next) => {
    const press = presses.get(e.element)
    if (press && (e.data as { type?: unknown } | undefined)?.type === 'press') {
      await press()
      return {}
    }
    if (e.element === 'compass-crumb') {
      if ((e.data as { type?: unknown } | undefined)?.type === 'open') await togglePane($)
      return {}
    }
    if (e.element !== 'board') return next(e)
    const d = (e.data ?? {}) as { type?: unknown; id?: unknown; lane?: unknown }
    if (typeof d.id !== 'string') return {}
    const id = d.id
    if (d.type === 'select') await update($, selectedA, s => (s === `t:${id}` ? null : `t:${id}`))
    if (d.type === 'move' && typeof d.lane === 'string' && (LANES as readonly string[]).includes(d.lane)) await moveTask($, id, d.lane as CompassLane)
    return {}
  })

  // the model's own ListAgents calls refresh the chat tab too
  on('tool.call', { tool: 'ListAgents' }, async ($, e, next) => {
    const ran = await next(e)
    if (typeof ran.text === 'string' && ran.text) {
      const { peers, self, isRemote } = parsePeers(ran.text)
      await update($, peersA, () => peers)
      await update($, peersAtA, () => Date.now())
      if (self) await update($, selfNameA, () => self)
      if (isRemote) await update($, remoteA, () => true)
    }
    return ran
  })

  // /btw side questions feed the map as asides
  on('command.run', { command: 'btw' }, async ($, e, next) => {
    await addBtw($, e.args)
    return next(e)
  })

  // queued notes ride the next prompt as context
  on('prompt.submit', async ($, e, next) => {
    if (e.text.startsWith('/btw ')) await addBtw($, e.text.slice(5))
    const pending = (await read($, actionsA)).filter(a => a.status === 'queued' && a.kind === 'note')
    if (!pending.length) return next(e)
    const ids = new Set(pending.map(a => a.id))
    await update($, actionsA, list => list.map((a): CompassAction => (ids.has(a.id) ? { ...a, status: 'sent', route: 'next prompt', at: Date.now() } : a)))
    // the whole note, not the outbox's short label
    const note = `🧭 Compass — updates the user made in the compass pane since last turn (user-added tasks come first):\n${pending.map(a => `- ${a.text.replace(/^🧭\s*\[compass[^\]]*\]\s*/u, '')}`).join('\n')}`
    return next({ ...e, context: [...(e.context ?? []), note] })
  })

  // ── keep the map current ──

  on('turn.start', async ($, e, next) => {
    turnStartedAt = await $.clock.now()
    await update($, busyA, () => true)
    // instant and free: the new request shows as "now" before any model call
    const request = plain(e.text.replace(/<[^>]+>/g, ' ').replace(/^🧭\s*\[compass[^\]]*\]\s*/u, ''))
    if (request && !e.text.startsWith('<')) lastRequest = clip(request, 2000)
    // the user's own request only: a turn compass submitted is already in the outbox as sent
    const isOwn = /\[compass\b|^the compass plugin sent a message/i.test(e.text)
    if (request && !e.text.startsWith('<') && !isOwn) {
      await update($, incomingA, () => ({ text: clip(request, 80), at: Date.now() }))
      requestAt = Date.now()
      void quickChart($, 'request', request)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    const now = await $.clock.now()
    // a main-loop call can't still be running once its turn is over (an interrupt cut it short)
    await update($, liveA, list => (list.some(p => p.status === 'running' && !p.agent) ? list.map(p => (p.status === 'running' && !p.agent ? { ...p, status: 'error', end: now } : p)) : list))
    const u = e.usage
    await update($, busyA, () => false)
    await update($, statsA, s => ({
      ...s,
      turns: s.turns + 1,
      busyMs: s.busyMs + (turnStartedAt ? now - turnStartedAt : e.durationMs),
      tokensIn: s.tokensIn + (u?.input_tokens ?? 0),
      tokensOut: s.tokensOut + (u?.output_tokens ?? 0),
      tokensCached: s.tokensCached + (u?.cache_read_input_tokens ?? 0),
    }))
    if (!e.isAborted) {
      wantRefresh()
      void quickChart($, 'turn')
    }
    return done
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    // the live tab: the call shows as running the moment it starts, and settles when it returns
    const pulseId = typeof e.tool_use_id === 'string' && e.tool_use_id ? e.tool_use_id : `p${Date.now()}${Math.floor(Math.random() * 1e4)}`
    const isBg = input.run_in_background === true || e.tool === 'Monitor'
    // compass's own calls (its ListAgents poll) are not the session's work
    if (next.origin.plugin === 'compass') return next(e)
    const started: CompassPulse = { id: pulseId, tool: String(e.tool), what: clip(pulseWhat(input), 160), at: await $.clock.now(), status: 'running', ...(e.agentId ? { agent: e.agentId } : {}) }
    await update($, liveA, list => [...list.filter(p => p.id !== pulseId), started].slice(-LIVE_KEEP))
    const ran = await next(e).catch(async (err: unknown) => {
      const at = await $.clock.now()
      await update($, liveA, list => list.map(p => (p.id === pulseId ? { ...p, status: 'error' as const, end: at } : p)))
      throw err
    })
    const endAt = await $.clock.now()
    const failed = 'deny' in ran && typeof ran.deny === 'string' ? true : ran.isError === true
    const bgId = isBg && !failed && typeof ran.text === 'string' ? bgIdOf(ran.text) : undefined
    await update($, liveA, list =>
      list.map(p => (p.id === pulseId ? { ...p, end: endAt, status: failed ? 'error' : isBg ? 'bg' : 'ok', ...(bgId ? { bgId } : {}) } : p)),
    )
    // Claude stopping a background task (TaskStop, KillShell) ends its row too
    const stopId = !failed && (e.tool === 'TaskStop' || e.tool === 'KillShell') ? [input.task_id, input.shell_id, input.id].find(v => typeof v === 'string') : undefined
    if (typeof stopId === 'string') await update($, liveA, list => list.map(p => (p.bgId === stopId && p.status === 'bg' ? { ...p, status: 'stopped', end: endAt } : p)))
    const name = String(e.tool)
    const file = typeof input.file_path === 'string' ? input.file_path : null
    await update($, statsA, s => ({
      ...s,
      tools: { ...s.tools, [name]: (s.tools[name] ?? 0) + 1 },
      errors: s.errors + (ran.isError === true ? 1 : 0),
      files: file && FILE_TOOLS.test(name) && !s.files.includes(file) ? [...s.files, file] : s.files,
    }))
    if (e.tool === 'TodoWrite') {
      await update($, agentTodosA, () => e.todos.map((t): CompassAgentTodo => ({ text: t.content, status: t.status })))
    } else if (e.tool === 'TaskCreate') {
      await update($, agentTodosA, (list): CompassAgentTodo[] => [...list, { text: e.subject, status: 'pending' }])
    }
    return ran
  })

  // The grilling guide and the user's steering ride in the system prompt, so they survive compaction.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const held = new Set((await read($, actionsA)).filter(a => a.status === 'queued' && a.kind === 'steer').map(a => a.label))
    const steers = (await read($, steersA)).filter(x => !held.has(clip(x.text, 80)))
    const steering = steers.length
      ? `\n\n# Compass steering\nThe user steered this session via the compass pane. Honor these directives (newest wins):\n${steers.slice(-6).map(s => `- ${s.text}`).join('\n')}`
      : ''
    return { sections: [...composed.sections, { id: 'compass', scope: 'session' as const, text: `${GRILL_GUIDE}${steering}` }] }
  })

  // ── the clickable compass in the hint line under the prompt ──

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    // a Client (a region one of the surface modules draws) exists on the terminal and desktop; elsewhere Buttons stand in
    const hasClient = e.surface === 'terminal' || e.surface === 'desktop'
    const stored = await read($, mapA)
    const map = isCurrent(stored) ? stored : null
    const front = frontierOf(await read($, grillA))
    const asks = front.ask.length
    const blocking = front.ask.filter(q => q.blocking).length
    const queued = (await read($, actionsA)).filter(a => a.status === 'queued').length
    const isRefreshing = await read($, refreshingA)
    await read($, tickA)
    const now = await $.clock.now()
    const incoming = await read($, incomingA)
    const engine = await next(e)
    const spin = isRefreshing ? SPIN[Math.floor(now / 120) % SPIN.length] : ''
    // the room left beside the engine's own hint
    // the viewport is the conversation's width; the row under the prompt also spans a docked pane
    const panes = paneCols > 0 ? await $.ui.panes() : []
    const isDocked = panes.some(p => p.id === PANE)
    const room = Math.max(24, (e.viewport?.columns ?? 100) + (isDocked ? paneCols + 1 : 0) - glen(e.props.hint ?? '') - 6)
    const chips = hintChips(map, asks, queued, room, incoming?.text ?? null, blocking, (await read($, statsA)).turns > 0)
    const gap = (key: string) => (
      <Text key={key} backgroundColor={PANEL}>
        {' '}
      </Text>
    )
    // one panel: its own fill around the brand and every chip, so the row reads as one unit
    return (
      <Box>
        <Box flexShrink={0}>
          {gap('hp:l')}
          {/* a Button draws one engine colour: where a Client can be drawn, the gold brand is one and takes the click */}
          {hasClient ? (
            h('Client', { module: './brand.tsx', key: 'compass-crumb', props: { color: GOLD, bg: TONE.gold.bg, spin } })
          ) : (
            <Button key="compass-crumb" plain label="◈ compass" onPress={() => void togglePane($)} />
          )}
          {chips.flatMap(c => [
            gap(`hp:g:${c.key}`),
            <Text key={`hp:${c.key}`} color={TONE[c.tone].fg} backgroundColor={TONE[c.tone].bg}>
              {' '}
              {c.parts.map((x, i) =>
                x.bar !== undefined ? (
                  <Text key={`hp:${c.key}:${i}`} color={TONE[c.tone].fg} backgroundColor={TRACK}>
                    {barText(x.bar, BAR_CELLS)}
                  </Text>
                ) : (
                  <Text key={`hp:${c.key}:${i}`} color={x.color} dimColor={x.isDim} bold={x.isBold}>
                    {x.text}
                  </Text>
                ),
              )}{' '}
            </Text>,
          ])}
          {gap('hp:r')}
        </Box>
        <Text dimColor>{'  '}</Text>
        {engine}
      </Box>
    )
  })

  // ── the pane ──

  // a background task's notification row settles its call in the live tab
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const task = e.props.task
    // a notification that says how the task ended closes its row; a monitor's event (no status) does not
    if (task && (task.id || task.toolUseId) && task.status) {
      const isOk = task.status === 'completed'
      const list = await read($, liveA)
      const hit = list.find(p => (p.status === 'bg' || p.status === 'running') && ((task.toolUseId && p.id === task.toolUseId) || (task.id && p.bgId === task.id)))
      if (hit) {
        const at = task.durationMs ? hit.at + task.durationMs : await $.clock.now()
        // a drawing never writes: the settle goes out on the next tick
        const settled = task.status === 'killed' ? 'stopped' : isOk ? 'bgdone' : 'bgfail'
        $.clock.after(0, () => update($, liveA, all => all.map(p => (p.id === hit.id ? { ...p, status: settled, end: at } : p))))
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Input = 'Input' in els ? els.Input : null
    const width = Math.max(28, e.props.bodyColumns)
    paneCols = e.props.placement === 'dock' ? e.props.bodyColumns + 2 : 0
    const [stored, grill, round, confirm, actions, userTasks, steers, btw, stats, tab, selected, unfolded, isRefreshing, isBusy, lastError] =
      await Promise.all([
        read($, mapA),
        read($, grillA),
        read($, grillRoundA),
        read($, grillConfirmA),
        read($, actionsA),
        read($, userTasksA),
        read($, steersA),
        read($, btwA),
        read($, statsA),
        read($, tabA),
        read($, selectedA),
        read($, unfoldedA),
        read($, refreshingA),
        read($, busyA),
        read($, errorA),
      ])
    const [peers, peersAt, selfName, isRemote, chat, incoming, chatSeen] = await Promise.all([read($, peersA), read($, peersAtA), read($, selfNameA), read($, remoteA), read($, chatA), read($, incomingA), read($, chatSeenA)])
    const live = await read($, liveA)
    const openPeer = tab === 'chat' && selected?.startsWith('p:') ? selected.slice(2) : null
    const unreadOf = (name: string) => (name === openPeer ? 0 : chat.filter(m => m.peer === name && m.dir === 'in' && m.at > (chatSeen[name] ?? 0)).length)
    const unreadAll = [...new Set(chat.map(m => m.peer))].reduce((n, p) => n + unreadOf(p), 0)
    // a Client (a region one of the surface modules draws) exists on the terminal and desktop; elsewhere Buttons stand in
    const hasClient = e.surface === 'terminal' || e.surface === 'desktop'
    const map = isCurrent(stored) ? stored : null
    const now = await $.clock.now()
    const board = boardOf(map, userTasks)
    const front = frontierOf(grill)
    const isOpen = (key: string) => unfolded.includes(key)
    const select = (id: string) => () => update($, selectedA, s => (s === id ? null : id))
    const rule = <Text dimColor>{'─'.repeat(width)}</Text>

    const art = (t: CompassTab, hint: string) => (
      <Box flexDirection="column" key={`art:${t}`}>
        {ART[t].map(line => (
          <Text color="cyan" dimColor>
            {line}
          </Text>
        ))}
        <Text dimColor>{hint}</Text>
      </Box>
    )

    const input = (key: string, placeholder: string, submitLabel: string, onSubmit: (v: string) => void) =>
      Input && (
        <Box key={`in:${key}`} marginTop={1}>
          <Input key={key} placeholder={placeholder} submitLabel={submitLabel} onSubmit={(v: string) => onSubmit(v)} />
        </Box>
      )

    const fold = (key: string, label: string) => (
      <Button key={`fold:${key}`} plain dimColor label={`${isOpen(key) ? '▾' : '▸'} ${label}`} onPress={() => toggleIn($, key)} />
    )

    // indicators: a tinted pill, a level bar, a pill button (a Client, so it keeps its colours)
    const pill = (key: string, text: string, tone: Tone, bold = false) => (
      <Box key={key} flexShrink={0}>
        <Text color={TONE[tone].fg} backgroundColor={TONE[tone].bg} bold={bold}>
          {` ${text} `}
        </Text>
      </Box>
    )
    const meter = (key: string, frac: number, cells: number, tone: Tone) => (
      <Text key={key} color={TONE[tone].fg} backgroundColor={TRACK}>
        {barText(frac, cells)}
      </Text>
    )
    const pillBtn = (key: string, label: string, tone: Tone, onPress: () => unknown, isOn = false) => {
      presses.set(key, onPress)
      return hasClient ? (
        <Box key={`${key}:box`} flexShrink={0}>
          {h('Client', { module: './pill.tsx', key, props: { label, fg: TONE[tone].fg, bg: TONE[tone].bg, isOn } })}
        </Box>
      ) : (
        <Button key={key} plain dimColor={!isOn} label={label} onPress={() => void onPress()} />
      )
    }
    const spin = SPIN[Math.floor(now / 120) % SPIN.length]!

    // is the chart caught up with the session? one line, always on top
    const behind = map && typeof map.turns === 'number' ? Math.max(0, stats.turns - map.turns) : 0
    const unseen = map ? actions.filter(a => a.status === 'sent' && a.at > Math.max(map.at, map.reconciledAt ?? 0)).length : 0
    // what is going on with the chart, and whether you need to do anything: one answer for the
    // sync line and the sea chart alike
    const syncLine = ((): { tone: Tone; glyph: string; text: string; detail: string; canRefresh: boolean } => {
      const update = { canRefresh: true }
      const wait = { canRefresh: false }
      if (isQuickCharting) return { tone: 'cyan', glyph: spin, text: quickWhat || 'checking the course', detail: 'a few seconds · nothing to do', ...wait }
      if (isRefreshing) return { tone: 'cyan', glyph: spin, text: 'charting now', detail: 'nothing to do', ...wait }
      if (isReconciling) return { tone: 'cyan', glyph: spin, text: 'applying your changes', detail: 'a few seconds · nothing to do', ...wait }
      if (!map && stats.turns === 0 && !isBusy) return { tone: 'dim', glyph: '◌', text: 'waiting for your first prompt', detail: 'the chart starts seconds after you send one', ...wait }
      if (!map && isBusy) return { tone: 'cyan', glyph: '◌', text: 'chart coming', detail: 'drawn in a few seconds · nothing to do', ...wait }
      if (!map) return { tone: 'yellow', glyph: '◌', text: 'no chart yet', detail: 'press ↻ update to draw it', ...update }
      if (incoming) return isBusy
        ? { tone: 'cyan', glyph: '◌', text: 'your new message', detail: 'charted a few seconds into the turn · nothing to do', ...wait }
        : { tone: 'yellow', glyph: '◌', text: 'new message not charted', detail: 'press ↻ update', ...update }
      if (behind) return isBusy
        ? { tone: 'cyan', glyph: '◌', text: `${behind} turn${behind > 1 ? 's' : ''} behind`, detail: 'updates when this turn ends · nothing to do', ...wait }
        : { tone: 'yellow', glyph: '◌', text: `${behind} turn${behind > 1 ? 's' : ''} behind`, detail: 'press ↻ update', ...update }
      if (unseen) return isBusy
        ? { tone: 'cyan', glyph: '◌', text: `${unseen} update${unseen > 1 ? 's' : ''} sent`, detail: 'charted when this turn ends · nothing to do', ...wait }
        : { tone: 'yellow', glyph: '◌', text: `${unseen} update${unseen > 1 ? 's' : ''} not charted`, detail: 'press ↻ update', ...update }
      return { tone: 'green', glyph: '✓', text: 'in sync', detail: isBusy ? 'Claude is working · next update when the turn ends' : '', ...wait }
    })()

    // a clickable label that wraps between words instead of being cut: the first row is the
    // button, the rest follow under it, so every word stays readable
    const wrapped = (key: string, text: string, room: number, onPress: () => unknown, opts: { dim?: boolean; indent?: number } = {}) => {
      const [first = '', ...rest] = wordWrap(text, room)
      return {
        head: <Button key={key} plain dimColor={opts.dim} label={first} onPress={() => void onPress()} />,
        tail: rest.length ? (
          <Box key={`${key}:more`} flexDirection="column" paddingLeft={opts.indent ?? 2}>
            {rest.map((r, i) => (
              <Text key={`${key}:r${i}`} dimColor={opts.dim}>
                {r}
              </Text>
            ))}
          </Box>
        ) : null,
      }
    }

    // ── header: a title bar, then the tabs as a segmented control ──
    const header = (
      <Box flexDirection="column" key="head">
        <Box justifyContent="space-between">
          <Box flexShrink={1}>
            <Text bold wrap="wrap">
              <Text color={GOLD}>{'◈ '}</Text>
              <Text color="#e6e6e6">{map?.goal || 'compass'}</Text>
            </Text>
          </Box>
          <Box flexShrink={0} columnGap={1}>
            {pillBtn('legend', '? key', isOpen('legend') ? 'cyan' : 'dim', async () => {
              await update($, tabA, () => 'flow')
              await toggleIn($, 'legend')
            }, isOpen('legend'))}
            <Button key="close" plain dimColor label="✕" role="dismiss" onPress={() => void togglePane($)} />
          </Box>
        </Box>
        <Box flexWrap="wrap" marginTop={1}>
          {TABS.map(t => {
            const isOn = t.id === tab
            const count = t.id === 'grill' ? front.ask.length : t.id === 'chat' ? unreadAll : 0
            return (
              <Box key={`tabbox:${t.id}`} marginRight={1}>
                {pillBtn(`tab:${t.id}`, `${t.icon} ${t.label}`, isOn ? 'blue' : 'dim', () => update($, tabA, () => t.id), isOn)}
                {count > 0 ? pill(`tabn:${t.id}`, `${count}`, t.id === 'grill' ? 'yellow' : 'cyan', true) : null}
                {t.id === 'chat' ? <Text color={isRemote ? TONE.green.fg : TONE.red.fg}>●</Text> : null}
              </Box>
            )
          })}
        </Box>
      </Box>
    )

    // ── one graph row (accordion detail on click) ──
    // a snapshot of the chart's plan, so cancelling the steer in the outbox puts it back
    const planNow = () => JSON.stringify({ milestones: map?.milestones ?? [], tasks: map?.tasks ?? [] })
    const detail = (id: string, label: string, why: string, state: CompassState) => (
      <Box flexDirection="column" key={`detail:${id}`} paddingLeft={4}>
        {why ? <Text dimColor>↳ {why}</Text> : null}
        <Box columnGap={1} flexWrap="wrap">
          {state !== 'done' && state !== 'active' && pillBtn(`go:${id}`, '▶ go', 'green', () => steer($, `Switch focus now to: "${label}".`))}
          {state !== 'done' &&
            state !== 'abandoned' &&
            pillBtn(`skip:${id}`, '⤼ skip', 'red', async () => {
              const before = planNow()
              await editMap($, mp => ({
                ...mp,
                milestones: mp.milestones.map(ms => ({ ...ms, steps: ms.steps.map(x => (x.id === id ? { ...x, state: 'abandoned', why: 'skipped by you' } : x)) })),
              }))
              await steer($, `Skip this, don't do it: "${label}".`, 'plan', before)
            })}
          {state === 'pending' &&
            pillBtn(`later:${id}`, '☐ later', 'blue', async () => {
              const before = planNow()
              await editMap($, mp => ({
                ...mp,
                milestones: mp.milestones.map(ms => ({ ...ms, steps: ms.steps.filter(x => x.id !== id) })),
                tasks: [...mp.tasks, { id: `l${id}`, text: label, lane: 'later', by: 'user', from: '' }],
              }))
              await queueNote($, `Defer to the backlog, not now: ${label}`, 'plan', before)
            })}
          {state === 'abandoned' && pillBtn(`retry:${id}`, '↺ retry', 'yellow', () => steer($, `Revisit the dropped path: "${label}".`))}
        </Box>
      </Box>
    )

    const stepRow = (s: CompassStep, isFuture: boolean) => {
      const m = markOf(s.kind, s.state)
      const isSide = s.kind === 'attempt' || s.kind === 'aside'
      const isNow = s.state === 'active' || s.state === 'blocked'
      const rail = isSide ? (isFuture ? '┊ ├' : '│ ├') : isFuture ? '┊ ' : '│ '
      const why = (s.state === 'abandoned' || s.state === 'blocked' || s.kind === 'decision') && s.why ? ` · ${s.why}` : ''
      const room = width - rail.length - 3 - (isNow ? 6 : 0)
      const label = s.kind === 'aside' ? `btw ${s.label}` : s.label
      const node = wrapped(`node:${s.id}`, `${label}${why}`, room, select(s.id), { dim: s.state === 'done' || s.state === 'abandoned' || s.kind === 'aside', indent: rail.length + 2 })
      return (
        <Box flexDirection="column" key={`step:${s.id}`}>
          <Box>
            <Text dimColor>{rail}</Text>
            <Text color={m.color} dimColor={m.dim} bold={isNow}>
              {m.glyph}{' '}
            </Text>
            {node.head}
            {isNow && <Text> </Text>}
            {isNow && pill(`now:${s.id}`, s.state === 'blocked' ? '! waiting' : '◀ now', s.state === 'blocked' ? 'red' : 'cyan', true)}
          </Box>
          {node.tail}
          {selected === s.id && detail(s.id, s.label, s.why, s.state)}
        </Box>
      )
    }

    // ── the live feed: one row per tool call, and the strip of what is running right now ──
    const isLive = (p: CompassPulse) => p.status === 'running' || p.status === 'bg'
    const runningNow = live.filter(isLive).reverse()
    const took = (ms: number) => (ms < 1000 ? `${(Math.max(0, ms) / 1000).toFixed(1)}s` : span(ms))
    const PULSE: Record<CompassPulse['status'], { glyph: string; tone: Tone }> = {
      running: { glyph: spin, tone: 'cyan' },
      bg: { glyph: '◌', tone: 'cyan' },
      ok: { glyph: '✓', tone: 'green' },
      bgdone: { glyph: '✓', tone: 'green' },
      error: { glyph: '✗', tone: 'red' },
      bgfail: { glyph: '✗', tone: 'red' },
      stopped: { glyph: '■', tone: 'dim' },
    }
    const toolTone = (t: string): Tone =>
      t === 'Bash' || t === 'Monitor' ? 'yellow' : /^(Read|Grep|Glob|LS|WebFetch|WebSearch)$/.test(t) ? 'blue' : /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(t) ? 'purple' : t === 'Agent' || t.startsWith('mcp__') ? 'cyan' : 'gray'
    const toolName = (t: string) => (t.startsWith('mcp__') ? t.split('__').pop() ?? t : t)
    const pulseRow = (p: CompassPulse, key: string) => {
      const mk = PULSE[p.status]
      const isOn = isLive(p)
      const time = p.status === 'bg' ? `bg ${took(now - p.at)}` : took((p.end ?? now) - p.at)
      return (
        <Box key={key}>
          <Box width={2} flexShrink={0}>
            <Text color={TONE[mk.tone].fg} bold={isOn}>
              {mk.glyph}
            </Text>
          </Box>
          {p.agent ? <Text dimColor>↳ </Text> : null}
          <Box width={11} flexShrink={0}>
            <Text color={TONE[toolTone(p.tool)].fg} bold={isOn} wrap="truncate-end">
              {clip(toolName(p.tool), 10)}
            </Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text dimColor={!isOn} wrap="truncate-end">
              {p.what || ' '}
            </Text>
          </Box>
          <Box width={9} flexShrink={0} justifyContent="flex-end">
            <Text color={isOn ? TONE.cyan.fg : undefined} dimColor={!isOn}>
              {time}
            </Text>
          </Box>
        </Box>
      )
    }
    const liveStrip = (rows: number, onFlow: boolean) => {
      const last = live[live.length - 1]
      const fg = runningNow.filter(p => p.status === 'running').length
      const bg = runningNow.length - fg
      const state = runningNow.length
        ? [fg ? `${fg} running` : '', bg ? `${bg} in background` : ''].filter(Boolean).join(' · ')
        : last
          ? `idle · last call ${span(now - (last.end ?? last.at))} ago`
          : 'no tool calls yet'
      return (
        <Box key={`strip:${onFlow ? 'flow' : 'live'}`} flexDirection="column" marginBottom={1}>
          <Box>
            {pill('strip:now', `${runningNow.length ? spin : '↯'} now`, runningNow.length ? 'cyan' : 'dim', true)}
            <Box flexGrow={1} flexShrink={1}>
              <Text dimColor wrap="truncate-end">
                {`  ${state}`}
              </Text>
            </Box>
            {onFlow && pillBtn('strip:open', '↯ live ▸', 'dim', () => update($, tabA, () => 'live'))}
          </Box>
          {runningNow.slice(0, rows).map(p => pulseRow(p, `strip:${p.id}`))}
          {runningNow.length > rows ? <Text dimColor>{`  +${runningNow.length - rows} more running`}</Text> : null}
          {!runningNow.length && onFlow && last ? pulseRow(last, `strip:last:${last.id}`) : null}
        </Box>
      )
    }

    // ── tabs ──
    let body: RenderElement

    if (tab === 'flow') {
      const ms = map?.milestones ?? []
      const { milestone: active, step } = locate(map)
      const rows: RenderElement[] = []
      // the milestones compass and the agent settled on: a header with overall progress, then one
      // row each (number, name, its own steps bar), the active one unfolded into its steps
      if (ms.length) {
        const msDone = ms.filter(m => m.state === 'done').length
        rows.push(
          <Box key="ms:head" marginBottom={0}>
            <Text color={TONE.blue.fg} bold>
              ⚑ milestones
            </Text>
            <Box flexGrow={1} />
            {meter('ms:headbar', msDone / ms.length, 5, 'green')}
            <Box width={6} flexShrink={0} justifyContent="flex-end">
              <Text bold>{`${msDone}/${ms.length}`}</Text>
            </Box>
          </Box>,
        )
      }
      for (const [mi, m] of ms.entries()) {
        const isActive = m === active
        const mk = STEP_MARK[m.state]
        const isUnfolded = isActive || isOpen(`m:${m.id}`)
        const count = m.steps.length
        const real = m.steps.filter(x => x.kind !== 'aside')
        const stepsDone = real.filter(x => x.state === 'done').length
        const msRow = wrapped(
          `msbtn:${m.id}`,
          `${m.label}${m.state === 'abandoned' && m.why ? ` · ${m.why}` : ''}${!isActive && count && isUnfolded ? '  ▾' : ''}`,
          width - 22,
          () => (isActive ? undefined : toggleIn($, `m:${m.id}`)),
          { dim: m.state === 'done' || m.state === 'abandoned' || m.state === 'pending' },
        )
        rows.push(
          <Box key={`ms:${m.id}`} flexDirection="column">
            <Box>
              <Text color={mk.color} dimColor={mk.dim} bold>
                {mk.glyph}{' '}
              </Text>
              {pill(`msnum:${m.id}`, `M${mi + 1}`, isActive ? 'blue' : 'dim', isActive)}
              <Text> </Text>
              <Box flexShrink={1}>{msRow.head}</Box>
              {!isActive && count && !isUnfolded ? <Text> </Text> : null}
              {!isActive && count && !isUnfolded ? pill(`msn:${m.id}`, `+${count}`, 'dim') : null}
              <Box flexGrow={1} />
              {real.length ? meter(`msbar:${m.id}`, stepsDone / real.length, 5, m.state === 'done' ? 'green' : isActive ? 'blue' : 'dim') : null}
              <Box width={6} flexShrink={0} justifyContent="flex-end">
                <Text dimColor={!isActive}>{real.length ? `${stepsDone}/${real.length}` : ''}</Text>
              </Box>
            </Box>
            {msRow.tail}
          </Box>,
        )
        if (!isUnfolded) continue
        const steps = m.steps
        const hereIdx = steps.findIndex(s => s.state === 'active' || s.state === 'blocked')
        const pivot = hereIdx < 0 ? (isActive ? 0 : steps.length) : hereIdx
        const past = steps.slice(0, pivot)
        const future = steps.slice(pivot + (hereIdx < 0 ? 0 : 1))
        // fisheye: decisions and the last few steps stay; the rest folds
        const isPastOpen = !isActive || isOpen(`past:${m.id}`)
        const keep = isPastOpen ? past : past.filter((s, i) => s.kind === 'decision' || i >= past.length - PAST_KEEP)
        if (keep.length < past.length) {
          rows.push(
            <Box key={`pf:${m.id}`}>
              <Text dimColor>┆ </Text>
              {fold(`past:${m.id}`, `${past.length - keep.length} earlier`)}
            </Box>,
          )
        }
        keep.forEach(s => rows.push(stepRow(s, false)))
        if (hereIdx >= 0) rows.push(stepRow(steps[hereIdx]!, false))
        const alt = isActive && map?.alt && !map.altPick ? map.alt : null
        if (alt) {
          // the fork: two cards side by side, the planned path and the branch; pick one to steer
          const colW = Math.floor((width - 3) / 2)
          const card = (key: string, title: string, tone: Tone, why: string, items: string[], mark: string, pick: () => unknown, label: string) => (
            <Box key={key} flexDirection="column" width={colW} borderStyle="round" borderColor={TONE[tone].fg} borderDimColor={tone === 'dim'} paddingX={1}>
              {wordWrap(title, colW - 4).map((l, i) => (
                <Text key={`${key}:t${i}`} color={TONE[tone].fg} bold>
                  {l}
                </Text>
              ))}
              {why
                ? wordWrap(why, colW - 4).map((l, i) => (
                    <Text key={`${key}:w${i}`} dimColor>
                      {l}
                    </Text>
                  ))
                : null}
              {items.flatMap((it, i) =>
                wordWrap(mark ? `${mark} ${it}` : it, colW - 4).map((l, j) => (
                  <Text key={`${key}:s${i}:${j}`}>{j ? `  ${l}` : l}</Text>
                )),
              )}
              <Box marginTop={1}>{pillBtn(`pick:${key}`, label, tone === 'dim' ? 'gray' : tone, pick)}</Box>
            </Box>
          )
          rows.push(
            <Box key={`fork:${m.id}`} flexDirection="column">
              <Box>
                <Text dimColor>├ </Text>
                {pill(`forkp:${m.id}`, '⑂ two ways on', 'purple', true)}
              </Box>
              <Box columnGap={1}>
                {card('main', 'as planned', 'dim', '', map ? plannedAhead(map, FUTURE_KEEP + 1) : [], '', () => pickTrajectory($, 'main'), '▶ keep')}
                {card('branch', alt.label, 'cyan', alt.why, alt.steps, '◇', () => pickTrajectory($, 'branch'), '⤴ take')}
              </Box>
            </Box>,
          )
          continue
        }
        const shown = isOpen(`fut:${m.id}`) ? future : future.slice(0, FUTURE_KEEP)
        shown.forEach(s => rows.push(stepRow(s, true)))
        if (shown.length < future.length) {
          rows.push(
            <Box key={`ff:${m.id}`}>
              <Text dimColor>┊ </Text>
              {fold(`fut:${m.id}`, `${future.length - shown.length} more`)}
            </Box>,
          )
        }
      }

      body = (
        <Box flexDirection="column" key="flow">
          {isOpen('legend') && (
            <Box flexDirection="column" key="legend" borderStyle="round" borderDimColor paddingX={1}>
              <Text bold>key</Text>
              {LEGEND.map(c => (
                <Box key={`lg:${c.text}`}>
                  <Box width={4}>
                    <Text color={c.color} dimColor={c.dim} bold>
                      {c.glyph}
                    </Text>
                  </Box>
                  <Box width={8}>
                    <Text color={c.color} dimColor>
                      {c.hue}
                    </Text>
                  </Box>
                  <Text wrap="wrap">{c.text}</Text>
                </Box>
              ))}
            </Box>
          )}
          {ms.length > 0 && live.length > 0 && liveStrip(2, true)}
          {ms.length === 0 ? (
            // the sea chart fills the tab until the first chart lands
            (() => {
              splashAt = now
              const chartRows = seaChart(width, Math.max(10, e.props.scroll.bodyRows - 17), now, isRefreshing || (isBusy && !map), `${syncLine.text} · ${syncLine.detail}`)
              return (
                <Box key="sea" flexDirection="column">
                  {chartRows.map((row, y) => (
                    <Text key={`sea:${y}`} wrap="truncate-end">
                      {row.map((r, i) =>
                        r[1] ? (
                          <Text key={`sea:${y}:${i}`} color={r[1]} bold={r[2]}>
                            {r[0]}
                          </Text>
                        ) : (
                          r[0]
                        ),
                      )}
                    </Text>
                  ))}
                </Box>
              )
            })()
          ) : (
            <Box flexDirection="column">
              {rows}
            </Box>
          )}
          {(front.ask.length > 0 || front.handled.length > 0 || front.parked.length > 0 || front.waiting.length > 0 || board.now.length > 0) && rule}
          {(() => {
            // decisions in play, mirrored from the grill: what waits on you, what is open while
            // work goes on, what is answered and about to go out, what you parked
            const live = [...front.ask.filter(x => x.blocking), ...front.ask.filter(x => !x.blocking), ...front.waiting]
            const answered = front.handled
            if (!live.length && !answered.length && !front.parked.length) return null
            const open = (id: string) => async () => {
              await update($, selectedA, () => `g:${id}`)
              await update($, tabA, () => 'grill')
            }
            const row = (key: string, glyph: string, tone: Tone, state: string, label: string, onPress: () => unknown) => {
              const w = wrapped(`fd:${key}`, label, width - glen(state) - 6, onPress, { indent: glen(state) + 4 })
              return (
                <Box key={`fdr:${key}`} flexDirection="column">
                  <Box>
                    <Text color={TONE[tone].fg} bold>
                      {glyph}{' '}
                    </Text>
                    {pill(`fds:${key}`, state, tone)}
                    <Text> </Text>
                    {w.head}
                  </Box>
                  {w.tail}
                </Box>
              )
            }
            return (
              <Box key="flow:decisions" flexDirection="column">
                <Text color={TONE.yellow.fg} bold>
                  ? decisions
                </Text>
                {live.slice(0, 5).map(x =>
                  x.blocking && x.state === 'open'
                    ? row(x.id, '⏸', 'red', 'waits on you', `Q${x.n} ${x.title}`, open(x.id))
                    : row(x.id, '?', 'yellow', x.state === 'open' && !front.waiting.includes(x) ? 'open · work goes on' : 'after earlier answers', `Q${x.n} ${x.title}`, open(x.id)),
                )}
                {live.length > 5 && <Text dimColor>{`  +${live.length - 5} more in the grill tab`}</Text>}
                {answered.map(x => row(x.id, '✓', 'green', 'answered', `Q${x.n} ${x.title} · goes out with the round`, open(x.id)))}
                {front.parked.length > 0 && row('parked', '◌', 'dim', `${front.parked.length} parked`, 'work goes on with the recommendations', open(front.parked[0]!.id))}
              </Box>
            )
          })()}
          {board.now.length > 0 && (
            <Box key="flow:t" flexDirection="column">
              {(() => {
                const w = wrapped('flow:tbtn', `${board.now[0]!.from ? `⇄${board.now[0]!.from} ` : ''}${board.now[0]!.text}`, width - 9, () => update($, tabA, () => 'tasks'))
                return [
                  <Box key="flow:trow">
                    {pill('flow:tp', '▶ doing', 'cyan', true)}
                    <Text> </Text>
                    {w.head}
                  </Box>,
                  w.tail,
                ]
              })()}
            </Box>
          )}
          {(() => {
            // the steer card: write where the whole session should head; what you sent is folded
            // under it (go / skip / later / retry and fork picks send steers too)
            const held = new Set(actions.filter(a => a.status === 'queued' && a.kind === 'steer').map(a => a.label))
            const sentList = steers.filter(x => !held.has(clip(x.text, 80)))
            const isHistory = isOpen('steers')
            return (
              <Box key="steer-card" flexDirection="column" borderStyle="round" borderColor={TONE.cyan.fg} paddingX={1} marginTop={1}>
                <Box>
                  {pill('steer:title', '↪ steer the course', 'cyan', true)}
                  <Box flexGrow={1} />
                  <Text dimColor>Enter sends · waits 8 s in the outbox</Text>
                </Box>
                {Input && (
                  <Box marginTop={1}>
                    <Input key="steer" placeholder="tell Claude where the whole session should head next…" submitLabel="steer" onSubmit={(v: string) => void steer($, v)} />
                  </Box>
                )}
                {sentList.length > 0 && (
                  <Box marginTop={1}>
                    <Button
                      key="fold:steers"
                      plain
                      dimColor
                      label={`${isHistory ? '▾' : '▸'} ${sentList.length} sent · last ${span(now - sentList[sentList.length - 1]!.at)} ago`}
                      onPress={() => toggleIn($, 'steers')}
                    />
                  </Box>
                )}
                {isHistory &&
                  [...sentList].reverse().slice(0, 8).map((x, i) => (
                    <Box key={`steer:h${i}`}>
                      <Text color={TONE.cyan.fg}>↪ </Text>
                      <Box flexGrow={1} flexShrink={1}>
                        <Text dimColor wrap="wrap">
                          {x.text}
                        </Text>
                      </Box>
                      <Box flexShrink={0}>
                        <Text dimColor>{` ${span(now - x.at)}`}</Text>
                      </Box>
                    </Box>
                  ))}
              </Box>
            )
          })()}
        </Box>
      )
    } else if (tab === 'live') {
      const { step: here, upcoming } = locate(map)
      const ok = live.filter(p => p.status === 'ok' || p.status === 'bgdone').length
      const bad = live.filter(p => p.status === 'error' || p.status === 'bgfail').length
      // calls per slice of the last 10 minutes, as a one-row sparkline: the session's pulse
      const cells = Math.max(10, Math.min(48, width - 16))
      const slice = 600_000 / cells
      const counts = Array.from({ length: cells }, (_, i) => live.filter(p => p.at > now - 600_000 + i * slice && p.at <= now - 600_000 + (i + 1) * slice).length)
      const peak = Math.max(1, ...counts)
      const spark = counts.map(c => (c ? '▁▂▃▄▅▆▇█'[Math.min(7, Math.round((c / peak) * 7))]! : ' ')).join('')
      const perMin = live.filter(p => now - p.at < 60_000).length
      const recent = live.filter(p => !isLive(p)).reverse()
      const SHOW = isOpen('live:all') ? 120 : 30
      body = (
        <Box flexDirection="column" key="live">
          {map && (here || upcoming) ? (
            <Box key="live:course" flexDirection="column" marginBottom={1}>
              {here ? (
                <Text wrap="truncate-end">
                  <Text color={TONE.cyan.fg} bold>
                    ◉ now{'  '}
                  </Text>
                  <Text>{here.label}</Text>
                </Text>
              ) : null}
              {upcoming ? (
                <Text wrap="truncate-end">
                  <Text dimColor>○ next </Text>
                  <Text dimColor>{upcoming}</Text>
                </Text>
              ) : null}
            </Box>
          ) : null}
          {live.length === 0 ? (
            art('live', 'every tool call shows here as it runs: shells, edits, searches, monitors, agents')
          ) : (
            <Box key="live:feed" flexDirection="column">
              <Box key="live:counts" columnGap={1} flexWrap="wrap" marginBottom={1}>
                {(() => {
                  const n = runningNow.filter(p => p.status === 'running').length
                  return pill('live:n:run', `${n ? spin : '●'} ${n} running`, n ? 'cyan' : 'dim')
                })()}
                {pill('live:n:bg', `◌ ${runningNow.filter(p => p.status === 'bg').length} background`, 'blue')}
                {pill('live:n:ok', `✓ ${ok}`, 'green')}
                {bad ? pill('live:n:bad', `✗ ${bad}`, 'red') : null}
                {pill('live:n:rate', `${perMin}/min`, 'dim')}
              </Box>
              <Box key="live:spark">
                <Text color={TONE.gold.fg} backgroundColor={TRACK}>
                  {spark}
                </Text>
                <Text dimColor>{'  last 10m'}</Text>
              </Box>
              <Box key="live:gap" marginTop={1} />
              {liveStrip(8, false)}
              {rule}
              {recent.slice(0, SHOW).map(p => pulseRow(p, `pulse:${p.id}`))}
              {recent.length > 30 && fold('live:all', isOpen('live:all') ? 'show fewer' : `${Math.min(recent.length, 120) - 30} earlier`)}
            </Box>
          )}
        </Box>
      )
    } else if (tab === 'tasks') {
      const total = board.now.length + board.next.length + board.later.length + board.done.length
      const taskRow = (t: CompassTask & { isQueued?: true }) => {
        const isDone = t.lane === 'done'
        const glyph = isDone ? '☑' : t.lane === 'now' ? '▶' : '☐'
        const color = isDone ? 'green' : t.lane === 'now' ? 'cyan' : undefined
        return (
          <Box flexDirection="column" key={`task:${t.id}`}>
            {(() => {
              const w = wrapped(`tbtn:${t.id}`, `${t.by === 'user' ? '★ ' : ''}${t.from ? `⇄${t.from} ` : ''}${isDone ? `~${t.text}~` : t.text}${t.isQueued ? '  ⋯' : ''}`, width - 2, select(`t:${t.id}`), { dim: isDone || t.lane === 'later' })
              return [
                <Box key={`trow:${t.id}`}>
                  <Text color={color} dimColor={t.lane === 'later'}>
                    {glyph}{' '}
                  </Text>
                  {w.head}
                </Box>,
                w.tail,
              ]
            })()}
            {selected === `t:${t.id}` && (
              <Box paddingLeft={2} columnGap={1} flexWrap="wrap" key={`tact:${t.id}`}>
                {(['now', 'next', 'later', 'done'] as const)
                  .filter(l => l !== t.lane)
                  .map(l => (
                    <Button
                      key={`tmv:${t.id}:${l}`}
                      plain
                      label={{ now: '⇡ DOING', next: '→ TO DO', later: '☐ BACKLOG', done: '✓ DONE' }[l]}
                      onPress={() => void moveTask($, t.id, l)}
                    />
                  ))}
                <Button
                  key={`tdrop:${t.id}`}
                  plain
                  label="✗ drop"
                  onPress={async () => {
                    await editMap($, mp => ({ ...mp, tasks: mp.tasks.filter(x => x.id !== t.id) }))
                    await update($, userTasksA, list => list.filter(x => x.id !== t.id))
                    await queueNote($, `Drop this task, don't do it: ${t.text}`)
                  }}
                />
              </Box>
            )}
          </Box>
        )
      }
      const all = [...board.now, ...board.next, ...board.done, ...board.later]
      const picked = all.find(t => selected === `t:${t.id}`)
      const queuedRefs = new Set(actions.filter(a => a.status === 'queued' && a.ref).map(a => a.ref))
      const doneN = board.done.length
      const filled = total ? Math.round((doneN / total) * 14) : 0
      if (hasClient) {
        body = (
          <Box flexDirection="column" key="tasks">
            {h('Client', {
              module: './board.tsx',
              key: 'board',
              width,
              props: {
                wip: 3,
                selected: picked?.id ?? null,
                cards: all.map(t => ({ id: t.id, text: `${t.from ? `⇄${t.from} ` : ''}${t.text}`, lane: t.lane, by: t.by, isQueued: !!t.isQueued || queuedRefs.has(t.id) })),
              },
            })}
            {picked && (
              <Box flexDirection="column" key="picked" borderStyle="round" borderDimColor paddingX={1}>
                <Text wrap="wrap" bold>
                  {picked.by === 'user' ? '★ yours' : picked.from ? `⇄ from ${picked.from}` : '◆ agent'} · {LANE_NAME[picked.lane]}
                </Text>
                <Text>{picked.text}</Text>
                <Box columnGap={1} flexWrap="wrap">
                  {(['now', 'next', 'done', 'later'] as const)
                    .filter(l => l !== picked.lane)
                    .map(l => (
                      <Button key={`pmv:${l}`} plain label={{ now: '⇡ DOING', next: '→ TO DO', later: '☐ BACKLOG', done: '✓ DONE' }[l]} onPress={() => void moveTask($, picked.id, l)} />
                    ))}
                  <Button
                    key="pdrop"
                    plain
                    label="✗ drop"
                    onPress={async () => {
                      await editMap($, mp => ({ ...mp, tasks: mp.tasks.filter(x => x.id !== picked.id) }))
                      await update($, userTasksA, list => list.filter(x => x.id !== picked.id))
                      await update($, selectedA, () => null)
                      await queueNote($, `Drop this task, don't do it: ${picked.text}`)
                    }}
                  />
                </Box>
              </Box>
            )}
            {input('task', '+ add a task (agent takes it next turn)', 'add', v => void addUserTask($, v))}
          </Box>
        )
      } else body = (
        <Box flexDirection="column" key="tasks">
          {total === 0 ? (
            art('tasks', 'no tasks yet')
          ) : (
            <Box flexDirection="column">
              <Text>
                <Text color="green">{'▰'.repeat(filled)}</Text>
                <Text dimColor>{'▱'.repeat(14 - filled)}</Text>
                <Text dimColor>
                  {' '}
                  {doneN}/{total} · now {board.now.length} · next {board.next.length}
                </Text>
              </Text>
              {board.now.map(taskRow)}
              {board.next.map(taskRow)}
              {board.later.length > 0 && rule}
              {board.later.length > 0 && fold('later', `later ${board.later.length}`)}
              {isOpen('later') && board.later.map(taskRow)}
              {doneN > 0 && fold('done', `✓ ${doneN} done`)}
              {isOpen('done') && board.done.map(taskRow)}
            </Box>
          )}
          {input('task', '+ add a task (agent takes it next turn)', 'add', v => void addUserTask($, v))}
        </Box>
      )
    } else if (tab === 'chat') {
      const sel = selected?.startsWith('p:') ? selected.slice(2) : null
      const tally = (name: string) => {
        const msgs = chat.filter(m => m.peer === name)
        return { inn: msgs.filter(m => m.dir === 'in').length, out: msgs.filter(m => m.dir === 'out').length, last: msgs[msgs.length - 1] }
      }
      const counts = (name: string) => {
        const c = tally(name)
        const fresh = unreadOf(name)
        return (
          <Box flexShrink={0} columnGap={1} marginLeft={1}>
            {fresh ? pill(`cn:${name}`, `● ${fresh} new`, 'yellow', true) : null}
            {c.inn ? pill(`ci:${name}`, `◂ ${c.inn}`, 'cyan') : null}
            {c.out ? pill(`co:${name}`, `▸ ${c.out}`, 'green') : null}
          </Box>
        )
      }
      const openThread = (name: string, id: string | null = null) => async () => {
        const latest = (await read($, chatA)).reduce((t, m) => (m.peer === name ? Math.max(t, m.at) : t), 0)
        await update($, chatSeenA, seen => ({ ...seen, [name]: Math.max(seen[name] ?? 0, latest) }))
        // another row of the same name moves the open thread there; the same row closes it
        const isMove = selected === `p:${name}` && id !== threadAt
        threadAt = id
        await update($, selectedA, s => (s === `p:${name}` && !isMove ? null : `p:${name}`))
      }
      const lastLine = (name: string, id: string | null = null) => {
        const m = tally(name).last
        if (!m) return null
        const open = async () => {
          const k = `m:${name}:${m.at}:${m.dir}`
          await update($, unfoldedA, l => (l.includes(k) ? l : [...l, k]))
          if (selected !== `p:${name}` || id !== threadAt) await openThread(name, id)()
        }
        const say = m.gist ? `≈ ${m.gist}` : leadOf(m.text, 80).lead
        return (
          <Box paddingLeft={2}>
            <Button key={`last:${id ?? `x:${name}`}`} plain dimColor label={clip(`${m.dir === 'in' ? '◂ ' : '▸ '}${say}`, width - 3)} onPress={() => void open()} />
          </Box>
        )
      }
      const others = [...new Set(chat.map(m => m.peer))].filter(n => !peers.some(p => p.name === n))
      const dot = (status: string) => (/busy|running|working/i.test(status) ? 'green' : /idle/i.test(status) ? 'yellow' : 'red')
      const thread = sel ? chat.filter(m => m.peer === sel).slice(-30) : []
      // the open thread draws under its agent's row (the first with that name), so it shows where the click was
      const namesakes = sel ? peers.filter(p => p.name === sel) : []
      const threadRow = sel ? (namesakes.find(p => p.id === threadAt) ?? namesakes[0])?.id ?? (others.includes(sel) ? `x:${sel}` : null) : null
      // several sessions share the name: the message goes to the one whose row is open
      const sendTo = sel && namesakes.length > 1 && threadRow ? `${sel} [${threadRow}]` : sel
      const hasRow = threadRow !== null
      const threadBox = sel ? (
            <Box flexDirection="column" key="thread" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
              <Text color="cyan" bold wrap="wrap">
                ⇄ {selfName ? `${selfName} ⇄ ` : ''}
                {sel}
              </Text>
              {(() => {
                const all = chat.filter(m => m.peer === sel)
                if (all.length === 0) return <Text dimColor>no messages yet</Text>
                const c = tally(sel)
                const failed = all.filter(m => m.status === 'rejected').length
                return (
                  <Text dimColor wrap="wrap">
                    <Text color="cyan">◂ {c.inn} in</Text> · <Text color="green">▸ {c.out} out</Text>
                    {failed ? <Text color="red"> · ✗ {failed} failed</Text> : null} · since {ago(now - all[0]!.at)} ago · last {ago(now - all[all.length - 1]!.at)} ago
                  </Text>
                )
              })()}
              {thread.some(m => leadOf(m.text).hasMore) ? <Text dimColor>▸ click a message to read it all</Text> : null}
              {thread.map(m => {
                const key = `m:${sel}:${m.at}:${m.dir}`
                const isFull = isOpen(key)
                const isNew = m.dir === 'in' && m.at > (chatSeen[sel] ?? 0)
                const arrow = m.dir === 'in' ? '◂ in ' : m.status === 'rejected' ? '✗ out' : '▸ out'
                const { lead, hasMore } = leadOf(m.text)
                const canOpen = hasMore || !!m.gist
                const stamp = `${isNew ? '●' : ' '}${arrow} ${ago(now - m.at).padStart(4)} `
                // the thread box takes 4 columns: its border and padding
                const room = Math.max(12, width - glen(stamp) - 4)
                const lines = isFull ? m.text.split('\n').map(plain).filter(Boolean) : [m.gist ? `≈ ${m.gist}` : lead]
                const rows = lines.flatMap(l => wordWrap(l, room))
                if (canOpen) rows[rows.length - 1] += isFull ? ' ▾' : ' ▸'
                const press = () => (canOpen ? void toggleIn($, key) : undefined)
                return (
                  <Box key={key} flexDirection="column">
                    <Box>
                      <Text color={m.dir === 'in' ? 'cyan' : m.status === 'rejected' ? 'red' : 'green'} bold>
                        {stamp.slice(0, -6)}
                      </Text>
                      <Text dimColor>{stamp.slice(-6)}</Text>
                      <Button key={`b:${key}`} plain dimColor={m.dir === 'out'} label={rows[0] ?? ''} onPress={press} />
                    </Box>
                    {rows.slice(1).map((r, i) => (
                      <Box key={`b:${key}:r${i}`} paddingLeft={glen(stamp)}>
                        <Button key={`b:${key}:r${i}:b`} plain dimColor={m.dir === 'out'} label={r} onPress={press} />
                      </Box>
                    ))}
                  </Box>
                )
              })}
              {input(`chat:${sel}`, `message ${clip(sel, 20)}… · waits 8 s in the outbox`, 'queue', v => void queueMessage($, sendTo ?? sel, v))}
            </Box>
      ) : null
      body = (
        <Box flexDirection="column" key="chat">
          <Box justifyContent="space-between">
            {pill('rc', `● remote control ${isRemote ? 'online' : 'offline'}`, isRemote ? 'green' : 'red', true)}
            <Box columnGap={1}>
              <Text dimColor>{peersAt ? `◷ ${span(now - peersAt)}` : ''}</Text>
              {pillBtn('peers-refresh', '↻', 'dim', () => refreshPeers($))}
            </Box>
          </Box>
          {selfName ? <Text dimColor wrap="wrap">this session: {selfName}</Text> : null}
          {!isRemote && <Text dimColor>local sessions only · run /remote-control to reach your other machines</Text>}
          {rule}
          {peers.length === 0 && others.length === 0 && art('chat', 'no other agents or sessions right now')}
          {peers.map(p => (
            <Box flexDirection="column" key={`peer:${p.id}`}>
              <Box>
                <Text color={dot(p.status) === 'green' ? TONE.green.fg : dot(p.status) === 'yellow' ? TONE.yellow.fg : TONE.red.fg}>● </Text>
                <Box flexShrink={1}>
                  <Button key={`peer:${p.id}:name`} plain label={p.name} onPress={openThread(p.name, p.id)} />
                </Box>
                <Box flexGrow={1} />
                {pill(`pk:${p.id}`, `${p.kind}${p.status ? ` · ${p.status}` : ''}`, 'dim')}
                {counts(p.name)}
                <Box marginLeft={1} flexShrink={0}>{pillBtn(`msg:${p.id}`, '✉ message', threadRow === p.id ? 'cyan' : 'blue', openThread(p.name, p.id), threadRow === p.id)}</Box>
              </Box>
              {p.group && /remote/i.test(p.group) ? <Text dimColor>{'  '}{p.group}</Text> : null}
              {lastLine(p.name, p.id)}
              {threadRow === p.id && threadBox}
            </Box>
          ))}
          {others.map(n => (
            <Box flexDirection="column" key={`peerx:${n}`}>
              <Box>
                <Text dimColor>○ </Text>
                <Button key={`peer:${n}`} plain dimColor label={n} onPress={openThread(n)} />
                {counts(n)}
              </Box>
              {lastLine(n)}
              {threadRow === `x:${n}` && threadBox}
            </Box>
          ))}
          {sel && !hasRow && threadBox}
        </Box>
      )
    } else if (tab === 'grill') {
      const current = front.ask.find(q => selected === `g:${q.id}`) ?? front.ask[0]
      const inner = width - 4
      // the open question, drawn like Claude Code's own question dialog
      const card = (q: CompassGrillQ) => (
        <Box key={`card:${q.id}`} flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
          <Box justifyContent="space-between">
            <Box flexShrink={1}>
              <Text color="yellow" bold wrap="wrap">
                ? Q{q.n} · {q.title}
              </Text>
            </Box>
            <Box columnGap={1} flexShrink={0}>
              <Text dimColor>{q.mode}</Text>
              {pillBtn(`gpark:${q.id}`, '⏸ park', 'dim', () => parkGrill($, q.id))}
              <Button key={`gdrop:${q.id}`} plain dimColor label="✕" onPress={() => void dismissGrill($, q.id)} />
            </Box>
          </Box>
          <Box>
            {pill(`gblk:${q.id}`, q.blocking ? '⏸ work waits on this' : '▶ work goes on meanwhile', q.blocking ? 'red' : 'green')}
          </Box>
          {q.topic || q.from ? (
            <Text wrap="wrap">
              {q.from ? <Text color="cyan">⇄ {q.from} </Text> : null}
              <Text dimColor>{q.topic}</Text>
            </Text>
          ) : null}
          <Box marginTop={1}>
            <Text>{q.body || q.title}</Text>
          </Box>
          {q.followups.map((f, i) => (
            <Text key={`fu:${q.id}:${i}`} dimColor>
              ↳ you asked: {f}
            </Text>
          ))}
          <Box flexDirection="column" marginTop={1}>
            {q.options.map((o, i) => {
              const isRec = i === recIndex(q.rec, q.options)
              return (
                <Box key={`opt:${q.id}:${i}`}>
                  <Button key={`gopt:${q.id}:${i}`} plain hotkey={`${i + 1}`} label={o} onPress={() => void answerGrill($, q.id, o)} />
                  {isRec && <Text color="green"> ➡ recommended</Text>}
                </Box>
              )
            })}
            {q.rec && (
              <Box marginTop={q.options.length ? 1 : 0} flexDirection="column">
                {(() => {
                  const w = wrapped(`grec:${q.id}`, q.rec, inner - 3, () => answerGrill($, q.id, q.rec))
                  return [
                    <Box key={`grecrow:${q.id}`}>
                      <Text color="green">➡ </Text>
                      {w.head}
                    </Box>,
                    w.tail,
                  ]
                })()}
              </Box>
            )}
          </Box>
          {Input && (
            <Box marginTop={1}>
              <Input
                key={`gans:${q.id}`}
                placeholder="your answer · start with ? to ask a follow-up"
                submitLabel="answer"
                onSubmit={(v: string) => void answerGrill($, q.id, v)}
              />
            </Box>
          )}
        </Box>
      )
      const collapsed = (q: CompassGrillQ, mark: string, color: string | undefined, tail: string) => (
        <Box key={`gq:${q.id}`} flexDirection="column">
          {(() => {
            const w = wrapped(`gsel:${q.id}`, `Q${q.n} ${q.title}${tail}`, width - 5, () => update($, selectedA, () => `g:${q.id}`), { dim: q.state !== 'open' })
            return [
              <Box key={`gqrow:${q.id}`}>
                <Text color={q.blocking && q.state === 'open' ? TONE.red.fg : color} bold>
                  {q.blocking && q.state === 'open' ? '⏸' : mark}{' '}
                </Text>
                {w.head}
                <Box flexGrow={1} />
                {q.state !== 'settled' && <Button key={`gdrop:${q.id}`} plain dimColor label=" ✕" onPress={() => void dismissGrill($, q.id)} />}
              </Box>,
              w.tail,
            ]
          })()}
        </Box>
      )
      const pending = actions.some(a => a.status === 'queued' && a.kind === 'turn')
      body = (
        <Box flexDirection="column" key="grill">
          {/* the decision radar: what waits on you, what is open while work goes on, what you parked */}
          <Box flexWrap="wrap" columnGap={1}>
            {pill('gs:block', `⏸ ${front.ask.filter(q => q.blocking).length} blocking`, front.ask.some(q => q.blocking) ? 'red' : 'dim', true)}
            {pill('gs:open', `? ${front.ask.filter(q => !q.blocking).length + front.waiting.length} open`, front.ask.some(q => !q.blocking) ? 'yellow' : 'dim')}
            {pill('gs:park', `◌ ${front.parked.length} parked`, 'dim')}
            {pill('gs:done', `✓ ${front.settled.length} settled`, front.settled.length ? 'green' : 'dim')}
          </Box>
          <Text dimColor wrap="wrap">
            {isRefreshing ? `${spin} checking the session for new decisions now` : `◷ checked ${map ? `${span(now - map.at)} ago` : 'not yet'} · ${isBusy ? 'checks again a few seconds into each turn and when it ends' : 'checks again with your next prompt'}`}
          </Text>
          {grill.length === 0 && !confirm ? (
            <Box key="g:empty" flexDirection="column" borderStyle="round" borderColor={TONE.yellow.fg} borderDimColor paddingX={1} marginTop={1}>
              <Text color={TONE.yellow.fg} bold>
                ? decisions land here
              </Text>
              <Text wrap="wrap">Questions that need you appear here as the session moves:</Text>
              {[
                'when Claude plans or hits a choice, it posts them (with its recommendation)',
                'after every turn, compass looks for new goals, ideas, trade-offs and effects down the road you should decide or know about',
                'each says whether work waits on it (⏸) or goes on meanwhile (▶)',
              ].map((line, i) => (
                <Box key={`g:empty:${i}`}>
                  <Text dimColor>{'  • '}</Text>
                  <Box flexShrink={1}>
                    <Text dimColor wrap="wrap">
                      {line}
                    </Text>
                  </Box>
                </Box>
              ))}
              <Text wrap="wrap">Answer any, in any order, when you like: ⏸ park one to let the work go on without it, ✕ to drop it. The session hears every choice.</Text>
            </Box>
          ) : (
            <Box flexDirection="column" marginTop={1}>
              <Text>
                <Text color="yellow" bold>
                  round {round}
                </Text>
                <Text dimColor>
                  {' '}· answers go to Claude together once every open question here is handled, or now with ↗ send
                </Text>
              </Text>
              {confirm && (
                <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1} key="confirm">
                  <Text color="green" bold>
                    ✓ frontier empty · {confirm}
                  </Text>
                  <Text>Do we share the same understanding?</Text>
                  <Box columnGap={2}>
                    <Button
                      key="gconfirm"
                      plain
                      label="✓ confirm, proceed"
                      onPress={async () => {
                        await update($, grillConfirmA, () => null)
                        await enqueue($, 'turn', `confirmed: ${confirm}`, `🧭 [compass grill] The user confirms the shared understanding of ${confirm}. Proceed.`)
                      }}
                    />
                    <Button
                      key="gmore"
                      plain
                      label="↺ keep grilling"
                      onPress={async () => {
                        await update($, grillConfirmA, () => null)
                        await enqueue($, 'turn', `keep grilling: ${confirm}`, `🧭 [compass grill] The user is not done with ${confirm}: keep grilling; look for branches of the design tree not yet visited and post the next round.`)
                      }}
                    />
                  </Box>
                </Box>
              )}
              {current && card(current)}
              {front.ask.filter(q => q !== current).map(q => collapsed(q, '?', 'yellow', q.rec ? `  ➡ ${q.rec}` : ''))}
              {front.handled.map(q => collapsed(q, q.state === 'followup' ? '↳' : '✓', 'green', q.state === 'followup' ? '  follow-up asked' : `  → ${q.answer}`))}
              {front.handled.length > 0 && (
                <Box columnGap={1}>
                  <Button key="gsend" plain variant="primary" label={`↗ send ${front.handled.length} now`} onPress={() => void sendRound($)} />
                  <Text dimColor>or answer the rest; the round goes out by itself</Text>
                </Box>
              )}
              {pending && <Text color="cyan">{isBusy ? '⋯ answers go to the agent when this turn ends' : '↗ sending…'}</Text>}
              {front.sent.map(q => collapsed(q, '⋯', 'cyan', '  awaiting the re-ask'))}
              {front.waiting.length > 0 && fold('gwait', `${front.waiting.length} waiting on earlier answers`)}
              {isOpen('gwait') &&
                front.waiting.map(q => collapsed(q, '…', undefined, `  after ${q.dependsOn.map(d => `Q${grill.find(x => x.id === d)?.n ?? '?'}`).join(', ')}`))}
              {front.parked.length > 0 && fold('gparked', `${front.parked.length} parked · work goes on without them`)}
              {isOpen('gparked') &&
                front.parked.map(q => (
                  <Box key={`gp:${q.id}`}>
                    <Text dimColor>◌ </Text>
                    <Box flexGrow={1} flexShrink={1}>
                      <Text dimColor wrap="wrap">
                        Q{q.n} {q.title}
                        {q.rec ? ` · going with: ${q.rec}` : ''}
                      </Text>
                    </Box>
                    <Box flexShrink={0} columnGap={1}>
                      {pillBtn(`gunpark:${q.id}`, '↺ answer it', 'yellow', () => unparkGrill($, q.id))}
                      <Button key={`gpdrop:${q.id}`} plain dimColor label="✕" onPress={() => void dismissGrill($, q.id)} />
                    </Box>
                  </Box>
                ))}
              {front.settled.length > 0 && fold('gsettled', `${front.settled.length} settled`)}
              {isOpen('gsettled') &&
                front.settled.map(q => (
                  <Box key={`gs:${q.id}`} flexDirection="column">
                    <Text wrap="wrap">
                      <Text color="magenta">◆ </Text>Q{q.n} {q.title}
                    </Text>
                    <Text dimColor wrap="wrap">
                      {'  ⇒ '}
                      {q.answer}
                    </Text>
                  </Box>
                ))}
            </Box>
          )}
        </Box>
      )
    } else if (tab === 'stats') {
      const top = Object.entries(stats.tools).sort((a, b) => b[1] - a[1]).slice(0, 6)
      const max = top[0]?.[1] ?? 1
      const calls = Object.values(stats.tools).reduce((a, b) => a + b, 0)
      const steps = (map?.milestones ?? []).flatMap(m => m.steps)
      const msAll = map?.milestones.length ?? 0
      const msDone = (map?.milestones ?? []).filter(m => m.state === 'done').length
      const taskAll = board.now.length + board.next.length + board.later.length + board.done.length
      // one grid for every row: label | bar | value | reset, so bars and numbers line up
      const LABEL_W = 22
      const VALUE_W = 6
      const TAIL_W = 10
      const cells = Math.max(6, width - LABEL_W - VALUE_W - TAIL_W)
      const label = (icon: string, k: string, tone: Tone) => (
        <Box width={LABEL_W} flexShrink={0}>
          <Text wrap="truncate-end">
            <Text color={TONE[tone].fg}>{icon}</Text> <Text dimColor>{k}</Text>
          </Text>
        </Box>
      )
      const kv = (icon: string, k: string, v: string, tone: Tone = 'gray') => (
        <Box key={`s:${k}`}>
          {label(icon, k, tone)}
          {pill(`sv:${k}`, v, tone, true)}
        </Box>
      )
      const levelTone = (f: number): Tone => (f > 0.8 ? 'red' : f > 0.5 ? 'yellow' : 'green')
      const barRow = (icon: string, k: string, part: number, all: number, tone: Tone, value: string, tail = '') => (
        <Box key={`b:${k}`}>
          {label(icon, k, tone)}
          {meter(`bm:${k}`, all ? part / all : 0, cells, tone)}
          <Box width={VALUE_W} flexShrink={0} justifyContent="flex-end">
            <Text bold>{value}</Text>
          </Box>
          <Box width={TAIL_W} flexShrink={0}>
            <Text dimColor>{tail ? ` ⟲ ${tail}` : ''}</Text>
          </Box>
        </Box>
      )
      const head = (t: string) => (
        <Box key={`h:${t}`} marginTop={1}>
          <Text color={TONE.blue.fg} bold>
            {t}
          </Text>
        </Box>
      )
      const pct = Math.round(stats.contextPct)
      const own = stats.own ?? EMPTY_STATS.own
      const LIMIT_NAME: Record<string, string> = { five_hour: '5h window', seven_day: '7d window' }
      body = (
        <Box flexDirection="column" key="stats">
          {head('◷ session')}
          <Box flexWrap="wrap" columnGap={1}>
            {pill('st:time', `◷ ${span(now - (stats.startedAt || now))}`, 'gray')}
            {pill('st:turns', `↻ ${stats.turns}`, 'blue')}
            {pill('st:calls', `⚒ ${calls}`, 'cyan')}
            {pill('st:err', `△ ${stats.errors}`, stats.errors ? 'red' : 'green')}
            {pill('st:files', `✎ ${stats.files.length}`, 'yellow')}
            {stats.costUsd > 0 ? pill('st:cost', `$ ${stats.costUsd.toFixed(2)}`, 'gold') : null}
          </Box>
          <Box flexWrap="wrap" columnGap={1} marginTop={1}>
            {pill('st:in', `↑ ${kfmt(stats.tokensIn)}`, 'red')}
            {pill('st:out', `↓ ${kfmt(stats.tokensOut)}`, 'green')}
            {pill('st:cache', `≋ ${kfmt(stats.tokensCached)}`, 'purple')}
          </Box>
          {head('▤ limits')}
          {barRow('◫', 'context', pct, 100, levelTone(pct / 100), `${pct}%`)}
          {(stats.limits ?? []).map(l => {
            const reset = l.resetsAt ? Date.parse(l.resetsAt) - now : NaN
            return barRow(l.kind === 'seven_day' ? '▦' : '◔', LIMIT_NAME[l.kind] ?? l.kind, l.pct, 100, levelTone(l.pct / 100), `${Math.round(l.pct)}%`, Number.isFinite(reset) ? span(reset) : '')
          })}
          {head('├ course')}
          {barRow('⚑', 'milestones', msDone, msAll, 'green', `${msDone}/${msAll}`)}
          {barRow('☑', 'tasks', board.done.length, taskAll, 'cyan', `${board.done.length}/${taskAll}`)}
          {barRow('?', 'grill', front.settled.length, grill.length, 'yellow', `${front.settled.length}/${grill.length}`)}
          {kv('●', 'steps · ✗ dead ends', `${steps.filter(s => s.state === 'done').length} · ${steps.filter(s => s.state === 'abandoned').length}`, 'green')}
          {kv('↪', 'steers · ◌ asides', `${steers.length} · ${btw.length}`, 'purple')}
          {head('⚒ tools')}
          {top.length === 0 && art('stats', 'no tool calls yet')}
          {top.map(([name, n], i) => (
            <Box key={`tool:${name}`}>
              <Box width={LABEL_W} flexShrink={0}>
                <Text wrap="truncate-end">{name.replace(/^mcp__/, '')}</Text>
              </Box>
              {meter(`tm:${name}`, n / max, cells, (['cyan', 'green', 'yellow', 'purple'] as const)[i % 4]!)}
              <Box width={VALUE_W} flexShrink={0} justifyContent="flex-end">
                <Text bold>{n}</Text>
              </Box>
            </Box>
          ))}
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>{'┄'.repeat(width)}</Text>
            <Text dimColor wrap="wrap">
              ◈ compass itself: {own.calls} map calls · {kfmt(own.input + own.cacheWrite)} in · {kfmt(own.cacheRead)} cached · {kfmt(own.output)} out
            </Text>
            <Text dimColor wrap="wrap">
              {own.calls ? `≈ ${Math.round((own.cacheRead / Math.max(1, own.input + own.cacheRead + own.cacheWrite)) * 100)}% served from cache` : 'no map calls yet'}
            </Text>
          </Box>
        </Box>
      )
    } else {
      const lines = map?.recap ?? []
      body = (
        <Box flexDirection="column" key="recap">
          {lines.length === 0 ? (
            art('recap', 'nothing to recap yet')
          ) : (
            <Box flexDirection="column">
              {lines.map((l, i) => (
                <Box key={`r:${i}`}>
                  <Text color="cyan">{i === lines.length - 1 ? '└ ' : '├ '}</Text>
                  <Text>{l}</Text>
                </Box>
              ))}
              <Box marginTop={1}>
                <Button
                  key="copy"
                  label="⧉ copy recap"
                  plain
                  onPress={() => void $.ui.copy({ text: [`◈ ${map?.goal ?? ''}`, ...lines.map(l => `- ${l}`)].join('\n') })}
                />
              </Box>
            </Box>
          )}
          {btw.length > 0 && fold('btw', `◌ ${btw.length} /btw asides`)}
          {isOpen('btw') &&
            btw.map((b, i) => (
              <Box key={`btw:${i}`}>
                <Text color="magenta" dimColor>
                  ◌{' '}
                </Text>
                <Text dimColor wrap="wrap">
                  {b}
                </Text>
              </Box>
            ))}
        </Box>
      )
    }

    // the outbox, pinned to the bottom of the pane: what goes into the session and when,
    // one row each; every row is exactly one line, so its height is known
    await read($, tickA)
    const queued = actions.filter(a => a.status === 'queued')
    const sent = actions.filter(a => a.status !== 'queued' && now - a.at < 600_000).reverse()
    const WHEN = { 'running turn': ['↪', 'cyan'], 'new turn': ['⏭', 'yellow'], 'next prompt': ['✎', 'purple'], agent: ['✉', 'blue'], '': ['⋯', 'yellow'] } as const
    const footRows: RenderElement[] = []
    const groups = (['running turn', 'new turn', 'next prompt', 'agent'] as const).filter(r => queued.some(a => a.route === r))
    const groupName = { 'running turn': 'into this turn', 'new turn': isBusy ? 'after this turn' : 'next turn', 'next prompt': 'with next prompt', agent: 'to agents' } as const
    const failed = sent.filter(a => a.status === 'rejected').length
    footRows.push(
      <Box key="f:head" backgroundColor={PANEL}>
        {queued.length ? pill('f:count', `⇣ ${queued.length}`, 'yellow', true) : <Text color={TONE.dim.fg} backgroundColor={PANEL}>{' ⇣ outbox empty'}</Text>}
        {groups.map(r => (
          <Text key={`f:g:${r}`} backgroundColor={PANEL} wrap="truncate-end">
            {'  '}
            <Text color={TONE[WHEN[r][1]].fg}>{WHEN[r][0]}</Text>
            <Text color={TONE.dim.fg}>
              {' '}
              {width < 56 ? queued.filter(a => a.route === r).length : groupName[r]}
            </Text>
          </Text>
        ))}
        <Box flexGrow={1} />
        {sent.length > 0 && <Button key="fold:activity" plain dimColor label={`${isOpen('activity') ? '▾' : '▸'} ✓${sent.length - failed}${failed ? ` ✗${failed}` : ''} `} onPress={() => toggleIn($, 'activity')} />}
      </Box>,
    )
    for (const r of groups) {
      const list = queued.filter(a => a.route === r)
      for (const a of list) {
        const left = Math.max(0, Math.ceil((a.at + SEND_GRACE_MS - now) / 1000))
        const timer = r !== 'next prompt' && left > 0 ? dotsText(left, SEND_GRACE_MS / 1000) : ''
        const ctl = (list.length > 1 ? 4 : 0) + 5
        const lines = wordWrap(a.label, Math.max(8, width - 3 - (timer ? timer.length + 1 : 0) - ctl))
        footRows.push(
          <Box key={`f:${a.id}`} backgroundColor={PANEL}>
            <Box flexShrink={0}>
              <Text color={TONE[WHEN[r][1]].fg} backgroundColor={PANEL} bold>
                {` ${WHEN[r][0]} `}
              </Text>
              {timer ? (
                <Text color={TONE[WHEN[r][1]].fg} backgroundColor={PANEL}>
                  {timer}{' '}
                </Text>
              ) : null}
            </Box>
            <Button key={`obl:${a.id}`} plain dimColor={r === 'next prompt'} label={lines[0] ?? ''} onPress={() => toggleIn($, `ob:${a.id}`)} />
            <Box flexGrow={1} />
            {list.length > 1 && <Button key={`up:${a.id}`} plain dimColor label=" ▲" onPress={() => void moveAction($, a.id, -1)} />}
            {list.length > 1 && <Button key={`down:${a.id}`} plain dimColor label=" ▼" onPress={() => void moveAction($, a.id, 1)} />}
            <Button key={`force:${a.id}`} plain label=" ⚡" onPress={() => void forceAction($, a.id)} />
            <Button key={`drop:${a.id}`} plain label=" ✕ " onPress={() => void removeAction($, a.id)} />
          </Box>,
        )
        lines.slice(1).forEach((l, j) =>
          footRows.push(
            <Box key={`f:${a.id}:${j}`} backgroundColor={PANEL}>
              <Text backgroundColor={PANEL}>
                {'   '}
                {l}
              </Text>
            </Box>,
          ),
        )
        if (isOpen(`ob:${a.id}`))
          wordWrap(a.text, width - 5).forEach((l, j) =>
            footRows.push(
              <Box key={`f:${a.id}:p${j}`} backgroundColor={PANEL}>
                <Text dimColor backgroundColor={PANEL}>
                  {'   │ '}
                  {l}
                </Text>
              </Box>,
            ),
          )
      }
    }
    if (isOpen('activity'))
      for (const a of sent.slice(0, 6)) {
        const tail = a.status === 'sent' ? ` ${span(now - a.at)} ` : ' ✗ '
        footRows.push(
          <Box key={`f:s:${a.id}`} backgroundColor={PANEL}>
            <Text color={a.status === 'sent' ? TONE.green.fg : TONE.red.fg} backgroundColor={PANEL}>
              {a.status === 'sent' ? ' ✓ ' : ' ✗ '}
            </Text>
            <Text dimColor backgroundColor={PANEL}>
              {wordWrap(a.label, Math.max(8, width - 4 - glen(tail)))[0]}
            </Text>
            <Box flexGrow={1} />
            <Text dimColor backgroundColor={PANEL}>
              {tail}
            </Text>
          </Box>,
        )
      }
    const footH = footRows.length
    const scroll = e.props.scroll
    const footTop = Math.max(0, scroll.offset + scroll.bodyRows - footH)
    const activity = (
      <Box key="activity" position="absolute" top={footTop} left={0} width={width} flexDirection="column" overflow="hidden" backgroundColor={PANEL}>
        {footRows}
      </Box>
    )

    const sync = (
      <Box key="sync" marginTop={1} marginBottom={1}>
        {pill('sync:state', `${syncLine.glyph} ${syncLine.text}`, syncLine.tone, true)}
        {map ? (
          <Box flexShrink={0}>
            <Text dimColor>{` ◷ ${span(now - Math.max(map.at, map.reconciledAt ?? 0, checkedAt))}`}</Text>
          </Box>
        ) : null}
        <Box flexGrow={1} flexShrink={1}>
          {syncLine.detail ? (
            <Text dimColor wrap="wrap">
              {'  '}
              {syncLine.detail}
            </Text>
          ) : null}
        </Box>
        {!isRefreshing && pillBtn('sync:refresh', syncLine.canRefresh ? '↻ update' : '↻', syncLine.canRefresh ? 'cyan' : 'dim', () => wantRefresh())}
      </Box>
    )

    return (
      <Box flexDirection="column" width={width} minHeight={e.props.scroll.bodyRows}>
        <Box flexDirection="column" paddingBottom={footH}>
          {header}
          {sync}
          {body}
          {lastError && (
            <Text color="yellow" dimColor>
              △ {lastError}
            </Text>
          )}
        </Box>
        {activity}
      </Box>
    )
  })
}
