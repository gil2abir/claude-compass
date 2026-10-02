# 🧭 compass

A Claude Code mod that keeps a live map of your session: where you were, where you are, and where you're headed. It sits in a pane docked on the right, so the transcript keeps scrolling beside it, and you can steer the session from it.

Requires Claude Code 2.1.287 or later (`claude --version`).

## Install

```
/plugin marketplace add gil2abir/claude-compass
/plugin install compass@claude-compass
/reload-plugins
```

If it doesn't show up, restart Claude Code. From a local clone instead: `claude --plugin-dir ./claude-compass`.

## Use

Click the gold `◈ compass` under the prompt to open or close the pane, or type `/compass`. Next to it, the status row shows `✓ last step › ● now › ○ next` and anything waiting on you (`? 2 to answer`, `! needs you`). Labels are shown whole or dropped when space is short, never cut mid-word.

At the top of every tab, a **sync line**: whether the chart has caught up with the session: `✓ in sync`, `⟳ charting your new message`, `◌ not charted yet: your message …`, `◌ N turns behind`, with `↻ update`.

Pinned to the bottom of the pane, the **outbox**: everything the pane will put into the session, one line per item, marked by when it goes: `↪` into this turn, `⏭` as the next turn, `✎` with your next prompt. Every item waits 8 s (with a countdown) before it is sent, so you can still change your mind: click to preview the exact text, `▲▼` to reorder, `⚡` to send now, `✕` to remove (what it did in the pane is undone). `✓n` unfolds what was already sent.

| Tab | What it shows |
| --- | --- |
| `├ flow` | The session as a git-style flow chart: finished milestones folded, a fisheye around **now**, dead ends and side branches, decisions. Click a step for **go / skip / later / retry**. `key` explains every mark. When the last turns show the work could go another way, the active milestone forks: **as planned** on the left, one **branch** on the right (`⑂ 2 ways` under the prompt). Once you pick a side, that fork (either side of it, reworded or reversed) isn't offered again, even while the work waits on an event or a decision. `▶ keep this` stays the course; `⤴ take this` steers the session there and redraws the flow at once (✕ in the outbox undoes it before it's sent). |
| `☑ tasks` | A Jira-style board: DOING (limit 3), TO DO, DONE, BACKLOG. Drag cards between lanes, or click one for move buttons. Add your own tasks; the agent takes them next turn. |
| `? grill` | The agent's questions for you, asked in rounds using the grilling method: each with a recommendation, answer by option or free text, `?` for a follow-up, `✕` to dismiss a question that no longer matters (the agent is told, and it isn't asked again). A round goes back to the agent as one turn. |
| `⇄ chat` | Other Claude sessions and agents (via `ListAgents`) and the Remote Control indicator. Each agent shows `● N new`, `◂in ▸out` counts and its last message; click one for a summary and its history, one line per message (`◂ in` / `▸ out`, age, first sentence), click a line to read it all. Messages the session's Claude sends with SendMessage are recorded too. |
| `∑ stats` | Session time, turns, tools, errors, files, cost, context, progress, and compass's own token use. |
| `≡ recap` | A short recap you can copy, plus your `/btw` side questions. |

Long text wraps instead of being cut off.

Commands: `/compass`, `/compass refresh`, `/compass steer <text>`, `/compass task <text>`.

## How it works and what it costs

- The map is made by one extra model call (`$.model.fork`) that reuses the session's prompt cache: after each turn, 20 s into a turn, and every 3 min during long ones. The stats tab shows compass's own token use.
- The agent gets a `grill` tool and short instructions in its system prompt for asking you questions without blocking.
- The chart is saved in Claude Code's own folder for the session (`~/.claude/projects/<project>/<session-id>/compass/snapshot.json`), so `claude --resume` reopens it without charting again, and it is removed when Claude Code cleans up the session.

## Trust

A mod runs on your machine with the same access Claude Code has. Read the source (`hooks/register.tsx`, `hooks/board.tsx`, `hooks/brand.tsx`) before installing.

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
