import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { homedir } from "os";

const CONFIG_DIR = resolve(homedir(), ".config", "multi-agent-bridge");
const CONFIG_PATH = resolve(CONFIG_DIR, "config.json");

function ensureDir() {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
}

/**
 * @returns {{ servers: Record<string, {url:string, password:string}>, defaultServer: string }}
 */
export function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return { servers: {}, defaultServer: "" };
  }
}

export function saveConfig(config) {
  ensureDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export function getConfigPath() {
  return CONFIG_PATH;
}

/**
 * Resolve a server by name. If no name is given, uses the default server.
 * Returns null if no server is configured.
 */
export function resolveServer(name) {
  const config = loadConfig();

  if (name && config.servers[name]) {
    return config.servers[name];
  }
  if (config.defaultServer && config.servers[config.defaultServer]) {
    return config.servers[config.defaultServer];
  }

  return null;
}

export function getDefaultModel() {
  return loadConfig().defaultModel || "";
}

export function setDefaultModel(model) {
  const config = loadConfig();
  config.defaultModel = model;
  saveConfig(config);
}

/**
 * Resolve server with default model injected from config.
 */
export function resolveServerWithModel(name) {
  const server = resolveServer(name);
  if (server) {
    const model = getDefaultModel();
    if (model) server.defaultModel = model;
  }
  return server;
}