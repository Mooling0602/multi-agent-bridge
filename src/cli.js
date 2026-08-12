#!/usr/bin/env node
import { SessionCoordinator } from "./coordinator.js";
import { resolveServer, loadConfig, saveConfig, getConfigPath } from "./config.js";

const HELP = `
agent-bridge  —  Multi-Agent Bridge CLI

Usage:  agent-bridge <command> [args]

Session management:
  connect [sessionId]     Interactive connect (uses default server)
  connect --server <name> <sessionId>   Use a named server
  sessions [--keyword <kw>] [--content]   List/filter sessions in current dir
  sessions --server <name>               List sessions on a specific server
  query --directory <path> [--keyword <kw>] [--content]  List sessions in any dir
  servers                  List configured servers
  server add <name> <url>   Add a server (will prompt for password)
  server default <name>     Set the default server

Agent scenarios (run from project dir):
  npm start help           Show all scenarios (demo, group, delegate, chat, etc.)

  help                     Show this message

Config: ${getConfigPath()}
`;

async function getReadline() {
  const { createInterface } = await import("readline");
  return createInterface({ input: process.stdin, output: process.stdout });
}

async function question(rl, q) {
  return new Promise((resolve) => rl.question(q, resolve));
}

function noServerExit() {
  console.error("No server configured.\n");
  console.error(`Add one:  agent-bridge server add <name> <url>`);
  process.exit(1);
}

async function cmdConnect(args) {
  let serverName = null;
  let sessionId = null;
  let i = 0;

  while (i < args.length) {
    if (args[i] === "--server" || args[i] === "-s") {
      serverName = args[++i];
    } else {
      sessionId = args[i];
    }
    i++;
  }

  const server = resolveServer(serverName);
  if (!server) noServerExit();

  if (!sessionId) {
    console.log(`Server: ${server.url}${serverName ? "" : " (default)"}`);
    const coordinator = new SessionCoordinator([], server);
    await coordinator.start();
    try {
      const sessions = await coordinator.listServerSessions(process.cwd());
      if (sessions.length === 0) {
        console.log("No sessions found.");
        return;
      }
      console.log("\nAvailable sessions:\n");
      sessions.forEach((s, i) => {
        const dir = s.directory ? ` — ${s.directory}` : "";
        console.log(`  [${i}] ${s.title}${dir}`);
        console.log(`      ${s.id}`);
      });
      console.log();
      const rl = await getReadline();
      const idx = await question(rl, "Select session number (or paste session ID): ");
      rl.close();
      const num = parseInt(idx.trim(), 10);
      sessionId = !isNaN(num) && sessions[num] ? sessions[num].id : idx.trim();
      if (!sessionId) return;
    } finally {
      await coordinator.stop();
    }
  }

  const targetServer = resolveServer(serverName);
  if (!targetServer) noServerExit();

  console.log(`Server: ${targetServer.url}`);
  console.log(`Session: ${sessionId}\n`);

  const coordinator = new SessionCoordinator(
    [{ name: "external", systemPrompt: "", sessionId }],
    targetServer
  );
  await coordinator.start();

  try {
    const rl = await getReadline();
    console.log('Type messages or "exit" to quit.\n');
    while (true) {
      const input = await question(rl, "> ");
      if (!input || input === "exit" || input === "quit") break;
      const resp = await coordinator.sendToAgent("external", input);
      console.log(`\n${resp}\n`);
    }
    rl.close();
  } finally {
    await coordinator.stop();
  }
}

async function filterByContent(coordinator, sessions, keyword) {
  const lower = keyword.toLowerCase();
  const results = await Promise.all(
    sessions.map(async (s) => {
      try {
        const msgs = await coordinator.getSessionMessages(s.id);
        const match = msgs.some((m) => {
          const text = m.parts?.filter((p) => p.type === "text").map((p) => p.text).join(" ") ?? "";
          return text.toLowerCase().includes(lower);
        });
        return match ? s : null;
      } catch {
        return null;
      }
    })
  );
  return results.filter(Boolean);
}

async function cmdSessions(args) {
  let serverName = null;
  let keyword = null;
  let content = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--server" || args[i] === "-s") {
      serverName = args[++i];
    } else if (args[i] === "--keyword") {
      keyword = args[++i];
    } else if (args[i] === "--content") {
      content = true;
    }
  }

  const server = resolveServer(serverName);
  if (!server) noServerExit();

  const coordinator = new SessionCoordinator([], server);
  await coordinator.start();
  try {
    const sessions = await coordinator.listServerSessions(process.cwd());
    let filtered = sessions;
    if (keyword) {
      const lower = keyword.toLowerCase();
      filtered = sessions.filter((s) =>
        s.title.toLowerCase().includes(lower) ||
        (s.directory && s.directory.toLowerCase().includes(lower))
      );
    }
    if (content && keyword) {
      filtered = await filterByContent(coordinator, filtered, keyword);
    }
    if (filtered.length === 0) {
      console.log("No sessions found.");
      return;
    }
    console.log(`Server: ${server.url}\n`);
    for (const s of filtered) {
      const dir = s.directory || "";
      console.log(`${s.id}  "${s.title}"  ${dir}`);
    }
  } finally {
    await coordinator.stop();
  }
}

async function cmdQuery(args) {
  let serverName = null;
  let directory = null;
  let keyword = null;
  let content = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--server" || args[i] === "-s") {
      serverName = args[++i];
    } else if (args[i] === "--directory" || args[i] === "-d") {
      directory = args[++i];
    } else if (args[i] === "--keyword") {
      keyword = args[++i];
    } else if (args[i] === "--content") {
      content = true;
    }
  }

  if (!directory) {
    console.log("Usage: agent-bridge query --directory <path> [--keyword <kw>] [--content]");
    process.exit(1);
  }

  const server = resolveServer(serverName);
  if (!server) noServerExit();

  const coordinator = new SessionCoordinator([], server);
  await coordinator.start();
  try {
    const sessions = await coordinator.listServerSessions(directory);
    let filtered = sessions;
    if (keyword) {
      const lower = keyword.toLowerCase();
      filtered = sessions.filter((s) =>
        s.title.toLowerCase().includes(lower) ||
        (s.directory && s.directory.toLowerCase().includes(lower))
      );
    }
    if (content && keyword) {
      filtered = await filterByContent(coordinator, filtered, keyword);
    }
    if (filtered.length === 0) {
      console.log("No sessions found.");
      return;
    }
    console.log(`Server: ${server.url}  Directory: ${directory}\n`);
    for (const s of filtered) {
      console.log(`${s.id}  "${s.title}"  ${s.directory || ""}`);
    }
  } finally {
    await coordinator.stop();
  }
}

function cmdServers() {
  const config = loadConfig();
  if (Object.keys(config.servers).length === 0) {
    console.log("No servers configured.\n");
    console.log(`Configure one:  agent-bridge server add <name> <url>`);
    console.log(`Config file:    ${getConfigPath()}`);
    return;
  }
  console.log("Servers:\n");
  for (const [name, s] of Object.entries(config.servers)) {
    const mark = name === config.defaultServer ? " [default]" : "";
    console.log(`  ${name}${mark}: ${s.url}`);
  }
  console.log(`\nConfig: ${getConfigPath()}`);
}

async function cmdServerAdd(args) {
  const name = args[0];
  const url = args[1];
  if (!name || !url) {
    console.log("Usage: agent-bridge server add <name> <url>");
    console.log("Example: agent-bridge server add local http://localhost:8787");
    process.exit(1);
  }

  const rl = await getReadline();
  const password = await question(rl, "Password: ");
  rl.close();

  const config = loadConfig();
  config.servers[name] = { url, password: password.trim() };
  if (!config.defaultServer) config.defaultServer = name;
  saveConfig(config);

  console.log(`Server "${name}" added (${url})`);
}

function cmdServerDefault(args) {
  const name = args[0];
  if (!name) {
    console.log("Usage: agent-bridge server default <name>");
    process.exit(1);
  }
  const config = loadConfig();
  if (!config.servers[name]) {
    console.error(`Server "${name}" not found.`);
    process.exit(1);
  }
  config.defaultServer = name;
  saveConfig(config);
  console.log(`Default server set to "${name}"`);
}

async function main() {
  const command = process.argv[2] ?? "help";
  const args = process.argv.slice(3);

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    process.exit(0);
  }

  try {
    switch (command) {
      case "connect":
        await cmdConnect(args);
        break;
      case "sessions":
        await cmdSessions(args);
        break;
      case "query":
        await cmdQuery(args);
        break;
      case "servers":
        cmdServers();
        break;
      case "server":
        {
          const sub = args[0];
          const subArgs = args.slice(1);
          if (sub === "add") await cmdServerAdd(subArgs);
          else if (sub === "default") cmdServerDefault(subArgs);
          else console.log(`Unknown server subcommand: ${sub}\nUsage: agent-bridge server <add|default>`);
        }
        break;
      default:
        console.log(`Unknown command: ${command}\n`);
        console.log(HELP);
    }
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

main();
