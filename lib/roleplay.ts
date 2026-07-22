export const CHARACTER_PROFILE_SCHEMA = "cp-dance/character-profile/v2" as const;
export const RELATIONSHIP_LENS_SCHEMA = "cp-dance/relationship-lens/v1" as const;

export type CharacterProfileV2 = {
  schema: typeof CHARACTER_PROFILE_SCHEMA;
  authoredBy: "player";
  personality: string;
  background: string;
  roleplayNotes: string;
};

export type RelationshipLens = {
  schema: typeof RELATIONSHIP_LENS_SCHEMA;
  ownerAgentId: string;
  targetAgentId: string;
  relationshipKind: string;
  playerAuthoredView: string;
  sharedHistory: string;
};

function safeText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, maxLength) : "";
}

export function createCharacterProfile(input: {
  personality?: string;
  background?: string;
  roleplayNotes?: string;
}): CharacterProfileV2 {
  return {
    schema: CHARACTER_PROFILE_SCHEMA,
    authoredBy: "player",
    personality: safeText(input.personality, 400) || "尚未展露真实个性",
    background: safeText(input.background, 1200) || "没有向任何人透露自己的过去。",
    roleplayNotes: safeText(input.roleplayNotes, 1600),
  };
}

export function normalizeCharacterProfile(
  value: unknown,
  fallback: { personality?: string; background?: string; roleplayNotes?: string },
) {
  const raw = value && typeof value === "object" ? value as Partial<CharacterProfileV2> : {};
  return createCharacterProfile({
    personality: safeText(raw.personality, 400) || fallback.personality,
    background: safeText(raw.background, 1200) || fallback.background,
    roleplayNotes: safeText(raw.roleplayNotes, 1600) || fallback.roleplayNotes,
  });
}

export function createRelationshipLens(input: {
  ownerAgentId: string;
  targetAgentId: string;
  relationshipKind?: string;
  playerAuthoredView?: string;
  sharedHistory?: string;
}): RelationshipLens {
  return {
    schema: RELATIONSHIP_LENS_SCHEMA,
    ownerAgentId: safeText(input.ownerAgentId, 180),
    targetAgentId: safeText(input.targetAgentId, 180),
    relationshipKind: safeText(input.relationshipKind, 80) || "初识",
    playerAuthoredView: safeText(input.playerAuthoredView, 800),
    sharedHistory: safeText(input.sharedHistory, 1200),
  };
}

export function normalizeRelationshipLens(
  value: unknown,
  fallback: Parameters<typeof createRelationshipLens>[0],
) {
  const raw = value && typeof value === "object" ? value as Partial<RelationshipLens> : {};
  return createRelationshipLens({
    ownerAgentId: safeText(raw.ownerAgentId, 180) || fallback.ownerAgentId,
    targetAgentId: safeText(raw.targetAgentId, 180) || fallback.targetAgentId,
    relationshipKind: safeText(raw.relationshipKind, 80) || fallback.relationshipKind,
    playerAuthoredView: safeText(raw.playerAuthoredView, 800) || fallback.playerAuthoredView,
    sharedHistory: safeText(raw.sharedHistory, 1200) || fallback.sharedHistory,
  });
}
