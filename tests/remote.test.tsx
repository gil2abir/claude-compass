import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'compass',
  props: { title: '🧭 compass', isFocused: true, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

// Remote Control lists every session on the account: several share a machine's name
const AGENTS = [
  'This session is me [abc123]',
  'Local sessions (1):',
  '  EXM-MY [aa1111] · local · idle · 1m',
  'Remote Control sessions (3):',
  '  EXM-MY [bb2222] · remote · busy · 3m',
  '  EXM-MY [cc3333] · remote · idle · 9m',
  '  EXM-MY [cc3333] · remote · idle · 9m',
  '  build bot [dd4444]  ·  says it was 31ee9113 until 8m ago  ·  bg  ·  busy',
].join('\n')

test('the agents tab draws sessions that share a name, on every surface, with Remote Control online', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.id', () => ({ value: 'sess' }))
  on('tool.call', () => ({ result: {} as never, text: AGENTS }))
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.messages', () => ({ value: [] }) as never)
  on('session.usage', () => ({ value: { startedAt: 500_000, context: { window: 1000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('session.start', (_$, e) => e as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  const sent: string[] = []
  on('session.send', (_$, e) => {
    sent.push((e as { to: string }).to)
    return { isDelivered: true as const }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  for (const surface of ['terminal', 'desktop', 'mobile', 'vscode'] as const) {
    const ui = await $.ui.mount({ plugin: 'compass', surface, ...PANE })
    const tap = async (key: string) => {
      const el = (await ui.find({ key })) as { type?: string } | undefined
      if (el?.type !== 'Client') return ui.press({ key })
      await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: key })
      await ui.pointer({ type: 'up', x: 1, y: 0, button: 'left', in: key })
    }
    await tap('tab:chat')
    await tap('peers-refresh')
    await clock.advance(1000)
    expect(await ui.find({ text: /remote control online/ })).toBeDefined()
    for (const id of ['aa1111', 'bb2222', 'cc3333']) expect(await ui.find({ key: `msg:${id}` })).toBeDefined()
    expect((await ui.findAll({ key: 'msg:cc3333' })).length).toBe(1)
    expect(JSON.stringify(await ui.find({ key: 'pk:dd4444' }))).toMatch(/bg · busy/)
    // the thread stays open from the surface before: ✉ toggles it, so open it once
    if (surface === 'terminal') await tap('msg:bb2222')
    if (surface !== "mobile") expect(await ui.find({ key: "chat:EXM-MY" })).toBeDefined()
    else expect(await ui.find({ text: /⇄ me ⇄ EXM-MY/ })).toBeDefined()
    // the thread opens under the row clicked, not below the whole list
    expect(JSON.stringify(await ui.find({ key: 'peer:bb2222' }))).toMatch(/⇄/)
    expect(JSON.stringify(await ui.find({ key: 'peer:cc3333' }))).not.toMatch(/⇄/)
    if (surface === 'terminal') {
      // a message from that row goes to that one session, not to every EXM-MY
      await ui.input({ key: 'chat:EXM-MY', text: 'status?' })
      await clock.advance(9000)
      expect(sent).toEqual(['EXM-MY [bb2222]'])
      // ✉ on another EXM-MY moves the thread to that row
      await tap('msg:cc3333')
      expect(JSON.stringify(await ui.find({ key: 'peer:cc3333' }))).toMatch(/⇄/)
      expect(JSON.stringify(await ui.find({ key: 'peer:bb2222' }))).not.toMatch(/⇄/)
      await tap('msg:bb2222')
    }
    for (const t of ['flow', 'live', 'tasks', 'grill', 'stats', 'recap', 'chat']) {
      await tap(`tab:${t}`)
      expect(await ui.find({ key: `tab:${t}` })).toBeDefined()
    }
    await ui.unmount()
  }
})

test('an inbound message: a long one gets a haiku summary line, any line of it opens the whole text, the row preview opens it too', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.id', () => ({ value: 'sess' }))
  on('tool.call', () => ({ result: {} as never, text: 'This session is me [abc123]\nPeer sessions (2):\n  genie rag [03c446]  ·  bg  ·  idle\n  genie rag [4fd77e]  ·  interactive  ·  idle' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__compass__grill' } }) as never)
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.messages', () => ({ value: [] }) as never)
  on('session.usage', () => ({ value: { startedAt: 500_000, context: { window: 1000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('session.start', (_$, e) => e as never)
  on('session.receive', (_$, e) => ({ text: e.text }))
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  const asked: string[] = []
  on('model.complete', (_$, e) => {
    asked.push((e as { prompt: string }).prompt)
    return { value: { isAnswered: true, text: '"Report three stale shards; ask to flush the cache now or wait for the nightly run."', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  const env = (body: string) => `<cross-session-message from="uds:/tmp/cc-socks/97007.sock" from-name="genie rag" from-mode="prompting">${body}</cross-session-message>`
  await $.session.receive({ origin: { kind: 'peer' }, text: env('ack — "genie rag" session received your ping.') })
  await clock.advance(1000)
  const long = 'Inbox test: no reply is needed.\nI checked the rag index and found three stale shards in the eu bucket. The rebuild ran for 14 minutes. Two queries still return old answers.\nFlush the cache now, or wait for the nightly run?'
  await $.session.receive({ origin: { kind: 'peer' }, text: env(long) })
  await clock.advance(1000)
  // a short message is shown as it is: one model call, for the long one, with the writing rules
  expect(asked.length).toBe(1)
  expect(asked[0]).toMatch(/ASD-STE100/)
  expect(asked[0]).toMatch(/nightly run/)

  const ui = await $.ui.mount({ plugin: 'compass', surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: 160 } })
  const tap = async (key: string) => {
    const el = (await ui.find({ key })) as { type?: string } | undefined
    if (el?.type !== 'Client') return ui.press({ key })
    await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: key })
    await ui.pointer({ type: 'up', x: 1, y: 0, button: 'left', in: key })
  }
  await tap('tab:chat')
  await tap('peers-refresh')
  await clock.advance(1000)
  // the preview under the row is the summary, and a click on it opens the thread there with the message whole
  expect(await ui.find({ key: 'last:03c446', text: /≈ Report three stale shards/ })).toBeDefined()
  await tap('last:4fd77e')
  const has = async (re: RegExp) => (await ui.find({ key: 'peer:4fd77e', text: re })) !== undefined
  expect(await has(/⇄/)).toBe(true)
  expect(await has(/ack — "genie rag" session received your ping\./)).toBe(true)
  expect(await has(/I checked the rag index/)).toBe(true)
  expect(await has(/nightly run\? ▾/)).toBe(true)
  // its own line breaks stay: the first line ends at "needed."
  expect(await ui.find({ type: 'Button', text: /^Inbox test: no reply is needed\.$/ })).toBeDefined()
  // a click on any line of it, not only the first, folds it back to the summary line
  const keys = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('b:m:genie rag'))
  const head = keys.filter(k => !k.includes(':r'))[1]!
  const inner = keys.filter(k => k.startsWith(`${head}:r`) && k.endsWith(':b'))
  expect(inner.length).toBeGreaterThan(0)
  await tap(inner[inner.length - 1]!)
  expect(await has(/≈ Report three stale shards.* ▸/)).toBe(true)
  expect(await has(/I checked the rag index/)).toBe(false)
  await tap(head)
  expect(await has(/I checked the rag index/)).toBe(true)
  await ui.unmount()
})
