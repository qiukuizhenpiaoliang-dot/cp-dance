export const DIRECTOR_STATE_SCHEMA = "cp-dance/director-state/v1" as const;
export const DIRECTOR_DECISION_SCHEMA = "cp-dance/director-decision/v1" as const;

export const DIRECTOR_TASK_TYPES = [
  "create_outline",
  "start_scene",
  "evaluate_progress",
  "handle_player_directive",
  "revise_outline",
  "resolve_ending",
] as const;

export type DirectorTaskType = (typeof DIRECTOR_TASK_TYPES)[number];
export type DirectorDecisionKind = "wait" | "inject_world_event" | "change_scene" | "advance_beat" | "revise_outline" | "finish_story";
export type EndingTargetType = "HE" | "BE" | "TRUE_END" | "NATURAL";
export type EndingMode = "strict" | "adaptive";

export type StorySetup = {
  premise: string;
  setting: string;
  tone: string;
  constraints: string;
  endingTarget: EndingTargetType;
  endingMode: EndingMode;
};

export type PlotBeat = {
  id: string;
  title: string;
  purpose: string;
  entryConditions: string[];
  allowedEventTypes: DirectorWorldEventType[];
  completionConditions: string[];
  sceneCandidates: string[];
  nextBeatIds: string[];
  softTurnLimit: number;
  endingContributions: string[];
};

export type DirectorOutline = {
  storyTitle: string;
  storySummary: string;
  beats: PlotBeat[];
  currentBeatId: string;
};

export type DirectorWorldEventType = "weather" | "time_change" | "location_change" | "entity_appeared" | "external_threat" | "reveal" | "evidence_found" | "mission" | "public_status_change" | "ambient_change";
export type PublicStatusType = "injured" | "exhausted" | "wet" | "endangered" | "trapped" | "missing" | "safe";

export type DirectorWorldEvent = {
  type: DirectorWorldEventType;
  summary: string;
  visibleTo: string[];
  affectedAgents: string[];
  publicEffects: Array<{ type: PublicStatusType; severity: "mild" | "moderate" | "severe" }>;
};

export type DirectorSceneProposal = {
  location: string;
  timeOfDay: string;
  weather: string;
  atmosphere: string;
  visualKeywords: string[];
  reason: string;
};

export type DirectorDecision = {
  schema: typeof DIRECTOR_DECISION_SCHEMA;
  decision: DirectorDecisionKind;
  currentBeatId: string;
  worldEvents: DirectorWorldEvent[];
  sceneProposal: DirectorSceneProposal | null;
  runtimeReason: string;
  playerVisibleNarration: string;
  completedEvidence: string[];
  outlineRevision?: DirectorOutline | null;
  model?: string;
};

export type PlayerDirectiveType = "force_world_event" | "plot_guidance" | "scene_request";

export type PlayerDirective = {
  id: string;
  type: PlayerDirectiveType;
  text: string;
  createdTurn: number;
  status: "pending" | "applied" | "rejected";
};

export type DirectorState = {
  schema: typeof DIRECTOR_STATE_SCHEMA;
  status: "idle" | "planning" | "playing" | "evaluating" | "transitioning" | "completed";
  setup: StorySetup;
  storyTitle: string;
  storySummary: string;
  outlineRevision: number;
  beats: PlotBeat[];
  currentBeatId: string;
  currentSceneId: string;
  lastDirectorTurn: number;
  interventionCount: number;
  cooldownTurns: number;
  pendingDirectives: PlayerDirective[];
  completedEvidence: string[];
  lastRuntimeReason: string;
};

export type StorySceneState = {
  status: "stable" | "transition_requested" | "transitioning";
  sceneId: string;
  location: string;
  timeOfDay: string;
  weather: string;
  atmosphere: string;
  visualKeywords: string[];
  backgroundAssetId?: string;
  backgroundUrl?: string;
};

export type SceneEntity = {
  id: string;
  type: "enemy" | "npc" | "object" | "hazard" | "clue";
  name?: string;
  description: string;
  visibility: "public" | "partial";
  lifecycle: "temporary" | "scene_bound" | "persistent";
  state: Record<string, string | number | boolean>;
};

export type DirectorTask = {
  taskType: DirectorTaskType;
  worldId: string;
  turn: number;
  setup: StorySetup;
  cast: Array<{ id: string; name: string; publicMood: string }>;
  currentScene: StorySceneState;
  currentBeat: PlotBeat | null;
  outline: PlotBeat[];
  summaryRevisionId: string | null;
  outlineBaseRevision: number;
  coveredThroughEventId: string | null;
  stableSummary: StoryContextSummary | null;
  recentPublicEvents: StoryPublicEvent[];
  pinnedContext: StoryPinnedContext;
  contextMetrics: { estimatedTokens: number; estimatedBytes: number; inputBudget: number };
  latestDirective: PlayerDirective | null;
};
import type { StoryContextSummary, StoryPinnedContext, StoryPublicEvent } from "./story-context-types";
