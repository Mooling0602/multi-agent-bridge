import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert/strict";
import { SessionCoordinator } from "../coordinator.js";

const TEST_AGENTS = [
  {
    name: "tester",
    systemPrompt:
      "You are a test agent. Respond concisely in one sentence. Do NOT use @agent, @broadcast, or @all directives in your response.",
    peers: [],
  },
  {
    name: "helper",
    systemPrompt:
      "You are a helper agent. Respond concisely in one sentence. Do NOT use @agent, @broadcast, or @all directives in your response.",
    peers: ["tester"],
  },
];

describe("SessionCoordinator", () => {
  /** @type {SessionCoordinator} */
  let coordinator;

  before(async () => {
    coordinator = new SessionCoordinator(TEST_AGENTS);
  });

  after(async () => {
    if (coordinator) {
      try {
        await coordinator.stop();
      } catch {}
    }
  });

  describe("lifecycle", () => {
    it("start creates agents and client", { timeout: 30_000 }, async () => {
      await coordinator.start();
      const agents = coordinator.listAgents();
      assert.deepStrictEqual(agents.sort(), ["tester", "helper"].sort());
    });

    it("getAgent returns state with sessionId", () => {
      const state = coordinator.getAgent("tester");
      assert.ok(state, "tester agent should exist");
      assert.ok(state.sessionId, "should have a sessionId");
      assert.equal(state.config.name, "tester");
    });

    it("listServerSessions returns sessions", { timeout: 10_000 }, async () => {
      const sessions = await coordinator.listServerSessions();
      assert.ok(Array.isArray(sessions));
      assert.ok(sessions.length >= 2);
    });
  });

  describe("sendToAgent", () => {
    it("sends a message and gets a response", { timeout: 30_000 }, async () => {
      const response = await coordinator.sendToAgent(
        "tester",
        'Reply with exactly: "PONG" (no quotes). Do not add any other text.'
      );
      assert.ok(typeof response === "string");
      assert.ok(response.length > 0);
    });

    it("throws for unknown agent", async () => {
      await assert.rejects(
        () => coordinator.sendToAgent("nonexistent", "hello"),
        /Agent "nonexistent" not found/
      );
    });

    it("records messages in agent history", { timeout: 30_000 }, async () => {
      await coordinator.sendToAgent(
        "tester",
        'Reply with exactly: "OK" (no quotes). Do not add any other text. Do not use routing directives.'
      );
      const history = coordinator.getHistory("tester");
      assert.ok(history.length >= 2, "should have at least user + agent entries");
      const lastAgentEntry = history.filter((e) => e.role === "agent").at(-1);
      assert.ok(lastAgentEntry, "should have an agent entry");
      assert.ok(lastAgentEntry.content.includes("OK"));
    });
  });

  describe("parseRoutes", () => {
    it("parses @agent:name directives", () => {
      const { messages, remainingText } = coordinator.parseRoutes(
        "Hello @agent:helper Please review this code."
      );
      assert.equal(messages.length, 1);
      assert.equal(messages[0].action, "send_message");
      assert.equal(messages[0].to, "helper");
      assert.equal(messages[0].content, "Please review this code.");
      assert.ok(remainingText.startsWith("Hello"));
    });

    it("parses @broadcast directives", () => {
      const { messages, remainingText } = coordinator.parseRoutes(
        "@broadcast Hello everyone! Some extra text."
      );
      assert.equal(messages.length, 1);
      assert.equal(messages[0].action, "broadcast");
      assert.equal(messages[0].content, "Hello everyone! Some extra text.");
      assert.equal(remainingText, "");
    });

    it("parses multiple directives", () => {
      const { messages } = coordinator.parseRoutes(
        "@agent:helper Please help. @agent:helper Also check this."
      );
      assert.ok(messages.length >= 1);
      assert.equal(messages[0].action, "send_message");
      assert.equal(messages[0].to, "helper");
    });

    it("returns empty messages for text without directives", () => {
      const { messages, remainingText } = coordinator.parseRoutes("Just a normal response.");
      assert.equal(messages.length, 0);
      assert.equal(remainingText, "Just a normal response.");
    });
  });

  describe("groupChat", () => {
    it("runs a single-round group chat", { timeout: 60_000 }, async () => {
      const log = await coordinator.groupChat(
        'What is 2 + 2? Answer with just the number.',
        { rounds: 1 }
      );
      assert.ok(Array.isArray(log));
      assert.equal(log.length, 1, "should have 1 round");
      assert.ok(Array.isArray(log[0]));
      assert.ok(log[0].length >= 1, "should have at least 1 entry in round 1");

      for (const entry of log[0]) {
        assert.ok(entry.agent, "entry should have agent name");
        assert.ok(entry.response, "entry should have response");
      }
    });
  });

  describe("turn", () => {
    it("handles a message with no routing directives", { timeout: 30_000 }, async () => {
      const result = await coordinator.turn(
        "tester",
        'Reply with exactly: "TURN_OK" (no quotes). Do not add any other text. Important: do not use @agent or @broadcast.'
      );
      assert.ok(result.log.length >= 1);
      assert.ok(result.finalResponse.includes("TURN_OK"));
    });
  });

  describe("injectContext", () => {
    it("injects context without triggering a reply", { timeout: 15_000 }, async () => {
      const histBefore = coordinator.getHistory("helper").length;
      await coordinator.injectContext(
        "helper",
        "[System] This is a test context injection."
      );
      const histAfter = coordinator.getHistory("helper").length;
      assert.equal(histAfter, histBefore + 1, "should add one inter-agent entry");
      const last = coordinator.getHistory("helper").at(-1);
      assert.equal(last.role, "inter-agent");
    });
  });
});
