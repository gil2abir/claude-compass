import { expect, mock, test } from 'claude-code/testing'

import { barText, bodyOf, dotsText, hintChips, isDecided, span, transcriptDigest, leadOf, moveIn, wordWrap, boardOf, crumb, gist, peerKey, plain, frontierOf, mergeGrill, parseLoose, parseMap, senderOf } from '../hooks/register'

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
    { id: 'm1', label: 'Research mod API', state: 'done', why: '', steps: [
      { id: 's1', label: 'read docs', kind: 'step', state: 'done', why: '' },
      { id: 's2', label: 'fetch blog', kind: 'attempt', state: 'abandoned', why: 'not needed' },
    ] },
    { id: 'm2', label: 'Build v2', state: 'active', why: '', steps: [
      { id: 's3', label: 'adopt IBIS model', kind: 'decision', state: 'done', why: 'research backed' },
      { id: 's4', label: 'write register', kind: 'step', state: 'active', why: '' },
      { id: 's5', label: 'run tests', kind: 'step', state: 'pending', why: '' },
    ] },
    { id: 'm3', label: 'Ship', state: 'pending', why: '', steps: [] },
  ],
  grill: [{ id: 'q1', title: 'Keep status fallback', body: 'Keep the plain status line too?', options: ['keep', 'drop'], recommendation: 'drop' }],
  tasks: [
    { id: 't1', text: 'write register', lane: 'now', by: 'agent' },
    { id: 't2', text: 'old thing', lane: 'done', by: 'agent' },
    { id: 't3', text: 'publish', lane: 'later', by: 'agent' },
  ],
  recap: ['built v1', 'researched'],
}

const PANE = {
  component: 'Pane',
  requestId: 'compass',
  props: { title: '🧭 compass', isFocused: true, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

test('parseMap coerces a chatty reply', async () => {
  const map = parseMap(`sure:\n\`\`\`json\n${JSON.stringify({ ...MAP, milestones: [{ label: 'x', state: 'weird', steps: [{ label: 'y', kind: 'odd' }] }] })}\n\`\`\``, 1)
  expect(map?.milestones[0]?.state).toBe('pending')
  expect(map?.milestones[0]?.steps[0]?.kind).toBe('step')
  expect(map?.grill[0]?.options).toEqual(['keep', 'drop'])
  expect(parseMap('nope', 1)).toBe(null)
})

test('crumb names the path to now and what is next', async () => {
  const map = parseMap(JSON.stringify(MAP), 1)
  expect(crumb(map, 200)).toBe('Build compass mod › Build v2 › [write register] → run tests')
  expect(crumb(map, 30).length).toBe(30)
  expect(crumb(map, 30).endsWith('run tests')).toBe(true)
})

test('board puts unadopted user tasks first in now', async () => {
  const map = parseMap(JSON.stringify(MAP), 1)
  const board = boardOf(map, [{ id: 'u1', text: 'add dark mode' }])
  expect(board.now[0]?.text).toBe('add dark mode')
  expect(board.now[0]?.isQueued).toBe(true)
  expect(board.done.length).toBe(1)
})

test('pane draws the git-flow map, folds, and task board', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/nonexistent' })
  on('model.fork', () => ({ value: { isAnswered: true, text: JSON.stringify(MAP), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) as never)
  on('session.id', () => ({ value: 'sess' }))
  on('tool.call', () => ({ result: {} as never, text: 'ok' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.messages', () => ({ value: [
    { role: 'user', text: 'build a mod', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Write', input: { file_path: '/x.ts' } }, { tool_use_id: 'b', tool: 'Bash', input: {}, isError: true }] },
  ] }) as never)
  on('session.usage', () => ({ value: { startedAt: 500_000, context: { window: 1000, percent: 42 }, rateLimits: [], cost: { usd: 1.5 } } }) as never)
  on('session.start', (_$, e) => e as never)
  on('ui.status', () => ({ value: undefined }) as never)
  // a compass loaded mid-session replays the history on its own
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await clock.advance(1500)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'compass', surface, ...PANE })
    expect(await ui.find({ key: 'node:s4' })).toBeDefined()
    expect(await ui.find({ key: 'node:s4' })).toBeDefined()
    expect(await ui.find({ key: 'node:s5' })).toBeDefined()
    // done milestone is folded to one row
    expect(await ui.find({ key: 'node:s1' })).toBeUndefined()
    await tap(ui, 'msbtn:m1')
    expect(await ui.find({ key: 'node:s2' })).toBeDefined()
    await tap(ui, 'msbtn:m1')
    await tap(ui, 'tab:tasks')
    // the board: rows 0 chips · 1 rule · 2 DOING · 3 card t1 · 4 TO DO · 5 empty · 6 DONE (folded) · 7 rule · 8 BACKLOG · 9 t3
    expect(await ui.find({ text: /DOING/, in: 'board' })).toBeDefined()
    if (surface === 'terminal') {
      expect(await ui.find({ text: /write register/, in: 'board' })).toBeDefined()
      await ui.pointer({ type: 'down', x: 4, y: 3, button: 'left', in: 'board' })
      await ui.pointer({ type: 'move', x: 4, y: 6, button: 'left', in: 'board' })
      expect(await ui.find({ text: /drop here/, in: 'board' })).toBeDefined()
      await ui.pointer({ type: 'up', x: 4, y: 6, button: 'left', in: 'board' })
      // optimistic move, queued note with its badge, and the activity strip says so
      expect(await ui.find({ text: /DONE 2/, in: 'board' })).toBeDefined()
      expect(await ui.find({ text: /write register → DONE/ })).toBeDefined()
      const keys = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '')
      expect(keys.some(k => k.startsWith('force:'))).toBe(true)
    }
    await tap(ui, 'tab:flow')
    expect(await ui.find({ text: /dead end: tried/ })).toBeUndefined()
    await tap(ui, 'legend')
    expect(await ui.find({ text: /dead end: tried/ })).toBeDefined()
    await tap(ui, 'legend')
    await tap(ui, 'tab:stats')
    expect(await ui.find({ text: /42%/ })).toBeDefined()
    expect(await ui.find({ text: /\$ 1\.50/ })).toBeDefined()
    await tap(ui, 'tab:grill')
    expect(await ui.find({ key: 'gopt:q1:0' })).toBeDefined()
    await tap(ui, 'tab:flow')
    await ui.unmount()
  }
})

test('the hint line carries a clickable compass that opens the pane', async ($, on) => {
  mock.clock(on, { now: 1 })
  let opened = 0
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['? for shortcuts'] }) as never)
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => {
    opened += 1
    return { value: { isPlaced: true } } as never
  })
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } })
  const brand = await ui.find({ key: 'compass-crumb' })
  expect(brand?.type).toBe('Client')
  await ui.pointer({ type: 'down', x: 2, y: 0, button: 'left', in: 'compass-crumb' })
  await ui.pointer({ type: 'up', x: 2, y: 0, button: 'left', in: 'compass-crumb' })
  expect(opened).toBe(1)
  await ui.unmount()
})

test('a compass present from the first turn charts once there is history, and /clear starts over', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/nonexistent' })
  let hasHistory = false
  on('model.fork', () =>
    (hasHistory
      ? { value: { isAnswered: true, text: JSON.stringify(MAP), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
      : { value: { isAnswered: false, reason: 'nothing-to-fork' } }) as never)
  on('session.id', () => ({ value: 'sess' }))
  on('session.messages', () => ({ value: [] }) as never)
  on('session.usage', () => ({ value: { startedAt: 1_000_000, context: { window: 1000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('session.start', (_$, e) => e as never)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await clock.advance(1500)
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /waiting for your first prompt/ })).toBeDefined()
  expect(await ui.find({ text: /△/ })).toBeUndefined()

  hasHistory = true
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.advance(1500)
  expect(await ui.find({ key: 'node:s4' })).toBeDefined()

  await $.session.end({ reason: 'clear', sessionId: 'sess' } as never)
  expect(await ui.find({ key: 'node:s4' })).toBeUndefined()
  await ui.unmount()
})

test('a reply cut off mid-object still reads', async () => {
  const cut = '{"goal":"x","milestones":[{"id":"m1","label":"one","state":"active","steps":[{"id":"s1","label":"wri'
  const o = parseLoose(cut)
  expect(Array.isArray(o?.milestones)).toBe(true)
  expect(parseMap(cut, 1)?.milestones[0]?.steps[0]?.label).toBe('wri')
})

test('grill frontier holds back questions that depend on open ones', async () => {
  const items = mergeGrill([], [
    { id: 'a', title: 'store', body: '', options: [], rec: 'state', dependsOn: [], mode: 'plan', from: '' },
    { id: 'b', title: 'ttl', body: '', options: [], rec: '1h', dependsOn: ['a'], mode: 'plan', from: '' },
  ], 'cache', 'agent', 1)
  expect(frontierOf(items).ask.map(q => q.id)).toEqual(['a'])
  expect(frontierOf(items).waiting.map(q => q.id)).toEqual(['b'])
  const settled = items.map(q => (q.id === 'a' ? { ...q, state: 'settled' as const } : q))
  expect(frontierOf(settled).ask.map(q => q.id)).toEqual(['b'])
})

test('the agent posts a round, the user answers it, and the round goes back as one turn', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/nonexistent' })
  const submitted: string[] = []
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text } as never
  })
  on('model.fork', () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }) as never)
  on('session.id', () => ({ value: 'sess' }))
  on('session.messages', () => ({ value: [] }) as never)
  on('session.usage', () => ({ value: { startedAt: 1, context: { window: 1, percent: 1 }, rateLimits: [] } }) as never)
  on('session.start', (_$, e) => e as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)

  const posted = await $.tool.call({
    tool: 'mcp__compass__grill',
    topic: 'cache design',
    mode: 'plan',
    questions: [
      { id: 'store', title: 'Where to store', body: 'Memory or disk?', options: ['memory', 'disk'], recommendation: 'memory' },
      { id: 'ttl', title: 'Expiry', body: 'How long?', recommendation: '1h', dependsOn: ['store'] },
      { id: 'name', title: 'Name', body: 'What to call it?', recommendation: 'kv' },
    ],
  } as never)
  expect(String(posted.text)).toMatch(/2 on the frontier, 1 waiting/)

  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  await tap(ui, 'tab:grill')
  expect(await ui.find({ text: /Q1 · Where to store/ })).toBeDefined()
  expect(await ui.find({ text: /recommended/ })).toBeDefined()
  await tap(ui, 'gopt:store:1')
  expect(await ui.find({ text: /Q3 · Name/ })).toBeDefined()
  expect(submitted.length).toBe(0)
  await ui.input({ key: 'gans:name', text: '?why not reuse the old one' })
  await clock.advance(8100)
  expect(submitted.length).toBe(1)
  expect(submitted[0]).toMatch(/Q1 \(store\) Where to store → disk/)
  expect(submitted[0]).toMatch(/FOLLOW-UP.*why not reuse/)
  // the answer unblocked the next frontier
  expect(await ui.find({ text: /Q2 · Expiry/ })).toBeDefined()
  await ui.unmount()
})

test('the status crumb never carries broken characters', async () => {
  const map = parseMap(JSON.stringify({ ...MAP, goal: '🧭 Build\u200b compass 🚀', milestones: [{ id: 'm', label: 'Ship 🎉 it', state: 'active', steps: [{ id: 's', label: 'naïve café ✨ work', kind: 'step', state: 'active' }, { id: 'n', label: 'next 👩‍💻 step', kind: 'step', state: 'pending' }] }] }), 1)
  for (const w of [12, 17, 23, 31, 60, 200]) {
    const c = crumb(map, w)
    expect(c).not.toMatch(/\uFFFD|[\uD800-\uDFFF]|\p{Extended_Pictographic}|\u200b/u)
    expect(Array.from(c).length <= w).toBe(true)
  }
  expect(plain('a\u0007b 🧭 c')).toBe('ab c')
})

test('a resumed session reopens its chart from the plugin store without charting again', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined } as never
  })
  on('store.delete', (_$, e) => {
    store.delete(e.key)
    return { value: undefined } as never
  })
  on('store.keys', () => ({ value: [...store.keys()] }) as never)
  let forks = 0
  on('model.fork', () => {
    forks += 1
    return { value: { isAnswered: true, text: JSON.stringify(MAP), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })
  on('session.id', () => ({ value: 'sess-r' }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'hi', toolUses: [] }] }) as never)
  on('session.usage', () => ({ value: { startedAt: 1, context: { window: 1, percent: 1 }, rateLimits: [] } }) as never)
  on('session.start', (_$, e) => e as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await clock.advance(6000)
  expect(forks).toBe(1)
  const saved = store.get('snap:sess-r') as { sessionId?: string } | undefined
  expect(saved?.sessionId).toBe('sess-r')
  // a second start (a resume, or a reload) reopens it from the store: no new chart
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true, source: 'resume' } as never)
  await clock.advance(6000)
  expect(forks).toBe(1)
})

test('the status gist is the active cut, fits its budget, and uses plain glyphs only', async () => {
  const map = parseMap(JSON.stringify(MAP), 1)
  const full = gist(map, 2, 1, 200).map(p => p.text).join('')
  expect(full).toBe('◈ compass  ✓ adopt IBIS model › ● write register › ○ run tests  ? 2 to answer  1 queued')
  const odd = parseMap(JSON.stringify({ ...MAP, milestones: [{ id: 'm', label: 'Ship 🎉 it', state: 'active', steps: [
    { id: 'a', label: 'naïve café 👩‍💻 groundwork that is long', kind: 'step', state: 'done' },
    { id: 'b', label: 'a very long active step label here', kind: 'step', state: 'blocked' },
    { id: 'c', label: 'the following step which is long', kind: 'step', state: 'pending' },
  ] }] }), 1)
  for (const budget of [24, 30, 40, 55, 80, 120]) {
    const text = gist(odd, 3, 0, budget).map(p => p.text).join('')
    expect(Array.from(text).length <= budget).toBe(true)
    expect(text).not.toMatch(/\uFFFD|[\uD800-\uDFFF]|\p{Extended_Pictographic}/u)
    expect(text).toMatch(/[^\x20-\x7E\u00C0-\u024F◈✓●○›…!?/]/u.test(text) ? /^$/ : /compass/)
    expect(/needs you|\?3/.test(text)).toBe(true)
    // labels are whole or absent, never cut mid-word
    expect(text).not.toMatch(/…/)
    for (const label of ['a very long active step label here', 'the following step which is long']) {
      const at = text.indexOf(label.split(' ')[0]!)
      if (at >= 0 && text.slice(at).startsWith(label.slice(0, 8))) expect(text.includes(label)).toBe(true)
    }
  }
  expect(gist(odd, 3, 0, 120).map(p => p.text).join('')).toMatch(/a very long active step label here/)
  expect(gist(odd, 3, 0, 30).map(p => p.text).join('')).toMatch(/step 2\/3/)
})

test('a new request is "now" in the gist the moment its turn starts', async () => {
  const map = parseMap(JSON.stringify(MAP), 1)
  const text = gist(map, 0, 0, 200, 'fix the status line').map(p => p.text).join('')
  expect(text).toBe('◈ compass  ✓ write register › ● fix the status line › ○ updating…')
})

test('the hint line keeps the engine node under a prop-less Box', async ($, on) => {
  mock.clock(on, { now: 1 })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['esc to interrupt'] }) as never)
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', component: 'PromptHint', props: { isDraft: false, isWorking: true, hint: 'esc to interrupt' } })
  const root = await ui.drawn()
  expect(JSON.stringify(root)).toMatch(/esc to interrupt/)
  expect((root as { props?: Record<string, unknown> }).props ?? {}).toEqual({})
  await ui.unmount()
})

test('senderOf names a cross-session sender by from-name, keeping its address', async () => {
  const text = '<cross-session-message from="uds:/tmp/cc-socks/40977.sock" from-name="Docs agent" from-mode="prompting">hi there</cross-session-message>'
  expect(senderOf(text)).toEqual({ name: 'Docs agent', addr: 'uds:/tmp/cc-socks/40977.sock' })
  expect(bodyOf(text)).toBe('hi there')
  expect(senderOf('<x from="a84db9">y</x>')).toEqual({ name: 'a84db9', addr: 'a84db9' })
})

test('peerKey files outbound sends under the same thread as inbound', async () => {
  const chat = [{ peer: 'Docs agent', dir: 'in' as const, text: 'hi', at: 1, status: 'received' as const, addr: 'uds:/tmp/cc-socks/40977.sock' }]
  expect(peerKey('uds:/tmp/cc-socks/40977.sock', chat)).toBe('Docs agent')
  expect(peerKey('Docs agent [2aa26b]', chat)).toBe('Docs agent')
  expect(peerKey('other', chat)).toBe('other')
})

test('chat marks inbound/outbound, badges new messages, and opens a clickable history per agent', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/nonexistent' })
  on('session.id', () => ({ value: 'sess' }))
  on('tool.call', () => ({ result: {} as never, text: 'This session is me [abc123]\nLocal sessions (1):\n  Docs agent [2aa26b] · local · idle · 1m' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.messages', () => ({ value: [] }) as never)
  on('session.usage', () => ({ value: { startedAt: 500_000, context: { window: 1000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('session.start', (_$, e) => e as never)
  on('session.receive', (_$, e) => ({ text: e.text }))
  on('session.send', () => ({ isDelivered: true as const }))
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await $.session.receive({ origin: { kind: 'peer' }, text: '<cross-session-message from="uds:/tmp/cc-socks/1.sock" from-name="Docs agent" from-mode="prompting">can you run the benchmark? Use the faster runner and send me the per-file timings when it finishes.</cross-session-message>' })
  await clock.advance(1000)
  await $.session.send({ to: 'uds:/tmp/cc-socks/1.sock', text: 'running it now', origin: { kind: 'model' } } as never)

  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  await tap(ui, 'tab:chat')
  expect(await ui.find({ key: 'tab:chat' })).toBeDefined()
  expect(await ui.find({ key: 'tabn:chat', text: /1/ })).toBeDefined()
  expect(await ui.find({ text: /● 1 new/ })).toBeDefined()
  expect(await ui.find({ text: /◂ 1/ })).toBeDefined()
  await tap(ui, 'peer:Docs agent')
  expect(await ui.find({ text: /◂ 1 in/ })).toBeDefined()
  expect(await ui.find({ text: /▸ 1 out/ })).toBeDefined()
  expect(await ui.find({ text: /◂ in/ })).toBeDefined()
  expect(await ui.find({ text: /▸ out/ })).toBeDefined()
  const rows = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('b:m:Docs agent'))
  expect(rows.length).toBe(2)
  expect(await ui.find({ key: rows[0]!, text: /can you run the benchmark\? ▸$/ })).toBeDefined()
  await tap(ui, rows[0]!)
  expect(await ui.find({ text: /per-file timings/ })).toBeDefined()
  await tap(ui, 'peer:Docs agent')
  expect(await ui.find({ text: /● 1 new/ })).toBeUndefined()
  expect(await ui.find({ key: 'tabn:chat' })).toBeUndefined()
  await ui.unmount()
})

test('wordWrap breaks between words and keeps every word', async () => {
  const rows = wordWrap('rename the session crumb so the hint line reads clearly', 16)
  expect(rows.every(r => Array.from(r).length <= 16)).toBe(true)
  expect(rows.join(' ')).toBe('rename the session crumb so the hint line reads clearly')
  expect(wordWrap('supercalifragilistic', 8)).toEqual(['supercal', 'ifragili', 'stic'])
})

test('leadOf takes the first sentence whole and flags the rest', async () => {
  expect(leadOf('Done. Tests pass and the PR is up.')).toEqual({ lead: 'Done.', hasMore: true })
  expect(leadOf('just one line')).toEqual({ lead: 'just one line', hasMore: false })
  const long = leadOf(`${'word '.repeat(60)}end.`, 40)
  expect(long.lead.endsWith('word…')).toBe(true)
  expect(long.hasMore).toBe(true)
})

test('the outbox lists what goes to the session and when, and lets the user reorder, preview and remove', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/nonexistent' })
  on('session.id', () => ({ value: 'sess' }))
  on('tool.call', () => ({ result: {} as never, text: '' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.messages', () => ({ value: [] }) as never)
  on('session.usage', () => ({ value: { startedAt: 500_000, context: { window: 1000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('session.start', (_$, e) => e as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  let context: readonly string[] = []
  on('prompt.submit', (_$, e) => {
    context = (e as { context?: readonly string[] }).context ?? []
    return { text: (e as { text: string }).text } as never
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)

  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  await tap(ui, 'tab:tasks')
  for (const t of ['alpha task', 'beta task', 'gamma task']) await ui.input({ key: 'task', text: t })
  expect(await ui.find({ text: /⇣ 3/ })).toBeDefined()
  const ids = async () => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('drop:')).map(k => k.slice(5))
  const [a, b, c] = await ids()
  // gamma up one: alpha, gamma, beta
  await ui.press({ key: `up:${c}` })
  expect(await ids()).toEqual([a, c, b])
  // preview shows the exact text
  await ui.press({ key: `obl:${b}` })
  expect(await ui.find({ text: /│ .*beta task/ })).toBeDefined()
  // remove alpha: its task leaves the board too
  await ui.press({ key: `drop:${a}` })
  expect(await ids()).toEqual([c, b])
  await $.prompt.submit({ text: 'go on' } as never)
  const note = context.join('\n')
  expect(note).not.toMatch(/alpha task/)
  expect(note.indexOf('gamma task') < note.indexOf('beta task')).toBe(true)
  expect(await ui.find({ text: /outbox empty/ })).toBeDefined()
  await clock.advance(10)
  await ui.unmount()
})

test('moveIn swaps only within the same queue', async () => {
  const mk = (id: string, route: 'new turn' | 'next prompt', status: 'queued' | 'sent' = 'queued') =>
    ({ id, kind: 'note', label: id, text: id, status, route, reason: '', at: 0, ref: '', prev: '' }) as const
  const list = [mk('t1', 'new turn'), mk('p1', 'next prompt'), mk('s', 'next prompt', 'sent'), mk('p2', 'next prompt')]
  expect(moveIn([...list], 'p2', -1).map(a => a.id)).toEqual(['t1', 'p2', 's', 'p1'])
  expect(moveIn([...list], 't1', 1).map(a => a.id)).toEqual(['t1', 'p1', 's', 'p2'])
})

test('the sync line says whether the chart has caught up with the session', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/nonexistent' })
  let isUp = true
  on('model.fork', () =>
    (isUp
      ? { value: { isAnswered: true, text: JSON.stringify(MAP), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
      : { value: { isAnswered: false, reason: 'busy' } }) as never)
  on('session.id', () => ({ value: 'sess' }))
  on('session.messages', () => ({ value: [] }) as never)
  on('session.usage', () => ({ value: { startedAt: 1_000_000, context: { window: 1000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('session.start', (_$, e) => e as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /outbox empty/ })).toBeDefined()

  await $.turn.start({ text: 'build it', turnId: 't1' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.advance(1500)
  expect(await ui.find({ text: /✓ in sync/ })).toBeDefined()

  // the next chart fails: the pane says it is behind and offers ↻
  isUp = false
  await $.turn.start({ text: '<task-notification>done</task-notification>', turnId: 't2' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't2', reason: 'answer' } as never)
  await clock.advance(1500)
  // idle and behind: it says to press ↻ update, and offers it
  expect(await ui.find({ text: /1 turn behind/ })).toBeDefined()
  expect(await ui.find({ text: /press ↻ update/ })).toBeDefined()
  expect(await ui.find({ key: 'sync:refresh' })).toBeDefined()

  // a new message mid-turn is named until a chart includes it
  await $.turn.start({ text: 'fix the header', turnId: 't3' } as never)
  // mid-turn: it says what is going on and that there is nothing to do
  expect(await ui.find({ text: /your new message/ })).toBeDefined()
  expect(await ui.find({ text: /nothing to do/ })).toBeDefined()
  await ui.unmount()
})

test('a steer waits in the outbox with a countdown, can be cancelled, and otherwise goes into the running turn', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/nonexistent' })
  on('model.fork', () => ({ value: { isAnswered: false, reason: 'busy' } }) as never)
  on('session.id', () => ({ value: 'sess' }))
  on('session.messages', () => ({ value: [] }) as never)
  on('session.usage', () => ({ value: { startedAt: 1_000_000, context: { window: 1000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('session.start', (_$, e) => e as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  // the kit has no session.append for a plugin's own append: a toast names each attempt either way
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)
  const attempts = (label: string) => toasts.filter(t => t.includes(label) && /running turn|session\.append/.test(t)).length
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await $.turn.start({ text: 'work', turnId: 't1' } as never)
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })

  await ui.input({ key: 'steer', text: 'drop the cache idea' })
  await clock.advance(2000)
  expect(await ui.find({ text: /^●{5,7}·{1,3} $/ })).toBeDefined()
  const id = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').find(k => k.startsWith('drop:'))!.slice(5)
  await ui.press({ key: `drop:${id}` })
  await clock.advance(10_000)
  expect(attempts('drop the cache idea')).toBe(0)

  await ui.input({ key: 'steer', text: 'use the faster runner' })
  await clock.advance(9000)
  expect(attempts('use the faster runner')).toBe(1)
  expect(await ui.find({ text: /outbox empty/ })).toBeDefined()
  await ui.unmount()
})

test('the outbox is pinned to the bottom of the pane window as it scrolls', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/nonexistent' })
  on('session.id', () => ({ value: 'sess' }))
  for (const offset of [0, 7]) {
    const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE, props: { ...PANE.props, scroll: { offset, bodyRows: 30 } } })
    const foot = await ui.find({ key: 'activity' })
    // the "outbox empty" row alone, on the window's last row
    expect(foot?.props?.top).toBe(offset + 30 - 1)
    await ui.unmount()
  }
})

test('a fork shows the planned path and one branch; taking the branch steers and redraws, ✕ undoes it, keeping it is not offered again', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/nonexistent' })
  const ALT = { ...MAP, alt: { label: 'ship as a skill', why: 'simpler install, no pane', steps: ['write SKILL md', 'drop the plugin'] } }
  const prompts: string[] = []
  on('model.fork', (_$, e) => {
    prompts.push((e as { prompt: string }).prompt)
    return { value: { isAnswered: true, text: JSON.stringify(ALT), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })
  on('session.id', () => ({ value: 'sess' }))
  on('session.messages', () => ({ value: [] }) as never)
  on('session.usage', () => ({ value: { startedAt: 1_000_000, context: { window: 1000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('session.start', (_$, e) => e as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.advance(1500)
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /two ways on/ })).toBeDefined()
  expect(await ui.find({ text: /^ship as a skill$/ })).toBeDefined()
  expect(await ui.find({ key: 'pick:main' })).toBeDefined()

  // take the branch: the planned step is dropped, the branch's steps are the new future, a steer waits
  await tap(ui, 'pick:branch')
  expect(await ui.find({ text: /two ways on/ })).toBeUndefined()
  expect(await ui.find({ text: /write SKILL md/ })).toBeDefined()
  expect(await ui.find({ text: /run tests · not chosen/ })).toBeDefined()
  expect(await ui.find({ text: /⇣ 1/ })).toBeDefined()
  // ✕ before it is sent puts the fork back
  const id = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').find(k => k.startsWith('drop:'))!.slice(5)
  await ui.press({ key: `drop:${id}` })
  expect(await ui.find({ text: /two ways on/ })).toBeDefined()

  // keep the plan: a note for the next prompt, and the next chart does not offer it again
  await tap(ui, 'pick:main')
  expect(await ui.find({ text: /two ways on/ })).toBeUndefined()
  await $.turn.start({ text: 'more', turnId: 't2' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't2', reason: 'answer' } as never)
  await clock.advance(1500)
  expect(prompts[prompts.length - 1]).toMatch(/already decided.*ship as a skill/)
  expect(await ui.find({ text: /two ways on/ })).toBeUndefined()
  await ui.unmount()
})

test('the fork stays until the user picks, even when the next chart offers no branch', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/nonexistent' })
  let withAlt = true
  const ALT = { ...MAP, alt: { label: 'ship as a skill', why: 'simpler install', steps: ['write SKILL md', 'drop the plugin'] } }
  on('model.fork', () => ({ value: { isAnswered: true, text: JSON.stringify(withAlt ? ALT : MAP), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) as never)
  on('session.id', () => ({ value: 'sess' }))
  on('session.messages', () => ({ value: [] }) as never)
  on('session.usage', () => ({ value: { startedAt: 1_000_000, context: { window: 1000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('session.start', (_$, e) => e as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  for (const [i, alt] of [[1, true], [2, false]] as const) {
    withAlt = alt
    await $.turn.start({ text: `turn ${i}`, turnId: `t${i}` } as never)
    await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: `t${i}`, reason: 'answer' } as never)
    await clock.advance(1500)
    expect(await ui.find({ text: /two ways on/ })).toBeDefined()
  }
  await ui.unmount()
})

test('a fork the user decided is not offered again while the work waits, not the same branch nor its reverse', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/nonexistent' })
  const BRANCH = { label: 'wait for prod deploy', why: 'verify on real traffic', steps: ['watch deploy logs', 'rerun benchmark after deploy'] }
  // after the pick the model keeps reporting the same fork: once as before, once reversed, once reworded
  const replies = [
    { ...MAP, alt: BRANCH },
    { ...MAP, alt: BRANCH },
    { ...MAP, alt: { label: 'run tests now', why: 'skip waiting', steps: ['run tests', 'publish'] } },
    { ...MAP, alt: { label: 'wait for the prod deploy first', why: '', steps: ['watch the deploy logs'] } },
  ]
  let n = 0
  on('model.fork', () => ({ value: { isAnswered: true, text: JSON.stringify(replies[Math.min(n++, replies.length - 1)]), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) as never)
  on('session.id', () => ({ value: 'sess' }))
  on('session.messages', () => ({ value: [] }) as never)
  on('session.usage', () => ({ value: { startedAt: 1_000_000, context: { window: 1000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('session.start', (_$, e) => e as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)
  const turn = async (i: number) => {
    await $.turn.start({ text: `turn ${i}`, turnId: `t${i}` } as never)
    await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: `t${i}`, reason: 'answer' } as never)
    await clock.advance(1500)
  }
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  await turn(1)
  expect(await ui.find({ text: /two ways on/ })).toBeDefined()
  await tap(ui, 'pick:branch')
  await clock.advance(9000)
  for (const i of [2, 3, 4]) {
    await turn(i)
    expect(await ui.find({ text: /two ways on/ })).toBeUndefined()
  }
  await ui.unmount()
})

test('isDecided matches the same fork, reworded or reversed', async () => {
  const decided = ['wait for prod deploy', 'watch deploy logs rerun benchmark after deploy', 'run tests publish']
  expect(isDecided({ label: 'wait for the prod deploy first', why: '', steps: ['watch logs'] }, decided)).toBe(true)
  expect(isDecided({ label: 'run tests now', why: '', steps: ['run tests', 'publish'] }, decided)).toBe(true)
  expect(isDecided({ label: 'rewrite in rust', why: '', steps: ['port the parser'] }, decided)).toBe(false)
})

test('a grill question can be dismissed: it settles, the agent hears it, and it is not asked again', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/nonexistent' })
  on('session.id', () => ({ value: 'sess' }))
  on('session.messages', () => ({ value: [] }) as never)
  on('session.usage', () => ({ value: { startedAt: 1_000_000, context: { window: 1000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('session.start', (_$, e) => e as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)
  let context: readonly string[] = []
  on('prompt.submit', (_$, e) => {
    context = (e as { context?: readonly string[] }).context ?? []
    return { text: (e as { text: string }).text } as never
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  const post = (id: string, title: string) =>
    $.tool.call({ tool: 'mcp__compass__grill', topic: 'release', questions: [{ id, title, body: `${title}?`, options: ['yes', 'no'], recommendation: 'yes' }] } as never)
  await post('r1', 'Wait for prod deploy')
  await post('r2', 'Bump the major version')
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  await tap(ui, 'tab:grill')
  expect(await ui.find({ key: 'gdrop:r1' })).toBeDefined()
  await tap(ui, 'gdrop:r1')
  expect(await ui.find({ key: 'gopt:r1:0' })).toBeUndefined()
  expect(await ui.find({ key: 'gopt:r2:0' })).toBeDefined()
  // re-posted under a new id, it stays dismissed
  await post('r9', 'Wait for prod deploy')
  expect(await ui.find({ key: 'gopt:r9:0' })).toBeUndefined()
  await $.prompt.submit({ text: 'go on' } as never)
  expect(context.join('\n')).toMatch(/Dismissed grill question Q1 "Wait for prod deploy"/)
  await ui.unmount()
})

test('indicator helpers: level bars, countdown pixels, short spans', async () => {
  expect(barText(0, 5)).toBe('     ')
  expect(barText(1, 5)).toBe('█████')
  expect(barText(0.5, 4)).toBe('██  ')
  expect(Array.from(barText(0.3, 10)).length).toBe(10)
  expect(dotsText(3, 8)).toBe('●●●·····')
  expect(span(45_000)).toBe('45s')
  expect(span(160 * 60_000)).toBe('2h 40m')
  expect(span(31 * 3_600_000)).toBe('1d 7h')
})

test('skipping a step from the flow and cancelling it in the outbox puts the step back; the chart ignores a queued steer', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/nonexistent' })
  const prompts: string[] = []
  on('model.fork', (_$, e) => {
    prompts.push((e as { prompt: string }).prompt)
    return { value: { isAnswered: true, text: JSON.stringify(MAP), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })
  on('session.id', () => ({ value: 'sess' }))
  on('session.messages', () => ({ value: [] }) as never)
  on('session.usage', () => ({ value: { startedAt: 1_000_000, context: { window: 1000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('session.start', (_$, e) => e as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.advance(1500)
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  await tap(ui, 'node:s5')
  await tap(ui, 'skip:s5')
  expect(await ui.find({ text: /run tests · skipped by you/ })).toBeDefined()
  // a chart made now does not see the queued steer
  await tap(ui, 'sync:refresh')
  await clock.advance(1500)
  expect(prompts[prompts.length - 1]).not.toMatch(/Skip this/)
  const id = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').find(k => k.startsWith('drop:'))!.slice(5)
  await tap(ui, `drop:${id}`)
  expect(await ui.find({ text: /skipped by you/ })).toBeUndefined()
  expect(await ui.find({ key: 'node:s5' })).toBeDefined()
  // a turn compass itself submitted is not "your new message"
  await $.turn.start({ text: 'The compass plugin sent a message: 🧭 [compass — steering from the user] go', turnId: 't2' } as never)
  expect(await ui.find({ text: /new message not charted/ })).toBeUndefined()
  await ui.unmount()
})

test('cancelling a grill round in the outbox puts its answers back', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/nonexistent' })
  on('session.id', () => ({ value: 'sess' }))
  on('session.messages', () => ({ value: [] }) as never)
  on('session.usage', () => ({ value: { startedAt: 1_000_000, context: { window: 1000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('session.start', (_$, e) => e as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: 'mcp__compass__grill', topic: 'release', questions: [{ id: 'r1', title: 'Ship today', body: 'Ship?', options: ['yes', 'no'], recommendation: 'yes' }] } as never)
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  await tap(ui, 'tab:grill')
  await tap(ui, 'gopt:r1:0')
  expect(await ui.find({ text: /⇣ 1/ })).toBeDefined()
  const id = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').find(k => k.startsWith('drop:'))!.slice(5)
  await tap(ui, `drop:${id}`)
  // answered again, not settled: the round can be resent
  expect(await ui.find({ text: /round 1/ })).toBeDefined()
  expect(await ui.find({ text: /0 settled/ })).toBeDefined()
  await ui.unmount()
})

test('the row under the prompt is one panel of chips; parts leave a chip before whole chips go', async () => {
  const map = parseMap(JSON.stringify(MAP), 1)
  const text = (c: { parts: { text?: string }[] }) => c.parts.map(x => x.text ?? '').join('')
  const wide = hintChips(map, 2, 1, 200)
  expect(wide.map(c => c.key)).toEqual(['course', 'steps', 'ask', 'queue'])
  expect(text(wide[0]!)).toBe('✓ adopt IBIS model │ ● write register │ ○ run tests')
  expect(text(wide[1]!)).toMatch(/1\/3 steps/)
  // tighter: the course chip keeps "now" only, the badges shorten, then progress goes
  const mid = hintChips(map, 2, 1, 70)
  expect(text(mid[0]!)).toBe('● write register')
  const narrow = hintChips(map, 2, 1, 40)
  expect(narrow.map(c => c.key)).toEqual(['course', 'ask'])
  for (const room of [24, 40, 60, 90, 140]) {
    const used = 1 + 11 + hintChips(map, 2, 1, room).reduce((n, c) => n + 1 + c.width, 0) + 1
    expect(used <= room).toBe(true)
  }
})

test('the first chart lands during the first turn: with nothing to fork yet, it is drawn from the request', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const asked: string[] = []
  on('model.fork', () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }) as never)
  on('model.complete', (_$, e) => {
    asked.push((e as { prompt: string }).prompt)
    return { value: { isAnswered: true, text: JSON.stringify(MAP), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })
  on('session.id', () => ({ value: 'sess' }))
  on('session.messages', () => ({ value: [] }) as never)
  on('session.usage', () => ({ value: { startedAt: 1_000_000, context: { window: 1000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('session.start', (_$, e) => e as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  await $.turn.start({ text: 'build a compass mod for claude code', turnId: 't1' } as never)
  await clock.advance(5000)
  // still in the first turn, and the chart is up
  expect(asked.length).toBe(1)
  expect(asked[0]).toMatch(/first request: build a compass mod for claude code/)
  expect(await ui.find({ key: 'node:s4' })).toBeDefined()
  await ui.unmount()
})

test('the grill is a decision radar: blocking vs open, park and bring back, settled by the session, mirrored in the flow', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  let reply: Record<string, unknown> = { ...MAP, grill: [] }
  on('model.fork', () => ({ value: { isAnswered: true, text: JSON.stringify(reply), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) as never)
  on('session.id', () => ({ value: 'sess' }))
  on('session.messages', () => ({ value: [] }) as never)
  on('session.usage', () => ({ value: { startedAt: 1_000_000, context: { window: 1000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('session.start', (_$, e) => e as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)
  let context: readonly string[] = []
  on('prompt.submit', (_$, e) => {
    context = (e as { context?: readonly string[] }).context ?? []
    return { text: (e as { text: string }).text } as never
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  await tap(ui, 'tab:grill')
  // empty: it says what lands here and when
  expect(await ui.find({ text: /decisions land here/ })).toBeDefined()
  expect(await ui.find({ text: /after every turn, compass looks for new goals/ })).toBeDefined()

  await $.tool.call({ tool: 'mcp__compass__grill', topic: 'release', questions: [
    { id: 'db', title: 'Pick the database', body: 'Which?', options: ['sqlite', 'postgres'], recommendation: 'sqlite', blocking: true },
    { id: 'name', title: 'Name the CLI', body: 'Name?', recommendation: 'tstats', blocking: false },
  ] } as never)
  expect(await ui.find({ text: /⏸ 1 blocking/ })).toBeDefined()
  expect(await ui.find({ text: /\? 1 open/ })).toBeDefined()
  expect(await ui.find({ text: /work waits on this/ })).toBeDefined()

  // park the open one: it leaves the questions, the session hears it on the next prompt
  await tap(ui, 'gsel:name')
  await tap(ui, 'gpark:name')
  expect(await ui.find({ text: /◌ 1 parked/ })).toBeDefined()
  await $.prompt.submit({ text: 'go on' } as never)
  expect(context.join('\n')).toMatch(/Parked grill question Q2 "Name the CLI": do not wait for it.*recommendation \(tstats\)/)
  // bring it back
  await tap(ui, 'fold:gparked')
  await tap(ui, 'gunpark:name')
  expect(await ui.find({ text: /◌ 0 parked/ })).toBeDefined()

  // the flow mirrors it: the blocking one waits on you, the other is open while work goes on
  await tap(ui, 'tab:flow')
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.advance(1500)
  expect(await ui.find({ text: /waits on you/ })).toBeDefined()
  expect(await ui.find({ text: /open · work goes on/ })).toBeDefined()

  // the conversation settled the database: the next chart says so and it leaves the open list
  reply = { ...MAP, grill: [], moot: ['db'] }
  await $.turn.start({ text: 'more', turnId: 't2' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't2', reason: 'answer' } as never)
  await clock.advance(1500)
  expect(await ui.find({ text: /waits on you/ })).toBeUndefined()
  await tap(ui, 'tab:grill')
  expect(await ui.find({ text: /✓ 1 settled/ })).toBeDefined()
  await ui.unmount()
})

test('the chart does not repeat a question already in the grill, reworded or not', async () => {
  const at = 1
  const agent = mergeGrill([], [{ id: 'fmt', title: 'JSON output shape', body: 'Array of objects, JSON Lines, or both via a flag?', options: [], rec: 'both', dependsOn: [], mode: 'plan', from: '', blocking: true }], 'csv', 'agent', at)
  const merged = mergeGrill(agent, [
    { id: 'x1', title: 'Output shape for JSON', body: 'Emit an array of objects or JSON Lines?', options: [], rec: '', dependsOn: [], mode: 'work', from: '', blocking: false },
    { id: 'x2', title: 'Package name', body: 'What to call the package?', options: [], rec: '', dependsOn: [], mode: 'work', from: '', blocking: false },
  ], 'csv', 'map', at)
  expect(merged.map(q => q.id)).toEqual(['fmt', 'x2'])
})

test('a resumed session with nothing to fork is charted from its saved conversation, and says so while it works', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const asked: string[] = []
  on('model.fork', () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }) as never)
  on('model.complete', (_$, e) => {
    asked.push((e as { prompt: string }).prompt)
    return { value: { isAnswered: true, text: JSON.stringify(MAP), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })
  on('session.id', () => ({ value: 'sess-old' }))
  on('session.messages', () => ({ value: [
    { role: 'user', text: 'ship the POD links page', toolUses: [] },
    { role: 'assistant', text: 'Plan: build the page, then deploy.', toolUses: [{ tool_use_id: 'a', tool: 'Write', input: { file_path: '/x' } }] },
    { role: 'user', text: 'also fix the RTL card', toolUses: [] },
  ] }) as never)
  on('session.usage', () => ({ value: { startedAt: 1, context: { window: 1000, percent: 40 }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('session.start', (_$, e) => e as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true, source: 'resume' } as never)
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  await clock.advance(1500)
  expect(asked.length).toBe(1)
  expect(asked[0]).toMatch(/first request: ship the POD links page/)
  expect(asked[0]).toMatch(/USER: also fix the RTL card/)
  expect(await ui.find({ key: 'node:s4' })).toBeDefined()
  // one update button, in the sync line
  expect(await ui.find({ key: 'refresh' })).toBeUndefined()
  expect(await ui.find({ key: 'sync:refresh' })).toBeDefined()
  await ui.unmount()
})

test('transcriptDigest keeps the first request and the latest exchanges within its cap', async () => {
  const msgs = [{ role: 'user', text: 'first ask', toolUses: [] }, ...Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', text: `message ${i} ${'x'.repeat(200)}`, toolUses: [] }))]
  const d = transcriptDigest(msgs, 3000)
  expect(d).toMatch(/first request: first ask/)
  expect(d).toMatch(/message 199/)
  expect(d.length < 3000 + 300).toBe(true)
})

test('a session too long to fork is charted from a digest; an interrupted turn is left alone', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  let forkReason = 'api-error'
  const asked: string[] = []
  on('model.fork', () => ({ value: { isAnswered: false, reason: forkReason, status: 400, error: 'invalid_request_error' } }) as never)
  on('model.complete', (_$, e) => {
    asked.push((e as { prompt: string }).prompt)
    return { value: { isAnswered: true, text: JSON.stringify(MAP), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })
  on('session.id', () => ({ value: 'sess-long' }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'a very long session', toolUses: [] }, { role: 'assistant', text: 'lots of work', toolUses: [] }] }) as never)
  on('session.usage', () => ({ value: { startedAt: 1, context: { window: 1000, percent: 95 }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('session.start', (_$, e) => e as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  await clock.advance(1500)
  expect(asked.length).toBe(1)
  expect(await ui.find({ key: 'node:s4' })).toBeDefined()
  expect(await ui.find({ text: /chart not updated/ })).toBeUndefined()
  // aborted: no fallback call
  forkReason = 'aborted'
  await tap(ui, 'sync:refresh')
  await clock.advance(1500)
  expect(asked.length).toBe(1)
  await ui.unmount()
})
