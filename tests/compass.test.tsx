import { expect, mock, test } from 'claude-code/testing'

import { bodyOf, leadOf, moveIn, wordWrap, boardOf, crumb, gist, peerKey, plain, frontierOf, mergeGrill, parseLoose, parseMap, senderOf } from '../hooks/register'

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
  on('fs.read', () => { throw new Error('none') })
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
    await ui.press({ key: 'msbtn:m1' })
    expect(await ui.find({ key: 'node:s2' })).toBeDefined()
    await ui.press({ key: 'msbtn:m1' })
    await ui.press({ key: 'tab:tasks' })
    // the board: rows 0 chips · 1 rule · 2 DOING · 3 card t1 · 4 TO DO · 5 empty · 6 DONE (folded) · 7 rule · 8 BACKLOG · 9 t3
    expect(await ui.find({ text: /DOING/, in: 'board' })).toBeDefined()
    if (surface === 'terminal') {
      expect(await ui.find({ text: /write register/, in: 'board' })).toBeDefined()
      await ui.pointer({ type: 'down', x: 4, y: 3, button: 'left', in: 'board' })
      await ui.pointer({ type: 'move', x: 4, y: 6, button: 'left', in: 'board' })
      expect(await ui.find({ text: /drop here/, in: 'board' })).toBeDefined()
      await ui.pointer({ type: 'up', x: 4, y: 6, button: 'left', in: 'board' })
      // optimistic move, queued note with its badge, and the activity strip says so
      expect(await ui.find({ text: /DONE ·2/, in: 'board' })).toBeDefined()
      expect(await ui.find({ text: /write register → DONE/ })).toBeDefined()
      const keys = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '')
      expect(keys.some(k => k.startsWith('force:'))).toBe(true)
    }
    await ui.press({ key: 'tabicon:flow' })
    expect(await ui.find({ text: /dead end: tried/ })).toBeUndefined()
    await ui.press({ key: 'legend' })
    expect(await ui.find({ text: /dead end: tried/ })).toBeDefined()
    await ui.press({ key: 'legend' })
    await ui.press({ key: 'tabicon:stats' })
    expect(await ui.find({ text: /42%/ })).toBeDefined()
    expect(await ui.find({ text: /\$1\.50/ })).toBeDefined()
    await ui.press({ key: 'tab:grill' })
    expect(await ui.find({ key: 'gopt:q1:0' })).toBeDefined()
    await ui.press({ key: 'tab:flow' })
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
  on('fs.read', () => { throw new Error('none') })
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
  expect(await ui.find({ text: /after the first turn/ })).toBeDefined()
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
  on('fs.read', () => { throw new Error('none') })
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
  await ui.press({ key: 'tab:grill' })
  expect(await ui.find({ text: /Q1 · Where to store/ })).toBeDefined()
  expect(await ui.find({ text: /recommended/ })).toBeDefined()
  await ui.press({ key: 'gopt:store:1' })
  expect(await ui.find({ text: /Q3 · Name/ })).toBeDefined()
  expect(submitted.length).toBe(0)
  await ui.input({ key: 'gans:name', text: '?why not reuse the old one' })
  await clock.advance(5100)
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

test('a resumed session reopens its chart from the session folder without charting again', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/home/u' })
  const files = new Map<string, string>()
  on('fs.read', (_$, e) => {
    const path = (e as unknown as { path: string }).path
    if (!files.has(path)) throw new Error('missing')
    return { value: files.get(path)! } as never
  })
  on('fs.write', (_$, e) => {
    const { path, text } = e as unknown as { path: string; text: string }
    files.set(path, text)
    return { value: undefined } as never
  })
  let forks = 0
  on('model.fork', () => {
    forks += 1
    return { value: { isAnswered: true, text: JSON.stringify(MAP), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })
  on('session.id', () => ({ value: 'sess-r' }))
  on('session.root', () => ({ value: '/Users/u/code' }) as never)
  on('session.messages', () => ({ value: [{ role: 'user', text: 'hi', toolUses: [] }] }) as never)
  on('session.usage', () => ({ value: { startedAt: 1, context: { window: 1, percent: 1 }, rateLimits: [] } }) as never)
  on('session.start', (_$, e) => e as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)
  on('tool.call', () => ({ result: '' as never, text: '' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await clock.advance(6000)
  expect(forks).toBe(1)
  const path = '/home/u/.claude/projects/-Users-u-code/sess-r/compass/snapshot.json'
  expect(files.has(path)).toBe(true)
  expect(JSON.parse(files.get(path)!).sessionId).toBe('sess-r')
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
    expect(text).toMatch(/!/)
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
  const text = '<cross-session-message from="uds:/tmp/cc-socks/40977.sock" from-name="Genie prod" from-mode="prompting">hi there</cross-session-message>'
  expect(senderOf(text)).toEqual({ name: 'Genie prod', addr: 'uds:/tmp/cc-socks/40977.sock' })
  expect(bodyOf(text)).toBe('hi there')
  expect(senderOf('<x from="a84db9">y</x>')).toEqual({ name: 'a84db9', addr: 'a84db9' })
})

test('peerKey files outbound sends under the same thread as inbound', async () => {
  const chat = [{ peer: 'Genie prod', dir: 'in' as const, text: 'hi', at: 1, status: 'received' as const, addr: 'uds:/tmp/cc-socks/40977.sock' }]
  expect(peerKey('uds:/tmp/cc-socks/40977.sock', chat)).toBe('Genie prod')
  expect(peerKey('Genie prod [2aa26b]', chat)).toBe('Genie prod')
  expect(peerKey('other', chat)).toBe('other')
})

test('chat marks inbound/outbound, badges new messages, and opens a clickable history per agent', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/nonexistent' })
  on('session.id', () => ({ value: 'sess' }))
  on('fs.read', () => { throw new Error('none') })
  on('tool.call', () => ({ result: {} as never, text: 'This session is me [abc123]\nLocal sessions (1):\n  Genie prod [2aa26b] · local · idle · 1m' }))
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
  await $.session.receive({ origin: { kind: 'peer' }, text: '<cross-session-message from="uds:/tmp/cc-socks/1.sock" from-name="Genie prod" from-mode="prompting">can you run the benchmark? Use the T4 runtime and send me the per-file timings when it finishes.</cross-session-message>' })
  await clock.advance(1000)
  await $.session.send({ to: 'uds:/tmp/cc-socks/1.sock', text: 'running it now', origin: { kind: 'model' } } as never)

  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab:chat' })
  expect(await ui.find({ key: 'tab:chat' })).toBeDefined()
  expect((await ui.find({ key: 'tab:chat' }))?.props?.label).toMatch(/●1/)
  expect(await ui.find({ text: /● 1 new/ })).toBeDefined()
  expect(await ui.find({ text: /◂1/ })).toBeDefined()
  await ui.press({ key: 'peer:Genie prod' })
  expect(await ui.find({ text: /◂ 1 in/ })).toBeDefined()
  expect(await ui.find({ text: /▸ 1 out/ })).toBeDefined()
  expect(await ui.find({ text: /◂ in/ })).toBeDefined()
  expect(await ui.find({ text: /▸ out/ })).toBeDefined()
  const rows = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('b:m:Genie prod'))
  expect(rows.length).toBe(2)
  expect(await ui.find({ key: rows[0]!, text: /can you run the benchmark\? ▸$/ })).toBeDefined()
  await ui.press({ key: rows[0]! })
  expect(await ui.find({ text: /per-file timings/ })).toBeDefined()
  await ui.press({ key: 'peer:Genie prod' })
  expect(await ui.find({ text: /● 1 new/ })).toBeUndefined()
  expect((await ui.find({ key: 'tab:chat' }))?.props?.label).not.toMatch(/●/)
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
  on('fs.read', () => { throw new Error('none') })
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
  await ui.press({ key: 'tab:tasks' })
  for (const t of ['alpha task', 'beta task', 'gamma task']) await ui.input({ key: 'task', text: t })
  expect(await ui.find({ text: /with your next prompt/ })).toBeDefined()
  const ids = async () => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('drop:')).map(k => k.slice(5))
  const [a, b, c] = await ids()
  // gamma up one: alpha, gamma, beta
  await ui.press({ key: `up:${c}` })
  expect(await ids()).toEqual([a, c, b])
  // preview shows the exact text
  await ui.press({ key: `obl:${b}` })
  expect(await ui.find({ text: /sends exactly/ })).toBeDefined()
  // remove alpha: its task leaves the board too
  await ui.press({ key: `drop:${a}` })
  expect(await ids()).toEqual([c, b])
  await $.prompt.submit({ text: 'go on' } as never)
  const note = context.join('\n')
  expect(note).not.toMatch(/alpha task/)
  expect(note.indexOf('gamma task') < note.indexOf('beta task')).toBe(true)
  expect(await ui.find({ text: /with your next prompt/ })).toBeUndefined()
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
