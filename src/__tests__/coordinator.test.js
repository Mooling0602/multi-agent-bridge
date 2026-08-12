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

    it("listServerSessions returns sessions with directory", { timeout: 10_000 }, async () => {
      const sessions = await coordinator.listServerSessions();
      assert.ok(Array.isArray(sessions));
      assert.ok(sessions.length >= 2);
      for (const s of sessions) {
        assert.ok(s.id, "should have id");
        assert.ok(s.title, "should have title");
        assert.ok("directory" in s, "should have directory");
        assert.ok(s.timeCreated, "should have timeCreated");
      }
    });
  });

  describe("findSessions", () => {
    it("finds sessions by directory path", { timeout: 10_000 }, async () => {
      const all = await coordinator.listServerSessions();
      const dir = all[0]?.directory;
      if (!dir) return; // skip if sessions lack directory

      const found = await coordinator.findSessions({ directory: dir });
      assert.ok(found.length > 0, "should find sessions for the directory");
    });

    it("finds sessions by title keyword", { timeout: 10_000 }, async () => {
      const found = await coordinator.findSessions({ keyword: "tester" });
      assert.ok(found.length > 0, "should find the tester session");
      assert.ok(found.some((s) => s.title === "tester"));
    });

    it("returns empty for non-matching keyword", { timeout: 10_000 }, async () => {
      const found = await coordinator.findSessions({ keyword: "zzz_nonexistent_zzz" });
      assert.equal(found.length, 0);
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

  describe("external server connection", () => {
    it("connects to running server and adopts a session", { timeout: 30_000 }, async () => {
      const ext = new SessionCoordinator(
        [],
        { serverUrl: "http://localhost:4096", password: coordinator._password }
      );
      await ext.start();

      try {
        const sessions = await ext.listServerSessions();
        assert.ok(sessions.length > 0, "should see sessions on the same server");

        const targetId = sessions[0].id;
        const adopted = await ext.adoptSession(targetId, "third");
        assert.equal(adopted.id, targetId);
        assert.ok(ext.getAgent("third"));

        const resp = await ext.sendToAgent(
          "third",
          'Reply with exactly: "CONNECTED" (no quotes). Do not add any other text.'
        );
        assert.ok(resp.includes("CONNECTED"));
      } finally {
        await ext.stop();
        assert.equal(ext.listAgents().length, 0,
          "stop on external server should not delete sessions");
      }
    });
  });
});
