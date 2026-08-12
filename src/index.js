#!/usr/bin/env node
import { SessionCoordinator } from "./coordinator.js";

/**
 * Multi-Agent Bridge CLI
 *
 * Usage:
 *   node src/index.js <scenario-name>
 *
 * Available scenarios:
 *   - chat: interactive group chat
 *   - help: show this help
 */

const DEFAULT_AGENTS = [
  {
    name: "analyst",
      systemPrompt: `You are an Analyst agent. Analyze problems, break them down, and identify key considerations. Respond concisely.

You can communicate with other agents:
- @agent:<name> <message> - Send a direct message
- @broadcast <message> - Send to all other agents
- @title <new-name> - Rename your own session title

Available peers: planner, coder`,
    peers: ["planner", "coder"],
  },
  {
    name: "planner",
      systemPrompt: `You are a Planner agent. Create structured plans and task breakdowns. Respond concisely.

You can communicate with other agents:
- @agent:<name> <message> - Send a direct message
- @broadcast <message> - Send to all other agents
- @title <new-name> - Rename your own session title

Available peers: analyst, coder`,
    peers: ["analyst", "coder"],
  },
  {
    name: "coder",
      systemPrompt: `You are a Coder agent. Write and explain code based on requirements. Respond concisely.

You can communicate with other agents:
- @agent:<name> <message> - Send a direct message
- @broadcast <message> - Send to all other agents
- @title <new-name> - Rename your own session title

Available peers: analyst, planner`,
    peers: ["analyst", "planner"],
  },
];

async function main() {
  const scenario = process.argv[2] ?? "help";

  if (scenario === "help" || scenario === "--help" || scenario === "-h") {
    console.log(`
Multi-Agent Bridge CLI
======================

Usage:  node src/index.js <scenario>

  Scenarios:
  chat              Interactive group chat with all agents
  group <topic>     Start a structured group discussion on a topic
  delegate <topic>  Delegate a task through the agent hierarchy
  connect <url> <password> <sessionId>  Connect to an existing session
  demo              Run a demonstration of agent-to-agent routing
  help              Show this help message
`);
    process.exit(0);
  }

  if (scenario === "connect") {
    const serverUrl = process.argv[3];
    const password = process.argv[4];
    const sessionId = process.argv[5];

    if (!serverUrl || !password || !sessionId) {
      console.log("Usage: node src/index.js connect <serverUrl> <password> <sessionId>");
      console.log("Example: node src/index.js connect http://localhost:8787 mypassword ses_abc123");
      process.exit(1);
    }

    const coordinator = new SessionCoordinator(
      [{ name: "external", systemPrompt: "", sessionId }],
      { serverUrl, password }
    );
    await coordinator.start();
    console.log(`Connected to ${serverUrl}, session ${sessionId}`);
    console.log('Type messages or "exit" to quit.\n');

    try {
      await extInteractiveChat(coordinator, "external");
    } finally {
      await coordinator.stop();
    }
    return;
  }

  console.log("Starting OpenCode server and creating agent sessions...");
  const coordinator = new SessionCoordinator(DEFAULT_AGENTS);
  await coordinator.start();

  const agents = coordinator.listAgents();
  console.log(`Agents ready: ${agents.join(", ")}\n`);

  try {
    if (scenario === "demo") {
      await runDemo(coordinator);
    } else if (scenario === "group") {
      const topic = process.argv[3] ?? "What is the best approach for building scalable web applications?";
      await runGroupChat(coordinator, topic);
    } else if (scenario === "delegate") {
      const topic = process.argv[3] ?? "Design a REST API for a task management system";
      await runDelegation(coordinator, topic);
    } else if (scenario === "chat") {
      await runInteractiveChat(coordinator);
    } else {
      console.log(`Unknown scenario: ${scenario}`);
      console.log("Run 'node src/index.js help' for options.");
    }
  } finally {
    console.log("\nShutting down...");
    await coordinator.stop();
  }
}

async function runDemo(coordinator) {
  console.log("=== DEMO 1: Group Chat ===\n");
  console.log("Topic: What's the most important factor in software architecture?\n");

  const chatResult = await coordinator.groupChat(
    "What's the most important factor in software architecture?",
    { rounds: 1 }
  );
  for (const round of chatResult) {
    for (const entry of round) {
      console.log(`--- ${entry.agent.toUpperCase()} ---`);
      console.log(entry.response.substring(0, 250));
      console.log();
    }
  }

  console.log("\n=== DEMO 2: Agent-to-Agent Routing ===\n");
  const result1 = await coordinator.turn(
    "analyst",
    "Write a simple Python script that says hello world. Then send it to coder for review using: @agent:coder Please review this: <your code>"
  );
  console.log(`Final response:\n${result1.finalResponse.substring(0, 500)}...\n`);

  console.log("\n=== DEMO 3: Broadcasting ===\n");
  const broadcastResult = await coordinator.turn(
    "analyst",
    "@broadcast Please introduce yourself in one sentence."
  );
  console.log(`Broadcast response:\n${broadcastResult.finalResponse.substring(0, 500)}...`);
}

async function runGroupChat(coordinator, topic) {
  console.log(`Group discussion topic: "${topic}"\n`);

  const result = await coordinator.groupChat(topic, { rounds: 1 });
  for (const round of result) {
    for (const entry of round) {
      console.log(`\n=== ${entry.agent.toUpperCase()} ===`);
      console.log(entry.response);
    }
  }
}

async function runDelegation(coordinator, topic) {
  console.log(`Delegation chain for: "${topic}"\n`);

  const result = await coordinator.turn("analyst", topic);
  console.log(`\n=== FINAL RESPONSE ===`);
  console.log(result.finalResponse);
  console.log(`\nTurn log (${result.log.length} turns):`);
  for (const entry of result.log) {
    console.log(`  ${entry.agent}: "${entry.message.substring(0, 80)}..."`);
  }
}

async function runInteractiveChat(coordinator) {
  const readline = (await import("readline")).default;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const question = (q) => new Promise((resolve) => rl.question(q, resolve));

  console.log('Interactive mode. Type a message or "exit" to quit.');
  console.log('Format: @agent:name message - to direct a specific agent');
  console.log('        @all message - to broadcast');
  console.log();

  while (true) {
    const input = await question("> ");
    if (!input || input === "exit" || input === "quit") break;

    if (input.startsWith("@agent:")) {
      const match = input.match(/^@agent:(\w[\w-]*)\s+(.+)$/);
      if (match) {
        const resp = await coordinator.sendToAgent(match[1], match[2]);
        console.log(`\n[${match[1]}]: ${resp}\n`);
      }
    } else if (input.startsWith("@all ")) {
      const msg = input.slice(5);
      const result = await coordinator.groupChat(msg, { rounds: 1 });
      for (const round of result) {
        for (const entry of round) {
          console.log(`\n[${entry.agent}]: ${entry.response.substring(0, 300)}\n`);
        }
      }
    } else {
      const result = await coordinator.turn("analyst", input);
      console.log(`\n[Response]: ${result.finalResponse}\n`);
    }
  }

  rl.close();
}

async function extInteractiveChat(coordinator, agentName) {
  const readline = (await import("readline")).default;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const question = (q) => new Promise((resolve) => rl.question(q, resolve));

  while (true) {
    const input = await question("> ");
    if (!input || input === "exit" || input === "quit") break;

    const resp = await coordinator.sendToAgent(agentName, input);
    console.log(`\n${resp}\n`);
  }

  rl.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
