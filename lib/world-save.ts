import { projectRuntimeSurface, type GameState } from "./agent-engine";
import { latestMemoryRevision, memoryDocumentCount, memoryRevisionCount } from "./character-memory";

export const WORLD_SAVE_STORAGE_KEY = "pixelkin-world-saves-v1";
export const WORLD_SAVE_SCHEMA_VERSION = 6;
export const WORLD_SAVE_LIMIT = 12;

export type WorldMemoryIndex = {
  agentId: string;
  agentName: string;
  facts: number;
  summaries: number;
  recent: number;
  unresolvedThreads: number;
  roleplayCues: number;
  documents: number;
  revisions: number;
  total: number;
  latest: string;
};

export type WorldSaveRecord = {
  id: string;
  version: number;
  title: string;
  castNames: string[];
  createdAt: string;
  updatedAt: string;
  day: number;
  turn: number;
  eventCount: number;
  memoryEntryCount: number;
  memoryIndex: WorldMemoryIndex[];
  state: GameState;
};

type WorldSaveLibrary = {
  version: number;
  saves: WorldSaveRecord[];
};

function isWorldSaveRecord(value: unknown): value is WorldSaveRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<WorldSaveRecord>;
  return typeof record.id === "string"
    && typeof record.title === "string"
    && typeof record.updatedAt === "string"
    && Array.isArray(record.castNames)
    && Array.isArray(record.memoryIndex)
    && Boolean(record.state && Array.isArray(record.state.agents) && Array.isArray(record.state.events));
}

export function buildMemoryIndex(state: GameState): WorldMemoryIndex[] {
  return state.agents.map((agent) => {
    const facts = agent.memory.facts.length;
    const summaries = agent.memory.summaries.length;
    const recent = agent.memory.recent.length;
    const unresolvedThreads = agent.memory.unresolvedThreads.length;
    const roleplayCues = agent.memory.roleplayCues.length;
    const documents = memoryDocumentCount(agent.memory);
    const revisions = memoryRevisionCount(agent.memory);
    const latestFile = [...agent.memory.files].sort((left, right) => right.lastAccessedTurn - left.lastAccessedTurn)[0];
    return {
      agentId: agent.id,
      agentName: agent.name,
      facts,
      summaries,
      recent,
      unresolvedThreads,
      roleplayCues,
      documents,
      revisions,
      total: revisions + unresolvedThreads + roleplayCues,
      latest: latestFile ? latestMemoryRevision(latestFile)?.summary || "尚无记忆" : agent.memory.recent[0] || agent.memory.summaries[0] || agent.memory.facts[0] || "尚无记忆",
    };
  });
}

export function readWorldSaveLibrary(raw: string | null): WorldSaveRecord[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as WorldSaveLibrary | WorldSaveRecord[];
    const saves = Array.isArray(parsed) ? parsed : parsed.saves;
    if (!Array.isArray(saves)) return [];
    return saves.filter(isWorldSaveRecord).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, WORLD_SAVE_LIMIT);
  } catch {
    return [];
  }
}

export function createWorldSave(state: GameState, previous?: WorldSaveRecord, savedAt = new Date().toISOString()): WorldSaveRecord {
  const webState = projectRuntimeSurface(state, "web");
  const memoryIndex = buildMemoryIndex(webState);
  const castNames = webState.agents.map((agent) => agent.name);
  const id = webState.worldId || previous?.id || `world-${savedAt}`;
  const createdAt = previous?.createdAt || webState.worldCreatedAt || savedAt;
  return {
    id,
    version: WORLD_SAVE_SCHEMA_VERSION,
    title: webState.mode === "story" && webState.director?.storyTitle ? webState.director.storyTitle : `${castNames.join("、") || "未命名角色"}的世界`,
    castNames,
    createdAt,
    updatedAt: savedAt,
    day: webState.day,
    turn: webState.turn,
    eventCount: webState.events.length,
    memoryEntryCount: memoryIndex.reduce((total, item) => total + item.total, 0),
    memoryIndex,
    state: {
      ...webState,
      worldId: id,
      worldCreatedAt: createdAt,
      running: false,
      surface: "web",
      mode: webState.mode,
    },
  };
}

export function upsertWorldSave(saves: WorldSaveRecord[], record: WorldSaveRecord): WorldSaveRecord[] {
  return [record, ...saves.filter((item) => item.id !== record.id)]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, WORLD_SAVE_LIMIT);
}

export function serializeWorldSaveLibrary(saves: WorldSaveRecord[]) {
  return JSON.stringify({ version: WORLD_SAVE_SCHEMA_VERSION, saves } satisfies WorldSaveLibrary);
}
