export const STORY_PUBLIC_EVENT_SCHEMA = "cp-dance/story-public-event/v1" as const;
export const STORY_CONTEXT_SUMMARY_SCHEMA = "cp-dance/story-context-summary/v1" as const;
export const STORY_CONTEXT_RUNTIME_SCHEMA = "cp-dance/story-context-runtime/v1" as const;

export const STORY_COMPACTION_LIMITS = {
  softTokenLimit: 6000,
  softByteLimit: 24 * 1024,
  hardTokenLimit: 8000,
  hardByteLimit: 32 * 1024,
  recentRawTokenReserve: 1800,
  recentRawBeatReserve: 12,
  stableSummaryTargetTokens: 1600,
  directorInputTokenBudget: 12000,
} as const;

export type StoryPublicEventSource = "player" | "director" | "character" | "runtime";

export type StoryPublicEvent = {
  schema: typeof STORY_PUBLIC_EVENT_SCHEMA;
  eventId: string;
  turn: number;
  sceneId: string;
  beatId: string;
  source: StoryPublicEventSource;
  type: string;
  publicContent: string;
  participants: string[];
  visibleTo: string[];
  createdAt: string;
};

export type StorySummaryScope = "scene" | "beat" | "story";
export type StoryCompactionReason = "soft_limit" | "hard_limit" | "scene_transition" | "beat_completed" | "outline_replan" | "legacy_restore" | "manual";
export type StoryCompactionStatus = "idle" | "requested" | "compacting" | "validating" | "failed";

export type StoryContextSummary = {
  schema: typeof STORY_CONTEXT_SUMMARY_SCHEMA;
  summaryId: string;
  revisionId: string;
  baseRevisionId?: string;
  scope: StorySummaryScope;
  sceneIds: string[];
  beatIds: string[];
  sourceEventIds: string[];
  coveredThroughEventId: string;
  objectiveFacts: Array<{ fact: string; sourceEventIds: string[] }>;
  publicCharacterDevelopments: Array<{
    characterId: string;
    statements: string[];
    actions: string[];
    publicStatusChanges: string[];
    sourceEventIds: string[];
  }>;
  plotProgress: {
    completedConditions: string[];
    failedOrInvalidatedConditions: string[];
    newlyUnlockedConditions: string[];
  };
  unresolvedThreads: Array<{
    threadId: string;
    description: string;
    status: "open" | "partially_resolved";
    introducedByEventId: string;
    latestRelatedEventId?: string;
  }>;
  cluesAndSecrets: Array<{
    clueId: string;
    content: string;
    visibility: "public" | "director_only";
    status: "active" | "resolved" | "invalidated";
    sourceEventIds: string[];
  }>;
  playerDirectives: Array<{
    directiveId: string;
    summary: string;
    status: "pending" | "partially_applied" | "applied" | "superseded";
  }>;
  sceneResult: string;
  nextStoryConstraints: string[];
  createdAt: string;
};

export type StoryPinnedContext = {
  unansweredQuestions: Array<{ id: string; text: string; fromAgentId: string; toAgentId: string | null }>;
  activeRequests: Array<{ id: string; description: string; participantIds: string[] }>;
  activeWorldEntities: Array<{ id: string; type: string; description: string; state: Record<string, string | number | boolean> }>;
  publicCharacterStatuses: string[];
  unresolvedClues: Array<{ id: string; description: string }>;
  pendingPlayerDirectives: Array<{ id: string; type: string; text: string; status: string }>;
  currentBeatConditions: Array<{ kind: "entry" | "completion"; text: string; runtimeStatus: "pending" | "completed" | "invalidated" }>;
};

export type StoryContextRuntime = {
  schema: typeof STORY_CONTEXT_RUNTIME_SCHEMA;
  currentStableSummaryRevisionId?: string;
  coveredThroughEventId?: string;
  sceneSummaryRevisionIds: string[];
  beatSummaryRevisionIds: string[];
  uncompactedEventIds: string[];
  estimatedUncompactedTokens: number;
  estimatedUncompactedBytes: number;
  lastCompactedTurn: number;
  lastCompactedSceneId?: string;
  compactionStatus: StoryCompactionStatus;
  pendingReasons: StoryCompactionReason[];
  pendingSourceEventIds: string[];
  pendingAllowedSourceEventIds: string[];
  pendingBaseRevisionId?: string;
  pendingRequestedRevisionId?: string;
  lastFailure?: string;
  deterministicFallbackCount: number;
};

export type StoryCompactionTask = {
  taskType: "compact_story";
  worldId: string;
  turn: number;
  reason: StoryCompactionReason;
  baseSummary: StoryContextSummary | null;
  sourceEvents: StoryPublicEvent[];
  pinnedContext: StoryPinnedContext;
  runtimeDeterminations: {
    completedBeatConditions: string[];
    invalidatedBeatConditions: string[];
    activeSceneId: string;
    activeBeatId: string;
    outlineRevision: number;
  };
  requestedRevisionId: string;
  requestedSummaryId: string;
  targetTokens: number;
};
