import type { PixelPetActionPack } from "./pixel-pet";
import type { CharacterAgentMemoryReference, CharacterMemoryProposal, CharacterRoleplayMemoryCue, CharacterRoleplayMemoryProposal } from "./character-memory";
import type { CharacterProfileV2, RelationshipLens } from "./roleplay";
import type { CharacterReferenceContext } from "./character-reference";

export const CHARACTER_CONTEXT_SCHEMA = "cp-dance/character-context/v6" as const;
export const PUBLIC_DIALOGUE_SCHEMA = "cp-dance/public-dialogue/v1" as const;
export const GROUP_SCENE_SCHEMA = "cp-dance/group-scene/v1" as const;

export type AudienceScope = "one" | "selected" | "everyone";
export type ResponseExpectation = "required" | "welcome" | "none";
export type ParticipationIntent = "continue" | "join" | "interrupt" | "observe" | "withdraw" | "leave";
export type ParticipationStance = "speaking" | "engaged" | "observing" | "hesitant" | "excluded" | "withdrawing";

export type GroupParticipationState = {
  agentId: string;
  stance: ParticipationStance;
  attentionTo: string[];
  wantsFloor: boolean;
  lastSpokeTurn: number | null;
};

export type GroupSceneState = {
  schema: typeof GROUP_SCENE_SCHEMA;
  id: string | null;
  participantIds: string[];
  topic: string | null;
  sharedActivity: string | null;
  currentSpeakerId: string | null;
  addresseeIds: string[];
  audienceIds: string[];
  openQuestionIds: string[];
  participation: Record<string, GroupParticipationState>;
};

export function createEmptyGroupScene(): GroupSceneState {
  return {
    schema: GROUP_SCENE_SCHEMA,
    id: null,
    participantIds: [],
    topic: null,
    sharedActivity: null,
    currentSpeakerId: null,
    addresseeIds: [],
    audienceIds: [],
    openQuestionIds: [],
    participation: {},
  };
}

export const CHARACTER_SPEECH_ACTS = ["none", "statement", "question", "invitation", "reassurance", "tease", "challenge", "deflection", "confession", "boundary", "acknowledgement"] as const;
export type CharacterSpeechAct = (typeof CHARACTER_SPEECH_ACTS)[number];

export const CHARACTER_RESPONSE_MODES = ["initiate", "direct_answer", "indirect_answer", "counter_question", "deflect", "tease", "reassure", "challenge", "acknowledge", "remain_silent", "close"] as const;
export type CharacterResponseMode = (typeof CHARACTER_RESPONSE_MODES)[number];

export type PublicDialogueBeat = {
  id: string;
  sessionId: string;
  eventId: string;
  turn: number;
  speakerId: string;
  targetId: string | null;
  addresseeIds: string[];
  audienceIds: string[];
  audienceScope: AudienceScope;
  responseExpectation: ResponseExpectation;
  participationIntent: ParticipationIntent;
  spokenContent: string | null;
  observableBehavior: string;
  nonverbalBeat: string | null;
  speechAct: CharacterSpeechAct;
  responseMode: CharacterResponseMode;
  topic: string | null;
};

export type PendingDialogueQuestion = {
  id: string;
  sessionId: string;
  fromAgentId: string;
  toAgentId: string;
  text: string;
  createdTurn: number;
  status: "open" | "answered" | "withdrawn";
};

export type PublicDialogueState = {
  schema: typeof PUBLIC_DIALOGUE_SCHEMA;
  sessionId: string | null;
  participants: string[];
  status: "idle" | "active";
  currentTopic: string | null;
  lastSpeakerId: string | null;
  consecutiveBeats: number;
  transcript: PublicDialogueBeat[];
  pendingQuestions: PendingDialogueQuestion[];
  groupScene: GroupSceneState;
};

export type CharacterAgentStageHistoryEntry = {
  id: string;
  sessionId: string;
  turn: number;
  taskType: CharacterAgentTaskType;
  ownAction: string;
  spokenContent: string | null;
  nonverbalBeat: string | null;
  speechAct: CharacterSpeechAct;
  responseMode: CharacterResponseMode;
  topic: string | null;
  privateReflection: string;
  publicResult: string;
  memoryRevisionIds: string[];
};

export const CHARACTER_AGENT_TASK_TYPES = [
  "PERCEIVE_AND_DECIDE",
  "RESPOND_TO_SPEECH",
  "RESPOND_TO_INTERACTION_REQUEST",
  "CONTINUE_CURRENT_ACTION",
  "HANDLE_ACTION_RESULT",
  "REFLECT_AND_STORE",
] as const;

export type CharacterAgentTaskType = (typeof CHARACTER_AGENT_TASK_TYPES)[number];

export const CHARACTER_AGENT_ACTIONS = [
  "explore",
  "observe",
  "rest",
  "stay",
  "move_closer",
  "move_away",
  "face_other",
  "look_away",
  "speak",
  "remain_silent",
  "request_conversation",
  "request_touch",
  "request_shared_action",
  "end_interaction",
  "respond_accept",
  "respond_hesitate",
  "respond_reject",
  "respond_counter",
] as const;

export type CharacterAgentAction = (typeof CHARACTER_AGENT_ACTIONS)[number];
export type CharacterAgentResponse = "accept" | "hesitate" | "reject" | "counter" | null;
export type InteractionType = "conversation" | "touch" | "cuddle" | "hug" | "hand_contact" | "head_touch" | "shoulder_lean" | "pat" | "push" | "shared_action" | "joint_walk" | "dance" | "chase" | "assist" | "sensitive_topic" | null;

export type CharacterAgentTurnBrief = {
  whyAwakened: string;
  currentAction: string;
  unfinishedGoal: string | null;
  distance: "alone" | "far" | "normal" | "near" | "touching";
  pendingQuestion: string | null;
  lastOwnBeat: string | null;
  completionCondition: string;
};

export type CharacterAgentCapabilityEnvelope = {
  behaviorActions: CharacterAgentAction[];
  requestRequiredActions: CharacterAgentAction[];
  blockedActions: Array<{ action: CharacterAgentAction; reason: string }>;
  animationCatalog: Array<{ id: string; label: string }>;
};

export type CharacterAgentContext = {
  contextSchema: typeof CHARACTER_CONTEXT_SCHEMA;
  layers: {
    roleplay: {
      characterProfile: CharacterProfileV2;
      characterReference: CharacterReferenceContext | null;
      worldviewRules: string[];
      memorySummaries: CharacterAgentMemoryReference[];
      roleplayCues: CharacterRoleplayMemoryCue[];
    };
    stage: {
      taskType: CharacterAgentTaskType;
      instruction: string;
      knownBoundaries: string[];
      turnBrief: CharacterAgentTurnBrief;
      capabilities: CharacterAgentCapabilityEnvelope;
      /** @deprecated Use capabilities.animationCatalog. */
      allowedActions: string[];
      /** @deprecated Use capabilities.animationCatalog. */
      animationCatalog: Array<{ id: string; label: string }>;
      trigger: CharacterAgentTrigger;
      attentionReason: string;
      sceneBrief: {
        sceneId: string;
        location: string;
        timeOfDay: string;
        weather: string;
        atmosphere: string;
      } | null;
      visibleWorldEvents: string[];
      visibleEntities: Array<{ id: string; type: string; description: string; state: Record<string, string | number | boolean> }>;
      publicCharacterStatuses: string[];
      environmentAffordances: string[];
    };
    messageHistory: CharacterAgentStageHistoryEntry[];
    publicDialogue: PublicDialogueState;
    groupScene: GroupSceneState;
    budget: {
      memoryCharacters: number;
      historyCharacters: number;
      /** S3: approximate token counts. Kept alongside characters to preserve
       *  backward-compatible prompts; new integrations should prefer these. */
      memoryTokens?: number;
      historyTokens?: number;
    };
  };
  identity: {
    id: string;
    name: string;
    profile: CharacterProfileV2;
  };
  currentState: {
    physicalState: string;
    emotionalState: string;
    socialState: string;
    currentFocus: string;
  };
  goals: {
    immediateGoal: string;
    relationshipIntention: string;
    unspokenIntention: string;
  };
  understandingOfOther: {
    targetId: string | null;
    targetName: string | null;
    relationshipSummary: string;
    currentAttitude: string;
    knownBoundaries: string[];
    unresolvedMatters: string[];
    relationshipLens: RelationshipLens & {
      currentStance: string;
      currentEmotion: string;
      knownBoundaries: string[];
      unresolvedMatters: string[];
      lastPublicMoment: string | null;
    } | null;
  };
  relevantMemory: CharacterAgentMemoryReference[];
  observableSituation: {
    distance: "alone" | "far" | "normal" | "near" | "touching";
    orientation: string;
    publicEvents: string[];
    visibleDescription: string;
  };
  availableActions: string[];
};

export type CharacterAgentTrigger = {
  actorId: string;
  actorName: string;
  observableBehavior: string;
  spokenContent: string | null;
  nonverbalBeat: string | null;
  speechAct: CharacterSpeechAct;
  topic: string | null;
  interactionType: InteractionType;
  consentRequired: boolean;
  requiredResponse: boolean;
} | null;

export type CharacterAgentTask = {
  taskId: string;
  worldId: string;
  turn: number;
  stageSessionId: string;
  taskType: CharacterAgentTaskType;
  assignedTo: string;
  counterpartId: string | null;
  context: CharacterAgentContext;
  trigger: CharacterAgentTrigger;
};

export type CharacterAgentDecision = {
  taskId: string;
  stageSessionId: string;
  taskType: CharacterAgentTaskType;
  actorId: string;
  targetId: string | null;
  action: CharacterAgentAction;
  performanceIntent: string;
  observableBehavior: string;
  spokenContent: string | null;
  nonverbalBeat: string | null;
  speechAct: CharacterSpeechAct;
  responseMode: CharacterResponseMode;
  topic: string | null;
  addressedTo: string | null;
  addresseeIds: string[];
  audienceScope: AudienceScope;
  responseExpectation: ResponseExpectation;
  participationIntent: ParticipationIntent;
  continueScene: boolean;
  closeReason: string | null;
  privateThought: string;
  emotionalState: string;
  memoryWrite: string;
  memoryReadRevisions: string[];
  memoryProposal: CharacterMemoryProposal | null;
  roleplayMemory: CharacterRoleplayMemoryProposal;
  interactionType: InteractionType;
  response: CharacterAgentResponse;
  animationAction: string;
  animationDescription: string;
  continueGoal: string | null;
  guardrailNotes: string[];
  model?: string;
};

export type NaturalAgentTurn = {
  actorDecision: CharacterAgentDecision;
  responderDecision: CharacterAgentDecision | null;
  responderDecisions: CharacterAgentDecision[];
};

export type AssetLifecycle = "requested" | "generating" | "validating" | "ready" | "failed" | "deprecated";

export type CharacterAssetJob = {
  id: string;
  characterId: string;
  semanticIntent: string;
  fallbackAction: string;
  status: AssetLifecycle;
  requestedTurn: number;
  assetId: string | null;
  error: string | null;
};

export type GeneratedCharacterAsset = {
  job: CharacterAssetJob;
  pack: PixelPetActionPack;
};
