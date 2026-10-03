import type { ClientModule, ClientPointerEvent, JsonValue } from 'claude-code'

// The tasks tab's kanban board: a Client region that draws itself and owns the pointer,
// so cards can be dragged between lanes. Lanes stack top to bottom (a 46-column pane fits
// one card per row, not three columns), the chip strip on top doubles as drop targets,
// and the backlog sits below the board (Jira narrow view, kanban-tui, Linear).

export type BoardLane = 'now' | 'next' | 'done' | 'later'

export type BoardCard = { id: string; text: string; lane: BoardLane; by: 'agent' | 'user'; isQueued: boolean }

export type BoardProps = { cards: BoardCard[]; wip: number; selected: string | null }

/** What the board posts to the hooks module (validated there). */
export type BoardPost = { type: 'move'; id: string; lane: BoardLane } | { type: 'select'; id: string }

type Drag = { id: string; from: BoardLane; x: number; y: number; isMoving: boolean; target: BoardLane | null }

type BoardState = { drag: Drag | null; hover: number; collapsed: BoardLane[]; isBacklogOpen: boolean; cursor: string | null }

type Row =
  | { kind: 'chips' }
  | { kind: 'rule' }
  | { kind: 'head'; lane: BoardLane }
  | { kind: 'card'; lane: BoardLane; card: BoardCard }
  | { kind: 'more'; lane: BoardLane; count: number }
  | { kind: 'empty'; lane: BoardLane }
  | { kind: 'status' }

export const LANES: { lane: BoardLane; name: string }[] = [
  { lane: 'now', name: 'DOING' },
  { lane: 'next', name: 'TO DO' },
  { lane: 'done', name: 'DONE' },
  { lane: 'later', name: 'BACKLOG' },
]

const BACKLOG_ROWS = 5

/** Lane colours, the pane's pill palette: a tinted fill and a bright label of the same hue. */
const LANE_TONE: Record<BoardLane, { fg: string; bg: string }> = {
  now: { fg: '#83d6e8', bg: '#1b3940' },
  next: { fg: '#97b1f5', bg: '#243049' },
  done: { fg: '#86d4ab', bg: '#1d3a2f' },
  later: { fg: '#8a8a8a', bg: '#2a2b2e' },
}
const OVER = { fg: '#f2a093', bg: '#442728' }
const HOVER_BG = '#2f3136'

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, Math.max(1, n - 1))}…` : text)

const count = (cards: BoardCard[], lane: BoardLane) => cards.filter(c => c.lane === lane).length

/** The chip strip's spans, so a click or a drop on x lands on the right lane. */
export const chipSpans = (cards: BoardCard[], wip: number) => {
  let x = 0
  return LANES.map(({ lane, name }) => {
    const n = count(cards, lane)
    const label = ` ${name} ${lane === 'now' ? `${n}/${wip}` : n} `
    const span = { lane, label, from: x, to: x + label.length, isOver: lane === 'now' && n > wip }
    x += label.length + 1
    return span
  })
}

/** Every row the board draws, top to bottom: y in a pointer event indexes this list. */
export const rowsOf = (cards: BoardCard[], s: BoardState): Row[] => {
  const rows: Row[] = [{ kind: 'chips' }, { kind: 'rule' }]
  for (const { lane } of LANES) {
    if (lane === 'later') rows.push({ kind: 'rule' })
    rows.push({ kind: 'head', lane })
    if (s.collapsed.includes(lane)) continue
    const list = cards.filter(c => c.lane === lane)
    if (!list.length) rows.push({ kind: 'empty', lane })
    const cap = lane === 'later' && !s.isBacklogOpen ? BACKLOG_ROWS : list.length
    list.slice(0, cap).forEach(card => rows.push({ kind: 'card', lane, card }))
    if (list.length > cap) rows.push({ kind: 'more', lane, count: list.length - cap })
  }
  rows.push({ kind: 'status' })
  return rows
}

const laneAt = (rows: Row[], cards: BoardCard[], wip: number, x: number, y: number): BoardLane | null => {
  const row = rows[y]
  if (!row) return null
  if (row.kind === 'chips') return chipSpans(cards, wip).find(c => x >= c.from && x < c.to)?.lane ?? null
  return 'lane' in row ? row.lane : null
}

const EMPTY: BoardState = { drag: null, hover: -1, collapsed: ['done'], isBacklogOpen: false, cursor: null }

const Board: ClientModule<JsonValue, BoardState> = (raw, surface) => {
  const { Box, Text } = surface.elements
  const props = raw as unknown as BoardProps
  const cards = props.cards ?? []
  const wip = props.wip ?? 3
  const s = surface.state ?? EMPTY
  const width = Math.max(24, surface.columns || 44)
  const rows = rowsOf(cards, s)
  const set = (patch: Partial<BoardState>) => surface.setState({ ...s, ...patch })
  const post = (data: BoardPost) => surface.post(data as unknown as JsonValue)
  const order = cards.filter(c => !s.collapsed.includes(c.lane))

  surface.onPointer((e: ClientPointerEvent) => {
    const row = rows[e.y]
    if (e.type === 'leave') return set({ hover: -1 })
    if (e.type === 'down' && e.button === 'left') {
      if (row?.kind === 'card') set({ drag: { id: row.card.id, from: row.lane, x: e.x, y: e.y, isMoving: false, target: null }, cursor: null })
      return
    }
    if (e.type === 'move') {
      if (s.drag && e.button === 'left') {
        const isMoving = s.drag.isMoving || e.y !== s.drag.y || Math.abs(e.x - s.drag.x) > 1
        return set({ drag: { ...s.drag, isMoving, target: isMoving ? laneAt(rows, cards, wip, e.x, e.y) : null }, hover: e.y })
      }
      if (e.y !== s.hover) set({ hover: e.y })
      return
    }
    if (e.type === 'up') {
      const drag = s.drag
      if (drag?.isMoving) {
        if (drag.target && drag.target !== drag.from) post({ type: 'move', id: drag.id, lane: drag.target })
        return set({ drag: null, hover: -1, cursor: null })
      }
      set({ drag: null })
      // a click: a card selects, a head folds, "more" opens the backlog, a chip moves the selected card
      if (row?.kind === 'card') return post({ type: 'select', id: row.card.id })
      if (row?.kind === 'head') {
        const lane = row.lane
        return set({ collapsed: s.collapsed.includes(lane) ? s.collapsed.filter(l => l !== lane) : [...s.collapsed, lane] })
      }
      if (row?.kind === 'more') return set({ isBacklogOpen: true })
      if (row?.kind === 'chips') {
        const lane = laneAt(rows, cards, wip, e.x, e.y)
        const card = cards.find(c => c.id === (props.selected ?? s.cursor))
        if (lane && card && card.lane !== lane) post({ type: 'move', id: card.id, lane })
      }
    }
  })

  // keys: ↑↓ / j k pick a card, H L (or shift+←→) move it up or down the lanes, enter opens it
  surface.onKey(k => {
    const at = order.findIndex(c => c.id === s.cursor)
    if (k.key === 'down' || k.key === 'j') return set({ cursor: order[Math.min(order.length - 1, at + 1)]?.id ?? null })
    if (k.key === 'up' || k.key === 'k') return set({ cursor: order[Math.max(0, at - 1)]?.id ?? null })
    const card = order[at]
    if (!card) return
    const li = LANES.findIndex(l => l.lane === card.lane)
    const step = k.key === 'H' || (k.key === 'left' && k.shift) ? -1 : k.key === 'L' || (k.key === 'right' && k.shift) ? 1 : 0
    if (step) {
      const to = LANES[li + step]
      if (to) post({ type: 'move', id: card.id, lane: to.lane })
      return
    }
    if (k.key === 'return') post({ type: 'select', id: card.id })
  })

  const drag = s.drag?.isMoving ? s.drag : null
  const dragged = drag ? cards.find(c => c.id === drag.id) : undefined
  const laneName = (lane: BoardLane) => LANES.find(l => l.lane === lane)?.name ?? lane

  return (
    <Box flexDirection="column" width={width}>
      {rows.map((row, y) => {
        const isHover = y === s.hover && !drag
        if (row.kind === 'chips') {
          return (
            <Box key="chips">
              {chipSpans(cards, wip).map((c, i) => {
                const t = c.isOver ? OVER : LANE_TONE[c.lane]
                const isTarget = drag?.target === c.lane
                return (
                  <Text key={`chip:${c.lane}`}>
                    <Text color={isTarget ? t.bg : t.fg} backgroundColor={isTarget ? t.fg : t.bg} bold={isTarget || c.lane === 'now'}>
                      {c.label}
                    </Text>
                    {i < LANES.length - 1 ? <Text> </Text> : null}
                  </Text>
                )
              })}
            </Box>
          )
        }
        if (row.kind === 'rule') return <Text key={`rule:${y}`} dimColor>{'─'.repeat(width)}</Text>
        if (row.kind === 'status') {
          return dragged && drag ? (
            <Text key="status" color="cyan" wrap="truncate-end">
              ⇅ {clip(dragged.text, width - 22)} → {drag.target ? laneName(drag.target) : 'drop on a lane'}
            </Text>
          ) : (
            <Text key="status" dimColor wrap="truncate-end">
              drag a card · click a lane name to fold
            </Text>
          )
        }
        if (row.kind === 'head') {
          const n = count(cards, row.lane)
          const isTarget = drag?.target === row.lane
          const isOver = row.lane === 'now' && n > wip
          return (
            <Box key={`head:${row.lane}`}>
              <Text color={isTarget ? (isOver ? OVER : LANE_TONE[row.lane]).bg : (isOver ? OVER : LANE_TONE[row.lane]).fg} backgroundColor={isTarget ? (isOver ? OVER : LANE_TONE[row.lane]).fg : (isOver ? OVER : LANE_TONE[row.lane]).bg} bold>
                {` ${s.collapsed.includes(row.lane) ? '▸' : '▾'} ${laneName(row.lane)} ${row.lane === 'now' ? `${n}/${wip}` : n} `}
              </Text>
              {isTarget && <Text color={LANE_TONE[row.lane].fg}> ◂ drop here</Text>}
              {isOver && !isTarget && <Text color={OVER.fg}> over limit</Text>}
            </Box>
          )
        }
        if (row.kind === 'empty') {
          return (
            <Text key={`empty:${row.lane}`} dimColor>
              {drag?.target === row.lane ? '  ┄┄ drop here ┄┄' : '  –'}
            </Text>
          )
        }
        if (row.kind === 'more') {
          return (
            <Text key={`more:${row.lane}`} dimColor>
              {'  '}… {row.count} more · click to show
            </Text>
          )
        }
        const c = row.card
        const isSource = drag?.id === c.id
        const isCursor = (props.selected ?? s.cursor) === c.id
        const isDone = c.lane === 'done'
        return (
          <Box key={`card:${c.id}`}>
            <Text color={LANE_TONE[c.lane].fg} dimColor={isSource}>
              {isSource ? ' ┊' : ' ▌'}
            </Text>
            <Text color={c.by === 'user' ? '#f0d27a' : '#b9a6f2'} backgroundColor={isCursor || isHover ? HOVER_BG : undefined} dimColor={isDone || isSource}>
              {c.by === 'user' ? ' ★ ' : ' ◆ '}
            </Text>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="truncate-end" bold={isCursor} backgroundColor={isCursor || isHover ? HOVER_BG : undefined} dimColor={isDone || isSource || c.lane === 'later'} strikethrough={isDone}>
                {c.text}
              </Text>
            </Box>
            {c.isQueued && <Text color="#f0d27a" backgroundColor="#3e381d">{' ⋯ '}</Text>}
          </Box>
        )
      })}
    </Box>
  )
}

export default Board
