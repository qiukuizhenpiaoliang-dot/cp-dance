import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

test("an uncovered player directive stays pinned without trapping compaction in an automatic retry loop", async (context) => {
  const outputDir = await mkdtemp(join(tmpdir(), "cp-story-context-"));
  context.after(() => rm(outputDir, { recursive: true, force: true }));
  const outputFile = join(outputDir, "story-context.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("../lib/story-context.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: outputFile,
    logLevel: "silent",
  });
  const runtime = await import(`${pathToFileURL(outputFile).href}?test=${Date.now()}`);

  const opening = {
    schema: "cp-dance/story-public-event/v1",
    eventId: "event-opening",
    turn: 0,
    sceneId: "story-room",
    beatId: "beat-01",
    source: "director",
    type: "script",
    publicContent: "故事在共享房间公开开始。",
    participants: [],
    visibleTo: [],
    createdAt: "2026-07-22T00:00:00.000Z",
  };
  const directive = {
    schema: "cp-dance/story-public-event/v1",
    eventId: "directive-01",
    turn: 1,
    sceneId: "story-room",
    beatId: "beat-01",
    source: "player",
    type: "player_directive:plot_guidance",
    publicContent: "下一段剧情围绕失踪的钥匙展开。",
    participants: [],
    visibleTo: [],
    createdAt: "2026-07-22T00:01:00.000Z",
  };
  const events = [opening, directive];
  const state = {
    worldId: "world-loop-test",
    mode: "story",
    turn: 1,
    agents: [],
    events: [],
    scene: { id: "story-room" },
    interactionSession: null,
    publicDialogue: { pendingQuestions: [] },
    worldEntities: [],
    storyScene: { sceneId: "story-room" },
    director: {
      currentBeatId: "beat-01",
      beats: [],
      completedEvidence: [],
      outlineRevision: 1,
      pendingDirectives: [{ id: "directive-01", type: "plot_guidance", text: directive.publicContent, createdTurn: 1, status: "pending" }],
    },
    storyPublicEvents: events,
    storySummaryRevisions: [],
    storyContextRuntime: {
      ...runtime.createStoryContextRuntime(events),
      compactionStatus: "requested",
      pendingReasons: ["outline_replan"],
    },
  };

  const task = runtime.buildStoryCompactionTask(state);
  assert.ok(task);
  assert.deepEqual(task.sourceEvents.map((event) => event.eventId), ["event-opening"]);
  assert.deepEqual(task.pinnedContext.pendingPlayerDirectives.map((item) => item.id), ["directive-01"]);

  const summary = runtime.deterministicStorySummary(task);
  assert.deepEqual(summary.playerDirectives, []);
  const compacting = runtime.beginStoryCompaction(state, task);
  const committed = runtime.commitStoryCompaction(compacting, summary, true);
  assert.equal(committed.storyContextRuntime.compactionStatus, "idle");
  assert.deepEqual(committed.storyContextRuntime.pendingReasons, []);
  assert.equal(runtime.storyCompactionRequiredBeforeDirector(committed), false);
  assert.deepEqual(runtime.buildPinnedStoryContext(committed).pendingPlayerDirectives.map((item) => item.id), ["directive-01"]);
  assert.deepEqual(runtime.selectRecentStoryEvents(committed).map((event) => event.eventId), ["directive-01"]);

  const failed = runtime.failStoryCompaction(compacting, "test failure");
  assert.equal(runtime.storyCompactionReady(failed), false);
  assert.equal(runtime.storyCompactionReady(failed, true), true);
});
