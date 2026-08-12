---
name: agent-bridge
description: Use agent-bridge CLI (multi-agent-bridge) to connect to and communicate with other OpenCode AI sessions, list sessions, manage server configurations, and run multi-agent scenarios. Use when the user asks to interact with other sessions, list projects' sessions, configure session bridges, or orchestrate multi-agent discussions.
---

# agent-bridge

Use `agent-bridge` CLI to interact with other OpenCode sessions. It connects to a running OpenCode server and allows listing, searching, and communicating with existing AI agent sessions.

## Prerequisites

A server must be configured before use. If no server is configured, run:

```sh
agent-bridge server add local http://localhost:8787
```

The command will prompt for a password. Configuration is stored at `~/.config/multi-agent-bridge/config.json`.

## Commands

### List sessions

Lists sessions in the current working directory:

```sh
agent-bridge sessions
```

Filter by keyword (matches title and directory):

```sh
agent-bridge sessions --keyword "code review"
```

### Query sessions in a specific directory

List sessions in any directory without changing the working directory:

```sh
agent-bridge query --directory /path/to/project
```

With keyword filter (matches title and directory):

```sh
agent-bridge query --directory /path/to/project --keyword "debug"
```

Add `--content` to also search inside session messages (slower):

```sh
agent-bridge query --directory /path/to/project --keyword "authentication" --content
```

### Connect to a session

Interactively select and chat with a session:

```sh
agent-bridge connect
```

Or connect directly by session ID:

```sh
agent-bridge connect ses_abc123
```

Once connected, type messages to the session. Type `exit` or `quit` to disconnect.

### Check session status

Check a session's pending questions and recent messages:

```sh
agent-bridge check <sessionId>
```

If a session has pending questions (e.g., the question tool is blocking it), you can respond:

```sh
# Approve a question request
agent-bridge check <sessionId> --approve <requestId>

# Reject a question request
agent-bridge check <sessionId> --reject <requestId>

# Reply to a question with custom text
agent-bridge check <sessionId> --reply <requestId> "your answer here"
```

### List servers

```sh
agent-bridge servers
```

### Add a server

```sh
agent-bridge server add local http://localhost:8787
```

### Set default server

```sh
agent-bridge server default local
```

## Multi-Agent Scenarios

Run from the project directory using `npm start`:

```sh
# Group discussion among multiple agents
npm start group "What is the best approach for scalable web apps?"

# Hierarchical delegation (analyst → planner → coder)
npm start delegate "Design a REST API for a task management system"

# Interactive chat with all agents
npm start chat

# Run all demos (group chat, routing, broadcast)
npm start demo
```

## Inter-Agent Communication

Agents can communicate using these directives in their prompts or responses:

| Directive | Description |
|---|---|
| `@agent:<name> <message>` | Send a direct message to a specific agent |
| `@broadcast <message>` | Broadcast a message to all other agents |
| `@all <message>` | Same as broadcast |

## Important

- **DO NOT** connect to or send messages to the current session. This will cause an internal error and may result in session data loss.
- Use `agent-bridge query --directory <path>` to inspect sessions in other projects without changing directories.
- The tool is read-only for existing sessions — it does not modify or delete them.

## Connected Session Best Practices

When writing prompts for sessions that will be connected via agent-bridge:

- **Avoid the `question` tool** — it blocks the session waiting for user input. No user is watching a connected session, so questions will cause the session to hang indefinitely.
- **Report missing information** — if the session lacks context needed to complete its task, abort early and report exactly what information is required. The sending agent can supply the missing details and retry.
- **Use `agent-bridge check`** to monitor connected sessions for pending questions. If a session is blocked, use `--approve`, `--reject`, or `--reply` to unblock it.
