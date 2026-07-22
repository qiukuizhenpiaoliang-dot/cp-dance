import type { GameState } from "./agent-engine";
import {
  DIRECTOR_STATE_SCHEMA,
  type DirectorDecision,
  type DirectorOutline,
  type DirectorState,
  type DirectorTask,
  type DirectorTaskType,
  type PlayerDirective,
  type StorySceneState,
  type StorySetup,
} from "./director-types";
import { buildPinnedStoryContext, estimateStoryText, selectRecentStoryEvents } from "./story-context";
import { STORY_COMPACTION_LIMITS } from "./story-context-types";

export const DEFAULT_STORY_SETUP: StorySetup = {
  premise: "",
  setting: "共享空间",
  tone: "角色驱动、允许意外与停顿",
  constraints: "不强迫角色产生特定感情或接受互动",
  endingTarget: "NATURAL",
  endingMode: "adaptive",
};

export const DEFAULT_STORY_SCENE: StorySceneState = {
  status: "stable",
  sceneId: "story-room",
  location: "安静的共享房间",
  timeOfDay: "day",
  weather: "clear",
  atmosphere: "quiet",
  visualKeywords: ["室内", "开放地面", "固定机位"],
};

export function sceneFromProposal(proposal: DirectorDecision["sceneProposal"], current = DEFAULT_STORY_SCENE): StorySceneState {
  if (!proposal?.location) return { ...current, status: "stable" };
  const descriptor = `${proposal.location} ${proposal.timeOfDay} ${proposal.weather} ${proposal.atmosphere}`;
  const sceneId = /车站|站台|铁路/.test(descriptor) ? "story-station"
    : /海边|海岸|沙滩/.test(descriptor) ? "story-seaside"
      : /屋顶|天台/.test(descriptor) ? "story-rooftop"
        : /医院|走廊|学校|教室/.test(descriptor) ? "story-corridor"
          : "story-room";
  return {
    status: "stable",
    sceneId,
    location: proposal.location,
    timeOfDay: proposal.timeOfDay || current.timeOfDay,
    weather: proposal.weather || current.weather,
    atmosphere: proposal.atmosphere || current.atmosphere,
    visualKeywords: proposal.visualKeywords.length ? proposal.visualKeywords : current.visualKeywords,
  };
}

export function parsePlayerDirective(text: string, turn: number): PlayerDirective {
  const normalized = text.trim().slice(0, 800);
  const type = /下一幕|场景|地点|去.+(?:海边|车站|学校|屋顶|走廊|房间)|时间是|天气/.test(normalized)
    ? "scene_request"
    : /突然|出现|攻击|受伤|发现|下雨|停电|爆炸|门开了|事实发生/.test(normalized)
      ? "force_world_event"
      : "plot_guidance";
  return {
    id: `directive-${turn}-${Date.now()}`,
    type,
    text: normalized,
    createdTurn: turn,
    status: "pending",
  };
}

export function createDirectorState(setup: StorySetup, outline: DirectorOutline, scene = DEFAULT_STORY_SCENE): DirectorState {
  return {
    schema: DIRECTOR_STATE_SCHEMA,
    status: "playing",
    setup: { ...DEFAULT_STORY_SETUP, ...setup },
    storyTitle: outline.storyTitle,
    storySummary: outline.storySummary,
    outlineRevision: 1,
    beats: outline.beats,
    currentBeatId: outline.currentBeatId || outline.beats[0]?.id || "beat-01",
    currentSceneId: scene.sceneId,
    lastDirectorTurn: 0,
    interventionCount: 0,
    cooldownTurns: 4,
    pendingDirectives: [],
    completedEvidence: [],
    lastRuntimeReason: "故事大纲已建立，等待公开证据推进。",
  };
}

export function normalizeStorySetup(raw?: Partial<StorySetup>): StorySetup {
  const endingTarget = ["HE", "BE", "TRUE_END", "NATURAL"].includes(raw?.endingTarget || "") ? raw!.endingTarget! : "NATURAL";
  return {
    premise: String(raw?.premise || "").slice(0, 1600),
    setting: String(raw?.setting || DEFAULT_STORY_SETUP.setting).slice(0, 500),
    tone: String(raw?.tone || DEFAULT_STORY_SETUP.tone).slice(0, 500),
    constraints: String(raw?.constraints || DEFAULT_STORY_SETUP.constraints).slice(0, 800),
    endingTarget,
    endingMode: raw?.endingMode === "strict" ? "strict" : "adaptive",
  };
}

export function normalizeDirectorState(raw: DirectorState | undefined, fallbackSetup = DEFAULT_STORY_SETUP): DirectorState | null {
  if (!raw || raw.schema !== DIRECTOR_STATE_SCHEMA || !Array.isArray(raw.beats) || !raw.beats.length) return null;
  const setup = normalizeStorySetup(raw.setup || fallbackSetup);
  const beats = raw.beats.slice(0, 12).map((beat, index) => ({
    ...beat,
    id: String(beat.id || `beat-${String(index + 1).padStart(2, "0")}`),
    title: String(beat.title || `剧情节拍 ${index + 1}`).slice(0, 120),
    softTurnLimit: Math.max(4, Math.min(30, Number(beat.softTurnLimit) || 10)),
  }));
  return {
    ...raw,
    schema: DIRECTOR_STATE_SCHEMA,
    setup,
    beats,
    currentBeatId: beats.some((beat) => beat.id === raw.currentBeatId) ? raw.currentBeatId : beats[0].id,
    cooldownTurns: Math.max(4, Number(raw.cooldownTurns) || 4),
    pendingDirectives: Array.isArray(raw.pendingDirectives) ? raw.pendingDirectives.slice(0, 12) : [],
    completedEvidence: Array.isArray(raw.completedEvidence) ? raw.completedEvidence.slice(0, 40) : [],
  };
}

export function shouldInvokeDirector(state: GameState) {
  const director = state.mode === "story" ? state.director : null;
  if (!director || director.status === "completed" || director.status === "transitioning") return false;
  if (director.pendingDirectives.some((directive) => directive.status === "pending")) return true;
  const currentBeat = director.beats.find((beat) => beat.id === director.currentBeatId);
  const elapsed = state.turn - director.lastDirectorTurn;
  return elapsed >= Math.max(director.cooldownTurns, currentBeat?.softTurnLimit || director.cooldownTurns);
}

export function buildDirectorTask(state: GameState, taskType: DirectorTaskType, latestDirective: PlayerDirective | null = null): DirectorTask {
  const director = state.director;
  const currentBeat = director?.beats.find((beat) => beat.id === director.currentBeatId) || null;
  const summaryRevisionId = state.storyContextRuntime?.currentStableSummaryRevisionId || null;
  const stableSummary = summaryRevisionId ? state.storySummaryRevisions.find((summary) => summary.revisionId === summaryRevisionId) || null : null;
  const recentPublicEvents = selectRecentStoryEvents(state);
  const pinnedContext = buildPinnedStoryContext(state);
  const task = {
    taskType,
    worldId: state.worldId,
    turn: state.turn,
    setup: normalizeStorySetup(director?.setup),
    cast: state.agents.map((agent) => ({ id: agent.id, name: agent.name, publicMood: agent.mood })),
    currentScene: state.storyScene || DEFAULT_STORY_SCENE,
    currentBeat,
    outline: director?.beats || [],
    summaryRevisionId,
    outlineBaseRevision: director?.outlineRevision || 0,
    coveredThroughEventId: state.storyContextRuntime?.coveredThroughEventId || null,
    stableSummary,
    recentPublicEvents,
    pinnedContext,
    contextMetrics: { estimatedTokens: 0, estimatedBytes: 0, inputBudget: STORY_COMPACTION_LIMITS.directorInputTokenBudget },
    latestDirective,
  };
  const metrics = estimateStoryText(task);
  return { ...task, contextMetrics: { estimatedTokens: metrics.tokens, estimatedBytes: metrics.bytes, inputBudget: STORY_COMPACTION_LIMITS.directorInputTokenBudget } };
}

export function directorTaskTypeForState(state: GameState): DirectorTaskType {
  const pending = state.director?.pendingDirectives.find((directive) => directive.status === "pending");
  if (pending?.type === "plot_guidance") return "revise_outline";
  if (pending) return "handle_player_directive";
  return "evaluate_progress";
}

export function nextDirectorState(current: DirectorState, decision: DirectorDecision, turn: number): DirectorState {
  const revised = decision.outlineRevision;
  const beats = revised?.beats?.length ? revised.beats : current.beats;
  const currentBeatId = beats.some((beat) => beat.id === decision.currentBeatId) ? decision.currentBeatId : current.currentBeatId;
  return {
    ...current,
    status: decision.decision === "finish_story" ? "completed" : decision.decision === "change_scene" ? "transitioning" : "playing",
    storyTitle: revised?.storyTitle || current.storyTitle,
    storySummary: revised?.storySummary || current.storySummary,
    outlineRevision: revised ? current.outlineRevision + 1 : current.outlineRevision,
    beats,
    currentBeatId,
    lastDirectorTurn: turn,
    interventionCount: decision.decision === "wait" ? current.interventionCount : current.interventionCount + 1,
    pendingDirectives: current.pendingDirectives.map((directive) => directive.status === "pending" ? { ...directive, status: "applied" as const } : directive),
    completedEvidence: [...new Set([...current.completedEvidence, ...decision.completedEvidence])].slice(-40),
    lastRuntimeReason: decision.runtimeReason,
  };
}
