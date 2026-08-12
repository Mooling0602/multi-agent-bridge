// ─── Agent Configuration ────────────────────────────────────────
/**
 * @typedef {Object} AgentConfig
 * @property {string} name        - Unique agent identifier
 * @property {string} systemPrompt - System-level instructions for the agent
 * @property {string} [model]      - ProviderID/modelID string
 * @property {string[]} [peers]    - Names of peer agents this agent can communicate with
 * @property {string} [sessionId]  - Attach to an existing session instead of creating new one
 */

// ─── Inter-Agent Message ────────────────────────────────────────
/**
 * @typedef {Object} AgentMessage
 * @property {"send_message"|"broadcast"|"request_help"|"delegate"} action
 * @property {string} from     - Sender agent name
 * @property {string} [to]     - Target agent name (required for send_message/request_help/delegate)
 * @property {string} content  - Message content
 */

// ─── Conversation Turn ───────────────────────────────────────────
/**
 * @typedef {Object} ConversationTurn
 * @property {string} agent    - Agent name
 * @property {"user"|"agent"|"inter-agent"} role
 * @property {string} content  - The text content
 * @property {string} timestamp
 */

// ─── Routing Result ──────────────────────────────────────────────
/**
 * @typedef {Object} RouteResult
 * @property {AgentMessage[]} messages - Parsed inter-agent messages
 * @property {string} remainingText    - Text with inter-agent markers stripped
 */

// ─── Agent State ─────────────────────────────────────────────────
/**
 * @typedef {Object} AgentState
 * @property {AgentConfig} config
 * @property {string} sessionId
 * @property {ConversationTurn[]} history
 */

// ─── Constants ───────────────────────────────────────────────────
export const ROUTING_PATTERNS = {
  // @agent:name message content
  directMessage: /@agent:(\w[\w-]*)\s+(.+?)(?=@agent:|@title|$)/gs,
  // @broadcast message content
  broadcast: /@broadcast\s+(.+?)(?=@broadcast|@agent:|@title|$)/gs,
  // @all message content
  broadcastAll: /@all\s+(.+?)(?=@all|@agent:|@broadcast|@title|$)/gs,
  // @title new name
  rename: /@title\s+(.+?)(?=@title|@agent:|@broadcast|@all|$)/gs,
};

export const STRUCTURED_ACTION_SCHEMA = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      actions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["send_message", "broadcast", "request_help", "delegate"],
              description: "The type of inter-agent action to perform",
            },
            target: {
              type: "string",
              description: "Target agent name (omit for broadcast)",
            },
            content: {
              type: "string",
              description: "The message to send to the target agent",
            },
          },
          required: ["action", "content"],
        },
        description: "Inter-agent actions to dispatch",
      },
      response: {
        type: "string",
        description: "The direct response to the user after dispatching actions",
      },
    },
  },
};
