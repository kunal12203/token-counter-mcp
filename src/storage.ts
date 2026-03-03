import fs from "fs";
import path from "path";
import os from "os";
import { calculateCost } from "./costs.js";

const STORAGE_DIR = path.join(os.homedir(), ".claude", "token-counter");
const SESSION_FILE = path.join(STORAGE_DIR, "session.json");
const HISTORY_FILE = path.join(STORAGE_DIR, "history.json");

export interface UsageEntry {
  id: string;
  timestamp: string;
  model: string;
  description?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  totalCost: number;
}

export interface SessionData {
  sessionId: string;
  startedAt: string;
  entries: UsageEntry[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalCost: number;
  };
}

function ensureStorageDir(): void {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function loadSession(): SessionData {
  ensureStorageDir();
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const raw = fs.readFileSync(SESSION_FILE, "utf8");
      return JSON.parse(raw) as SessionData;
    }
  } catch {
    // corrupted file — start fresh
  }
  return createNewSession();
}

function createNewSession(): SessionData {
  return {
    sessionId: generateId(),
    startedAt: new Date().toISOString(),
    entries: [],
    totals: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalCost: 0,
    },
  };
}

export function saveSession(session: SessionData): void {
  ensureStorageDir();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), "utf8");
}

export function resetSession(): SessionData {
  const session = createNewSession();
  saveSession(session);
  return session;
}

export function addUsageEntry(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
  description?: string,
): UsageEntry {
  const costs = calculateCost(model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens);

  const entry: UsageEntry = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    model,
    description,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    ...costs,
  };

  // Update session
  const session = loadSession();
  session.entries.push(entry);
  session.totals.inputTokens += inputTokens;
  session.totals.outputTokens += outputTokens;
  session.totals.cacheReadTokens += cacheReadTokens;
  session.totals.cacheWriteTokens += cacheWriteTokens;
  session.totals.totalCost += costs.totalCost;
  saveSession(session);

  // Append to global history
  appendToHistory(entry);

  return entry;
}

function appendToHistory(entry: UsageEntry): void {
  ensureStorageDir();
  let history: UsageEntry[] = [];
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, "utf8");
      history = JSON.parse(raw) as UsageEntry[];
    }
  } catch {
    history = [];
  }
  history.push(entry);
  // Keep at most 10000 entries to avoid unbounded growth
  if (history.length > 10000) history = history.slice(-10000);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf8");
}

export function getHistory(limit = 20): UsageEntry[] {
  ensureStorageDir();
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, "utf8");
      const history = JSON.parse(raw) as UsageEntry[];
      return history.slice(-limit).reverse();
    }
  } catch {
    // ignore
  }
  return [];
}
