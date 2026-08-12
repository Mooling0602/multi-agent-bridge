import { createOpencodeClient } from "@opencode-ai/sdk";
import { spawn } from "child_process";
import { randomBytes } from "crypto";
import { ROUTING_PATTERNS } from "./types.js";

const MAX_CONCURRENT = 2;

export class SessionCoordinator {
  /** @param {import("./types.js").AgentConfig[]} agents */
  constructor(agents) {
    this.configs = agents;
    this.client = null;
    this._serverProc = null;
    this._password = randomBytes(16).toString("hex");
    this._concurrency = 0;
    this._pending = [];

    /** @type {Map<string, import("./types.js").AgentState>} */
    this.agents = new Map();
    /** @type {Map<string, Array<(msg: import("./types.js").AgentMessage) => void>>} */
    this.listeners = new Map();
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  async start() {
    this._serverProc = spawn("opencode", ["serve", "--port=4096"], {
      env: { ...process.env, OPENCODE_SERVER_PASSWORD: this._password },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const url = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._serverProc?.kill();
        reject(new Error("Server startup timed out after 15s"));
      }, 15000);
      let output = "";
      this._serverProc.stdout.on("data", (chunk) => {
        output += chunk.toString();
        const match = output.match(/on\s+(https?:\/\/[^\s]+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
      this._serverProc.on("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}\n${output}`));
      });
      this._serverProc.on("error", (err) => { clearTimeout(timeout); reject(err); });
    });

    this.client = createOpencodeClient({
      baseUrl: url,
      headers: { Authorization: "Basic " + btoa("opencode:" + this._password) },
    });

    for (const config of this.configs) {
      await this._createAgent(config);
    }
  }

  async stop() {
    for (const [, state] of this.agents) {
      try { await this.client.session.delete({ path: { id: state.sessionId } }); }
      catch {}
    }
    if (this._serverProc) { this._serverProc.kill(); this._serverProc = null; }
  }

  // ── Agent Operations ───────────────────────────────────────────

  async _createAgent(config) {
    let sessionId = config.sessionId;

    if (!sessionId) {
      const session = await this.client.session.create({
        body: { title: config.name },
      });
      sessionId = session.data.id;
    }

    if (config.systemPrompt) {
      await this.client.session.prompt({
        path: { id: sessionId },
        body: { noReply: true, parts: [{ type: "text", text: config.systemPrompt }] },
      });
    }

    this.agents.set(config.name, {
      config,
      sessionId,
      history: [],
    });
  }

  /**
   * List all sessions visible on the shared server
   */
  async listServerSessions() {
    const result = await this.client.session.list();
    const sessions = result.data || [];
    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      slug: s.slug,
      directory: s.directory,
      timeCreated: s.time?.created,
      timeUpdated: s.time?.updated,
    }));
  }

  /**
   * Find sessions by directory and/or title keyword.
   * Set deep=true to also search inside session messages (slower).
   */
  async findSessions({ directory, keyword, deep = false } = {}) {
    let sessions = await this.listServerSessions();

    if (directory) {
      const dir = directory.replace(/\/+$/, "");
      sessions = sessions.filter((s) => s.directory === dir);
    }

    if (keyword) {
      const lower = keyword.toLowerCase();
      sessions = sessions.filter((s) => s.title.toLowerCase().includes(lower) || s.slug?.toLowerCase().includes(lower));
    }

    if (deep && keyword) {
      const deepResults = await Promise.all(
        sessions.map(async (s) => {
          try {
            const msgs = await this.getSessionMessages(s.id);
            const match = msgs.some((m) => {
              const text = m.parts?.filter((p) => p.type === "text").map((p) => p.text).join(" ") ?? "";
              return text.toLowerCase().includes(keyword.toLowerCase());
            });
            return match ? s : null;
          } catch {
            return null;
          }
        })
      );
      sessions = deepResults.filter(Boolean);
    }

    return sessions;
  }

  /**
   * Read messages from an existing session
   */
  async getSessionMessages(sessionId) {
    const result = await this.client.session.messages({ path: { id: sessionId } });
    return result.data || [];
  }

  getAgent(name) { return this.agents.get(name) ?? null; }
  listAgents() { return [...this.agents.keys()]; }

  // ── Concurrency Gate ───────────────────────────────────────────

  async _acquire() {
    while (this._concurrency >= MAX_CONCURRENT) {
      await new Promise((r) => this._pending.push(r));
    }
    this._concurrency++;
  }

  _release() {
    this._concurrency--;
    const next = this._pending.shift();
    if (next) next();
  }

  // ── Message Sending ────────────────────────────────────────────

  async sendToAgent(agentName, message, opts = {}) {
    const state = this.agents.get(agentName);
    if (!state) throw new Error(`Agent "${agentName}" not found`);

    await this._acquire();
    try {
      const body = {
        parts: [{ type: "text", text: message }],
        model: opts.model || { providerID: "opencode-go", modelID: "deepseek-v4-flash" },
      };

      const result = await this.client.session.prompt({
        path: { id: state.sessionId },
        body,
      });

      const text = this._extractText(result);
      state.history.push(
        { agent: agentName, role: "user", content: message, timestamp: new Date().toISOString() },
        { agent: agentName, role: "agent", content: text, timestamp: new Date().toISOString() }
      );
      return text;
    } finally {
      this._release();
    }
  }

  async injectContext(agentName, context) {
    const state = this.agents.get(agentName);
    if (!state) throw new Error(`Agent "${agentName}" not found`);
    await this.client.session.prompt({
      path: { id: state.sessionId },
      body: { noReply: true, parts: [{ type: "text", text: context }] },
    });
    state.history.push({
      agent: agentName, role: "inter-agent", content: context,
      timestamp: new Date().toISOString(),
    });
  }

  // ── Inter-Agent Routing ────────────────────────────────────────

  parseRoutes(text) {
    /** @type {import("./types.js").AgentMessage[]} */
    const messages = [];
    let remaining = text;

    for (const match of text.matchAll(ROUTING_PATTERNS.directMessage)) {
      messages.push({ action: "send_message", from: "", to: match[1].trim(), content: match[2].trim() });
      remaining = remaining.replace(match[0], "");
    }
    for (const match of text.matchAll(ROUTING_PATTERNS.broadcast)) {
      messages.push({ action: "broadcast", from: "", to: "", content: match[1].trim() });
      remaining = remaining.replace(match[0], "");
    }
    for (const match of text.matchAll(ROUTING_PATTERNS.broadcastAll)) {
      messages.push({ action: "broadcast", from: "", to: "", content: match[1].trim() });
      remaining = remaining.replace(match[0], "");
    }

    return { messages, remainingText: remaining.trim() };
  }

  async dispatchMessages(fromAgent, messages) {
    /** @type {Map<string, string>} */
    const responses = new Map();
    for (const msg of messages) {
      if (msg.action === "broadcast") {
        for (const name of this.agents.keys()) {
          if (name === fromAgent) continue;
          const resp = await this.sendToAgent(name, `[Message from ${fromAgent}]\n${msg.content}`);
          responses.set(name, resp);
          await this._notifyListeners(name, { ...msg, from: fromAgent });
        }
      } else if (msg.action === "send_message") {
        if (!msg.to || msg.to === fromAgent) continue;
        const state = this.agents.get(msg.to);
        if (!state) continue;
        if (fromAgent && state.config.peers && !state.config.peers.includes(fromAgent)) continue;
        const resp = await this.sendToAgent(msg.to, `[Message from ${fromAgent}]\n${msg.content}`);
        responses.set(msg.to, resp);
        await this._notifyListeners(msg.to, { ...msg, from: fromAgent });
      }
    }
    const summary = [...responses.entries()]
      .map(([name, resp]) => `[Response from ${name}]:\n${resp}`)
      .join("\n\n");
    return { responses, summary };
  }

  async turn(agentName, message, opts = {}) {
    const maxRounds = opts.maxRounds ?? 3;
    let currentAgent = agentName;
    let currentMessage = message;
    const turnLog = [];

    for (let round = 0; round < maxRounds; round++) {
      let response;
      try {
        response = await this.sendToAgent(currentAgent, currentMessage);
      } catch (e) {
        if (turnLog.length > 0) {
          return { log: turnLog, finalResponse: turnLog[turnLog.length - 1].response, error: e.message };
        }
        throw e;
      }
      turnLog.push({ agent: currentAgent, message: currentMessage, response });

      const { messages, remainingText } = this.parseRoutes(response);
      if (messages.length === 0) {
        return { log: turnLog, finalResponse: response };
      }

      try {
        const { summary } = await this.dispatchMessages(currentAgent, messages);
        currentMessage = `${remainingText}\n\n[Responses from other agents]:\n${summary}`;
        await this.injectContext(currentAgent, currentMessage);
      } catch (e) {
        return { log: turnLog, finalResponse: `${remainingText}\n\n[Dispatch error: ${e.message}]`, error: e.message };
      }
    }

    return { log: turnLog, finalResponse: turnLog[turnLog.length - 1].response };
  }

  async groupChat(topic, opts = {}) {
    const rounds = opts.rounds ?? 1;
    const agentNames = [...this.agents.keys()];
    const log = [];
    for (let r = 0; r < rounds; r++) {
      const roundLog = [];
      for (const name of agentNames) {
        let prompt;
        if (r === 0) {
          prompt = `[Group Discussion - Round ${r + 1}]\nTopic: ${topic}\n\nShare your thoughts on this topic.`;
        } else {
          prompt = `[Group Discussion - Round ${r + 1}]\nHere's what others said:\n`;
          for (const entry of log.flat())
            prompt += `\n--- ${entry.agent} ---\n${entry.response.substring(0, 300)}`;
          prompt += "\n\nBased on the above, what are your updated thoughts?";
        }
        const response = await this.sendToAgent(name, prompt);
        roundLog.push({ agent: name, prompt, response });
      }
      log.push(roundLog);
    }
    return log;
  }

  // ── Events ─────────────────────────────────────────────────────

  onMessage(agentName, callback) {
    if (!this.listeners.has(agentName)) this.listeners.set(agentName, []);
    this.listeners.get(agentName).push(callback);
  }

  async _notifyListeners(agentName, message) {
    for (const h of this.listeners.get(agentName) ?? []) await h(message);
  }

  // ── History ────────────────────────────────────────────────────

  getHistory(agentName) {
    return this.agents.get(agentName)?.history ?? [];
  }

  // ── Helpers ────────────────────────────────────────────────────

  _extractText(result) {
    if (typeof result === "string") return result;
    if (result?.data?.info?.structured_output)
      return JSON.stringify(result.data.info.structured_output, null, 2);
    if (result?.data?.parts)
      return result.data.parts.filter((p) => p.type === "text").map((p) => p.text).join("\n");
    return JSON.stringify(result);
  }
}
