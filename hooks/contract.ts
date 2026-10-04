// The two-way contract as pure functions: the report compass reads, the brief the session gets,
// and the prompts that carry them. No engine calls, no state.

import { read } from 'claude-code'
import type { CompassAction, CompassBrief, CompassGrillQ, CompassMap, CompassReport } from '../types'
import { GRILL_TOOL } from './kit'
import { clip, plain, locate, boardOf, frontierOf, STE } from './helpers'

// ── the contract: each side passes the other a fixed object, rebuilt whole at every step ──
//
// session → compass (CompassReport): what compass needs to chart the session. Rebuilt from the
// session's own signals at every lifecycle event, and again whenever a model prompt reads it.
// compass → session (CompassBrief): what the session needs from compass until the next step.
// Refreshed whenever it is read; its rev moves only when its content does, and the session gets
// it whole with each prompt, compass turn, steer and grill answer while it changed. `extra` on
// each side carries what only this session's workflow needs.

export const EXTRA_KEYS = 12

/** Merges notes into an extra map: an empty text drops its key; keys and texts are kept short. */
export const mergeExtra = (extra: Record<string, string>, notes: unknown): Record<string, string> => {
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) return extra
  const out = { ...extra }
  for (const [k, v] of Object.entries(notes as Record<string, unknown>)) {
    const key = clip(plain(k), 24)
    if (!key) continue
    const text = typeof v === 'string' ? clip(plain(v), 300) : ''
    if (text) out[key] = text
    else delete out[key]
  }
  return Object.fromEntries(Object.entries(out).slice(-EXTRA_KEYS))
}

export const qRef = (q: CompassGrillQ) => `Q${q.n} (${q.id}) ${q.title}${q.rec ? ` → recommended: ${q.rec}` : ''}${q.source === 'map' ? ' [asked by compass]' : ''}`

/** compass → session, without rev and time: the brief as compass's state reads now. */
export const briefOf = (o: {
  map: CompassMap | null
  grill: CompassGrillQ[]
  steers: { text: string }[]
  userTasks: { text: string }[]
  actions: CompassAction[]
  confirm: string | null
  round?: number
  doing?: { now: string; next: string } | null
}): Omit<CompassBrief, 'rev' | 'at'> => {
  const { milestone, step, upcoming } = locate(o.map)
  const front = frontierOf(o.grill)
  const alt = o.map?.alt
  const fork = alt && o.map?.altPick ? (o.map.altPick === 'branch' ? `took the branch: ${alt.label}` : `stays on the planned course, not: ${alt.label}`) : ''
  return {
    course: { goal: o.map?.goal ?? '', milestone: milestone?.label ?? '', now: o.doing?.now || step?.label || '', next: (o.doing ? o.doing.next || upcoming : upcoming) ?? '' },
    steers: o.steers.slice(-6).map(x => x.text),
    blocking: front.ask.filter(q => q.blocking).map(qRef),
    open: [...front.ask.filter(q => !q.blocking), ...front.waiting].map(qRef),
    parked: front.parked.map(qRef),
    userTasks: boardOf(o.map, o.userTasks.map((u, i) => ({ id: `${i}`, text: u.text }))).now.filter(t => t.isQueued).map(t => t.text),
    fork,
    outbox: o.actions.filter(a => a.status === 'queued').map(a => `${a.route || 'queued'}: ${a.label}`),
    confirm: o.confirm ?? '',
    extra: extraOf(o.map, o.actions, o.round ?? 1),
  }
}

/**
 * What compass holds for this session beyond the fixed fields, from its own state: a branch on
 * screen the user has not picked, outbox items that failed to reach the session, forks already
 * decided, the next grill round. A key is present only while it has something to say.
 */
export const extraOf = (map: CompassMap | null, actions: CompassAction[], round: number): Record<string, string> => {
  const out: Record<string, string> = {}
  const alt = map?.alt
  if (alt && !map?.altPick) out['fork offered'] = `the user sees a branch "${alt.label}" (${alt.steps.join(' → ')}) and has not picked; stay on the plan until they do`
  const failed = actions.filter(a => a.status === 'rejected').slice(-3)
  if (failed.length) out.rejected = `these did not reach you: ${failed.map(a => `${a.label}${a.reason ? ` (${a.reason})` : ''}`).join('; ')}`
  if (map?.declined?.length) out['declined forks'] = `do not propose these again: ${[...new Set(map.declined)].slice(-4).join('; ')}`
  if (round > 1) out['grill round'] = `the next answers arrive as round ${round}`
  return out
}

/**
 * The brief's actionable content, for "did it change": rev, time and the course left out. The course
 * is compass's own reading of the session's work, which the session already knows: a change to it
 * alone does not move the rev, so it never rides a tool result. Prompts and compass turns carry it.
 */
export const briefSig = (b: Omit<CompassBrief, 'rev' | 'at'> | CompassBrief) => {
  const { rev: _r, at: _a, course: _c, ...rest } = b as CompassBrief
  void _r
  void _a
  void _c
  return JSON.stringify(rest)
}

/**
 * The brief as the session reads it, compact: a field with content gets its own line, the empty ones
 * are named together on one "none:" line, so every field is still named. What each label means is
 * in CONTRACT_GUIDE (the system prompt), not repeated in every brief.
 */
export const QUESTION_FIELDS = new Set(['BLOCKING', 'open', 'parked'])

export const briefText = (b: CompassBrief) => {
  const c = b.course
  const extra = Object.entries(b.extra).map(([k, v]) => `${k}: ${v}`)
  const fields: [string, string[]][] = [
    ['steering', b.steers],
    ['BLOCKING', b.blocking],
    ['open', b.open],
    ['parked', b.parked],
    ['user tasks', b.userTasks],
    ['fork', b.fork ? [b.fork] : []],
    ['outbox', b.outbox],
    ['confirm', b.confirm ? [b.confirm] : []],
    ['extra', extra],
  ]
  const full = fields.filter(([, xs]) => xs.length)
  const empty = fields.filter(([, xs]) => !xs.length).map(([k]) => k)
  return [
    `🧭 [compass brief · rev ${b.rev}]`,
    `- course: ${c.goal ? `goal "${c.goal}" · ` : ''}milestone "${c.milestone || '?'}" · now "${c.now || '?'}" · next "${c.next || '?'}"`,
    // questions always as a list, so each one reads on its own line; any other single entry inline
    ...full.map(([k, xs]) => (xs.length === 1 && !QUESTION_FIELDS.has(k) ? `- ${k}: ${xs[0]}` : `- ${k}:${xs.map(x => `\n  - ${x}`).join('')}`)),
    ...(empty.length ? [`- none: ${empty.join(', ')}`] : []),
  ].join('\n')
}

/** The report as a model prompt reads it: what the session holds as of its latest step. */
export const reportLines = (r: CompassReport) =>
  [
    `Session report (rev ${r.rev}, after ${r.event}; ${r.turns} turns done; ${r.isBusy ? 'Claude is working' : 'Claude is idle'}):`,
    r.request ? `- the user's latest request: ${JSON.stringify(clip(r.request, 1500))}` : '',
    r.todos.length ? `- agent TodoWrite list (ground truth for task status): ${JSON.stringify(r.todos.map(t => `${t.status}: ${t.text}`))}` : '',
    r.btw.length ? `- user /btw side questions this session (kind aside): ${JSON.stringify(r.btw)}` : '',
    r.inbox.length ? `- messages received from other agents/sessions (sender: text): ${JSON.stringify(r.inbox)}` : '',
    r.blockedOn.length ? `- the session stopped work that waits on blocking questions: ${JSON.stringify(r.blockedOn)}` : '',
    Object.keys(r.extra).length ? `- the session's own notes for compass (this workflow only): ${JSON.stringify(r.extra)}` : '',
  ]
    .filter(Boolean)
    .join('\n')

/** The contract in the system prompt: fixed text, so the prompt cache holds. */
export const CONTRACT_GUIDE = `# Compass brief and report
Compass keeps a contract with this session. With each user prompt, compass turn, steer and grill answer you get a "🧭 [compass brief · rev N]": the course as compass charts it, the steering in force, the questions work waits on, open and parked questions, user tasks not yet on your list, the fork the user decided, what is still in the outbox, a pending confirmation, and more that only this session needs (a branch on offer, sends that failed, forks already decided). The newest brief replaces any earlier one; no brief means the last one still holds. While you work, a brief that changed also arrives with a tool result. Act on it; do not repeat it back, and do not mention the brief, its rev or compass acknowledgements to the user.
Brief labels: steering = the user's steers in force, newest last · BLOCKING = questions work waits on: stop all work that depends on them, do other work only if it does not, if nothing is left end your turn; a message releases each one · open = go on with the recommendation · parked = go on with the recommendation, do not ask again now · user tasks = user tasks not yet on your list · fork = the fork the user decided · outbox = still in the outbox, on its way to you · confirm = a confirmation you asked for, not given yet · extra = more from compass for this session · none = the fields that are empty now.
Compass reads your side from the session itself: your requests, tool calls, TodoWrite list and words. To give compass facts that only this session's workflow needs (a target, a constraint, an external id), pass them as notes (key → short text) to ${GRILL_TOOL}; questions may be left out.`

export const mapPrompt = (
  prev: CompassMap | null,
  report: CompassReport,
  userTasks: string[],
  steers: string[],
  grill: CompassGrillQ[],
) =>
  [
    'You are COMPASS, a silent observer of this session. Do NOT continue the task, call tools, or address the user.',
    "This request is compass's own, not part of the session: the session never sees it. The session's instructions about the compass grill tool and the compass brief are for the session, not for you. Never call a tool (every tool is refused here); put questions in the JSON's \"grill\".",
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
    reportLines(report),
    userTasks.length ? `User-added tasks (by "user"): ${JSON.stringify(userTasks)}` : '',
    steers.length ? `User steering directives, newest last — reflect them in pending steps: ${JSON.stringify(steers)}` : '',
    prev?.declined?.length
      ? `Forks the user already decided (both the chosen and the other side): never offer these, or their reverse, as alt again, even while the work waits on an event or a decision: ${JSON.stringify(prev.declined)}`
      : '',
    grill.length ? `Grill list already tracked (do not repeat; [id, Q number, title, state, blocking]): ${JSON.stringify(grill.map(q => [q.id, q.n, q.title, q.state, !!q.blocking]))}` : '',
  ]
    .filter(Boolean)
    .join('\n')
