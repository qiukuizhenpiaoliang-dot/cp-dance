export const CHARACTER_REFERENCE_SCHEMA = "cp-dance/character-reference-pack/v1" as const;
export const CHARACTER_PROFILE_DISTILLATION_SCHEMA = "cp-dance/character-profile-distillation/v1" as const;

export const REFERENCE_CLAIM_TYPES = [
  "identity",
  "background",
  "timeline",
  "behavior",
  "value",
  "speech_pattern",
  "boundary",
  "relationship",
] as const;
export type ReferenceClaimType = (typeof REFERENCE_CLAIM_TYPES)[number];

export const REFERENCE_CONFIDENCE_LEVELS = ["confirmed", "supported", "inferred"] as const;
export type ReferenceConfidence = (typeof REFERENCE_CONFIDENCE_LEVELS)[number];

export const CANON_RELATION_TYPES = [
  "family",
  "friend",
  "mentor",
  "student",
  "rival",
  "enemy",
  "ally",
  "romantic",
  "former_relationship",
  "complicated",
] as const;
export type CanonRelationType = (typeof CANON_RELATION_TYPES)[number];

export type CharacterReferenceSource = {
  id: string;
  kind: "wikipedia" | "wikidata" | "moegirl";
  title: string;
  url: string;
  revisionId: string | null;
  retrievedAt: string;
  language: string;
  licenseName: string;
  licenseUrl: string;
  commercialUse: "allowed" | "prohibited" | "unknown";
  attributionText: string;
  contentMode?: "full_page" | "summary" | "structured";
  contentCharacters?: number;
  contentSections?: number;
  contentChunks?: number;
  contentTruncated?: boolean;
};

export type CharacterReferenceClaim = {
  id: string;
  type: ReferenceClaimType;
  text: string;
  confidence: ReferenceConfidence;
  evidenceSourceIds: string[];
  evidenceSnippet: string | null;
  selectedByPlayer: boolean;
};

export type CanonRelationshipFact = {
  id: string;
  targetQid: string | null;
  targetName: string;
  relationType: CanonRelationType;
  directionDescription: string;
  sharedEvents: string[];
  confidence: ReferenceConfidence;
  evidenceSourceIds: string[];
  selectedByPlayer: boolean;
};

export type CharacterReferencePackV1 = {
  schema: typeof CHARACTER_REFERENCE_SCHEMA;
  enabled: boolean;
  query: string;
  canonScope: string;
  entity: {
    qid: string | null;
    name: string;
    aliases: string[];
    description: string;
    language: string;
    wikipediaTitle: string | null;
    moegirlTitle: string | null;
  };
  sources: CharacterReferenceSource[];
  claims: CharacterReferenceClaim[];
  relationships: CanonRelationshipFact[];
  backgroundDraft: string;
  roleplayNotesDraft: string;
  limitations: string[];
  researchedAt: string | null;
  appliedAt: string | null;
};

export type CharacterResearchCandidate = {
  id: string;
  qid: string | null;
  title: string;
  description: string;
  excerpt: string;
  language: string;
  wikipediaTitle: string | null;
  sourceKind: "wikipedia" | "wikidata" | "moegirl";
  sourceUrl: string;
  entityKind: "character" | "person" | "unknown";
  matchKind: "exact" | "alias" | "related";
  isDisambiguation?: boolean;
  matchedQuery?: string | null;
};

export type CharacterProfileDistillationV1 = {
  schema: typeof CHARACTER_PROFILE_DISTILLATION_SCHEMA;
  name: string;
  personality: string;
  background: string;
  roleplayNotes: string;
  summary: string;
  sourceClaimIds: string[];
  sourceRelationshipIds: string[];
  generatedAt: string;
};

export type CharacterReferenceContext = {
  schema: typeof CHARACTER_REFERENCE_SCHEMA;
  entityName: string;
  canonScope: string;
  claims: Array<Pick<CharacterReferenceClaim, "type" | "text" | "confidence">>;
  relationships: Array<Pick<CanonRelationshipFact, "targetName" | "relationType" | "directionDescription" | "sharedEvents" | "confidence">>;
  limitations: string[];
};

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function cleanList(value: unknown, limit: number, maxLength: number) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => cleanText(item, maxLength)).filter(Boolean))].slice(0, limit)
    : [];
}

function cleanMultiline(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value.replace(/\u0000/g, "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxLength)
    : "";
}

function cleanCount(value: unknown, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(max, Math.round(number))) : 0;
}

export function normalizeCharacterProfileDistillation(
  value: unknown,
  fallback: { name: string; personality: string; background: string; roleplayNotes: string },
): CharacterProfileDistillationV1 {
  const raw = value && typeof value === "object" ? value as Partial<CharacterProfileDistillationV1> : {};
  return {
    schema: CHARACTER_PROFILE_DISTILLATION_SCHEMA,
    name: cleanText(raw.name, 100) || cleanText(fallback.name, 100),
    personality: cleanMultiline(raw.personality, 160) || cleanMultiline(fallback.personality, 160),
    background: cleanMultiline(raw.background, 1200) || cleanMultiline(fallback.background, 1200),
    roleplayNotes: cleanMultiline(raw.roleplayNotes, 1600) || cleanMultiline(fallback.roleplayNotes, 1600),
    summary: cleanMultiline(raw.summary, 500),
    sourceClaimIds: cleanList(raw.sourceClaimIds, 24, 120),
    sourceRelationshipIds: cleanList(raw.sourceRelationshipIds, 20, 120),
    generatedAt: cleanText(raw.generatedAt, 80) || new Date().toISOString(),
  };
}

function safeQid(value: unknown) {
  const qid = cleanText(value, 32).toUpperCase();
  return /^Q\d+$/.test(qid) ? qid : null;
}

export function createEmptyCharacterReferencePack(query = ""): CharacterReferencePackV1 {
  return {
    schema: CHARACTER_REFERENCE_SCHEMA,
    enabled: false,
    query: cleanText(query, 100),
    canonScope: "",
    entity: { qid: null, name: "", aliases: [], description: "", language: "zh", wikipediaTitle: null, moegirlTitle: null },
    sources: [],
    claims: [],
    relationships: [],
    backgroundDraft: "",
    roleplayNotesDraft: "",
    limitations: [],
    researchedAt: null,
    appliedAt: null,
  };
}

export function normalizeCharacterReferencePack(value: unknown, fallbackName = ""): CharacterReferencePackV1 {
  if (!value || typeof value !== "object") return createEmptyCharacterReferencePack(fallbackName);
  const raw = value as Partial<CharacterReferencePackV1>;
  const entity = raw.entity && typeof raw.entity === "object" ? raw.entity : createEmptyCharacterReferencePack().entity;
  const sources = Array.isArray(raw.sources) ? raw.sources.map((source, index): CharacterReferenceSource | null => {
    if (!source || typeof source !== "object") return null;
    const item = source as Partial<CharacterReferenceSource>;
    const url = cleanText(item.url, 800);
    const kind = item.kind === "wikidata" ? "wikidata" : item.kind === "moegirl" ? "moegirl" : "wikipedia";
    const defaultLicense = kind === "moegirl"
      ? {
          licenseName: "CC BY-NC-SA 3.0 CN",
          licenseUrl: "https://zh.moegirl.org.cn/萌娘百科:著作权信息",
          commercialUse: "prohibited" as const,
          attributionText: "引自萌娘百科",
        }
      : kind === "wikidata"
        ? {
            licenseName: "CC0 1.0",
            licenseUrl: "https://www.wikidata.org/wiki/Wikidata:Copyright",
            commercialUse: "allowed" as const,
            attributionText: "来源：Wikidata",
          }
        : {
            licenseName: "CC BY-SA 4.0",
            licenseUrl: "https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use",
            commercialUse: "allowed" as const,
            attributionText: "来源：Wikipedia",
          };
    if (!url || !/^https:\/\//.test(url)) return null;
    return {
      id: cleanText(item.id, 120) || `reference-source-${index}`,
      kind,
      title: cleanText(item.title, 180),
      url,
      revisionId: cleanText(item.revisionId, 80) || null,
      retrievedAt: cleanText(item.retrievedAt, 80),
      language: cleanText(item.language, 12) || "zh",
      licenseName: cleanText(item.licenseName, 100) || defaultLicense.licenseName,
      licenseUrl: cleanText(item.licenseUrl, 800) || defaultLicense.licenseUrl,
      commercialUse: item.commercialUse === "prohibited" || item.commercialUse === "allowed" ? item.commercialUse : defaultLicense.commercialUse,
      attributionText: cleanText(item.attributionText, 160) || defaultLicense.attributionText,
      contentMode: item.contentMode === "full_page" || item.contentMode === "structured" ? item.contentMode : "summary",
      contentCharacters: cleanCount(item.contentCharacters, 500_000),
      contentSections: cleanCount(item.contentSections, 2_000),
      contentChunks: cleanCount(item.contentChunks, 32),
      contentTruncated: item.contentTruncated === true,
    };
  }).filter((source): source is CharacterReferenceSource => Boolean(source)).slice(0, 8) : [];
  const sourceIds = new Set(sources.map((source) => source.id));
  const claims = Array.isArray(raw.claims) ? raw.claims.map((claim, index): CharacterReferenceClaim | null => {
    if (!claim || typeof claim !== "object") return null;
    const item = claim as Partial<CharacterReferenceClaim>;
    const text = cleanText(item.text, 500);
    if (!text) return null;
    const type = (REFERENCE_CLAIM_TYPES as readonly string[]).includes(item.type || "") ? item.type as ReferenceClaimType : "background";
    const confidence = (REFERENCE_CONFIDENCE_LEVELS as readonly string[]).includes(item.confidence || "") ? item.confidence as ReferenceConfidence : "inferred";
    return {
      id: cleanText(item.id, 120) || `reference-claim-${index}`,
      type,
      text,
      confidence,
      evidenceSourceIds: cleanList(item.evidenceSourceIds, 4, 120).filter((id) => sourceIds.has(id)),
      evidenceSnippet: cleanText(item.evidenceSnippet, 240) || null,
      selectedByPlayer: item.selectedByPlayer === true,
    };
  }).filter((claim): claim is CharacterReferenceClaim => Boolean(claim)).slice(0, 24) : [];
  const relationships = Array.isArray(raw.relationships) ? raw.relationships.map((relation, index): CanonRelationshipFact | null => {
    if (!relation || typeof relation !== "object") return null;
    const item = relation as Partial<CanonRelationshipFact>;
    const targetName = cleanText(item.targetName, 100);
    const directionDescription = cleanText(item.directionDescription, 500);
    if (!targetName || !directionDescription) return null;
    const relationType = (CANON_RELATION_TYPES as readonly string[]).includes(item.relationType || "") ? item.relationType as CanonRelationType : "complicated";
    const confidence = (REFERENCE_CONFIDENCE_LEVELS as readonly string[]).includes(item.confidence || "") ? item.confidence as ReferenceConfidence : "inferred";
    return {
      id: cleanText(item.id, 120) || `reference-relation-${index}`,
      targetQid: safeQid(item.targetQid),
      targetName,
      relationType,
      directionDescription,
      sharedEvents: cleanList(item.sharedEvents, 6, 240),
      confidence,
      evidenceSourceIds: cleanList(item.evidenceSourceIds, 4, 120).filter((id) => sourceIds.has(id)),
      selectedByPlayer: item.selectedByPlayer === true,
    };
  }).filter((relation): relation is CanonRelationshipFact => Boolean(relation)).slice(0, 20) : [];
  return {
    schema: CHARACTER_REFERENCE_SCHEMA,
    enabled: raw.enabled === true,
    query: cleanText(raw.query, 100) || cleanText(fallbackName, 100),
    canonScope: cleanText(raw.canonScope, 160),
    entity: {
      qid: safeQid(entity.qid),
      name: cleanText(entity.name, 100) || cleanText(fallbackName, 100),
      aliases: cleanList(entity.aliases, 16, 100),
      description: cleanText(entity.description, 320),
      language: cleanText(entity.language, 12) || "zh",
      wikipediaTitle: cleanText(entity.wikipediaTitle, 180) || null,
      moegirlTitle: cleanText(entity.moegirlTitle, 180) || null,
    },
    sources,
    claims,
    relationships,
    backgroundDraft: cleanText(raw.backgroundDraft, 1200),
    roleplayNotesDraft: cleanText(raw.roleplayNotesDraft, 1600),
    limitations: cleanList(raw.limitations, 8, 320),
    researchedAt: cleanText(raw.researchedAt, 80) || null,
    appliedAt: cleanText(raw.appliedAt, 80) || null,
  };
}

function normalizedName(value: string) {
  return value.toLocaleLowerCase().replace(/[\s·・.（）()【】\[\]_-]/g, "");
}

export function findCanonRelationship(
  ownerPack: CharacterReferencePackV1,
  target: { name: string; referencePack?: CharacterReferencePackV1 },
) {
  if (!ownerPack.enabled) return null;
  const targetPack = target.referencePack ? normalizeCharacterReferencePack(target.referencePack, target.name) : null;
  const targetQid = targetPack?.enabled ? targetPack.entity.qid : null;
  const targetNames = new Set([
    normalizedName(target.name),
    ...(targetPack?.entity.aliases || []).map(normalizedName),
    targetPack?.entity.name ? normalizedName(targetPack.entity.name) : "",
  ].filter(Boolean));
  return ownerPack.relationships.find((relation) => relation.selectedByPlayer && (
    Boolean(targetQid && relation.targetQid === targetQid)
    || targetNames.has(normalizedName(relation.targetName))
  )) || null;
}

export function buildCharacterReferenceContext(
  packValue: CharacterReferencePackV1,
  target?: { name: string; referencePack?: CharacterReferencePackV1 } | null,
): CharacterReferenceContext | null {
  const pack = normalizeCharacterReferencePack(packValue);
  if (!pack.enabled) return null;
  const targetRelation = target ? findCanonRelationship(pack, target) : null;
  return {
    schema: CHARACTER_REFERENCE_SCHEMA,
    entityName: pack.entity.name,
    canonScope: pack.canonScope,
    claims: pack.claims.filter((claim) => claim.selectedByPlayer).slice(0, 8).map(({ type, text, confidence }) => ({ type, text, confidence })),
    relationships: targetRelation ? [{
      targetName: targetRelation.targetName,
      relationType: targetRelation.relationType,
      directionDescription: targetRelation.directionDescription,
      sharedEvents: targetRelation.sharedEvents,
      confidence: targetRelation.confidence,
    }] : [],
    limitations: pack.limitations.slice(0, 4),
  };
}

export function referenceRelationKind(type: CanonRelationType) {
  if (type === "family") return "亲属" as const;
  if (type === "friend") return "朋友" as const;
  if (type === "ally" || type === "mentor" || type === "student") return "同伴" as const;
  if (type === "rival" || type === "enemy") return "宿敌" as const;
  return "自定义" as const;
}

export function selectedReferenceDraft(packValue: CharacterReferencePackV1) {
  const pack = normalizeCharacterReferencePack(packValue);
  const backgroundClaims = pack.claims.filter((claim) => claim.selectedByPlayer && ["identity", "background", "timeline"].includes(claim.type));
  const roleplayClaims = pack.claims.filter((claim) => claim.selectedByPlayer && ["behavior", "value", "speech_pattern", "boundary"].includes(claim.type));
  return {
    background: backgroundClaims.length ? backgroundClaims.map((claim) => claim.text).join(" ").slice(0, 1200) : pack.backgroundDraft,
    roleplayNotes: roleplayClaims.length ? roleplayClaims.map((claim) => `- ${claim.text}`).join("\n").slice(0, 1600) : pack.roleplayNotesDraft,
  };
}

function mergeProfileField(base: string, addition: string, maxLength: number) {
  const current = cleanMultiline(base, maxLength);
  const next = cleanMultiline(addition, maxLength);
  if (!next || current.includes(next)) return current;
  return [current, next].filter(Boolean).join("\n\n").slice(0, maxLength);
}

export function createCharacterProfileDistillation(
  profile: { name: string; personality: string; background: string; roleplayNotes: string },
  packValue: CharacterReferencePackV1,
): CharacterProfileDistillationV1 {
  const pack = normalizeCharacterReferencePack(packValue, profile.name);
  const draft = selectedReferenceDraft(pack);
  const personalityClaims = pack.claims
    .filter((claim) => claim.selectedByPlayer && ["behavior", "value", "boundary"].includes(claim.type))
    .map((claim) => claim.text)
    .join("；");
  const relationNotes = pack.relationships
    .filter((relation) => relation.selectedByPlayer)
    .map((relation) => `${pack.entity.name || profile.name}对${relation.targetName}：${relation.directionDescription}`)
    .join("\n");
  return normalizeCharacterProfileDistillation({
    schema: CHARACTER_PROFILE_DISTILLATION_SCHEMA,
    name: profile.name,
    personality: mergeProfileField(profile.personality, personalityClaims, 160),
    background: mergeProfileField(profile.background, draft.background, 1200),
    roleplayNotes: mergeProfileField(mergeProfileField(profile.roleplayNotes, draft.roleplayNotes, 1600), relationNotes, 1600),
    summary: `以玩家填写资料为主，融合 ${pack.claims.filter((claim) => claim.selectedByPlayer).length} 条已确认百科设定和 ${pack.relationships.filter((relation) => relation.selectedByPlayer).length} 条关系事实。`,
    sourceClaimIds: pack.claims.filter((claim) => claim.selectedByPlayer).map((claim) => claim.id),
    sourceRelationshipIds: pack.relationships.filter((relation) => relation.selectedByPlayer).map((relation) => relation.id),
    generatedAt: new Date().toISOString(),
  }, profile);
}
