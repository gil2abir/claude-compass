import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelForkResult, Register } from 'claude-code'

import type {
  CompassAction,
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
  return { goal: str(o.goal, 60), milestones, tasks, recap: strs(o.recap, 7, 140), at, grill: grillDrafts(o.grill, 'work') }
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
  const brand: GistPart = { text: 'compass', tone: 'brand' }
  if (!map && !incoming) return [brand, { text: '  charting…', tone: 'past' }]
  if (!map) map = { goal: '', milestones: [], tasks: [], recap: [], at: 0 }
  const { milestone, step, next } = locate(map)
  const steps = milestone?.steps ?? []
  const here = step ? steps.indexOf(step) : -1
  const pastStep = [...(here >= 0 ? steps.slice(0, here) : steps)].reverse().find(s => s.state === 'done' && s.kind !== 'aside')
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
  // what needs the user, in words when there is room, in a glyph when there is not
  const isTight = budget < 60
  const right: GistPart[] = []
  if (isBlocked) right.push({ text: isTight ? '!' : '! needs you', tone: 'need' })
  if (asks) right.push({ text: isTight ? `?${asks}` : `? ${asks} to answer`, tone: 'ask' })
  if (queued && !isTight) right.push({ text: `${queued} queued`, tone: 'queue' })
  const rightLen = right.reduce((n, r) => n + glen(r.text) + 2, 0)
  // "compass  ✓ past › ● now › ○ next" — 9 cells of frame per shown step
  const room = () => budget - 7 - rightLen - (past ? 4 + 3 : 0) - (now ? 4 : 0) - (ahead ? 3 + 2 : 0)
  const fits = () => glen(past) + glen(now) + glen(ahead) <= room()
  const shrink = (t: string, floor: number) => (glen(t) > floor ? clip(t, Math.max(floor, glen(t) - 1)) : t)
  while (!fits() && (glen(past) > 8 || glen(ahead) > 8)) {
    if (glen(past) >= glen(ahead)) past = shrink(past, 8)
    else ahead = shrink(ahead, 8)
  }
  if (!fits()) past = ''
  if (!fits()) ahead = ''
  if (!fits()) now = clip(now, Math.max(4, room()))
  const parts: GistPart[] = [brand, { text: '  ', tone: 'sep' }]
  if (past) parts.push({ text: `✓ ${past}`, tone: 'past' }, { text: ' › ', tone: 'sep' })
  if (now) parts.push({ text: `● ${now}`, tone: isBlocked ? 'blocked' : 'now' })
  if (ahead) parts.push({ text: ' › ', tone: 'sep' }, { text: `○ ${ahead}`, tone: 'next' })
  for (const r of right) parts.push({ text: '  ', tone: 'sep' }, r)
  // last guard: never wider than the budget, cut from the active step's label
  const over = parts.reduce((n, p) => n + glen(p.text), 0) - budget
  if (over > 0) {
    const i = parts.findIndex(p => p.tone === 'now' || p.tone === 'blocked')
    if (i >= 0) parts[i] = { ...parts[i]!, text: clip(parts[i]!.text, Math.max(3, glen(parts[i]!.text) - over)) }
  }
  return parts
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
  for (const d of drafts) {
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
    '{"goal":s,"milestones":[{"id":s,"label":s,"state":"done|active|pending|abandoned","why":s,"steps":[{"id":s,"label":s,"kind":"step|attempt|decision|aside","state":"done|active|pending|abandoned|blocked","why":s}]}],"tasks":[{"id":s,"text":s,"lane":"now|next|later|done","by":"agent|user","from":s}],"recap":[s],"grill":[{"id":s,"title":s,"body":s,"options":[s],"recommendation":s,"dependsOn":[s],"from":s}]}',
    'Model = version tree + phase chunking:',
    '- goal: the session goal, ≤6 words.',
    '- milestones: 3-7 phases in order — done ones, exactly ONE active, then planned pending ones. abandoned = a dropped phase (why = reason ≤6 words).',
    '- steps (per milestone, chronological): ≤5 per done milestone (merge small ones). The active milestone holds exactly one step with state active (or blocked when waiting on the user), then planned pending steps.',
    '  kind step = committed work; attempt = exploratory try (done = adopted, abandoned = dead end, why = reason); decision = a choice that was made (why = rationale ≤8 words); aside = a /btw side question the user asked, placed where it was asked.',
    '- every label ≤5 words, verb first, no punctuation. why ≤8 words or "".',
    '- tasks: the running task list. KEEP every previous task id; move finished work to done; add newly revealed work; lane now ≤3, next ≤5, later = deferred ideas/backlog/follow-ups. User-added tasks keep by "user" and go to now unless finished.',
    '- recap: 3-6 bullets, ≤18 words each, what happened and where things stand.',
    '- from: when a task or grill question originated in another agent\'s or session\'s message, that sender\'s name; else "".',
    '- grill: ONLY decisions the session is waiting on from the user that are NOT already in the grill list below (usually []). Frontier only: nothing that depends on an unanswered question. ≤3, each with a recommendation.',
    prev ? `Previous map — keep ids stable: ${JSON.stringify({ m: prev.milestones.map(m => [m.id, m.label, m.state]), t: prev.tasks.map(t => [t.id, t.text, t.lane, t.by]) })}` : '',
    todos.length ? `Agent TodoWrite list (ground truth for task status): ${JSON.stringify(todos.map(t => `${t.status}: ${t.text}`))}` : '',
    userTasks.length ? `User-added tasks (by "user"): ${JSON.stringify(userTasks)}` : '',
    steers.length ? `User steering directives, newest last — reflect them in pending steps: ${JSON.stringify(steers)}` : '',
    btw.length ? `User /btw side questions this session (kind aside): ${JSON.stringify(btw)}` : '',
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

async function refresh($: EngineInterface) {
  if (inflight) return
  inflight = true
  lastRefreshAt = await $.clock.now()
  const startedAt = Date.now() - 1500
  await update($, refreshingA, () => true)
  try {
    await loadBtw($)
    await hydrate($)
    const stored = await read($, mapA)
    const prompt = mapPrompt(
      isCurrent(stored) ? stored : null,
      await read($, agentTodosA),
      (await read($, userTasksA)).map(u => u.text),
      (await read($, steersA)).slice(-6).map(s => s.text),
      await read($, btwA),
      await read($, grillA),
      (await read($, chatA)).filter(m => m.dir === 'in'),
    )
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
    await update($, mapA, () => next)
    // the chart now includes the request the turn started on
    await update($, incomingA, inc => (inc && inc.at <= startedAt ? null : inc))
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
  const a: CompassAction = { id: `a${Date.now()}${Math.floor(Math.random() * 1e4)}`, kind, label: clip(label.trim() || t, 80), text: t, status: 'queued', route: '', reason: '', at: Date.now(), ref, prev }
  await update($, actionsA, list => [...list, a].slice(-40))
  const isBusy = await read($, busyA)
  if (kind === 'steer' && isBusy) return appendNow($, a)
  if (kind === 'note') {
    await setAction($, a.id, { route: 'next prompt' })
    $.ui.toast(`⋯ queued for your next prompt · ${clip(a.label, 44)} · ⚡ in the pane sends it now`)
    return
  }
  await setAction($, a.id, { route: 'new turn' })
  $.ui.toast(isBusy ? `⋯ queued · goes out when this turn ends · ${clip(a.label, 40)}` : `↗ sending as a new turn · ${clip(a.label, 44)}`)
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

/** The poller's job: queued steers and turns go out together once the session is idle. */
async function flushOutbox($: EngineInterface) {
  if (await read($, busyA)) return
  const due = (await read($, actionsA)).filter(a => a.status === 'queued' && a.kind !== 'note')
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
async function steer($: EngineInterface, text: string) {
  const t = text.trim()
  if (!t) return
  await update($, steersA, list => [...list, { text: t, at: Date.now() }].slice(-20))
  await enqueue($, 'steer', t, `🧭 [compass — steering from the user] ${t}\nAdjust the plan and your next steps accordingly from now on.`)
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
  await update($, userTasksA, list => [...list, { id: `u${Date.now()}`, text: clip(t, 70), at: Date.now() }])
  await queueNote($, `New task added by the user — prioritize it next: ${t}`)
}

/** Packs the handled questions into one round; the poller sends it when the agent is idle. */
async function sendRound($: EngineInterface) {
  const items = await read($, grillA)
  const { handled } = frontierOf(items)
  if (!handled.length) return
  const round = await read($, grillRoundA)
  await enqueue($, 'turn', `grill round ${round}: ${handled.length} answer${handled.length > 1 ? 's' : ''}`, roundMessage(round, handled))
  const ids = new Set(handled.map(q => q.id))
  await update($, grillA, list => list.map((q): CompassGrillQ => (ids.has(q.id) ? { ...q, state: q.state === 'followup' ? 'sent' : 'settled' } : q)))
  await update($, grillRoundA, r => r + 1)
  await update($, selectedA, () => null)
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

  // the board posts moves and selections; its data is input to validate
  on('ui.message', async ($, e, next) => {
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
    if (request && !e.text.startsWith('<')) await update($, incomingA, () => ({ text: clip(request, 80), at: Date.now() }))
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
    const steers = await read($, steersA)
    const steering = steers.length
      ? `\n\n# Compass steering\nThe user steered this session via the compass pane. Honor these directives (newest wins):\n${steers.slice(-6).map(s => `- ${s.text}`).join('\n')}`
      : ''
    return { sections: [...composed.sections, { id: 'compass', scope: 'session' as const, text: `${GRILL_GUIDE}${steering}` }] }
  })

  // ── the clickable compass in the hint line under the prompt ──

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const stored = await read($, mapA)
    const map = isCurrent(stored) ? stored : null
    const asks = frontierOf(await read($, grillA)).ask.length
    const queued = (await read($, actionsA)).filter(a => a.status === 'queued').length
    // the engine's own hint keeps its room; the gist takes what is left, never wrapping
    const columns = e.viewport?.columns ?? 100
    const hint = glen(e.props.hint ?? '')
    const budget = Math.max(24, columns - hint - 6)
    const incoming = await read($, incomingA)
    const parts = gist(map, asks, queued, budget, incoming?.text ?? null)
    const tone = {
      brand: { color: 'cyan', bold: true },
      past: { color: 'green', dim: true },
      now: { color: 'cyan', bold: true },
      blocked: { color: 'red', bold: true },
      next: { dim: true },
      sep: { dim: true },
      ask: { color: 'yellow', bold: true },
      need: { color: 'red', bold: true },
      queue: { dim: true },
    } as const
    const engine = await next(e)
    // the engine's own node may only sit under a Box with no props
    return (
      <Box>
        <Box flexShrink={0}>
          <Button key="compass-crumb" plain label={parts[0]!.text} onPress={() => void togglePane($)} />
          {parts.slice(1).map((p, i) => {
            const t: { color?: string; bold?: boolean; dim?: boolean } = tone[p.tone]
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

    // ── header ──
    const header = (
      <Box flexDirection="column" key="head">
        <Box justifyContent="space-between">
          <Text bold color="cyan" wrap="truncate-end">
            ◈ {map?.goal ? clip(map.goal, width - 14) : 'compass'}
          </Text>
          <Box columnGap={1}>
            <Text dimColor>{isRefreshing ? '↻' : map ? ago(now - map.at) : ''}</Text>
            <Button
              key="legend"
              label="key"
              plain
              dimColor={!isOpen('legend')}
              onPress={async () => {
                await update($, tabA, () => 'flow')
                await toggleIn($, 'legend')
              }}
            />
            <Button key="refresh" label="↻" plain hotkey="r" onPress={() => wantRefresh()} />
            <Button key="close" label="✕" plain role="dismiss" onPress={() => void togglePane($)} />
          </Box>
        </Box>
        <Box flexWrap="wrap" columnGap={2} marginTop={1}>
          {TABS.map(t => {
            const isOn = t.id === tab
            const badge = t.id === 'grill' && front.ask.length ? ` ${front.ask.length}` : t.id === 'chat' && unreadAll ? ` ●${unreadAll}` : ''
            return (
              <Box key={`tabbox:${t.id}`} flexDirection="column">
                <Box>
                  <Button key={`tabicon:${t.id}`} label={t.icon} plain dimColor={!isOn} onPress={() => update($, tabA, () => t.id)} />
                  <Text> </Text>
                  <Button key={`tab:${t.id}`} label={`${t.label}${badge}`} plain dimColor={!isOn} onPress={() => update($, tabA, () => t.id)} />
                  {t.id === 'chat' && <Text color={isRemote ? 'green' : 'red'}> ●</Text>}
                </Box>
                <Text color={isOn ? 'cyan' : undefined} dimColor={!isOn}>
                  {(isOn ? '━' : ' ').repeat(t.label.length + badge.length + 2 + (t.id === 'chat' ? 2 : 0))}
                </Text>
              </Box>
            )
          })}
        </Box>
      </Box>
    )

    // ── one graph row (accordion detail on click) ──
    const detail = (id: string, label: string, why: string, state: CompassState) => (
      <Box flexDirection="column" key={`detail:${id}`} paddingLeft={4}>
        {why ? <Text dimColor>↳ {why}</Text> : null}
        <Box columnGap={1} flexWrap="wrap">
          {state !== 'done' && state !== 'active' && (
            <Button key={`go:${id}`} plain label="▶ go" onPress={() => void steer($, `Switch focus now to: "${label}".`)} />
          )}
          {state !== 'done' && state !== 'abandoned' && (
            <Button
              key={`skip:${id}`}
              plain
              label="⤼ skip"
              onPress={async () => {
                await editMap($, mp => ({
                  ...mp,
                  milestones: mp.milestones.map(ms => ({ ...ms, steps: ms.steps.map(x => (x.id === id ? { ...x, state: 'abandoned', why: 'skipped by you' } : x)) })),
                }))
                await steer($, `Skip this, don't do it: "${label}".`)
              }}
            />
          )}
          {state === 'pending' && (
            <Button
              key={`later:${id}`}
              plain
              label="☐ later"
              onPress={async () => {
                await editMap($, mp => ({
                  ...mp,
                  milestones: mp.milestones.map(ms => ({ ...ms, steps: ms.steps.filter(x => x.id !== id) })),
                  tasks: [...mp.tasks, { id: `l${id}`, text: label, lane: 'later', by: 'user', from: '' }],
                }))
                await queueNote($, `Defer to the backlog, not now: ${label}`)
              }}
            />
          )}
          {state === 'abandoned' && (
            <Button key={`retry:${id}`} plain label="↺ retry" onPress={() => void steer($, `Revisit the dropped path: "${label}".`)} />
          )}
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
      return (
        <Box flexDirection="column" key={`step:${s.id}`}>
          <Box>
            <Text dimColor>{rail}</Text>
            <Text color={m.color} dimColor={m.dim} bold={isNow}>
              {m.glyph}{' '}
            </Text>
            <Button
              key={`node:${s.id}`}
              plain
              dimColor={s.state === 'done' || s.state === 'abandoned' || s.kind === 'aside'}
              label={clip(`${label}${why}`, room)}
              onPress={select(s.id)}
            />
            {isNow && (
              <Text color={s.state === 'blocked' ? 'red' : 'cyan'} bold>
                {' '}◀ now
              </Text>
            )}
          </Box>
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
        rows.push(
          <Box key={`ms:${m.id}`}>
            <Text color={mk.color} dimColor={mk.dim} bold>
              {mk.glyph}{' '}
            </Text>
            <Button
              key={`msbtn:${m.id}`}
              plain
              dimColor={m.state === 'done' || m.state === 'abandoned' || m.state === 'pending'}
              label={clip(`${m.label}${m.state === 'abandoned' && m.why ? ` · ${m.why}` : ''}${!isActive && count ? `  ${isUnfolded ? '▾' : `+${count}`}` : ''}`, width - 3)}
              onPress={() => (isActive ? undefined : toggleIn($, `m:${m.id}`))}
            />
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
                  <Text wrap="truncate-end">{c.text}</Text>
                </Box>
              ))}
            </Box>
          )}
          {incoming && (
            <Box key="incoming">
              <Text color="cyan" bold>
                ●{' '}
              </Text>
              <Text color="cyan" wrap="truncate-end">
                {incoming.text}
              </Text>
              <Text dimColor> · charting</Text>
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
              <Text color="cyan" wrap="truncate-start">
                {crumb(map, width)}
              </Text>
              {rule}
              {rows}
            </Box>
          )}
          {(q || board.now.length > 0) && rule}
          {q && (
            <Box key="flow:q">
              <Text color="yellow" bold>
                ?{' '}
              </Text>
              <Button
                key="flow:qbtn"
                plain
                label={clip(`Q${q.n} ${q.from ? `⇄${q.from} ` : ''}${q.title}${front.ask.length > 1 ? `  +${front.ask.length - 1} more` : ''}`, width - 2)}
                onPress={async () => {
                  await update($, selectedA, () => `g:${q.id}`)
                  await update($, tabA, () => 'grill')
                }}
              />
            </Box>
          )}
          {board.now.length > 0 && (
            <Box key="flow:t">
              <Text color="cyan">☐ </Text>
              <Button
                key="flow:tbtn"
                plain
                label={clip(`now: ${board.now[0]!.from ? `⇄${board.now[0]!.from} ` : ''}${board.now[0]!.text}${board.next.length ? ` · next ${board.next.length}` : ''}${board.later.length ? ` · later ${board.later.length}` : ''}`, width - 2)}
                onPress={() => update($, tabA, () => 'tasks')}
              />
            </Box>
          )}
          {step?.state === 'blocked' && <Text color="red">! waiting on you</Text>}
          {steers.length > 0 && <Text dimColor wrap="truncate-end">↪ {steers[steers.length - 1]!.text}</Text>}
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
            <Box>
              <Text color={color} dimColor={t.lane === 'later'}>
                {glyph}{' '}
              </Text>
              <Button
                key={`tbtn:${t.id}`}
                plain
                dimColor={isDone || t.lane === 'later'}
                label={clip(`${t.by === 'user' ? '★ ' : ''}${t.from ? `⇄${t.from} ` : ''}${isDone ? `~${t.text}~` : t.text}${t.isQueued ? '  ⋯' : ''}`, width - 2)}
                onPress={select(`t:${t.id}`)}
              />
            </Box>
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
                <Text wrap="truncate-end" bold>
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
          <Text>
            {fresh ? <Text color="yellow" bold> ● {fresh} new</Text> : null}
            {c.inn ? <Text color="cyan"> ◂{c.inn}</Text> : null}
            {c.out ? <Text color="green"> ▸{c.out}</Text> : null}
          </Text>
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
          <Text dimColor wrap="truncate-end">
            {'  '}
            {m.dir === 'in' ? '◂ ' : '▸ '}
            {clip(plain(m.text), width - 6)}
          </Text>
        ) : null
      }
      const others = [...new Set(chat.map(m => m.peer))].filter(n => !peers.some(p => p.name === n))
      const dot = (status: string) => (/busy|running|working/i.test(status) ? 'green' : /idle/i.test(status) ? 'yellow' : 'red')
      const thread = sel ? chat.filter(m => m.peer === sel).slice(-30) : []
      body = (
        <Box flexDirection="column" key="chat">
          <Box justifyContent="space-between">
            <Text>
              <Text color={isRemote ? 'green' : 'red'} bold>
                ●{' '}
              </Text>
              <Text>remote control {isRemote ? 'online' : 'offline'}</Text>
            </Text>
            <Box columnGap={1}>
              <Text dimColor>{peersAt ? ago(now - peersAt) : ''}</Text>
              <Button key="peers-refresh" plain label="↻" onPress={() => void refreshPeers($)} />
            </Box>
          </Box>
          {selfName ? <Text dimColor wrap="truncate-end">this session: {selfName}</Text> : null}
          {!isRemote && <Text dimColor>local sessions only · run /remote-control to reach your other machines</Text>}
          {rule}
          {peers.length === 0 && others.length === 0 && art('chat', 'no other agents or sessions right now')}
          {peers.map(p => (
            <Box flexDirection="column" key={`peer:${p.id}`}>
              <Box>
                <Text color={dot(p.status)}>● </Text>
                <Button key={`peer:${p.name}`} plain label={clip(p.name, width - 18)} onPress={openThread(p.name)} />
                <Text dimColor wrap="truncate-end">
                  {' '}
                  {p.kind}
                  {p.status ? ` · ${p.status}` : ''}
                </Text>
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
                <Button key={`peer:${n}`} plain dimColor label={clip(n, width - 14)} onPress={openThread(n)} />
                {counts(n)}
              </Box>
              {lastLine(n)}
            </Box>
          ))}
          {sel && (
            <Box flexDirection="column" key="thread" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
              <Text color="cyan" bold wrap="truncate-end">
                ⇄ {selfName ? `${clip(selfName, 18)} ⇄ ` : ''}
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
              {thread.length ? <Text dimColor>history · click a line to expand</Text> : null}
              {thread.map(m => {
                const key = `m:${sel}:${m.at}:${m.dir}`
                const isFull = isOpen(key)
                const isNew = m.dir === 'in' && m.at > (chatSeen[sel] ?? 0)
                const arrow = m.dir === 'in' ? '◂ in ' : m.status === 'rejected' ? '✗ out' : '▸ out'
                return (
                  <Box key={key} flexDirection="column">
                    <Box>
                      <Text color={m.dir === 'in' ? 'cyan' : m.status === 'rejected' ? 'red' : 'green'} bold>
                        {isNew ? '●' : ' '}
                        {arrow}{' '}
                      </Text>
                      <Text dimColor>{ago(now - m.at).padStart(4)} </Text>
                      <Button key={`b:${key}`} plain dimColor={m.dir === 'out'} label={`${isFull ? '▾' : '▸'} ${clip(plain(m.text), Math.max(10, width - 20))}`} onPress={() => toggleIn($, key)} />
                    </Box>
                    {isFull && (
                      <Box paddingLeft={4}>
                        <Text wrap="wrap">{m.text}</Text>
                      </Box>
                    )}
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
            <Text color="yellow" bold wrap="truncate-end">
              ? Q{q.n} · {clip(q.title, inner - 14)}
            </Text>
            <Text dimColor>{q.mode}</Text>
          </Box>
          {q.topic || q.from ? (
            <Text wrap="truncate-end">
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
              <Box marginTop={q.options.length ? 1 : 0}>
                <Text color="green">➡ </Text>
                <Button key={`grec:${q.id}`} plain label={clip(q.rec, inner - 3)} onPress={() => void answerGrill($, q.id, q.rec)} />
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
        <Box key={`gq:${q.id}`}>
          <Text color={color} bold>
            {mark}{' '}
          </Text>
          <Button key={`gsel:${q.id}`} plain dimColor={q.state !== 'open'} label={clip(`Q${q.n} ${q.title}${tail}`, width - 2)} onPress={() => update($, selectedA, () => `g:${q.id}`)} />
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
                    <Text wrap="truncate-end">
                      <Text color="magenta">◆ </Text>Q{q.n} {q.title}
                    </Text>
                    <Text dimColor wrap="truncate-end">
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
      const meter = (part: number, all: number, n: number, color: string) => {
        const f = all ? Math.round((part / all) * n) : 0
        return (
          <Text>
            <Text color={color}>{'█'.repeat(f)}</Text>
            <Text dimColor>{'░'.repeat(n - f)}</Text>
          </Text>
        )
      }
      const kv = (icon: string, k: string, v: string, color = 'white') => (
        <Box key={`s:${k}`} justifyContent="space-between">
          <Text>
            {icon} <Text dimColor>{k}</Text>
          </Text>
          <Text color={color} bold>
            {v}
          </Text>
        </Box>
      )
      const barRow = (icon: string, k: string, part: number, all: number, color: string, label: string) => (
        <Box key={`b:${k}`} justifyContent="space-between">
          <Text>
            {icon} <Text dimColor>{k}</Text>
          </Text>
          <Text>
            {meter(part, all, 12, color)}
            <Text bold> {label}</Text>
          </Text>
        </Box>
      )
      const head = (t: string) => (
        <Text key={`h:${t}`} color="cyan" bold>
          {t}
        </Text>
      )
      const pct = Math.round(stats.contextPct)
      const own = stats.own ?? EMPTY_STATS.own
      body = (
        <Box flexDirection="column" key="stats">
          {head('◷ session')}
          {kv('◷', 'elapsed', ago(now - (stats.startedAt || now)))}
          {kv('↻', 'turns', `${stats.turns}`)}
          {kv('⚒', 'tool calls', `${calls}`, 'cyan')}
          {kv('△', 'errors', `${stats.errors}`, stats.errors ? 'red' : 'green')}
          {kv('✎', 'files edited', `${stats.files.length}`, 'yellow')}
          {stats.costUsd > 0 && kv('$', 'session cost', `$${stats.costUsd.toFixed(2)}`, 'yellow')}
          {barRow('◫', 'context', pct, 100, pct > 80 ? 'red' : pct > 50 ? 'yellow' : 'green', `${pct}%`)}
          {head('├ course')}
          {barRow('⚑', 'milestones', msDone, msAll, 'green', `${msDone}/${msAll}`)}
          {barRow('☑', 'tasks', board.done.length, taskAll, 'cyan', `${board.done.length}/${taskAll}`)}
          {barRow('?', 'grill', front.settled.length, grill.length, 'yellow', `${front.settled.length}/${grill.length}`)}
          {kv('●', 'steps · ✗ dead ends', `${steps.filter(s => s.state === 'done').length} · ${steps.filter(s => s.state === 'abandoned').length}`, 'green')}
          {kv('↪', 'steers · ◌ asides', `${steers.length} · ${btw.length}`, 'magenta')}
          {head('⚒ tools')}
          {top.length === 0 && art('stats', 'no tool calls yet')}
          {top.map(([name, n], i) => (
            <Box key={`tool:${name}`}>
              <Text>{clip(name, 12).padEnd(13)}</Text>
              <Text color={['cyan', 'green', 'yellow', 'magenta'][i % 4]}>{'▇'.repeat(Math.max(1, Math.round((n / max) * Math.max(4, width - 20))))}</Text>
              <Text bold> {n}</Text>
            </Box>
          ))}
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>{'┄'.repeat(width)}</Text>
            <Text dimColor wrap="truncate-end">
              ◈ compass itself: {own.calls} map calls · {kfmt(own.input + own.cacheWrite)} in · {kfmt(own.cacheRead)} cached · {kfmt(own.output)} out
            </Text>
            <Text dimColor wrap="truncate-end">
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
                <Text dimColor wrap="truncate-end">
                  {b}
                </Text>
              </Box>
            ))}
        </Box>
      )
    }

    // activity strip: what the pane sent the agent, and where each one stands
    const live = actions.filter(a => a.status === 'queued')
    const recent = [...live, ...actions.filter(a => a.status !== 'queued' && now - a.at < 120_000).reverse()]
    const shown = isOpen('activity') ? recent.slice(0, 12) : recent.slice(0, 3)
    const hue = { queued: 'yellow', sent: 'green', rejected: 'red' } as const
    const activity = recent.length > 0 && (
      <Box flexDirection="column" key="activity" marginTop={1}>
        <Text dimColor>{'┄'.repeat(width)}</Text>
        {shown.map(a => (
          <Box key={`act:${a.id}`}>
            <Text color={hue[a.status]} bold>
              {ROUTE_GLYPH[a.status]}{' '}
            </Text>
            <Box flexGrow={1}>
              <Text wrap="truncate-end" dimColor={a.status === 'sent'}>
                {a.label}
              </Text>
            </Box>
            <Text dimColor>
              {' '}
              {a.status === 'queued' ? (a.route === 'next prompt' ? 'next prompt' : isBusy ? 'after turn' : 'sending') : a.status === 'sent' ? `${a.route} ${ago(now - a.at)}` : clip(a.reason, 14)}
            </Text>
            {a.status === 'queued' && <Button key={`force:${a.id}`} plain label=" ⚡" onPress={() => void forceAction($, a.id)} />}
          </Box>
        ))}
        {recent.length > 3 && fold('activity', isOpen('activity') ? 'fewer' : `${recent.length - 3} more`)}
      </Box>
    )

    return (
      <Box flexDirection="column" width={width}>
        {header}
        {body}
        {activity}
        {lastError && (
          <Text color="yellow" dimColor>
            △ {lastError}
          </Text>
        )}
      </Box>
    )
  })
}
