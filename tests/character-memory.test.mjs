import test from "node:test";
import assert from "node:assert/strict";
import {
  commitCharacterMemory,
  createInitialAgentMemory,
  latestMemoryRevision,
  seedCharacterMemory,
  selectCharacterMemory,
} from "../lib/character-memory.ts";

test("context retrieval prioritizes the current counterpart and stays inside its hard budget", () => {
  let memory = createInitialAgentMemory("agent-a", ["我会先观察环境，再决定行动。"]);
  for (let index = 0; index < 8; index += 1) {
    memory = seedCharacterMemory(
      memory,
      "agent-a",
      `agent-${index}`,
      `关于角色 ${index} 的方向性理解。${"细节".repeat(180)}`,
      index + 1,
      `event-${index}`,
    );
  }

  const references = selectCharacterMemory({
    memory,
    ownerAgentId: "agent-a",
    counterpartId: "agent-7",
    taskType: "RESPOND_TO_INTERACTION_REQUEST",
    turn: 20,
    visibleEventIds: ["event-7"],
    maxFiles: 3,
    maxCharacters: 700,
  });

  assert.equal(references[0].subjectAgentId, "agent-7");
  assert.ok(references.length <= 3);
  assert.ok(references.reduce((total, item) => total + item.summary.length + item.contentExcerpt.length, 0) <= 700);
  assert.deepEqual(references[0].evidenceEventIds, ["event-7"]);
});

test("memory runtime rejects stale unread revisions and accepts a current read-before-write proposal", () => {
  const initial = createInitialAgentMemory("agent-a", ["我刚进入这个世界。"]);
  const initialFile = initial.files[0];
  const initialRevision = latestMemoryRevision(initialFile);
  const staleAttempt = commitCharacterMemory({
    memory: initial,
    ownerAgentId: "agent-a",
    counterpartId: null,
    proposal: {
      documentId: initialFile.id,
      kind: "general",
      subjectAgentId: null,
      topic: null,
      baseRevisionId: initialRevision.id,
      summary: "我记住了窗外的雨。",
      content: "我亲眼看见窗外开始下雨。",
      epistemicStatus: "observed",
      confidence: 0.95,
      salience: 0.7,
      evidenceEventIds: ["event-rain"],
    },
    fallbackText: "我看见窗外开始下雨。",
    evidenceEventId: "event-rain",
    visibleEventIds: ["event-rain"],
    turn: 1,
    taskId: "task-stale",
    readRevisions: [],
  });

  assert.equal(staleAttempt.audit.proposalAccepted, false);
  assert.match(staleAttempt.audit.reason, /必须在本次调用读取最新 revision/);

  const currentFile = staleAttempt.memory.files.find((file) => file.id === initialFile.id);
  assert.ok(currentFile);
  const currentRevision = latestMemoryRevision(currentFile);
  const accepted = commitCharacterMemory({
    memory: staleAttempt.memory,
    ownerAgentId: "agent-a",
    counterpartId: null,
    proposal: {
      documentId: currentFile.id,
      kind: "general",
      subjectAgentId: null,
      topic: null,
      baseRevisionId: currentRevision.id,
      summary: "雨停以后，我仍记得那阵潮湿的气味。",
      content: "这是基于刚才亲历事件形成的新版本记忆。",
      epistemicStatus: "observed",
      confidence: 0.95,
      salience: 0.75,
      evidenceEventIds: ["event-rain-stopped"],
    },
    fallbackText: "雨已经停了。",
    evidenceEventId: "event-rain-stopped",
    visibleEventIds: ["event-rain-stopped"],
    turn: 2,
    taskId: "task-current",
    readRevisions: [currentRevision.id],
  });

  assert.equal(accepted.audit.proposalAccepted, true);
  assert.equal(accepted.audit.commitApplied, true);
  assert.equal(accepted.memory.accessLog[0].action, "read");
  assert.equal(accepted.memory.accessLog[1].action, "write");
});
