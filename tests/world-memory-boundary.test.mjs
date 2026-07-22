import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createInitialAgentMemory, createPortableAgentMemory } from "../lib/character-memory.ts";

test("portable character memory starts blank and contains no world experience", () => {
  const worldMemory = {
    ...createInitialAgentMemory("agent-a", ["初次进入世界 A"]),
    recent: ["只在世界 A 发生的对话"],
    summaries: ["我在世界 A 认识了小光"],
    unresolvedThreads: ["下次在世界 A 回答小光的问题"],
    roleplayCues: [{ id: "cue-world-a", kind: "promise", counterpartId: "agent-b", text: "只属于世界 A 的约定", salience: 0.9, evidenceEventId: "event-world-a", createdTurn: 3 }],
  };
  const portable = createPortableAgentMemory("agent-a");

  assert.match(JSON.stringify(worldMemory), /世界 A/);
  assert.doesNotMatch(JSON.stringify(portable), /世界 A|小光|约定/);
  assert.deepEqual(portable.recent, []);
  assert.deepEqual(portable.summaries, []);
  assert.deepEqual(portable.unresolvedThreads, []);
  assert.deepEqual(portable.roleplayCues, []);
});

test("character archive and onboarding boundaries always replace world memory", async () => {
  const [characterSave, engine, saveApi] = await Promise.all([
    readFile(new URL("../lib/character-save.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/agent-engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/save-api.ts", import.meta.url), "utf8"),
  ]);

  assert.match(characterSave, /agent: portableAgent/);
  assert.match(characterSave, /createPortableAgentMemory\(record\.agent\.id\)/);
  assert.match(characterSave, /createPortableAgentMemory\(agent\.id\)/);
  assert.match(engine, /memory: createPortableAgentMemory\(savedAgent\.id\)/);
  assert.match(saveApi, /const agents = kind === "world" && Array\.isArray\(state\?\.agents\)/);
  assert.match(saveApi, /kind === "character" \? stripStandaloneCharacterWorldMemory\(body\.record\)/);
});
