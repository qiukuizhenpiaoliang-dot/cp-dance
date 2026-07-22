import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders a zero-cast onboarding flow", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /CP/);
  assert.match(html, /跳动/);
  assert.match(html, /Couple/);
  assert.match(html, /DANCE/);
  assert.match(html, /查看已有存档/);
  assert.match(html, /查看已有角色/);
  assert.match(html, /FIRST TIME HERE/);
  assert.match(html, /从 0 开始创造角色/);
  assert.match(html, /继续存档/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("backend save endpoint persists product records outside the frontend", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("save-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const indexRows = new Map();
  const revisionRows = [];
  const assetRows = new Map();
  const memoryDocumentRows = [];
  const memoryRevisionRows = [];
  const storyPublicEventRows = [];
  const storySummaryRevisionRows = [];
  const worldBackgroundRows = [];
  const objects = new Map();
  const statement = (sql, args = []) => ({
    bind: (...nextArgs) => statement(sql, nextArgs),
    async run() {
      if (/INSERT INTO pixelkin_saves/.test(sql)) {
        const [ownerId, kind, recordId, updatedAt, objectKey] = args;
        indexRows.set(`${ownerId}:${kind}:${recordId}`, { owner_id: ownerId, kind, record_id: recordId, updated_at: updatedAt, object_key: objectKey });
      }
      if (/INSERT INTO cp_dance_save_revisions/.test(sql)) {
        const [ownerId, kind, recordId, revisionId, updatedAt, objectKey] = args;
        revisionRows.push({ owner_id: ownerId, kind, record_id: recordId, revision_id: revisionId, updated_at: updatedAt, object_key: objectKey });
      }
      if (/INSERT INTO cp_dance_assets/.test(sql)) {
        const [ownerId, assetId, objectKey, mimeType, byteSize, createdAt] = args;
        assetRows.set(`${ownerId}:${assetId}`, { owner_id: ownerId, asset_id: assetId, object_key: objectKey, mime_type: mimeType, byte_size: byteSize, created_at: createdAt });
      }
      if (/INSERT INTO cp_dance_memory_documents/.test(sql)) memoryDocumentRows.push({ args });
      if (/INSERT INTO cp_dance_memory_revisions/.test(sql)) memoryRevisionRows.push({ args });
      if (/INSERT INTO cp_dance_story_public_events/.test(sql)) storyPublicEventRows.push({ args });
      if (/INSERT INTO cp_dance_story_summary_revisions/.test(sql)) storySummaryRevisionRows.push({ args });
      if (/INSERT INTO cp_dance_world_background_assets/.test(sql)) worldBackgroundRows.push({ args });
      if (/DELETE FROM pixelkin_saves/.test(sql)) {
        const [ownerId, kind, recordId] = args;
        indexRows.delete(`${ownerId}:${kind}:${recordId}`);
      }
      if (/DELETE FROM cp_dance_save_revisions/.test(sql)) {
        const [ownerId, kind, recordId, revisionId] = args;
        for (let index = revisionRows.length - 1; index >= 0; index -= 1) {
          const row = revisionRows[index];
          if (row.owner_id === ownerId && row.kind === kind && row.record_id === recordId && (!revisionId || row.revision_id === revisionId)) revisionRows.splice(index, 1);
        }
      }
      return { success: true };
    },
    async all() {
      const [ownerId, kind, recordId, offset] = args;
      const isRevisionQuery = /FROM cp_dance_save_revisions/.test(sql);
      const source = isRevisionQuery ? revisionRows : [...indexRows.values()];
      const rows = source.filter((row) => row.owner_id === ownerId && (!kind || row.kind === kind) && (!isRevisionQuery || !recordId || row.record_id === recordId)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      const actualOffset = isRevisionQuery ? offset : recordId;
      return { results: /LIMIT -1 OFFSET/.test(sql) ? rows.slice(Number(actualOffset)) : rows };
    },
    async first() {
      if (!/FROM cp_dance_assets/.test(sql)) return null;
      return assetRows.get(`${args[0]}:${args[1]}`) || null;
    },
  });
  const env = {
    DB: { prepare: (sql) => statement(sql), batch: async (items) => Promise.all(items.map((item) => item.run())) },
    SAVE_ASSETS: {
      put: async (key, value) => objects.set(key, value),
      get: async (key) => objects.has(key) ? {
        body: objects.get(key),
        httpEtag: '"test-etag"',
        json: async () => JSON.parse(typeof objects.get(key) === "string" ? objects.get(key) : new TextDecoder().decode(objects.get(key))),
      } : null,
      delete: async (keys) => (Array.isArray(keys) ? keys : [keys]).forEach((key) => objects.delete(key)),
    },
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  const sourceImage = "data:image/png;base64,iVBORw0KGgo=";
  const record = {
    id: "character-test",
    updatedAt: "2026-07-18T08:00:00.000Z",
    sourceWorldId: "world-test",
    name: "阿桃",
    visual: { spriteSheetUrl: sourceImage },
    agent: {
      id: "character-test",
      memory: {
        schema: "cp-dance/character-memory/v1",
        files: [{
          id: "memory-character-test-general-general",
          path: "general.txt",
          kind: "general",
          subjectAgentId: null,
          latestRevisionId: "memory-rev-1",
          revisions: [{ id: "memory-rev-1", baseRevisionId: null, summary: "记住入住", content: "我来到这里。", epistemicStatus: "observed", createdTurn: 1, createdAt: "turn-1" }],
        }],
      },
    },
  };
  const writeResponse = await worker.fetch(new Request("http://localhost/api/saves", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "character", record }) }), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(writeResponse.status, 200);
  const writePayload = await writeResponse.json();
  assert.equal(writePayload.saved, true);
  assert.match(writePayload.revisionId, /^20260718080000000-/);
  assert.equal(revisionRows.length, 1);
  assert.equal(memoryDocumentRows.length, 0);
  assert.equal(memoryRevisionRows.length, 0);
  assert.ok(![...objects.keys()].some((key) => /\/memory\/world-test\/character-test\/.+\/memory-rev-1\.json$/.test(key)));
  const cookie = writeResponse.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const readResponse = await worker.fetch(new Request("http://localhost/api/saves", { headers: { cookie } }), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(readResponse.status, 200);
  const library = await readResponse.json();
  assert.equal(library.characters.length, 1);
  assert.equal(library.characters[0].name, record.name);
  assert.doesNotMatch(JSON.stringify(library.characters[0].agent.memory), /记住入住|我来到这里/);
  assert.match(library.characters[0].visual.spriteSheetUrl, /^\/api\/save-assets\/[a-f0-9]{64}\.png$/);
  assert.notEqual(library.characters[0].visual.spriteSheetUrl, sourceImage);
  const assetResponse = await worker.fetch(new Request(`http://localhost${library.characters[0].visual.spriteSheetUrl}`, { headers: { cookie } }), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(assetResponse.status, 200);
  assert.equal(assetResponse.headers.get("content-type"), "image/png");

  const worldRecord = {
    id: "world-story-test",
    updatedAt: "2026-07-21T08:00:00.000Z",
    state: {
      worldId: "world-story-test",
      agents: [record.agent],
      events: [],
      storyPublicEvents: [{ schema: "cp-dance/story-public-event/v1", eventId: "story-event-01", turn: 1, sceneId: "scene-01", beatId: "beat-01", source: "director", type: "weather", publicContent: "公开下起了雨。", participants: [], visibleTo: [], createdAt: "2026-07-21T07:59:00.000Z" }],
      storySummaryRevisions: [{ schema: "cp-dance/story-context-summary/v1", summaryId: "story-summary", revisionId: "story-summary-r1", scope: "story", sceneIds: ["scene-01"], beatIds: ["beat-01"], sourceEventIds: ["story-event-01"], coveredThroughEventId: "story-event-01", objectiveFacts: [{ fact: "公开下起了雨。", sourceEventIds: ["story-event-01"] }], publicCharacterDevelopments: [], plotProgress: { completedConditions: [], failedOrInvalidatedConditions: [], newlyUnlockedConditions: [] }, unresolvedThreads: [], cluesAndSecrets: [], playerDirectives: [], sceneResult: "雨仍在下。", nextStoryConstraints: [], createdAt: "2026-07-21T08:00:00.000Z" }],
      backgroundWorldIndex: { schema: "cp-dance/background-world-index/v1", worldId: "world-story-test", activeAssetId: "bg-seaside-beach-boardwalk", assetIds: ["bg-seaside-beach-boardwalk"], sceneBindings: { "scene-01": "bg-seaside-beach-boardwalk" }, updatedAt: "2026-07-21T08:00:00.000Z" },
    },
  };
  const worldWrite = await worker.fetch(new Request("http://localhost/api/saves", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ kind: "world", record: worldRecord }) }), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(worldWrite.status, 200);
  assert.equal(memoryDocumentRows.length, 1);
  assert.equal(memoryRevisionRows.length, 1);
  assert.ok([...objects.keys()].some((key) => /\/memory\/world-story-test\/character-test\/.+\/memory-rev-1\.json$/.test(key)));
  assert.equal(storyPublicEventRows.length, 1);
  assert.equal(storySummaryRevisionRows.length, 1);
  assert.equal(worldBackgroundRows.length, 1);
  assert.ok([...objects.keys()].some((key) => /\/story\/world-story-test\/public-events\/story-event-01\.json$/.test(key)));
  assert.ok([...objects.keys()].some((key) => /\/story\/world-story-test\/summary-revisions\/story-summary-r1\.json$/.test(key)));
});

test("Character Agent endpoint normalizes one-role model output and keeps actor authority server-side", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("agent-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  let upstreamRequest = null;
  globalThis.fetch = async (_input, init) => {
    upstreamRequest = JSON.parse(String(init?.body || "{}"));
    return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      actorId: "attempted-other-character",
      action: "observe",
      performanceIntent: "先用安静观察表现小光的好奇",
      observableBehavior: "小光停下来观察窗边的光。",
      spokenContent: null,
      nonverbalBeat: "指尖在窗框上停了一下。",
      speechAct: "none",
      responseMode: "initiate",
      topic: "窗边的光",
      addressedTo: null,
      continueScene: false,
      closeReason: "想先独自确认",
      privateThought: "我想先看看这里。",
      emotionalState: "好奇",
      memoryWrite: "我观察了窗边。",
      memoryProposal: {
        documentId: "memory-agent-a-general-general",
        kind: "general",
        subjectAgentId: null,
        topic: null,
        baseRevisionId: "memory-rev-existing",
        summary: "我观察了窗边",
        content: "我停下来观察窗边的光。",
        epistemicStatus: "observed",
        confidence: 0.9,
        salience: 0.7,
        evidenceEventIds: ["event-visible"],
      },
      roleplayMemory: { kind: "shared_detail", text: "我会先观察光线变化再决定是否开口。", salience: 0.65 },
      interactionType: "hug",
      response: null,
      animationAction: "shy",
      animationDescription: "短暂脸红后安静观察",
      continueGoal: null,
    }) } }],
  }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(
      new Request("http://localhost/api/ai/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: "task-test-agent-a",
          worldId: "world-test",
          turn: 2,
          stageSessionId: "stage-test-agent-a",
          taskType: "PERCEIVE_AND_DECIDE",
          assignedTo: "agent-a",
          counterpartId: null,
          trigger: null,
          context: {
            identity: { id: "agent-a", name: "小光" },
            relevantMemory: [{ documentId: "memory-agent-a-general-general", revisionId: "memory-rev-existing" }],
            availableActions: ["idle", "walk"],
          },
        }),
      }),
      {
        NEWAPI_TEXT_BASE_URL: "https://model.invalid",
        NEWAPI_TEXT_API_KEY: "test-only-key",
        NEWAPI_TEXT_MODEL: "deepseek-v4-flash",
        ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.actorId, "agent-a");
    assert.equal(payload.targetId, null);
    assert.equal(payload.action, "observe");
    assert.equal(payload.performanceIntent, "先用安静观察表现小光的好奇");
    assert.equal(payload.nonverbalBeat, "指尖在窗框上停了一下。");
    assert.equal(payload.responseMode, "initiate");
    assert.equal(payload.continueScene, false);
    assert.equal(payload.roleplayMemory.kind, "shared_detail");
    assert.equal(payload.interactionType, null);
    assert.equal(payload.animationAction, "shy");
    assert.match(payload.guardrailNotes.join(" "), /request/);
    assert.equal(payload.stageSessionId, "stage-test-agent-a");
    assert.deepEqual(payload.memoryReadRevisions, ["memory-rev-existing"]);
    assert.equal(payload.memoryProposal.baseRevisionId, "memory-rev-existing");
    assert.equal(payload.model, "deepseek-v4-flash");
    assert.deepEqual(upstreamRequest.thinking, { type: "disabled" });
    assert.deepEqual(upstreamRequest.response_format, { type: "json_object" });
    const systemPrompt = upstreamRequest.messages[0].content;
    const userPrompt = upstreamRequest.messages[1].content;
    assert.match(systemPrompt, /\[固定宪法 \/ IDENTITY_AND_AUTHORITY\]/);
    assert.match(systemPrompt, /\[认知边界 \/ EPISTEMIC_BOUNDARY\]/);
    assert.match(systemPrompt, /\[回合决策协议 \/ TURN_PROTOCOL\]/);
    assert.match(systemPrompt, /\[能力边界 \/ CAPABILITY_BOUNDARY\]/);
    assert.match(systemPrompt, /\[连续性与表演 \/ CONTINUITY_AND_PERFORMANCE\]/);
    assert.match(systemPrompt, /\[记忆边界 \/ MEMORY_POLICY\]/);
    assert.match(systemPrompt, /\[输出契约 \/ OUTPUT_CONTRACT\]/);
    assert.match(systemPrompt, /行为能力与视觉素材严格分离/);
    assert.doesNotMatch(systemPrompt, /若 Stage attentionReason 表示玩家把两个角色拖近/);
    assert.doesNotMatch(systemPrompt, /害羞、脸红、嘴硬或短暂慌乱是高权重表现候选/);
    assert.match(userPrompt, /\[RUNTIME_TASK_CONTEXT\]/);
    assert.match(userPrompt, /\[\/RUNTIME_TASK_CONTEXT\]/);
    const runtimeContext = JSON.parse(userPrompt.match(/\[RUNTIME_TASK_CONTEXT\]\n([\s\S]+)\n\[\/RUNTIME_TASK_CONTEXT\]/)[1]);
    assert.equal(runtimeContext.context.contextSchema, "cp-dance/character-context/v6");
    assert.equal(runtimeContext.context.layers.stage.turnBrief.distance, "alone");
    assert.ok(runtimeContext.context.layers.stage.capabilities.behaviorActions.includes("observe"));
    assert.ok(runtimeContext.context.layers.stage.capabilities.blockedActions.some((entry) => entry.action === "request_touch"));
    assert.deepEqual(runtimeContext.context.layers.stage.capabilities.requestRequiredActions, ["request_touch", "request_shared_action"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Character Agent retries an empty DeepSeek JSON-mode response without JSON mode", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("character-agent-json-retry", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  const upstreamRequests = [];
  globalThis.fetch = async (_input, init) => {
    upstreamRequests.push(JSON.parse(String(init?.body || "{}")));
    const content = upstreamRequests.length === 1 ? "" : JSON.stringify({
      action: "observe",
      observableBehavior: "小光安静地观察窗边。",
      spokenContent: null,
      privateThought: "我想先看看。",
      emotionalState: "平静",
      memoryWrite: "我观察了窗边。",
      animationAction: "idle",
    });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/ai/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "task-json-retry",
        worldId: "world-json-retry",
        turn: 1,
        stageSessionId: "stage-json-retry",
        taskType: "PERCEIVE_AND_DECIDE",
        assignedTo: "agent-a",
        counterpartId: null,
        trigger: null,
        context: { identity: { id: "agent-a", name: "小光" }, relevantMemory: [], availableActions: ["idle"] },
      }),
    }), {
      NEWAPI_TEXT_BASE_URL: "https://model.invalid",
      NEWAPI_TEXT_API_KEY: "test-only-key",
      NEWAPI_TEXT_MODEL: "deepseek-v4-flash",
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).action, "observe");
    assert.equal(upstreamRequests.length, 2);
    assert.deepEqual(upstreamRequests[0].response_format, { type: "json_object" });
    assert.equal(upstreamRequests[0].max_tokens, 1100);
    assert.equal(upstreamRequests[1].response_format, undefined);
    assert.deepEqual(upstreamRequests[1].thinking, { type: "disabled" });
    assert.equal(upstreamRequests[1].max_tokens, 2200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Director Agent endpoint exposes only public story facts and cannot author character behavior", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("director-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  let upstreamRequest = null;
  globalThis.fetch = async (_input, init) => {
    upstreamRequest = JSON.parse(String(init?.body || "{}"));
    const directorOutput = {
        outline: {
          storyTitle: "旧站雨夜",
          storySummary: "暴雨把两人留在旧站台。",
          currentBeatId: "beat-01",
          beats: [{ id: "beat-01", title: "雨幕", purpose: "让公开异响成为可调查事实", entryConditions: ["故事开始"], allowedEventTypes: ["weather", "evidence_found"], completionConditions: ["有人公开发现线索"], sceneCandidates: ["旧车站"], nextBeatIds: [], softTurnLimit: 6, endingContributions: ["是否找到失踪者"] }],
        },
        decision: "inject_world_event",
        currentBeatId: "beat-01",
        worldEvents: [{ type: "weather", summary: "暴雨击打站台顶棚。", visibleTo: ["agent-a", "invented-agent"], affectedAgents: ["agent-a"], publicEffects: [{ type: "wet", severity: "mild" }] }],
        sceneProposal: { location: "废弃车站", timeOfDay: "night", weather: "storm", atmosphere: "紧张而克制", visualKeywords: ["站台", "雨夜"], reason: "建立公开环境" },
        runtimeReason: "开场需要一个所有人可感知的外部事实。",
        playerVisibleNarration: "暴雨落在旧站台上。",
        completedEvidence: [],
        characterDialogue: "越权台词应被丢弃",
        privateThought: "越权私想应被丢弃",
      };
    return new Response(JSON.stringify({
      choices: [{ message: { content: `模型结果如下：\n${JSON.stringify(directorOutput)}\n{\"diagnostic\":\"ignored\"}` } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/ai/director", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskType: "create_outline",
        worldId: "",
        turn: 0,
        setup: { premise: "暴雨中的旧车站", setting: "旧车站", tone: "悬疑", constraints: "不得强迫角色", endingTarget: "NATURAL", endingMode: "adaptive" },
        cast: [{ id: "agent-a", name: "小光", publicMood: "平静", privateThought: "不得发送" }, { id: "agent-b", name: "小夜", publicMood: "警觉" }],
        currentScene: { sceneId: "story-station", location: "旧车站", timeOfDay: "night", weather: "storm", atmosphere: "安静", visualKeywords: ["站台"] },
        currentBeat: null,
        outline: [],
        summaryRevisionId: null,
        outlineBaseRevision: 0,
        coveredThroughEventId: null,
        stableSummary: null,
        recentPublicEvents: [],
        pinnedContext: { unansweredQuestions: [], activeRequests: [], activeWorldEntities: [], publicCharacterStatuses: [], unresolvedClues: [], pendingPlayerDirectives: [], currentBeatConditions: [] },
        contextMetrics: { estimatedTokens: 0, estimatedBytes: 0, inputBudget: 12000 },
        latestDirective: null,
        relationships: [{ affinity: 100 }],
        privateMemory: "不得发送",
      }),
    }), {
      NEWAPI_TEXT_BASE_URL: "https://model.invalid",
      NEWAPI_TEXT_API_KEY: "test-only-key",
      NEWAPI_TEXT_MODEL: "deepseek-v4-flash",
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.outline.storyTitle, "旧站雨夜");
    assert.equal(payload.decision.schema, "cp-dance/director-decision/v1");
    assert.deepEqual(payload.decision.worldEvents[0].visibleTo, ["agent-a"]);
    assert.equal(payload.decision.characterDialogue, undefined);
    assert.equal(payload.decision.privateThought, undefined);
    assert.equal(payload.model, "deepseek-v4-flash");
    assert.deepEqual(upstreamRequest.thinking, { type: "disabled" });
    assert.deepEqual(upstreamRequest.response_format, { type: "json_object" });
    const systemPrompt = upstreamRequest.messages[0].content;
    const userPrompt = upstreamRequest.messages[1].content;
    assert.match(systemPrompt, /不扮演角色，也不控制 Character Agent/);
    assert.match(systemPrompt, /不得生成角色台词、角色主动动作、私人想法/);
    assert.match(systemPrompt, /summaryRevisionId、coveredThroughEventId 与 outlineBaseRevision/);
    assert.doesNotMatch(userPrompt, /不得发送|privateMemory|relationships|privateThought/);
    assert.match(userPrompt, /暴雨中的旧车站/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Director Agent retries an unusable initial outline with the strict Plot Beat contract", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("director-retry-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  const upstreamRequests = [];
  let callCount = 0;
  globalThis.fetch = async (_input, init) => {
    upstreamRequests.push(JSON.parse(String(init?.body || "{}")));
    callCount += 1;
    const content = callCount === 1
      ? { outline: { storyTitle: "不完整大纲", beats: [] }, decision: "wait" }
      : {
          outline: {
            storyTitle: "庭院雨歇",
            storySummary: "两名角色在雨后庭院自行决定是否接近。",
            currentBeatId: "beat-01",
            beats: [
              { id: "beat-01", title: "雨歇", purpose: "建立公开环境", entryConditions: ["故事开始"], allowedEventTypes: ["weather"], completionConditions: ["角色公开注意到庭院变化"], sceneCandidates: ["雨后庭院"], nextBeatIds: ["beat-02"], softTurnLimit: 6, endingContributions: [] },
              { id: "beat-02", title: "相遇", purpose: "提供相遇机会", entryConditions: ["角色公开注意到庭院变化"], allowedEventTypes: ["ambient_change"], completionConditions: ["至少一名角色公开回应另一名角色"], sceneCandidates: ["雨后庭院"], nextBeatIds: ["beat-03"], softTurnLimit: 8, endingContributions: [] },
              { id: "beat-03", title: "余韵", purpose: "等待角色完成当下互动", entryConditions: ["角色已经公开回应"], allowedEventTypes: ["time_change"], completionConditions: ["角色公开离开或决定继续停留"], sceneCandidates: ["庭院出口"], nextBeatIds: [], softTurnLimit: 8, endingContributions: ["保留角色自己的选择"] },
            ],
          },
          decision: "wait",
          currentBeatId: "beat-01",
          worldEvents: [],
          sceneProposal: null,
          runtimeReason: "先等待角色自主行动。",
          playerVisibleNarration: "雨声渐渐停了。",
          completedEvidence: [],
        };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/ai/director", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskType: "create_outline",
        worldId: "world-director-retry",
        turn: 0,
        setup: { premise: "雨后庭院中的相遇", setting: "雨后庭院", tone: "自然", constraints: "尊重角色自主性", endingTarget: "NATURAL", endingMode: "adaptive" },
        cast: [{ id: "agent-a", name: "小光", publicMood: "平静" }, { id: "agent-b", name: "小夜", publicMood: "好奇" }],
        currentScene: { sceneId: "scene-garden", location: "雨后庭院", timeOfDay: "evening", weather: "after_rain", atmosphere: "安静", visualKeywords: ["庭院"] },
        currentBeat: null,
        outline: [],
        summaryRevisionId: null,
        outlineBaseRevision: 0,
        coveredThroughEventId: null,
        stableSummary: null,
        recentPublicEvents: [],
        pinnedContext: { unansweredQuestions: [], activeRequests: [], activeWorldEntities: [], publicCharacterStatuses: [], unresolvedClues: [], pendingPlayerDirectives: [], currentBeatConditions: [] },
        contextMetrics: { estimatedTokens: 0, estimatedBytes: 0, inputBudget: 12000 },
        latestDirective: null,
      }),
    }), {
      NEWAPI_TEXT_BASE_URL: "https://model.invalid",
      NEWAPI_TEXT_API_KEY: "test-only-key",
      NEWAPI_TEXT_MODEL: "deepseek-v4-flash",
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(callCount, 2);
    assert.equal(payload.outline.beats.length, 3);
    assert.equal(upstreamRequests[0].max_tokens, 6000);
    assert.equal(upstreamRequests[1].max_tokens, 10000);
    assert.deepEqual(upstreamRequests[0].thinking, { type: "disabled" });
    assert.deepEqual(upstreamRequests[0].response_format, { type: "json_object" });
    assert.deepEqual(upstreamRequests[1].thinking, { type: "disabled" });
    assert.equal(upstreamRequests[1].response_format, undefined);
    assert.match(upstreamRequests[0].messages[0].content, /outline 固定结构/);
    assert.match(upstreamRequests[1].messages[1].content, /上一次输出未形成可运行大纲/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Story Context Compactor keeps source coverage and pinned facts authoritative", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("story-compactor-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  let upstreamRequest = null;
  globalThis.fetch = async (_input, init) => {
    upstreamRequest = JSON.parse(String(init?.body || "{}"));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      schema: "cp-dance/story-context-summary/v1",
      summaryId: "model-tried-to-replace-id",
      revisionId: "model-tried-to-replace-revision",
      baseRevisionId: "invented-base",
      scope: "story",
      sceneIds: ["scene-old"],
      beatIds: ["beat-01"],
      sourceEventIds: ["invented-event"],
      coveredThroughEventId: "invented-event",
      objectiveFacts: [{ fact: "雨已经停了。", sourceEventIds: ["invented-event"] }],
      publicCharacterDevelopments: [],
      plotProgress: { completedConditions: ["角色已经和解"], failedOrInvalidatedConditions: [], newlyUnlockedConditions: ["未来结局"] },
      unresolvedThreads: [],
      cluesAndSecrets: [],
      playerDirectives: [],
      sceneResult: "模型试图续写未来。",
      nextStoryConstraints: [],
      privateThought: "不应保留",
      createdAt: "model-time",
    }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const sourceEvents = [
    { schema: "cp-dance/story-public-event/v1", eventId: "event-01", turn: 1, sceneId: "scene-old", beatId: "beat-01", source: "director", type: "script", publicContent: "暴雨开始敲打旧站台。", participants: [], visibleTo: ["agent-a"], createdAt: "2026-07-21T00:00:00Z" },
    { schema: "cp-dance/story-public-event/v1", eventId: "event-02", turn: 2, sceneId: "scene-old", beatId: "beat-01", source: "character", type: "daily", publicContent: "小光公开问：门外是谁？", participants: ["agent-a"], visibleTo: ["agent-a"], createdAt: "2026-07-21T00:01:00Z" },
    { schema: "cp-dance/story-public-event/v1", eventId: "directive-01", turn: 2, sceneId: "scene-old", beatId: "beat-01", source: "player", type: "player_directive:plot_guidance", publicContent: "下一幕转向寻找失踪者。", participants: [], visibleTo: [], createdAt: "2026-07-21T00:01:30Z" },
  ];
  try {
    const response = await worker.fetch(new Request("http://localhost/api/ai/director", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskType: "compact_story",
        worldId: "world-story",
        turn: 2,
        reason: "hard_limit",
        baseSummary: null,
        sourceEvents,
        pinnedContext: {
          unansweredQuestions: [{ id: "question-01", text: "门外是谁？", fromAgentId: "agent-a", toAgentId: null }],
          activeRequests: [], activeWorldEntities: [], publicCharacterStatuses: [],
          unresolvedClues: [{ id: "clue-01", description: "站台上留下了一枚湿脚印。" }],
          pendingPlayerDirectives: [{ id: "directive-01", type: "plot_guidance", text: "下一幕转向寻找失踪者。", status: "pending" }],
          currentBeatConditions: [{ kind: "completion", text: "公开找到失踪者", runtimeStatus: "pending" }],
        },
        runtimeDeterminations: { completedBeatConditions: [], invalidatedBeatConditions: [], activeSceneId: "scene-old", activeBeatId: "beat-01", outlineRevision: 1 },
        requestedRevisionId: "summary-r-01",
        requestedSummaryId: "summary-01",
        targetTokens: 1600,
        privateMemory: "不得发送给压缩器",
      }),
    }), {
      NEWAPI_TEXT_BASE_URL: "https://model.invalid",
      NEWAPI_TEXT_API_KEY: "test-only-key",
      NEWAPI_TEXT_MODEL: "deepseek-v4-flash",
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.summary.revisionId, "summary-r-01");
    assert.equal(payload.summary.summaryId, "summary-01");
    assert.equal(payload.summary.coveredThroughEventId, "directive-01");
    assert.deepEqual(payload.summary.sourceEventIds, ["event-01", "event-02", "directive-01"]);
    assert.equal(payload.summary.objectiveFacts.some((fact) => fact.sourceEventIds.includes("invented-event")), false);
    assert.equal(payload.summary.objectiveFacts.some((fact) => fact.sourceEventIds.includes("directive-01")), false);
    assert.deepEqual(payload.summary.plotProgress.completedConditions, []);
    assert.deepEqual(payload.summary.plotProgress.newlyUnlockedConditions, []);
    assert.equal(payload.summary.unresolvedThreads.some((thread) => thread.threadId === "question-question-01"), true);
    assert.equal(payload.summary.cluesAndSecrets.some((clue) => clue.clueId === "clue-01" && clue.status === "active"), true);
    assert.equal(payload.summary.playerDirectives.some((directive) => directive.directiveId === "directive-01" && directive.status === "pending"), true);
    assert.equal(payload.summary.privateThought, undefined);
    assert.deepEqual(upstreamRequest.thinking, { type: "disabled" });
    assert.deepEqual(upstreamRequest.response_format, { type: "json_object" });
    const systemPrompt = upstreamRequest.messages[0].content;
    const userPrompt = upstreamRequest.messages[1].content;
    assert.match(systemPrompt, /只压缩已经发生且已经公开的故事事实/);
    assert.match(systemPrompt, /不得续写剧情、设计未来事件、补写因果/);
    assert.doesNotMatch(userPrompt, /不得发送给压缩器|privateMemory/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Character Agent endpoint preserves selected group addressees without merging their responses", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("group-agent-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      action: "speak",
      performanceIntent: "把问题交给在场的两个人，但不替她们回答",
      observableBehavior: "小光抬眼看向桌边的两个人。",
      spokenContent: "你们都听见刚才那声响了吗？",
      nonverbalBeat: "她的视线在两人之间停了一瞬。",
      speechAct: "question",
      responseMode: "initiate",
      topic: "门外的声响",
      addressedTo: "agent-b",
      addresseeIds: ["agent-b", "agent-c", "not-in-scene"],
      audienceScope: "selected",
      responseExpectation: "welcome",
      participationIntent: "join",
      continueScene: true,
      privateThought: "我想知道她们是否也注意到了。",
      emotionalState: "警觉",
      memoryWrite: "我询问了在场的两个人。",
      memoryProposal: null,
      roleplayMemory: null,
      interactionType: "conversation",
      response: null,
      animationAction: "talk",
      animationDescription: "面向两人发问",
      continueGoal: null,
    }) } }],
  }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const response = await worker.fetch(new Request("http://localhost/api/ai/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "task-group-agent-a",
        worldId: "world-group",
        turn: 4,
        stageSessionId: "stage-group",
        taskType: "PERCEIVE_AND_DECIDE",
        assignedTo: "agent-a",
        counterpartId: "agent-b",
        trigger: null,
        context: {
          identity: { id: "agent-a", name: "小光" },
          relevantMemory: [],
          availableActions: ["idle", "talk"],
          layers: { publicDialogue: { groupScene: { participantIds: ["agent-a", "agent-b", "agent-c"], participation: {} } } },
        },
      }),
    }), {
      NEWAPI_TEXT_BASE_URL: "https://model.invalid",
      NEWAPI_TEXT_API_KEY: "test-only-key",
      NEWAPI_TEXT_MODEL: "test-character-model",
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.actorId, "agent-a");
    assert.equal(payload.targetId, "agent-b");
    assert.deepEqual(payload.addresseeIds, ["agent-b", "agent-c"]);
    assert.equal(payload.audienceScope, "selected");
    assert.equal(payload.responseExpectation, "welcome");
    assert.equal(payload.participationIntent, "join");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("character creation fails closed with an actionable error when the image Agent is not configured", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("image-agent-unconfigured-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const context = { waitUntil() {}, passThroughOnException() {} };

  const statusResponse = await worker.fetch(new Request("http://localhost/api/ai/status"), env, context);
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.imageConfigured, false);

  const response = await worker.fetch(
    new Request("http://localhost/api/ai/character", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "阿桃", personality: "开朗", background: "像素小镇居民" }),
    }),
    env,
    context,
  );
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.code, "image_agent_not_configured");
  assert.match(payload.error, /角色制作 Agent 尚未配置/);
});

test("Background Asset Agent is callable with an empty public catalog and keeps manual consent", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("background-agent-resolve-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const context = { waitUntil() {}, passThroughOnException() {} };

  const statusResponse = await worker.fetch(new Request("http://localhost/api/ai/background/status"), env, context);
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.callable, true);
  assert.equal(status.bundledAssetCount, 0);
  assert.equal(status.autoGenerationOnMiss, true);
  assert.equal(status.manualGenerationRequiresExplicitConsent, true);

  const deniedGeneration = await worker.fetch(new Request("http://localhost/api/ai/background", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation: "generate", worldId: "world-background-resolve", scene: { location: "未知场景" } }),
  }), env, context);
  assert.equal(deniedGeneration.status, 403);
  assert.equal((await deniedGeneration.json()).code, "background_generation_consent_required");
});

test("public background catalog is intentionally empty", async () => {
  const catalog = JSON.parse(await readFile(new URL("../public/backgrounds/index.json", import.meta.url), "utf8"));
  assert.equal(catalog.schema, "cp-dance/background-catalog/v1");
  assert.deepEqual(catalog.assets, []);
  assert.match(await readFile(new URL("../ASSETS.md", import.meta.url), "utf8"), /intentionally excludes/i);
});

test("a background catalog miss auto-generates, stores the asset, and updates both indexes", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("background-agent-generate-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  const generatedRows = new Map();
  const worldRows = new Map();
  const objects = new Map();
  let upstreamUrl = "";
  const statement = (sql, args = []) => ({
    bind: (...nextArgs) => statement(sql, nextArgs),
    async run() {
      if (/INSERT INTO cp_dance_background_assets/.test(sql)) {
        const [ownerId, assetId, filename, objectKey, mimeType, byteSize, width, height, title, description, tagsJson, license, model, createdAt] = args;
        generatedRows.set(`${ownerId}:${assetId}`, { owner_id: ownerId, asset_id: assetId, filename, object_key: objectKey, mime_type: mimeType, byte_size: byteSize, width, height, title, description, tags_json: tagsJson, license, model, created_at: createdAt });
      }
      if (/INSERT INTO cp_dance_world_background_assets/.test(sql)) {
        const [ownerId, worldId, assetId, sourceOrScene, sceneOrFirstUsed, firstOrLastUsed, maybeLastUsed] = args;
        const sourceType = maybeLastUsed === undefined ? "generated" : sourceOrScene;
        const sceneId = maybeLastUsed === undefined ? sourceOrScene : sceneOrFirstUsed;
        const firstUsedAt = maybeLastUsed === undefined ? sceneOrFirstUsed : firstOrLastUsed;
        const lastUsedAt = maybeLastUsed === undefined ? firstOrLastUsed : maybeLastUsed;
        worldRows.set(`${ownerId}:${worldId}:${assetId}`, { owner_id: ownerId, world_id: worldId, asset_id: assetId, source_type: sourceType, scene_id: sceneId, first_used_at: firstUsedAt, last_used_at: lastUsedAt });
      }
      return { success: true };
    },
    async all() {
      if (/FROM cp_dance_background_assets/.test(sql)) return { results: [...generatedRows.values()].filter((row) => row.owner_id === args[0]) };
      if (/FROM cp_dance_world_background_assets/.test(sql)) return { results: [...worldRows.values()].filter((row) => row.owner_id === args[0] && row.world_id === args[1]).sort((a, b) => b.last_used_at.localeCompare(a.last_used_at)) };
      return { results: [] };
    },
    async first() {
      if (!/FROM cp_dance_background_assets/.test(sql)) return null;
      return generatedRows.get(`${args[0]}:${args[1]}`) || null;
    },
  });
  const env = {
    NEWAPI_IMAGE_BASE_URL: "https://image-provider.invalid/v1/images/edits",
    NEWAPI_IMAGE_API_KEY: "test-only-image-key",
    NEWAPI_IMAGE_MODEL: "gpt-image-2",
    DB: { prepare: (sql) => statement(sql), batch: async (items) => Promise.all(items.map((item) => item.run())) },
    SAVE_ASSETS: {
      put: async (key, value) => objects.set(key, value),
      get: async (key) => objects.has(key) ? { body: objects.get(key), json: async () => JSON.parse(String(objects.get(key))) } : null,
      delete: async (keys) => (Array.isArray(keys) ? keys : [keys]).forEach((key) => objects.delete(key)),
    },
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  globalThis.fetch = async (input) => {
    upstreamUrl = String(input);
    return new Response(JSON.stringify({ data: [{ b64_json: "iVBORw0KGgo".padEnd(300, "A") }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/ai/background", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "resolve",
        worldId: "world-night-train",
        scene: { sceneId: "story-crystal-archive", location: "漂浮水晶档案室", timeOfDay: "eclipse", weather: "violet-mist", atmosphere: "悬浮晶体与折射光", visualKeywords: ["镜面迷宫"] },
      }),
    }), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const payload = await response.json();
    assert.equal(payload.operation, "resolve");
    assert.equal(payload.status, "generated");
    assert.equal(payload.generationTriggered, true);
    assert.equal(payload.masterIndexUpdated, true);
    assert.match(payload.asset.id, /^bg-generated-[a-f0-9]{20}$/);
    assert.match(payload.asset.filename, /^bg_night-train_漂浮水晶档案室_eclipse_violet-mist_\d{8}T\d{6}Z_[a-f0-9]{10}\.png$/);
    assert.equal(payload.worldIndex.activeAssetId, payload.asset.id);
    assert.ok(payload.worldIndex.assetIds.includes(payload.asset.id));
    assert.equal(upstreamUrl, "https://image-provider.invalid/v1/images/generations");
    assert.equal(generatedRows.size, 1);
    assert.equal(worldRows.size, 1);
    assert.equal(objects.size, 1);

    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const catalogResponse = await worker.fetch(new Request("http://localhost/api/background-assets?worldId=world-night-train", { headers: { cookie } }), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.json();
    assert.equal(catalog.masterIndex.assets.length, 1);
    assert.ok(catalog.masterIndex.assets.some((asset) => asset.id === payload.asset.id));
    assert.equal(catalog.worldIndex.activeAssetId, payload.asset.id);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Node production runtime reads image Agent configuration when Cloudflare env bindings are absent", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("node-image-agent-status-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const previous = {
    baseUrl: process.env.NEWAPI_BASE_URL,
    imageBaseUrl: process.env.NEWAPI_IMAGE_BASE_URL,
    textBaseUrl: process.env.NEWAPI_TEXT_BASE_URL,
    imageKey: process.env.NEWAPI_IMAGE_API_KEY,
    imageModel: process.env.NEWAPI_IMAGE_MODEL,
    textKey: process.env.NEWAPI_TEXT_API_KEY,
    textModel: process.env.NEWAPI_TEXT_MODEL,
  };
  delete process.env.NEWAPI_BASE_URL;
  process.env.NEWAPI_IMAGE_BASE_URL = "https://image-model.invalid/v1/images/edits";
  process.env.NEWAPI_TEXT_BASE_URL = "https://text-model.invalid";
  process.env.NEWAPI_IMAGE_API_KEY = "test-only-image-key";
  process.env.NEWAPI_IMAGE_MODEL = "test-image-model";
  process.env.NEWAPI_TEXT_API_KEY = "test-only-text-key";
  process.env.NEWAPI_TEXT_MODEL = "test-text-model";
  try {
    const response = await worker.fetch(
      new Request("http://localhost/api/ai/status"),
      undefined,
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.imageConfigured, true);
    assert.equal(payload.imageModel, "test-image-model");
    assert.deepEqual(payload.agentChannels.image, {
      configured: true,
      label: "Image Agent",
      model: "test-image-model",
      baseUrl: "https://image-model.invalid/v1",
      protocol: "images/edits",
      fallbackProtocols: [],
    });
    assert.deepEqual(payload.agentChannels.text, {
      configured: true,
      label: "Character Agents",
      model: "test-text-model",
      baseUrl: "https://text-model.invalid/v1",
      protocol: "chat/completions",
      fallbackProtocols: ["messages"],
    });
    assert.doesNotMatch(JSON.stringify(payload), /test-only-(?:image|text)-key/);
  } finally {
    for (const [key, value] of Object.entries({
      NEWAPI_BASE_URL: previous.baseUrl,
      NEWAPI_IMAGE_BASE_URL: previous.imageBaseUrl,
      NEWAPI_TEXT_BASE_URL: previous.textBaseUrl,
      NEWAPI_IMAGE_API_KEY: previous.imageKey,
      NEWAPI_IMAGE_MODEL: previous.imageModel,
      NEWAPI_TEXT_API_KEY: previous.textKey,
      NEWAPI_TEXT_MODEL: previous.textModel,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("character image endpoint calls images edits directly and preserves the reference", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("image-agent-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  const generatedBase64 = "iVBORw0KGgo".padEnd(300, "A");
  const generatedImage = `data:image/png;base64,${generatedBase64}`;
  let upstreamUrl = "";
  let upstreamBody = null;
  globalThis.fetch = async (input, init) => {
    upstreamUrl = String(input);
    upstreamBody = init?.body;
    return new Response(JSON.stringify({
      data: [{ result: generatedBase64 }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(
      new Request("http://localhost/api/ai/character", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "阿桃", personality: "开朗", background: "像素小镇居民", referenceUrl: generatedImage }),
      }),
      {
        NEWAPI_IMAGE_BASE_URL: "https://image-provider.invalid/v1/images/edits",
        NEWAPI_IMAGE_API_KEY: "test-only-image-key",
        NEWAPI_IMAGE_MODEL: "gpt-image-2",
        ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.imageDataUrl, generatedImage);
    assert.equal(payload.protocol, "images/edits");
    assert.equal(upstreamUrl, "https://image-provider.invalid/v1/images/edits");
    assert.ok(upstreamBody instanceof FormData);
    assert.equal(upstreamBody.get("model"), "gpt-image-2");
    assert.equal(upstreamBody.get("size"), "1024x1536");
    assert.ok(upstreamBody.get("image") instanceof Blob);
    assert.match(String(upstreamBody.get("prompt")), /4 columns × 5 rows/);
    assert.match(String(upstreamBody.get("prompt")), /straight front/);
    assert.match(String(upstreamBody.get("prompt")), /front three-quarter (?:turned toward|facing) viewer-left/);
    assert.match(String(upstreamBody.get("prompt")), /front three-quarter (?:turned toward|facing) viewer-right/);
    assert.match(String(upstreamBody.get("prompt")), /REFERENCE FIDELITY IS THE HIGHEST PRIORITY/);
    assert.match(String(upstreamBody.get("prompt")), /canonical and only source of truth for both the character design and the visual art style/);
    assert.match(String(upstreamBody.get("prompt")), /Character name, personality and background may influence only pose and emotion/);
    assert.match(String(upstreamBody.get("prompt")), /Do not change art style/);
    assert.match(String(upstreamBody.get("prompt")), /simplify the action instead of altering the character or style/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("incremental action Agent requests front, left-turn, and right-turn columns", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("action-agent-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  const generatedBase64 = "iVBORw0KGgo=";
  const generatedImage = `data:image/png;base64,${generatedBase64}`;
  let upstreamUrl = "";
  let upstreamBody = null;
  globalThis.fetch = async (input, init) => {
    upstreamUrl = String(input);
    upstreamBody = init?.body;
    return new Response(JSON.stringify({
      data: [{ b64_json: generatedBase64 }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(
      new Request("http://localhost/api/ai/pet-actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestedActions: ["交谈", "倾听"],
          existingActions: ["idle", "walk"],
          referenceUrl: generatedImage,
        }),
      }),
      {
        NEWAPI_IMAGE_BASE_URL: "https://image-provider.invalid",
        NEWAPI_IMAGE_API_KEY: "test-only-image-key",
        NEWAPI_IMAGE_MODEL: "gpt-image-2",
        ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.grid, { columns: 4, rows: 3 });
    assert.deepEqual(payload.actions, ["交谈", "倾听"]);
    assert.equal(payload.protocol, "images/edits");
    assert.equal(payload.metadataProtocol, "pixel-pet/action-unit/v1");
    assert.equal(upstreamUrl, "https://image-provider.invalid/v1/images/edits");
    assert.ok(upstreamBody instanceof FormData);
    assert.equal(upstreamBody.get("size"), "1536x1024");
    assert.match(String(upstreamBody.get("prompt")), /4 columns by 3 rows/);
    assert.match(String(upstreamBody.get("prompt")), /Row 1 contains the straight-front pose/);
    assert.match(String(upstreamBody.get("prompt")), /Row 2 contains the matching front three-quarter pose facing viewer-left/);
    assert.match(String(upstreamBody.get("prompt")), /Row 3 contains the matching front three-quarter pose facing viewer-right/);
    assert.match(String(upstreamBody.get("prompt")), /REFERENCE AND STYLE FIDELITY ARE THE HIGHEST PRIORITY/);
    assert.match(String(upstreamBody.get("prompt")), /locked canonical model sheet/);
    assert.match(String(upstreamBody.get("prompt")), /reuse the same pixel density/);
    assert.match(String(upstreamBody.get("prompt")), /palette drift, proportion drift or art-style drift/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("optional character research searches Wiki candidates and returns a source-backed player review pack", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("character-research-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  let modelCalls = 0;
  let sawPolicyCompliantUserAgent = false;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "zh.wikipedia.org" && url.searchParams.get("generator") === "search") {
      const headers = new Headers(init.headers);
      assert.match(headers.get("user-agent") || "", /^CPDanceBot\/1\.1 \(https:\/\//);
      assert.equal(headers.get("api-user-agent"), headers.get("user-agent"));
      sawPolicyCompliantUserAgent = true;
      return new Response(JSON.stringify({ query: { pages: [{ pageid: 101, title: "测试角色", extract: "测试作品中的虚构人物。", pageprops: { wikibase_item: "Q100" } }] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "www.wikidata.org" && url.searchParams.get("action") === "wbsearchentities") {
      return new Response(JSON.stringify({ search: [{ id: "Q100", label: "测试角色", description: "测试作品中的虚构人物" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname.includes("Special:EntityData/Q100.json")) {
      return new Response(JSON.stringify({ entities: { Q100: {
        id: "Q100",
        lastrevid: 9001,
        labels: { zh: { value: "测试角色" } },
        descriptions: { zh: { value: "测试作品中的虚构人物" } },
        aliases: { zh: [{ value: "小测" }] },
        sitelinks: { zhwiki: { title: "测试角色" } },
        claims: { P3373: [{ mainsnak: { datavalue: { value: { id: "Q200" } } } }] },
      } } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "zh.wikipedia.org" && url.searchParams.get("prop")?.includes("revisions")) {
      return new Response(JSON.stringify({ query: { pages: [{ pageid: 101, title: "测试角色", extract: "测试角色在危机中总会先保护同伴。她与测试同伴共同完成过一次救援。", revisions: [{ revid: 7001, timestamp: "2026-07-20T00:00:00Z" }], pageprops: { wikibase_item: "Q100" } }] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "www.wikidata.org" && url.searchParams.get("action") === "wbgetentities") {
      return new Response(JSON.stringify({ entities: { Q200: { labels: { zh: { value: "测试同伴" } } } } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "text-provider.invalid") {
      modelCalls += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        backgroundDraft: "测试角色来自测试作品，曾与同伴完成救援。",
        roleplayNotesDraft: "遇到危机时先行动保护同伴，之后才解释。",
        claims: [
          { type: "background", text: "曾与同伴完成救援。", confidence: "confirmed", evidenceSource: "wikipedia", evidenceSnippet: "她与测试同伴共同完成过一次救援。" },
          { type: "behavior", text: "遇到危机时会优先保护同伴。", confidence: "supported", evidenceSource: "wikipedia", evidenceSnippet: "测试角色在危机中总会先保护同伴。" },
          { type: "speech_pattern", text: "可能习惯使用短句。", confidence: "inferred", evidenceSource: "wikipedia", evidenceSnippet: "" },
        ],
        relationships: [{ targetQid: "Q200", targetName: "测试同伴", relationType: "friend", directionDescription: "把测试同伴视作需要保护的重要伙伴。", sharedEvents: ["共同完成过一次救援"], confidence: "supported", evidenceSource: "wikipedia" }],
        limitations: ["百科没有提供足够的逐字台词，表达方式仍需玩家补充。"],
      }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected upstream request: ${url}`);
  };
  const env = {
    NEWAPI_TEXT_BASE_URL: "https://text-provider.invalid",
    NEWAPI_TEXT_API_KEY: "test-only-text-key",
    NEWAPI_TEXT_MODEL: "test-research-model",
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  const context = { waitUntil() {}, passThroughOnException() {} };
  try {
    const searchResponse = await worker.fetch(new Request("http://localhost/api/research/character/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "测试角色", canonScope: "测试作品", language: "zh" }),
    }), env, context);
    assert.equal(searchResponse.status, 200);
    const searchPayload = await searchResponse.json();
    assert.equal(searchPayload.candidates[0].qid, "Q100");
    assert.equal(sawPolicyCompliantUserAgent, true);
    assert.equal(modelCalls, 0);

    const extractResponse = await worker.fetch(new Request("http://localhost/api/research/character/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "测试角色", canonScope: "测试作品", language: "zh", candidate: searchPayload.candidates[0] }),
    }), env, context);
    assert.equal(extractResponse.status, 200);
    const extractPayload = await extractResponse.json();
    assert.equal(modelCalls, 1);
    assert.equal(extractPayload.pack.schema, "cp-dance/character-reference-pack/v1");
    assert.equal(extractPayload.pack.enabled, false);
    assert.equal(extractPayload.pack.entity.qid, "Q100");
    assert.equal(extractPayload.pack.sources.length, 2);
    assert.equal(extractPayload.pack.claims.find((claim) => claim.type === "behavior").selectedByPlayer, false);
    assert.equal(extractPayload.pack.claims.find((claim) => claim.type === "speech_pattern").selectedByPlayer, false);
    assert.equal(extractPayload.pack.relationships.every((relation) => relation.selectedByPlayer === false), true);
    assert.equal(extractPayload.pack.relationships[0].targetQid, "Q200");
    assert.match(extractPayload.pack.relationships[0].directionDescription, /重要伙伴/);
    assert.match(extractPayload.pack.limitations.join(" "), /逐字台词/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("character research falls back to Wikimedia Core REST when Action API rejects the Worker", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("character-research-fallback-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  let fallbackCalls = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    if (url.hostname.endsWith("wikipedia.org") || url.hostname.endsWith("wikidata.org") || url.hostname === "api.wikimedia.org") {
      assert.match(headers.get("user-agent") || "", /CPDanceBot\/1\.1/);
    }
    if (url.hostname === "zh.wikipedia.org" && url.searchParams.get("generator") === "search") {
      return new Response("Scripts should use an informative User-Agent string", { status: 403 });
    }
    if (url.hostname === "api.wikimedia.org" && url.pathname.endsWith("/search/page")) {
      fallbackCalls += 1;
      return new Response(JSON.stringify({ pages: [{ id: 202, key: "备用角色", title: "备用角色", excerpt: "<span class=\"searchmatch\">备用</span>作品中的虚构人物", description: "动画角色" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "www.wikidata.org" && url.searchParams.get("action") === "wbsearchentities") {
      return new Response(JSON.stringify({ search: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected upstream request: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/research/character/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "备用角色", canonScope: "备用作品", language: "zh" }),
    }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(fallbackCalls, 1);
    assert.equal(payload.candidates[0].title, "备用角色");
    assert.equal(payload.candidates[0].excerpt.includes("<span"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("character research ranks an exact simplified Chinese entity above related work pages", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("character-research-entity-ranking-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "zh.wikipedia.org" && url.searchParams.get("titles") === "初音未来") {
      return new Response(JSON.stringify({ query: { redirects: [{ from: "初音未来", to: "初音未來" }], pages: [{ pageid: 1, title: "初音未來", extract: "虛擬歌手之角色主唱系列，也是軟體的象徵角色。", pageprops: { wikibase_item: "Q552682" } }] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "zh.wikipedia.org" && url.searchParams.get("generator") === "search") {
      return new Response(JSON.stringify({ query: { pages: [
        { pageid: 1, title: "初音未來", extract: "虛擬歌手之角色主唱系列。", pageprops: { wikibase_item: "Q552682" } },
        { pageid: 2, title: "初音未来 -歌姬计划- (游戏)", extract: "2009 年音乐电子游戏。", pageprops: { wikibase_item: "Q19840171" } },
        { pageid: 3, title: "初音未来的消失", extract: "cosMo 创作的歌曲。", pageprops: { wikibase_item: "Q10898250" } },
      ] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "www.wikidata.org" && url.searchParams.get("action") === "wbsearchentities") {
      return new Response(JSON.stringify({ search: [
        { id: "Q552682", label: "初音未來", description: "Crypton的歌声库系列，虚构人物", match: { type: "label", language: "zh-hans", text: "初音未来" } },
        { id: "Q19840171", label: "初音未来 -歌姬计划-", description: "2009年电子游戏", match: { type: "label", language: "zh", text: "初音未来 -歌姬计划-" } },
      ] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "zh.moegirl.org.cn" && url.searchParams.get("titles") === "初音未来") {
      return new Response(JSON.stringify({ query: { pages: [{ pageid: 1399, ns: 0, title: "初音未来", extract: "初音未来是VOCALOID虚拟角色。", categories: [{ title: "Category:VOCALOID角色" }] }] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "zh.moegirl.org.cn" && url.searchParams.get("generator") === "search") {
      return new Response(JSON.stringify({ query: { pages: [] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected upstream request: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/research/character/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "初音未来", canonScope: "", language: "zh" }),
    }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.candidates[0].title, "初音未来");
    assert.equal(payload.candidates[0].sourceKind, "moegirl");
    assert.equal(payload.candidates[0].matchKind, "exact");
    assert.equal(payload.candidates[0].entityKind, "character");
    assert.equal(payload.candidates.some((candidate) => candidate.qid === "Q552682" && candidate.sourceKind === "wikipedia"), true);
    assert.equal(payload.candidates.some((candidate) => candidate.qid === "Q19840171"), false);
    assert.equal(payload.candidates.some((candidate) => candidate.qid === "Q10898250"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("character research corrects a scoped role-name typo and removes Moegirl disambiguation pages", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("character-research-alias-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  let aliasModelCalls = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "zh.wikipedia.org" && url.searchParams.get("titles")) {
      const query = url.searchParams.get("titles");
      return new Response(JSON.stringify({ query: { pages: query === "得克萨斯"
        ? [{ pageid: 1439, ns: 0, title: "得克萨斯州", extract: "美国南方州份。", pageprops: { wikibase_item: "Q1439" } }]
        : [{ ns: 0, title: query, missing: true }] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "zh.wikipedia.org" && url.searchParams.get("generator") === "search") {
      const query = url.searchParams.get("gsrsearch") || "";
      return new Response(JSON.stringify({ query: { pages: query.includes("得克萨斯")
        ? [{ pageid: 1439, ns: 0, title: "得克萨斯州", extract: "美国南方州份。", pageprops: { wikibase_item: "Q1439" } }]
        : [{ pageid: 9001, ns: 0, title: "田所梓", extract: "为明日方舟角色配音的日本女性声优。" }] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "www.wikidata.org" && url.searchParams.get("action") === "wbsearchentities") {
      const query = url.searchParams.get("search");
      return new Response(JSON.stringify({ search: query === "得克萨斯" ? [{ id: "Q1439", label: "得克萨斯州", description: "美国南方州份", match: { type: "alias", text: "得克萨斯" } }] : [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "zh.moegirl.org.cn" && url.searchParams.get("titles")) {
      const query = url.searchParams.get("titles");
      return new Response(JSON.stringify({ query: { pages: query === "德克萨斯"
        ? [{ pageid: 420255, ns: 0, title: "德克萨斯", extract: "德克萨斯可以指明日方舟角色。", categories: [{ title: "Category:消歧义页" }] }]
        : [{ ns: 0, title: query, missing: true }] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "zh.moegirl.org.cn" && url.searchParams.get("generator") === "search") {
      const query = url.searchParams.get("gsrsearch") || "";
      return new Response(JSON.stringify({ query: { pages: query.includes("德克萨斯") ? [
        { pageid: 326602, ns: 0, title: "德克萨斯(明日方舟)", extract: "德克萨斯是游戏《明日方舟》的登场角色。", categories: [{ title: "Category:明日方舟角色" }] },
        { pageid: 420255, ns: 0, title: "德克萨斯", extract: "德克萨斯可以指多个条目。", categories: [{ title: "Category:消歧义页" }] },
      ] : [] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "text-provider.invalid") {
      aliasModelCalls += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ aliases: ["德克萨斯"] }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected upstream request: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/research/character/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "得克萨斯", canonScope: "明日方舟", language: "zh" }),
    }), {
      NEWAPI_TEXT_BASE_URL: "https://text-provider.invalid",
      NEWAPI_TEXT_API_KEY: "test-only-text-key",
      NEWAPI_TEXT_MODEL: "test-research-model",
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(aliasModelCalls, 1);
    assert.deepEqual(payload.searchAliases, ["德克萨斯"]);
    assert.equal(payload.candidates[0].title, "德克萨斯(明日方舟)");
    assert.equal(payload.candidates[0].sourceKind, "moegirl");
    assert.equal(payload.candidates[0].matchKind, "alias");
    assert.equal(payload.candidates.some((candidate) => candidate.title === "德克萨斯"), false);
    assert.equal(payload.candidates.some((candidate) => candidate.qid === "Q1439"), false);
    assert.equal(payload.candidates.some((candidate) => candidate.title === "田所梓"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("character research refuses to extract a work page as a character", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("character-research-work-guard-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("Special:EntityData/Q19840171.json")) {
      return new Response(JSON.stringify({ entities: { Q19840171: {
        id: "Q19840171",
        labels: { zh: { value: "初音未来 -歌姬计划-" } },
        descriptions: { zh: { value: "2009年电子游戏" } },
        sitelinks: { zhwiki: { title: "初音未来 -歌姬计划- (游戏)" } },
        claims: {},
      } } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "zh.wikipedia.org" && url.searchParams.get("prop")?.includes("revisions")) {
      return new Response(JSON.stringify({ query: { pages: [{ pageid: 2, title: "初音未来 -歌姬计划- (游戏)", extract: "这是一款于 2009 年发售的 PSP 音乐电子游戏。", revisions: [{ revid: 2, timestamp: "2026-07-20T00:00:00Z" }], pageprops: { wikibase_item: "Q19840171" } }] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected upstream request: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/research/character/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "初音未来", language: "zh", candidate: { qid: "Q19840171", title: "初音未来 -歌姬计划- (游戏)", wikipediaTitle: "初音未来 -歌姬计划- (游戏)", language: "zh" } }),
    }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 422);
    const payload = await response.json();
    assert.match(payload.error, /不是人物页面/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("character research searches and extracts a noncommercial Moegirlpedia reference with attribution", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("character-research-moegirl-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  let modelCalls = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "zh.moegirl.org.cn" && url.searchParams.get("titles") === "冷门角色") {
      assert.equal(url.searchParams.get("prop")?.includes("revisions"), false);
      return new Response(JSON.stringify({ query: { pages: [{
        pageid: 301,
        ns: 0,
        title: "冷门角色",
        extract: "冷门角色是测试作品中的游戏角色。她习惯先观察同伴，再用简短的话提醒对方。她与同行者共同守护过港口。",
        categories: [{ title: "分类:测试作品角色" }],
      }] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "zh.moegirl.org.cn" && url.searchParams.get("generator") === "search") {
      assert.match(url.searchParams.get("gsrsearch") || "", /intitle:"冷门角色"/);
      return new Response(JSON.stringify({ query: { pages: [] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "text-provider.invalid") {
      modelCalls += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        backgroundDraft: "冷门角色来自测试作品，曾与同行者守护港口。",
        roleplayNotesDraft: "先观察，再用短句提醒对方。",
        claims: [{ type: "behavior", text: "习惯先观察同伴再行动。", confidence: "supported", evidenceSource: "moegirl", evidenceSnippet: "她习惯先观察同伴" }],
        relationships: [{ targetQid: null, targetName: "同行者", relationType: "ally", directionDescription: "把同行者视作共同守护港口的伙伴。", sharedEvents: ["共同守护过港口"], confidence: "supported", evidenceSource: "moegirl" }],
        limitations: [],
      }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected upstream request: ${url}`);
  };
  const env = {
    NEWAPI_TEXT_BASE_URL: "https://text-provider.invalid",
    NEWAPI_TEXT_API_KEY: "test-only-text-key",
    NEWAPI_TEXT_MODEL: "test-research-model",
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  const context = { waitUntil() {}, passThroughOnException() {} };
  try {
    const searchResponse = await worker.fetch(new Request("http://localhost/api/research/character/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "冷门角色", canonScope: "测试作品", language: "zh" }),
    }), env, context);
    assert.equal(searchResponse.status, 200);
    const searchPayload = await searchResponse.json();
    assert.equal(searchPayload.candidates[0].sourceKind, "moegirl");
    assert.match(searchPayload.candidates[0].sourceUrl, /zh\.moegirl\.org\.cn/);

    const extractResponse = await worker.fetch(new Request("http://localhost/api/research/character/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "冷门角色", canonScope: "测试作品", language: "zh", candidate: searchPayload.candidates[0] }),
    }), env, context);
    assert.equal(extractResponse.status, 200);
    const extractPayload = await extractResponse.json();
    assert.equal(modelCalls, 1);
    assert.equal(extractPayload.pack.entity.moegirlTitle, "冷门角色");
    assert.equal(extractPayload.pack.sources[0].kind, "moegirl");
    assert.equal(extractPayload.pack.sources[0].licenseName, "CC BY-NC-SA 3.0 CN");
    assert.equal(extractPayload.pack.sources[0].commercialUse, "prohibited");
    assert.equal(extractPayload.pack.sources[0].attributionText, "引自萌娘百科");
    assert.deepEqual(extractPayload.pack.claims[0].evidenceSourceIds, ["source-moegirl"]);
    assert.deepEqual(extractPayload.pack.relationships[0].evidenceSourceIds, ["source-moegirl"]);
    assert.equal(extractPayload.pack.claims[0].selectedByPlayer, false);
    assert.equal(extractPayload.pack.relationships[0].selectedByPlayer, false);
    assert.match(extractPayload.pack.limitations.join(" "), /保留原页面链接/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("character research reads the full Moegirl page and distills evidence from its final chunk", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("character-research-full-page-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  const modelInputs = [];
  const longBody = Array.from({ length: 300 }, (_, index) => `<p>档案段落${index + 1}：德克萨斯在罗德岛执行任务时保持冷静，并观察周围人的反应后再行动。这是用于验证整页分段读取的公开资料。</p>`).join("");
  const fullPageHtml = `<html><body><h1>德克萨斯(明日方舟)</h1><h2>基础档案</h2>${longBody}<h2>角色台词</h2><p>能天使，掩护我。</p><h2>角色经历</h2><p>她在任务结束后仍会确认同伴是否安全。</p><h2>角色相关</h2><p>尾部关系证据：德克萨斯与能天使长期并肩行动。</p></body></html>`;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "zh.moegirl.org.cn" && url.searchParams.get("titles") === "德克萨斯(明日方舟)") {
      return new Response(JSON.stringify({ query: { pages: [{
        pageid: 326602,
        ns: 0,
        title: "德克萨斯(明日方舟)",
        extract: "德克萨斯是游戏《明日方舟》中的虚构角色。",
        categories: [{ title: "分类:明日方舟角色" }],
      }] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "zh.moegirl.org.cn" && url.pathname.startsWith("/rest.php/v1/page/") && url.pathname.endsWith("/html")) {
      return new Response(fullPageHtml, { status: 200, headers: { "content-type": "text/html" } });
    }
    if (url.hostname === "text-provider.invalid") {
      const requestBody = JSON.parse(String(init.body || "{}"));
      const userContent = requestBody.messages?.find((message) => message.role === "user")?.content || "";
      modelInputs.push(userContent);
      const finalChunk = userContent.includes("尾部关系证据");
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        backgroundDraft: finalChunk ? "" : "德克萨斯在罗德岛执行任务。",
        roleplayNotesDraft: finalChunk ? "与能天使并肩行动时会直接下达短促指令。" : "先观察环境，再采取行动。",
        claims: [finalChunk
          ? { type: "relationship", text: "与能天使长期并肩行动。", confidence: "supported", evidenceSource: "moegirl", evidenceSnippet: "德克萨斯与能天使长期并肩行动" }
          : { type: "behavior", text: "执行任务时保持冷静并先观察环境。", confidence: "supported", evidenceSource: "moegirl", evidenceSnippet: "执行任务时保持冷静" }],
        relationships: finalChunk ? [{ targetQid: null, targetName: "能天使", relationType: "ally", directionDescription: "把能天使视作长期并肩行动的同伴。", sharedEvents: ["长期并肩行动"], confidence: "supported", evidenceSource: "moegirl" }] : [],
        limitations: [],
      }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected upstream request: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/research/character/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "德克萨斯",
        canonScope: "明日方舟",
        language: "zh",
        candidate: { id: "moegirl-326602", title: "德克萨斯(明日方舟)", description: "明日方舟中的虚构角色", language: "zh", sourceKind: "moegirl" },
      }),
    }), {
      NEWAPI_TEXT_BASE_URL: "https://text-provider.invalid",
      NEWAPI_TEXT_API_KEY: "test-only-text-key",
      NEWAPI_TEXT_MODEL: "test-research-model",
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(modelInputs.length >= 2);
    assert.equal(modelInputs.some((content) => content.includes("尾部关系证据")), true);
    assert.equal(payload.pack.sources[0].contentMode, "full_page");
    assert.ok(payload.pack.sources[0].contentCharacters > 14_000);
    assert.ok(payload.pack.sources[0].contentSections >= 4);
    assert.ok(payload.pack.sources[0].contentChunks >= 2);
    assert.equal(payload.pack.claims.some((claim) => claim.text.includes("能天使")), true);
    assert.equal(payload.pack.relationships.some((relation) => relation.targetName === "能天使"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("character research merges player-selected Wikipedia and Moegirlpedia pages into an unconfirmed editable draft", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("character-research-mixed-draft-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  let modelCalls = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.includes("Special:EntityData/Q501.json")) {
      return new Response(JSON.stringify({ entities: { Q501: {
        id: "Q501",
        lastrevid: 9501,
        labels: { zh: { value: "混合角色" } },
        descriptions: { zh: { value: "测试作品中的虚构角色" } },
        aliases: { zh: [{ value: "混合人物" }] },
        sitelinks: { zhwiki: { title: "混合角色" } },
        claims: {},
      } } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "zh.wikipedia.org" && url.searchParams.get("prop")?.includes("revisions")) {
      return new Response(JSON.stringify({ query: { pages: [{ pageid: 501, ns: 0, title: "混合角色", extract: "混合角色是测试作品中的虚构角色，曾负责守卫灯塔。", revisions: [{ revid: 8501, timestamp: "2026-07-20T00:00:00Z" }], pageprops: { wikibase_item: "Q501" } }] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "zh.moegirl.org.cn" && url.searchParams.get("titles") === "混合角色") {
      return new Response(JSON.stringify({ query: { pages: [{ pageid: 601, ns: 0, title: "混合角色", extract: "混合角色是测试作品中的游戏角色。她说话前会先轻敲桌面。", revisions: [{ revid: 8601, timestamp: "2026-07-20T00:00:00Z" }], categories: [{ title: "Category:测试作品角色" }] }] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "text-provider.invalid") {
      modelCalls += 1;
      const requestBody = JSON.parse(String(init.body || "{}"));
      const userContent = requestBody.messages?.find((message) => message.role === "user")?.content || "";
      const fromMoegirl = userContent.includes('"moegirl":{"title":"混合角色"');
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(fromMoegirl ? {
        backgroundDraft: "",
        roleplayNotesDraft: "说话前会先轻敲桌面。",
        claims: [{ type: "behavior", text: "说话前会先轻敲桌面。", confidence: "supported", evidenceSource: "moegirl", evidenceSnippet: "她说话前会先轻敲桌面" }],
        relationships: [],
        limitations: [],
      } : {
        backgroundDraft: "曾负责守卫灯塔。",
        roleplayNotesDraft: "",
        claims: [{ type: "background", text: "曾负责守卫灯塔。", confidence: "confirmed", evidenceSource: "wikipedia", evidenceSnippet: "曾负责守卫灯塔" }],
        relationships: [],
        limitations: [],
      }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected upstream request: ${url}`);
  };
  const env = {
    NEWAPI_TEXT_BASE_URL: "https://text-provider.invalid",
    NEWAPI_TEXT_API_KEY: "test-only-text-key",
    NEWAPI_TEXT_MODEL: "test-research-model",
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  const context = { waitUntil() {}, passThroughOnException() {} };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/research/character/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "混合角色",
        canonScope: "测试作品",
        language: "zh",
        candidates: [
          { id: "Q501", qid: "Q501", title: "混合角色", wikipediaTitle: "混合角色", language: "zh", sourceKind: "wikipedia" },
          { id: "moegirl-601", qid: null, title: "混合角色", wikipediaTitle: null, language: "zh", sourceKind: "moegirl" },
        ],
      }),
    }), env, context);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(modelCalls, 2);
    assert.equal(payload.pack.enabled, false);
    assert.equal(payload.pack.entity.wikipediaTitle, "混合角色");
    assert.equal(payload.pack.entity.moegirlTitle, "混合角色");
    assert.deepEqual(new Set(payload.pack.sources.map((source) => source.kind)), new Set(["wikipedia", "wikidata", "moegirl"]));
    assert.equal(payload.pack.claims.some((claim) => claim.text.includes("灯塔")), true);
    assert.equal(payload.pack.claims.some((claim) => claim.text.includes("轻敲桌面")), true);
    assert.equal(payload.pack.claims.every((claim) => claim.selectedByPlayer === false), true);
    assert.equal(payload.pack.claims.every((claim) => claim.evidenceSourceIds.every((id) => payload.pack.sources.some((source) => source.id === id))), true);
    assert.match(payload.pack.limitations.join(" "), /尚未写入角色档案或 Agent 记忆/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("character research distills only player-confirmed evidence into an editable Character Profile preview", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("character-research-distillation-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  let modelUserContent = "";
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "text-provider.invalid") {
      const requestBody = JSON.parse(String(init.body || "{}"));
      modelUserContent = requestBody.messages?.find((message) => message.role === "user")?.content || "";
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        name: "蒸馏角色",
        personality: "面对危机时克制而果断。",
        background: "曾负责守卫灯塔，并持续追查失踪船队。",
        roleplayNotes: "说话简短，提醒同伴前会轻敲桌面。",
        summary: "玩家设定与两条确认事实已融合。",
      }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected upstream request: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/research/character/distill", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        playerProfile: { name: "蒸馏角色", personality: "玩家填写：不轻易许诺。", background: "玩家填写：来自港口城。", roleplayNotes: "玩家填写：绝不使用轻浮称呼。" },
        pack: {
          schema: "cp-dance/character-reference-pack/v1",
          enabled: false,
          query: "蒸馏角色",
          canonScope: "测试作品",
          entity: { qid: null, name: "蒸馏角色", aliases: [], description: "", language: "zh", wikipediaTitle: null, moegirlTitle: "蒸馏角色" },
          sources: [{ id: "source-moegirl", kind: "moegirl", title: "蒸馏角色", url: "https://zh.moegirl.org.cn/蒸馏角色", revisionId: "1", retrievedAt: "2026-07-20T00:00:00Z", language: "zh", licenseName: "CC BY-NC-SA 3.0 CN", licenseUrl: "https://zh.moegirl.org.cn/萌娘百科:著作权信息", commercialUse: "prohibited", attributionText: "引自萌娘百科" }],
          claims: [
            { id: "confirmed-background", type: "background", text: "曾负责守卫灯塔。", confidence: "confirmed", evidenceSourceIds: ["source-moegirl"], evidenceSnippet: "守卫灯塔", selectedByPlayer: true },
            { id: "unconfirmed-rumor", type: "behavior", text: "未确认内容绝不能进入蒸馏。", confidence: "inferred", evidenceSourceIds: ["source-moegirl"], evidenceSnippet: null, selectedByPlayer: false },
          ],
          relationships: [{ id: "confirmed-relation", targetQid: null, targetName: "同行者", relationType: "ally", directionDescription: "把对方视为可以共同值夜的伙伴。", sharedEvents: [], confidence: "supported", evidenceSourceIds: ["source-moegirl"], selectedByPlayer: true }],
          backgroundDraft: "",
          roleplayNotesDraft: "",
          limitations: [],
          researchedAt: "2026-07-20T00:00:00Z",
          appliedAt: null,
        },
      }),
    }), {
      NEWAPI_TEXT_BASE_URL: "https://text-provider.invalid",
      NEWAPI_TEXT_API_KEY: "test-only-text-key",
      NEWAPI_TEXT_MODEL: "test-distillation-model",
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.mode, "agent");
    assert.equal(payload.distillation.schema, "cp-dance/character-profile-distillation/v1");
    assert.match(payload.distillation.personality, /玩家填写：不轻易许诺/);
    assert.match(payload.distillation.personality, /克制而果断/);
    assert.match(payload.distillation.background, /来自港口城/);
    assert.match(payload.distillation.background, /守卫灯塔/);
    assert.match(payload.distillation.roleplayNotes, /绝不使用轻浮称呼/);
    assert.deepEqual(payload.distillation.sourceClaimIds, ["confirmed-background"]);
    assert.deepEqual(payload.distillation.sourceRelationshipIds, ["confirmed-relation"]);
    assert.match(modelUserContent, /曾负责守卫灯塔/);
    assert.doesNotMatch(modelUserContent, /未确认内容绝不能进入蒸馏/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("supports independent natural and director modes with shared Character Agents, consent routing, desktop pets, and memory", async () => {
  const [page, styles, desktopSurface, desktopBridge, desktopMain, relationshipGraph, forge, engine, characterMemory, roleplayProfile, characterReference, duoInteraction, interactionSession, actionUnit, relationshipEngine, modelProvider, naturalRuntime, storyDirectorRuntime, directorRuntime, directorTypes, storyContext, storyContextTypes, agentTypes, assetProvider, pixelPet, runtime, normalizer, segmentation, sprite, worldSave, characterSave, layout, packageJson, architecture, handoff, agentConfig, aiApi, directorApi, researchApi, saveApi, schema, hosting, worker] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../desktop/surface.js", import.meta.url), "utf8"),
    readFile(new URL("../app/desktop-pet-bridge.ts", import.meta.url), "utf8"),
    readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/RelationshipGraphEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/PixelPetForge.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/agent-engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/character-memory.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/roleplay.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/character-reference.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/duo-interaction.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/interaction-session.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/action-unit.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/relationship-engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/model-provider.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/natural-agent-runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/story-director-runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/director-runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/director-types.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/story-context.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/story-context-types.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/natural-agent-types.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/asset-provider.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/pixel-pet.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/pixel-pet-runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/sprite-sheet-normalizer.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/sprite-segmentation.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/PixelPetSprite.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/world-save.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/character-save.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../docs/AGENT_ARCHITECTURE.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/PROJECT_HANDOFF.md", import.meta.url), "utf8"),
    readFile(new URL("../worker/agent-config.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/ai-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/director-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/research-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/save-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);
  const [desktopSurfaceStyles, desktopPreload] = await Promise.all([
    readFile(new URL("../desktop/surface.css", import.meta.url), "utf8"),
    readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8"),
  ]);
  const [backgroundAssets, backgroundApi, backgroundRuntime, backgroundCatalog] = await Promise.all([
    readFile(new URL("../lib/background-assets.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/background-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/background-agent-runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/backgrounds/index.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /CP 跳动/);
  assert.match(page, /Couple Dance/);
  assert.match(page, /FIRST TIME HERE/);
  assert.match(page, /fetch\("\/api\/saves"/);
  assert.match(page, /persistSave/);
  assert.doesNotMatch(page, /localStorage|sessionStorage/);
  assert.match(page, /保存世界/);
  assert.match(page, /进入世界/);
  assert.match(page, /角色在这个世界产生的记忆与索引已恢复/);
  assert.match(page, /世界记忆不随角色携带/);
  assert.match(page, /查看已有角色/);
  assert.match(page, /ADD_SAVED_AGENT/);
  assert.match(page, /saveCompletedCharacter/);
  assert.match(page, /PixelPetForge/);
  assert.match(page, /PixelPetSprite/);
  assert.match(page, /RelationshipGraphEditor/);
  assert.match(page, /现在制作可交互角色/);
  assert.match(page, /interactive-character-title/);
  assert.match(page, /全部角色已可交互/);
  assert.match(page, /relationshipConfirmed/);
  assert.doesNotMatch(page, /modeSelectionPending/);
  assert.match(page, /state\.agents\.length >= 1/);
  assert.match(page, /dialogueBySpeaker/);
  assert.match(page, /StatusObservatory/);
  assert.match(page, /状态观测台/);
  assert.match(page, /stageAgentStyle/);
  assert.match(page, /spatialIntentLabel/);
  assert.match(page, /自然模式/);
  assert.match(page, /directionSummary/);
  assert.match(page, /runNaturalAgentTurn/);
  assert.match(page, /Character Profile v2/);
  assert.match(page, /启用角色考据 Skill/);
  assert.match(page, /\/api\/research\/character\/search/);
  assert.match(page, /\/api\/research\/character\/extract/);
  assert.match(page, /\/api\/research\/character\/distill/);
  assert.match(page, /混合整理已选来源/);
  assert.match(page, /生成完整人物档案预览/);
  assert.match(page, /蒸馏档案编辑与预览/);
  assert.match(page, /FINAL PROFILE PREVIEW/);
  assert.match(page, /应用已确认内容/);
  assert.match(page, /尚未写入角色档案或 Agent 记忆/);
  assert.match(page, /filter\(\(claim\) => selectedResearchClaims\.has/);
  assert.doesNotMatch(page, /同一段关系，两种主观方向/);
  assert.doesNotMatch(page, /public-dialogue-rail/);
  assert.doesNotMatch(page, /LIVE PERCEPTION/);
  assert.match(page, /publicDialogue: comparable\.publicDialogue/);
  assert.match(page, /stage-dialogue-deck/);
  assert.match(page, /agent-dialogue-card/);
  assert.match(page, /paginateDisplayText/);
  assert.match(page, /aria-label="文字翻页"/);
  assert.match(page, /data-agent-id=\{agent\.id\}/);
  assert.doesNotMatch(page, /真实 API 已连接/);
  assert.match(page, /文本 Character Agent 可用/);
  assert.match(page, /动作 AGENT/);
  assert.match(page, /背景 AGENT/);
  assert.match(page, /update\.job\.error/);
  assert.match(page, /job\.error/);
  assert.match(runtime, /await getPixelPetImageAgentStatus\(\)/);
  assert.match(page, /ActionAssetControl/);
  assert.match(page, /操控面板/);
  assert.match(page, /动作资产 \{jobs\.length\}/);
  assert.doesNotMatch(page, /id: `asset-/);
  assert.match(page, /导演 · STORY DIRECTOR/);
  assert.doesNotMatch(page, /<span>编排状态<\/span>/);
  assert.doesNotMatch(page, /<span>导演上下文<\/span>/);
  assert.doesNotMatch(page, /权限路径/);
  assert.doesNotMatch(page, /className="toast-stack runtime-toast-stack"/);
  assert.doesNotMatch(page, /className=\{`duo-action-badge/);
  assert.match(page, /activeSession/);
  assert.match(engine, /STAGE_OBSTACLES/);
  assert.match(interactionSession, /facingMode/);
  assert.match(interactionSession, /movesTogether/);
  assert.match(engine, /orientSessionPlaybackPair/);
  assert.match(page, /facing=\{spatial\?\.facing/);
  assert.match(page, /自然模式/);
  assert.match(page, /导演模式/);
  assert.match(page, /requestDirectorDecision/);
  assert.match(page, /director-panel/);
  assert.match(page, /选择只在进入前出现，进入后顶部不会提供切换/);
  assert.doesNotMatch(page, /STORY SEEDS|mode-switch/);
  assert.ok(page.indexOf('id="interactive-character-title"') < page.indexOf("<RelationshipGraphEditor"));
  assert.ok(page.indexOf('id="interactive-character-title"') < page.lastIndexOf("<PixelPetForge"));
  assert.match(page, /切到桌宠展示/);
  assert.match(page, /沉浸模式/);
  assert.match(page, /aria-pressed=\{immersiveMode\}/);
  assert.match(page, /event\.key === "Escape"/);
  assert.match(page, /setImmersiveMode\(false\).*setDesktopTransferActive\(true\)/s);
  assert.match(styles, /\.story-shell\.immersive-mode/);
  assert.match(styles, /\.immersive-mode \.relationship-panel,\n\.immersive-mode > \.status-observatory \{ display: none; \}/);
  assert.match(styles, /\.immersive-mode \.town-panel \{ display: grid; height: 100%;/);
  assert.match(page, /className="town-stage-viewport" ref=\{stageViewportRef\}/);
  assert.match(page, /ref=\{stageCanvasRef\}/);
  assert.match(page, /new ResizeObserver\(updateStageScale\)/);
  assert.match(styles, /transform: scale\(var\(--immersive-stage-scale, 1\)\)/);
  assert.match(page, /\{state\.mode === "story" && <><div className="desktop-window"/);
  assert.match(styles, /\.natural-stage \{[^}]*#f6f1e8;[^}]*background-size: 16px 16px;/s);
  assert.match(styles, /\.natural-stage::after \{ inset: 0; background: transparent; box-shadow: none;/);
  assert.doesNotMatch(styles, /\.immersive-mode \.natural-stage \.spatial-agent \.pixel-pet-avatar/);
  assert.match(styles, /\.town-stage \.spatial-agent \{ left: var\(--agent-x\)/);
  assert.match(styles, /\.scene-caption \.paged-copy p/);
  assert.doesNotMatch(styles, /\.scene-caption p \{[^}]+-webkit-line-clamp/);
  assert.match(engine, /mode === "story" \? storyOpeningSpatial\(state\.agents\)/);
  assert.match(page, /handoffWorldToDesktop/);
  assert.match(page, /desktopTransferInFlight/);
  assert.match(page, /readDesktopBridgeState/);
  assert.match(desktopSurface, /APPLY_DESKTOP_DRAG/);
  assert.match(desktopSurface, /APPLY_DESKTOP_POINTER_EVENT/);
  assert.match(desktopSurface, /setMousePassthrough/);
  assert.doesNotMatch(desktopSurface, /desktop-controls|desktop-notice/);
  assert.match(desktopSurface, /activeTransientReaction/);
  assert.match(desktopSurfaceStyles, /body \{ pointer-events: none; \}/);
  assert.match(desktopSurfaceStyles, /transition: left 360ms/);
  assert.doesNotMatch(desktopSurfaceStyles, /desktop-controls|desktop-notice/);
  assert.match(desktopPreload, /desktop:probe-hit-test/);
  assert.match(desktopBridge, /127\.0\.0\.1:47831/);
  assert.match(desktopMain, /transparent: true/);
  assert.match(desktopMain, /setIgnoreMouseEvents/);
  assert.match(desktopMain, /startMouseForwardingWatchdog/);
  assert.match(desktopMain, /desktop:probe-hit-test/);
  assert.match(desktopMain, /contextIsolation: true/);
  assert.match(desktopMain, /overlayWindow\.showInactive\(\);\s*return;/);
  assert.match(desktopMain, /if \(overlayWindow !== nextOverlayWindow\) return/);
  assert.match(engine, /desktopAttentionQueue/);
  assert.match(engine, /玩家把我拖到了.*附近/);
  assert.match(engine, /玩家把.*拖到了我附近/);
  assert.match(engine, /高权重考虑害羞、脸红、嘴硬或短暂慌乱/);
  assert.match(engine, /decision\.action === "move_closer"/);
  assert.match(engine, /\["move_away", "end_interaction"\]\.includes\(decision\.action\)/);
  assert.match(engine, /canOccupyIndependentPosition/);
  assert.match(engine, /completedActorIds/);
  assert.match(engine, /!completedActorIds\.has\(trigger\.actorId\)/);
  assert.match(engine, /recordInChronicle: false/);
  assert.match(engine, /applyTransientDesktopAgentDecision/);
  assert.match(engine, /dismissDesktopAttention/);
  assert.match(engine, /没有伪造台词、动作或记忆/);
  assert.match(engine, /minimumOccupancyHorizontalGap/);
  assert.match(engine, /separateSpatialOccupancy/);
  assert.match(engine, /relativeExplorePosition/);
  assert.match(engine, /centerDistanceForBodyGap/);
  assert.match(engine, /fixedIds: \[actor\.id\]/);
  const desktopDragReducer = engine.slice(engine.indexOf("function applyDesktopDrag"), engine.indexOf("function applyDesktopPointerEvent"));
  const liveDragBranch = desktopDragReducer.slice(desktopDragReducer.indexOf('if (action.phase === "move")'), desktopDragReducer.indexOf("const separated ="));
  assert.match(desktopDragReducer, /skipOccupancy: true/);
  assert.doesNotMatch(liveDragBranch, /separateSpatialOccupancy/);
  assert.match(engine, /action\.type === "APPLY_DESKTOP_DRAG" && action\.phase === "move"\) return next/);
  assert.match(engine, /"normal"/);
  const pointerReducer = engine.slice(engine.indexOf("function applyDesktopPointerEvent"), engine.indexOf("function resolveSpatialInteraction"));
  assert.doesNotMatch(pointerReducer, /events: \[event|turn: state\.turn \+ 1|memoryWrites/);
  const startDesktopBlock = page.slice(page.indexOf("const startDesktopPetMode"), page.indexOf("const stopDesktopPetMode"));
  assert.doesNotMatch(startDesktopBlock, /saveCurrentWorld/);
  assert.doesNotMatch(startDesktopBlock, /running: true|SET_RUNNING/);
  assert.match(startDesktopBlock, /projectRuntimeSurface\(state, "desktop_pet"\)/);
  const enterWorldBlock = page.slice(page.indexOf("const enterSelectedWorld"), page.indexOf("const submitStoryDirective"));
  const returnToEntranceBlock = page.slice(page.indexOf("const returnToEntrance"), page.indexOf("const startDesktopPetMode"));
  assert.match(page, /const dismissDesktopPetSurface = useCallback/);
  assert.match(enterWorldBlock, /await dismissDesktopPetSurface\(\)/);
  assert.match(returnToEntranceBlock, /await dismissDesktopPetSurface\(\)/);
  assert.match(page, /if \(window\.cpDanceDesktop\) return;[\s\S]*void dismissDesktopPetSurface\(\)/);
  const projectSurfaceBlock = engine.slice(engine.indexOf("export function projectRuntimeSurface"), engine.indexOf("function nearestSpatialAgent"));
  assert.doesNotMatch(projectSurfaceBlock, /running:/);
  const pullDesktopBlock = page.slice(page.indexOf("const pullDesktopState"), page.indexOf("const wizardSteps"));
  assert.doesNotMatch(pullDesktopBlock, /persistSave|createWorldSave|syncCharactersFromWorld/);
  assert.match(pullDesktopBlock, /SET_SURFACE.*surface: "web"/);
  assert.match(page, /desktop-transfer-placeholder/);
  assert.match(page, /DISMISS_DESKTOP_ATTENTION/);
  assert.match(page, /开始 Agent 自主交互/);
  assert.match(page, /停止 Agent 自主交互/);
  assert.match(page, /请先停止 Agent 自主交互/);
  assert.match(page, /disabled=\{state\.running \|\| agentTurnBusy \|\| directorBusy \|\| compactorBusy\}/);
  assert.match(page, /Story Context Compactor/);
  assert.match(page, /storyPublicEvents: comparable\.storyPublicEvents/);
  assert.match(desktopSurface, /activeAgentDialogue/);
  assert.match(desktopSurface, /startsWith\("event-agent-"\)/);
  assert.match(desktopSurface, /consumedDialogueKeys/);
  assert.doesNotMatch(desktopSurface, /if \(state\.running\) return "walk"/);
  assert.match(engine, /event-asset-ready-/);
  assert.match(engine, /获得了新的动作表情/);
  assert.match(engine, /是否以及何时使用，仍由该角色自己的 Character Agent/);
  assert.match(modelProvider, /桌面公开事件需要该角色独立感知/);
  assert.match(relationshipGraph, /onPointerMove/);
  assert.match(relationshipGraph, /aToB/);
  assert.match(relationshipGraph, /bToA/);
  assert.match(relationshipGraph, /共同经历/);
  assert.match(relationshipGraph, /一个人无需关系连线/);
  assert.match(relationshipGraph, /LIVE CAST \/ INTERACTION PREVIEW/);
  assert.match(relationshipGraph, /interactionScenes/);
  assert.match(relationshipGraph, /previewScene\.left/);
  assert.match(relationshipGraph, /previewScene\.right/);
  assert.match(relationshipGraph, /scene-\$\{previewScene\.kind\}/);
  assert.match(relationshipGraph, /facing=\{index === 0 \? "right" : "left"\}/);
  assert.match(relationshipGraph, /动作预览不代表预设同意/);
  assert.doesNotMatch(relationshipGraph, /relationship-live-signal/);
  assert.doesNotMatch(relationshipGraph, /桌宠/);
  assert.match(forge, /通过真实 Agent 制作角色/);
  assert.match(forge, /IMAGE AGENT/);
  assert.match(forge, /明确使用本地预览继续/);
  assert.match(forge, /本次未自动降级，也未保存新的角色动作/);
  assert.doesNotMatch(forge, /桌宠|PIXEL PET|Pixel Pet/);
  assert.match(engine, /phase: "onboarding"/);
  assert.match(engine, /agents: \[\]/);
  assert.match(engine, /relationshipDrafts/);
  assert.match(engine, /SET_RELATIONSHIP_DRAFT/);
  assert.match(engine, /state\.agents\.length < 1/);
  assert.match(engine, /advanceSoloNatural/);
  assert.match(engine, /ENTER_TOWN/);
  assert.match(engine, /ADD_SAVED_AGENT/);
  assert.match(engine, /addSavedAgent/);
  assert.match(engine, /directions:/);
  assert.match(engine, /RelationshipDirection/);
  assert.match(engine, /SocialProposal/);
  assert.match(engine, /SocialResponse/);
  assert.match(engine, /respondToProposal/);
  assert.match(engine, /CharacterSpatialState/);
  assert.match(engine, /resolveSpatialInteraction/);
  assert.match(engine, /resolveCharacterAgentSpatialInteraction/);
  assert.match(engine, /requiresMutualFacing/);
  assert.match(engine, /facePairTowardEachOther/);
  assert.match(engine, /moveToward/);
  assert.match(engine, /moveAway/);
  assert.match(engine, /confirmedContact/);
  assert.match(engine, /duoStageActions/);
  assert.match(engine, /refreshBystanderPerception/);
  assert.match(engine, /intent: "cuddle"/);
  assert.match(engine, /intent: "retreat"/);
  assert.match(engine, /明确允许靠近并轻轻贴贴/);
  assert.doesNotMatch(engine, /canUseMode|BackgroundGenerationRequest|RETURN_TO_NATURAL|APPLY_DIRECTOR_MODEL_SCENE/);
  assert.match(engine, /ExperienceMode = "natural" \| "story"/);
  assert.match(engine, /APPLY_DIRECTOR_DECISION/);
  assert.match(engine, /Director Agent 只能投放公开世界事实/);
  assert.match(engine, /validateCharacterPair/);
  assert.match(engine, /duoValidation/);
  assert.match(engine, /renderScale/);
  assert.match(engine, /advanceInteractionSession/);
  assert.match(engine, /moveTowardSessionTarget/);
  assert.match(engine, /fineAlignSessionPair/);
  assert.match(engine, /SESSION_MOVE_STEP/);
  assert.match(engine, /所需根节点修正超过允许范围/);
  assert.match(engine, /interactionSession: null/);
  assert.match(duoInteraction, /cp-dance\/interaction-rig\/v1/);
  assert.match(duoInteraction, /validateDuoInteraction/);
  assert.match(duoInteraction, /heightDifferencePercent/);
  assert.match(duoInteraction, /contactPair/);
  assert.match(duoInteraction, /residualContactError/);
  assert.match(duoInteraction, /eye_contact/);
  assert.match(duoInteraction, /perfect.*acceptable.*invalid/s);
  assert.match(duoInteraction, /head_touch/);
  assert.match(duoInteraction, /joint_walk/);
  assert.match(interactionSession, /cp-dance\/interaction-session\/v1/);
  assert.match(interactionSession, /prepare.*contact_start.*contact_hold.*contact_end.*recover/s);
  assert.match(actionUnit, /pixel-pet\/action-unit\/v1/);
  assert.match(actionUnit, /orientation.*approach.*contact.*sustained/s);
  assert.match(actionUnit, /keyframeRigs/);
  assert.match(actionUnit, /maxRootCorrection/);
  assert.match(duoInteraction, /silhouette\.bodyHeight \/ Math\.max\(target\.silhouette\.bodyHeight/);
  assert.doesNotMatch(duoInteraction, /actorContactHeight \/ targetContactHeight/);
  assert.match(engine, /commitCharacterMemory/);
  assert.match(engine, /appendStageHistory/);
  assert.match(engine, /updatePublicDialogue/);
  assert.match(engine, /findCanonRelationship/);
  assert.match(engine, /researchSuggested/);
  assert.match(engine, /pendingQuestions/);
  assert.match(characterMemory, /cp-dance\/character-memory\/v1/);
  assert.match(characterMemory, /roleplayCues/);
  assert.match(characterMemory, /appendRoleplayMemoryCue/);
  assert.match(roleplayProfile, /cp-dance\/character-profile\/v2/);
  assert.match(roleplayProfile, /cp-dance\/relationship-lens\/v1/);
  assert.match(characterReference, /cp-dance\/character-reference-pack\/v1/);
  assert.match(characterReference, /selectedByPlayer/);
  assert.match(characterReference, /findCanonRelationship/);
  assert.match(characterReference, /buildCharacterReferenceContext/);
  assert.match(characterMemory, /现有记忆必须在本次调用读取最新 revision 后才能更新/);
  assert.match(characterMemory, /epistemicStatus/);
  assert.match(characterMemory, /evidenceEventIds/);
  assert.match(engine, /evaluateRelationship/);
  assert.doesNotMatch(engine, /findMilestone|deriveRelationshipActions/);
  assert.match(relationshipEngine, /qualitativeStage/);
  assert.match(relationshipEngine, /rejectionLocks/);
  assert.match(relationshipEngine, /deriveRelationshipCues/);
  assert.match(modelProvider, /buildCharacterAgentTask/);
  assert.match(modelProvider, /buildResponseTasks/);
  assert.match(modelProvider, /Promise\.all|routedIds\.map/);
  assert.match(modelProvider, /knownBoundaries/);
  assert.match(modelProvider, /availablePixelPetActions/);
  assert.match(modelProvider, /selectCharacterMemory/);
  assert.match(modelProvider, /selectAttentionTarget/);
  assert.match(modelProvider, /buildAttentionAgentTask/);
  assert.doesNotMatch(modelProvider, /state\.relationships\[state\.turn/);
  assert.match(modelProvider, /roleplay/);
  assert.match(modelProvider, /messageHistory/);
  assert.match(modelProvider, /publicDialogue/);
  assert.doesNotMatch(modelProvider, /directionalRelationships/);
  assert.match(naturalRuntime, /\/api\/ai\/agent/);
  assert.match(naturalRuntime, /generatePixelPetActionPack/);
  assert.match(naturalRuntime, /desktopExpressiveFallback/);
  assert.match(naturalRuntime, /generatedSemanticIntent/);
  assert.match(naturalRuntime, /shy: "害羞"/);
  assert.match(naturalRuntime, /害羞\|脸红/);
  assert.match(naturalRuntime, /void generatePixelPetActionPack/);
  assert.match(naturalRuntime, /buildAttentionAgentTask/);
  assert.doesNotMatch(naturalRuntime, /await Promise\.all\(\[ensureAnimation/);
  assert.match(naturalRuntime, /RESPOND_TO_INTERACTION_REQUEST|buildResponseTask/);
  assert.match(storyDirectorRuntime, /\/api\/ai\/director/);
  assert.match(directorTypes, /cp-dance\/director-state\/v1/);
  assert.match(directorTypes, /cp-dance\/director-decision\/v1/);
  assert.match(directorRuntime, /cooldownTurns: 4/);
  assert.match(directorRuntime, /shouldInvokeDirector/);
  assert.match(directorRuntime, /parsePlayerDirective/);
  assert.doesNotMatch(directorRuntime, /privateThought|\.memory|relationships/);
  assert.match(agentTypes, /PERCEIVE_AND_DECIDE/);
  assert.match(agentTypes, /RESPOND_TO_INTERACTION_REQUEST/);
  assert.match(agentTypes, /cp-dance\/character-context\/v6/);
  assert.match(agentTypes, /visibleWorldEvents/);
  assert.match(agentTypes, /visibleEntities/);
  assert.match(agentTypes, /CharacterAgentTurnBrief/);
  assert.match(agentTypes, /CharacterAgentCapabilityEnvelope/);
  assert.match(agentTypes, /behaviorActions/);
  assert.match(agentTypes, /requestRequiredActions/);
  assert.match(agentTypes, /blockedActions/);
  assert.match(agentTypes, /characterReference/);
  assert.match(agentTypes, /cp-dance\/public-dialogue\/v1/);
  assert.match(agentTypes, /cp-dance\/group-scene\/v1/);
  assert.match(agentTypes, /AudienceScope/);
  assert.match(agentTypes, /ParticipationIntent/);
  assert.match(engine, /applyGroupAgentTurn/);
  assert.match(engine, /多人场景没有统一关系分/);
  assert.match(aiApi, /addresseeIds/);
  assert.match(aiApi, /身体接触、敏感话题和共享双人动作一次只能指向一个角色/);
  assert.match(agentTypes, /performanceIntent/);
  assert.match(agentTypes, /nonverbalBeat/);
  assert.match(agentTypes, /continueScene/);
  assert.match(agentTypes, /memoryProposal/);
  assert.match(aiApi, /Character Profile v2/);
  assert.match(aiApi, /\[固定宪法 \/ IDENTITY_AND_AUTHORITY\]/);
  assert.match(aiApi, /\[回合决策协议 \/ TURN_PROTOCOL\]/);
  assert.match(aiApi, /\[能力边界 \/ CAPABILITY_BOUNDARY\]/);
  assert.match(aiApi, /行为能力与视觉素材严格分离/);
  assert.doesNotMatch(aiApi, /若 Stage attentionReason 表示玩家把两个角色拖近/);
  assert.match(aiApi, /任何拖拽、距离变化、点击或表层信息都只能作为本回合 Stage 中的公开情境判断/);
  assert.match(aiApi, /generatableExpressions/);
  assert.match(modelProvider, /控制者仍是这个角色自己的 Character Agent/);
  assert.match(modelProvider, /素材生成服务只会异步制作视觉资源，不参与行为决策/);
  assert.match(page, /开始 Agent 自主交互/);
  assert.match(page, /切到桌宠展示/);
  assert.doesNotMatch(page, /由桌宠 Agent 接管/);
  assert.match(modelProvider, /pixelPetActionCatalog/);
  assert.match(agentTypes, /animationCatalog/);
  assert.match(aiApi, /Stage\.capabilities\.animationCatalog/);
  assert.match(modelProvider, /buildTurnBrief/);
  assert.match(modelProvider, /stageCapabilities/);
  assert.match(runtime, /label\.includes\(name\)/);
  assert.match(aiApi, /Character Reference Pack/);
  assert.match(aiApi, /roleplayMemory/);
  assert.match(agentTypes, /requested.*generating.*validating.*ready.*failed.*deprecated/s);
  assert.match(assetProvider, /PixelPetAgentProvider/);
  assert.match(assetProvider, /forgePet/);
  assert.match(assetProvider, /BackgroundAssetAgentProvider/);
  assert.match(assetProvider, /resolveBackground/);
  assert.match(assetProvider, /generateBackground/);
  assert.match(backgroundAssets, /cp-dance\/background-catalog\/v1/);
  assert.match(backgroundAssets, /cp-dance\/background-world-index\/v1/);
  assert.match(backgroundAssets, /buildGeneratedBackgroundFilename/);
  assert.match(backgroundApi, /\/api\/ai\/background/);
  assert.match(backgroundApi, /images\/generations/);
  assert.match(backgroundApi, /explicitGenerationConsent/);
  assert.match(backgroundApi, /autoGenerationOnMiss: true/);
  assert.match(backgroundApi, /generationTriggered: true/);
  assert.match(backgroundApi, /cp_dance_background_assets/);
  assert.match(backgroundApi, /cp_dance_world_background_assets/);
  assert.match(backgroundRuntime, /operation: "resolve"/);
  assert.doesNotMatch(backgroundRuntime, /operation: "generate"/);
  assert.match(backgroundRuntime, /"reused" \| "generated" \| "no-match"/);
  assert.equal(JSON.parse(backgroundCatalog).assets.length, 0);
  assert.match(pixelPet, /pixel-pet\/v1/);
  assert.match(pixelPet, /front-three-quarter-v1/);
  assert.match(pixelPet, /front-three-quarter-v2/);
  assert.match(pixelPet, /PIXEL_PET_SPRITE_NORMALIZATION_VERSION/);
  assert.match(pixelPet, /needsSpriteSheetRepair/);
  assert.match(pixelPet, /safeFacingFrames/);
  assert.match(pixelPet, /facingFrames/);
  assert.match(pixelPet, /idle:/);
  assert.match(pixelPet, /walk:/);
  assert.match(pixelPet, /wave:/);
  assert.match(pixelPet, /cry:/);
  assert.match(pixelPet, /love:/);
  assert.match(pixelPet, /shy:/);
  assert.match(pixelPet, /angry:/);
  assert.match(pixelPet, /talk:/);
  assert.match(pixelPet, /listen:/);
  assert.match(pixelPet, /mergePixelPetActionPacks/);
  assert.match(pixelPet, /mergePolicy: "append-only"/);
  assert.match(pixelPet, /PixelPetForgeSnapshot/);
  assert.match(pixelPet, /createPixelPetForgeSnapshot/);
  assert.match(pixelPet, /restorePreviousPixelPetForge/);
  assert.match(pixelPet, /previousForge: null/);
  assert.match(pixelPet, /interactionRig/);
  assert.match(pixelPet, /PIXEL_PET_PRESETS: readonly PixelPetPreset\[\] = \[\]/);
  assert.match(forge, /pet-preset-list/);
  assert.match(forge, /INCREMENTAL ACTION AGENT/);
  assert.match(forge, /开源仓库不附带角色预设/);
  assert.match(forge, /回滚到上次制作/);
  assert.match(forge, /rollbackForge/);
  assert.match(forge, /双角色互动/);
  assert.match(forge, /前景识别智能修复/);
  assert.match(runtime, /buildFallbackMotionSheet/);
  assert.match(runtime, /analyzePixelPetSpriteSheet/);
  assert.match(runtime, /createDesktopPetRuntimeSnapshot/);
  assert.match(runtime, /generatePixelPetActionPack/);
  assert.match(runtime, /facingFrames/);
  assert.match(runtime, /orientationCoverage/);
  assert.match(runtime, /BASE_ORIENTATION_GROUPS/);
  assert.match(runtime, /normalizeGeneratedActionSheet/);
  assert.match(runtime, /normalizeGeneratedBaseSheet/);
  assert.match(normalizer, /normalizeForegroundAwareSpriteSheet/);
  assert.match(normalizer, /segmentSpriteFrames/);
  assert.match(normalizer, /frameCompleteness/);
  assert.match(normalizer, /repairExistingSpriteSheet/);
  assert.match(segmentation, /findAdaptiveEdges/);
  assert.match(segmentation, /labelForeground/);
  assert.match(segmentation, /componentIds/);
  assert.doesNotMatch(normalizer, /sourceCellWidth|sourceCellHeight/);
  assert.doesNotMatch(runtime, /targetRatio|sourceRatio/);
  assert.match(runtime, /getPixelPetImageAgentStatus/);
  assert.match(runtime, /export async function forgePixelPetFallback/);
  const primaryForge = runtime.slice(runtime.indexOf("export async function forgePixelPet(input"), runtime.indexOf("export async function forgePixelPetFallback"));
  assert.doesNotMatch(primaryForge, /buildFallbackMotionSheet|local-fallback|catch \(/);
  assert.match(runtime, /actionDiversity/);
  assert.match(runtime, /uniquePoseCount/);
  assert.match(runtime, /analyzeInteractionRig/);
  assert.match(runtime, /keyframeRigs/);
  assert.match(runtime, /contact_start/);
  assert.doesNotMatch(runtime, /directorAvailable|pausedForWebStory|storySeedCount/);
  assert.match(runtime, /spatial: state\.spatial/);
  assert.match(sprite, /--pet-frame-x/);
  assert.match(sprite, /InteractivePixelPetPlayground/);
  assert.match(sprite, /onPointerMove/);
  assert.match(sprite, /onDoubleClick/);
  assert.match(sprite, /FRIENDSHIP/);
  assert.match(sprite, /availablePixelPetActions/);
  assert.match(sprite, /facing\?: PixelPetFacing/);
  assert.match(sprite, /hasDirectionalFrames/);
  assert.match(sprite, /strictFacing/);
  assert.match(sprite, /framesForPlaybackPhase/);
  assert.match(page, /ADVANCE_INTERACTION_SESSION/);
  assert.match(page, /id: "interaction-session", label: "空间执行"/);
  assert.match(sprite, /repairExistingSpriteSheet/);
  assert.doesNotMatch(sprite, /FRAME_POSITIONS/);
  assert.match(styles, /pixel-pet-avatar\.facing-left/);
  assert.match(styles, /not\(\.has-directional-frames\)/);
  assert.match(styles, /--pet-sheet-size-y/);
  assert.match(styles, /duo-participant/);
  assert.match(styles, /scene-cuddle/);
  assert.match(styles, /\.stage-dialogue-deck/);
  assert.match(styles, /\.agent-dialogue-card/);
  assert.doesNotMatch(styles, /\.agent-bubble[^-]/);
  assert.match(styles, /\.status-observatory/);
  assert.match(styles, /\.control-asset-menu/);
  assert.match(styles, /interactive-pet-actions[^}]+repeat\(auto-fit, minmax\(62px, 1fr\)\)/);
  assert.match(styles, /interactive-pet-actions button[^}]+white-space: nowrap[^}]+word-break: keep-all/);
  assert.match(styles, /--pet-preview-min: 240px/);
  assert.match(styles, /pet-forge-workspace[^}]+minmax\(var\(--pet-preview-min\), 28%\)/);
  assert.match(styles, /\.forge-run-row[^}]+grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(styles, /\.forge-rollback/);
  assert.doesNotMatch(styles, /\.public-dialogue-rail/);
  assert.match(styles, /\.event-entry\[open\] \.event-copy em[^}]+overflow: visible/);
  assert.match(styles, /event-detail blockquote p[^}]+font-size: 13px/);
  assert.doesNotMatch(sprite, /桌宠|Pixel Pet/);
  assert.match(worldSave, /pixelkin-world-saves-v1/);
  assert.match(worldSave, /buildMemoryIndex/);
  assert.match(worldSave, /unresolvedThreads/);
  assert.match(worldSave, /upsertWorldSave/);
  assert.match(worldSave, /projectRuntimeSurface/);
  assert.match(characterSave, /pixelkin-character-saves-v1/);
  assert.match(characterSave, /buildCharacterMemoryIndex/);
  assert.match(characterSave, /migrateCharactersFromWorlds/);
  assert.match(characterSave, /syncCharactersFromWorld/);
  assert.match(layout, /CP 跳动/);
  assert.match(packageJson, /desktop:dev/);
  assert.match(packageJson, /desktop:test/);
  assert.match(architecture, /自然模式/);
  assert.match(architecture, /Scheduler|调度/);
  assert.match(architecture, /Character Agent/);
  assert.match(architecture, /行为意图与单人动作/);
  assert.match(architecture, /双人动作、面对面与位置控制/);
  assert.match(architecture, /conversation.*talk \+ listen.*胸↔胸/s);
  assert.match(handoff, /项目交接手册/);
  assert.match(handoff, /同一页面.*可交互动作角色.*实时互动预览.*双向关系网.*自然模式或导演模式/s);
  assert.match(handoff, /Director Agent 与 Story Runtime/);
  assert.match(handoff, /cp-dance\/character-context\/v6/);
  assert.match(handoff, /当前动作、双人编排与方位控制/);
  assert.match(handoff, /idle.*walk.*wave.*cry.*love/s);
  assert.match(handoff, /不是默认翻转/);
  assert.match(handoff, /接触先走到预备距离，再做最多 2–4 个舞台单位的骨骼微调/);
  assert.match(handoff, /prepare.*contact_start.*contact_hold.*contact_end.*recover/s);
  assert.match(handoff, /perfect.*acceptable.*invalid/s);
  assert.match(handoff, /NEWAPI_IMAGE_API_KEY/);
  assert.match(handoff, /Character Agent/);
  assert.match(assetProvider, /PixelPetInteractionCoordinator/);
  assert.match(assetProvider, /extendActions/);
  assert.match(agentConfig, /createAgentRuntimeConfig/);
  assert.match(agentConfig, /NEWAPI_IMAGE_API_KEY/);
  assert.match(agentConfig, /NEWAPI_TEXT_API_KEY/);
  assert.match(agentConfig, /NEWAPI_IMAGE_BASE_URL/);
  assert.match(agentConfig, /NEWAPI_TEXT_BASE_URL/);
  assert.match(agentConfig, /id: "image"/);
  assert.match(agentConfig, /id: "text"/);
  assert.match(agentConfig, /gpt-image-2/);
  assert.match(agentConfig, /deepseek-v4-flash/);
  assert.match(aiApi, /createAgentRuntimeConfig/);
  assert.doesNotMatch(aiApi, /function runtimeConfig|function resolveRuntimeEnv/);
  assert.match(aiApi, /callImageEditModel/);
  assert.match(aiApi, /imageCandidate\(payload\)/);
  assert.match(aiApi, /imageResultShape/);
  assert.doesNotMatch(aiApi, /callChatImageModel|images\/generations/);
  assert.match(aiApi, /chat\/completions/);
  assert.match(aiApi, /4 columns × 5 rows/);
  assert.match(aiApi, /4 columns by 3 rows/);
  assert.match(aiApi, /straight front/);
  assert.match(aiApi, /front three-quarter (?:turned toward|facing) viewer-left/);
  assert.match(aiApi, /front three-quarter (?:turned toward|facing) viewer-right/);
  assert.match(aiApi, /\/api\/ai\/character/);
  assert.match(aiApi, /\/api\/ai\/pet-actions/);
  assert.match(aiApi, /actionExtensionPrompt/);
  assert.match(aiApi, /\/api\/ai\/agent/);
  assert.doesNotMatch(aiApi, /\/api\/ai\/director/);
  assert.match(directorApi, /\/api\/ai\/director/);
  assert.match(directorApi, /不扮演角色，也不控制 Character Agent/);
  assert.match(directorApi, /不得生成角色台词、角色主动动作、私人想法/);
  assert.match(directorApi, /STORY_COMPACTOR_SYSTEM_PROMPT/);
  assert.match(directorApi, /不得续写剧情、设计未来事件、补写因果/);
  assert.match(storyDirectorRuntime, /requestStoryCompaction/);
  assert.match(storyContext, /deterministicStorySummary/);
  assert.match(storyContext, /storyCompactionRequiredBeforeDirector/);
  assert.match(storyContext, /allowFailedRetry/);
  assert.match(page, /advanceWorldRuntime\(true\)/);
  assert.match(page, /重试剧情整理/);
  assert.match(page, /已停止自动重试/);
  assert.match(storyContext, /containsPrivateLeak/);
  assert.match(storyContext, /normalizeStoryContextForHydrate/);
  assert.match(storyContext, /legacy_restore/);
  assert.match(storyContext, /压缩输入不是连续公开事件范围/);
  assert.match(storyContext, /摘要遗漏了未回答问题/);
  assert.match(storyContextTypes, /softTokenLimit: 6000/);
  assert.match(storyContextTypes, /hardTokenLimit: 8000/);
  assert.match(storyContextTypes, /recentRawTokenReserve: 1800/);
  assert.match(storyContextTypes, /directorInputTokenBudget: 12000/);
  assert.match(directorApi, /createAgentRuntimeConfig\(env\)\.text/);
  assert.doesNotMatch(directorApi, /IMAGE_API_KEY|images\/generations|privateMemory/);
  assert.match(researchApi, /\/api\/research\/character\/search/);
  assert.match(researchApi, /\/api\/research\/character\/extract/);
  assert.match(researchApi, /\/api\/research\/character\/distill/);
  assert.match(researchApi, /wbsearchentities/);
  assert.match(researchApi, /不可信资料文本/);
  assert.match(researchApi, /selectedByPlayer/);
  assert.match(researchApi, /extractCharacterReferences/);
  assert.match(researchApi, /distillCharacterProfile/);
  assert.match(researchApi, /suggestCharacterSearchAliases/);
  assert.match(researchApi, /一次最多合并 3 个/);
  assert.match(aiApi, /authorization: `Bearer \$\{config\.apiKey\}`/);
  assert.match(worker, /handleAiApi/);
  assert.match(worker, /handleDirectorApi/);
  assert.match(worker, /handleResearchApi/);
  assert.match(worker, /handleSaveApi/);
  assert.match(saveApi, /\/api\/saves/);
  assert.match(saveApi, /SAVE_ASSETS/);
  assert.match(saveApi, /HttpOnly/);
  assert.match(saveApi, /cp-dance\/\$\{ownerId\}\/assets/);
  assert.match(saveApi, /REVISION_LIMIT = 20/);
  assert.match(saveApi, /externalizeImageAssets/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS pixelkin_saves/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS cp_dance_save_revisions/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS cp_dance_assets/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS cp_dance_memory_documents/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS cp_dance_memory_revisions/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS cp_dance_world_events/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS cp_dance_story_public_events/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS cp_dance_story_summary_revisions/);
  assert.match(hosting, /"d1": "DB"/);
  assert.match(hosting, /"r2": "SAVE_ASSETS"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(packageJson, /drizzle|tailwind/i);

  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  await assert.rejects(access(new URL("../app/chatgpt-auth.ts", import.meta.url)));
  await access(new URL("../db/schema.ts", import.meta.url));
  await access(new URL("../drizzle/0000_pixelkin_backend_saves.sql", import.meta.url));
  await access(new URL("../drizzle/0001_cp_dance_storage_hardening.sql", import.meta.url));
  await access(new URL("../drizzle/0002_agent_memory_context.sql", import.meta.url));
  await access(new URL("../drizzle/0003_story_context_compaction.sql", import.meta.url));
  await assert.rejects(access(new URL("../examples/d1/db/schema.ts", import.meta.url)));
  await access(new URL("../public/pixel-pet/README.md", import.meta.url));
  await assert.rejects(access(new URL("../public/pixel-pet/dino-reference.png", import.meta.url)));
  await assert.rejects(access(new URL("../public/pixel-pet/characters/pink-bow-idol/sprite-sheet.png", import.meta.url)));
  await assert.rejects(access(new URL("../public/pixel-pet/interactions/pink-violet/social-duo-v1.png", import.meta.url)));
});
