import type { GameState, StoryAgent } from "./agent-engine";
import type { WorldSaveRecord } from "./world-save";
import { createPortableAgentMemory, latestMemoryRevision, memoryDocumentCount, memoryRevisionCount, normalizeAgentMemory } from "./character-memory";

export const CHARACTER_SAVE_STORAGE_KEY = "pixelkin-character-saves-v1";
export const CHARACTER_SAVE_SCHEMA_VERSION = 5;
export const CHARACTER_SAVE_LIMIT = 30;

export type CharacterMemoryIndex = {
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

export type CharacterSaveRecord = {
  id: string;
  version: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  sourceWorldId: string | null;
  sourceWorldTitle: string;
  memoryIndex: CharacterMemoryIndex;
  agent: StoryAgent;
};

type CharacterSaveLibrary = {
  version: number;
  characters: CharacterSaveRecord[];
};

function isCharacterSaveRecord(value: unknown): value is CharacterSaveRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<CharacterSaveRecord>;
  return typeof record.id === "string"
    && typeof record.name === "string"
    && typeof record.updatedAt === "string"
    && Boolean(record.agent && record.agent.id === record.id && record.agent.memory && record.agent.visual)
    && Boolean(record.memoryIndex && typeof record.memoryIndex.total === "number");
}

export function buildCharacterMemoryIndex(agent: StoryAgent): CharacterMemoryIndex {
  const memory = normalizeAgentMemory(agent.memory, agent.id);
  const facts = memory.facts.length;
  const summaries = memory.summaries.length;
  const recent = memory.recent.length;
  const unresolvedThreads = memory.unresolvedThreads.length;
  const roleplayCues = memory.roleplayCues.length;
  const documents = memoryDocumentCount(memory);
  const revisions = memoryRevisionCount(memory);
  const latestFile = [...memory.files].sort((left, right) => right.lastAccessedTurn - left.lastAccessedTurn)[0];
  return {
    facts,
    summaries,
    recent,
    unresolvedThreads,
    roleplayCues,
    documents,
    revisions,
    total: revisions + unresolvedThreads + roleplayCues,
    latest: latestFile ? latestMemoryRevision(latestFile)?.summary || "尚无记忆" : memory.recent[0] || memory.summaries[0] || memory.facts[0] || "尚无记忆",
  };
}

export function readCharacterSaveLibrary(raw: string | null): CharacterSaveRecord[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as CharacterSaveLibrary | CharacterSaveRecord[];
    const characters = Array.isArray(parsed) ? parsed : parsed.characters;
    if (!Array.isArray(characters)) return [];
    return characters
      .filter(isCharacterSaveRecord)
      .map((record) => {
        const agent = { ...record.agent, memory: createPortableAgentMemory(record.agent.id) };
        return { ...record, version: CHARACTER_SAVE_SCHEMA_VERSION, memoryIndex: buildCharacterMemoryIndex(agent), agent };
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, CHARACTER_SAVE_LIMIT);
  } catch {
    return [];
  }
}

export function createCharacterSave(
  agent: StoryAgent,
  previous?: CharacterSaveRecord,
  sourceWorldId: string | null = null,
  sourceWorldTitle = "尚未进入世界",
  savedAt = new Date().toISOString(),
): CharacterSaveRecord {
  const portableAgent = { ...agent, memory: createPortableAgentMemory(agent.id) };
  return {
    id: agent.id,
    version: CHARACTER_SAVE_SCHEMA_VERSION,
    name: agent.name,
    createdAt: previous?.createdAt || savedAt,
    updatedAt: savedAt,
    sourceWorldId,
    sourceWorldTitle,
    memoryIndex: buildCharacterMemoryIndex(portableAgent),
    agent: portableAgent,
  };
}

export function upsertCharacterSave(characters: CharacterSaveRecord[], record: CharacterSaveRecord): CharacterSaveRecord[] {
  const previous = characters.find((item) => item.id === record.id);
  if (previous && previous.updatedAt > record.updatedAt) return characters;
  return [record, ...characters.filter((item) => item.id !== record.id)]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, CHARACTER_SAVE_LIMIT);
}

export function syncCharactersFromWorld(
  characters: CharacterSaveRecord[],
  state: Pick<GameState, "agents" | "worldId">,
  worldTitle: string,
  savedAt = new Date().toISOString(),
) {
  return state.agents.reduce((next, agent) => {
    const previous = next.find((item) => item.id === agent.id);
    return upsertCharacterSave(next, createCharacterSave(agent, previous, state.worldId || null, worldTitle, savedAt));
  }, characters);
}

export function migrateCharactersFromWorlds(characters: CharacterSaveRecord[], worlds: WorldSaveRecord[]) {
  return [...worlds].reverse().reduce(
    (next, world) => syncCharactersFromWorld(next, world.state, world.title, world.updatedAt),
    characters,
  );
}

export function serializeCharacterSaveLibrary(characters: CharacterSaveRecord[]) {
  return JSON.stringify({ version: CHARACTER_SAVE_SCHEMA_VERSION, characters } satisfies CharacterSaveLibrary);
}
