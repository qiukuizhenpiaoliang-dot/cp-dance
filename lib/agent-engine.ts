import {
  deriveRelationshipCues,
  evaluateRelationship,
  qualitativeStage,
  relationshipDirectionLabel,
  type DirectionSnapshot,
  type RelationshipDelta,
  type RelationshipSignals,
} from "./relationship-engine";
import { createDraftPixelPet, mergePixelPetActionPacks, normalizePixelPetProfile, resolvePixelPetAction, type PixelPetActionDefinition, type PixelPetActionPack, type PixelPetFacing, type PixelPetProfile } from "./pixel-pet";
import { createEmptyGroupScene, GROUP_SCENE_SCHEMA, PUBLIC_DIALOGUE_SCHEMA, type CharacterAssetJob, type CharacterAgentAction, type CharacterAgentDecision, type CharacterAgentStageHistoryEntry, type GroupParticipationState, type GroupSceneState, type NaturalAgentTurn, type PendingDialogueQuestion, type PublicDialogueBeat, type PublicDialogueState } from "./natural-agent-types";
import { validateDuoInteraction, type DuoInteractionKind, type DuoInteractionValidation } from "./duo-interaction";
import { createInteractionSession, INTERACTION_SESSION_SCHEMA, type InteractionMatchResult, type InteractionSession, type InteractionSessionPhase } from "./interaction-session";
import { centeredStageOpeningPosition, centerDistanceForBodyGap, minimumOccupancyHorizontalGap, occupancyDistanceBand, relativeExplorePosition, separateSpatialOccupancy, spatialOccupancyOverlaps } from "./spatial-occupancy";
import {
  appendRoleplayMemoryCue,
  commitCharacterMemory,
  createPortableAgentMemory,
  createInitialAgentMemory,
  normalizeAgentMemory,
  seedCharacterMemory,
  type AgentMemory,
  type MemoryCommitAudit,
} from "./character-memory";
import { createCharacterProfile, createRelationshipLens, normalizeCharacterProfile, normalizeRelationshipLens, type CharacterProfileV2, type RelationshipLens } from "./roleplay";
import {
  createEmptyCharacterReferencePack,
  findCanonRelationship,
  normalizeCharacterReferencePack,
  referenceRelationKind,
  type CharacterReferencePackV1,
} from "./character-reference";
import { createDirectorState, DEFAULT_STORY_SCENE, nextDirectorState, normalizeDirectorState, sceneFromProposal } from "./director-runtime";
import type { DirectorDecision, DirectorOutline, DirectorState, PlayerDirective, SceneEntity, StorySceneState, StorySetup } from "./director-types";
import { beginStoryCompaction, commitStoryCompaction, createStoryContextRuntime, failStoryCompaction, normalizeStoryContextForHydrate, reconcileStoryContext } from "./story-context";
import type { StoryCompactionTask, StoryContextRuntime, StoryContextSummary, StoryPublicEvent } from "./story-context-types";
import { createBackgroundWorldIndex, normalizeBackgroundWorldIndex, registerWorldBackground, type BackgroundAssetRecord, type BackgroundWorldIndex } from "./background-assets";

export type { AgentMemory } from "./character-memory";

export type GamePhase = "onboarding" | "town";
export type ExperienceMode = "natural" | "story";
export type RuntimeSurface = "web" | "desktop_pet";
export type EventLevel = "L1" | "L2" | "L3" | "L4" | "L5";
export type RelationshipBoundary = "undefined" | "default_exclusive" | "explicit_exclusive" | "open" | "multi_party" | "ended";
export type SocialIntent = "share_space" | "invite_play" | "offer_comfort" | "seek_affection" | "repair" | "ask_for_space" | "honest_talk";
export type SocialResponseKind = "accept" | "delay" | "soft_reject" | "reject" | "counter";

export type StoryAgent = {
  id: string;
  name: string;
  personality: string;
  background: string;
  profile: CharacterProfileV2;
  referencePack: CharacterReferencePackV1;
  color: string;
  accent: string;
  mood: string;
  privateThought: string;
  memory: AgentMemory;
  visual: PixelPetProfile;
};

export type RelationshipDirection = DirectionSnapshot & {
  from: string;
  to: string;
  jealousy: number;
  commitment: number;
  boundary: RelationshipBoundary;
  currentEmotion: string;
  unresolvedThreads: string[];
  lens: RelationshipLens;
};

export type Relationship = {
  id: string;
  a: string;
  b: string;
  directions: [RelationshipDirection, RelationshipDirection];
  status: string;
  turnsTogether: number;
  history: string[];
  lastReason: string;
};

export type InitialRelationKind = "初识" | "旧识" | "朋友" | "同伴" | "亲属" | "单恋" | "宿敌" | "自定义";
export type RelationshipDirectionDraft = {
  kind: InitialRelationKind;
  note: string;
};
export type RelationshipDraft = {
  id: string;
  a: string;
  b: string;
  aToB: RelationshipDirectionDraft;
  bToA: RelationshipDirectionDraft;
  sharedHistory: string;
  researchSuggested?: boolean;
  referenceClaimIds?: string[];
};

export type SocialProposal = {
  actorId: string;
  targetId: string;
  intent: SocialIntent;
  preferredAction: string;
  intensity: number;
  reasonTags: string[];
  fallback: string;
};

export type SocialResponse = {
  responderId: string;
  response: SocialResponseKind;
  comfort: "comfortable" | "uncertain" | "uncomfortable";
  preferredAction: string;
  reasonTags: string[];
};

export type InteractionResolution = {
  outcome: "shared" | "adjusted" | "paused" | "boundary";
  actionSequence: string[];
  boundaryHonored: boolean;
};

export type DialogueLine = { speaker: string; text: string };

export type ChronicleEvent = {
  id: string;
  day: number;
  time: string;
  kind: "daily" | "script" | "decision" | "system";
  mode: ExperienceMode;
  level: EventLevel;
  actorIds: string[];
  title: string;
  summary: string;
  dialogue: DialogueLine[];
  impact: string;
  memoryWrite: string;
  memoryWrites: Record<string, string>;
  sceneId: string;
  relationshipReason: string;
  assetActions?: Record<string, string>;
  proposal?: SocialProposal;
  response?: SocialResponse;
  resolution?: InteractionResolution;
  duoValidation?: DuoInteractionValidation;
  interactionSession?: InteractionSession;
  memoryAudit?: Record<string, MemoryCommitAudit>;
};

export type SceneSelection = {
  id: string;
  label: string;
  tags: string[];
  reason: string;
  assetStatus: "placeholder" | "reserved" | "generated";
};

export type SpatialIntent = "idle" | "wander" | "approach" | "align" | "paired" | "cuddle" | "comfort" | "play" | "retreat" | "keep_distance" | "observe" | "rest";
export type SpatialProximity = "alone" | "far" | "normal" | "near" | "touching";
export type CharacterSpatialState = {
  agentId: string;
  x: number;
  y: number;
  coordinateSpace?: "stage" | "desktop";
  facing: "left" | "right";
  targetId: string | null;
  intent: SpatialIntent;
  proximity: SpatialProximity;
  perception: string;
  updatedTurn: number;
  renderScale: number;
  interactionId: string | null;
};

export type DesktopAttentionTrigger = {
  actorId: string;
  counterpartId: string | null;
  eventId: string;
  reason: string;
  recordInChronicle?: boolean;
};

export type StoryAttentionTrigger = {
  actorId: string;
  eventId: string;
  reason: string;
};

export type DesktopTransientReaction = {
  agentId: string;
  dialogue: string | null;
  observableBehavior: string;
  animationAction: string;
  revision: number;
};

export type GameState = {
  worldId: string;
  worldCreatedAt: string | null;
  phase: GamePhase;
  surface: RuntimeSurface;
  mode: ExperienceMode;
  day: number;
  turn: number;
  running: boolean;
  agents: StoryAgent[];
  relationshipDrafts: RelationshipDraft[];
  relationships: Relationship[];
  spatial: Record<string, CharacterSpatialState>;
  events: ChronicleEvent[];
  scene: SceneSelection;
  compressionCount: number;
  selectedMemoryAgentId: string;
  assetJobs: CharacterAssetJob[];
  interactionSession: InteractionSession | null;
  publicDialogue: PublicDialogueState;
  agentStageHistory: Record<string, CharacterAgentStageHistoryEntry[]>;
  desktopAttentionQueue: DesktopAttentionTrigger[];
  desktopTransientReaction: DesktopTransientReaction | null;
  director: DirectorState | null;
  storyScene: StorySceneState | null;
  worldEntities: SceneEntity[];
  storyAttentionQueue: StoryAttentionTrigger[];
  storyPublicEvents: StoryPublicEvent[];
  storySummaryRevisions: StoryContextSummary[];
  storyContextRuntime: StoryContextRuntime | null;
  backgroundWorldIndex: BackgroundWorldIndex;
  lastNotice: string;
};

export type NewStoryAgentInput = Pick<StoryAgent, "name" | "personality" | "background"> & { roleplayNotes?: string; referencePack?: CharacterReferencePackV1 };

export type GameAction =
  | { type: "HYDRATE"; state: GameState }
  | { type: "ADD_AGENT"; agent: NewStoryAgentInput }
  | { type: "ADD_SAVED_AGENT"; agent: StoryAgent }
  | { type: "REMOVE_AGENT"; id: string }
  | { type: "SET_AGENT_VISUAL"; id: string; visual: PixelPetProfile }
  | { type: "SET_RELATIONSHIP_DRAFT"; draft: RelationshipDraft }
  | { type: "ENTER_TOWN"; mode: ExperienceMode; story?: { setup: StorySetup; outline: DirectorOutline; decision: DirectorDecision } }
  | { type: "SELECT_MEMORY"; id: string }
  | { type: "SET_SURFACE"; surface: RuntimeSurface }
  | { type: "SET_RUNNING"; running: boolean }
  | { type: "APPLY_DESKTOP_DRAG"; agentId: string; x: number; y: number; phase: "move" | "drop"; sudden?: boolean }
  | { type: "APPLY_DESKTOP_POINTER_EVENT"; agentId: string; kind: "click" | "double_click" }
  | { type: "DISMISS_DESKTOP_ATTENTION"; agentId: string }
  | { type: "TOGGLE_RUNNING" }
  | { type: "ADVANCE" }
  | { type: "ADVANCE_INTERACTION_SESSION" }
  | { type: "APPLY_NATURAL_AGENT_TURN"; turn: NaturalAgentTurn }
  | { type: "QUEUE_PLAYER_DIRECTIVE"; directive: PlayerDirective }
  | { type: "APPLY_DIRECTOR_DECISION"; decision: DirectorDecision }
  | { type: "REGISTER_BACKGROUND_ASSET"; asset: BackgroundAssetRecord; sceneId: string }
  | { type: "BEGIN_STORY_COMPACTION"; task: StoryCompactionTask }
  | { type: "COMMIT_STORY_COMPACTION"; summary: StoryContextSummary; usedDeterministicFallback: boolean }
  | { type: "FAIL_STORY_COMPACTION"; message: string }
  | { type: "UPDATE_ASSET_JOB"; job: CharacterAssetJob }
  | { type: "REGISTER_AGENT_ASSET"; job: CharacterAssetJob; agentId: string; pack: PixelPetActionPack }
  | { type: "RESET" };

const avatarPalettes = [["#ba5f68", "#f4c36b"], ["#4d749c", "#85c5b3"], ["#745c91", "#e59b6f"]];

const scenes: Record<string, SceneSelection> = {
  desktop: { id: "desktop", label: "共享桌面", tags: ["日常", "陪伴", "自然"], reason: "自然模式使用固定桌面环境，关系通过距离、朝向与动作呈现。", assetStatus: "placeholder" },
  "story-room": { id: "story-room", label: "共享房间", tags: ["室内", "开放", "故事"], reason: "现有安全场景包中的开放室内空间。", assetStatus: "reserved" },
  "story-station": { id: "story-station", label: "夜间车站", tags: ["车站", "夜晚", "雨"], reason: "现有场景样式匹配车站、夜晚和紧张气氛。", assetStatus: "reserved" },
  "story-seaside": { id: "story-seaside", label: "夜色海边", tags: ["海边", "夜晚", "开阔"], reason: "现有场景样式匹配海岸与开阔空间。", assetStatus: "reserved" },
  "story-rooftop": { id: "story-rooftop", label: "学校屋顶", tags: ["屋顶", "黄昏", "风"], reason: "现有场景样式匹配屋顶和高处空间。", assetStatus: "reserved" },
  "story-corridor": { id: "story-corridor", label: "封闭走廊", tags: ["走廊", "室内", "紧张"], reason: "现有场景样式匹配走廊、医院或学校。", assetStatus: "reserved" },
};

export const initialGameState: GameState = {
  worldId: "",
  worldCreatedAt: null,
  phase: "onboarding",
  surface: "web",
  mode: "natural",
  day: 1,
  turn: 0,
  running: false,
  agents: [],
  relationshipDrafts: [],
  relationships: [],
  spatial: {},
  events: [],
  scene: scenes.desktop,
  compressionCount: 0,
  selectedMemoryAgentId: "",
  assetJobs: [],
  interactionSession: null,
  publicDialogue: {
    schema: PUBLIC_DIALOGUE_SCHEMA,
    sessionId: null,
    participants: [],
    status: "idle",
    currentTopic: null,
    lastSpeakerId: null,
    consecutiveBeats: 0,
    transcript: [],
    pendingQuestions: [],
    groupScene: createEmptyGroupScene(),
  },
  agentStageHistory: {},
  desktopAttentionQueue: [],
  desktopTransientReaction: null,
  director: null,
  storyScene: null,
  worldEntities: [],
  storyAttentionQueue: [],
  storyPublicEvents: [],
  storySummaryRevisions: [],
  storyContextRuntime: null,
  backgroundWorldIndex: createBackgroundWorldIndex(""),
  lastNotice: "请选择自然世界或故事剧场；进入后模式不会切换。",
};

function clamp(value: number, min = 0, max = 100) { return Math.max(min, Math.min(max, Math.round(value))); }
function pairId(a: string, b: string) { return [a, b].sort().join("::"); }
function hash(input: string) { let value = 0; for (let index = 0; index < input.length; index += 1) value = (value * 31 + input.charCodeAt(index)) >>> 0; return value; }
function eventTime(turn: number) { return ["08:20", "10:45", "13:10", "16:30", "19:05", "22:15"][turn % 6]; }
function direction(relationship: Relationship, from: string) { return relationship.directions.find((item) => item.from === from)!; }

const spatialSeeds = [
  { x: 25, y: 72, facing: "right" as const },
  { x: 71, y: 65, facing: "left" as const },
  { x: 51, y: 77, facing: "left" as const },
];
const spatialIntents: SpatialIntent[] = ["idle", "wander", "approach", "align", "paired", "cuddle", "comfort", "play", "retreat", "keep_distance", "observe", "rest"];
const soloSpatialIntents: SpatialIntent[] = ["idle", "wander", "rest"];

function normalizeSoloSpatialIntent(intent: SpatialIntent): SpatialIntent {
  return soloSpatialIntents.includes(intent) ? intent : "idle";
}

export function spatialIntentLabel(intent: SpatialIntent, solo = false) {
  if (solo) {
    const normalized = normalizeSoloSpatialIntent(intent);
    if (normalized === "wander") return "四处走动";
    if (normalized === "rest") return "独自休息";
    return "安静待着";
  }
  return {
    idle: "安静待着", wander: "四处走动", approach: "正在靠近", align: "正在细对齐", paired: "共同动作中", cuddle: "正在贴贴", comfort: "陪在身边",
    play: "一起玩", retreat: "正在离开", keep_distance: "保持距离", observe: "留意对方", rest: "独自休息",
  }[intent];
}

function normalizeSpatial(
  agents: StoryAgent[],
  current?: Partial<Record<string, Partial<CharacterSpatialState>>>,
  options: { skipOccupancy?: boolean } = {},
): Record<string, CharacterSpatialState> {
  const normalized = Object.fromEntries(agents.map((agent, index) => {
    const fallback = spatialSeeds[index % spatialSeeds.length];
    const value = current?.[agent.id];
    const desktop = value?.coordinateSpace === "desktop";
    const incomingIntent = spatialIntents.includes(value?.intent as SpatialIntent) ? value?.intent as SpatialIntent : "idle";
    const intent = agents.length === 1 ? normalizeSoloSpatialIntent(incomingIntent) : incomingIntent;
    const proximity = ["alone", "far", "normal", "near", "touching"].includes(value?.proximity || "") ? value?.proximity as SpatialProximity : agents.length === 1 ? "alone" : "far";
    return [agent.id, {
      agentId: agent.id,
      x: clamp(Number.isFinite(value?.x) ? value!.x! : fallback.x, desktop ? 4 : 12, desktop ? 96 : 88),
      y: clamp(Number.isFinite(value?.y) ? value!.y! : fallback.y, desktop ? 8 : 57, desktop ? 92 : 79),
      coordinateSpace: desktop ? "desktop" as const : "stage" as const,
      facing: value?.facing === "left" || value?.facing === "right" ? value.facing : fallback.facing,
      targetId: agents.length > 1 && agents.some((item) => item.id === value?.targetId && item.id !== agent.id) ? value!.targetId! : null,
      intent,
      proximity: agents.length === 1 ? "alone" : proximity,
      perception: agents.length === 1 ? "这里暂时只有我一个人。" : typeof value?.perception === "string" ? value.perception.slice(0, 120) : "我能看见其他角色正在房间里活动。",
      updatedTurn: Number.isFinite(value?.updatedTurn) ? value!.updatedTurn! : 0,
      renderScale: Number.isFinite(value?.renderScale) ? Math.max(0.82, Math.min(1.18, value!.renderScale!)) : 1,
      interactionId: agents.length === 1 ? null : typeof value?.interactionId === "string" ? value.interactionId : null,
    } satisfies CharacterSpatialState];
  }));
  const collisionFree = options.skipOccupancy ? normalized : separateSpatialOccupancy(agents, normalized).spatial;
  return Object.fromEntries(agents.map((agent) => {
    const self = collisionFree[agent.id];
    const target = self.targetId ? collisionFree[self.targetId] : null;
    if (!target) return [agent.id, { ...self, proximity: agents.length === 1 ? "alone" : "far" }];
    const confirmedContact = self.proximity === "touching"
      && target.proximity === "touching"
      && target.targetId === agent.id;
    return [agent.id, { ...self, proximity: proximityFor(self, target, confirmedContact) }];
  }));
}

function storyOpeningSpatial(agents: StoryAgent[]) {
  const positions = agents.map((_, index) => centeredStageOpeningPosition(agents.length, index));
  const opening = Object.fromEntries(agents.map((agent, index) => {
    const position = positions[index];
    const nearestIndex = agents.length <= 1 ? -1 : positions
      .map((candidate, candidateIndex) => ({ candidateIndex, distance: Math.abs(candidate.x - position.x) }))
      .filter((candidate) => candidate.candidateIndex !== index)
      .sort((left, right) => left.distance - right.distance || left.candidateIndex - right.candidateIndex)[0].candidateIndex;
    const target = nearestIndex >= 0 ? agents[nearestIndex] : null;
    const targetPosition = nearestIndex >= 0 ? positions[nearestIndex] : null;
    return [agent.id, {
      ...position,
      coordinateSpace: "stage" as const,
      facing: targetPosition && targetPosition.x < position.x ? "left" as const : "right" as const,
      targetId: target?.id || null,
      intent: "idle" as const,
      perception: target ? `我在剧场中央，能看见${target.name}就在附近。` : "我在剧场中央，正在观察开场环境。",
      updatedTurn: 0,
      renderScale: 1,
      interactionId: null,
    }];
  }));
  return normalizeSpatial(agents, opening);
}

const STAGE_Y_DISTANCE_WEIGHT = 0.62;

function spatialBounds(spatial: CharacterSpatialState) {
  return spatial.coordinateSpace === "desktop"
    ? { minX: 4, maxX: 96, minY: 8, maxY: 92 }
    : { minX: 12, maxX: 88, minY: 57, maxY: 79 };
}

function spatialDistance(a: CharacterSpatialState, b: CharacterSpatialState) {
  return Math.hypot(a.x - b.x, (a.y - b.y) * STAGE_Y_DISTANCE_WEIGHT);
}

function proximityFor(a: CharacterSpatialState, b: CharacterSpatialState, confirmedContact = false): SpatialProximity {
  if (confirmedContact) return "touching";
  return occupancyDistanceBand(a, b, spatialDistance(a, b));
}

function facingToward(self: CharacterSpatialState, target: CharacterSpatialState): CharacterSpatialState["facing"] {
  return self.x <= target.x ? "right" : "left";
}

function facingAway(self: CharacterSpatialState, target: CharacterSpatialState): CharacterSpatialState["facing"] {
  return facingToward(self, target) === "right" ? "left" : "right";
}

function facePairTowardEachOther(a: CharacterSpatialState, b: CharacterSpatialState) {
  const aIsLeft = a.x === b.x ? a.agentId.localeCompare(b.agentId) <= 0 : a.x < b.x;
  return {
    a: { ...a, facing: aIsLeft ? "right" as const : "left" as const },
    b: { ...b, facing: aIsLeft ? "left" as const : "right" as const },
  };
}

function moveToward(self: CharacterSpatialState, target: CharacterSpatialState, desiredDistance: number) {
  const distance = spatialDistance(self, target);
  if (distance <= desiredDistance) return self;
  const factor = (distance - desiredDistance) / distance;
  const bounds = spatialBounds(self);
  return {
    ...self,
    x: clamp(self.x + (target.x - self.x) * factor, bounds.minX, bounds.maxX),
    y: clamp(self.y + (target.y - self.y) * factor, bounds.minY, bounds.maxY),
  };
}

function moveAway(self: CharacterSpatialState, target: CharacterSpatialState, desiredDistance: number) {
  const distance = spatialDistance(self, target);
  if (distance >= desiredDistance) return self;
  const fallbackDirection = self.x <= target.x ? -1 : 1;
  const dx = distance < 0.5 ? fallbackDirection : (self.x - target.x) / distance;
  const dy = distance < 0.5 ? 0 : ((self.y - target.y) * STAGE_Y_DISTANCE_WEIGHT) / distance;
  const step = desiredDistance - distance;
  const bounds = spatialBounds(self);
  return {
    ...self,
    x: clamp(self.x + dx * step, bounds.minX, bounds.maxX),
    y: clamp(self.y + (dy * step) / STAGE_Y_DISTANCE_WEIGHT, bounds.minY, bounds.maxY),
  };
}

function syncPairProximity(a: CharacterSpatialState, b: CharacterSpatialState, confirmedContact = false) {
  const proximity = proximityFor(a, b, confirmedContact);
  return { a: { ...a, proximity }, b: { ...b, proximity } };
}

function placePair(a: CharacterSpatialState, b: CharacterSpatialState, gap: number, turn: number) {
  const aFirst = a.x <= b.x;
  const bounds = spatialBounds(a);
  const center = clamp((a.x + b.x) / 2, bounds.minX + gap / 2, bounds.maxX - gap / 2);
  const y = clamp((a.y + b.y) / 2, bounds.minY, bounds.maxY);
  const leftX = center - gap / 2;
  const rightX = center + gap / 2;
  return {
    a: { ...a, x: aFirst ? leftX : rightX, y, facing: aFirst ? "right" as const : "left" as const, updatedTurn: turn },
    b: { ...b, x: aFirst ? rightX : leftX, y, facing: aFirst ? "left" as const : "right" as const, updatedTurn: turn },
  };
}

const SESSION_MOVE_STEP = 5;
const SESSION_COLLISION_DISTANCE = 7;

/**
 * Scene adapters can populate these rectangles when a world has walls or
 * furniture. The current room is an open floor, but all session movement and
 * fine alignment already pass through the same obstacle gate.
 */
const STAGE_OBSTACLES: ReadonlyArray<{
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}> = [];

function sessionParticipants(state: GameState, session: InteractionSession) {
  return {
    initiator: state.spatial[session.initiatorId],
    receiver: state.spatial[session.receiverId],
  };
}

function canOccupySessionPosition(
  state: GameState,
  movingId: string,
  partnerId: string,
  candidate: CharacterSpatialState,
) {
  const bounds = spatialBounds(candidate);
  if (candidate.x < bounds.minX || candidate.x > bounds.maxX || candidate.y < bounds.minY || candidate.y > bounds.maxY) return false;
  if (STAGE_OBSTACLES.some((obstacle) => (
    candidate.x >= obstacle.minX
      && candidate.x <= obstacle.maxX
      && candidate.y >= obstacle.minY
      && candidate.y <= obstacle.maxY
  ))) return false;
  return state.agents.every((agent) => {
    if (agent.id === movingId || agent.id === partnerId) return true;
    const other = state.spatial[agent.id];
    return !other || spatialDistance(candidate, other) >= SESSION_COLLISION_DISTANCE;
  });
}

function moveTowardSessionTarget(
  state: GameState,
  self: CharacterSpatialState,
  target: CharacterSpatialState,
  desiredDistance: number,
) {
  const distance = spatialDistance(self, target);
  if (distance <= desiredDistance) return { spatial: self, moved: false, blocked: false };
  const nextDesired = Math.max(desiredDistance, distance - SESSION_MOVE_STEP);
  const direct = moveToward(self, target, nextDesired);
  if (canOccupySessionPosition(state, self.agentId, target.agentId, direct)) return { spatial: direct, moved: true, blocked: false };
  const bounds = spatialBounds(self);
  for (const yOffset of [-4, 4]) {
    const detour = { ...direct, y: clamp(direct.y + yOffset, bounds.minY, bounds.maxY) };
    if (canOccupySessionPosition(state, self.agentId, target.agentId, detour)) return { spatial: detour, moved: true, blocked: false };
  }
  return { spatial: self, moved: false, blocked: true };
}

function updateInteractionEvent(events: ChronicleEvent[], session: InteractionSession) {
  return events.map((event) => event.id === session.eventId ? { ...event, interactionSession: session } : event);
}

function transitionSession(state: GameState, session: InteractionSession, spatial: Record<string, CharacterSpatialState>, notice: string) {
  return {
    ...state,
    spatial,
    interactionSession: session,
    events: updateInteractionEvent(state.events, session),
    lastNotice: notice,
  };
}

function faceSessionPair(initiator: CharacterSpatialState, receiver: CharacterSpatialState, session: InteractionSession, intent: SpatialIntent) {
  const faced = facePairTowardEachOther(initiator, receiver);
  return {
    initiator: { ...faced.a, targetId: receiver.agentId, intent, interactionId: session.id },
    receiver: { ...faced.b, targetId: initiator.agentId, intent: intent === "approach" ? "observe" as const : intent, interactionId: session.id },
  };
}

function orientSessionPlaybackPair(
  initiator: CharacterSpatialState,
  receiver: CharacterSpatialState,
  session: InteractionSession,
  intent: SpatialIntent,
) {
  if (session.facingMode !== "travel_direction") return faceSessionPair(initiator, receiver, session, intent);
  const facing = initiator.facing === receiver.facing
    ? initiator.facing
    : (initiator.x + receiver.x) / 2 <= 50 ? "right" as const : "left" as const;
  return {
    initiator: { ...initiator, facing, targetId: receiver.agentId, intent, interactionId: session.id },
    receiver: { ...receiver, facing, targetId: initiator.agentId, intent, interactionId: session.id },
  };
}

function beginInteractionSessionSpatial(state: GameState, session: InteractionSession) {
  const current = normalizeSpatial(state.agents, state.spatial);
  const initiator = current[session.initiatorId];
  const receiver = current[session.receiverId];
  if (!initiator || !receiver) return { ...state, interactionSession: null };
  const faced = faceSessionPair(initiator, receiver, session, "observe");
  return {
    ...state,
    spatial: refreshBystanderPerception(state.agents, { ...current, [initiator.agentId]: faced.initiator, [receiver.agentId]: faced.receiver }, new Set([initiator.agentId, receiver.agentId])),
    interactionSession: session,
    events: updateInteractionEvent(state.events, session),
    lastNotice: "双人交互会话已建立；双方先确认朝向，再按空间等级执行。",
  };
}

function sessionFailure(
  state: GameState,
  session: InteractionSession,
  initiator: CharacterSpatialState,
  receiver: CharacterSpatialState,
  reason: string,
) {
  const nextSession: InteractionSession = { ...session, phase: "recover", phaseStep: 0, match: "invalid", failureReason: reason };
  const faced = faceSessionPair(initiator, receiver, nextSession, "observe");
  const paired = syncPairProximity({ ...faced.initiator, proximity: "near" }, { ...faced.receiver, proximity: "near" });
  paired.a.perception = `这次互动无法安全完成，已改为面对对方的非接触回应：${reason}`;
  paired.b.perception = `空间执行器没有强行吸附或穿模：${reason}`;
  return transitionSession(
    state,
    nextSession,
    { ...state.spatial, [initiator.agentId]: paired.a, [receiver.agentId]: paired.b },
    `双人动作已安全降级：${reason}`,
  );
}

function fineAlignSessionPair(
  state: GameState,
  session: InteractionSession,
  initiator: CharacterSpatialState,
  receiver: CharacterSpatialState,
) {
  if (session.validation?.match === "invalid") return { ok: false as const, reason: session.validation.summary };
  const initiatorOnLeft = initiator.x <= receiver.x;
  const visibleContactDistance = Math.max(session.idealDistance, minimumOccupancyHorizontalGap(initiator, receiver));
  const stableReceiver = ["touch", "head_touch", "pat", "push"].includes(session.kind);
  const centerX = (initiator.x + receiver.x) / 2;
  const desiredInitiatorX = stableReceiver
    ? receiver.x + (initiatorOnLeft ? -visibleContactDistance : visibleContactDistance)
    : centerX + (initiatorOnLeft ? -visibleContactDistance / 2 : visibleContactDistance / 2);
  const desiredReceiverX = stableReceiver
    ? receiver.x
    : centerX + (initiatorOnLeft ? visibleContactDistance / 2 : -visibleContactDistance / 2);
  const verticalShift = Math.max(-2, Math.min(2, session.validation?.adjustments.target.y || 0));
  const initiatorBounds = spatialBounds(initiator);
  const receiverBounds = spatialBounds(receiver);
  const desiredInitiator = { ...initiator, x: clamp(desiredInitiatorX, initiatorBounds.minX, initiatorBounds.maxX), y: clamp(initiator.y - verticalShift / 2, initiatorBounds.minY, initiatorBounds.maxY) };
  const desiredReceiver = { ...receiver, x: clamp(desiredReceiverX, receiverBounds.minX, receiverBounds.maxX), y: clamp(receiver.y + verticalShift / 2, receiverBounds.minY, receiverBounds.maxY) };
  const initiatorCorrection = spatialDistance(initiator, desiredInitiator);
  const receiverCorrection = spatialDistance(receiver, desiredReceiver);
  if (initiatorCorrection > session.maxRootCorrection + 0.5 || receiverCorrection > session.maxRootCorrection + 0.5) {
    return { ok: false as const, reason: "所需根节点修正超过允许范围" };
  }
  if (!canOccupySessionPosition(state, initiator.agentId, receiver.agentId, desiredInitiator)
    || !canOccupySessionPosition(state, receiver.agentId, initiator.agentId, desiredReceiver)) {
    return { ok: false as const, reason: "细对齐会碰撞第三名角色或越出场景边界" };
  }
  const validationMatch = session.validation?.match || "acceptable";
  const occupancyAdjusted = visibleContactDistance > session.idealDistance + 0.1;
  const match: InteractionMatchResult = validationMatch === "perfect"
    && !occupancyAdjusted
    && Math.max(initiatorCorrection, receiverCorrection) <= session.maxRootCorrection * 0.55
    ? "perfect"
    : "acceptable";
  const faced = faceSessionPair(
    { ...desiredInitiator, renderScale: session.validation?.adjustments.actor.scale || 1 },
    { ...desiredReceiver, renderScale: session.validation?.adjustments.target.scale || 1 },
    session,
    "align",
  );
  return { ok: true as const, initiator: faced.initiator, receiver: faced.receiver, match };
}

function completeInteractionSession(state: GameState, session: InteractionSession, initiator: CharacterSpatialState, receiver: CharacterSpatialState) {
  const completed: InteractionSession = { ...session, phase: "complete", phaseStep: 0 };
  const resultText = session.match === "invalid"
    ? `这次${session.kind}因${session.failureReason || "空间不匹配"}降级为非接触回应。`
    : session.failureReason
      ? session.failureReason
    : `这次${session.kind}以${session.match === "perfect" ? "完整" : "可接受"}空间匹配完成，双方随后恢复自主行动。`;
  const paired = syncPairProximity(
    { ...initiator, interactionId: null, intent: "idle", renderScale: 1 },
    { ...receiver, interactionId: null, intent: "idle", renderScale: 1 },
  );
  paired.a.perception = resultText;
  paired.b.perception = resultText;
  const agents = state.agents.map((agent) => [session.initiatorId, session.receiverId].includes(agent.id)
    ? { ...agent, memory: { ...agent.memory, recent: [resultText, ...agent.memory.recent].slice(0, 6) } }
    : agent);
  const events = state.events.map((event) => event.id === session.eventId ? {
    ...event,
    interactionSession: completed,
    impact: `${event.impact}；${resultText}`,
    memoryWrites: {
      ...event.memoryWrites,
      [session.initiatorId]: `${event.memoryWrites[session.initiatorId] || ""} ${resultText}`.trim(),
      [session.receiverId]: `${event.memoryWrites[session.receiverId] || ""} ${resultText}`.trim(),
    },
  } : event);
  return {
    ...state,
    agents,
    spatial: refreshBystanderPerception(state.agents, { ...state.spatial, [initiator.agentId]: paired.a, [receiver.agentId]: paired.b }, new Set([initiator.agentId, receiver.agentId])),
    events,
    interactionSession: null,
    lastNotice: resultText,
  };
}

function advanceInteractionSession(state: GameState): GameState {
  const session = state.interactionSession;
  if (!session) return state;
  const { initiator, receiver } = sessionParticipants(state, session);
  if (!initiator || !receiver) return { ...state, interactionSession: null, lastNotice: "互动参与者不存在，会话已安全结束。" };
  if (session.phase === "orient") {
    const faced = faceSessionPair(initiator, receiver, session, "observe");
    if ((session.spaceLevel === "contact" || session.spaceLevel === "sustained") && session.validation?.match === "invalid") {
      return sessionFailure(state, session, faced.initiator, faced.receiver, session.validation.summary);
    }
    const nextPhase: InteractionSessionPhase = session.spaceLevel === "orientation" ? "prepare" : "approach";
    const distance = spatialDistance(faced.initiator, faced.receiver);
    const orientationTooFar = session.spaceLevel === "orientation" && distance > session.idealDistance + session.allowedError;
    const match: InteractionMatchResult = session.spaceLevel === "orientation"
      ? distance <= session.idealDistance + session.allowedError ? "perfect" : "acceptable"
      : session.match;
    const nextSession = { ...session, phase: orientationTooFar ? "recover" as const : nextPhase, phaseStep: 0, match, failureReason: orientationTooFar ? "双方距离过远，本轮只完成转向，不自动移动；角色可在下一回合自主决定是否走近。" : null };
    return transitionSession(state, nextSession, { ...state.spatial, [initiator.agentId]: faced.initiator, [receiver.agentId]: faced.receiver }, orientationTooFar ? nextSession.failureReason! : `双方已按实际位置面对面；下一阶段：${nextPhase === "approach" ? "正常移动" : "动作准备"}。`);
  }
  if (session.phase === "approach") {
    const visibleContactDistance = session.spaceLevel === "approach"
      ? centerDistanceForBodyGap(initiator, receiver, 0.5)
      : minimumOccupancyHorizontalGap(initiator, receiver);
    const preAlignmentDistance = session.spaceLevel === "approach"
      ? Math.max(session.idealDistance, visibleContactDistance)
      : Math.max(session.idealDistance + session.maxRootCorrection, visibleContactDistance);
    const movement = moveTowardSessionTarget(state, initiator, receiver, preAlignmentDistance);
    const faced = faceSessionPair(movement.spatial, receiver, session, "approach");
    const distance = spatialDistance(faced.initiator, faced.receiver);
    if (movement.blocked && session.phaseStep >= 2) return sessionFailure(state, session, faced.initiator, faced.receiver, "正常移动路径被角色或场景边界阻挡");
    const arrived = distance <= preAlignmentDistance + 0.75;
    const nextPhase: InteractionSessionPhase = arrived ? session.spaceLevel === "approach" ? "prepare" : "align" : "approach";
    const nextSession = { ...session, phase: nextPhase, phaseStep: arrived ? 0 : session.phaseStep + 1, match: session.spaceLevel === "approach" && arrived ? "perfect" as const : session.match };
    return transitionSession(state, nextSession, { ...state.spatial, [initiator.agentId]: faced.initiator, [receiver.agentId]: faced.receiver }, arrived ? "已通过正常移动到达预备位置，没有吸附或瞬移。" : "发起者正在按真实速度接近，对方位置保持不变。" );
  }
  if (session.phase === "align") {
    const aligned = fineAlignSessionPair(state, session, initiator, receiver);
    if (!aligned.ok) return sessionFailure(state, session, initiator, receiver, aligned.reason);
    const nextSession: InteractionSession = { ...session, phase: "prepare", phaseStep: 0, match: aligned.match };
    return transitionSession(state, nextSession, { ...state.spatial, [initiator.agentId]: aligned.initiator, [receiver.agentId]: aligned.receiver }, `骨骼细对齐完成：${aligned.match === "perfect" ? "完美匹配" : "可视边界贴边，无穿模"}。`);
  }
  if (session.phase === "prepare") {
    const faced = orientSessionPlaybackPair(initiator, receiver, session, session.spaceLevel === "sustained" ? "paired" : "observe");
    const nextSession = { ...session, phase: "contact_start" as const, phaseStep: 0 };
    return transitionSession(state, nextSession, { ...state.spatial, [initiator.agentId]: faced.initiator, [receiver.agentId]: faced.receiver }, "双方动作已进入 prepare，下一关键标记为 contact_start。" );
  }
  if (session.phase === "contact_start") {
    const confirmedContact = session.spaceLevel === "contact" && session.kind !== "push";
    const faced = orientSessionPlaybackPair(initiator, receiver, session, session.spaceLevel === "sustained" ? "paired" : confirmedContact ? "cuddle" : "observe");
    const paired = syncPairProximity(faced.initiator, faced.receiver, confirmedContact);
    const nextSession = { ...session, phase: "contact_hold" as const, phaseStep: 0 };
    return transitionSession(state, nextSession, { ...state.spatial, [initiator.agentId]: paired.a, [receiver.agentId]: paired.b }, "关键阶段已对齐：contact_start → contact_hold。" );
  }
  if (session.phase === "contact_hold") {
    let nextInitiator = initiator;
    let nextReceiver = receiver;
    if (session.movesTogether) {
      const direction = initiator.facing === "right" ? 1 : -1;
      const initiatorBounds = spatialBounds(initiator);
      const receiverBounds = spatialBounds(receiver);
      const translatedInitiator = { ...initiator, x: clamp(initiator.x + direction * 2.5, initiatorBounds.minX, initiatorBounds.maxX) };
      const translatedReceiver = { ...receiver, x: clamp(receiver.x + direction * 2.5, receiverBounds.minX, receiverBounds.maxX) };
      if (canOccupySessionPosition(state, initiator.agentId, receiver.agentId, translatedInitiator)
        && canOccupySessionPosition(state, receiver.agentId, initiator.agentId, translatedReceiver)) {
        nextInitiator = translatedInitiator;
        nextReceiver = translatedReceiver;
      }
    } else if (session.kind === "push" && session.phaseStep > 0) {
      nextReceiver = moveAway(receiver, initiator, session.idealDistance + 6);
    }
    const faced = orientSessionPlaybackPair(nextInitiator, nextReceiver, session, session.spaceLevel === "sustained" ? "paired" : session.spaceLevel === "contact" ? "cuddle" : "observe");
    const holdAgain = session.phaseStep < (session.spaceLevel === "sustained" ? 2 : 1);
    const nextSession = { ...session, phase: holdAgain ? "contact_hold" as const : "contact_end" as const, phaseStep: holdAgain ? session.phaseStep + 1 : 0 };
    return transitionSession(state, nextSession, { ...state.spatial, [initiator.agentId]: faced.initiator, [receiver.agentId]: faced.receiver }, holdAgain ? "双方正在维持关键阶段约束。" : "接触保持完成，双方准备分别恢复。" );
  }
  if (session.phase === "contact_end") {
    const faced = orientSessionPlaybackPair({ ...initiator, proximity: "near" }, { ...receiver, proximity: "near" }, session, "observe");
    const nextSession = { ...session, phase: "recover" as const, phaseStep: 0 };
    return transitionSession(state, nextSession, { ...state.spatial, [initiator.agentId]: faced.initiator, [receiver.agentId]: faced.receiver }, "contact_end 已完成，互动约束正在释放。" );
  }
  if (session.phase === "recover" || session.phase === "cancelled") return completeInteractionSession(state, session, initiator, receiver);
  return state;
}

function refreshBystanderPerception(agents: StoryAgent[], spatial: Record<string, CharacterSpatialState>, activeIds: Set<string>) {
  const next = { ...spatial };
  agents.forEach((agent) => {
    if (activeIds.has(agent.id)) return;
    const self = next[agent.id];
    const nearest = agents.filter((item) => item.id !== agent.id).map((item) => ({ agent: item, spatial: next[item.id] })).filter((item) => item.spatial).sort((left, right) => spatialDistance(self, left.spatial) - spatialDistance(self, right.spatial))[0];
    if (!nearest) {
      next[agent.id] = { ...self, targetId: null, intent: self.intent === "wander" ? "wander" : "rest", proximity: "alone", perception: "这里暂时只有我一个人。" };
      return;
    }
    const proximity = proximityFor(self, nearest.spatial);
    next[agent.id] = { ...self, facing: self.intent === "wander" ? self.facing : facingToward(self, nearest.spatial), targetId: nearest.agent.id, intent: self.intent === "wander" ? "wander" : "observe", proximity, perception: `我看见${nearest.agent.name}${nearest.spatial.intent === "cuddle" ? "正在和别人贴贴" : nearest.spatial.intent === "retreat" ? "正在走开" : "在房间里活动"}。` };
  });
  return next;
}

// R1: memoize by (state, surface). GameState is immutable per dispatch, so a
// WeakMap keyed on the state reference gives us free invalidation.
const projectionCache = new WeakMap<GameState, Partial<Record<RuntimeSurface, GameState>>>();

export function projectRuntimeSurface(state: GameState, surface: RuntimeSurface): GameState {
  const cached = projectionCache.get(state)?.[surface];
  if (cached) return cached;
  const result = projectRuntimeSurfaceUncached(state, surface);
  let bucket = projectionCache.get(state);
  if (!bucket) { bucket = {}; projectionCache.set(state, bucket); }
  bucket[surface] = result;
  return result;
}

function projectRuntimeSurfaceUncached(state: GameState, surface: RuntimeSurface): GameState {
  if (surface === "desktop_pet" && state.mode !== "natural") return state;
  if (state.surface === surface && Object.values(state.spatial).every((item) => item.coordinateSpace === (surface === "desktop_pet" ? "desktop" : "stage"))) return state;
  const spatial = Object.fromEntries(state.agents.map((agent) => {
    const current = state.spatial[agent.id] || normalizeSpatial(state.agents, state.spatial)[agent.id];
    if (surface === "desktop_pet") {
      const y = current.coordinateSpace === "desktop" ? current.y : 58 + ((current.y - 57) / 22) * 30;
      return [agent.id, { ...current, x: clamp(current.x, 4, 96), y: clamp(y, 8, 92), coordinateSpace: "desktop" as const }];
    }
    const y = current.coordinateSpace === "desktop" ? 57 + ((current.y - 8) / 84) * 22 : current.y;
    return [agent.id, { ...current, x: clamp(current.x, 12, 88), y: clamp(y, 57, 79), coordinateSpace: "stage" as const }];
  }));
  return {
    ...state,
    surface,
    spatial: normalizeSpatial(state.agents, spatial),
    desktopAttentionQueue: surface === "web" ? [] : state.desktopAttentionQueue,
    desktopTransientReaction: surface === "web" ? null : state.desktopTransientReaction,
  };
}

function nearestSpatialAgent(state: GameState, agentId: string, spatial: Record<string, CharacterSpatialState>) {
  const self = spatial[agentId];
  return state.agents
    .filter((agent) => agent.id !== agentId && spatial[agent.id])
    .map((agent) => ({ agent, spatial: spatial[agent.id], distance: spatialDistance(self, spatial[agent.id]) }))
    .sort((left, right) => left.distance - right.distance)[0] || null;
}

function canOccupyIndependentPosition(state: GameState, movingId: string, candidate: CharacterSpatialState) {
  return state.agents.every((agent) => {
    if (agent.id === movingId) return true;
    const other = state.spatial[agent.id];
    return !other || !spatialOccupancyOverlaps(candidate, other);
  });
}

function applyDesktopDrag(
  state: GameState,
  action: Extract<GameAction, { type: "APPLY_DESKTOP_DRAG" }>,
) {
  if (state.phase !== "town" || state.surface !== "desktop_pet") return state;
  const actor = state.agents.find((agent) => agent.id === action.agentId);
  if (!actor) return state;
  // A live pointer drag is allowed to pass over other characters. Resolving
  // occupancy here would make every pointer frame push the rest of the cast.
  const current = normalizeSpatial(state.agents, state.spatial, { skipOccupancy: true });
  const previous = current[actor.id];
  const x = clamp(action.x, 4, 96);
  const y = clamp(action.y, 8, 92);
  let moved: CharacterSpatialState = {
    ...previous,
    x,
    y,
    coordinateSpace: "desktop",
    facing: x === previous.x ? previous.facing : x > previous.x ? "right" : "left",
    intent: action.phase === "move" ? "wander" : "idle",
    perception: action.phase === "move" ? "玩家正在移动我的桌面位置；其他角色只能看到这次公开的位置变化。" : "我被放到了新的桌面位置，之后会从这里自主决定怎么移动。",
    updatedTurn: action.phase === "drop" ? state.turn + 1 : state.turn,
    interactionId: null,
  };
  let nextSpatial = { ...current, [actor.id]: moved };

  if (action.phase === "move") {
    const nearest = nearestSpatialAgent(state, actor.id, nextSpatial);
    nextSpatial[actor.id] = {
      ...moved,
      targetId: nearest?.agent.id || null,
      proximity: nearest ? proximityFor(moved, nearest.spatial) : "alone",
    };
    return { ...state, spatial: nextSpatial, lastNotice: `${actor.name}正在被拖动；其他角色保持原位。` };
  }

  const separated = separateSpatialOccupancy(state.agents, nextSpatial, { fixedIds: [actor.id] });
  nextSpatial = separated.spatial;
  moved = nextSpatial[actor.id];
  const nearest = nearestSpatialAgent(state, actor.id, nextSpatial);
  moved = {
    ...moved,
    targetId: nearest?.agent.id || null,
    proximity: nearest ? proximityFor(moved, nearest.spatial) : "alone",
  };
  nextSpatial[actor.id] = moved;
  const separatedIds = new Set(separated.movedIds);
  const overlapResolved = separatedIds.size > 0;

  const eventId = `event-desktop-drag-${state.turn + 1}-${hash(`${actor.id}-${x}-${y}`)}`;
  const observers = state.agents.filter((agent) => agent.id !== actor.id);
  const attention: DesktopAttentionTrigger[] = [];
  const assetActions: Record<string, string> = { [actor.id]: "idle" };
  const actorIsNear = moved.proximity === "near" && Boolean(nearest);
  attention.push({
    actorId: actor.id,
    counterpartId: nearest?.agent.id || null,
    eventId,
    reason: actorIsNear
      ? `玩家把我拖到了${nearest!.agent.name}附近。这只是公开位置变化，不代表我或对方主动同意接触。请按我的 Character Profile 与 Relationship Lens 独立判断情绪并说一句符合本人语气的短话；若我并不排斥，高权重考虑害羞、脸红、嘴硬或短暂慌乱，也可以生气、拒绝、走开或沉默。`
      : `玩家改变了我的桌面位置；我可以按自己的性格说话、沉默、停留、走开或继续原本行动。`,
    recordInChronicle: true,
  });
  observers.forEach((observer) => {
    const observerSpatial = nextSpatial[observer.id];
    const oldProximity = proximityFor(observerSpatial, previous);
    const newProximity = proximityFor(observerSpatial, moved);
    const abruptlyGone = action.sudden && (oldProximity === "near" || oldProximity === "normal") && newProximity === "far";
    const separatedFromOverlap = separatedIds.has(observer.id);
    nextSpatial[observer.id] = {
      ...observerSpatial,
      targetId: actor.id,
      facing: facingToward(observerSpatial, moved),
      intent: "observe",
      proximity: newProximity,
      perception: separatedFromOverlap
        ? `刚才和${actor.name}的可视重叠超过了一半，我只轻微挪动到不再过度重叠。`
        : abruptlyGone
        ? `刚才${actor.name}还在附近，现在被玩家突然拖远了；我可以吃惊、观察、呼唤、沉默或继续自己的事。`
        : newProximity === "near"
          ? `我注意到${actor.name}被玩家放到了附近；是否回应由我自己决定。`
          : newProximity === "normal"
            ? `我看见${actor.name}被玩家放到了正常社交距离；是否回应由我自己决定。`
          : `我看见${actor.name}被移动到了更远的位置；是否在意和怎样回应由我自己决定。`,
      updatedTurn: state.turn + 1,
    };
    attention.push({
      actorId: observer.id,
      counterpartId: actor.id,
      eventId,
      reason: newProximity === "near"
        ? `玩家把${actor.name}拖到了我附近。这只是公开位置变化，不等于我同意身体接触。请按我的 Character Profile 与 Relationship Lens 独立判断情绪并说一句符合本人语气的短话；若我并不排斥，高权重考虑害羞、脸红、嘴硬或短暂慌乱，也可以生气、拒绝、走开或沉默。`
        : separatedFromOverlap ? `与${actor.name}的可视重叠超过一半后做了轻微位置调整` : abruptlyGone ? `${actor.name}突然离开了原本可感知的近距离` : `${actor.name}的桌面位置被玩家明显改变`,
      recordInChronicle: true,
    });
    assetActions[observer.id] = separatedFromOverlap ? "walk" : "listen";
  });
  const event: ChronicleEvent = {
    id: eventId,
    day: state.day,
    time: eventTime(state.turn + 1),
    kind: "system",
    mode: "natural",
    level: "L1",
    actorIds: [actor.id],
    title: `${actor.name}被移动到新的桌面位置`,
    summary: overlapResolved ? `玩家移动了${actor.name}并保留了落点；只在可视重叠超过一半时，其他角色才轻微挪动。` : action.sudden ? `玩家快速拖动了${actor.name}；其他角色只获得公开距离变化，并分别决定是否回应。` : `玩家调整了${actor.name}的位置；这不会直接指定任何角色的情绪或关系结果。`,
    dialogue: [],
    impact: "更新桌面距离与公开感知；受影响角色进入独立回应队列",
    memoryWrite: "我被玩家移动到了新的桌面位置。",
    memoryWrites: { [actor.id]: "我被玩家移动到了新的桌面位置。" },
    sceneId: scenes.desktop.id,
    relationshipReason: "玩家只能改变公开空间事实；Relationship Judge 没有因此直接修改任何方向关系",
    assetActions,
  };
  return {
    ...state,
    turn: state.turn + 1,
    interactionSession: null,
    spatial: nextSpatial,
    events: [event, ...state.events].slice(0, 100),
    desktopAttentionQueue: [...state.desktopAttentionQueue, ...attention].slice(-6),
    lastNotice: overlapResolved ? `已保留${actor.name}的拖拽落点；只对超过 50% 的重叠做了轻微位置调整。` : attention.length ? `${actor.name}已停在拖拽落点，之后会从这里继续行动；${observers.map((item) => item.name).join("、")}已感知到距离变化。` : `${actor.name}已经停在新的桌面位置，之后会从这里继行动。`,
  };
}

function applyDesktopPointerEvent(
  state: GameState,
  action: Extract<GameAction, { type: "APPLY_DESKTOP_POINTER_EVENT" }>,
) {
  if (state.phase !== "town" || state.surface !== "desktop_pet") return state;
  const actor = state.agents.find((agent) => agent.id === action.agentId);
  if (!actor) return state;
  const current = normalizeSpatial(state.agents, state.spatial);
  const nearest = nearestSpatialAgent(state, actor.id, current);
  const eventId = `transient-desktop-pointer-${state.turn}-${hash(`${actor.id}-${action.kind}-${state.desktopAttentionQueue.length}`)}`;
  return {
    ...state,
    spatial: {
      ...current,
      [actor.id]: {
        ...current[actor.id],
        targetId: nearest?.agent.id || null,
        intent: "observe" as const,
        perception: "玩家刚刚点击了我；怎样回应仍由我自己决定。",
        updatedTurn: state.turn,
      },
    },
    desktopAttentionQueue: [...state.desktopAttentionQueue, { actorId: actor.id, counterpartId: nearest?.agent.id || null, eventId, reason: "玩家在桌面上发出了不进入卷轴的短暂互动触发", recordInChronicle: false }].slice(-6),
    lastNotice: `${actor.name}已经感知到玩家互动；若没有产生位置移动，这次回应不会进入卷轴。`,
  };
}

function dismissDesktopAttention(state: GameState, agentId: string): GameState {
  if (state.phase !== "town" || state.surface !== "desktop_pet") return state;
  const actor = state.agents.find((agent) => agent.id === agentId);
  if (!actor) return state;
  return {
    ...state,
    desktopAttentionQueue: state.desktopAttentionQueue.filter((trigger) => trigger.actorId !== actor.id),
    desktopTransientReaction: state.desktopTransientReaction?.agentId === actor.id ? null : state.desktopTransientReaction,
    lastNotice: `${actor.name}的 Character Agent 未返回有效结果；本次触发已静默结束，没有伪造台词、动作或记忆。`,
  };
}

function resolveSpatialInteraction(state: GameState, actor: StoryAgent, responder: StoryAgent, proposal: SocialProposal, response: SocialResponse, duoValidation?: DuoInteractionValidation) {
  const current = normalizeSpatial(state.agents, state.spatial);
  const actorSpatial = current[actor.id];
  const responderSpatial = current[responder.id];
  const accepted = response.response === "accept";
  const rejected = response.response === "reject" || response.response === "soft_reject";
  const needsSpace = proposal.intent === "ask_for_space" || rejected;
  const affectionate = accepted && proposal.intent === "seek_affection" && (!duoValidation || duoValidation.compatible);
  const comforting = accepted && proposal.intent === "offer_comfort";
  const playing = accepted && proposal.intent === "invite_play";
  const contactAdjusted = accepted && duoValidation && !duoValidation.compatible;
  if (!duoValidation) {
    let nextActor: CharacterSpatialState = { ...actorSpatial, targetId: responder.id, updatedTurn: state.turn + 1, renderScale: 1 };
    let nextResponder: CharacterSpatialState = { ...responderSpatial, targetId: actor.id, updatedTurn: state.turn + 1, renderScale: 1 };
    if (needsSpace) {
      nextActor = { ...moveAway(nextActor, nextResponder, centerDistanceForBodyGap(nextActor, nextResponder, 1)), intent: proposal.intent === "ask_for_space" ? "retreat" : "keep_distance" };
      nextResponder = { ...nextResponder, intent: rejected ? "retreat" : "keep_distance" };
    } else if (accepted) {
      nextActor = { ...moveToward(nextActor, nextResponder, centerDistanceForBodyGap(nextActor, nextResponder, 0.5)), intent: comforting ? "comfort" : "approach" };
      nextResponder = { ...nextResponder, intent: comforting ? "comfort" : "observe" };
    } else {
      nextActor = { ...nextActor, intent: "observe" };
      nextResponder = { ...nextResponder, intent: "observe" };
    }
    nextActor = { ...nextActor, facing: needsSpace ? facingAway(nextActor, nextResponder) : facingToward(nextActor, nextResponder) };
    nextResponder = { ...nextResponder, facing: rejected ? facingAway(nextResponder, nextActor) : facingToward(nextResponder, nextActor) };
    const paired = syncPairProximity(nextActor, nextResponder);
    paired.a.perception = needsSpace ? `我已经向${responder.name}留出了明确距离。` : `我看见${responder.name}，并只移动了自己的位置。`;
    paired.b.perception = needsSpace ? `我看见${actor.name}尊重了这次距离调整。` : `我看见${actor.name}走到附近，我的位置没有被系统改写。`;
    return refreshBystanderPerception(
      state.agents,
      { ...current, [actor.id]: paired.a, [responder.id]: paired.b },
      new Set([actor.id, responder.id]),
    );
  }
  const gap = affectionate
    ? centerDistanceForBodyGap(actorSpatial, responderSpatial, 0)
    : needsSpace
      ? centerDistanceForBodyGap(actorSpatial, responderSpatial, 1)
      : contactAdjusted || accepted
        ? centerDistanceForBodyGap(actorSpatial, responderSpatial, 0.5)
        : centerDistanceForBodyGap(actorSpatial, responderSpatial, 1);
  const placed = placePair(actorSpatial, responderSpatial, gap, state.turn + 1);
  const proximity = proximityFor(placed.a, placed.b);
  let nextActor: CharacterSpatialState;
  let nextResponder: CharacterSpatialState;
  if (proposal.intent === "ask_for_space") {
    nextActor = { ...placed.a, renderScale: 1, targetId: responder.id, intent: "retreat", proximity, perception: `我看见${responder.name}，但现在更需要自己的空间。` };
    nextResponder = { ...placed.b, renderScale: 1, targetId: actor.id, intent: "keep_distance", proximity, perception: `我听见${actor.name}请求独处，所以没有继续靠近。` };
  } else if (rejected) {
    nextActor = { ...placed.a, renderScale: 1, targetId: responder.id, intent: "keep_distance", proximity, perception: `${responder.name}不愿意靠近，我停下来并留出距离。` };
    nextResponder = { ...placed.b, renderScale: 1, targetId: actor.id, intent: "retreat", proximity, perception: `我看见${actor.name}靠近，但我现在不舒服，所以走远一点。` };
  } else if (affectionate) {
    const actorFirst = placed.a.x <= placed.b.x;
    const centerX = (placed.a.x + placed.b.x) / 2;
    const actorBounds = spatialBounds(placed.a);
    const responderBounds = spatialBounds(placed.b);
    const actorX = clamp(centerX + (actorFirst ? duoValidation?.adjustments.actor.x || -4 : -(duoValidation?.adjustments.actor.x || -4)), actorBounds.minX, actorBounds.maxX);
    const responderX = clamp(centerX + (actorFirst ? duoValidation?.adjustments.target.x || 4 : -(duoValidation?.adjustments.target.x || 4)), responderBounds.minX, responderBounds.maxX);
    nextActor = { ...placed.a, x: actorX, y: clamp(placed.a.y + (duoValidation?.adjustments.actor.y || 0), actorBounds.minY, actorBounds.maxY), renderScale: duoValidation?.adjustments.actor.scale || 1, targetId: responder.id, intent: "cuddle", proximity: "touching", perception: `${responder.name}明确接受了，我才在骨骼与接触点校验后靠近。` };
    nextResponder = { ...placed.b, x: responderX, y: clamp(placed.b.y + (duoValidation?.adjustments.target.y || 0), responderBounds.minY, responderBounds.maxY), renderScale: duoValidation?.adjustments.target.scale || 1, targetId: actor.id, intent: "cuddle", proximity: "touching", perception: `我看见${actor.name}先询问，也愿意回应这次经过对齐的接触。` };
  } else if (contactAdjusted) {
    nextActor = { ...placed.a, renderScale: 1, targetId: responder.id, intent: "approach", proximity: "near", perception: `${responder.name}愿意回应，但双人动作校验未通过，所以我停在安全近距离。` };
    nextResponder = { ...placed.b, renderScale: 1, targetId: actor.id, intent: "observe", proximity: "near", perception: `我愿意回应，但系统把无法稳定对齐的接触改成了近距离动作。` };
  } else if (accepted) {
    const actorFirst = placed.a.x <= placed.b.x;
    const centerX = (placed.a.x + placed.b.x) / 2;
    const actorBounds = spatialBounds(placed.a);
    const responderBounds = spatialBounds(placed.b);
    const alignedActorX = duoValidation?.compatible ? clamp(centerX + (actorFirst ? duoValidation.adjustments.actor.x : -duoValidation.adjustments.actor.x), actorBounds.minX, actorBounds.maxX) : placed.a.x;
    const alignedResponderX = duoValidation?.compatible ? clamp(centerX + (actorFirst ? duoValidation.adjustments.target.x : -duoValidation.adjustments.target.x), responderBounds.minX, responderBounds.maxX) : placed.b.x;
    const alignedProximity = proximityFor({ ...placed.a, x: alignedActorX }, { ...placed.b, x: alignedResponderX });
    nextActor = { ...placed.a, x: alignedActorX, y: clamp(placed.a.y + (duoValidation?.compatible ? duoValidation.adjustments.actor.y : 0), actorBounds.minY, actorBounds.maxY), renderScale: duoValidation?.compatible ? duoValidation.adjustments.actor.scale : 1, targetId: responder.id, intent: comforting ? "comfort" : playing ? "play" : "approach", proximity: alignedProximity, perception: `我注意到${responder.name}愿意回应，所以走到附近。` };
    nextResponder = { ...placed.b, x: alignedResponderX, y: clamp(placed.b.y + (duoValidation?.compatible ? duoValidation.adjustments.target.y : 0), responderBounds.minY, responderBounds.maxY), renderScale: duoValidation?.compatible ? duoValidation.adjustments.target.scale : 1, targetId: actor.id, intent: comforting ? "comfort" : playing ? "play" : "observe", proximity: alignedProximity, perception: `我看见${actor.name}靠近，也愿意让这次活动继续。` };
  } else {
    nextActor = { ...placed.a, renderScale: 1, targetId: responder.id, intent: "approach", proximity, perception: `${responder.name}还不确定，我停在能看见彼此的距离。` };
    nextResponder = { ...placed.b, renderScale: 1, targetId: actor.id, intent: "observe", proximity, perception: `我注意到${actor.name}在等待，没有越过我的边界。` };
  }
  return refreshBystanderPerception(state.agents, { ...current, [actor.id]: nextActor, [responder.id]: nextResponder }, new Set([actor.id, responder.id]));
}

function facingForAction(
  action: CharacterAgentAction | undefined,
  self: CharacterSpatialState,
  target: CharacterSpatialState,
) {
  if (["look_away", "move_away", "end_interaction", "respond_reject"].includes(action || "")) return facingAway(self, target);
  if (["observe", "move_closer", "face_other", "speak", "request_conversation", "request_touch", "request_shared_action", "respond_accept", "respond_counter"].includes(action || "")) return facingToward(self, target);
  return self.facing;
}

function requiresMutualFacing(
  actorAction: CharacterAgentAction,
  responderAction: CharacterAgentAction | undefined,
  proposal: SocialProposal,
  response: SocialResponse,
) {
  const isConversationOrGaze = proposal.intent === "honest_talk"
    || ["speak", "request_conversation", "face_other"].includes(actorAction);
  const responderDisengaged = response.response === "reject"
    || response.response === "soft_reject"
    || ["look_away", "move_away", "end_interaction", "respond_reject"].includes(responderAction || "");
  const responderParticipates = Boolean(responderAction)
    || response.response === "accept"
    || response.response === "counter";
  return isConversationOrGaze && responderParticipates && !responderDisengaged;
}

function resolveCharacterAgentSpatialInteraction(
  state: GameState,
  actor: StoryAgent,
  responder: StoryAgent,
  actorAction: CharacterAgentAction,
  responderAction: CharacterAgentAction | undefined,
  proposal: SocialProposal,
  response: SocialResponse,
  duoValidation?: DuoInteractionValidation,
) {
  // Contact and a shared paired action are the only cases that may align both
  // characters around a common centre. Ordinary speech, observation and
  // facing changes must not teleport either participant.
  if (actorAction === "request_touch" || actorAction === "request_shared_action") {
    return resolveSpatialInteraction(state, actor, responder, proposal, response, duoValidation);
  }

  const current = normalizeSpatial(state.agents, state.spatial);
  const actorCurrent = current[actor.id];
  const responderCurrent = current[responder.id];
  const rejected = response.response === "reject" || response.response === "soft_reject";
  let nextActor: CharacterSpatialState = {
    ...actorCurrent,
    targetId: responder.id,
    intent: spatialIntentForDecision(actorAction),
    updatedTurn: state.turn + 1,
  };
  let nextResponder: CharacterSpatialState = {
    ...responderCurrent,
    targetId: actor.id,
    intent: responderAction === "respond_reject" ? "keep_distance" : responderAction ? spatialIntentForDecision(responderAction) : "observe",
    updatedTurn: state.turn + 1,
  };

  if (actorAction === "move_closer") {
    nextActor = rejected
      ? moveAway(nextActor, nextResponder, centerDistanceForBodyGap(nextActor, nextResponder, 1))
      : moveToward(nextActor, nextResponder, centerDistanceForBodyGap(nextActor, nextResponder, 0.5));
    nextActor = { ...nextActor, intent: rejected ? "keep_distance" : "approach" };
    nextResponder = { ...nextResponder, intent: rejected ? "retreat" : "observe" };
  } else if (actorAction === "move_away" || actorAction === "end_interaction") {
    const bodyGap = actorAction === "end_interaction" ? 2 : 1;
    nextActor = { ...moveAway(nextActor, nextResponder, centerDistanceForBodyGap(nextActor, nextResponder, bodyGap)), intent: "retreat" };
    nextResponder = { ...nextResponder, intent: "observe" };
  }

  if (requiresMutualFacing(actorAction, responderAction, proposal, response)) {
    const faced = facePairTowardEachOther(nextActor, nextResponder);
    nextActor = faced.a;
    nextResponder = faced.b;
  } else {
    nextActor = { ...nextActor, facing: facingForAction(actorAction, nextActor, nextResponder) };
    nextResponder = { ...nextResponder, facing: facingForAction(responderAction, nextResponder, nextActor) };
  }
  const preserveExistingContact = actorAction !== "move_closer"
    && actorAction !== "move_away"
    && actorAction !== "end_interaction"
    && actorCurrent.proximity === "touching"
    && responderCurrent.proximity === "touching";
  const paired = syncPairProximity(nextActor, nextResponder, preserveExistingContact);
  const distanceCopy = paired.a.proximity === "touching" ? "仍在已同意的接触中" : paired.a.proximity === "near" ? "在可互动的近距离" : paired.a.proximity === "normal" ? "在正常社交距离" : "仍保留明显距离";
  paired.a.perception = actorAction === "move_closer" && rejected
    ? `${responder.name}不希望我继续靠近，我停下并拉开了距离。`
    : `我看见${responder.name}，我们${distanceCopy}。`;
  paired.b.perception = rejected
    ? `我向${actor.name}表达了当前的边界，对方没有继续推进。`
    : `我看见${actor.name}，我们${distanceCopy}。`;
  return refreshBystanderPerception(
    state.agents,
    { ...current, [actor.id]: paired.a, [responder.id]: paired.b },
    new Set([actor.id, responder.id]),
  );
}

function syncRelationshipDrafts(agents: StoryAgent[], current: RelationshipDraft[]) {
  const drafts: RelationshipDraft[] = [];
  for (let left = 0; left < agents.length; left += 1) {
    for (let right = left + 1; right < agents.length; right += 1) {
      const agentA = agents[left];
      const agentB = agents[right];
      const a = agentA.id;
      const b = agentB.id;
      const existing = current.find((item) => item.id === pairId(a, b));
      if (existing) {
        drafts.push(existing);
        continue;
      }
      const aToBReference = findCanonRelationship(agentA.referencePack, agentB);
      const bToAReference = findCanonRelationship(agentB.referencePack, agentA);
      const sharedHistory = [...new Set([
        ...(aToBReference?.sharedEvents || []),
        ...(bToAReference?.sharedEvents || []),
      ])].join("；").slice(0, 180);
      drafts.push({
        id: pairId(a, b),
        a,
        b,
        aToB: aToBReference
          ? { kind: referenceRelationKind(aToBReference.relationType), note: aToBReference.directionDescription.slice(0, 120) }
          : { kind: "初识", note: "" },
        bToA: bToAReference
          ? { kind: referenceRelationKind(bToAReference.relationType), note: bToAReference.directionDescription.slice(0, 120) }
          : { kind: "初识", note: "" },
        sharedHistory,
        researchSuggested: Boolean(aToBReference || bToAReference),
        referenceClaimIds: [aToBReference?.id, bToAReference?.id].filter((id): id is string => Boolean(id)),
      });
    }
  }
  return drafts;
}

function writeEventToMemory(
  agents: StoryAgent[],
  event: ChronicleEvent,
  turn = event.day,
  decisions: Record<string, CharacterAgentDecision | null> = {},
  visibleEventIds: string[] = [],
) {
  const audits: Record<string, MemoryCommitAudit> = {};
  const nextAgents = agents.map((agent) => {
    if (!event.actorIds.includes(agent.id)) return agent;
    const write = event.memoryWrites[agent.id] || event.memoryWrite;
    if (!write) return agent;
    const decision = decisions[agent.id] || null;
    const counterpartId = decision?.targetId
      || decision?.addresseeIds?.find((id) => id !== agent.id)
      || event.actorIds.find((id) => id !== agent.id)
      || null;
    const result = commitCharacterMemory({
      memory: agent.memory,
      ownerAgentId: agent.id,
      counterpartId,
      proposal: decision?.memoryProposal || null,
      fallbackText: write,
      evidenceEventId: event.id,
      visibleEventIds,
      turn,
      taskId: decision?.taskId || `runtime-${event.id}-${agent.id}`,
      readRevisions: decision?.memoryReadRevisions || [],
    });
    audits[agent.id] = result.audit;
    const roleplayMemory = appendRoleplayMemoryCue({
      memory: result.memory,
      proposal: decision?.roleplayMemory || null,
      counterpartId,
      evidenceEventId: event.id,
      turn,
    });
    return { ...agent, memory: roleplayMemory };
  });
  return { agents: nextAgents, compressed: Object.keys(audits).length, audits };
}

function appendStageHistory(
  current: Record<string, CharacterAgentStageHistoryEntry[]>,
  decision: CharacterAgentDecision,
  publicResult: string,
  turn: number,
  revisionIds: string[],
) {
  const entry: CharacterAgentStageHistoryEntry = {
    id: `stage-history-${turn}-${decision.actorId}-${hash(decision.taskId)}`,
    sessionId: decision.stageSessionId,
    turn,
    taskType: decision.taskType,
    ownAction: `${decision.action}：${decision.observableBehavior}`,
    spokenContent: decision.spokenContent,
    nonverbalBeat: decision.nonverbalBeat,
    speechAct: decision.speechAct,
    responseMode: decision.responseMode,
    topic: decision.topic,
    privateReflection: decision.privateThought,
    publicResult,
    memoryRevisionIds: revisionIds,
  };
  return { ...current, [decision.actorId]: [entry, ...(current[decision.actorId] || [])].slice(0, 10) };
}

function normalizePublicDialogue(raw: Partial<PublicDialogueState> | undefined, agents: StoryAgent[]): PublicDialogueState {
  const ids = new Set(agents.map((agent) => agent.id));
  const transcript = Array.isArray(raw?.transcript) ? raw.transcript.filter((beat) => ids.has(beat.speakerId)).map((beat, index) => ({
    id: typeof beat.id === "string" ? beat.id : `dialogue-migrated-${index}`,
    sessionId: typeof beat.sessionId === "string" ? beat.sessionId : "dialogue-migrated",
    eventId: typeof beat.eventId === "string" ? beat.eventId : "event-migrated",
    turn: Number.isFinite(beat.turn) ? beat.turn : 0,
    speakerId: beat.speakerId,
    targetId: beat.targetId && ids.has(beat.targetId) ? beat.targetId : null,
    addresseeIds: Array.isArray(beat.addresseeIds)
      ? [...new Set(beat.addresseeIds.filter((id) => ids.has(id) && id !== beat.speakerId))].slice(0, 2)
      : beat.targetId && ids.has(beat.targetId) ? [beat.targetId] : [],
    audienceIds: Array.isArray(beat.audienceIds)
      ? [...new Set(beat.audienceIds.filter((id) => ids.has(id) && id !== beat.speakerId))].slice(0, 2)
      : beat.targetId && ids.has(beat.targetId) ? [beat.targetId] : [],
    audienceScope: beat.audienceScope === "selected" || beat.audienceScope === "everyone" ? beat.audienceScope : "one",
    responseExpectation: beat.responseExpectation === "required" || beat.responseExpectation === "none" ? beat.responseExpectation : "welcome",
    participationIntent: ["join", "interrupt", "observe", "withdraw", "leave"].includes(beat.participationIntent) ? beat.participationIntent : "continue",
    spokenContent: typeof beat.spokenContent === "string" ? beat.spokenContent.slice(0, 320) : null,
    observableBehavior: typeof beat.observableBehavior === "string" ? beat.observableBehavior.slice(0, 320) : "",
    nonverbalBeat: typeof beat.nonverbalBeat === "string" ? beat.nonverbalBeat.slice(0, 240) : null,
    speechAct: beat.speechAct || "none",
    responseMode: beat.responseMode || "initiate",
    topic: typeof beat.topic === "string" ? beat.topic.slice(0, 120) : null,
  } satisfies PublicDialogueBeat)).slice(0, 30) : [];
  const pendingQuestions = Array.isArray(raw?.pendingQuestions) ? raw.pendingQuestions.filter((question) => ids.has(question.fromAgentId) && ids.has(question.toAgentId)).map((question, index) => ({
    id: typeof question.id === "string" ? question.id : `question-migrated-${index}`,
    sessionId: typeof question.sessionId === "string" ? question.sessionId : "dialogue-migrated",
    fromAgentId: question.fromAgentId,
    toAgentId: question.toAgentId,
    text: typeof question.text === "string" ? question.text.slice(0, 320) : "",
    createdTurn: Number.isFinite(question.createdTurn) ? question.createdTurn : 0,
    status: question.status === "answered" || question.status === "withdrawn" ? question.status : "open",
  } satisfies PendingDialogueQuestion)).filter((question) => question.text).slice(0, 12) : [];
  const participants = Array.isArray(raw?.participants) ? [...new Set(raw.participants.filter((id) => ids.has(id)))].slice(0, 3) : [];
  const rawGroup = raw?.groupScene;
  const groupParticipantIds = Array.isArray(rawGroup?.participantIds)
    ? [...new Set(rawGroup.participantIds.filter((id) => ids.has(id)))].slice(0, 3)
    : participants;
  const participation = groupParticipantIds.reduce<Record<string, GroupParticipationState>>((result, id) => {
    const item = rawGroup?.participation?.[id];
    const stance = item && ["speaking", "engaged", "observing", "hesitant", "excluded", "withdrawing"].includes(item.stance) ? item.stance : "observing";
    result[id] = {
      agentId: id,
      stance,
      attentionTo: Array.isArray(item?.attentionTo) ? item.attentionTo.filter((targetId) => ids.has(targetId) && targetId !== id).slice(0, 2) : [],
      wantsFloor: Boolean(item?.wantsFloor),
      lastSpokeTurn: Number.isFinite(item?.lastSpokeTurn) ? Number(item?.lastSpokeTurn) : null,
    };
    return result;
  }, {});
  const groupScene: GroupSceneState = {
    schema: GROUP_SCENE_SCHEMA,
    id: typeof rawGroup?.id === "string" ? rawGroup.id : groupParticipantIds.length > 2 ? (typeof raw?.sessionId === "string" ? raw.sessionId : null) : null,
    participantIds: groupParticipantIds,
    topic: typeof rawGroup?.topic === "string" ? rawGroup.topic.slice(0, 120) : typeof raw?.currentTopic === "string" ? raw.currentTopic.slice(0, 120) : null,
    sharedActivity: typeof rawGroup?.sharedActivity === "string" ? rawGroup.sharedActivity.slice(0, 240) : null,
    currentSpeakerId: rawGroup?.currentSpeakerId && ids.has(rawGroup.currentSpeakerId) ? rawGroup.currentSpeakerId : null,
    addresseeIds: Array.isArray(rawGroup?.addresseeIds) ? rawGroup.addresseeIds.filter((id) => groupParticipantIds.includes(id)).slice(0, 2) : [],
    audienceIds: Array.isArray(rawGroup?.audienceIds) ? rawGroup.audienceIds.filter((id) => groupParticipantIds.includes(id)).slice(0, 2) : [],
    openQuestionIds: Array.isArray(rawGroup?.openQuestionIds) ? rawGroup.openQuestionIds.filter((id) => pendingQuestions.some((question) => question.id === id && question.status === "open")).slice(0, 8) : [],
    participation,
  };
  return {
    schema: PUBLIC_DIALOGUE_SCHEMA,
    sessionId: typeof raw?.sessionId === "string" ? raw.sessionId : null,
    participants,
    status: raw?.status === "active" && participants.length > 1 ? "active" : "idle",
    currentTopic: typeof raw?.currentTopic === "string" ? raw.currentTopic.slice(0, 120) : null,
    lastSpeakerId: raw?.lastSpeakerId && ids.has(raw.lastSpeakerId) ? raw.lastSpeakerId : null,
    consecutiveBeats: Number.isFinite(raw?.consecutiveBeats) ? Math.max(0, Math.min(12, Number(raw!.consecutiveBeats))) : 0,
    transcript,
    pendingQuestions,
    groupScene,
  };
}

function updatePublicDialogue(
  current: PublicDialogueState,
  decisions: Array<CharacterAgentDecision | null>,
  eventId: string,
  turn: number,
) {
  const visible = decisions.filter((decision): decision is CharacterAgentDecision => Boolean(decision));
  if (!visible.length) return current;
  const primary = visible[0];
  const addressedBy = (decision: CharacterAgentDecision) => decision.addresseeIds?.length
    ? decision.addresseeIds
    : decision.addressedTo ? [decision.addressedTo] : decision.targetId ? [decision.targetId] : [];
  const requestedParticipants = [...new Set(visible.flatMap((decision) => [decision.actorId, ...addressedBy(decision), decision.targetId]).filter((id): id is string => Boolean(id)))].slice(0, 3);
  const continuingGroup = current.status === "active"
    && current.groupScene.participantIds.length > 2
    && requestedParticipants.some((id) => current.groupScene.participantIds.includes(id));
  const participants = [...new Set([...(continuingGroup ? current.groupScene.participantIds : []), ...requestedParticipants])].slice(0, 3);
  const sameSession = current.status === "active" && participants.length === current.participants.length && participants.every((id) => current.participants.includes(id));
  const sessionId = sameSession && current.sessionId ? current.sessionId : primary.stageSessionId;
  const beats = visible.map((decision, index): PublicDialogueBeat => ({
    id: `dialogue-${turn}-${index}-${hash(`${decision.taskId}-${decision.actorId}`)}`,
    sessionId,
    eventId,
    turn,
    speakerId: decision.actorId,
    targetId: decision.targetId,
    addresseeIds: addressedBy(decision).filter((id) => participants.includes(id)).slice(0, 2),
    audienceIds: (decision.audienceScope === "everyone" ? participants.filter((id) => id !== decision.actorId) : addressedBy(decision)).slice(0, 2),
    audienceScope: decision.audienceScope,
    responseExpectation: decision.responseExpectation,
    participationIntent: decision.participationIntent,
    spokenContent: decision.spokenContent,
    observableBehavior: decision.observableBehavior,
    nonverbalBeat: decision.nonverbalBeat,
    speechAct: decision.speechAct,
    responseMode: decision.responseMode,
    topic: decision.topic,
  }));
  let questions = current.pendingQuestions.map((question) => {
    const answer = visible.find((decision) => decision.actorId === question.toAgentId
      && decision.targetId === question.fromAgentId
      && ["direct_answer", "indirect_answer", "acknowledge", "counter_question"].includes(decision.responseMode));
    return answer && question.status === "open" ? { ...question, status: "answered" as const } : question;
  });
  for (const decision of visible) {
    if (decision.speechAct === "question" && decision.spokenContent) {
      const recipients = addressedBy(decision).filter((id) => id !== decision.actorId);
      questions = [...recipients.map((toAgentId) => ({
        id: `question-${turn}-${hash(`${decision.taskId}-${toAgentId}-${decision.spokenContent}`)}`,
        sessionId,
        fromAgentId: decision.actorId,
        toAgentId,
        text: decision.spokenContent!,
        createdTurn: turn,
        status: "open" as const,
      })), ...questions];
    }
    if (!decision.continueScene || decision.responseMode === "close" || decision.action === "end_interaction") {
      questions = questions.map((question) => question.status === "open" && question.fromAgentId === decision.actorId ? { ...question, status: "withdrawn" as const } : question);
    }
  }
  const consecutiveBeats = (sameSession ? current.consecutiveBeats : 0) + beats.length;
  const leavingIds = new Set(visible.filter((decision) => !decision.continueScene || decision.responseMode === "close" || decision.action === "end_interaction" || decision.action === "move_away" || decision.participationIntent === "leave").map((decision) => decision.actorId));
  const remainingParticipants = participants.filter((id) => !leavingIds.has(id));
  const reachedBeatLimit = consecutiveBeats >= 12;
  if (reachedBeatLimit) {
    questions = questions.map((question) => question.sessionId === sessionId && question.status === "open"
      ? { ...question, status: "withdrawn" as const }
      : question);
  }
  const active = remainingParticipants.length > 1 && !reachedBeatLimit;
  const groupParticipants = active ? remainingParticipants : participants;
  const latest = visible[visible.length - 1];
  const participation = groupParticipants.reduce<Record<string, GroupParticipationState>>((result, id) => {
    const decision = [...visible].reverse().find((item) => item.actorId === id);
    const previous = current.groupScene.participation[id];
    const stance: GroupParticipationState["stance"] = leavingIds.has(id) || decision?.participationIntent === "withdraw"
      ? "withdrawing"
      : decision?.actorId === latest.actorId ? "speaking"
        : decision?.action === "remain_silent" || decision?.participationIntent === "observe" ? "observing"
          : decision ? "engaged" : previous?.stance || "observing";
    result[id] = {
      agentId: id,
      stance,
      attentionTo: decision ? addressedBy(decision).slice(0, 2) : previous?.attentionTo || [],
      wantsFloor: decision?.participationIntent === "interrupt" || Boolean(previous?.wantsFloor && !decision),
      lastSpokeTurn: decision?.spokenContent ? turn : previous?.lastSpokeTurn ?? null,
    };
    return result;
  }, {});
  const groupScene: GroupSceneState = {
    schema: GROUP_SCENE_SCHEMA,
    id: groupParticipants.length > 2 ? sessionId : null,
    participantIds: groupParticipants,
    topic: [...visible].reverse().find((decision) => decision.topic)?.topic || (sameSession ? current.groupScene.topic : null),
    sharedActivity: primary.observableBehavior,
    currentSpeakerId: latest.actorId,
    addresseeIds: addressedBy(latest).filter((id) => groupParticipants.includes(id)).slice(0, 2),
    audienceIds: (latest.audienceScope === "everyone" ? groupParticipants.filter((id) => id !== latest.actorId) : addressedBy(latest)).slice(0, 2),
    openQuestionIds: questions.filter((question) => question.status === "open" && question.sessionId === sessionId).map((question) => question.id).slice(0, 8),
    participation,
  };
  return {
    schema: PUBLIC_DIALOGUE_SCHEMA,
    sessionId,
    participants: active ? remainingParticipants : participants,
    status: active ? "active" as const : "idle" as const,
    currentTopic: [...visible].reverse().find((decision) => decision.topic)?.topic || (sameSession ? current.currentTopic : null),
    lastSpeakerId: visible[visible.length - 1].actorId,
    consecutiveBeats: active ? consecutiveBeats : 0,
    transcript: [...beats.reverse(), ...current.transcript].slice(0, 30),
    pendingQuestions: questions.slice(0, 12),
    groupScene,
  };
}

function normalizeStageHistory(
  raw: Record<string, CharacterAgentStageHistoryEntry[]> | undefined,
  agents: StoryAgent[],
) {
  const ids = new Set(agents.map((agent) => agent.id));
  return Object.fromEntries(Object.entries(raw || {}).filter(([agentId]) => ids.has(agentId)).map(([agentId, entries]) => [agentId, (entries || []).map((entry) => ({
    ...entry,
    spokenContent: entry.spokenContent || null,
    nonverbalBeat: entry.nonverbalBeat || null,
    speechAct: entry.speechAct || "none",
    responseMode: entry.responseMode || "initiate",
    topic: entry.topic || null,
  })).slice(0, 10)]));
}

function createDirection(from: string, to: string, draft?: RelationshipDirectionDraft, sharedHistory = ""): RelationshipDirection {
  const base: RelationshipDirection = {
    from, to, affinity: 22, trust: 16, tension: 8, attraction: 8, attachment: 6, respect: 24, resentment: 0, fear: 4, jealousy: 0,
    commitment: 0, boundary: "undefined", currentEmotion: "观察", contactConsent: "ask_first", rejectionLocks: [], unresolvedThreads: [],
    lens: createRelationshipLens({
      ownerAgentId: from,
      targetAgentId: to,
      relationshipKind: draft?.kind || "初识",
      playerAuthoredView: draft?.note || "",
      sharedHistory,
    }),
  };
  if (!draft) return base;
  const presets: Record<InitialRelationKind, Partial<RelationshipDirection>> = {
    初识: {},
    旧识: { affinity: 34, trust: 30, attachment: 28, respect: 34 },
    朋友: { affinity: 48, trust: 44, attachment: 38, respect: 42 },
    同伴: { affinity: 38, trust: 40, respect: 52, commitment: 28 },
    亲属: { affinity: 54, trust: 48, attachment: 58, commitment: 44, attraction: 0 },
    单恋: { affinity: 58, trust: 34, attraction: 68, attachment: 52, tension: 42 },
    宿敌: { affinity: 16, trust: 10, tension: 62, attraction: 18, respect: 58, resentment: 46 },
    自定义: {},
  };
  return { ...base, ...presets[draft.kind], unresolvedThreads: draft.note.trim() ? [`关系网设定：${draft.note.trim()}`] : [] };
}

function derivePairStatus(relationship: Pick<Relationship, "directions">) {
  const [ab, ba] = relationship.directions;
  const aLabel = relationshipDirectionLabel(ab);
  const bLabel = relationshipDirectionLabel(ba);
  if (ab.rejectionLocks.includes("permanent_break") || ba.rejectionLocks.includes("permanent_break")) return "永久决裂";
  if (ab.attraction > 58 && ba.attraction > 58 && ab.trust > 48 && ba.trust > 48) return "双向亲密";
  if ((ab.attraction > 58) !== (ba.attraction > 58)) return "单向心动";
  if (ab.tension > 60 && ba.tension > 60) return "高张力关系";
  if (aLabel === bLabel) return aLabel;
  return "不对称关系";
}

function createRelationship(a: string, b: string, draft?: RelationshipDraft): Relationship {
  const aDraft = draft?.a === a ? draft.aToB : draft?.bToA;
  const bDraft = draft?.b === b ? draft.bToA : draft?.aToB;
  const relationSummary = draft ? `${aDraft?.kind || "初识"} / ${bDraft?.kind || "初识"}` : "初识 / 初识";
  const base: Relationship = {
    id: pairId(a, b), a, b,
    directions: [createDirection(a, b, aDraft, draft?.sharedHistory || ""), createDirection(b, a, bDraft, draft?.sharedHistory || "")],
    status: "彼此观察", turnsTogether: 0,
    history: [draft?.sharedHistory.trim() || "在入住日第一次见面"],
    lastReason: `关系网初始绑定：${relationSummary}。角色仍会在模拟中形成自己的新理解。`,
  };
  return { ...base, status: derivePairStatus(base) };
}

function allRelationships(agents: StoryAgent[], drafts: RelationshipDraft[]) {
  const relationships: Relationship[] = [];
  for (let left = 0; left < agents.length; left += 1) {
    for (let right = left + 1; right < agents.length; right += 1) {
      const a = agents[left].id;
      const b = agents[right].id;
      relationships.push(createRelationship(a, b, drafts.find((item) => item.id === pairId(a, b))));
    }
  }
  return relationships;
}

function tone(agent: StoryAgent, type: "introduce" | "invite" | "accept" | "reject" | "repair" | "honest") {
  const reserved = /冷|谨慎|内向|克制/.test(agent.personality);
  const direct = /直接|热情|乐观|行动派/.test(agent.personality);
  if (type === "introduce") return reserved ? `我是${agent.name}。其他的，以后再说。` : direct ? `我是${agent.name}。希望我们会相处得不错。` : `叫我${agent.name}就好。`;
  if (type === "invite") return reserved ? "如果你刚好愿意……可以在这里坐一会儿。" : direct ? "我想和你待在一起，所以来问你。" : "要不要一起待一会儿？";
  if (type === "accept") return reserved ? "可以。只是别离得太近。" : "好啊，我愿意。";
  if (type === "reject") return reserved ? "我现在想一个人待着，请别再靠近了。" : "这次不行。我需要自己的空间。";
  if (type === "repair") return reserved ? "我还没想好怎么说，但我不想一直这样。" : "上次的事，我想重新解释一次。";
  return reserved ? "我不保证会说得好，但这确实是我的感受。" : "我想把真正的想法告诉你。";
}

function enterTown(state: GameState, mode: ExperienceMode, story?: { setup: StorySetup; outline: DirectorOutline; decision: DirectorDecision }): GameState {
  if (state.phase !== "onboarding" || state.agents.length < 1 || state.agents.some((agent) => agent.visual.status !== "ready")) return state;
  if (mode === "story" && !story) return state;
  const createdAt = new Date().toISOString();
  const worldId = state.worldId || `world-${typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `${Date.now()}-${hash(state.agents.map((agent) => agent.id).join("|"))}`}`;
  const solo = state.agents.length === 1;
  const storyScene = mode === "story" ? sceneFromProposal(story!.decision.sceneProposal, DEFAULT_STORY_SCENE) : null;
  const selectedScene = storyScene ? scenes[storyScene.sceneId] || scenes["story-room"] : scenes.desktop;
  const event: ChronicleEvent = {
    id: `event-arrival-${Date.now()}`, day: 1, time: "09:00", kind: "system", mode, level: "L1",
    actorIds: state.agents.map((agent) => agent.id), title: mode === "story" ? `开幕 · ${story!.outline.storyTitle}` : solo ? "入住日 · 一个人的世界开始了" : "入住日 · 关系网落位",
    summary: mode === "story"
      ? story!.decision.playerVisibleNarration || `故事从${storyScene!.location}开始。${story!.outline.storySummary}`
      : solo ? `${state.agents[0].name}带着自己的背景和角色形象进入模拟世界。新的角色以后仍可在新时间线中加入。` : `${state.agents.map((agent) => agent.name).join("、")}带着已填写的双向关系网来到同一张桌面。`,
    dialogue: mode === "story" ? [] : state.agents.map((agent) => ({ speaker: agent.name, text: tone(agent, "introduce") })), impact: mode === "story" ? "公开开场已经建立，等待各角色自行回应" : solo ? "单角色世界已启动" : "关系网成为双向关系的初始条件",
    memoryWrite: mode === "story" ? `我看见故事从${storyScene!.location}开始。` : solo ? "独自进入了新的模拟世界" : "带着既有关系进入了新的模拟世界", memoryWrites: Object.fromEntries(state.agents.map((agent) => [agent.id, mode === "story" ? `我能感知到故事从${storyScene!.location}开始。` : solo ? "我独自进入了新的模拟世界。" : "我带着对其他人的既有理解进入了模拟世界。"])),
    sceneId: selectedScene.id, relationshipReason: solo ? "没有关系边时只运行个人行为与自我叙事" : "关系网只提供初始条件，后续仍按方向独立变化",
  };
  const relationships = allRelationships(state.agents, state.relationshipDrafts);
  const seededAgents = state.agents.map((agent) => {
    let memory = normalizeAgentMemory(agent.memory, agent.id, 0);
    for (const other of state.agents.filter((item) => item.id !== agent.id)) {
      const relationship = relationships.find((item) => item.id === pairId(agent.id, other.id));
      const view = relationship?.directions.find((item) => item.from === agent.id);
      memory = seedCharacterMemory(memory, agent.id, other.id, `入住时，我把与${other.name}的关系理解为“${view ? relationshipDirectionLabel(view) : "仍在观察"}”。`, 0, event.id);
    }
    return { ...agent, memory };
  });
  const memory = writeEventToMemory(seededAgents, event, 0, {}, []);
  event.memoryAudit = memory.audits;
  const entered: GameState = {
    ...state,
    worldId,
    worldCreatedAt: state.worldCreatedAt || createdAt,
    phase: "town",
    mode,
    surface: "web",
    running: false,
    agents: memory.agents,
    relationships,
    spatial: mode === "story" ? storyOpeningSpatial(state.agents) : normalizeSpatial(state.agents, state.spatial),
    events: [event],
    scene: selectedScene,
    publicDialogue: normalizePublicDialogue(undefined, state.agents),
    selectedMemoryAgentId: state.agents[0].id,
    director: mode === "story" ? createDirectorState(story!.setup, story!.outline, storyScene!) : null,
    storyScene,
    worldEntities: [],
    storyAttentionQueue: mode === "story" ? state.agents.map((agent) => ({ actorId: agent.id, eventId: event.id, reason: `故事开幕的公开场景已经发生：${event.summary}` })) : [],
    storyPublicEvents: [],
    storySummaryRevisions: [],
    storyContextRuntime: mode === "story" ? createStoryContextRuntime() : null,
    backgroundWorldIndex: createBackgroundWorldIndex(worldId),
    lastNotice: mode === "story" ? "故事剧场已经开始；导演只负责公开世界，角色仍由各自 Character Agent 自主行动。" : "角色已经进入自然模式；下一回合将由注意力调度器唤醒最相关的角色。",
  };
  return mode === "story" ? applyDirectorDecision(entered, story!.decision, true) : entered;
}

function applyDirectorDecision(state: GameState, decision: DirectorDecision, opening = false): GameState {
  if (state.mode !== "story" || !state.director || state.interactionSession) return state;
  const storyScene = sceneFromProposal(decision.sceneProposal, state.storyScene || DEFAULT_STORY_SCENE);
  const selectedScene = scenes[storyScene.sceneId] || scenes["story-room"];
  const visibleIds = [...new Set(decision.worldEvents.flatMap((event) => event.visibleTo).filter((id) => state.agents.some((agent) => agent.id === id)))];
  const affectedIds = [...new Set(decision.worldEvents.flatMap((event) => event.affectedAgents).filter((id) => state.agents.some((agent) => agent.id === id)))];
  const actorIds = visibleIds.length ? visibleIds : decision.decision === "wait" ? [] : state.agents.map((agent) => agent.id);
  const publicFacts = decision.worldEvents.map((event) => {
    const effects = event.publicEffects.map((effect) => `${effect.type}:${effect.severity}`).join("、");
    return effects ? `${event.summary}（公开状态：${effects}）` : event.summary;
  });
  const narration = decision.playerVisibleNarration || publicFacts.join(" ");
  const shouldRecord = !opening && (decision.decision !== "wait" || narration || publicFacts.length);
  const eventId = `event-director-${state.turn}-${Date.now()}`;
  const appearedEntities = decision.worldEvents.flatMap((worldEvent, index) => {
    const type: SceneEntity["type"] | null = worldEvent.type === "evidence_found" ? "clue" : worldEvent.type === "external_threat" ? "hazard" : worldEvent.type === "entity_appeared" ? "npc" : null;
    if (!type) return [];
    return [{
      id: `${eventId}-entity-${index}`,
      type,
      description: worldEvent.summary,
      visibility: "public" as const,
      lifecycle: "scene_bound" as const,
      state: { introducedTurn: state.turn, sceneId: selectedScene.id },
    }];
  });
  const event: ChronicleEvent | null = shouldRecord ? {
    id: eventId,
    day: state.day,
    time: eventTime(state.turn),
    kind: "script",
    mode: "story",
    level: decision.worldEvents.some((item) => item.type === "external_threat") ? "L4" : "L3",
    actorIds,
    title: decision.decision === "change_scene" ? `场景切换 · ${storyScene.location}` : decision.decision === "finish_story" ? "故事抵达结局" : "外部世界发生了变化",
    summary: narration || "导演选择继续等待角色行动。",
    dialogue: [],
    impact: publicFacts.join(" ") || "没有新增公开世界事实",
    memoryWrite: narration,
    memoryWrites: Object.fromEntries(actorIds.map((id) => [id, narration])),
    sceneId: selectedScene.id,
    relationshipReason: "Director Agent 只能投放公开世界事实；关系裁判不会直接接受导演修改。",
  } : null;
  const memory = event ? writeEventToMemory(state.agents, event, state.turn, {}, []) : { agents: state.agents, compressed: 0, audits: {} };
  if (event) event.memoryAudit = memory.audits;
  const director = nextDirectorState(state.director, decision, state.turn);
  return {
    ...state,
    agents: memory.agents,
    compressionCount: state.compressionCount + memory.compressed,
    director: decision.decision === "change_scene" ? { ...director, status: "playing", currentSceneId: selectedScene.id } : director,
    storyScene,
    scene: selectedScene,
    events: event ? [event, ...state.events].slice(0, 100) : state.events,
    worldEntities: [...(decision.decision === "change_scene" ? state.worldEntities.filter((entity) => entity.lifecycle === "persistent") : state.worldEntities), ...appearedEntities].slice(-24),
    storyAttentionQueue: event ? actorIds.map((actorId) => ({ actorId, eventId, reason: `我能感知到新的公开世界事件：${narration}` })) : state.storyAttentionQueue,
    lastNotice: decision.decision === "wait" ? "导演判断公开剧情仍在自然发展，本轮不投放新事件。" : decision.decision === "finish_story" ? "故事已经根据公开证据收束；角色的关系与记忆保持真实结果。" : `导演投放了公开世界变化；${affectedIds.length ? `${affectedIds.length} 名角色受到公开影响，` : ""}角色将分别自主回应。`,
  };
}

function chooseProposal(actor: StoryAgent, target: StoryAgent, view: RelationshipDirection, seed: number): SocialProposal {
  let intent: SocialIntent = seed % 3 === 0 ? "invite_play" : "share_space";
  if (view.resentment > 42) intent = /回避|独处|克制/.test(actor.personality) ? "ask_for_space" : "repair";
  else if (view.unresolvedThreads.length) intent = "repair";
  else if (view.affinity > 46 && view.attraction > 34 && seed % 4 === 0) intent = "seek_affection";
  else if (/难过|低落|孤独/.test(target.mood)) intent = "offer_comfort";
  const actionMap: Record<SocialIntent, string> = {
    share_space: "坐到对方附近", invite_play: "邀请一起玩", offer_comfort: "在不打扰的距离陪伴", seek_affection: "询问能否靠近并轻轻贴贴", repair: "尝试重新解释", ask_for_space: "明确请求独处", honest_talk: "坦白真实感受",
  };
  return { actorId: actor.id, targetId: target.id, intent, preferredAction: actionMap[intent], intensity: 0.35 + (seed % 5) * 0.1, reasonTags: [actor.mood, relationshipDirectionLabel(view), seed % 2 ? "recent_memory" : "current_need"], fallback: intent === "seek_affection" ? "停在附近等待回应" : "尊重回应并停止追问" };
}

function respondToProposal(responder: StoryAgent, view: RelationshipDirection, proposal: SocialProposal, seed: number): SocialResponse {
  const contact = proposal.intent === "seek_affection";
  let response: SocialResponseKind = "accept";
  if (proposal.intent === "ask_for_space") response = "accept";
  else if ((contact && view.contactConsent === "closed") || view.resentment > 58) response = "reject";
  else if (view.resentment > 34 || /生气|疲惫|想独处/.test(responder.mood)) response = "soft_reject";
  else if (view.trust < 24 && seed % 3 === 0) response = "delay";
  else if (seed % 7 === 0) response = "counter";
  const preferred = response === "accept" ? (contact ? "明确允许靠近并轻轻贴贴" : "接受邀请") : response === "counter" ? "提出一起安静坐着" : response === "delay" ? "稍后再回应" : "拉开距离";
  return { responderId: responder.id, response, comfort: response === "accept" ? "comfortable" : response === "counter" || response === "delay" ? "uncertain" : "uncomfortable", preferredAction: preferred, reasonTags: [responder.mood, relationshipDirectionLabel(view), view.contactConsent] };
}

function resolveProposal(proposal: SocialProposal, response: SocialResponse): InteractionResolution {
  if (response.response === "accept") return { outcome: "shared", actionSequence: [proposal.preferredAction, response.preferredAction, "进入短暂共同活动"], boundaryHonored: true };
  if (response.response === "counter" || response.response === "delay") return { outcome: "adjusted", actionSequence: [proposal.preferredAction, response.preferredAction, proposal.fallback], boundaryHonored: true };
  return { outcome: response.response === "reject" ? "boundary" : "paused", actionSequence: [proposal.preferredAction, response.preferredAction, "发起者停止继续靠近"], boundaryHonored: true };
}

function signalsForPerspective(role: "actor" | "responder", response: SocialResponse, resolution: InteractionResolution): RelationshipSignals {
  const accepted = response.response === "accept";
  const rejected = response.response === "reject" || response.response === "soft_reject";
  if (role === "actor") return { warmth: accepted ? 2 : rejected ? -1 : 1, honesty: 1, vulnerability: 1, reliability: 0, boundaryRespect: resolution.boundaryHonored ? 1 : -1, sharedRisk: accepted ? 1 : 0, friction: rejected ? 1 : 0, jealousy: 0 };
  return { warmth: accepted ? 1 : 0, honesty: 1, vulnerability: accepted ? 1 : 0, reliability: 1, boundaryRespect: 2, sharedRisk: accepted ? 1 : 0, friction: rejected ? 1 : 0, jealousy: 0 };
}

function applyDelta(view: RelationshipDirection, delta: RelationshipDelta, emotion: string, contactConsent?: RelationshipDirection["contactConsent"]): RelationshipDirection {
  return {
    ...view,
    affinity: clamp(view.affinity + delta.affinity), trust: clamp(view.trust + delta.trust), tension: clamp(view.tension + delta.tension), attraction: clamp(view.attraction + delta.attraction), attachment: clamp(view.attachment + delta.attachment), resentment: clamp(view.resentment + delta.resentment),
    currentEmotion: emotion, contactConsent: contactConsent || view.contactConsent,
  };
}

function interactionCopy(proposal: SocialProposal, response: SocialResponse, actor: StoryAgent, responder: StoryAgent) {
  const accepted = response.response === "accept";
  if (proposal.intent === "repair") return { title: "一次没有跳过的修复", summary: accepted ? `${actor.name}试着重新解释，${responder.name}愿意先听完。理解没有立刻发生，但回避停止了。` : `${actor.name}试着解释，${responder.name}仍然需要时间。修复没有被强行完成。` };
  if (proposal.intent === "ask_for_space") return { title: "把独处说清楚", summary: `${actor.name}明确说出自己需要空间，${responder.name}没有继续追问。` };
  if (accepted) return { title: "靠近之前先问了一句", summary: `${actor.name}发出邀请，${responder.name}独立作出接受。两人的共同活动没有被系统预先写死。` };
  return { title: "这次邀请没有被接受", summary: `${responder.name}表达了不愿靠近，${actor.name}停止继续推进。拒绝被优先执行。` };
}

function advanceSoloNatural(state: GameState): GameState {
  const actor = state.agents[0];
  if (!actor) return { ...state, running: false };
  const activities = [
    { title: "在新房间里巡视一圈", action: "沿着桌面边缘慢慢走了一圈", mood: "对环境好奇", thought: "这里会慢慢变成属于我的地方。", dialogue: "先把每个角落记住。" },
    { title: "给自己找了一件小事", action: "挑了一件顺手的小物，独自玩了一会儿", mood: "轻松", thought: "一个人也可以把时间过得很具体。", dialogue: "这个还挺有意思。" },
    { title: "在窗边停留", action: "坐到窗边观察光线和远处的动静", mood: "安静", thought: "我还不急着决定接下来要成为什么样的人。", dialogue: "今天先看到这里。" },
    { title: "整理带来的旧物", action: "把与过去有关的物品重新放好", mood: "若有所思", thought: "有些过去可以留下，有些可以晚点再看。", dialogue: "我知道它为什么还在这里。" },
    { title: "允许自己休息", action: "找了一个舒服的位置，暂时停止探索", mood: "放松", thought: "休息不代表故事没有继续。", dialogue: "先歇一会儿吧。" },
  ];
  const activity = activities[hash(`${state.day}-${state.turn}-${actor.name}`) % activities.length];
  const event: ChronicleEvent = {
    id: `event-solo-${state.turn + 1}-${hash(activity.title)}`, day: state.day + 1, time: eventTime(state.turn + 1), kind: "daily", mode: state.mode, level: "L1",
    actorIds: [actor.id], title: activity.title, summary: `${actor.name}${activity.action}。`, dialogue: [{ speaker: actor.name, text: activity.dialogue }],
    impact: "个人动作、情绪与记忆继续生长；没有虚构不存在的关系对象", memoryWrite: activity.action,
    memoryWrites: { [actor.id]: `我${activity.action}。` }, sceneId: state.scene.id, relationshipReason: "单角色世界没有关系裁判，本回合只更新角色自己的状态与记忆",
  };
  const memory = writeEventToMemory(state.agents.map((item) => item.id === actor.id ? { ...item, mood: activity.mood, privateThought: activity.thought } : item), event, state.turn + 1, {}, state.events.map((item) => item.id));
  event.memoryAudit = memory.audits;
  const current = normalizeSpatial(state.agents, state.spatial);
  const seed = hash(`${activity.title}-${state.turn}`);
  const intent: SpatialIntent = /巡视|小事/.test(activity.title) ? "wander" : /休息/.test(activity.title) ? "rest" : "idle";
  const spatial = { ...current, [actor.id]: { ...current[actor.id], x: clamp(18 + seed % 64, 14, 86), y: clamp(63 + seed % 14, 61, 78), facing: seed % 2 ? "left" as const : "right" as const, targetId: null, intent, proximity: "alone" as const, perception: "这里暂时只有我一个人，我按自己的节奏活动。", updatedTurn: state.turn + 1 } };
  return { ...state, day: state.day + 1, turn: state.turn + 1, agents: memory.agents, spatial, events: [event, ...state.events].slice(0, 100), compressionCount: state.compressionCount + memory.compressed, lastNotice: "角色感知到当前是单人空间，并完成了一次个人行为。" };
}

function advanceNatural(state: GameState): GameState {
  if (state.phase !== "town") return { ...state, running: false };
  if (!state.relationships.length) return state.agents.length === 1 ? advanceSoloNatural(state) : { ...state, running: false };
  const relationship = state.relationships[state.turn % state.relationships.length];
  const actorId = state.turn % 2 === 0 ? relationship.a : relationship.b;
  const responderId = actorId === relationship.a ? relationship.b : relationship.a;
  const actor = state.agents.find((item) => item.id === actorId)!;
  const responder = state.agents.find((item) => item.id === responderId)!;
  const seed = hash(`${state.day}-${state.turn}-${actor.name}-${responder.name}`);
  const proposal = chooseProposal(actor, responder, direction(relationship, actor.id), seed);
  const response = respondToProposal(responder, direction(relationship, responder.id), proposal, seed);
  const fallbackDuoKind: DuoInteractionKind | null = response.response === "accept"
    ? proposal.intent === "seek_affection" ? "cuddle" : proposal.intent === "invite_play" ? "shared_action" : null
    : null;
  const fallbackFacings = interactionFacingPair(state, actor.id, responder.id);
  const duoValidation = fallbackDuoKind ? validateCharacterPair(actor, responder, fallbackDuoKind, ...fallbackFacings) : undefined;
  let resolution = resolveProposal(proposal, response);
  if (duoValidation && !duoValidation.compatible) {
    resolution = { outcome: "adjusted", actionSequence: [...resolution.actionSequence, "双人骨骼校验未通过，改为近距离动作"], boundaryHonored: true };
  }
  const actorDelta = evaluateRelationship(signalsForPerspective("actor", response, resolution));
  const responderDelta = evaluateRelationship(signalsForPerspective("responder", response, resolution));
  const actorView = applyDelta(direction(relationship, actor.id), actorDelta, response.response === "accept" ? "被回应" : "失落");
  const responderView = applyDelta(direction(relationship, responder.id), responderDelta, response.response === "accept" ? "放松" : "需要空间", response.response === "reject" ? "closed" : undefined);
  const directions = relationship.a === actor.id ? [actorView, responderView] : [responderView, actorView] as [RelationshipDirection, RelationshipDirection];
  const nextRelationship: Relationship = { ...relationship, directions: directions as [RelationshipDirection, RelationshipDirection], turnsTogether: relationship.turnsTogether + 1, history: [], lastReason: `${actor.name}：${actorDelta.reason}；${responder.name}：${responderDelta.reason}`, status: "" };
  const copy = interactionCopy(proposal, response, actor, responder);
  const fallbackPairActions = duoValidation?.compatible ? duoStageActions(duoValidation) : null;
  const eventId = `event-natural-${state.turn + 1}-${seed}`;
  const interactionSession = fallbackDuoKind ? createInteractionSession({
    eventId,
    kind: fallbackDuoKind,
    initiatorId: actor.id,
    receiverId: responder.id,
    consent: "accepted",
    startedTurn: state.turn + 1,
    validation: duoValidation,
  }) : null;
  const event: ChronicleEvent = {
    id: eventId, day: state.day + 1, time: eventTime(state.turn + 1), kind: "daily", mode: state.mode, level: response.response === "reject" || response.response === "soft_reject" ? "L3" : proposal.intent === "share_space" ? "L1" : "L2",
    actorIds: [actor.id, responder.id], title: duoValidation?.compatible === false ? "双方愿意回应，但动作被安全降级" : copy.title, summary: copy.summary,
    dialogue: [{ speaker: actor.name, text: tone(actor, proposal.intent === "repair" ? "repair" : "invite") }, { speaker: responder.name, text: tone(responder, response.response === "accept" ? "accept" : "reject") }],
    impact: duoValidation?.compatible === false ? `${duoValidation.summary}；双方仍分别写入自己的理解` : `${actor.name}与${responder.name}分别写入不同理解；桌面距离与接触意愿随之变化`, memoryWrite: copy.summary,
    memoryWrites: { [actor.id]: response.response === "accept" ? `${responder.name}愿意回应我的邀请。` : `${responder.name}拒绝了这次靠近，我停了下来。`, [responder.id]: response.response === "accept" ? `${actor.name}先询问了我的意愿。` : `我向${actor.name}表达了需要空间。` },
    sceneId: state.scene.id, relationshipReason: nextRelationship.lastReason, proposal, response, resolution, duoValidation, interactionSession: interactionSession || undefined,
    assetActions: fallbackPairActions ? { [actor.id]: fallbackPairActions.actor, [responder.id]: fallbackPairActions.target } : undefined,
  };
  nextRelationship.status = derivePairStatus(nextRelationship);
  nextRelationship.history = [event.title, ...relationship.history].slice(0, 12);
  const memory = writeEventToMemory(state.agents.map((agent) => agent.id === actor.id ? { ...agent, mood: actorView.currentEmotion, privateThought: event.memoryWrites[actor.id] } : agent.id === responder.id ? { ...agent, mood: responderView.currentEmotion, privateThought: event.memoryWrites[responder.id] } : agent), event, state.turn + 1, {}, state.events.map((item) => item.id));
  event.memoryAudit = memory.audits;
  const spatial = interactionSession ? normalizeSpatial(state.agents, state.spatial) : resolveSpatialInteraction(state, actor, responder, proposal, response, duoValidation);
  const spatialNotice = duoValidation ? duoValidation.summary : response.response === "accept" && proposal.intent === "seek_affection" ? "双方确认意愿后走近并贴贴。" : response.response === "reject" || response.response === "soft_reject" ? "角色感知到拒绝或不适，已经主动拉开距离。" : "角色感知到彼此的位置，并调整了活动距离。";
  const nextState: GameState = { ...state, day: state.day + 1, turn: state.turn + 1, agents: memory.agents, relationships: state.relationships.map((item) => item.id === relationship.id ? nextRelationship : item), spatial, events: [event, ...state.events].slice(0, 100), compressionCount: state.compressionCount + memory.compressed, lastNotice: spatialNotice };
  return interactionSession ? beginInteractionSessionSpatial(nextState, interactionSession) : nextState;
}

function decisionAffectsTarget(action: CharacterAgentAction) {
  return ["observe", "move_closer", "move_away", "face_other", "look_away", "speak", "remain_silent", "request_conversation", "request_touch", "request_shared_action", "end_interaction"].includes(action);
}

function intentForDecision(decision: CharacterAgentDecision): SocialIntent {
  if (decision.action === "request_touch") return "seek_affection";
  if (decision.action === "request_shared_action") return "invite_play";
  if (decision.action === "move_away" || decision.action === "end_interaction") return "ask_for_space";
  if (decision.action === "speak" || decision.action === "request_conversation" || decision.interactionType === "sensitive_topic") return "honest_talk";
  return "share_space";
}

function duoKindForDecision(decision: CharacterAgentDecision): DuoInteractionKind | null {
  if (decision.action === "request_shared_action" || decision.interactionType === "shared_action") return "shared_action";
  if (decision.interactionType === "joint_walk") return "joint_walk";
  if (decision.interactionType === "dance") return "dance";
  if (decision.interactionType === "chase") return "chase";
  if (decision.interactionType === "assist") return "assist";
  if (decision.interactionType === "hug") return "hug";
  if (decision.interactionType === "cuddle") return "cuddle";
  if (decision.interactionType === "hand_contact") return "hand_contact";
  if (decision.interactionType === "head_touch") return "head_touch";
  if (decision.interactionType === "shoulder_lean") return "shoulder_lean";
  if (decision.interactionType === "pat") return "pat";
  if (decision.interactionType === "push") return "push";
  if (decision.action === "request_touch" || decision.interactionType === "touch") return "touch";
  if (decision.action === "face_other") return "eye_contact";
  if (decision.action === "speak" || decision.action === "request_conversation" || decision.interactionType === "conversation") return "conversation";
  return null;
}

function duoActionsForKind(interaction: DuoInteractionKind) {
  if (["touch", "hand_contact", "hug", "cuddle"].includes(interaction)) return { actor: "love", target: "love" };
  if (["head_touch", "pat"].includes(interaction)) return { actor: "wave", target: "shy" };
  if (interaction === "shoulder_lean") return { actor: "love", target: "shy" };
  if (interaction === "push") return { actor: "angry", target: "walk" };
  if (interaction === "conversation") return { actor: "talk", target: "listen" };
  if (interaction === "eye_contact") return { actor: "listen", target: "listen" };
  if (["joint_walk", "chase", "assist"].includes(interaction)) return { actor: "walk", target: "walk" };
  return { actor: "wave", target: "wave" };
}

function actionRigForFacing(agent: StoryAgent, action: string, facing: PixelPetFacing) {
  const resolved = resolvePixelPetAction(agent.visual, action);
  const config = resolved.config as PixelPetActionDefinition;
  return config.unit?.keyframeRigs?.contact_hold?.[facing]
    || config.unit?.keyframeRigs?.contact_start?.[facing]
    || agent.visual.interactionRig;
}

function interactionFacingPair(state: GameState, actorId: string, targetId: string): [PixelPetFacing, PixelPetFacing] {
  const actor = state.spatial[actorId];
  const target = state.spatial[targetId];
  const actorOnLeft = !actor || !target ? actorId < targetId : actor.x < target.x || (actor.x === target.x && actorId < targetId);
  return actorOnLeft ? ["right", "left"] : ["left", "right"];
}

function validateCharacterPair(
  actor: StoryAgent,
  target: StoryAgent,
  interaction: DuoInteractionKind,
  actorFacing: PixelPetFacing = "right",
  targetFacing: PixelPetFacing = "left",
) {
  const actions = duoActionsForKind(interaction);
  return validateDuoInteraction(
    actionRigForFacing(actor, actions.actor, actorFacing),
    actionRigForFacing(target, actions.target, targetFacing),
    interaction,
    { width: actor.visual.grid.frameWidth, height: actor.visual.grid.frameHeight },
    { width: target.visual.grid.frameWidth, height: target.visual.grid.frameHeight },
  );
}

function duoStageActions(validation: DuoInteractionValidation) {
  return duoActionsForKind(validation.interaction);
}

function responseForDecision(decision: CharacterAgentDecision | null, consentRequired: boolean): SocialResponseKind {
  if (decision?.response === "accept") return "accept";
  if (decision?.response === "counter") return "counter";
  if (decision?.response === "reject") return "reject";
  if (decision?.response === "hesitate") return "delay";
  return consentRequired ? "reject" : "delay";
}

function spatialIntentForDecision(action: CharacterAgentAction): SpatialIntent {
  if (action === "explore") return "wander";
  if (action === "rest") return "rest";
  if (action === "move_away" || action === "end_interaction") return "retreat";
  if (action === "move_closer") return "approach";
  if (action === "observe" || action === "face_other") return "observe";
  if (action === "respond_reject") return "keep_distance";
  return "idle";
}

function desktopDecisionMovesPosition(decision: CharacterAgentDecision) {
  return ["explore", "move_closer", "move_away", "end_interaction", "request_touch", "request_shared_action"].includes(decision.action);
}

function applyTransientDesktopAgentDecision(state: GameState, decision: CharacterAgentDecision): GameState {
  const actor = state.agents.find((item) => item.id === decision.actorId);
  if (!actor) return { ...state, running: false, lastNotice: "桌宠短暂回应指向了不存在的角色，运行已暂停。" };
  const current = normalizeSpatial(state.agents, state.spatial);
  const own = current[actor.id];
  const target = decision.targetId ? current[decision.targetId] : null;
  let facing = own.facing;
  if (target && ["observe", "face_other", "speak", "remain_silent", "stay"].includes(decision.action)) facing = facingToward(own, target);
  if (decision.action === "look_away") facing = own.facing === "left" ? "right" : "left";
  const transientIntent: SpatialIntent = decision.action === "look_away" ? "keep_distance" : decision.action === "rest" ? "rest" : "observe";
  return {
    ...state,
    agents: state.agents.map((agent) => agent.id === actor.id ? {
      ...agent,
      mood: decision.emotionalState,
      privateThought: decision.privateThought,
    } : agent),
    spatial: {
      ...current,
      [actor.id]: {
        ...own,
        facing,
        targetId: target ? decision.targetId : null,
        intent: state.agents.length === 1 ? normalizeSoloSpatialIntent(transientIntent) : transientIntent,
        perception: decision.observableBehavior,
        updatedTurn: state.turn,
        interactionId: null,
      },
    },
    desktopTransientReaction: {
      agentId: actor.id,
      dialogue: decision.spokenContent,
      observableBehavior: decision.observableBehavior,
      animationAction: decision.animationAction || "wave",
      revision: (state.desktopTransientReaction?.revision || 0) + 1,
    },
    lastNotice: `${actor.name}完成了一次短暂桌宠回应；未产生位置移动，因此没有写入卷轴或长期记忆。`,
  };
}

function applyIndependentAgentDecision(state: GameState, decision: CharacterAgentDecision): GameState {
  const actor = state.agents.find((item) => item.id === decision.actorId);
  if (!actor) return { ...state, running: false, lastNotice: "Character Agent 返回了不存在的角色，运行已暂停。" };
  const event: ChronicleEvent = {
    id: `event-agent-${state.turn + 1}-${hash(decision.taskId)}`,
    day: state.day + 1,
    time: eventTime(state.turn + 1),
    kind: "daily",
    mode: state.mode,
    level: "L1",
    actorIds: [actor.id],
    title: `${actor.name}按自己的节奏行动`,
    summary: decision.observableBehavior,
    dialogue: decision.spokenContent ? [{ speaker: actor.name, text: decision.spokenContent }] : [],
    impact: "只更新该角色的公开动作、个人状态与主观记忆；没有虚构关系对象或代替他人回应",
    memoryWrite: decision.memoryWrite,
    memoryWrites: { [actor.id]: decision.memoryWrite },
    sceneId: state.scene.id,
    relationshipReason: "本回合由真实 Character Agent 自主决定；本地执行器只落实可见结果",
    assetActions: { [actor.id]: decision.animationAction },
  };
  const withDecision = state.agents.map((agent) => agent.id === actor.id ? {
    ...agent,
    mood: decision.emotionalState,
    privateThought: decision.privateThought,
    memory: decision.continueGoal ? { ...agent.memory, unresolvedThreads: [decision.continueGoal, ...agent.memory.unresolvedThreads].slice(0, 6) } : agent.memory,
  } : agent);
  const memory = writeEventToMemory(withDecision, event, state.turn + 1, { [actor.id]: decision }, state.events.map((item) => item.id));
  event.memoryAudit = memory.audits;
  const history = appendStageHistory(
    state.agentStageHistory,
    decision,
    event.summary,
    state.turn + 1,
    memory.audits[actor.id] ? [memory.audits[actor.id].revisionId] : [],
  );
  const publicDialogue = updatePublicDialogue(state.publicDialogue, [decision], event.id, state.turn + 1);
  const current = normalizeSpatial(state.agents, state.spatial);
  const seed = hash(`${decision.taskId}-${decision.observableBehavior}`);
  const actorSpatial = current[actor.id];
  const targetSpatial = decision.targetId ? current[decision.targetId] : null;
  let positioned = actorSpatial;
  if (decision.action === "explore") {
    const explored = { ...actorSpatial, ...relativeExplorePosition(actorSpatial, seed) };
    if (canOccupyIndependentPosition(state, actor.id, explored)) positioned = explored;
  } else if (targetSpatial && decision.action === "move_closer") {
    const distance = spatialDistance(actorSpatial, targetSpatial);
    const desiredDistance = Math.max(centerDistanceForBodyGap(actorSpatial, targetSpatial, 0.5), distance - 6);
    const approached = moveToward(actorSpatial, targetSpatial, desiredDistance);
    if (canOccupyIndependentPosition(state, actor.id, approached)) positioned = approached;
  } else if (targetSpatial && ["move_away", "end_interaction"].includes(decision.action)) {
    const distance = spatialDistance(actorSpatial, targetSpatial);
    const desiredDistance = Math.min(centerDistanceForBodyGap(actorSpatial, targetSpatial, 2), distance + 6);
    const retreated = moveAway(actorSpatial, targetSpatial, desiredDistance);
    if (canOccupyIndependentPosition(state, actor.id, retreated)) positioned = retreated;
  }
  const nextX = positioned.x;
  const nextY = positioned.y;
  let nextFacing = decision.action === "explore" && nextX !== actorSpatial.x
    ? nextX > actorSpatial.x ? "right" as const : "left" as const
    : actorSpatial.facing;
  if (targetSpatial) nextFacing = facingForAction(decision.action, { ...actorSpatial, x: nextX, y: nextY }, targetSpatial);
  else if (decision.action === "look_away") nextFacing = actorSpatial.facing === "left" ? "right" : "left";
  const nextActor: CharacterSpatialState = {
    ...actorSpatial,
    x: nextX,
    y: nextY,
    facing: nextFacing,
    targetId: targetSpatial ? decision.targetId : null,
    intent: state.agents.length === 1 ? normalizeSoloSpatialIntent(spatialIntentForDecision(decision.action)) : spatialIntentForDecision(decision.action),
    proximity: state.agents.length === 1 ? "alone" : targetSpatial ? proximityFor({ ...actorSpatial, x: nextX, y: nextY }, targetSpatial) : "far",
    perception: state.agents.length === 1 ? "这里暂时只有我一个人，我按自己的节奏活动。" : decision.observableBehavior,
    updatedTurn: state.turn + 1,
  };
  const spatial = refreshBystanderPerception(state.agents, { ...current, [actor.id]: nextActor }, new Set([actor.id]));
  return {
    ...state,
    day: state.day + 1,
    turn: state.turn + 1,
    agents: memory.agents,
    spatial,
    events: [event, ...state.events].slice(0, 100),
    compressionCount: state.compressionCount + memory.compressed,
    agentStageHistory: history,
    publicDialogue,
    lastNotice: `${actor.name}已通过 ${decision.model || "Character Agent API"} 完成一次独立行动。`,
  };
}

function applyGroupAgentTurn(state: GameState, actorDecision: CharacterAgentDecision, responderDecisions: CharacterAgentDecision[]): GameState {
  const decisionByActor = new Map([actorDecision, ...responderDecisions].map((decision) => [decision.actorId, decision]));
  const actorIds = [...decisionByActor.keys()].filter((id) => state.agents.some((agent) => agent.id === id)).slice(0, 3);
  const actor = state.agents.find((agent) => agent.id === actorDecision.actorId);
  if (!actor || actorIds.length < 2) return applyIndependentAgentDecision(state, actorDecision);
  const visibleDecisions = actorIds.map((id) => decisionByActor.get(id)).filter((decision): decision is CharacterAgentDecision => Boolean(decision));
  const participants = actorIds.map((id) => state.agents.find((agent) => agent.id === id)!).filter(Boolean);
  const eventId = `event-agent-group-${state.turn + 1}-${hash(actorDecision.taskId)}`;

  const relationshipUpdates = new Map<string, Relationship>();
  for (const responseDecision of responderDecisions) {
    const responder = state.agents.find((agent) => agent.id === responseDecision.actorId);
    const relationship = responder && state.relationships.find((item) => item.directions.some((view) => view.from === actor.id && view.to === responder.id));
    if (!responder || !relationship) continue;
    const responseKind = responseForDecision(responseDecision, false);
    const response: SocialResponse = {
      responderId: responder.id,
      response: responseKind,
      comfort: responseKind === "accept" ? "comfortable" : responseKind === "reject" ? "uncomfortable" : "uncertain",
      preferredAction: responseDecision.observableBehavior,
      reasonTags: [responseDecision.emotionalState, "independent_group_response"],
    };
    const proposal: SocialProposal = {
      actorId: actor.id,
      targetId: responder.id,
      intent: intentForDecision(actorDecision),
      preferredAction: actorDecision.observableBehavior,
      intensity: 0.35,
      reasonTags: [actorDecision.emotionalState, "public_group_scene"],
      fallback: "任何参与者都可以沉默、观察、退出或稍后回应",
    };
    const resolution = resolveProposal(proposal, response);
    const actorView = applyDelta(direction(relationship, actor.id), evaluateRelationship(signalsForPerspective("actor", response, resolution)), responseKind === "accept" ? "感到被接住" : "尊重对方的参与方式");
    const responderView = applyDelta(direction(relationship, responder.id), evaluateRelationship(signalsForPerspective("responder", response, resolution)), responseKind === "accept" ? "自主参与" : responseKind === "reject" ? "保留距离" : "仍在观察");
    const directions = relationship.a === actor.id ? [actorView, responderView] : [responderView, actorView] as [RelationshipDirection, RelationshipDirection];
    const nextRelationship: Relationship = {
      ...relationship,
      directions: directions as [RelationshipDirection, RelationshipDirection],
      turnsTogether: relationship.turnsTogether + 1,
      history: [`${actor.name}在多人场景中发起表达；${responder.name}独立选择了${responseDecision.participationIntent === "observe" ? "观察" : responseDecision.participationIntent === "withdraw" || responseDecision.participationIntent === "leave" ? "退出" : "回应"}。`, ...relationship.history].slice(0, 12),
      lastReason: "多人场景没有统一关系分；只根据两人之间真实可见的表达，分别更新 A→B 与 B→A。",
      status: "",
    };
    nextRelationship.status = derivePairStatus(nextRelationship);
    relationshipUpdates.set(relationship.id, nextRelationship);
  }

  const event: ChronicleEvent = {
    id: eventId,
    day: state.day + 1,
    time: eventTime(state.turn + 1),
    kind: "daily",
    mode: state.mode,
    level: "L1",
    actorIds,
    title: `${participants.map((agent) => agent.name).join("、")}进入同一个公开场景`,
    summary: visibleDecisions.map((decision) => decision.observableBehavior).join(" "),
    dialogue: visibleDecisions.flatMap((decision) => {
      const speaker = state.agents.find((agent) => agent.id === decision.actorId);
      return decision.spokenContent && speaker ? [{ speaker: speaker.name, text: decision.spokenContent }] : [];
    }),
    impact: "共享场景保留所有公开措辞、动作与待回答问题；每个角色只控制自己，关系与记忆仍按方向分别写入。",
    memoryWrite: actorDecision.memoryWrite,
    memoryWrites: Object.fromEntries(visibleDecisions.map((decision) => [decision.actorId, decision.memoryWrite])),
    sceneId: state.scene.id,
    relationshipReason: "这是多人公开场景，不创建全局关系分；只更新实际发生回应的两两方向关系。",
    assetActions: Object.fromEntries(visibleDecisions.map((decision) => [decision.actorId, decision.animationAction])),
  };
  const withDecisions = state.agents.map((agent) => {
    const decision = decisionByActor.get(agent.id);
    if (!decision) return agent;
    return {
      ...agent,
      mood: decision.emotionalState,
      privateThought: decision.privateThought,
      memory: decision.continueGoal ? { ...agent.memory, unresolvedThreads: [decision.continueGoal, ...agent.memory.unresolvedThreads].slice(0, 6) } : agent.memory,
    };
  });
  const decisionsRecord = Object.fromEntries(visibleDecisions.map((decision) => [decision.actorId, decision]));
  const memory = writeEventToMemory(withDecisions, event, state.turn + 1, decisionsRecord, state.events.map((item) => item.id));
  event.memoryAudit = memory.audits;
  let history = state.agentStageHistory;
  for (const decision of visibleDecisions) {
    history = appendStageHistory(history, decision, event.summary, state.turn + 1, memory.audits[decision.actorId] ? [memory.audits[decision.actorId].revisionId] : []);
  }
  const publicDialogue = updatePublicDialogue(state.publicDialogue, visibleDecisions, event.id, state.turn + 1);
  const currentSpatial = normalizeSpatial(state.agents, state.spatial);
  const activeIds = new Set(actorIds);
  const spatialWithFocus = { ...currentSpatial };
  for (const decision of visibleDecisions) {
    const own = spatialWithFocus[decision.actorId];
    const focusId = decision.targetId || decision.addresseeIds?.[0] || (decision.actorId === actor.id ? responderDecisions[0]?.actorId : actor.id);
    const focus = focusId ? spatialWithFocus[focusId] : null;
    if (!own) continue;
    spatialWithFocus[decision.actorId] = {
      ...own,
      facing: focus ? facingForAction(decision.action, own, focus) : own.facing,
      targetId: focus ? focusId : null,
      intent: spatialIntentForDecision(decision.action),
      proximity: focus ? proximityFor(own, focus) : "far",
      perception: decision.observableBehavior,
      updatedTurn: state.turn + 1,
      interactionId: null,
    };
  }
  const spatial = refreshBystanderPerception(state.agents, spatialWithFocus, activeIds);
  return {
    ...state,
    day: state.day + 1,
    turn: state.turn + 1,
    agents: memory.agents,
    relationships: state.relationships.map((relationship) => relationshipUpdates.get(relationship.id) || relationship),
    spatial,
    events: [event, ...state.events].slice(0, 100),
    compressionCount: state.compressionCount + memory.compressed,
    agentStageHistory: history,
    publicDialogue,
    interactionSession: null,
    lastNotice: `${participants.length} 名角色在共享场景中分别完成了自己的表演；没有替其他人统一作答。`,
  };
}

function applyNaturalAgentTurn(state: GameState, turn: NaturalAgentTurn): GameState {
  if (state.phase !== "town") return state;
  const { actorDecision, responderDecision } = turn;
  const responderDecisions = turn.responderDecisions?.length ? turn.responderDecisions : responderDecision ? [responderDecision] : [];
  const groupAddressees = actorDecision.addresseeIds?.length ? actorDecision.addresseeIds : actorDecision.addressedTo ? [actorDecision.addressedTo] : actorDecision.targetId ? [actorDecision.targetId] : [];
  const isGroupScene = (groupAddressees.length > 1 || responderDecisions.length > 1)
    && actorDecision.action !== "request_touch"
    && actorDecision.action !== "request_shared_action"
    && actorDecision.interactionType !== "sensitive_topic";
  if (isGroupScene) return applyGroupAgentTurn(state, actorDecision, responderDecisions);
  const actor = state.agents.find((item) => item.id === actorDecision.actorId);
  const responder = state.agents.find((item) => item.id === actorDecision.targetId);
  if (!actor || !responder || !decisionAffectsTarget(actorDecision.action)) return applyIndependentAgentDecision(state, actorDecision);
  const relationship = state.relationships.find((item) => item.directions.some((view) => view.from === actor.id && view.to === responder.id));
  if (!relationship) return applyIndependentAgentDecision(state, actorDecision);

  const intent = intentForDecision(actorDecision);
  const contactRequested = actorDecision.action === "request_touch" || actorDecision.action === "request_shared_action";
  const consentRequired = contactRequested || actorDecision.interactionType === "sensitive_topic";
  const proposal: SocialProposal = {
    actorId: actor.id,
    targetId: responder.id,
    intent,
    preferredAction: actorDecision.observableBehavior,
    intensity: 0.5,
    reasonTags: [actorDecision.emotionalState, "character_agent_decision"],
    fallback: consentRequired ? "没有得到明确同意时停止动作并保持距离" : "允许对方沉默、离开或稍后回应",
  };
  const responderView = direction(relationship, responder.id);
  const locked = consentRequired && responderView.rejectionLocks.some((item) => item === "permanent_break" || item === "romantic_pursuit");
  const responseKind = locked ? "reject" : responseForDecision(responderDecision, consentRequired);
  const response: SocialResponse = {
    responderId: responder.id,
    response: responseKind,
    comfort: responseKind === "accept" ? "comfortable" : responseKind === "counter" || responseKind === "delay" ? "uncertain" : "uncomfortable",
    preferredAction: locked ? "保留仍然有效的拒绝，不接受这次请求" : responderDecision?.observableBehavior || "暂时没有作出明确回应",
    reasonTags: [responderDecision?.emotionalState || "未回应", locked ? "active_rejection_lock" : "independent_character_response"],
  };
  const proposedDuoKind = duoKindForDecision(actorDecision);
  const responderDisengaged = !responderDecision || ["look_away", "move_away", "end_interaction", "respond_reject"].includes(responderDecision.action);
  const orientationParticipation = (proposedDuoKind === "conversation" || proposedDuoKind === "eye_contact")
    && !responderDisengaged
    && response.response !== "reject"
    && response.response !== "soft_reject";
  const duoKind = response.response === "accept" || orientationParticipation ? proposedDuoKind : null;
  const agentFacings = interactionFacingPair(state, actor.id, responder.id);
  const duoValidation = duoKind ? validateCharacterPair(actor, responder, duoKind, ...agentFacings) : undefined;
  let resolution = resolveProposal(proposal, response);
  if (duoValidation && !duoValidation.compatible) {
    resolution = {
      outcome: "adjusted",
      actionSequence: [...resolution.actionSequence, "骨骼、身高差或接触点未通过校验，改为安全近距离动作"],
      boundaryHonored: true,
    };
  }
  const actorDelta = evaluateRelationship(signalsForPerspective("actor", response, resolution));
  const responderDelta = evaluateRelationship(signalsForPerspective("responder", response, resolution));
  const actorView = applyDelta(direction(relationship, actor.id), actorDelta, response.response === "accept" ? "感到被回应" : "接受对方当前的距离");
  const nextResponderView = applyDelta(
    responderView,
    responderDelta,
    response.response === "accept" ? "自主接受" : response.response === "counter" ? "提出替代" : "保留边界",
    consentRequired ? (response.response === "accept" ? "ask_first" : response.response === "reject" ? "closed" : undefined) : undefined,
  );
  const directions = relationship.a === actor.id ? [actorView, nextResponderView] : [nextResponderView, actorView] as [RelationshipDirection, RelationshipDirection];
  const nextRelationship: Relationship = {
    ...relationship,
    directions: directions as [RelationshipDirection, RelationshipDirection],
    turnsTogether: relationship.turnsTogether + 1,
    history: [],
    lastReason: `${actor.name}提交一个自主动作；${responder.name}由独立 Agent ${response.response === "accept" ? "接受" : response.response === "counter" ? "提出替代" : response.response === "delay" ? "延后回应" : "拒绝"}。关系裁判只读取可见结果。`,
    status: "",
  };
  nextRelationship.status = derivePairStatus(nextRelationship);

  const acceptedContact = contactRequested && response.response === "accept" && duoValidation?.compatible === true;
  const adjustedContact = contactRequested && response.response === "accept" && duoValidation?.compatible === false;
  const pairedAssetActions = duoValidation?.compatible ? duoStageActions(duoValidation) : null;
  const eventId = `event-agent-pair-${state.turn + 1}-${hash(actorDecision.taskId)}`;
  const interactionKind: DuoInteractionKind | "approach" | null = duoKind && (response.response === "accept" || duoKind === "conversation" || duoKind === "eye_contact")
    ? duoKind
    : actorDecision.action === "move_closer" && response.response !== "reject" && response.response !== "soft_reject"
      ? "approach"
      : null;
  const interactionSession = interactionKind ? createInteractionSession({
    eventId,
    kind: interactionKind,
    initiatorId: actor.id,
    receiverId: responder.id,
    consent: interactionKind === "approach" || interactionKind === "conversation" || interactionKind === "eye_contact" ? "not_required" : "accepted",
    startedTurn: state.turn + 1,
    validation: duoValidation,
  }) : null;
  const event: ChronicleEvent = {
    id: eventId,
    day: state.day + 1,
    time: eventTime(state.turn + 1),
    kind: "daily",
    mode: state.mode,
    level: response.response === "reject" ? "L3" : consentRequired ? "L2" : "L1",
    actorIds: [actor.id, responder.id],
    title: acceptedContact ? "同意与双人骨骼校验都已通过" : adjustedContact ? "双方愿意回应，但动作被安全降级" : response.response === "reject" ? "拒绝被执行，没有继续越界" : "一次由双方分别完成的自然互动",
    summary: `${actorDecision.observableBehavior}${responderDecision ? ` ${responderDecision.observableBehavior}` : " 对方没有被强制回应。"}`,
    dialogue: [
      actorDecision.spokenContent ? { speaker: actor.name, text: actorDecision.spokenContent } : null,
      responderDecision?.spokenContent ? { speaker: responder.name, text: responderDecision.spokenContent } : null,
    ].filter((line): line is DialogueLine => Boolean(line)),
    impact: consentRequired ? (acceptedContact ? "明确同意后，骨骼、身高差与接触点校验通过才执行接触" : adjustedContact ? "同意仍然有效，但无法稳定对齐的双人动作被改为安全近距离表现" : "请求未获明确同意，交互执行器保持或拉开距离") : "公开行为已路由给另一角色；双方仍保有沉默、拒绝和离开的权利",
    memoryWrite: actorDecision.memoryWrite,
    memoryWrites: {
      [actor.id]: actorDecision.memoryWrite,
      [responder.id]: responderDecision?.memoryWrite || `我看见${actor.name}${actorDecision.observableBehavior}，但没有被强制回应。`,
    },
    sceneId: state.scene.id,
    relationshipReason: nextRelationship.lastReason,
    proposal,
    response,
    resolution,
    duoValidation,
    interactionSession: interactionSession || undefined,
    assetActions: pairedAssetActions ? {
      [actor.id]: pairedAssetActions.actor,
      [responder.id]: pairedAssetActions.target,
    } : {
      [actor.id]: adjustedContact ? "walk" : actorDecision.animationAction,
      [responder.id]: adjustedContact ? "listen" : responderDecision?.animationAction || "idle",
    },
  };
  nextRelationship.history = [event.title, ...relationship.history].slice(0, 12);
  const withDecisions = state.agents.map((agent) => {
    const decision = agent.id === actor.id ? actorDecision : agent.id === responder.id ? responderDecision : null;
    if (!decision) return agent;
    return {
      ...agent,
      mood: decision.emotionalState,
      privateThought: decision.privateThought,
      memory: decision.continueGoal ? { ...agent.memory, unresolvedThreads: [decision.continueGoal, ...agent.memory.unresolvedThreads].slice(0, 6) } : agent.memory,
    };
  });
  const memory = writeEventToMemory(
    withDecisions,
    event,
    state.turn + 1,
    { [actor.id]: actorDecision, [responder.id]: responderDecision },
    state.events.map((item) => item.id),
  );
  event.memoryAudit = memory.audits;
  let history = appendStageHistory(
    state.agentStageHistory,
    actorDecision,
    event.summary,
    state.turn + 1,
    memory.audits[actor.id] ? [memory.audits[actor.id].revisionId] : [],
  );
  if (responderDecision) {
    history = appendStageHistory(
      history,
      responderDecision,
      event.summary,
      state.turn + 1,
      memory.audits[responder.id] ? [memory.audits[responder.id].revisionId] : [],
    );
  }
  const publicDialogue = updatePublicDialogue(state.publicDialogue, [actorDecision, responderDecision], event.id, state.turn + 1);
  const spatial = interactionSession
    ? normalizeSpatial(state.agents, state.spatial)
    : resolveCharacterAgentSpatialInteraction(
      state,
      actor,
      responder,
      actorDecision.action,
      responderDecision?.action,
      proposal,
      response,
      duoValidation,
    );
  const nextState: GameState = {
    ...state,
    day: state.day + 1,
    turn: state.turn + 1,
    agents: memory.agents,
    relationships: state.relationships.map((item) => item.id === relationship.id ? nextRelationship : item),
    spatial,
    events: [event, ...state.events].slice(0, 100),
    compressionCount: state.compressionCount + memory.compressed,
    agentStageHistory: history,
    publicDialogue,
    lastNotice: `${actor.name}与${responder.name}已由两个独立 Character Agent 完成本回合；${duoValidation ? duoValidation.summary : consentRequired ? "接触请求经过独立回应与边界校验。" : "对方只接收到了可见行为。"}`,
  };
  return interactionSession ? beginInteractionSessionSpatial(nextState, interactionSession) : nextState;
}

function addAgent(state: GameState, input: NewStoryAgentInput): GameState {
  if (state.phase !== "onboarding" || state.agents.length >= 3 || !input.name.trim()) return state;
  const palette = avatarPalettes[state.agents.length % avatarPalettes.length];
  const randomId = typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `${Date.now()}-${hash(`${input.name}-${input.background}-${state.agents.length}`)}`;
  const agentId = `agent-${randomId}`;
  const profile = createCharacterProfile(input);
  const referencePack = normalizeCharacterReferencePack(input.referencePack || createEmptyCharacterReferencePack(input.name), input.name);
  const agent: StoryAgent = { id: agentId, name: input.name.trim(), personality: profile.personality, background: profile.background, profile, referencePack, color: palette[0], accent: palette[1], mood: "等待入住", privateThought: "我的故事会从哪里开始？", memory: createInitialAgentMemory(agentId, ["即将搬进新的小镇"]), visual: createDraftPixelPet(`${input.name.trim()}；${profile.personality}；${profile.background}；${profile.roleplayNotes}`, state.agents.length * 96) };
  const agents = [...state.agents, agent];
  return { ...state, agents, spatial: normalizeSpatial(agents, state.spatial), relationshipDrafts: syncRelationshipDrafts(agents, state.relationshipDrafts), selectedMemoryAgentId: agent.id };
}

function addSavedAgent(state: GameState, savedAgent: StoryAgent): GameState {
  if (state.phase !== "onboarding" || state.agents.length >= 3 || state.agents.some((agent) => agent.id === savedAgent.id)) return state;
  const index = state.agents.length;
  const profile = normalizeCharacterProfile(savedAgent.profile, savedAgent);
  const referencePack = normalizeCharacterReferencePack(savedAgent.referencePack, savedAgent.name);
  const agent: StoryAgent = {
    ...savedAgent,
    personality: profile.personality,
    background: profile.background,
    profile,
    referencePack,
    mood: savedAgent.mood || "等待再次入住",
    privateThought: savedAgent.privateThought || "这一次会遇见谁？",
    memory: createPortableAgentMemory(savedAgent.id),
    visual: normalizePixelPetProfile(savedAgent.visual, `${savedAgent.name}；${profile.personality}；${profile.background}；${profile.roleplayNotes}`, index * 96),
  };
  const agents = [...state.agents, agent];
  return { ...state, agents, spatial: normalizeSpatial(agents, state.spatial), relationshipDrafts: syncRelationshipDrafts(agents, state.relationshipDrafts), selectedMemoryAgentId: agent.id };
}

type LegacyRelationship = Partial<Relationship> & { affinity?: number; trust?: number; tension?: number; stage?: string; flags?: string[] };
function normalizeRelationship(raw: LegacyRelationship): Relationship {
  if (raw.directions?.length === 2) {
    const complete = raw as Relationship;
    const directions = complete.directions.map((view) => ({
      ...view,
      lens: normalizeRelationshipLens(view.lens, {
        ownerAgentId: view.from,
        targetAgentId: view.to,
        relationshipKind: "既有关系",
        playerAuthoredView: view.unresolvedThreads?.find((thread) => thread.startsWith("关系网设定："))?.replace("关系网设定：", "") || "",
        sharedHistory: complete.history?.[0] || "",
      }),
    })) as [RelationshipDirection, RelationshipDirection];
    const normalized = { ...complete, directions };
    return { ...normalized, status: normalized.status || derivePairStatus(normalized) };
  }
  const a = raw.a || "unknown-a";
  const b = raw.b || "unknown-b";
  const make = (from: string, to: string) => ({ ...createDirection(from, to), affinity: raw.affinity ?? 22, trust: raw.trust ?? 16, tension: raw.tension ?? 8, rejectionLocks: raw.flags?.includes("confession_resolved") && !raw.flags.includes("confession_accepted") ? ["romantic_pursuit"] : [] });
  const relationship: Relationship = { id: raw.id || pairId(a, b), a, b, directions: [make(a, b), make(b, a)], status: raw.stage || "不对称关系", turnsTogether: raw.turnsTogether || 0, history: raw.history || [], lastReason: "旧存档已迁移为双向独立关系；原共享值仅作为两条方向的初始参考" };
  relationship.status = derivePairStatus(relationship);
  return relationship;
}

function normalizeEvent(event: ChronicleEvent, fallbackMode: ExperienceMode): ChronicleEvent {
  return { ...event, mode: event.mode === "story" ? "story" : fallbackMode, level: event.level || "L1", memoryWrites: event.memoryWrites || Object.fromEntries(event.actorIds.map((id) => [id, event.memoryWrite || event.summary])) };
}

export function relationshipLabel(relationship: Relationship) { return derivePairStatus(relationship); }
export function directionSummary(relationship: Relationship, from: string) {
  const view = direction(relationship, from);
  return { label: relationshipDirectionLabel(view), affinity: qualitativeStage("affinity", view.affinity), trust: qualitativeStage("trust", view.trust), tension: qualitativeStage("tension", view.tension), cues: deriveRelationshipCues(view), lens: view.lens };
}

function reduceGameState(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "HYDRATE": {
      const incoming = action.state;
      const compatibleIncoming = { ...incoming } as GameState & Record<string, unknown>;
      delete compatibleIncoming.storySeeds;
      delete compatibleIncoming.directorScene;
      delete compatibleIncoming.checkpoint;
      delete compatibleIncoming.modeSelectionPending;
      const agents = incoming.agents.map((agent, index) => {
        const profile = normalizeCharacterProfile(agent.profile, agent);
        const referencePack = normalizeCharacterReferencePack(agent.referencePack, agent.name);
        return { ...agent, personality: profile.personality, background: profile.background, profile, referencePack, memory: normalizeAgentMemory(agent.memory, agent.id, incoming.turn || 0), visual: normalizePixelPetProfile(agent.visual, `${agent.name}；${profile.personality}；${profile.background}；${profile.roleplayNotes}`, index * 96) };
      });
      const worldCreatedAt = incoming.worldCreatedAt || (incoming.phase === "town" ? new Date().toISOString() : null);
      const worldId = incoming.worldId || (incoming.phase === "town" ? `world-migrated-${Date.now()}-${hash(agents.map((agent) => agent.id).join("|"))}` : "");
      const normalizedDirector = incoming.mode === "story" ? normalizeDirectorState(incoming.director || undefined) : null;
      const mode: ExperienceMode = incoming.mode === "story" && normalizedDirector ? "story" : "natural";
      const storyScene = mode === "story" && incoming.storyScene ? { ...DEFAULT_STORY_SCENE, ...incoming.storyScene, status: "stable" as const } : null;
      const storyContext = mode === "story" ? normalizeStoryContextForHydrate({
        rawEvents: incoming.storyPublicEvents,
        rawSummaries: incoming.storySummaryRevisions,
        rawRuntime: incoming.storyContextRuntime,
        chronicleEvents: incoming.events || [],
        currentBeatId: normalizedDirector?.currentBeatId || "",
        turn: incoming.turn || 0,
        createdAt: incoming.worldCreatedAt,
        privateFragments: agents.flatMap((agent) => [agent.privateThought, ...agent.memory.files.flatMap((file) => file.revisions.map((revision) => revision.content))]),
      }) : { storyPublicEvents: [], storySummaryRevisions: [], storyContextRuntime: null };
      const interactionSession = incoming.interactionSession?.schema === INTERACTION_SESSION_SCHEMA
        && agents.some((agent) => agent.id === incoming.interactionSession?.initiatorId)
        && agents.some((agent) => agent.id === incoming.interactionSession?.receiverId)
        && !["complete", "cancelled"].includes(incoming.interactionSession.phase)
        ? incoming.interactionSession
        : null;
      const backgroundWorldIndex = normalizeBackgroundWorldIndex(incoming.backgroundWorldIndex, worldId);
      const hydrated = { ...initialGameState, ...compatibleIncoming, worldId, worldCreatedAt, surface: "web" as const, running: false, mode, agents, spatial: normalizeSpatial(agents, incoming.spatial || {}), relationshipDrafts: syncRelationshipDrafts(agents, incoming.relationshipDrafts || []), relationships: (incoming.relationships || []).map((item) => normalizeRelationship(item)), events: (incoming.events || []).map((event) => normalizeEvent(event, mode)), scene: mode === "story" ? scenes[storyScene?.sceneId || "story-room"] || scenes["story-room"] : scenes.desktop, assetJobs: incoming.assetJobs || [], agentStageHistory: normalizeStageHistory(incoming.agentStageHistory, agents), publicDialogue: normalizePublicDialogue(incoming.publicDialogue, agents), interactionSession, desktopAttentionQueue: [], desktopTransientReaction: null, director: normalizedDirector, storyScene, worldEntities: mode === "story" && Array.isArray(incoming.worldEntities) ? incoming.worldEntities.slice(0, 24) : [], storyAttentionQueue: [], backgroundWorldIndex, ...storyContext, lastNotice: interactionSession ? "存档已载入；未完成的双人交互会话将从当前阶段安全恢复。" : mode === "story" ? storyContext.storyContextRuntime?.pendingReasons.includes("legacy_restore") ? "旧故事存档已载入；将在下一次 Director 调用前重建稳定剧情摘要。" : "故事存档已载入；稳定摘要与尾部公开事件已经恢复。" : "存档已载入；角色、双向关系、公开对话与独立记忆已恢复到自然模式。" } satisfies GameState;
      return projectRuntimeSurface(hydrated, "web");
    }
    case "ADD_AGENT": return addAgent(state, action.agent);
    case "ADD_SAVED_AGENT": return addSavedAgent(state, action.agent);
    case "REMOVE_AGENT": { if (state.phase !== "onboarding") return state; const agents = state.agents.filter((agent) => agent.id !== action.id); const agentStageHistory = { ...state.agentStageHistory }; delete agentStageHistory[action.id]; return { ...state, agents, agentStageHistory, publicDialogue: normalizePublicDialogue(state.publicDialogue, agents), spatial: normalizeSpatial(agents, state.spatial), relationshipDrafts: syncRelationshipDrafts(agents, state.relationshipDrafts), selectedMemoryAgentId: agents[0]?.id || "" }; }
    case "SET_AGENT_VISUAL": return state.phase === "onboarding" ? { ...state, agents: state.agents.map((agent) => agent.id === action.id ? { ...agent, visual: action.visual } : agent) } : state;
    case "SET_RELATIONSHIP_DRAFT": return state.phase === "onboarding" && state.relationshipDrafts.some((item) => item.id === action.draft.id) ? { ...state, relationshipDrafts: state.relationshipDrafts.map((item) => item.id === action.draft.id ? action.draft : item) } : state;
    case "ENTER_TOWN": return enterTown(state, action.mode, action.story);
    case "SELECT_MEMORY": return { ...state, selectedMemoryAgentId: action.id };
    case "SET_SURFACE": return projectRuntimeSurface(state, action.surface);
    case "SET_RUNNING": return state.phase === "town" ? { ...state, running: action.running } : state;
    case "APPLY_DESKTOP_DRAG": return applyDesktopDrag(state, action);
    case "APPLY_DESKTOP_POINTER_EVENT": return applyDesktopPointerEvent(state, action);
    case "DISMISS_DESKTOP_ATTENTION": return dismissDesktopAttention(state, action.agentId);
    case "TOGGLE_RUNNING": return state.phase === "town" ? { ...state, running: !state.running } : state;
    case "ADVANCE": return state.interactionSession ? advanceInteractionSession(state) : advanceNatural(state);
    case "ADVANCE_INTERACTION_SESSION": return advanceInteractionSession(state);
    case "APPLY_NATURAL_AGENT_TURN": {
      if (state.interactionSession) return state;
      const trigger = state.desktopAttentionQueue.find((item) => item.actorId === action.turn.actorDecision.actorId);
      const hasIndependentResponder = Boolean(action.turn.responderDecision || action.turn.responderDecisions?.length);
      const shouldStayTransient = trigger?.recordInChronicle === false
        && !desktopDecisionMovesPosition(action.turn.actorDecision)
        && !hasIndependentResponder;
      const next = shouldStayTransient
        ? applyTransientDesktopAgentDecision(state, action.turn.actorDecision)
        : applyNaturalAgentTurn(state, action.turn);
      const completedActorIds = new Set([
        action.turn.actorDecision.actorId,
        ...(action.turn.responderDecisions || []).map((decision) => decision.actorId),
        ...(action.turn.responderDecision ? [action.turn.responderDecision.actorId] : []),
      ]);
      return { ...next, desktopAttentionQueue: state.desktopAttentionQueue.filter((trigger) => !completedActorIds.has(trigger.actorId)), storyAttentionQueue: state.storyAttentionQueue.filter((trigger) => !completedActorIds.has(trigger.actorId)) };
    }
    case "QUEUE_PLAYER_DIRECTIVE": return state.mode === "story" && state.director ? { ...state, director: { ...state.director, pendingDirectives: [...state.director.pendingDirectives, action.directive].slice(-12) }, lastNotice: "玩家输入已按权限分类并交给 Director Agent；角色只会看到最终发生的公开事实。" } : state;
    case "APPLY_DIRECTOR_DECISION": return applyDirectorDecision(state, action.decision);
    case "REGISTER_BACKGROUND_ASSET": {
      if (state.mode !== "story" || !state.storyScene || action.sceneId !== state.storyScene.sceneId) return state;
      return {
        ...state,
        storyScene: { ...state.storyScene, backgroundAssetId: action.asset.id, backgroundUrl: action.asset.url },
        backgroundWorldIndex: registerWorldBackground(state.backgroundWorldIndex, action.asset, action.sceneId),
        lastNotice: `背景资产已复用并登记：${action.asset.title}。`,
      };
    }
    case "BEGIN_STORY_COMPACTION": return beginStoryCompaction(state, action.task);
    case "COMMIT_STORY_COMPACTION": return commitStoryCompaction(state, action.summary, action.usedDeterministicFallback);
    case "FAIL_STORY_COMPACTION": return failStoryCompaction(state, action.message);
    case "UPDATE_ASSET_JOB": {
      const exists = state.assetJobs.some((job) => job.id === action.job.id);
      return { ...state, assetJobs: (exists ? state.assetJobs.map((job) => job.id === action.job.id ? action.job : job) : [action.job, ...state.assetJobs]).slice(0, 24), lastNotice: action.job.status === "failed" ? `缺失动作生成失败，已使用 ${action.job.fallbackAction} 回退。` : `动作资产“${action.job.semanticIntent}”状态：${action.job.status}` };
    }
    case "REGISTER_AGENT_ASSET": {
      const agents = state.agents.map((agent) => agent.id === action.agentId ? { ...agent, visual: { ...agent.visual, actionPacks: mergePixelPetActionPacks(agent.visual.actionPacks, [action.pack]), actionRevision: Math.max(agent.visual.actionRevision || 1, action.pack.version) } } : agent);
      const exists = state.assetJobs.some((job) => job.id === action.job.id);
      const eventId = `event-asset-ready-${action.job.id}`;
      const actor = agents.find((agent) => agent.id === action.agentId);
      const alreadyRecorded = state.events.some((event) => event.id === eventId);
      const assetEvent: ChronicleEvent = {
        id: eventId,
        day: state.day,
        time: eventTime(state.turn),
        kind: "system",
        mode: state.mode,
        level: "L1",
        actorIds: actor ? [actor.id] : [],
        title: `${actor?.name || "角色"}获得了新的动作表情`,
        summary: `“${action.job.semanticIntent}”的视觉动作资源已完成校验并写入该角色的增量动作包。`,
        dialogue: [],
        impact: "卷轴只记录素材已经可用；是否以及何时使用，仍由该角色自己的 Character Agent 在未来回合决定。",
        memoryWrite: "",
        memoryWrites: {},
        sceneId: state.scene.id,
        relationshipReason: "生成素材不改变角色关系，也不替 Character Agent 决定行为。",
        assetActions: {},
      };
      return {
        ...state,
        agents,
        assetJobs: (exists ? state.assetJobs.map((job) => job.id === action.job.id ? action.job : job) : [action.job, ...state.assetJobs]).slice(0, 24),
        events: alreadyRecorded ? state.events : [assetEvent, ...state.events].slice(0, 100),
        lastNotice: "缺失动作已校验并登记为 ready，也已写入卷轴；角色未来仍会自行判断是否使用。",
      };
    }
    case "RESET": return initialGameState;
    default: return state;
  }
}

function enforceSpatialOccupancy(state: GameState): GameState {
  if (state.phase !== "town" || state.agents.length < 2) return state;
  const separated = separateSpatialOccupancy(state.agents, state.spatial);
  if (separated.movedIds.length === 0) return state;
  const spatial = Object.fromEntries(state.agents.map((agent) => {
    const self = separated.spatial[agent.id];
    const target = self.targetId ? separated.spatial[self.targetId] : null;
    if (!target) return [agent.id, { ...self, proximity: state.agents.length === 1 ? "alone" as const : "far" as const }];
    const confirmedContact = self.proximity === "touching"
      && target.proximity === "touching"
      && target.targetId === agent.id;
    return [agent.id, { ...self, proximity: proximityFor(self, target, confirmedContact) }];
  })) as Record<string, CharacterSpatialState>;
  return { ...state, spatial };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  const next = reduceGameState(state, action);
  // Only the dragged character follows the pointer. A single pinned
  // correction runs on drop when visible overlap is actually above 50%.
  if (action.type === "APPLY_DESKTOP_DRAG" && action.phase === "move") return next;
  return reconcileStoryContext(state, enforceSpatialOccupancy(next), action);
}
