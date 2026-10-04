export type CompassTab = 'flow' | 'live' | 'tasks' | 'grill' | 'chat' | 'stats' | 'recap'

/** One tool call as the live tab shows it: started, then finished, failed, or handed to the background. */
export type CompassPulse = {
  /** the call's tool_use_id */
  id: string
  tool: string
  /** the call in a few words: the command, the file, the pattern */
  what: string
  at: number
  /** when the call returned (for a background one: when its notification came) */
  end?: number
  /** running → ok | error; bg (returned, still working) → bgdone | bgfail | stopped */
  status: 'running' | 'ok' | 'error' | 'bg' | 'bgdone' | 'bgfail' | 'stopped'
  /** the subagent whose loop made the call; absent on the main loop */
  agent?: string
  /** a background task's own id (shell, monitor, agent), as its notification names it */
  bgId?: string
}

/** Lifecycle of a milestone or step (version-tree states). */
export type CompassState = 'done' | 'active' | 'pending' | 'abandoned' | 'blocked'

/** step = committed work · attempt = exploratory branch · decision = a choice made · aside = a /btw side question */
export type CompassStepKind = 'step' | 'attempt' | 'decision' | 'aside'

export type CompassStep = { id: string; label: string; kind: CompassStepKind; state: CompassState; why: string }

/** A chunk of the session (Heer et al. graphical histories / Graphectory phases). */
export type CompassMilestone = { id: string; label: string; state: CompassState; why: string; steps: CompassStep[] }

export type CompassLane = 'now' | 'next' | 'later' | 'done'

/** `from`: the other agent or session it came from, '' when it is this session's own. */
export type CompassTask = { id: string; text: string; lane: CompassLane; by: 'agent' | 'user'; from: string }

export type CompassMap = {
  goal: string
  milestones: CompassMilestone[]
  tasks: CompassTask[]
  recap: string[]
  at: number
  /** completed turns the chart was made from: fewer than stats.turns means it is behind */
  turns?: number
  /** the most plausible other trajectory from now, when the last turns hint the work could diverge */
  alt?: CompassAlt | null
  /** what the user picked at the fork, until the next chart */
  altPick?: 'main' | 'branch'
  /** when a quick reconcile last brought the chart in line with the user's pane actions */
  reconciledAt?: number
  /** alternatives the user turned down: not offered again */
  declined?: string[]
}

export type CompassAlt = { label: string; why: string; steps: string[] }

/**
 * One node of the grilling design tree (mattpocock/skills `grilling`).
 * open → (answered | followup) → sent with the round → settled, or open again when re-asked.
 */
export type CompassGrillQ = {
  id: string
  n: number
  title: string
  body: string
  options: string[]
  rec: string
  dependsOn: string[]
  topic: string
  mode: 'plan' | 'work'
  source: 'agent' | 'map'
  /** another agent or session this question came from, '' when it is this session's own */
  from: string
  /** open: waiting · parked: the user set it aside, work goes on without it · settled: answered or dismissed */
  state: 'open' | 'answered' | 'followup' | 'sent' | 'settled' | 'parked'
  /** true when work waits on the answer; false when the session can go on meanwhile */
  blocking?: boolean
  answer: string
  followups: string[]
  at: number
}

export type CompassAgentTodo = { text: string; status: 'pending' | 'in_progress' | 'completed' }

export type CompassUserTask = { id: string; text: string; at: number }

/**
 * Everything the pane sends the agent, with where it stands.
 * steer: urgent (into the running turn, else a new turn) · turn: its own turn once idle (grill rounds)
 * note: rides the user's next prompt as context. Any queued action can be forced out now.
 */
export type CompassAction = {
  id: string
  kind: 'steer' | 'turn' | 'note' | 'message'
  label: string
  text: string
  status: 'queued' | 'sent' | 'rejected'
  route: '' | 'running turn' | 'new turn' | 'next prompt' | 'agent'
  reason: string
  at: number
  /** the task it moved, and its lane before, for a rollback if it is rejected */
  ref: string
  prev: string
  /** a message's recipient: the agent or session it goes to (kind message) */
  to?: string
}

/** A session or agent ListAgents reports, this one excluded. */
export type CompassPeer = { name: string; id: string; group: string; kind: string; status: string; since: string }

export type CompassChatMsg = { peer: string; dir: 'in' | 'out'; text: string; at: number; status: 'sent' | 'rejected' | 'received'; addr?: string }

export type CompassSteer = { text: string; at: number }

export type CompassStats = {
  startedAt: number
  turns: number
  busyMs: number
  tools: Record<string, number>
  errors: number
  files: string[]
  tokensIn: number
  tokensOut: number
  tokensCached: number
  refreshes: number
  costUsd: number
  contextPct: number
  /** the account's usage windows (5h, 7d): percent used and when each resets */
  limits?: { kind: string; pct: number; resetsAt: string }[]
  /** compass's own map-making model calls, apart from the session's work */
  own: { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number }
}

declare module 'claude-code' {
  interface PluginState {
    compass: {
      map: CompassMap | null
      grill: CompassGrillQ[]
      grillRound: number
      grillConfirm: string | null
      agentTodos: CompassAgentTodo[]
      userTasks: CompassUserTask[]
      actions: CompassAction[]
      peers: CompassPeer[]
      peersAt: number
      selfName: string
      isRemoteOnline: boolean
      chat: CompassChatMsg[]
      /** per peer: when its thread was last open; inbound after it counts as new */
      chatSeen: Record<string, number>
      /** bumped each second while an outbox item counts down, so the countdown redraws */
      tick: number
      /** the request a turn just started on, until a chart made after it lands */
      incoming: { text: string; at: number } | null
      steers: CompassSteer[]
      btw: string[]
      stats: CompassStats
      tab: CompassTab
      selected: string | null
      unfolded: string[]
      isRefreshing: boolean
      isBusy: boolean
      lastError: string | null
      /** the live tab's feed, newest last, the last LIVE_KEEP calls */
      live: CompassPulse[]
    }
  }
}
