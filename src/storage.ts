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
  project?: string;
  sessionId?: string;
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

export interface SessionGroup {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  entryCount: number;
}

export interface ProjectGroup {
  project: string;
  displayName: string;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  lastActiveAt: string;
  sessions: SessionGroup[];
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
  project?: string,
): UsageEntry {
  const costs = calculateCost(model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens);

  // Load session first so we can attach sessionId
  const session = loadSession();

  const entry: UsageEntry = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    model,
    description,
    project,
    sessionId: session.sessionId,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    ...costs,
  };

  // Update session
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

export function getGroupedHistory(): ProjectGroup[] {
  ensureStorageDir();
  let history: UsageEntry[] = [];
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, "utf8");
      history = JSON.parse(raw) as UsageEntry[];
    }
  } catch {
    return [];
  }

  // Group entries by project
  const byProject = new Map<string, UsageEntry[]>();
  for (const entry of history) {
    const proj = entry.project ?? "(no project)";
    if (!byProject.has(proj)) byProject.set(proj, []);
    byProject.get(proj)!.push(entry);
  }

  const groups: ProjectGroup[] = [];

  for (const [project, entries] of byProject) {
    // Within each project, group by sessionId
    const bySession = new Map<string, UsageEntry[]>();
    for (const entry of entries) {
      const sid = entry.sessionId ?? "unknown";
      if (!bySession.has(sid)) bySession.set(sid, []);
      bySession.get(sid)!.push(entry);
    }

    const sessions: SessionGroup[] = [];
    for (const [sessionId, sEntries] of bySession) {
      const sorted = [...sEntries].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
      sessions.push({
        sessionId,
        startedAt: sorted[0].timestamp,
        endedAt: sorted[sorted.length - 1].timestamp,
        totalCost: sEntries.reduce((acc, e) => acc + e.totalCost, 0),
        totalInputTokens: sEntries.reduce((acc, e) => acc + e.inputTokens, 0),
        totalOutputTokens: sEntries.reduce((acc, e) => acc + e.outputTokens, 0),
        entryCount: sEntries.length,
      });
    }

    // Sort sessions newest first
    sessions.sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );

    const lastActiveAt = sessions[0]?.startedAt ?? entries[entries.length - 1]?.timestamp ?? "";
    const displayName =
      project === "(no project)"
        ? "(no project)"
        : path.basename(project);

    groups.push({
      project,
      displayName,
      totalCost: entries.reduce((acc, e) => acc + e.totalCost, 0),
      totalInputTokens: entries.reduce((acc, e) => acc + e.inputTokens, 0),
      totalOutputTokens: entries.reduce((acc, e) => acc + e.outputTokens, 0),
      lastActiveAt,
      sessions,
    });
  }

  // Sort by most recently active
  groups.sort(
    (a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime(),
  );

  return groups;
}
