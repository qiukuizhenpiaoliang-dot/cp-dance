import type { ChronicleEvent, GameAction, GameState } from "./agent-engine";
import {
  STORY_COMPACTION_LIMITS,
  STORY_CONTEXT_RUNTIME_SCHEMA,
  STORY_CONTEXT_SUMMARY_SCHEMA,
  STORY_PUBLIC_EVENT_SCHEMA,
  type StoryCompactionReason,
  type StoryCompactionTask,
  type StoryContextRuntime,
  type StoryContextSummary,
  type StoryPinnedContext,
  type StoryPublicEvent,
  type StorySummaryScope,
} from "./story-context-types";

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function nowIso() {
  return new Date().toISOString();
}

function runtimeId(prefix: string) {
  const suffix = typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

export function estimateStoryText(value: unknown) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const bytes = new TextEncoder().encode(serialized).byteLength;
  return { bytes, tokens: Math.max(1, Math.ceil(bytes / 3)) };
}

function sourceForChronicle(event: ChronicleEvent): StoryPublicEvent["source"] {
  if (event.kind === "script" || event.id.startsWith("event-director-")) return "director";
  if (event.kind === "daily" || event.id.startsWith("event-agent-")) return "character";
  return "runtime";
}

function contentForChronicle(event: ChronicleEvent) {
  return [
    event.title,
    event.summary,
    ...event.dialogue.map((line) => `${line.speaker}：“${line.text}”`),
    event.impact,
  ].filter(Boolean).join("\n").slice(0, 4000);
}

export function storyPublicEventFromChronicle(
  event: ChronicleEvent,
  turn: number,
  beatId: string,
  createdAt = nowIso(),
): StoryPublicEvent {
  return {
    schema: STORY_PUBLIC_EVENT_SCHEMA,
    eventId: event.id,
    turn,
    sceneId: event.sceneId,
    beatId,
    source: sourceForChronicle(event),
    type: event.kind,
    publicContent: contentForChronicle(event),
    participants: unique(event.actorIds),
    visibleTo: unique(event.actorIds),
    createdAt,
  };
}

export function storyPublicEventFromDirective(state: GameState, action: Extract<GameAction, { type: "QUEUE_PLAYER_DIRECTIVE" }>): StoryPublicEvent {
  return {
    schema: STORY_PUBLIC_EVENT_SCHEMA,
    eventId: action.directive.id,
    turn: state.turn,
    sceneId: state.storyScene?.sceneId || state.scene.id,
    beatId: state.director?.currentBeatId || "",
    source: "player",
    type: `player_directive:${action.directive.type}`,
    publicContent: action.directive.text,
    participants: [],
    visibleTo: [],
    createdAt: nowIso(),
  };
}

export function createStoryContextRuntime(events: StoryPublicEvent[] = []): StoryContextRuntime {
  const metrics = estimateStoryText(events);
  return {
    schema: STORY_CONTEXT_RUNTIME_SCHEMA,
    sceneSummaryRevisionIds: [],
    beatSummaryRevisionIds: [],
    uncompactedEventIds: events.map((event) => event.eventId),
    estimatedUncompactedTokens: metrics.tokens,
    estimatedUncompactedBytes: metrics.bytes,
    lastCompactedTurn: 0,
    compactionStatus: "idle",
    pendingReasons: [],
    pendingSourceEventIds: [],
    pendingAllowedSourceEventIds: [],
    deterministicFallbackCount: 0,
  };
}

function validPublicEvent(value: unknown): value is StoryPublicEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<StoryPublicEvent>;
  return event.schema === STORY_PUBLIC_EVENT_SCHEMA && typeof event.eventId === "string" && typeof event.publicContent === "string" && typeof event.sceneId === "string";
}

function validSummaryShape(value: unknown): value is StoryContextSummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as Partial<StoryContextSummary>;
  return summary.schema === STORY_CONTEXT_SUMMARY_SCHEMA
    && typeof summary.revisionId === "string"
    && typeof summary.summaryId === "string"
    && typeof summary.coveredThroughEventId === "string"
    && Array.isArray(summary.sourceEventIds)
    && Array.isArray(summary.objectiveFacts)
    && Array.isArray(summary.unresolvedThreads);
}

function uncoveredEvents(events: StoryPublicEvent[], coveredThroughEventId?: string) {
  if (!coveredThroughEventId) return events;
  const index = events.findIndex((event) => event.eventId === coveredThroughEventId);
  return index < 0 ? events : events.slice(index + 1);
}

function metricsForRuntime(events: StoryPublicEvent[], coveredThroughEventId?: string) {
  const tail = uncoveredEvents(events, coveredThroughEventId);
  const metrics = estimateStoryText(tail);
  return { tail, ...metrics };
}

export function normalizeStoryContextForHydrate(input: {
  rawEvents?: unknown;
  rawSummaries?: unknown;
  rawRuntime?: unknown;
  chronicleEvents: ChronicleEvent[];
  currentBeatId: string;
  turn: number;
  createdAt?: string | null;
  privateFragments?: string[];
}) {
  const rawPublicEvents = Array.isArray(input.rawEvents) ? input.rawEvents.filter(validPublicEvent) : [];
  const fallbackEvents = [...input.chronicleEvents].reverse().map((event) => storyPublicEventFromChronicle(event, input.turn, input.currentBeatId, input.createdAt || nowIso()));
  const storyPublicEvents = rawPublicEvents.length ? rawPublicEvents : fallbackEvents;
  const eventIds = new Set(storyPublicEvents.map((event) => event.eventId));
  const rawSummaries = Array.isArray(input.rawSummaries) ? input.rawSummaries.filter(validSummaryShape) : [];
  const summaries: StoryContextSummary[] = [];
  let latestStable: StoryContextSummary | null = null;
  const publicCorpus = storyPublicEvents.map((event) => event.publicContent).join("\n");
  for (const summary of rawSummaries) {
    const serialized = JSON.stringify(summary);
    if ((input.privateFragments || []).some((fragment) => fragment.length >= 12 && !publicCorpus.includes(fragment) && serialized.includes(fragment))) continue;
    if (!summary.sourceEventIds.every((id) => eventIds.has(id)) || !eventIds.has(summary.coveredThroughEventId)) continue;
    if (summary.scope === "story" && (summary.baseRevisionId || undefined) !== (latestStable?.revisionId || undefined)) continue;
    summaries.push(summary);
    if (summary.scope === "story") latestStable = summary;
  }
  const latest = latestStable;
  const metrics = metricsForRuntime(storyPublicEvents, latest?.coveredThroughEventId);
  const rawRuntime = input.rawRuntime && typeof input.rawRuntime === "object" ? input.rawRuntime as Partial<StoryContextRuntime> : {};
  const legacyRestore = storyPublicEvents.length > 0 && !latest;
  const hard = metrics.tokens >= STORY_COMPACTION_LIMITS.hardTokenLimit || metrics.bytes >= STORY_COMPACTION_LIMITS.hardByteLimit;
  const soft = metrics.tokens >= STORY_COMPACTION_LIMITS.softTokenLimit || metrics.bytes >= STORY_COMPACTION_LIMITS.softByteLimit;
  const pendingReasons = unique<StoryCompactionReason>([
    ...(legacyRestore ? ["legacy_restore" as const] : []),
    ...(hard ? ["hard_limit" as const] : soft ? ["soft_limit" as const] : []),
  ]);
  const runtime: StoryContextRuntime = {
    ...createStoryContextRuntime(storyPublicEvents),
    ...rawRuntime,
    schema: STORY_CONTEXT_RUNTIME_SCHEMA,
    currentStableSummaryRevisionId: latest?.revisionId,
    coveredThroughEventId: latest?.coveredThroughEventId,
    sceneSummaryRevisionIds: Array.isArray(rawRuntime.sceneSummaryRevisionIds) ? rawRuntime.sceneSummaryRevisionIds.filter((id): id is string => typeof id === "string" && summaries.some((summary) => summary.revisionId === id)) : [],
    beatSummaryRevisionIds: Array.isArray(rawRuntime.beatSummaryRevisionIds) ? rawRuntime.beatSummaryRevisionIds.filter((id): id is string => typeof id === "string" && summaries.some((summary) => summary.revisionId === id)) : [],
    uncompactedEventIds: metrics.tail.map((event) => event.eventId),
    estimatedUncompactedTokens: metrics.tokens,
    estimatedUncompactedBytes: metrics.bytes,
    compactionStatus: pendingReasons.length ? "requested" : "idle",
    pendingReasons,
    pendingSourceEventIds: [],
    pendingAllowedSourceEventIds: [],
    pendingBaseRevisionId: latest?.revisionId,
    pendingRequestedRevisionId: undefined,
    deterministicFallbackCount: Math.max(0, Number(rawRuntime.deterministicFallbackCount) || 0),
  };
  return { storyPublicEvents, storySummaryRevisions: summaries, storyContextRuntime: runtime };
}

export function buildPinnedStoryContext(state: GameState): StoryPinnedContext {
  const currentBeat = state.director?.beats.find((beat) => beat.id === state.director?.currentBeatId);
  const unansweredQuestions = state.publicDialogue.pendingQuestions.filter((question) => question.status === "open").map((question) => ({
    id: question.id,
    text: question.text,
    fromAgentId: question.fromAgentId,
    toAgentId: question.toAgentId,
  }));
  const activeRequests = state.interactionSession ? [{
    id: state.interactionSession.id,
    description: `${state.interactionSession.kind} · ${state.interactionSession.phase}`,
    participantIds: [state.interactionSession.initiatorId, state.interactionSession.receiverId],
  }] : [];
  const activeWorldEntities = state.worldEntities.map((entity) => ({ id: entity.id, type: entity.type, description: entity.description, state: entity.state }));
  const storyEvents = state.events.filter((event) => event.mode === "story").slice(0, 8);
  return {
    unansweredQuestions,
    activeRequests,
    activeWorldEntities,
    publicCharacterStatuses: storyEvents.map((event) => event.impact).filter(Boolean),
    unresolvedClues: state.worldEntities.filter((entity) => entity.type === "clue" && entity.state.resolved !== true).map((entity) => ({ id: entity.id, description: entity.description })),
    pendingPlayerDirectives: (state.director?.pendingDirectives || []).filter((directive) => directive.status === "pending").map((directive) => ({ id: directive.id, type: directive.type, text: directive.text, status: directive.status })),
    currentBeatConditions: [
      ...(currentBeat?.entryConditions || []).map((text) => ({ kind: "entry" as const, text, runtimeStatus: state.director?.completedEvidence.includes(text) ? "completed" as const : "pending" as const })),
      ...(currentBeat?.completionConditions || []).map((text) => ({ kind: "completion" as const, text, runtimeStatus: state.director?.completedEvidence.includes(text) ? "completed" as const : "pending" as const })),
    ],
  };
}

function latestStableSummary(state: GameState) {
  const id = state.storyContextRuntime?.currentStableSummaryRevisionId;
  return id ? state.storySummaryRevisions.find((summary) => summary.revisionId === id) || null : null;
}

function reserveRecentEvents(events: StoryPublicEvent[]) {
  const selected: StoryPublicEvent[] = [];
  let tokens = 0;
  for (let index = events.length - 1; index >= 0 && selected.length < STORY_COMPACTION_LIMITS.recentRawBeatReserve; index -= 1) {
    const eventTokens = estimateStoryText(events[index]).tokens;
    if (selected.length && tokens + eventTokens > STORY_COMPACTION_LIMITS.recentRawTokenReserve) break;
    selected.unshift(events[index]);
    tokens += eventTokens;
  }
  return selected;
}

export function selectRecentStoryEvents(state: GameState) {
  const tail = uncoveredEvents(state.storyPublicEvents, state.storyContextRuntime?.coveredThroughEventId);
  const metrics = estimateStoryText(tail);
  const withinSoftBudget = metrics.tokens < STORY_COMPACTION_LIMITS.softTokenLimit && metrics.bytes < STORY_COMPACTION_LIMITS.softByteLimit;
  return withinSoftBudget ? tail : reserveRecentEvents(tail);
}

function nextCompactionReason(state: GameState): StoryCompactionReason | null {
  const reasons = state.storyContextRuntime?.pendingReasons || [];
  return (["legacy_restore", "outline_replan", "hard_limit", "scene_transition", "beat_completed", "soft_limit", "manual"] as StoryCompactionReason[]).find((reason) => reasons.includes(reason)) || null;
}

function selectCompactionSourceEvents(state: GameState, reason: StoryCompactionReason) {
  const tail = uncoveredEvents(state.storyPublicEvents, state.storyContextRuntime?.coveredThroughEventId);
  if (!tail.length) return [];
  const recentIds = new Set(reserveRecentEvents(tail).map((event) => event.eventId));
  if (reason === "scene_transition") {
    const activeScene = state.storyScene?.sceneId || state.scene.id;
    const boundary = tail.findIndex((event) => event.sceneId === activeScene);
    const closed = boundary < 0 ? tail : tail.slice(0, boundary);
    if (closed.length) return closed;
  }
  if (reason === "beat_completed") {
    const activeBeat = state.director?.currentBeatId || "";
    const boundary = tail.findIndex((event) => event.beatId === activeBeat);
    const completed = (boundary < 0 ? tail : tail.slice(0, boundary)).filter((event) => event.beatId);
    if (completed.length) return completed;
  }
  const selected = tail.filter((event) => !recentIds.has(event.eventId));
  if (selected.length) return selected;
  if (["legacy_restore", "outline_replan", "hard_limit", "scene_transition", "beat_completed", "manual"].includes(reason)) return tail.length > 1 ? tail.slice(0, -1) : tail;
  return [];
}

export function buildStoryCompactionTask(state: GameState, forcedReason?: StoryCompactionReason): StoryCompactionTask | null {
  if (state.mode !== "story" || !state.director) return null;
  const reason = forcedReason || nextCompactionReason(state);
  if (!reason) return null;
  const sourceEvents = selectCompactionSourceEvents(state, reason);
  if (!sourceEvents.length) return null;
  const baseSummary = latestStableSummary(state);
  const revisionId = runtimeId("story-summary-r");
  return {
    taskType: "compact_story",
    worldId: state.worldId,
    turn: state.turn,
    reason,
    baseSummary,
    sourceEvents,
    pinnedContext: buildPinnedStoryContext(state),
    runtimeDeterminations: {
      completedBeatConditions: state.director.completedEvidence,
      invalidatedBeatConditions: [],
      activeSceneId: state.storyScene?.sceneId || state.scene.id,
      activeBeatId: state.director.currentBeatId,
      outlineRevision: state.director.outlineRevision,
    },
    requestedRevisionId: revisionId,
    requestedSummaryId: baseSummary?.summaryId || runtimeId("story-summary"),
    targetTokens: STORY_COMPACTION_LIMITS.stableSummaryTargetTokens,
  };
}

export function shrinkStoryCompactionTask(task: StoryCompactionTask): StoryCompactionTask {
  if (task.sourceEvents.length <= 1) return task;
  const firstSceneId = task.sourceEvents[0].sceneId;
  const firstScene = task.sourceEvents.filter((event) => event.sceneId === firstSceneId);
  const maximum = Math.max(1, Math.ceil(task.sourceEvents.length / 2));
  const sourceEvents = (firstScene.length && firstScene.length < task.sourceEvents.length ? firstScene : task.sourceEvents.slice(0, maximum))
    .slice(0, Math.max(1, maximum));
  return { ...task, sourceEvents };
}

export function storyCompactionRequiredBeforeDirector(state: GameState) {
  if (state.mode !== "story" || !state.storyContextRuntime) return false;
  const runtime = state.storyContextRuntime;
  const hard = runtime.estimatedUncompactedTokens >= STORY_COMPACTION_LIMITS.hardTokenLimit || runtime.estimatedUncompactedBytes >= STORY_COMPACTION_LIMITS.hardByteLimit;
  return hard || runtime.pendingReasons.some((reason) => reason === "legacy_restore" || reason === "outline_replan" || reason === "hard_limit");
}

export function storyCompactionReady(state: GameState, allowFailedRetry = false) {
  if (state.mode !== "story" || !state.storyContextRuntime || state.interactionSession) return false;
  if (state.storyContextRuntime.compactionStatus === "failed" && !allowFailedRetry) return false;
  if (!["requested", "failed"].includes(state.storyContextRuntime.compactionStatus)) return false;
  return Boolean(buildStoryCompactionTask(state));
}

function recalculateRuntime(state: GameState, runtime: StoryContextRuntime, events: StoryPublicEvent[], summaries: StoryContextSummary[], addedReasons: StoryCompactionReason[] = []) {
  const latest = summaries.find((summary) => summary.revisionId === runtime.currentStableSummaryRevisionId) || summaries.at(-1) || null;
  const metrics = metricsForRuntime(events, latest?.coveredThroughEventId);
  const hard = metrics.tokens >= STORY_COMPACTION_LIMITS.hardTokenLimit || metrics.bytes >= STORY_COMPACTION_LIMITS.hardByteLimit;
  const soft = metrics.tokens >= STORY_COMPACTION_LIMITS.softTokenLimit || metrics.bytes >= STORY_COMPACTION_LIMITS.softByteLimit;
  const pendingReasons = unique<StoryCompactionReason>([
    ...runtime.pendingReasons,
    ...addedReasons,
    ...(hard ? ["hard_limit" as const] : soft ? ["soft_limit" as const] : []),
  ]);
  return {
    ...runtime,
    currentStableSummaryRevisionId: latest?.revisionId,
    coveredThroughEventId: latest?.coveredThroughEventId,
    uncompactedEventIds: metrics.tail.map((event) => event.eventId),
    estimatedUncompactedTokens: metrics.tokens,
    estimatedUncompactedBytes: metrics.bytes,
    pendingReasons,
    compactionStatus: pendingReasons.length && runtime.compactionStatus === "idle" ? "requested" as const : runtime.compactionStatus,
  };
}

export function reconcileStoryContext(previous: GameState, next: GameState, action: GameAction): GameState {
  if (next.mode !== "story" || !next.director) return next;
  const previousIds = new Set((next.storyPublicEvents || []).map((event) => event.eventId));
  const newChronicleEvents = [...next.events].reverse().filter((event) => event.mode === "story" && !previousIds.has(event.id));
  const storyPublicEvents = [...(next.storyPublicEvents || [])];
  for (const event of newChronicleEvents) {
    storyPublicEvents.push(storyPublicEventFromChronicle(event, next.turn, next.director.currentBeatId));
    previousIds.add(event.id);
  }
  if (action.type === "QUEUE_PLAYER_DIRECTIVE" && !previousIds.has(action.directive.id)) storyPublicEvents.push(storyPublicEventFromDirective(next, action));

  const addedReasons: StoryCompactionReason[] = [];
  const sceneTransition = action.type === "APPLY_DIRECTOR_DECISION" && action.decision.decision === "change_scene"
    || previous.mode === "story" && Boolean(previous.storyScene?.sceneId) && (previous.storyScene?.sceneId !== next.storyScene?.sceneId || previous.storyScene?.location !== next.storyScene?.location);
  if (sceneTransition) addedReasons.push("scene_transition");
  if (previous.mode === "story" && previous.director?.currentBeatId && previous.director.currentBeatId !== next.director.currentBeatId) addedReasons.push("beat_completed");
  if (action.type === "QUEUE_PLAYER_DIRECTIVE" && action.directive.type === "plot_guidance") addedReasons.push("outline_replan");

  const baseRuntime = next.storyContextRuntime || createStoryContextRuntime(storyPublicEvents);
  const storySummaryRevisions = next.storySummaryRevisions || [];
  const storyContextRuntime = recalculateRuntime(next, baseRuntime, storyPublicEvents, storySummaryRevisions, addedReasons);
  return { ...next, storyPublicEvents, storySummaryRevisions, storyContextRuntime };
}

function allSummarySourceIds(summary: StoryContextSummary) {
  return unique([
    ...summary.sourceEventIds,
    ...summary.objectiveFacts.flatMap((fact) => fact.sourceEventIds),
    ...summary.publicCharacterDevelopments.flatMap((development) => development.sourceEventIds),
    ...summary.unresolvedThreads.flatMap((thread) => [thread.introducedByEventId, thread.latestRelatedEventId || ""]),
    ...summary.cluesAndSecrets.flatMap((clue) => clue.sourceEventIds),
    ...summary.playerDirectives.map((directive) => directive.directiveId),
  ].filter(Boolean));
}

function containsPrivateLeak(state: GameState, summary: StoryContextSummary) {
  const serialized = JSON.stringify(summary);
  const publicCorpus = state.storyPublicEvents.map((event) => event.publicContent).join("\n");
  return state.agents.some((agent) => {
    const privateFragments = [agent.privateThought, ...agent.memory.files.flatMap((file) => file.revisions.map((revision) => revision.content))].filter((value) => typeof value === "string" && value.length >= 12);
    return privateFragments.some((fragment) => !publicCorpus.includes(fragment) && serialized.includes(fragment));
  });
}

function boundarySummary(summary: StoryContextSummary, scope: Exclude<StorySummaryScope, "story">, id: string, events: StoryPublicEvent[]): StoryContextSummary {
  const boundaryEvents = events.filter((event) => scope === "scene" ? event.sceneId === id : event.beatId === id);
  const boundaryIds = new Set(boundaryEvents.map((event) => event.eventId));
  const filterSources = (ids: string[]) => ids.filter((eventId) => boundaryIds.has(eventId));
  return {
    ...summary,
    summaryId: `${summary.summaryId}-${scope}-${id}`,
    revisionId: `${summary.revisionId}-${scope}-${id}`,
    baseRevisionId: undefined,
    scope,
    sceneIds: scope === "scene" ? [id] : summary.sceneIds,
    beatIds: scope === "beat" ? [id] : summary.beatIds,
    sourceEventIds: summary.sourceEventIds.filter((eventId) => boundaryIds.has(eventId)),
    coveredThroughEventId: boundaryEvents.at(-1)?.eventId || summary.coveredThroughEventId,
    objectiveFacts: summary.objectiveFacts.map((fact) => ({ ...fact, sourceEventIds: filterSources(fact.sourceEventIds) })).filter((fact) => fact.sourceEventIds.length),
    publicCharacterDevelopments: summary.publicCharacterDevelopments.map((item) => ({ ...item, sourceEventIds: filterSources(item.sourceEventIds) })).filter((item) => item.sourceEventIds.length),
    unresolvedThreads: summary.unresolvedThreads.filter((thread) => boundaryIds.has(thread.introducedByEventId) || Boolean(thread.latestRelatedEventId && boundaryIds.has(thread.latestRelatedEventId))),
    cluesAndSecrets: summary.cluesAndSecrets.map((clue) => ({ ...clue, sourceEventIds: filterSources(clue.sourceEventIds) })).filter((clue) => clue.sourceEventIds.length),
    playerDirectives: summary.playerDirectives.filter((directive) => boundaryIds.has(directive.directiveId)),
    sceneResult: boundaryEvents.at(-1)?.publicContent.slice(0, 600) || summary.sceneResult,
  };
}

export function beginStoryCompaction(state: GameState, task: StoryCompactionTask): GameState {
  if (state.mode !== "story" || !state.storyContextRuntime) return state;
  const baseIds = task.baseSummary?.sourceEventIds || [];
  return {
    ...state,
    storyContextRuntime: {
      ...state.storyContextRuntime,
      compactionStatus: "compacting",
      pendingSourceEventIds: task.sourceEvents.map((event) => event.eventId),
      pendingAllowedSourceEventIds: unique([...baseIds, ...task.sourceEvents.map((event) => event.eventId)]),
      pendingBaseRevisionId: task.baseSummary?.revisionId,
      pendingRequestedRevisionId: task.requestedRevisionId,
      lastFailure: undefined,
    },
  };
}

export function failStoryCompaction(state: GameState, message: string): GameState {
  if (state.mode !== "story" || !state.storyContextRuntime) return state;
  return { ...state, storyContextRuntime: { ...state.storyContextRuntime, compactionStatus: "failed", lastFailure: message.slice(0, 500) } };
}

export function commitStoryCompaction(state: GameState, summary: StoryContextSummary, usedDeterministicFallback: boolean): GameState {
  const runtime = state.storyContextRuntime;
  if (state.mode !== "story" || !runtime || !validSummaryShape(summary)) return failStoryCompaction(state, "摘要 schema 无效");
  if (summary.revisionId !== runtime.pendingRequestedRevisionId) return failStoryCompaction(state, "摘要 revisionId 与当前请求不匹配");
  if ((summary.baseRevisionId || undefined) !== (runtime.pendingBaseRevisionId || undefined)) return failStoryCompaction(state, "摘要 baseRevisionId 已过期");
  const allowedIds = new Set(runtime.pendingAllowedSourceEventIds);
  const actualEventIds = new Set(state.storyPublicEvents.map((event) => event.eventId));
  const referencedIds = allSummarySourceIds(summary);
  if (!referencedIds.every((id) => allowedIds.has(id) && actualEventIds.has(id))) return failStoryCompaction(state, "摘要引用了输入范围外的事件");
  if (!referencedIds.every((id) => summary.sourceEventIds.includes(id))) return failStoryCompaction(state, "摘要字段缺少统一 sourceEventIds 引用");
  const expectedCoverage = runtime.pendingSourceEventIds.at(-1);
  if (!expectedCoverage || summary.coveredThroughEventId !== expectedCoverage) return failStoryCompaction(state, "摘要覆盖位置不连续");
  const coveredIndex = runtime.pendingBaseRevisionId
    ? state.storyPublicEvents.findIndex((event) => event.eventId === latestStableSummary(state)?.coveredThroughEventId)
    : -1;
  const expectedContinuousIds = state.storyPublicEvents.slice(coveredIndex + 1, coveredIndex + 1 + runtime.pendingSourceEventIds.length).map((event) => event.eventId);
  if (expectedContinuousIds.join("\u0000") !== runtime.pendingSourceEventIds.join("\u0000")) return failStoryCompaction(state, "压缩输入不是连续公开事件范围");
  if (!runtime.pendingSourceEventIds.every((id) => summary.sourceEventIds.includes(id))) return failStoryCompaction(state, "摘要遗漏了输入事件引用");
  if (containsPrivateLeak(state, summary)) return failStoryCompaction(state, "摘要包含角色私有内容");
  const pinnedContext = buildPinnedStoryContext(state);
  const unansweredQuestions = pinnedContext.unansweredQuestions;
  if (!unansweredQuestions.every((question) => summary.unresolvedThreads.some((thread) => thread.threadId === `question-${question.id}` || thread.description === question.text))) return failStoryCompaction(state, "摘要遗漏了未回答问题");
  if (!pinnedContext.unresolvedClues.every((clue) => summary.cluesAndSecrets.some((item) => item.clueId === clue.id && item.status === "active"))) return failStoryCompaction(state, "摘要遗漏了未解决线索");
  const pendingBeatConditions = pinnedContext.currentBeatConditions.filter((condition) => condition.runtimeStatus === "pending").map((condition) => condition.text);
  if (!pendingBeatConditions.every((condition) => summary.nextStoryConstraints.includes(condition))) return failStoryCompaction(state, "摘要遗漏了未完成 Plot Beat 条件");
  const pendingDirectiveIds = new Set((state.director?.pendingDirectives || [])
    .filter((directive) => directive.status === "pending" && allowedIds.has(directive.id))
    .map((directive) => directive.id));
  const summarizedDirectiveIds = new Set(summary.playerDirectives.filter((directive) => directive.status === "pending" || directive.status === "partially_applied").map((directive) => directive.directiveId));
  if (![...pendingDirectiveIds].every((id) => summarizedDirectiveIds.has(id))) return failStoryCompaction(state, "摘要遗漏了 pending 玩家指令");
  const completed = new Set(state.director?.completedEvidence || []);
  if (!summary.plotProgress.completedConditions.every((condition) => completed.has(condition))) return failStoryCompaction(state, "摘要自行判定了 Plot Beat 完成条件");
  if (summary.plotProgress.failedOrInvalidatedConditions.length || summary.plotProgress.newlyUnlockedConditions.length) return failStoryCompaction(state, "摘要自行判定了 Plot Beat 失效或解锁条件");

  const stableSummary = { ...summary, scope: "story" as const };
  const derived: StoryContextSummary[] = [];
  const reasons = runtime.pendingReasons;
  if (reasons.includes("scene_transition")) {
    const sceneId = stableSummary.sceneIds.find((id) => id !== state.storyScene?.sceneId) || stableSummary.sceneIds[0];
    if (sceneId) derived.push(boundarySummary(stableSummary, "scene", sceneId, state.storyPublicEvents));
  }
  if (reasons.includes("beat_completed")) {
    const beatId = stableSummary.beatIds.find((id) => id !== state.director?.currentBeatId) || stableSummary.beatIds[0];
    if (beatId) derived.push(boundarySummary(stableSummary, "beat", beatId, state.storyPublicEvents));
  }
  const summaries = [...state.storySummaryRevisions, ...derived, stableSummary];
  const metrics = metricsForRuntime(state.storyPublicEvents, stableSummary.coveredThroughEventId);
  const stillHard = metrics.tokens >= STORY_COMPACTION_LIMITS.hardTokenLimit || metrics.bytes >= STORY_COMPACTION_LIMITS.hardByteLimit;
  const stillSoft = metrics.tokens >= STORY_COMPACTION_LIMITS.softTokenLimit || metrics.bytes >= STORY_COMPACTION_LIMITS.softByteLimit;
  const forcedReasons: StoryCompactionReason[] = ["legacy_restore", "outline_replan", "hard_limit"];
  const needsForcedContinuation = forcedReasons.some((reason) => reasons.includes(reason))
    && metrics.tail.length > reserveRecentEvents(metrics.tail).length;
  const continuedReason: StoryCompactionReason[] = needsForcedContinuation
    ? [reasons.find((reason) => reason === "legacy_restore" || reason === "outline_replan" || reason === "hard_limit")!]
    : stillHard ? ["hard_limit"] : stillSoft ? ["soft_limit"] : [];
  const nextRuntime: StoryContextRuntime = {
    ...runtime,
    currentStableSummaryRevisionId: stableSummary.revisionId,
    coveredThroughEventId: stableSummary.coveredThroughEventId,
    sceneSummaryRevisionIds: [...runtime.sceneSummaryRevisionIds, ...derived.filter((item) => item.scope === "scene").map((item) => item.revisionId)],
    beatSummaryRevisionIds: [...runtime.beatSummaryRevisionIds, ...derived.filter((item) => item.scope === "beat").map((item) => item.revisionId)],
    uncompactedEventIds: metrics.tail.map((event) => event.eventId),
    estimatedUncompactedTokens: metrics.tokens,
    estimatedUncompactedBytes: metrics.bytes,
    lastCompactedTurn: state.turn,
    lastCompactedSceneId: state.storyScene?.sceneId,
    compactionStatus: continuedReason.length ? "requested" : "idle",
    pendingReasons: continuedReason,
    pendingSourceEventIds: [],
    pendingAllowedSourceEventIds: [],
    pendingBaseRevisionId: stableSummary.revisionId,
    pendingRequestedRevisionId: undefined,
    lastFailure: undefined,
    deterministicFallbackCount: runtime.deterministicFallbackCount + (usedDeterministicFallback ? 1 : 0),
  };
  return { ...state, storySummaryRevisions: summaries, storyContextRuntime: nextRuntime, lastNotice: usedDeterministicFallback ? "模型压缩未通过，已提交不补写因果的确定性稳定摘要；原始事件完整保留。" : "公开剧情已压缩为可追溯的稳定摘要；原始事件完整保留。" };
}

export function deterministicStorySummary(task: StoryCompactionTask): StoryContextSummary {
  const factualEvents = task.sourceEvents.filter((event) => event.source !== "player");
  const groups: StoryPublicEvent[][] = [];
  for (let index = 0; index < factualEvents.length; index += 6) groups.push(factualEvents.slice(index, index + 6));
  const baseFacts = task.baseSummary?.objectiveFacts || [];
  const objectiveFacts = [...baseFacts.slice(-8), ...groups.map((group) => ({
    fact: group.map((event) => event.publicContent.replace(/\s+/g, " ").slice(0, 80)).join("；"),
    sourceEventIds: group.map((event) => event.eventId),
  }))].slice(-12);
  const characterIds = unique(factualEvents.flatMap((event) => event.participants));
  const developments = [...(task.baseSummary?.publicCharacterDevelopments || []), ...characterIds.map((characterId) => {
    const events = factualEvents.filter((event) => event.participants.includes(characterId));
    const statements = events.flatMap((event) => [...event.publicContent.matchAll(/([^\n：]{1,40})：“([^”]{1,320})”/g)].map((match) => match[2])).slice(-8);
    return {
      characterId,
      statements,
      actions: events.map((event) => event.publicContent.split("\n")[1] || event.publicContent.split("\n")[0]).filter(Boolean).slice(-8),
      publicStatusChanges: [],
      sourceEventIds: events.map((event) => event.eventId),
    };
  })].slice(-10);
  const pinnedThreads = task.pinnedContext.unansweredQuestions.map((question) => ({
    threadId: `question-${question.id}`,
    description: question.text,
    status: "open" as const,
    introducedByEventId: task.sourceEvents.find((event) => event.publicContent.includes(question.text))?.eventId || task.sourceEvents[0].eventId,
    latestRelatedEventId: undefined,
  }));
  const priorThreads = task.baseSummary?.unresolvedThreads || [];
  const unresolvedThreads = [...new Map([...priorThreads, ...pinnedThreads].map((thread) => [thread.threadId, thread])).values()].slice(-30);
  const cluesAndSecrets = task.pinnedContext.unresolvedClues.map((clue) => ({ clueId: clue.id, content: clue.description, visibility: "public" as const, status: "active" as const, sourceEventIds: task.sourceEvents.filter((event) => event.publicContent.includes(clue.description)).map((event) => event.eventId).slice(-4) }));
  const allowedIds = new Set([...(task.baseSummary?.sourceEventIds || []), ...task.sourceEvents.map((event) => event.eventId)]);
  const playerDirectives = task.pinnedContext.pendingPlayerDirectives
    .filter((directive) => allowedIds.has(directive.id))
    .map((directive) => ({ directiveId: directive.id, summary: directive.text, status: "pending" as const }));
  const sourceEventIds = unique([
    ...task.sourceEvents.map((event) => event.eventId),
    ...objectiveFacts.flatMap((fact) => fact.sourceEventIds),
    ...developments.flatMap((item) => item.sourceEventIds),
    ...unresolvedThreads.flatMap((thread) => [thread.introducedByEventId, thread.latestRelatedEventId || ""]),
    ...cluesAndSecrets.flatMap((clue) => clue.sourceEventIds),
    ...playerDirectives.map((directive) => directive.directiveId),
  ]).filter((id) => allowedIds.has(id));
  return {
    schema: STORY_CONTEXT_SUMMARY_SCHEMA,
    summaryId: task.requestedSummaryId,
    revisionId: task.requestedRevisionId,
    baseRevisionId: task.baseSummary?.revisionId,
    scope: "story",
    sceneIds: unique([...(task.baseSummary?.sceneIds || []), ...task.sourceEvents.map((event) => event.sceneId).filter(Boolean)]),
    beatIds: unique([...(task.baseSummary?.beatIds || []), ...task.sourceEvents.map((event) => event.beatId).filter(Boolean)]),
    sourceEventIds,
    coveredThroughEventId: task.sourceEvents.at(-1)?.eventId || task.baseSummary?.coveredThroughEventId || "",
    objectiveFacts,
    publicCharacterDevelopments: developments,
    plotProgress: {
      completedConditions: task.runtimeDeterminations.completedBeatConditions,
      failedOrInvalidatedConditions: task.runtimeDeterminations.invalidatedBeatConditions,
      newlyUnlockedConditions: [],
    },
    unresolvedThreads,
    cluesAndSecrets,
    playerDirectives,
    sceneResult: [...factualEvents].reverse()[0]?.publicContent.slice(0, 600) || task.baseSummary?.sceneResult || "",
    nextStoryConstraints: unique([...(task.baseSummary?.nextStoryConstraints || []), ...task.pinnedContext.currentBeatConditions.filter((condition) => condition.runtimeStatus === "pending").map((condition) => condition.text)]).slice(-20),
    createdAt: nowIso(),
  };
}
