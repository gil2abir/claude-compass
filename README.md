<h1 align="center">🧭 compass</h1>

<p align="center"><b>Watch your Claude Code session think. Steer it while it works.</b></p>

<p align="center"><img src="https://raw.githubusercontent.com/gil2abir/claude-compass/media/demo.gif" alt="compass beside a Claude Code session: the sea chart, the plan as live milestones, Claude's questions in the grill, the live feed of tool calls, a fork in the plan and picking a route, a steer landing on the chart" width="900"></p>

<p align="center"><a href="https://raw.githubusercontent.com/gil2abir/claude-compass/media/demo.mp4">Full-quality video (MP4)</a> · <a href="#install">Install</a> · <a href="#what-compass-reads-sends-runs-and-stores">What it can touch</a></p>

Give Claude a real task and it disappears for a few minutes. It reads files, makes a plan in its head, picks libraries, writes code, runs tests. You find out what it decided when it stops, and by then it has made a dozen calls you would have made differently.

compass is a mod that opens a pane next to the transcript and keeps it current while Claude works.

**You see the plan as it stands right now.** Milestones and steps, drawn as a flow chart with a marker on *now*, what is done, what is next, and where the work forked. It's redrawn as the session moves, so the chart shows the session as it is now, not the plan from twenty minutes ago.

**You see what it's doing this second.** The live tab lists every tool call as it happens: the shell command, the file being written, the search, the monitor ticking away in the background, each with its result and how long it took. A sparkline shows the last ten minutes of activity, and the chart's current and next step sit above it, so you can read the work and where it's going on one screen. The flow tab keeps a two-line strip of whatever is running right now.

**Claude asks, and the work doesn't stop.** Design choices land in the grill tab with Claude's pick already filled in. Click an option, type your own answer, or park the question and let Claude go with its recommendation. Your answers go back as one batch, and the next round of questions picks up from them.

**You can steer without hitting Esc.** Type one sentence into the steer box, drag a task to DOING, add one of your own, or click a step to skip it. It lands in the running turn, and the chart redraws to show it took.

**Nothing goes in blind.** Everything the pane sends sits in an outbox for 8 seconds. Click it to read the exact text Claude will get, reorder it, send it now, or cancel it.

The chart costs one extra model call per update, which reuses the session's prompt cache; the live tab costs nothing, it reads the tool calls as they pass. The stats tab shows exactly how much compass itself used.

It earns its keep on the long ones: a feature that spans a dozen files, a refactor with judgment calls in it, a planning session where you want the decisions out on the table instead of buried in the scrollback. For a two-line fix you won't miss it.

Requires Claude Code 2.1.287 or later (`claude --version`).

## Install

```
/plugin marketplace add gil2abir/claude-compass
/plugin install compass@claude-compass
/reload-plugins
```

If it doesn't show up, restart Claude Code. From a local clone instead: `claude --plugin-dir ./claude-compass`.

## Tour

The pane is drawn like a small GUI: indicators are graphics (colored pills, level bars, counters, lit dots for countdowns, a spinner while charting), and information (steps, tasks, questions, messages) stays text. Before the first chart lands, the flow tab shows an animated sea chart: a 32-point compass rose with clouds, gulls and waves, and a gull crossing it while compass works.

Click the gold `◈ compass` under the prompt to open or close the pane, or type `/compass`. Next to it, one panel of chips: the course (`✓ last │ ● now │ ○ next`), the current milestone (`⚑ M4 ██░ 1/5 steps`, the same M4 as in the flow tab), and chips for anything waiting on you (`? 2 to answer`, `⑂ 2 ways`, `⇣ 1 queued`). Short on room, parts leave a chip before whole chips go.

At the top of every tab, a **sync line** says what is going on with the chart and whether you need to do anything: `⠋ charting now · nothing to do`, `◌ chart coming · drawn in a few seconds`, `◌ 1 turn behind · updates when this turn ends`, or, when it needs you, `press ↻ update` with the button beside it. Under the flow, the **steer card** takes a sentence that points the whole session somewhere new; the steers you sent (yours, and go / skip / later / retry and fork picks) fold under it.

Pinned to the bottom of the pane, the **outbox**: everything the pane will put into the session, one line per item, marked by when it goes: `↪` into this turn, `⏭` as the next turn, `✎` with your next prompt. Nothing waits for a turn to end: while Claude works, every item whose wait is over (steers, grill answers, task changes, notes) goes into the running turn as one message; when the session is idle, steers and answers start a turn and notes ride your next prompt. Every item waits 8 s (with a countdown) before it is sent, so you can still change your mind: click to preview the exact text, `▲▼` to reorder, `⚡` to send now, `✕` to remove (what it did in the pane is undone). `✓n` unfolds what was already sent.

| Tab | What it shows |
| --- | --- |
| `├ flow` | The session's milestones (numbered `M1`…, each with its own steps bar, overall progress on top), drawn as a git-style flow chart: finished milestones folded, a fisheye around **now**, dead ends and side branches, decisions. Click a step for **go / skip / later / retry**. `key` explains every mark. When the last turns show the work could go another way, the active milestone forks: **as planned** on the left, one **branch** on the right (`⑂ 2 ways` under the prompt). Once you pick a side, that fork (either side of it, reworded or reversed) isn't offered again, even while the work waits on an event or a decision. `▶ keep this` stays the course; `⤴ take this` steers the session there and redraws the flow at once (✕ in the outbox undoes it before it's sent). |
| `↯ live` | Every tool call as it happens, newest on top: a spinner while it runs, `✓` / `✗` when it returns, how long it took; shells, monitors and agents started in the background stay as `◌ bg` until their notification comes back (or Claude stops them, `■`), and calls made inside a subagent are marked `↳`. On top: the chart's **now** and **next** step, counts (running, background, done, failed, calls per minute) and a sparkline of the last 10 minutes. The same running strip sits at the top of the flow tab, with `↯ live ▸` to jump here. Compass's own calls are left out. |
| `☑ tasks` | A Jira-style board: DOING (limit 3), TO DO, DONE, BACKLOG. Drag cards between lanes, or click one for move buttons. Add your own tasks; the agent takes them next turn. |
| `? grill` | A decision radar. Questions that need you land here as the session moves: Claude posts them while planning or at a choice, and after every turn compass looks for new goals, ideas, trade-offs and effects down the road you should decide or know about. Each says whether work waits on it (`⏸ blocking`) or goes on meanwhile (`▶`), and who asked: Claude, or `◈ compass` (the chart's own questions, marked `[asked by compass]` in the brief too). Compass holds its own questions back while Claude has questions open, so the two never ask over each other. Answer any, in any order, when you like (options, free text, or `?` for a follow-up); `⏸ park` one to let the work go on with Claude's recommendation; `✕` to drop it; bring parked ones back any time. The session hears every choice, the chart settles questions the conversation already answered, and the flow tab mirrors it all in a **decisions** block (waits on you · open while work goes on · answered · parked). |
| `⇄ agents` | Other Claude sessions and agents (via `ListAgents`) and the Remote Control indicator. `✉ message` on an online agent (or a click on its name) opens its thread with a box to write to it; what you write waits 8 s in the outbox (`✉ to agents`) like everything else, so you can read, send now or cancel it, then goes by SendMessage. Each agent shows `● N new`, `◂in ▸out` counts and its last message; click that line to open the thread under its row with the message whole. In the thread each message is one line (`◂ in` / `▸ out`, age, first sentence); a long inbound message (more than 160 characters or two sentences) shows a one-line summary marked `≈` instead, written by the fast model (Haiku) in the same plain English as the chart. Click any line of a message to read it all, as it was sent, and again to fold it. Several sessions can share a name: their rows stay apart, and a message goes to the one whose row you opened. Messages the session's Claude sends with SendMessage are recorded too. |
| `∑ stats` | Session time, turns, tools, errors, files, cost, context, progress, and compass's own token use, by kind of call (chart, course check, new request, turn end, reconcile, digest, summary), and how often each tab was opened. These counts stay on your machine; they show which parts earn their cost. |
| `≡ recap` | A short recap you can copy, plus your `/btw` side questions. |

Long text wraps instead of being cut off.

Commands: `/compass`, `/compass refresh`, `/compass steer <text>`, `/compass task <text>`.

## How it works and what it costs

- **Settles in the pane, syncs with the session.** What you do in the pane takes effect at once: answering, parking or dismissing a question unblocks the steps waiting on it. A couple of seconds after you pause, one small fast-model call (Haiku) brings the rest of the chart along (follow-on steps, settled questions, tasks), without inventing session progress; the sync line says `applying your changes`. At every session event the full chart, which sees the same actions, is the one that counts; a quick update that overlaps it is dropped, so the two never fight.

- The map is made by one extra model call (`$.model.fork`) that reuses the session's prompt cache: 3 s after each prompt (so the first chart arrives while Claude is still working on your first request), again when each turn ends, and every 3 min during long turns. On a long session that full chart can take a while, so between full charts a small fast-model call (Haiku) keeps the course current: when you send a prompt (your request becomes "now"), every ~12 s while Claude works and the pane is open, if new tool calls finished or Claude wrote something new (it gets the chart, those calls and Claude's latest words, and either answers "nothing moved" or moves "now" and what's next, never marking done what the session hasn't shown), at once when you open the pane on a course older than that, and right when a turn ends. With the pane closed the check does not run. While Claude works from a TodoWrite list, its item in progress is "now" under the prompt, in the live tab and in the brief, with no model call. Every chart that lands records when it started, and one that started before the course on screen never moves "now" back: a slow full chart that lands after a newer check keeps that course and brings only its tasks, recap, questions and fork. The sync line says which is running (`charting your new message`, `checking the course`, `catching up with the turn`), and `◷` is the time since the course was last confirmed. The full chart replaces the quick one when it lands; one that started before your prompt is dropped as stale. Everything compass writes with a model (milestone and step labels, reasons, recap lines, the chart's grill suggestions) follows a compact form of ASD-STE100 Simplified Technical English: verb-first labels, short active sentences, common words with one meaning; the grilling guide asks Claude to write its questions the same way. What compass only relays (your words, messages, commands, tool calls in the live tab) is shown as it is. The stats tab shows compass's own token use.
- The agent gets a `grill` tool and short instructions in its system prompt for asking you questions without blocking. A question marked blocking is a handshake: compass answers the post with `ACK BLOCKING`, the session stops the work that depends on it, and your answer, park or dismissal goes back at once (into the running turn, or as a new turn when the session is idle) marked `RELEASED`. It does not wait for the open non-blocking questions; those still go together, as before.
- **A fixed contract both ways.** Each side passes the other a fixed object, rebuilt whole at every step, so no field is missing or stale. *Session → compass* (the report): the latest request, Claude's latest words, tool calls since the chart, the TodoWrite list, inbound messages, `/btw` asides, the blocking questions it holds on, and `notes` the session passes with the `grill` tool for facts only its own workflow needs. Every chart reads it. *Compass → session* (the brief, `🧭 [compass brief · rev N]`): the course, steering in force, blocking / open / parked questions, your tasks not yet on its list, the fork you decided, what is still in the outbox, a pending confirmation, and more from compass's state (a branch on offer, sends that failed, forks already decided). The brief is refreshed every second as the chart and the pane change; its rev moves only when a field the session must act on changes (steers, questions, your tasks, the fork, the outbox, a confirmation, extra), not when only the course moves: the course is compass's reading of work the session already knows. A brief with a new rev goes whole with your prompts, compass's own turns, steers and grill answers, and with the next tool result while Claude works; a course that moved alone rides only your next prompt or compass's next turn. Otherwise nothing is added. It is kept out of the chat view: it rides as context the model reads and the transcript does not show (prompts, tool results, the grill tool's answer), it lists each field that has content and names the empty ones on one `none:` line, and on compass's own turns the transcript row draws without it or the model-only instructions (ctrl+o shows the stored text whole). The system prompt names the contract in fixed text, so the prompt cache holds. The stats tab shows where it stands: `⇄ contract: ◂ report r24 · ▸ brief r19 · session has r17`.
- Recovering: a session you resume or come back to reopens its saved chart from the plugin's own store (`$.store`, the 12 most recent sessions) with no model call. If there is none (for example a session charted by an older compass), compass charts it right away from a compact digest of the saved conversation (its first request and the recent exchanges, about 12k characters) with the fast model; the next turn's end charts it again from the shared, cached context. The same digest is the fallback when a session is too long to fork (an API error or an empty reply), so a very long session still gets a chart.

## What compass reads, sends, runs and stores

A mod runs on your machine with the same access Claude Code has. Read the source (`hooks/register.tsx`, the hooks; `hooks/kit.ts`, `hooks/helpers.ts`, `hooks/contract.ts`, its pure parts; `hooks/board.tsx`, `hooks/brand.tsx`, `hooks/pill.tsx`, the drawn regions) before installing. In short:

**Prompts it submits.** Only what you put in the outbox, exactly as the outbox previews it (click an item to see the text): steers you type or pick (go, skip, later, retry, take a branch), task changes you make on the board, your grill answers and dismissals. Each waits 8 s in the outbox and can be removed. They go in as a new turn (`prompt.submit`), into the running turn (`session.append`), or as context on your next prompt. Compass never puts file contents or the session id into these prompts. Besides a short header naming the kind of item (`🧭 [compass — steering from the user]`, `🧭 [compass grill · round 1 — answers from the user]`), it adds the brief: compass's own state for this session (the chart's labels, your steers, questions and tasks, the outbox), which is already the session's own.

**Model calls.** To draw the chart it makes one extra call to the session's own model (`model.fork`): it sees the session's conversation, which is already with that model, plus compass's state (the current chart, tasks, sent steers, grill questions, decided forks, messages from other agents). Nothing is added to your session's history. The fork's tools are refused, and compass refuses its `grill` tool to the fork too, so the chart's own questions come only from its reply. A long message from another session or agent is sent once to the fast model (Haiku) for its one-line summary; a short one is not.

**Tools it calls itself.** `ListAgents`, to list your other sessions and agents in the agents tab (when the pane opens and every 15 s while the agents tab is shown), and `SendMessage` (through `session.send`) when a message you wrote in the agents tab leaves the outbox. It registers one tool of its own, `grill`, which the agent uses to post questions; compass's `tool.call` hook answers that tool and no other. Both tool names are fixed in the source; compass never calls a shell, an agent, an MCP server or any tool whose name it was handed, and never runs a command.

**Hooks, and what each does.** All pass the event on unchanged unless noted:
- `tool.call` (every tool): adds the brief to the result's context when it changed since the session last got it (the result itself is untouched); records the call's start and end for the live tab (tool name, a few words of its input, status, duration), counts tools and errors for the stats tab, notes edited files, reads TodoWrite/TaskCreate for the task board, reads ListAgents results for the agents tab. It never changes, blocks or re-runs a call: it reads the tool's name, a few words of its input (the command, a file name, a pattern) and whether it succeeded, and that stays in the pane. Compass's own calls are skipped. Answers only its own `grill` tool, by returning the round's summary to the agent in place of a tool run.
- `command.run`: `/compass` is compass's own command (it answers it); `/btw` is recorded as a side question and passed on; every other command passes through untouched.
- `prompt.submit`: adds your queued "with your next prompt" notes and the brief as context; records `/btw`.
- `prompt.compose`: adds one section to the system prompt (the grilling guide and the steers you sent) and changes nothing else in it.
- `session.send` / `session.receive`: records messages to and from other sessions and agents.
- `session.start` / `session.end`, `turn.start` / `turn.complete`: keep the chart current; `/clear` starts the compass over.
- `ui.render`, `ui.message`, `ui.scroll`: draw the pane and the row under the prompt. On transcript rows (`UserMessage`) it only reads a background task's notification to close its live-tab row, and draws nothing.

**What it reads.** The session's messages and usage (`session.messages`, `session.usage`) for the chart and the stats. It reads no files, no environment variables, no API keys, tokens or other credentials. `session.id` is read only to name the entry its chart is saved under in its own store; `$.store.keys()` lists those entries.

**What it writes.** No files. It keeps each session's compass in its own plugin store (`$.store`, a JSON file Claude Code keeps for the plugin) so `claude --resume` reopens it; the 12 most recent sessions are kept and `/clear` removes the current one.

**What leaves the machine, and where.** Three things, all through Claude Code itself:
- the chart call (`model.fork`) sends the conversation and compass's state to the session's own model, the same model and account the session already uses;
- a long inbound message's text goes to the fast model (Haiku), on the same account, for its summary line;
- the prompts you let through the outbox go into this session only;
- a message you write in the agents tab goes, through `SendMessage`, to the session or agent you picked, after its 8 s in the outbox.

The session id, usage figures and the live feed stay on your machine.

**Network.** None of its own: no HTTP calls, no telemetry. The `repository` link in `plugin.json` is metadata.

The `types` field in `plugin.json` names the mod's state contract (`types/index.d.ts`), which `claude plugin validate` checks; Claude Code itself ignores it. `tests/` is the test suite for `claude plugin test`: its hooks stand in for the engine (they answer tool calls, the store and model calls with fixed data), and it uses test-only calls such as `$.ui.mount` that the mod itself never makes.

## Update

```
claude plugin marketplace update claude-compass
claude plugin update compass@claude-compass
```

From a clone: `git pull`. Then restart each session (`/exit`, `claude --continue`).

## Develop

```
claude plugin validate .
claude plugin test .
```

## License

MIT, see [LICENSE](LICENSE).
