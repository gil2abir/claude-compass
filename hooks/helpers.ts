// Pure helpers: text, parsing the chart, the course ("now"), the row under the prompt, the task
// board, the grill's frontier and rounds, the grilling and STE guides. No engine calls, no state.

import { read, update } from 'claude-code'
import type { CompassAlt, CompassAgentTodo, CompassGrillQ, CompassLane, CompassMap, CompassMilestone, CompassState, CompassStep, CompassTask } from '../types'
import { GRILL_TOOL, TONE } from './kit'
import type { Tone } from './kit'

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
export const graphemes = (text: string): string[] => {
  try {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), g => g.segment)
  } catch {
    return Array.from(text)
  }
}

export const clip = (text: string, n: number) => {
  const g = graphemes(text)
  return g.length > n ? `${g.slice(0, Math.max(1, n - 1)).join('')}…` : text
}

export const clipLeft = (text: string, n: number) => {
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

export const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  return `${(s / 3600).toFixed(1)}h`
}

export const kfmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)

export const str = (v: unknown, n: number) => (typeof v === 'string' ? clip(plain(v), n) : '')

export const strs = (v: unknown, max: number, n: number) =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && plain(x) !== '').slice(0, max).map(x => clip(plain(x), n))

export const objs = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : []

export const oneOf = <T extends string>(v: unknown, all: readonly T[], fallback: T): T =>
  all.includes(v as T) ? (v as T) : fallback

export const STATES = ['done', 'active', 'pending', 'abandoned', 'blocked'] as const
export const KINDS = ['step', 'attempt', 'decision', 'aside'] as const
export const LANES = ['now', 'next', 'later', 'done'] as const

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

export type GrillDraft = Pick<CompassGrillQ, 'id' | 'title' | 'body' | 'options' | 'rec' | 'dependsOn' | 'mode' | 'from' | 'blocking'>

export const grillDrafts = (v: unknown, fallbackMode: 'plan' | 'work'): GrillDraft[] =>
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

/** The agent's own course from its TodoWrite list: the item in progress, then the next pending one. */
export const todoCourse = (todos: readonly CompassAgentTodo[]): { now: string; next: string } | null => {
  const doing = todos.find(t => t.status === 'in_progress')
  if (!doing) return null
  const after = todos.slice(todos.indexOf(doing) + 1).find(t => t.status === 'pending') ?? todos.find(t => t.status === 'pending')
  return { now: clip(plain(doing.text), 60), next: after ? clip(plain(after.text), 60) : '' }
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

export const glen = (t: string) => graphemes(t).length

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

export const BAR_CELLS = 5
export const partWidth = (x: HintPart) => (x.bar !== undefined ? BAR_CELLS : glen(x.text ?? ''))

/**
 * The row under the prompt as one panel of chips, after the reference: the course in one chip
 * (✓ last │ ● now │ ○ next), step progress in another, then what needs the user. When room runs
 * short, parts leave from inside a chip first (last step, next step, long labels), then whole
 * chips by priority, so every chip stays one unit. `room` counts the panel's own padding.
 */
export const hintChips = (map: CompassMap | null, asks: number, queued: number, room: number, incoming: string | null = null, blocking = 0, hasTurns = false, doing: { now: string; next: string } | null = null): HintChip[] => {
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
  // the agent's TodoWrite item in progress is "now" with no model call; a new request comes first
  const nowText = plain(incoming ?? doing?.now ?? step?.label ?? milestone?.label ?? '')
  const ahead = plain(incoming ? 'updating…' : (doing ? doing.next || upcoming : upcoming) ?? '')
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

export const ROUND_TAIL = 'These settle the decisions above.'
export const RELEASE_TAIL = ' · RELEASED: this was blocking; continue the work that waited on it.'
export const HOLD_TAIL = ' · BLOCKING again: stop the work that depends on it until its answer comes.'

/** One round's answers, in the grilling shape the agent reads back. */
export const roundMessage = (round: number, handled: CompassGrillQ[]) =>
  [
    `🧭 [compass grill · round ${round} — answers from the user]`,
    ...handled.map(q =>
      q.state === 'followup'
        ? `❓ Q${q.n} (${q.id}) ${q.title} → FOLLOW-UP from the user: "${q.followups[q.followups.length - 1] ?? ''}". Keep it open: answer the follow-up, then re-ask it with ${GRILL_TOOL} (same id) with a clarified body.`
        : `❓ Q${q.n} (${q.id}) ${q.title} → ${q.answer}${q.blocking ? RELEASE_TAIL : ''}`,
    ),
    `${ROUND_TAIL} Recompute the frontier and post the next round with the grill tool, or askConfirm when the frontier is empty. Look facts up yourself; do not act on a plan before the user confirms.`,
  ].join('\n')

/**
 * A compass turn as the transcript draws it: the brief and the instructions meant for the model
 * left out, the release marks short. Display only: the model reads the stored text whole.
 */
export const compactRow = (text: string) => {
  const cut = text.indexOf('🧭 [compass brief · rev')
  return (cut >= 0 ? text.slice(0, cut) : text)
    .split('\n')
    .filter(l => !l.startsWith(ROUND_TAIL))
    .join('\n')
    .split(RELEASE_TAIL).join(' · released')
    .split(HOLD_TAIL).join(' · holds')
    .trim()
}

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

export const GRILL_GUIDE = `# Compass grill — ask the user asynchronously
The user answers your questions in the compass pane's grill tab while you work. Use the ${GRILL_TOOL} tool, following the grilling method:
- Keep a design tree of the decisions in play: when planning, and whenever several options are on the table for work in progress.
- Work in rounds. The frontier is every decision whose prerequisites are settled. Post the whole frontier in one call: each question with a stable id, a short title, a body with the choices, and your recommended answer. A question that depends on another still-open one waits for a later round (or name it in dependsOn).
- Facts are your job: read files, run tools, dispatch sub-agents rather than asking. Decisions are the user's: never answer them yourself.
- Do not block: after posting, continue only with work that does not depend on the open answers, else end your turn. Answers arrive as a user message (into the running turn, or as a new turn), one round at a time.
- A follow-up keeps its question open: answer it, then re-ask the question with the same id and a clarified body.
- When the frontier is empty, call the tool with askConfirm; do not act on a plan until the user confirms the shared understanding.
- Mark each question blocking: true only when work truly waits on it; otherwise blocking: false and keep working on your recommendation, ready to adjust when the answer comes.
- Blocking is a handshake: compass acknowledges each blocking question ("ACK BLOCKING"). Then stop all work that depends on it; if nothing else is left, end your turn. Continue only after compass releases it ("RELEASED": an answer, a park or a dismissal), which reaches you at once. "BLOCKING again" means it holds once more.
- Keep checking as the work moves: new goals, ideas, trade-offs, or second-order effects down the road that the user should decide or know about are new questions.
- The user answers what they want, when they want, in any order. A parked question means: do not wait for it and do not ask again now; proceed with your recommendation and keep it open. A dismissed question is dropped.
- Write each title, body, option and recommendation in ASD-STE100 Simplified Technical English: short active sentences (max 20 words), common words with one meaning, titles of at most 5 words; keep names, paths and commands exact.`

export const words = (t: string) => new Set(t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2))

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
