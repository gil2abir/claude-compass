import { expect, mock, test } from 'claude-code/testing'

import { briefOf, briefSig, hintChips, parseMap, todoCourse } from '../hooks/register'

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

const MAP = {
  goal: 'Build compass mod',
  milestones: [
    { id: 'm1', label: 'Research mod API', state: 'done', why: '', steps: [{ id: 's1', label: 'read docs', kind: 'step', state: 'done', why: '' }] },
    { id: 'm2', label: 'Build v2', state: 'active', why: '', steps: [
      { id: 's4', label: 'write register', kind: 'step', state: 'active', why: '' },
      { id: 's5', label: 'run tests', kind: 'step', state: 'pending', why: '' },
    ] },
    { id: 'm3', label: 'Ship', state: 'pending', why: '', steps: [] },
  ],
  grill: [],
  tasks: [{ id: 't1', text: 'write register', lane: 'now', by: 'agent' }],
  recap: ['built v1'],
}

/** MAP with the work moved on to the tests step. */
const MOVED = { ...MAP, milestones: MAP.milestones.map(m => (m.id === 'm2' ? { ...m, steps: m.steps.map(st => (st.id === 's4' ? { ...st, state: 'done' } : { ...st, state: 'active' })) } : m)) }

const PANE = {
  component: 'Pane',
  requestId: 'compass',
  props: { title: '🧭 compass', isFocused: true, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const base = (on: Parameters<typeof mock.clock>[0], toasts: string[] = []) => {
  on('session.id', () => ({ value: 'sess' }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'build v2', toolUses: [] }] }) as never)
  on('session.usage', () => ({ value: { startedAt: 1, context: { window: 1000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }) as never)
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
  on('tool.call', () => ({ result: {} as never, text: 'ok' }))
}

test('todoCourse: the TodoWrite item in progress is "now", the next pending one is "next"', async () => {
  expect(todoCourse([])).toBe(null)
  expect(todoCourse([{ text: 'a', status: 'completed' }, { text: 'b', status: 'pending' }])).toBe(null)
  expect(todoCourse([{ text: 'a', status: 'completed' }, { text: 'b', status: 'in_progress' }, { text: 'c', status: 'pending' }])).toEqual({ now: 'b', next: 'c' })
  expect(todoCourse([{ text: 'a', status: 'pending' }, { text: 'b', status: 'in_progress' }])).toEqual({ now: 'b', next: 'a' })
  // the row under the prompt shows it; a new request still comes first
  const map = parseMap(JSON.stringify(MAP), 1)
  const course = (chips: ReturnType<typeof hintChips>) => chips.find(c => c.key === 'course')!.parts.map(p => p.text ?? '').join('')
  expect(course(hintChips(map, 0, 0, 200, null, 0, true, { now: 'run the suite', next: 'fix lint' }))).toBe('✓ read docs │ ● run the suite │ ○ fix lint'.replace('✓ read docs │ ', ''))
  expect(course(hintChips(map, 0, 0, 200, 'ship it', 0, true, { now: 'run the suite', next: '' }))).toMatch(/● ship it/)
})

test('the brief rev ignores the course: the course alone moving changes no rev', async () => {
  const at = parseMap(JSON.stringify(MAP), 1)
  const moved = parseMap(JSON.stringify(MOVED), 1)
  const o = { grill: [], steers: [], userTasks: [], actions: [], confirm: null }
  const a = briefOf({ ...o, map: at })
  const b = briefOf({ ...o, map: moved })
  expect(a.course.now).toBe('write register')
  expect(b.course.now).toBe('run tests')
  expect(briefSig(a)).toBe(briefSig(b))
  // the agent's TodoWrite item in progress names "now" in the brief too
  expect(briefOf({ ...o, map: at, doing: { now: 'run the suite', next: '' } }).course.now).toBe('run the suite')
  // an actionable field still moves it
  expect(briefSig(briefOf({ ...o, map: at, steers: [{ text: 'use sqlite' }] }))).not.toBe(briefSig(a))
})

test('the course rides the next prompt, not tool results; an unchanged course adds nothing to a prompt', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  base(on)
  on('model.fork', () => ({ value: { isAnswered: true, text: JSON.stringify(MAP), usage } }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: '{"same":true}', usage } }) as never)
  let context: readonly string[] = []
  on('prompt.submit', (_$, e) => {
    context = (e as { context?: readonly string[] }).context ?? []
    return { text: e.text } as never
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await $.prompt.submit({ text: 'build v2' } as never)
  expect(context.join('\n')).toMatch(/compass brief · rev 1\]/)
  await $.turn.start({ text: 'build v2', turnId: 't1' } as never)
  await clock.advance(5000)
  const mid = await $.tool.call({ tool: 'Read', file_path: '/a.ts' } as never)
  expect((mid.context ?? []).join('\n')).not.toMatch(/compass brief/)
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.advance(2000)
  await $.prompt.submit({ text: 'go on' } as never)
  expect(context.join('\n')).toMatch(/compass brief · rev 1\]\n- course: goal "Build compass mod" · milestone "Build v2" · now "write register"/)
  await $.prompt.submit({ text: 'and again' } as never)
  expect(context.join('\n')).not.toMatch(/compass brief/)
})

test('nothing in the outbox waits for the turn to end: while Claude works, due items go into the running turn as one message', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const toasts: string[] = []
  base(on, toasts)
  mock.env(on, { HOME: '/nonexistent' })
  on('model.fork', () => ({ value: { isAnswered: false, reason: 'busy' } }) as never)
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'busy' } }) as never)
  on('ui.panes', () => ({ value: [] }))
  const submitted: string[] = []
  const appended: string[] = []
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text } as never
  })
  on('session.append', (_$, e) => {
    appended.push(JSON.stringify(e))
    return { value: {} } as never
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await $.turn.start({ text: 'build it', turnId: 't1' } as never)
  await $.tool.call({ tool: 'mcp__compass__grill', topic: 'cli', questions: [{ id: 'name', title: 'Name the CLI', body: 'Name?', recommendation: 'tstats', blocking: false }] } as never)
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  // a task the user adds (a note) and a non-blocking answer (a round), both while Claude works
  await tap(ui, 'tab:tasks')
  await ui.input({ key: 'task', text: 'add a metrics page' })
  await tap(ui, 'tab:grill')
  await tap(ui, 'gpark:name')
  // still inside the 8 s grace: nothing has gone
  await clock.advance(3000)
  const sent = () => toasts.filter(t => /sent into the running turn|session\.append/.test(t))
  expect(sent().length).toBe(0)
  await clock.advance(6000)
  // both went into the running turn together, and no new turn was started (the kit has no append
  // of its own and refuses it: the toasts name that one attempt, for both items)
  expect(submitted.length).toBe(0)
  expect(sent().length).toBe(2)
  expect(sent().join('\n')).toMatch(/metrics page|New task/)
  expect(sent().join('\n')).toMatch(/Name the CLI/)
  void appended
  await ui.unmount()
})

test('idle, a note still waits for the next prompt; a round starts a turn of its own', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  base(on)
  mock.env(on, { HOME: '/nonexistent' })
  on('model.fork', () => ({ value: { isAnswered: false, reason: 'busy' } }) as never)
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'busy' } }) as never)
  on('ui.panes', () => ({ value: [] }))
  const submitted: string[] = []
  let context: readonly string[] = []
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    context = (e as { context?: readonly string[] }).context ?? []
    return { text: e.text } as never
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  await tap(ui, 'tab:tasks')
  await ui.input({ key: 'task', text: 'add a metrics page' })
  await clock.advance(9000)
  expect(submitted.length).toBe(0)
  await $.prompt.submit({ text: 'go on' } as never)
  expect(context.join('\n')).toMatch(/add a metrics page/)
  await ui.unmount()
})

test('a slow full chart that lands after a newer course check keeps the newer "now" and lands the rest', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  base(on)
  let release: () => void = () => {}
  let forks = 0
  on('model.fork', async () => {
    forks += 1
    if (forks === 2) {
      await new Promise<void>(r => (release = r))
      // it saw the session before the work moved on, and has a recap of its own
      return { value: { isAnswered: true, text: JSON.stringify({ ...MAP, recap: ['the slow chart landed'] }), usage } } as never
    }
    return { value: { isAnswered: true, text: JSON.stringify(MAP), usage } } as never
  })
  let answer = '{"same":true}'
  on('model.complete', () => ({ value: { isAnswered: true, text: answer, usage } }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await $.turn.start({ text: 'build v2', turnId: 't1' } as never)
  await clock.advance(5000)
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'now:s4' })).toBeDefined()
  // a long turn: the 3-minute full chart starts, and is slow
  await clock.advance(181_000)
  expect(forks).toBe(2)
  // meanwhile a course check sees the work move on to the tests
  answer = JSON.stringify(MOVED)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'bun test' } as never)
  await clock.advance(13_000)
  expect(await ui.find({ key: 'now:s5' })).toBeDefined()
  // the slow chart lands: "now" stays on the tests, its recap lands
  release()
  await clock.advance(1000)
  expect(await ui.find({ key: 'now:s5' })).toBeDefined()
  expect(await ui.find({ key: 'now:s4' })).toBeUndefined()
  await tap(ui, 'tab:recap')
  expect(await ui.find({ text: /the slow chart landed/ })).toBeDefined()
  await ui.unmount()
})

test('the course check runs only while the pane is drawn, and once at once when it opens on an old course', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  base(on)
  on('model.fork', () => ({ value: { isAnswered: true, text: JSON.stringify(MAP), usage } }) as never)
  const quick: string[] = []
  on('model.complete', (_$, e) => {
    quick.push((e as { prompt: string }).prompt)
    return { value: { isAnswered: true, text: '{"same":true}', usage } } as never
  })
  let shown = false
  on('ui.panes', () => ({ value: shown ? [{ id: 'compass', title: 'compass', isShown: true, isFocused: false, isPlaced: true }] : [] }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await $.turn.start({ text: 'build v2', turnId: 't1' } as never)
  await clock.advance(5000)
  const at = quick.length
  // the pane is closed: tool calls finish, no check
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'bun test' } as never)
  await clock.advance(30_000)
  expect(quick.length).toBe(at)
  // the pane opens on a course 35 s old: one check at once
  shown = true
  await clock.advance(1100)
  expect(quick.length).toBe(at + 1)
  expect(quick[at]).toMatch(/Bash ok: bun test/)
})

test('the chart fork cannot post grill questions: its tool call is refused while a chart runs', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  base(on)
  let release: () => void = () => {}
  on('model.fork', async () => {
    await new Promise<void>(r => (release = r))
    return { value: { isAnswered: true, text: JSON.stringify(MAP), usage } } as never
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '{"same":true}', usage } }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await $.turn.start({ text: 'build v2', turnId: 't1' } as never)
  await clock.advance(5000)
  // while the chart runs, its fork (a loop with an agent id) tries the grill tool
  const posted = await $.tool.call({ tool: 'mcp__compass__grill', agentId: 'fork1', questions: [{ id: 'leak', title: 'Chart prompt leak', body: 'x', recommendation: 'y' }] } as never)
  expect(JSON.stringify(posted)).toMatch(/deny/)
  release()
  await clock.advance(1000)
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  await tap(ui, 'tab:grill')
  expect(await ui.find({ text: /Chart prompt leak/ })).toBeUndefined()
  await ui.unmount()
})

test('the stats tab counts compass model calls by kind and tab visits, on this machine', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  base(on)
  on('model.fork', () => ({ value: { isAnswered: true, text: JSON.stringify(MAP), usage } }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: '{"same":true}', usage } }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await $.turn.start({ text: 'build v2', turnId: 't1' } as never)
  await clock.advance(5000)
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.advance(2000)
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  await tap(ui, 'tab:live')
  await tap(ui, 'tab:grill')
  await tap(ui, 'tab:stats')
  const kinds = JSON.stringify(await ui.find({ text: /by kind:/ }))
  expect(kinds).toMatch(/chart 2×/)
  expect(kinds).toMatch(/turn 1×/)
  const tabs = JSON.stringify(await ui.find({ text: /tabs opened:/ }))
  expect(tabs).toMatch(/live 1/)
  expect(tabs).toMatch(/stats 1/)
  await ui.unmount()
})

test("compass marks its own questions, and holds them back while Claude's questions are open", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  base(on)
  const asked = { ...MAP, grill: [{ id: 'cache', title: 'Keep the cache warm', body: 'Warm it at start?', options: ['yes', 'no'], recommendation: 'yes' }] }
  on('model.fork', () => ({ value: { isAnswered: true, text: JSON.stringify(asked), usage } }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: '{"same":true}', usage } }) as never)
  let context: readonly string[] = []
  on('prompt.submit', (_$, e) => {
    context = (e as { context?: readonly string[] }).context ?? []
    return { text: e.text } as never
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  // Claude has a question open: the chart's own question waits
  await $.tool.call({ tool: 'mcp__compass__grill', questions: [{ id: 'db', title: 'Pick the database', body: 'Which?', recommendation: 'sqlite' }] } as never)
  await $.turn.start({ text: 'build v2', turnId: 't1' } as never)
  await clock.advance(5000)
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.advance(2000)
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  await tap(ui, 'tab:grill')
  expect(await ui.find({ text: /Keep the cache warm/ })).toBeUndefined()
  // Claude's question is settled: the next chart may ask, marked as compass's
  await tap(ui, 'gdrop:db')
  await $.turn.start({ text: 'go on', turnId: 't2' } as never)
  await clock.advance(5000)
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't2', reason: 'answer' } as never)
  await clock.advance(2000)
  expect(await ui.find({ text: /Keep the cache warm/ })).toBeDefined()
  expect(await ui.find({ text: /◈ compass · work/ })).toBeDefined()
  await $.prompt.submit({ text: 'next' } as never)
  expect(context.join('\n')).toMatch(/Keep the cache warm → recommended: yes \[asked by compass\]/)
  await ui.unmount()
})
