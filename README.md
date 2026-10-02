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

Click the `🧭 goal › milestone › [step] → next` line under the prompt to open or close the pane, or type `/compass`.

| Tab | What it shows |
| --- | --- |
| `├ flow` | The session as a git-style flow chart: finished milestones folded, a fisheye around **now**, dead ends and side branches, decisions. Click a step for **go / skip / later / retry**. `key` explains every mark. |
| `☑ tasks` | A Jira-style board: DOING (limit 3), TO DO, DONE, BACKLOG. Drag cards between lanes, or click one for move buttons. Add your own tasks; the agent takes them next turn. |
| `? grill` | The agent's questions for you, asked in rounds using the grilling method: each with a recommendation, answer by option or free text, `?` for a follow-up. A round goes back to the agent as one turn. |
| `⇄ chat` | Other Claude sessions and agents (via `ListAgents`), the Remote Control indicator, and message threads with each. |
| `∑ stats` | Session time, turns, tools, errors, files, cost, context, progress, and compass's own token use. |
| `≡ recap` | A short recap you can copy, plus your `/btw` side questions. |

Everything you do in the pane shows its status: `⋯ queued`, `↗ sent`, or `✗ rejected` (with rollback), and `⚡` sends a queued item now.

Commands: `/compass`, `/compass refresh`, `/compass steer <text>`, `/compass task <text>`.

## How it works and what it costs

- The map is made by one extra model call (`$.model.fork`) that reuses the session's prompt cache: after each turn, 20 s into a turn, and every 3 min during long ones. The stats tab shows compass's own token use.
- The agent gets a `grill` tool and short instructions in its system prompt for asking you questions without blocking.
- The chart is saved in Claude Code's own folder for the session (`~/.claude/projects/<project>/<session-id>/compass/snapshot.json`), so `claude --resume` reopens it without charting again, and it is removed when Claude Code cleans up the session.

## Trust

A mod runs on your machine with the same access Claude Code has. Read the source (`hooks/register.tsx`, `hooks/board.tsx`) before installing.

## Develop

```
claude plugin validate .
claude plugin test .
```

## License

MIT, see [LICENSE](LICENSE).
