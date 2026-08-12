import { createOpencodeClient } from "@opencode-ai/sdk";
import { createOpencodeClient as createOpencodeV2Client } from "@opencode-ai/sdk/v2";
import { spawn } from "child_process";
import { randomBytes } from "crypto";
import { ROUTING_PATTERNS } from "./types.js";

const MAX_CONCURRENT = 2;

export class SessionCoordinator {
  /**
   * @param {import("./types.js").AgentConfig[]} agents
   * @param {{ serverUrl?: string, password?: string, defaultModel?: string }} [serverConfig]
   */
  constructor(agents, serverConfig) {
    this.configs = agents;
    this.client = null;
    this._serverProc = null;
    this._ownedServer = false;
    this._password = serverConfig?.password ?? randomBytes(16).toString("hex");
    this._serverUrl = serverConfig?.serverUrl ?? null;
    this._concurrency = 0;
    this._pending = [];
    this._defaultModel = serverConfig?.defaultModel ?? null;

    /** @type {Map<string, import("./types.js").AgentState>} */
    this.agents = new Map();
    /** @type {Map<string, Array<(msg: import("./types.js").AgentMessage) => void>>} */
    this.listeners = new Map();

    /** @type {import("@opencode-ai/sdk/v2").OpencodeClient|null} */
    this._v2Client = null;

    /** @type {Map<string, import("./types.js").DispatchRecord>} */
    this._dispatches = new Map();
  }

  _getV2Client() {
    if (!this._v2Client) {
      const headers = { Authorization: "Basic " + btoa("opencode:" + this._password) };
      this._v2Client = createOpencodeV2Client({
        baseUrl: this._serverUrl,
        headers,
      });
    }
    return this._v2Client;
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  async start() {
    if (this._serverUrl) {
      this.client = createOpencodeClient({
        baseUrl: this._serverUrl,
        headers: { Authorization: "Basic " + btoa("opencode:" + this._password) },
      });
      this._ownedServer = false;
    } else {
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

      this._serverUrl = url;
      this.client = createOpencodeClient({
        baseUrl: url,
        headers: { Authorization: "Basic " + btoa("opencode:" + this._password) },
      });
      this._ownedServer = true;
    }

    for (const config of this.configs) {
      await this._createAgent(config);
    }
  }

  async stop() {
    for (const [, state] of this.agents) {
      if (this._ownedServer) {
        try { await this.client.session.delete({ path: { id: state.sessionId } }); }
        catch {}
      }
    }
    this.agents.clear();
    if (this._ownedServer && this._serverProc) { this._serverProc.kill(); this._serverProc = null; }
  }

  // ── Agent Operations ───────────────────────────────────────────

  async _createAgent(config) {
    let sessionId = config.sessionId;

    if (!sessionId) {
      const modelOpt = config.model || this._defaultModel;
      const createBody = { title: config.name };
      if (modelOpt) {
        const [providerID, modelID] = modelOpt.split("/");
        createBody.model = { providerID, modelID };
      }
      const session = await this.client.session.create({
        body: createBody,
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
   * List all sessions visible on the shared server.
   * If directory is provided, filters sessions for that workspace.
   * Otherwise returns sessions for the default workspace context.
   */
  async listServerSessions(directory) {
    const opts = directory ? { query: { directory } } : {};
    const result = await this.client.session.list(opts);
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
  async findSessions({ directory, keyword, content = false } = {}) {
    let sessions = await this.listServerSessions(directory);

    if (keyword) {
      const lower = keyword.toLowerCase();
      sessions = sessions.filter((s) => s.title.toLowerCase().includes(lower) || s.slug?.toLowerCase().includes(lower));
    }

    if (content && keyword) {
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
  getSessionId(name) { return this.agents.get(name)?.sessionId ?? null; }
  listAgents() { return [...this.agents.keys()]; }

  /**
   * Adopt an existing session as an agent. Connect to an existing server
   * first by passing serverUrl/password to the constructor.
   */
  async adoptSession(sessionId, agentName) {
    const session = await this.client.session.get({ path: { id: sessionId } });
    const data = session.data;
    if (!data) throw new Error(`Session ${sessionId} not found`);

    const config = { name: agentName, systemPrompt: "", peers: [] };
    this.agents.set(agentName, {
      config,
      sessionId,
      history: [],
    });

    return { id: data.id, title: data.title, directory: data.directory };
  }

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
        ...(opts.model ? { model: opts.model } : {}),
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

  // ── Non-Blocking Dispatch ──────────────────────────────────────

  /**
   * Dispatch a message to an agent asynchronously and return immediately.
   * The target session processes the message in the background.
   * @param {string} agentName
   * @param {string} message
   * @param {{ model?: object, fromAgent?: string }} [opts]
   * @returns {Promise<{ admittedSeq: number, sessionInputId: string, sessionID: string }>}
   */
  async dispatchToAgent(agentName, message, opts = {}) {
    const state = this.agents.get(agentName);
    if (!state) throw new Error(`Agent "${agentName}" not found`);

    const v2 = this._getV2Client();
    const body = {
      prompt: {
        parts: [{ type: "text", text: opts.fromAgent ? `[Message from ${opts.fromAgent}]\n${message}` : message }],
      },
      delivery: "queue",
    };
    if (opts.model) body.prompt.model = opts.model;

    const resp = await v2.v2.session.prompt({ sessionID: state.sessionId, body });
    const admitted = resp.data;
    const record = {
      sessionInputId: admitted.id,
      admittedSeq: admitted.admittedSeq,
      targetAgent: agentName,
      targetSession: state.sessionId,
      timeCreated: admitted.timeCreated,
    };
    this._dispatches.set(admitted.id, record);

    state.history.push({
      agent: agentName, role: "user", content: message,
      timestamp: new Date().toISOString(),
    });

    return {
      admittedSeq: admitted.admittedSeq,
      sessionInputId: admitted.id,
      sessionID: admitted.sessionID,
    };
  }

  // ── Session Status ─────────────────────────────────────────────

  /**
   * Check session status: pending questions and recent messages.
   * @param {string} sessionId
   * @returns {Promise<{ sessionId: string, pendingQuestions: Array<{ requestID: string, questions: Array<{ question: string, header: string, options: Array<{ label: string, description: string }>, multiple?: boolean }> }>, recentMessages: Array<{ role: string, text: string, timestamp: string }> }>}
   */
  async checkSession(sessionId) {
    const v2 = this._getV2Client();

    /** @type {Array<{ requestID: string, questions: Array<object> }>} */
    let pendingQuestions = [];
    try {
      const qResp = await v2.v2.session.question.list({ sessionID: sessionId });
      const qList = qResp.data || [];
      pendingQuestions = qList.map((q) => ({
        requestID: q.id,
        questions: (q.questions || []).map((qi) => ({
          question: qi.question,
          header: qi.header,
          options: (qi.options || []).map((o) => ({ label: o.label, description: o.description })),
          multiple: qi.multiple,
        })),
      }));
    } catch {
      pendingQuestions = [];
    }

    /** @type {Array<{ role: string, text: string, timestamp: string }>} */
    let recentMessages = [];
    try {
      const msgs = await this.getSessionMessages(sessionId);
      const lastFive = msgs.slice(-5);
      recentMessages = lastFive.map((m) => ({
        role: m.role || (m.parts?.some((p) => p.type === "tool") ? "agent" : "unknown"),
        text: (m.parts || []).filter((p) => p.type === "text").map((p) => p.text).join(" "),
        timestamp: m.time?.created ? new Date(m.time.created).toISOString() : "",
      }));
    } catch {
      recentMessages = [];
    }

    return { sessionId, pendingQuestions, recentMessages };
  }

  /**
   * Answer pending questions for a session.
   * @param {string} sessionId
   * @param {string} requestId
   * @param {Array<Array<string>>} answers - each answer is an array of selected labels
   */
  async replyToQuestion(sessionId, requestId, answers) {
    const v2 = this._getV2Client();
    return v2.v2.session.question.reply({
      sessionID: sessionId,
      requestID: requestId,
      body: { questionV2Reply: { answers } },
    });
  }

  /**
   * Reject a pending question request.
   * @param {string} sessionId
   * @param {string} requestId
   */
  async rejectQuestion(sessionId, requestId) {
    const v2 = this._getV2Client();
    return v2.v2.session.question.reject({
      sessionID: sessionId,
      requestID: requestId,
    });
  }

  // ── Completion Notification ────────────────────────────────────

  /**
   * Notify a sender agent that a dispatched task is complete.
   * Reads the target session's latest agent response and injects a summary
   * into the sender's session context.
   * @param {string} senderAgent - agent name to notify
   * @param {string} targetAgent - agent name that completed work
   * @param {{ message?: string }} [opts]
   * @returns {Promise<string>} the injected notification text
   */
  async notifyCompletion(senderAgent, targetAgent, opts = {}) {
    const targetState = this.agents.get(targetAgent);
    const senderState = this.agents.get(senderAgent);
    if (!targetState || !senderState) {
      throw new Error("Sender or target agent not found");
    }

    const msgs = await this.getSessionMessages(targetState.sessionId);
    const agentMsgs = msgs.filter((m) =>
      m.parts?.some((p) => p.type === "text") && !m.parts?.some((p) => p.type === "tool")
    );
    const lastAgent = agentMsgs.at(-1);
    const lastContent = lastAgent
      ? lastAgent.parts.filter((p) => p.type === "text").map((p) => p.text).join("\n")
      : "(no content)";

    const notification = opts.message
      ? `[System] Agent "${targetAgent}" reports: ${opts.message}`
      : `[System] Agent "${targetAgent}" has completed its work.\n\nSummary:\n${lastContent.substring(0, 500)}`;

    await this.injectContext(senderAgent, notification);
    return notification;
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
    const fromState = this.agents.get(fromAgent);
    const fromSessionId = fromState?.sessionId;

    /** @type {Map<string, string>} */
    const responses = new Map();
    for (const msg of messages) {
      if (msg.action === "broadcast") {
        for (const [name, st] of this.agents) {
          if (name === fromAgent) continue;
          if (fromSessionId && st.sessionId === fromSessionId) continue;
          const resp = await this.sendToAgent(name, `[Message from ${fromAgent}]\n${msg.content}`);
          responses.set(name, resp);
          await this._notifyListeners(name, { ...msg, from: fromAgent });
        }
      } else if (msg.action === "send_message") {
        if (!msg.to || msg.to === fromAgent) continue;
        const state = this.agents.get(msg.to);
        if (!state) continue;
        if (fromAgent && state.config.peers && !state.config.peers.includes(fromAgent)) continue;
        if (fromSessionId && state.sessionId === fromSessionId) continue;
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