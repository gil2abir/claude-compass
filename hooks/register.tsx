import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelForkResult, Register } from 'claude-code'

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
const PANEL = '#232427'
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

/** A level as a smooth bar `cells` wide: whole blocks, then an eighth-block edge. */
export const barText = (frac: number, cells: number) => {
  const f = Math.max(0, Math.min(1, Number.isFinite(frac) ? frac : 0)) * cells
  const full = Math.floor(f)
  const part = Math.round((f - full) * 8)
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

/** Handlers of the pill buttons drawn this render, by key: a pill's 'press' post runs its own. */
const presses = new Map<string, () => unknown>()

/** How long every new item waits in the outbox, so it can still be reordered or removed. */
const SEND_GRACE_MS = 8000

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

// Text-presentation symbols only (no emoji), one per tab subject.
const TABS: { id: CompassTab; icon: string; label: string }[] = [
  { id: 'flow', icon: '├', label: 'flow' },
  { id: 'tasks', icon: '☑', label: 'tasks' },
  { id: 'grill', icon: '?', label: 'grill' },
  { id: 'chat', icon: '⇄', label: 'chat' },
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
    const next = row ? `${row} ${word}` : word
    if (graphemes(next).length > w) {
      rows.push(row)
      row = word
    } else row = next
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

type GrillDraft = Pick<CompassGrillQ, 'id' | 'title' | 'body' | 'options' | 'rec' | 'dependsOn' | 'mode' | 'from'>

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
    }))

/** Coerces a fork reply into a CompassMap, plus any decisions it inferred for the grill. */
export const parseMap = (text: string, at: number): (CompassMap & { grill: GrillDraft[] }) | null => {
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
  return { goal: str(o.goal, 60), milestones, tasks, recap: strs(o.recap, 7, 140), at, alt, grill: grillDrafts(o.grill, 'work') }
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
  return { milestone, step, next: nextStep?.label ?? nextMilestone?.label }
}

/** `goal › milestone › [step] → next`, clipped from the left so "now" survives. */
export const crumb = (map: CompassMap | null, width: number) => {
  if (!map) return 'charting…'
  const { milestone, step, next } = locate(map)
  const head = [map.goal, milestone?.label ?? ''].filter(Boolean).map(plain).join(' › ')
  const here = step ? ` › [${plain(step.label)}]` : ''
  const tail = next ? ` → ${plain(next)}` : ''
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
  const { milestone, step, next } = locate(map)
  const steps = (milestone?.steps ?? []).filter(s => s.kind !== 'aside')
  const here = step ? steps.indexOf(step) : -1
  const pastStep = [...(here >= 0 ? steps.slice(0, here) : steps)].reverse().find(s => s.state === 'done')
  const pastMilestone = [...map.milestones].reverse().find(m => m.state === 'done')
  const isBlocked = step?.state === 'blocked'
  let past = plain(pastStep?.label ?? pastMilestone?.label ?? '')
  let now = plain(step?.label ?? milestone?.label ?? '')
  let ahead = plain(next ?? '')
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
  const settled = new Set(items.filter(q => q.state === 'settled').map(q => q.id))
  const isReady = (q: CompassGrillQ) => q.dependsOn.every(d => !ids.has(d) || settled.has(d))
  const live = items.filter(q => q.state !== 'settled')
  return {
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
    const same = list.find(q => q.id === d.id) ?? (source === 'map' ? list.find(q => q.title.toLowerCase() === d.title.toLowerCase()) : undefined)
    if (same) {
      if (source === 'map') continue
      list = list.map((q): CompassGrillQ => (q === same ? { ...q, ...d, topic: topic || q.topic, state: q.state === 'settled' ? 'settled' : 'open', answer: q.state === 'settled' ? q.answer : '', at } : q))
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

const GRILL_GUIDE = `# Compass grill — ask the user asynchronously
The user answers your questions in the compass pane's grill tab while you work. Use the ${GRILL_TOOL} tool, following the grilling method:
- Keep a design tree of the decisions in play: when planning, and whenever several options are on the table for work in progress.
- Work in rounds. The frontier is every decision whose prerequisites are settled. Post the whole frontier in one call: each question with a stable id, a short title, a body with the choices, and your recommended answer. A question that depends on another still-open one waits for a later round (or name it in dependsOn).
- Facts are your job: read files, run tools, dispatch sub-agents rather than asking. Decisions are the user's: never answer them yourself.
- Do not block: after posting, continue only with work that does not depend on the open answers, else end your turn. Answers arrive as a new user turn, one round at a time.
- A follow-up keeps its question open: answer it, then re-ask the question with the same id and a clarified body.
- When the frontier is empty, call the tool with askConfirm; do not act on a plan until the user confirms the shared understanding.`

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
    '{"goal":s,"milestones":[{"id":s,"label":s,"state":"done|active|pending|abandoned","why":s,"steps":[{"id":s,"label":s,"kind":"step|attempt|decision|aside","state":"done|active|pending|abandoned|blocked","why":s}]}],"tasks":[{"id":s,"text":s,"lane":"now|next|later|done","by":"agent|user","from":s}],"recap":[s],"alt":{"label":s,"why":s,"steps":[s]}|null,"grill":[{"id":s,"title":s,"body":s,"options":[s],"recommendation":s,"dependsOn":[s],"from":s}]}',
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
    '- grill: ONLY decisions the session is waiting on from the user that are NOT already in the grill list below (usually []). Frontier only: nothing that depends on an unanswered question. ≤3, each with a recommendation.',
    prev ? `Previous map — keep ids stable: ${JSON.stringify({ m: prev.milestones.map(m => [m.id, m.label, m.state]), t: prev.tasks.map(t => [t.id, t.text, t.lane, t.by]) })}` : '',
    todos.length ? `Agent TodoWrite list (ground truth for task status): ${JSON.stringify(todos.map(t => `${t.status}: ${t.text}`))}` : '',
    userTasks.length ? `User-added tasks (by "user"): ${JSON.stringify(userTasks)}` : '',
    steers.length ? `User steering directives, newest last — reflect them in pending steps: ${JSON.stringify(steers)}` : '',
    btw.length ? `User /btw side questions this session (kind aside): ${JSON.stringify(btw)}` : '',
    prev?.declined?.length
      ? `Forks the user already decided (both the chosen and the other side): never offer these, or their reverse, as alt again, even while the work waits on an event or a decision: ${JSON.stringify(prev.declined)}`
      : '',
    grill.length ? `Grill list already tracked (do not repeat): ${JSON.stringify(grill.map(q => [q.id, q.title, q.state]))}` : '',
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
let transcriptPath = ''

/** Where Claude Code keeps this session: the transcript the classic hooks name, else its standard place. */
async function sessionDir($: EngineInterface) {
  if (transcriptPath) return transcriptPath.replace(/\.jsonl$/, '')
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('HOME')) ?? ''}/.claude`
  const slug = (await $.session.root()).replace(/[^a-zA-Z0-9]/g, '-')
  return `${config}/projects/${slug}/${await $.session.id()}`
}

const noteTranscript = (path: unknown) => {
  if (typeof path === 'string' && path.endsWith('.jsonl')) transcriptPath = path
}

const snapPath = async ($: EngineInterface) => `${await sessionDir($)}/compass/snapshot.json`

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
  await $.fs.write(await snapPath($), JSON.stringify({ ...snap, sessionId: id }))
}

/** Puts a saved compass back; null when this session has none. */
async function restore($: EngineInterface): Promise<Snap | null> {
  const id = await $.session.id()
  let snap: (Snap & { sessionId?: string }) | undefined
  try {
    snap = JSON.parse(await $.fs.read(await snapPath($))) as Snap & { sessionId?: string }
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

async function loadBtw($: EngineInterface) {
  try {
    const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('HOME')) ?? ''}/.claude`
    const id = await $.session.id()
    const text = await $.fs.read(`${dir}/history.jsonl`)
    const found: string[] = []
    for (const line of text.split('\n')) {
      if (!line.includes(id) || !line.includes('/btw')) continue
      try {
        const row = JSON.parse(line) as { display?: unknown; sessionId?: unknown }
        if (row.sessionId === id && typeof row.display === 'string' && row.display.startsWith('/btw ')) {
          found.push(clip(row.display.slice(5).trim(), 120))
        }
      } catch {
        // a torn line; skip it
      }
    }
    if (found.length) await update($, btwA, list => [...new Set([...list, ...found])].slice(-30))
  } catch {
    // no history file or not readable: live capture still works
  }
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

async function refresh($: EngineInterface) {
  if (inflight) return
  inflight = true
  lastRefreshAt = await $.clock.now()
  const startedAt = Date.now() - 1500
  // charted after its turn ended, a chart has the whole request in hand
  const isAfterTurn = !(await read($, busyA))
  await update($, refreshingA, () => true)
  try {
    await loadBtw($)
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
    let reply = await $.model.fork({ prompt })
    await countOwn($, reply)
    let map = reply.isAnswered ? parseMap(reply.text, await $.clock.now()) : null
    if (reply.isAnswered && !map) {
      // one retry, asking for less: the usual cause is a reply cut short
      reply = await $.model.fork({ prompt: `${prompt}\nYour previous reply was not valid JSON. Reply again with ONLY the JSON object, at most 1500 characters.` })
      await countOwn($, reply)
      map = reply.isAnswered ? parseMap(reply.text, await $.clock.now()) : null
    }
    if (!reply.isAnswered) {
      await update($, errorA, () => (reply.reason === 'nothing-to-fork' ? null : `map not updated (${reply.reason}); kept the last one`))
      return
    }
    if (!map) {
      await update($, errorA, () => "map not updated: the model's summary wasn't valid JSON; kept the last one · ↻ to retry")
      return
    }
    const { grill: inferred, ...next } = map
    const prevMap = isCurrent(stored) ? stored : null
    const latest = await read($, mapA)
    const declined = (isCurrent(latest) ? latest.declined : null) ?? prevMap?.declined ?? []
    const sameMilestone = prevMap && locate(prevMap).milestone?.id === locate(next).milestone?.id
    const kept = !next.alt && sameMilestone && prevMap.alt && !prevMap.altPick ? prevMap.alt : null
    const alt = (next.alt && !isDecided(next.alt, declined) ? next.alt : null) ?? kept
    await update($, mapA, () => ({ ...next, alt, declined, turns: turnsAt }))
    // the chart now includes the request the turn started on
    await update($, incomingA, inc => (inc && (isAfterTurn || inc.at <= startedAt) ? null : inc))
    if (inferred.length) {
      const at = await $.clock.now()
      await update($, grillA, list => mergeGrill(list, inferred, next.goal, 'map', at))
    }
    await update($, errorA, () => null)
    await update($, statsA, s => ({ ...s, refreshes: s.refreshes + 1 }))
    // user tasks the agent has adopted no longer need to be shown as queued
    await update($, userTasksA, list => list.filter(u => !next.tasks.some(t => t.text.toLowerCase().includes(u.text.toLowerCase().slice(0, 24)))))
  } catch (err) {
    await update($, errorA, () => `map not updated: ${err instanceof Error ? err.message.slice(0, 60) : 'failed'}`)
  } finally {
    inflight = false
    await update($, refreshingA, () => false)
  }
}

const LANES_ORDER = LANES
const ROUTE_GLYPH = { queued: '⋯', sent: '↗', rejected: '✗' } as const

async function setAction($: EngineInterface, id: string, patch: Partial<CompassAction>) {
  await update($, actionsA, list => list.map((a): CompassAction => (a.id === id ? { ...a, ...patch } : a)))
}

/** Writes into the running turn now; the model reads it at its next step. */
async function appendNow($: EngineInterface, a: CompassAction) {
  try {
    const r = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: a.text }] } })
    if ('deny' in r && r.deny) throw new Error(r.deny)
    await setAction($, a.id, { status: 'sent', route: 'running turn', at: Date.now() })
    $.ui.toast(`↗ sent into the running turn · ${clip(a.label, 50)}`)
  } catch (err) {
    await reject($, a, err)
  }
}

async function reject($: EngineInterface, a: CompassAction, err: unknown) {
  const reason = err instanceof Error ? err.message.slice(0, 60) : String(err).slice(0, 60)
  await setAction($, a.id, { status: 'rejected', reason, at: Date.now() })
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
    await setAction($, a.id, { route: 'next prompt' })
    $.ui.toast(`⋯ queued for your next prompt · ${clip(a.label, 44)}`)
    return
  }
  await setAction($, a.id, { route: kind === 'steer' && isBusy ? 'running turn' : 'new turn' })
  $.ui.toast(`⋯ sends in ${SEND_GRACE_MS / 1000}s · ${clip(a.label, 44)} · ✕ in the pane cancels`)
}

/** ⚡ send now: into the running turn, or as a turn of its own when idle. */
async function forceAction($: EngineInterface, id: string) {
  const a = (await read($, actionsA)).find(x => x.id === id)
  if (!a || a.status !== 'queued') return
  if (await read($, busyA)) return appendNow($, a)
  try {
    await setAction($, a.id, { status: 'sent', route: 'new turn', at: Date.now() })
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
  const next = [...list]
  next[i] = list[j]!
  next[j] = a
  return next
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
  const stored = await read($, mapA)
  const map = isCurrent(stored) ? stored : null
  const alt = map?.alt
  if (!map || !alt) return
  const { milestone } = locate(map)
  if (way === 'main') {
    const planned = milestone?.steps.filter(s => s.state === 'pending').map(s => s.label).join(' ') ?? ''
    await editMap($, mp => ({ ...mp, altPick: 'main', declined: [...(mp.declined ?? []), alt.label, alt.steps.join(' '), ...(planned ? [planned] : [])].slice(-16) }))
    const next = milestone?.steps.filter(s => s.state === 'pending').map(s => s.label) ?? []
    await queueNote($, `Stay on the planned course${next.length ? `: ${next.join(' → ')}` : ''}; not "${alt.label}"`)
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
  await update($, steersA, list => [...list, { text: t, at: Date.now() }].slice(-20))
  await enqueue($, 'steer', t, `🧭 [compass — steering from the user] ${t}\nRe-plan from here accordingly.`, 'alt', before)
}

/** Drops a queued item before it is sent, undoing what the pane did for it. */
async function removeAction($: EngineInterface, id: string) {
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
  const waiting = (await read($, actionsA)).filter(a => a.status === 'queued' && a.kind !== 'note')
  if (waiting.some(a => t - a.at < SEND_GRACE_MS) || (await read($, refreshingA))) await update($, tickA, n => n + 1)
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
  await update($, steersA, list => [...list, { text: t, at: Date.now() }].slice(-20))
  await enqueue($, 'steer', t, `🧭 [compass — steering from the user] ${t}\nAdjust the plan and your next steps accordingly from now on.`, ref, prev)
}

/** Quiet instruction: rides the user's next prompt, unless forced out with ⚡. */
async function queueNote($: EngineInterface, text: string, ref = '', prev = '') {
  await enqueue($, 'note', text, `🧭 [compass — task update from the user] ${text.trim()}`, ref, prev)
}

const LANE_NAME: Record<CompassLane, string> = { now: 'DOING', next: 'TO DO', done: 'DONE', later: 'BACKLOG' }

/** Moves a card (optimistically) and tells the agent; a rejection rolls it back. */
async function moveTask($: EngineInterface, id: string, lane: CompassLane) {
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
    const parts = row[3]!.split('·').map(x => x.trim())
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
    const r = await $.tool.call({ tool: 'ListAgents' } as never)
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
  try {
    const addr = (await read($, chatA)).findLast(m => m.peer === peer && m.addr)?.addr
    const r = await $.session.send({ to: addr ?? peer, text: t })
    const isOk = r.isDelivered === true
    await update($, chatA, list => [...list, { peer, dir: 'out' as const, text: t, at, status: isOk ? ('sent' as const) : ('rejected' as const) }].slice(-200))
    $.ui.toast(isOk ? `↗ sent to ${peer}` : `✗ not delivered to ${peer} · ${r.reason ?? ''}`)
  } catch (err) {
    await update($, chatA, list => [...list, { peer, dir: 'out' as const, text: t, at, status: 'rejected' as const }].slice(-200))
    $.ui.toast(`✗ rejected · ${peer} · ${err instanceof Error ? err.message.slice(0, 60) : 'failed'}`)
  }
}

async function addUserTask($: EngineInterface, text: string) {
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

/** Drops a question that no longer matters; the agent hears it with the next prompt, and it is not asked again. */
async function dismissGrill($: EngineInterface, id: string) {
  const q = (await read($, grillA)).find(x => x.id === id)
  if (!q || q.state === 'settled') return
  await update($, grillA, list => list.map((x): CompassGrillQ => (x.id === id ? { ...x, state: 'settled', answer: 'dismissed' } : x)))
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
    await $.tool
      .register({
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
              },
              required: ['id', 'title', 'body', 'recommendation'],
            },
          },
          settle: { type: 'array', items: { type: 'string' }, description: 'Ids that became moot or were settled elsewhere' },
          askConfirm: { type: 'boolean', description: 'The frontier is empty: ask the user to confirm the shared understanding' },
        },
      },
    })
      .catch(() => $.ui.toast('compass: the grill tool could not be registered'))
    const now = await $.clock.now()
    await update($, statsA, s => (s.startedAt ? s : { ...s, startedAt: now }))
    await update($, busyA, () => false)
    await update($, refreshingA, () => false)
    await loadBtw($)
    $.ui.status(undefined)
    // resume: reopen the saved chart; chart afresh only when there is none,
    // or the transcript moved on while compass was not watching
    if (!isCurrent(await read($, mapA))) {
      const snap = await restore($).catch(() => null)
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
    $.clock.every(1000, async () => {
      if (++ticks % 5 === 0) void snapshot($).catch(() => undefined)
      if ((await read($, tabA)) === 'chat' && Date.now() - (await read($, peersAtA)) > 15_000) void refreshPeers($)
      void flushOutbox($).catch(() => undefined)
      if (inflight) return
      // during a long turn: chart once the new prompt is in, then every few minutes
      if (!isWanted && turnStartedAt && (await read($, busyA))) {
        const t = await $.clock.now()
        const since = t - Math.max(turnStartedAt, lastRefreshAt)
        if ((lastRefreshAt < turnStartedAt && t - turnStartedAt > MID_TURN_FIRST_MS) || since > MID_TURN_EVERY_MS) isWanted = true
      }
      if (!isWanted) return
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
    const text = `Posted to the user's compass grill tab: ${ask.length} on the frontier, ${waiting.length} waiting on prerequisites${input.askConfirm === true ? ', plus a confirmation request' : ''}. Do not wait: continue only with work that does not depend on these decisions, or end your turn. The answers arrive as a new user turn.`
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
        await $.fs.write(await snapPath($), JSON.stringify({ v: SNAP_VERSION, cleared: true }))
      } catch {
        // no session folder to mark: nothing to restore from either
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
      const now = await $.clock.now()
      await update($, statsA, () => ({ ...EMPTY_STATS, startedAt: now }))
    }
    return next(e)
  })

  // Claude Code's own hook events name the transcript: the snapshot lives beside it
  on('classic.SessionStart', (_$, e, next) => {
    noteTranscript(e.transcript_path)
    return next(e)
  })
  on('classic.UserPromptSubmit', (_$, e, next) => {
    noteTranscript(e.transcript_path)
    return next(e)
  })
  on('classic.Stop', (_$, e, next) => {
    noteTranscript(e.transcript_path)
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
      await update($, chatA, list => [...list, { peer, dir: 'in' as const, text: clip(bodyOf(e.text), 600), at: Date.now(), status: 'received' as const, addr }].slice(-200))
      if (kind !== 'bridge' || from.name) $.ui.toast(`◂ inbound from ${peer}`)
    }
    return next(e)
  })

  // the model's own SendMessage calls: the outbound half of each thread (the pane's sends log themselves)
  on('session.send', async ($, e, next) => {
    const sent = await next(e)
    if (e.origin?.kind === 'model' && !e.agentId) {
      const isOk = sent.isDelivered === true
      await update($, chatA, list => [...list, { peer: peerKey(e.to, list), dir: 'out' as const, text: clip(e.text.trim(), 600), at: Date.now(), status: isOk ? ('sent' as const) : ('rejected' as const) }].slice(-200))
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
    const note = `🧭 Compass — updates the user made in the compass pane since last turn (user-added tasks come first):\n${pending.map(a => `- ${a.label}`).join('\n')}`
    return next({ ...e, context: [...(e.context ?? []), note] })
  })

  // ── keep the map current ──

  on('turn.start', async ($, e, next) => {
    turnStartedAt = await $.clock.now()
    await update($, busyA, () => true)
    // instant and free: the new request shows as "now" before any model call
    const request = plain(e.text.replace(/<[^>]+>/g, ' ').replace(/^🧭\s*\[compass[^\]]*\]\s*/u, ''))
    // the user's own request only: a turn compass submitted is already in the outbox as sent
    const isOwn = /\[compass\b|^the compass plugin sent a message/i.test(e.text)
    if (request && !e.text.startsWith('<') && !isOwn) await update($, incomingA, () => ({ text: clip(request, 80), at: Date.now() }))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    const now = await $.clock.now()
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
    if (!e.isAborted) wantRefresh()
    return done
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const name = String(e.tool)
    const input = e as unknown as Record<string, unknown>
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
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    const Client = 'Client' in els ? els.Client : null
    const stored = await read($, mapA)
    const map = isCurrent(stored) ? stored : null
    const asks = frontierOf(await read($, grillA)).ask.length
    const queued = (await read($, actionsA)).filter(a => a.status === 'queued').length
    const isRefreshing = await read($, refreshingA)
    await read($, tickA)
    const now = await $.clock.now()
    // progress through the active milestone, drawn as a small bar
    const { milestone } = locate(map)
    const steps = (milestone?.steps ?? []).filter(s => s.kind !== 'aside')
    const done = steps.filter(s => s.state === 'done').length
    const hasBar = steps.length > 1
    // the engine's own hint keeps its room; the gist takes what is left, never wrapping
    const columns = e.viewport?.columns ?? 100
    const hint = glen(e.props.hint ?? '')
    const budget = Math.max(24, columns - hint - 6 - (hasBar ? 8 : 0) - 6)
    const incoming = await read($, incomingA)
    const parts = gist(map, asks, queued, budget, incoming?.text ?? null)
    const text = {
      past: { color: TONE.green.fg, dim: true },
      now: { color: '#e6e6e6', bold: true },
      blocked: { color: TONE.red.fg, bold: true },
      next: { dim: true },
      sep: { dim: true },
    } as const
    const PILL = { ask: 'yellow', need: 'red', queue: 'gray' } as const
    const engine = await next(e)
    const spin = isRefreshing ? SPIN[Math.floor(now / 120) % SPIN.length] : ''
    // the engine's own node may only sit under a Box with no props
    return (
      <Box>
        <Box flexShrink={0}>
          {/* a Button draws one engine colour: where a Client can be drawn, the gold brand is one and takes the click */}
          {Client ? (
            <Client key="compass-crumb" module="./brand.tsx" props={{ color: GOLD, bg: TONE.gold.bg, spin }} />
          ) : (
            <Button key="compass-crumb" plain label={parts[0]!.text} onPress={() => void togglePane($)} />
          )}
          {hasBar ? (
            <Text key="g:bar">
              {' '}
              <Text color={TONE.green.fg} backgroundColor={TRACK}>
                {barText(done / steps.length, 5)}
              </Text>
              <Text dimColor>{` ${done}/${steps.length}`}</Text>
            </Text>
          ) : null}
          {parts.slice(1).map((p, i) => {
            if (p.tone === 'brand') return null
            // the bar already shows where in the milestone the work is
            if (hasBar && /^● step \d+\/\d+$/.test(p.text)) return null
            if (p.tone === 'ask' || p.tone === 'need' || p.tone === 'queue') {
              const t = TONE[PILL[p.tone]]
              return (
                <Text key={`g:${i}`} color={t.fg} backgroundColor={t.bg} bold>
                  {` ${p.text} `}
                </Text>
              )
            }
            const t: { color?: string; bold?: boolean; dim?: boolean } = text[p.tone]
            return (
              <Text key={`g:${i}`} color={t.color} bold={t.bold} dimColor={t.dim} wrap="truncate-end">
                {p.text}
              </Text>
            )
          })}
        </Box>
        <Text dimColor>{'   '}</Text>
        {engine}
      </Box>
    )
  })

  // ── the pane ──

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Input = 'Input' in els ? els.Input : null
    const width = Math.max(28, e.props.bodyColumns)
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
    const openPeer = tab === 'chat' && selected?.startsWith('p:') ? selected.slice(2) : null
    const unreadOf = (name: string) => (name === openPeer ? 0 : chat.filter(m => m.peer === name && m.dir === 'in' && m.at > (chatSeen[name] ?? 0)).length)
    const unreadAll = [...new Set(chat.map(m => m.peer))].reduce((n, p) => n + unreadOf(p), 0)
    const Client = 'Client' in els ? els.Client : null
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
      return Client ? (
        <Box key={`${key}:box`} flexShrink={0}>
          <Client key={key} module="./pill.tsx" props={{ label, fg: TONE[tone].fg, bg: TONE[tone].bg, isOn }} />
        </Box>
      ) : (
        <Button key={key} plain dimColor={!isOn} label={label} onPress={() => void onPress()} />
      )
    }
    const spin = SPIN[Math.floor(now / 120) % SPIN.length]!

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
            {pillBtn('refresh', isRefreshing ? spin : '↻', isRefreshing ? 'cyan' : 'dim', () => wantRefresh())}
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
      const why = (s.state === 'abandoned' || s.kind === 'decision') && s.why ? ` · ${s.why}` : ''
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

    // ── tabs ──
    let body: ReturnType<typeof h>

    if (tab === 'flow') {
      const ms = map?.milestones ?? []
      const { milestone: active, step } = locate(map)
      const rows: ReturnType<typeof h>[] = []
      for (const m of ms) {
        const isActive = m === active
        const mk = STEP_MARK[m.state]
        const isUnfolded = isActive || isOpen(`m:${m.id}`)
        const count = m.steps.length
        const msRow = wrapped(
          `msbtn:${m.id}`,
          `${m.label}${m.state === 'abandoned' && m.why ? ` · ${m.why}` : ''}${!isActive && count && isUnfolded ? '  ▾' : ''}`,
          width - 8,
          () => (isActive ? undefined : toggleIn($, `m:${m.id}`)),
          { dim: m.state === 'done' || m.state === 'abandoned' || m.state === 'pending' },
        )
        rows.push(
          <Box key={`ms:${m.id}`} flexDirection="column">
            <Box>
              <Text color={mk.color} dimColor={mk.dim} bold>
                {mk.glyph}{' '}
              </Text>
              {msRow.head}
              {!isActive && count && !isUnfolded ? <Text> </Text> : null}
              {!isActive && count && !isUnfolded ? pill(`msn:${m.id}`, `+${count}`, 'dim') : null}
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
                wordWrap(`${mark} ${it}`, colW - 4).map((l, j) => (
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
                {card('main', 'as planned', 'dim', '', future.slice(0, FUTURE_KEEP + 1).map(s => s.label), '○', () => pickTrajectory($, 'main'), '▶ keep')}
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

      const q = front.ask[0]
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
          {ms.length === 0 ? (
            art(
              'flow',
              isRefreshing && stats.turns > 0
                ? `⟲ replaying session · ${stats.turns} turns · ${Object.values(stats.tools).reduce((a, b) => a + b, 0)} tool calls…`
                : stats.turns === 0
                  ? 'charting starts after the first turn'
                  : isRefreshing
                    ? 'charting…'
                    : 'no map yet · press ↻ to replay the session',
            )
          ) : (
            <Box flexDirection="column">
              {rows}
            </Box>
          )}
          {(q || board.now.length > 0) && rule}
          {q && (
            <Box key="flow:q" flexDirection="column">
              {(() => {
                const w = wrapped('flow:qbtn', `${q.from ? `⇄${q.from} ` : ''}${q.title}${front.ask.length > 1 ? `  +${front.ask.length - 1} more` : ''}`, width - 9, async () => {
                  await update($, selectedA, () => `g:${q.id}`)
                  await update($, tabA, () => 'grill')
                })
                return [
                  <Box key="flow:qrow">
                    {pill('flow:qp', `? Q${q.n}`, 'yellow', true)}
                    <Text> </Text>
                    {w.head}
                  </Box>,
                  w.tail,
                ]
              })()}
            </Box>
          )}
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
            // the last steer that actually went in; a queued one waits in the outbox
            const held = new Set(actions.filter(a => a.status === 'queued' && a.kind === 'steer').map(a => a.label))
            const last = [...steers].reverse().find(x => !held.has(clip(x.text, 80)))
            return last ? (
              <Text dimColor wrap="wrap">
                ↪ {last.text}
              </Text>
            ) : null
          })()}
          {input('steer', '↪ steer the course…', 'steer', v => void steer($, v))}
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
      if (Client) {
        body = (
          <Box flexDirection="column" key="tasks">
            <Client
              key="board"
              module="./board.tsx"
              width={width}
              props={{
                wip: 3,
                selected: picked?.id ?? null,
                cards: all.map(t => ({ id: t.id, text: `${t.from ? `⇄${t.from} ` : ''}${t.text}`, lane: t.lane, by: t.by, isQueued: !!t.isQueued || queuedRefs.has(t.id) })),
              }}
            />
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
      const openThread = (name: string) => async () => {
        const latest = (await read($, chatA)).reduce((t, m) => (m.peer === name ? Math.max(t, m.at) : t), 0)
        await update($, chatSeenA, seen => ({ ...seen, [name]: Math.max(seen[name] ?? 0, latest) }))
        await update($, selectedA, s => (s === `p:${name}` ? null : `p:${name}`))
      }
      const lastLine = (name: string) => {
        const m = tally(name).last
        return m ? (
          <Text dimColor wrap="wrap">
            {'  '}
            {m.dir === 'in' ? '◂ ' : '▸ '}
            {leadOf(m.text, 80).lead}
          </Text>
        ) : null
      }
      const others = [...new Set(chat.map(m => m.peer))].filter(n => !peers.some(p => p.name === n))
      const dot = (status: string) => (/busy|running|working/i.test(status) ? 'green' : /idle/i.test(status) ? 'yellow' : 'red')
      const thread = sel ? chat.filter(m => m.peer === sel).slice(-30) : []
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
                  <Button key={`peer:${p.name}`} plain label={p.name} onPress={openThread(p.name)} />
                </Box>
                <Box flexGrow={1} />
                {pill(`pk:${p.id}`, `${p.kind}${p.status ? ` · ${p.status}` : ''}`, 'dim')}
                {counts(p.name)}
              </Box>
              {p.group && /remote/i.test(p.group) ? <Text dimColor>{'  '}{p.group}</Text> : null}
              {lastLine(p.name)}
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
            </Box>
          ))}
          {sel && (
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
                const stamp = `${isNew ? '●' : ' '}${arrow} ${ago(now - m.at).padStart(4)} `
                const w = wrapped(`b:${key}`, `${isFull ? plain(m.text) : lead}${hasMore ? (isFull ? ' ▾' : ' ▸') : ''}`, width - glen(stamp) - 2, () => (hasMore ? toggleIn($, key) : undefined), {
                  dim: m.dir === 'out',
                  indent: glen(stamp),
                })
                return (
                  <Box key={key} flexDirection="column">
                    <Box>
                      <Text color={m.dir === 'in' ? 'cyan' : m.status === 'rejected' ? 'red' : 'green'} bold>
                        {stamp.slice(0, -6)}
                      </Text>
                      <Text dimColor>{stamp.slice(-6)}</Text>
                      {w.head}
                    </Box>
                    {w.tail}
                  </Box>
                )
              })}
              {input(`chat:${sel}`, `message ${clip(sel, 20)}…`, 'send', v => void chatSend($, sel, v))}
            </Box>
          )}
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
              <Button key={`gdrop:${q.id}`} plain dimColor label="✕" onPress={() => void dismissGrill($, q.id)} />
            </Box>
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
              const isRec = q.rec !== '' && q.rec.toLowerCase().startsWith(o.toLowerCase().slice(0, 12))
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
                <Text color={color} bold>
                  {mark}{' '}
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
          {grill.length === 0 && !confirm ? (
            art('grill', 'no questions yet · the agent posts them while planning or choosing between options')
          ) : (
            <Box flexDirection="column">
              <Text>
                <Text color="yellow" bold>
                  round {round}
                </Text>
                <Text dimColor>
                  {' '}· {front.ask.length} to answer · {front.waiting.length} waiting · {front.settled.length} settled
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
    const WHEN = { 'running turn': ['↪', 'cyan'], 'new turn': ['⏭', 'yellow'], 'next prompt': ['✎', 'purple'], '': ['⋯', 'yellow'] } as const
    const footRows: ReturnType<typeof h>[] = []
    const groups = (['running turn', 'new turn', 'next prompt'] as const).filter(r => queued.some(a => a.route === r))
    const groupName = { 'running turn': 'into this turn', 'new turn': isBusy ? 'after this turn' : 'next turn', 'next prompt': 'with next prompt' } as const
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

    // is the chart caught up with the session? one line, always on top
    const behind = map && typeof map.turns === 'number' ? Math.max(0, stats.turns - map.turns) : 0
    const unseen = map ? actions.filter(a => a.status === 'sent' && a.at > map.at).length : 0
    const syncLine = ((): { tone: Tone; glyph: string; text: string; detail: string; canRefresh: boolean } => {
      if (isRefreshing) return { tone: 'cyan', glyph: spin, text: 'charting', detail: incoming ? incoming.text : '', canRefresh: false }
      if (!map) return { tone: 'dim', glyph: '◌', text: stats.turns ? 'no chart yet' : 'waiting for the first turn', detail: '', canRefresh: stats.turns > 0 }
      if (incoming) return { tone: 'yellow', glyph: '◌', text: 'new message not charted', detail: `${incoming.text}${isBusy ? ' · after this turn' : ''}`, canRefresh: !isBusy }
      if (behind) return { tone: 'yellow', glyph: '◌', text: `${behind} turn${behind > 1 ? 's' : ''} behind`, detail: '', canRefresh: true }
      if (unseen) return { tone: 'yellow', glyph: '◌', text: `${unseen} update${unseen > 1 ? 's' : ''} not charted`, detail: '', canRefresh: !isBusy }
      return { tone: 'green', glyph: '✓', text: 'in sync', detail: '', canRefresh: false }
    })()
    const sync = (
      <Box key="sync" marginTop={1} marginBottom={1}>
        {pill('sync:state', `${syncLine.glyph} ${syncLine.text}`, syncLine.tone, true)}
        {map ? (
          <Box flexShrink={0}>
            <Text dimColor>{` ◷ ${span(now - map.at)}`}</Text>
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
        {syncLine.canRefresh && pillBtn('sync:refresh', '↻ update', 'cyan', () => wantRefresh())}
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
