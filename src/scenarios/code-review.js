#!/usr/bin/env node
import { SessionCoordinator } from "../coordinator.js";

/**
 * Code Review Scenario
 *
 * Demonstrates multi-agent code review workflow:
 *   1. Coder writes a solution
 *   2. Reviewer critiques it
 *   3. Coder responds to feedback
 */

const CODE_REVIEW_AGENTS = [
  {
    name: "coder",
    systemPrompt: `You are an experienced Coder. You write clean, well-documented code. When asked to implement something, provide the full implementation with explanations.

You can delegate review requests to the reviewer agent:
- @agent:reviewer <message>`,
    peers: ["reviewer"],
  },
  {
    name: "reviewer",
    systemPrompt: `You are a thorough Code Reviewer. You find bugs, security issues, performance problems, and style violations. You give constructive, actionable feedback.

You can respond to the coder agent:
- @agent:coder <message>`,
    peers: ["coder"],
  },
];

async function main() {
  const task = process.argv[2] ?? "Write a function that validates email addresses in JavaScript";

  console.log("Starting code review scenario...\n");
  const coordinator = new SessionCoordinator(CODE_REVIEW_AGENTS);
  await coordinator.start();

  try {
    console.log(`Task: ${task}\n`);
    console.log("=== Phase 1: Coder implements ===\n");

    const codeResponse = await coordinator.turn("coder",
      `${task}\n\nAfter writing the code, send it to the reviewer for feedback using @agent:reviewer`
    );
    console.log(codeResponse.finalResponse);
    console.log();

    console.log("=== Phase 2: Round 2 (if reviewer was involved) ===\n");
    const log = coordinator.getHistory("coder");
    console.log(`Coder history: ${log.length} entries`);
    const reviewerLog = coordinator.getHistory("reviewer");
    console.log(`Reviewer history: ${log.length} entries`);
  } finally {
    await coordinator.stop();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
