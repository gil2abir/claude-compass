import { expect, mock, test } from 'claude-code/testing'

import { EMPTY_BRIEF, EMPTY_REPORT, briefOf, briefSig, briefText, compactRow, extraOf, mergeExtra, parseMap, reportLines, roundMessage } from '../hooks/register'

const MAP = {
  goal: 'Ship the cache',
  milestones: [
    { id: 'm1', label: 'Design the cache', state: 'done', why: '', steps: [{ id: 's1', label: 'Pick the store', kind: 'decision', state: 'done', why: '' }] },
    { id: 'm2', label: 'Build the cache', state: 'active', why: '', steps: [
      { id: 's2', label: 'Write the store', kind: 'step', state: 'active', why: '' },
      { id: 's3', label: 'Add the tests', kind: 'step', state: 'pending', why: '' },
    ] },
  ],
  tasks: [{ id: 't1', text: 'Write the store', lane: 'now', by: 'agent' }],
  recap: ['picked memory'],
}

/** Clicks a control by key: a Button is pressed, a pill (a Client region) gets a pointer click. */
const tap = async (mounted: unknown, key: string) => {
  const ui = mounted as { find: (q: { key: string }) => Promise<{ type?: string } | undefined>; press: (q: { key: string }) => Promise<unknown>; pointer: (q: Record<string, unknown>) => Promise<unknown> }
  const el = await ui.find({ key })
  if (el?.type === 'Client') {
    await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: key })
    await ui.pointer({ type: 'up', x: 1, y: 0, button: 'left', in: key })
    return
  }
  await ui.press({ key })
}

const PANE = {
  component: 'Pane',
  requestId: 'compass',
  props: { title: '🧭 compass', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const

const q = (id: string, n: number, state: 'open' | 'parked' | 'settled', blocking: boolean) => ({
  id, n, title: `Question ${id}`, body: '', options: [], rec: `rec ${id}`, dependsOn: [], topic: '', mode: 'work' as const, source: 'agent' as const, from: '', state, blocking, answer: '', followups: [], at: 1,
})

test('mergeExtra keeps short notes, drops a key on an empty text, and ignores what is no object', async () => {
  expect(mergeExtra({}, { target: 'node 22', db: 'pg' })).toEqual({ target: 'node 22', db: 'pg' })
  expect(mergeExtra({ target: 'node 22', db: 'pg' }, { db: '' })).toEqual({ target: 'node 22' })
  expect(mergeExtra({ a: 'x' }, 'nope')).toEqual({ a: 'x' })
  expect(mergeExtra({ a: 'x' }, ['y'])).toEqual({ a: 'x' })
  expect(mergeExtra({}, { k: 'v'.repeat(500) }).k!.length).toBeLessThanOrEqual(300)
  const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, 'v']))
  expect(Object.keys(mergeExtra({}, many)).length).toBe(12)
})

test('the brief has every field, always: an empty compass names each one as none, on one line', async () => {
  const b = briefOf({ map: null, grill: [], steers: [], userTasks: [], actions: [], confirm: null })
  expect(Object.keys(b).sort()).toEqual(Object.keys(EMPTY_BRIEF).filter(k => k !== 'rev' && k !== 'at').sort())
  const text = briefText({ ...b, rev: 1, at: 0 })
  expect(text.split('\n')).toEqual([
    '🧭 [compass brief · rev 1]',
    '- course: milestone "?" · now "?" · next "?"',
    '- none: steering, BLOCKING, open, parked, user tasks, fork, outbox, confirm, extra',
  ])
})

test('a brief with content lists each full field on its own, questions as a list, and folds the empty ones', async () => {
  const text = briefText({ ...EMPTY_BRIEF, rev: 3, at: 0, steers: ['keep it in memory'], blocking: ['Q1 (ttl) Expiry → recommended: 1h'], fork: 'took the branch: Use redis' })
  expect(text).toMatch(/^- steering: keep it in memory$/m)
  expect(text).toMatch(/^- BLOCKING:\n {2}- Q1 \(ttl\) Expiry → recommended: 1h$/m)
  expect(text).toMatch(/^- fork: took the branch: Use redis$/m)
  expect(text).toMatch(/^- none: open, parked, user tasks, outbox, confirm, extra$/m)
})

test('the transcript draws a compass turn without the brief or the model-only lines; the model text stays whole', async () => {
  const ans = { id: 'db', n: 1, title: 'Pick the database', body: '', options: [], rec: '', dependsOn: [], topic: '', mode: 'work', source: 'agent', from: '', state: 'answered', blocking: true, answer: 'postgres', followups: [], at: 0 } as never
  const stored = `${roundMessage(1, [ans])}\n\n${briefText({ ...EMPTY_BRIEF, rev: 4, at: 0 })}`
  expect(stored).toMatch(/RELEASED: this was blocking/)
  expect(stored).toMatch(/compass brief · rev 4/)
  expect(compactRow(stored)).toBe('🧭 [compass grill · round 1 — answers from the user]\n❓ Q1 (db) Pick the database → postgres · released')
  expect(compactRow('🧭 [compass grill — from the user] Parked Q1 · BLOCKING again: stop the work that depends on it until its answer comes.')).toBe('🧭 [compass grill — from the user] Parked Q1 · holds')
  // a turn with no brief and nothing model-only draws as it is
  expect(compactRow('🧭 [compass — steering from the user] use sqlite')).toBe('🧭 [compass — steering from the user] use sqlite')
})

test('the brief carries what the session needs from compass: course, steers, questions by kind, fork, outbox, notes', async () => {
  const map = { ...parseMap(JSON.stringify(MAP), 1)!, alt: { label: 'Use redis', why: '', steps: ['Add redis'] }, altPick: 'main' as const }
  const b = briefOf({
    map,
    grill: [q('ttl', 1, 'open', true), q('name', 2, 'open', false), q('size', 3, 'parked', false), q('old', 4, 'settled', true)],
    steers: [{ text: 'keep it in memory' }],
    userTasks: [{ text: 'add a metrics page' }, { text: 'Write the store' }],
    actions: [{ id: 'a', kind: 'note', label: 'tests → DOING', text: '', status: 'queued', route: 'next prompt', reason: '', at: 1, ref: '', prev: '' }],
    confirm: 'the plan',
    round: 3,
  })
  expect(b.course).toEqual({ goal: 'Ship the cache', milestone: 'Build the cache', now: 'Write the store', next: 'Add the tests' })
  expect(b.steers).toEqual(['keep it in memory'])
  expect(b.blocking).toEqual(['Q1 (ttl) Question ttl → recommended: rec ttl'])
  expect(b.open).toEqual(['Q2 (name) Question name → recommended: rec name'])
  expect(b.parked).toEqual(['Q3 (size) Question size → recommended: rec size'])
  // a user task the chart already adopted is no longer "not on your list"
  expect(b.userTasks).toEqual(['add a metrics page'])
  expect(b.fork).toBe('stays on the planned course, not: Use redis')
  expect(b.outbox).toEqual(['next prompt: tests → DOING'])
  expect(b.confirm).toBe('the plan')
  expect(b.extra).toEqual({ 'grill round': 'the next answers arrive as round 3' })
  // the signature ignores rev and time, so only content moves the rev
  expect(briefSig({ ...b, rev: 5, at: 9 })).toBe(briefSig(b))
  expect(briefSig({ ...b, steers: [] })).not.toBe(briefSig(b))
})

test('extra comes from compass state: a branch not picked, failed sends, decided forks, the next round', async () => {
  const base = parseMap(JSON.stringify(MAP), 1)!
  expect(extraOf(base, [], 1)).toEqual({})
  const open = extraOf({ ...base, alt: { label: 'Use redis', why: '', steps: ['Add redis', 'Wire it'] }, declined: ['Use sqlite'] }, [
    { id: 'a', kind: 'steer', label: 'go faster', text: '', status: 'rejected', route: 'running turn', reason: 'busy', at: 1, ref: '', prev: '' },
  ], 2)
  expect(open['fork offered']).toMatch(/branch "Use redis" \(Add redis → Wire it\) and has not picked/)
  expect(open.rejected).toMatch(/go faster \(busy\)/)
  expect(open['declined forks']).toMatch(/Use sqlite/)
  expect(open['grill round']).toMatch(/round 2/)
  // once picked, the branch is a fixed field (fork), not an extra
  expect(extraOf({ ...base, alt: { label: 'Use redis', why: '', steps: ['x'] }, altPick: 'branch' }, [], 1)['fork offered']).toBeUndefined()
})

test('the report reads whole into a model prompt: request, todos, asides, inbox and the session notes', async () => {
  const lines = reportLines({ ...EMPTY_REPORT, rev: 7, event: 'turn.complete', turns: 3, request: 'build the cache', todos: [{ text: 'write store', status: 'in_progress' }], btw: ['why lru?'], inbox: ['Docs agent: ping'], extra: { target: 'node 22' } })
  expect(lines).toMatch(/rev 7, after turn.complete; 3 turns done; Claude is idle/)
  expect(lines).toMatch(/latest request: "build the cache"/)
  expect(lines).toMatch(/in_progress: write store/)
  expect(lines).toMatch(/why lru\?/)
  expect(lines).toMatch(/Docs agent: ping/)
  expect(lines).toMatch(/this workflow only.*node 22/)
  // an empty report adds only its header
  expect(reportLines(EMPTY_REPORT).split('\n').length).toBe(1)
})

test('across a session lifecycle each side gets the other its contract: the chart reads the report, the session gets the brief at every handoff', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/nonexistent' })
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  const forks: string[] = []
  on('model.fork', (_$, e) => {
    forks.push((e as { prompt: string }).prompt)
    return { value: { isAnswered: true, text: JSON.stringify(MAP), usage } } as never
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '{"same":true}', usage } }) as never)
  on('session.id', () => ({ value: 'sess' }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'build the cache', toolUses: [] }, { role: 'assistant', text: 'The store is written; tests next.', toolUses: [] }] }) as never)
  on('session.usage', () => ({ value: { startedAt: 1, context: { window: 1000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('session.start', (_$, e) => e as never)
  on('session.receive', (_$, e) => ({ text: e.text }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)
  on('tool.call', () => ({ result: {} as never, text: 'ok' }))
  on('prompt.compose', () => ({ sections: [] }) as never)
  let context: readonly string[] = []
  on('prompt.submit', (_$, e) => {
    context = (e as { context?: readonly string[] }).context ?? []
    return { text: e.text } as never
  })
  on('command.run', () => ({ text: '' }) as never)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  // the system prompt names the contract once, in fixed text, so the cache holds
  const composed = await $.prompt.compose({ model: 'opus', promptModel: 'opus', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as never)
  const own = composed.sections.find(s => s.id === 'compass')!
  expect(own.text).toMatch(/Compass brief and report/)
  expect(own.text).toMatch(/notes \(key → short text\)/)
  expect(own.text).toMatch(/Blocking is a handshake/)
  expect((await $.prompt.compose({ model: 'opus', promptModel: 'opus', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as never)).sections.find(s => s.id === 'compass')!.text).toBe(own.text)

  // turn 1: the request, a todo list, a grill post with the session's own notes, an inbound message
  await $.prompt.submit({ text: 'build the cache' } as never)
  expect(context.join('\n')).toMatch(/compass brief · rev 1\]\n- course:/)
  await $.turn.start({ text: 'build the cache', turnId: 't1' } as never)
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'write store', status: 'in_progress', activeForm: 'writing' }] } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  const posted = await $.tool.call({
    tool: 'mcp__compass__grill',
    topic: 'cache',
    questions: [{ id: 'ttl', title: 'Expiry', body: 'How long?', recommendation: '1h', blocking: true }],
    notes: { target: 'node 22', ticket: 'CACHE-12' },
  } as never)
  // the grill answer carries the brief as context (the model reads it, the transcript does not
  // show it), now with the blocking question in it; the visible result stays short
  const postedCtx = (posted.context ?? []).join('\n')
  expect(postedCtx).toMatch(/compass brief · rev 2\]/)
  expect(postedCtx).toMatch(/- BLOCKING:\n {2}- Q1 \(ttl\) Expiry → recommended: 1h/)
  expect(String(posted.text)).not.toMatch(/compass brief/)
  expect(String(posted.text).length).toBeLessThan(260)
  // and compass acknowledges the hold explicitly
  expect(String(posted.text)).toMatch(/ACK BLOCKING: Q1 \(ttl\)\. Stop all work that depends on it now/)
  await $.session.receive({ origin: { kind: 'peer' }, text: '<cross-session-message from="uds:/x.sock" from-name="Docs agent">please keep the API stable</cross-session-message>' })
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.advance(1500)

  // the full chart reads the whole report: nothing the session said is missing
  const chart = forks[forks.length - 1]!
  expect(chart).toMatch(/Session report \(rev \d+, after turn.complete; 1 turns done; Claude is idle\)/)
  expect(chart).toMatch(/latest request: "build the cache"/)
  expect(chart).toMatch(/in_progress: write store/)
  expect(chart).toMatch(/Docs agent: please keep the API stable/)
  expect(chart).toMatch(/this workflow only.*"target":"node 22".*"ticket":"CACHE-12"/)
  // and that the session holds on the blocking question
  expect(chart).toMatch(/stopped work that waits on blocking questions: \["ttl"\]/)

  // the brief went whole once; with nothing new nothing rides the prompt
  await $.prompt.submit({ text: 'go on' } as never)
  const second = context.join('\n')
  expect(second).toMatch(/compass brief · rev \d+\]/)
  await $.prompt.submit({ text: 'and again' } as never)
  expect(context.join('\n')).not.toMatch(/compass brief/)

  // a session note can be dropped with an empty text
  await $.tool.call({ tool: 'mcp__compass__grill', notes: { ticket: '' } } as never)
  await $.turn.start({ text: 'more', turnId: 't3' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't3', reason: 'answer' } as never)
  await clock.advance(1500)
  expect(forks[forks.length - 1]).not.toMatch(/CACHE-12/)
  expect(forks[forks.length - 1]).toMatch(/"target":"node 22"/)

  // the stats tab shows where the contract stands
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  await tap(ui, 'tab:stats')
  expect(await ui.find({ text: /contract: ◂ report r\d+ \(turn.complete\) · ▸ brief r\d+ · session has r\d+/ })).toBeDefined()
  await ui.unmount()
})

test('a resume keeps the session notes and the last request', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/nonexistent' })
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  const forks: string[] = []
  on('model.fork', (_$, e) => {
    forks.push((e as { prompt: string }).prompt)
    return { value: { isAnswered: true, text: JSON.stringify(MAP), usage } } as never
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '{"same":true}', usage } }) as never)
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get((e as { key: string }).key) }) as never)
  on('store.set', (_$, e) => {
    store.set((e as { key: string }).key, (e as { value: unknown }).value)
    return { value: undefined } as never
  })
  on('store.keys', () => ({ value: [...store.keys()] }) as never)
  on('store.delete', () => ({ value: undefined }) as never)
  on('session.id', () => ({ value: 'sess' }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'build the cache', toolUses: [] }] }) as never)
  on('session.usage', () => ({ value: { startedAt: 1, context: { window: 1000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('session.start', (_$, e) => e as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)
  on('tool.call', () => ({ result: {} as never, text: 'ok' }))
  on('command.run', () => ({ text: '' }) as never)
  const appended: string[] = []
  on('session.append', (_$, e) => {
    appended.push(JSON.stringify(e))
    return {} as never
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await $.turn.start({ text: 'build the cache', turnId: 't1' } as never)
  await $.tool.call({ tool: 'mcp__compass__grill', notes: { target: 'node 22' } } as never)
  await $.command.run({ command: 'compass', args: 'steer keep it in memory', origin: { kind: 'composer' } } as never)
  await clock.advance(9000)
  // the steer and the brief go in together
  // the kit has no append of its own; the steer's brief is checked where it is built (briefText)
  void appended
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.advance(6000)
  expect([...store.keys()].some(k => k.startsWith('snap:'))).toBe(true)
  const snap = store.get('snap:sess') as { contract?: { extra: Record<string, string>; request: string } }
  expect(snap.contract?.extra).toEqual({ target: 'node 22' })
  expect(snap.contract?.request).toBe('build the cache')
})

test('the contract does not drift: a pane action moves the brief at once, and the changed brief rides the next tool result mid-turn', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/nonexistent' })
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  on('model.fork', () => ({ value: { isAnswered: true, text: JSON.stringify(MAP), usage } }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: '{"same":true}', usage } }) as never)
  on('session.id', () => ({ value: 'sess' }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'build the cache', toolUses: [] }] }) as never)
  on('session.usage', () => ({ value: { startedAt: 1, context: { window: 1000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('session.start', (_$, e) => e as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)
  on('tool.call', () => ({ result: {} as never, text: 'ok' }))
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await $.prompt.submit({ text: 'build the cache' } as never)
  await $.turn.start({ text: 'build the cache', turnId: 't1' } as never)
  await clock.advance(5000)
  // the chart landed while Claude works: the course moved, so the next tool result carries the brief once
  const first = await $.tool.call({ tool: 'Read', file_path: '/a.ts' } as never)
  expect((first.context ?? []).join('\n')).toMatch(/now "Write the store" · next "Add the tests"/)
  const quiet = await $.tool.call({ tool: 'Read', file_path: '/b.ts' } as never)
  expect((quiet.context ?? []).join('\n')).not.toMatch(/compass brief/)

  // the user parks nothing, but adds a task in the pane: the poller refreshes the brief, the next call carries it
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  await tap(ui, 'tab:tasks')
  await ui.input({ key: 'task', text: 'add a metrics page' })
  await clock.advance(1100)
  const after = await $.tool.call({ tool: 'Read', file_path: '/c.ts' } as never)
  const ctx = (after.context ?? []).join('\n')
  expect(ctx).toMatch(/^- user tasks: add a metrics page$/m)
  expect(ctx).toMatch(/^- outbox: next prompt: /m)
  // the stats line shows the session holds the newest brief
  await tap(ui, 'tab:stats')
  const line = JSON.stringify(await ui.find({ text: /contract:/ }))
  const [, brief, has] = /brief r(\d+) · session has r(\d+)/.exec(line) ?? []
  expect(brief).toBe(has)
  await ui.unmount()
})

const grillHarness = (on: Parameters<typeof mock.clock>[0], toasts: string[] = []) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/nonexistent' })
  on('model.fork', () => ({ value: { isAnswered: false, reason: 'busy' } }) as never)
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'busy' } }) as never)
  on('session.id', () => ({ value: 'sess' }))
  on('session.messages', () => ({ value: [] }) as never)
  on('session.usage', () => ({ value: { startedAt: 1, context: { window: 1, percent: 1 }, rateLimits: [] } }) as never)
  on('session.start', (_$, e) => e as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', (_$, e) => {
    toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)
  const submitted: string[] = []
  const appended: string[] = []
  let context: readonly string[] = []
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    context = (e as { context?: readonly string[] }).context ?? []
    return { text: e.text } as never
  })
  on('session.append', (_$, e) => {
    appended.push(JSON.stringify(e))
    return {} as never
  })
  return { clock, submitted, appended, context: () => context.join('\n') }
}

const TWO = [
  { id: 'db', title: 'Pick the database', body: 'Which?', options: ['sqlite', 'postgres'], recommendation: 'sqlite', blocking: true },
  { id: 'name', title: 'Name the CLI', body: 'Name?', recommendation: 'tstats', blocking: false },
]

test('a blocking answer releases the session at once, without waiting for the open non-blocking questions', async ($, on) => {
  const h = grillHarness(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: 'mcp__compass__grill', topic: 'cli', questions: TWO } as never)
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  await tap(ui, 'tab:grill')
  // the session held on db and ended its turn; the user answers db, leaving name open
  await tap(ui, 'gopt:db:1')
  await h.clock.advance(8100)
  expect(h.submitted.length).toBe(1)
  expect(h.submitted[0]).toMatch(/Q1 \(db\) Pick the database → postgres · RELEASED: this was blocking; continue the work that waited on it\./)
  // the round carries only the release; name stays open, listed in the brief below it
  expect(h.submitted[0]!.split('[compass brief')[0]).not.toMatch(/Name the CLI/)
  // the brief that rides the release no longer lists db as blocking; name stays open
  const ctx = h.submitted[0]!
  expect(ctx).toMatch(/- none: [^\n]*BLOCKING/)
  expect(ctx).toMatch(/- open:\n {2}- Q2 \(name\)/)
  await ui.unmount()
})

test('a blocking answer while Claude still works goes into the running turn', async ($, on) => {
  const toasts: string[] = []
  const h = grillHarness(on, toasts)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await $.turn.start({ text: 'build it', turnId: 't1' } as never)
  await $.tool.call({ tool: 'mcp__compass__grill', topic: 'cli', questions: TWO } as never)
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  await tap(ui, 'tab:grill')
  await tap(ui, 'gopt:db:0')
  await h.clock.advance(8100)
  expect(h.submitted.length).toBe(0)
  // routed into the running turn (the kit has no append of its own: a toast names the attempt)
  expect(toasts.some(t => /grill round 1: 1 answer/.test(t) && /running turn|session\.append/.test(t))).toBe(true)
  await ui.unmount()
})

test('parking or dismissing a blocking question releases the session at once; a non-blocking one rides the next prompt', async ($, on) => {
  const h = grillHarness(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: 'mcp__compass__grill', topic: 'cli', questions: TWO } as never)
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  await tap(ui, 'tab:grill')
  await tap(ui, 'gpark:db')
  await h.clock.advance(8100)
  // the idle session is woken with the release, not left waiting for the user's next prompt
  expect(h.submitted.length).toBe(1)
  expect(h.submitted[0]).toMatch(/Parked grill question Q1 "Pick the database".*RELEASED/)
  await tap(ui, 'gpark:name')
  await h.clock.advance(8100)
  expect(h.submitted.length).toBe(1)
  await $.prompt.submit({ text: 'go on' } as never)
  expect(h.context()).toMatch(/Parked grill question Q2 "Name the CLI"/)
  await ui.unmount()
})

test('the UserMessage row of a compass turn draws compact; ctrl+o, the user\'s own prompt and other rows draw as stored', async ($, on) => {
  const drawn: string[] = []
  on('ui.render', { component: 'UserMessage' }, (_$, e) => {
    drawn.push((e.props as { text: string }).text)
    return { type: 'Box', props: {}, children: [] } as never
  })
  const stored = `🧭 [compass — steering from the user] use sqlite\n\n${briefText({ ...EMPTY_BRIEF, rev: 2, at: 0 })}`
  const row = (text: string, origin: Record<string, unknown>, isExpanded = false) =>
    $.ui.render({ component: 'UserMessage', props: { text, origin, isExpanded } } as never)
  await row(stored, { kind: 'plugin', name: 'compass' })
  expect(drawn.pop()).toBe('🧭 [compass — steering from the user] use sqlite')
  await row(stored, { kind: 'plugin', name: 'compass' }, true)
  expect(drawn.pop()).toBe(stored)
  await row('build the cache', { kind: 'composer' })
  expect(drawn.pop()).toBe('build the cache')
  // a prompt the user typed is drawn as typed, even one that starts like a compass turn
  await row(stored, { kind: 'composer' })
  expect(drawn.pop()).toBe(stored)
  await row('a note with [compass brief · rev 1] in it', { kind: 'plugin', name: 'other' })
  expect(drawn.pop()).toBe('a note with [compass brief · rev 1] in it')
})
