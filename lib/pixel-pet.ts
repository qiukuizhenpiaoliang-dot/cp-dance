import { createEstimatedInteractionRig, normalizeInteractionRig, type InteractionRig } from "./duo-interaction";
import { inferActionUnitMetadata, normalizeActionUnitMetadata, type ActionUnitMetadata } from "./action-unit";

export const PIXEL_PET_SCHEMA = "pixel-pet/v1" as const;
export const PIXEL_PET_LEGACY_ORIENTATION_PROTOCOL = "front-three-quarter-v1" as const;
export const PIXEL_PET_ORIENTATION_PROTOCOL = "front-three-quarter-v2" as const;
export const PIXEL_PET_SPRITE_NORMALIZATION_VERSION = 3 as const;
export const PIXEL_PET_SMART_REPAIR_VERSION = 2 as const;
export const DEMO_REFERENCE_URL = "";
export const DEMO_SPRITE_SHEET_URL = "";

export type PixelPetFacing = "front" | "left" | "right";
export type PixelPetFacingFrames = Partial<Record<PixelPetFacing, readonly number[]>>;
export type PixelPetOrientationProtocol = typeof PIXEL_PET_LEGACY_ORIENTATION_PROTOCOL | typeof PIXEL_PET_ORIENTATION_PROTOCOL;

export type PixelPetPreset = {
  id: string;
  name: string;
  sourceName: string;
  referenceUrl: string;
  spriteSheetUrl: string;
  configUrl: string | null;
  interactiveUrl: string | null;
  packageUrl: string | null;
  interactionUrl: string | null;
  demoHue: boolean;
};

export const PIXEL_PET_PRESETS: readonly PixelPetPreset[] = [];

export const PIXEL_PET_ACTIONS = {
  idle: { label: "待机", frames: [0, 1, 0, 1, 0, 2, 3, 0], frameDuration: 360, loop: true, unit: inferActionUnitMetadata("idle", "待机") },
  walk: { label: "走路", frames: [4, 5, 6, 7], frameDuration: 170, loop: true, unit: inferActionUnitMetadata("walk", "走路") },
  wave: { label: "挥手", frames: [8, 9, 8, 9, 8], frameDuration: 210, loop: false, unit: inferActionUnitMetadata("wave", "挥手") },
  cry: { label: "流泪", frames: [10, 10, 0], frameDuration: 420, loop: false, unit: inferActionUnitMetadata("cry", "流泪") },
  love: { label: "心动", frames: [11, 11, 0, 11], frameDuration: 330, loop: false, unit: inferActionUnitMetadata("love", "心动") },
  shy: { label: "害羞", frames: [0, 1, 0, 1], frameDuration: 420, loop: false, unit: inferActionUnitMetadata("shy", "害羞") },
  angry: { label: "生气", frames: [2, 3, 2, 3], frameDuration: 260, loop: false, unit: inferActionUnitMetadata("angry", "生气") },
  talk: { label: "交谈", frames: [4, 5, 4, 5], frameDuration: 260, loop: false, unit: inferActionUnitMetadata("talk", "交谈") },
  listen: { label: "倾听", frames: [6, 7, 6, 7], frameDuration: 360, loop: false, unit: inferActionUnitMetadata("listen", "倾听") },
} as const;

export const PIXEL_PET_BASE_ACTION_NAMES = ["idle", "walk", "wave", "cry", "love"] as const;

export const PIXEL_PET_PIPELINE = [
  { label: "读取角色", detail: "锁定轮廓、配色与比例" },
  { label: "生成动作", detail: "构建待机、移动与情绪帧" },
  { label: "帧归一化", detail: "统一 4 × 5 方向网格与脚底基线" },
  { label: "骨骼与 QA", detail: "检测身份、基线与双人接触锚点" },
  { label: "绑定角色", detail: "写入 Sprite Sheet 与交互配置" },
] as const;

export type PixelPetActionName = keyof typeof PIXEL_PET_ACTIONS;
export type PixelPetRuntimeActionName = PixelPetActionName | (string & {});

export type PixelPetActionDefinition = {
  label: string;
  frames: readonly number[];
  facingFrames?: PixelPetFacingFrames;
  frameDuration: number;
  loop: boolean;
  unit?: ActionUnitMetadata;
};

const PIXEL_PET_DIRECTIONAL_BASE_FRAMES_V1: Partial<Record<PixelPetActionName, PixelPetFacingFrames>> = {
  idle: {
    front: [0, 2, 0, 2],
    left: [1, 1, 1, 1],
    right: [3, 3, 3, 3],
  },
  walk: {
    left: [4, 5, 4, 5],
    right: [6, 7, 6, 7],
  },
  wave: {
    left: [8, 8, 8],
    right: [9, 9, 9],
  },
  cry: { front: [10, 10, 10] },
  love: { front: [11, 11, 11] },
};

const PIXEL_PET_DIRECTIONAL_BASE_FRAMES_V2: Partial<Record<PixelPetActionName, PixelPetFacingFrames>> = {
  idle: {
    front: [0, 1, 0, 1],
    left: [2, 2, 2, 2],
    right: [3, 3, 3, 3],
  },
  walk: {
    left: [4, 5, 4, 5],
    right: [6, 7, 6, 7],
  },
  wave: {
    front: [8, 9, 8, 9],
    left: [10, 10, 10],
    right: [11, 11, 11],
  },
  cry: {
    front: [12, 12, 15],
    left: [13, 13, 2],
    right: [14, 14, 3],
  },
  love: {
    front: [16, 16, 19, 16],
    left: [17, 17, 2, 17],
    right: [18, 18, 3, 18],
  },
};

export type PixelPetActionPack = {
  schema: "pixel-pet/action-pack/v1";
  id: string;
  version: number;
  parentVersion: string;
  generatedBy: "pixel-pet-agent";
  request: string;
  sheetUrl: string;
  grid: { columns: number; rows: number; frameWidth: number; frameHeight: number };
  actions: Record<string, PixelPetActionDefinition>;
  spriteNormalizationVersion?: number;
  createdAt: string;
};

export type PixelPetActionExtensionRequest = {
  schema: "pixel-pet/action-request/v1";
  requestedActions: string[];
  existingActions: string[];
  parentVersion: string;
  mergePolicy: "append-only";
  referenceUrl: string | null;
};

export type PixelPetQaMetrics = {
  identity: number;
  baseline: number;
  transparentCorners: number;
  backgroundUniformity: number;
  silhouetteDrift: number;
  actionDiversity: number;
  orientationCoverage: number;
  uniquePoseCount: number;
  frameCompleteness: number;
  boundaryConfidence: number;
  frameWidth: number;
  frameHeight: number;
};

/** A single bounded undo point for the last completed character-action forge. */
export type PixelPetForgeSnapshot = {
  sourceName: string;
  referenceUrl: string | null;
  spriteSheetUrl: string;
  grid: { columns: 4; rows: number; frameWidth: number; frameHeight: number };
  anchor: { x: number; y: number };
  interactionRig: InteractionRig;
  qa: PixelPetQaMetrics | null;
  generatedAt: string | null;
  generationModel: string | null;
  generationMode: "aigc" | "local-fallback" | null;
  generationWarning: string | null;
  orientationProtocol: PixelPetOrientationProtocol | null;
  spriteNormalizationVersion: number | null;
  actionRevision: number;
  actionPacks: PixelPetActionPack[];
  hueRotate: number;
  usesDemoAsset: boolean;
};

export const DEMO_QA_METRICS: PixelPetQaMetrics = {
  identity: 98.2,
  baseline: 0.7,
  transparentCorners: 100,
  backgroundUniformity: 100,
  silhouetteDrift: 1.8,
  actionDiversity: 24.6,
  orientationCoverage: 0,
  uniquePoseCount: 8,
  frameCompleteness: 100,
  boundaryConfidence: 100,
  frameWidth: 362,
  frameHeight: 362,
};

export type PixelPetProfile = {
  schema: typeof PIXEL_PET_SCHEMA;
  status: "draft" | "generating" | "ready";
  provider: "pixel-pet-agent";
  promptBrief: string;
  sourceName: string;
  referenceUrl: string | null;
  spriteSheetUrl: string | null;
  grid: {
    columns: 4;
    rows: number;
    frameWidth: number;
    frameHeight: number;
  };
  anchor: { x: number; y: number };
  interactionRig: InteractionRig;
  qa: PixelPetQaMetrics | null;
  generatedAt: string | null;
  generationModel?: string | null;
  generationMode?: "aigc" | "local-fallback" | null;
  generationWarning?: string | null;
  orientationProtocol?: PixelPetOrientationProtocol | null;
  spriteNormalizationVersion?: number | null;
  actionRevision?: number;
  actionPacks?: PixelPetActionPack[];
  previousForge?: PixelPetForgeSnapshot | null;
  hueRotate: number;
  usesDemoAsset: boolean;
};

const PRESET_EMOTION_PACKS: Record<string, Omit<PixelPetActionPack, "request" | "createdAt">> = {};

export function createPresetEmotionPack(presetId: string, request: string): PixelPetActionPack | null {
  const pack = PRESET_EMOTION_PACKS[presetId];
  return pack ? { ...pack, request, createdAt: new Date().toISOString() } : null;
}

export function mergePixelPetActionPacks(current: PixelPetActionPack[] | undefined, incoming: PixelPetActionPack[]) {
  const merged = new Map((current || []).map((pack) => [pack.id, pack]));
  incoming.forEach((pack) => merged.set(pack.id, pack));
  return [...merged.values()].sort((a, b) => a.version - b.version);
}

export function createPixelPetForgeSnapshot(visual: PixelPetProfile): PixelPetForgeSnapshot | null {
  if (visual.status !== "ready" || !visual.spriteSheetUrl) return visual.previousForge || null;
  return {
    sourceName: visual.sourceName,
    referenceUrl: visual.referenceUrl,
    spriteSheetUrl: visual.spriteSheetUrl,
    grid: { ...visual.grid },
    anchor: { ...visual.anchor },
    interactionRig: visual.interactionRig,
    qa: visual.qa ? { ...visual.qa } : null,
    generatedAt: visual.generatedAt,
    generationModel: visual.generationModel || null,
    generationMode: visual.generationMode || null,
    generationWarning: visual.generationWarning || null,
    orientationProtocol: visual.orientationProtocol || null,
    spriteNormalizationVersion: visual.spriteNormalizationVersion || null,
    actionRevision: visual.actionRevision || 1,
    actionPacks: [...(visual.actionPacks || [])],
    hueRotate: visual.hueRotate,
    usesDemoAsset: visual.usesDemoAsset,
  };
}

export function restorePreviousPixelPetForge(visual: PixelPetProfile): PixelPetProfile | null {
  if (!visual.previousForge) return null;
  return {
    ...visual,
    ...visual.previousForge,
    status: "ready",
    previousForge: null,
  };
}

export function availablePixelPetActions(visual: Pick<PixelPetProfile, "actionPacks">): PixelPetRuntimeActionName[] {
  const actions = new Set<PixelPetRuntimeActionName>(PIXEL_PET_BASE_ACTION_NAMES);
  visual.actionPacks?.forEach((pack) => {
    Object.keys(pack.actions).forEach((action) => actions.add(action));
  });
  return [...actions];
}

export function pixelPetActionCatalog(visual: Pick<PixelPetProfile, "actionPacks">) {
  const entries = new Map<string, string>(PIXEL_PET_BASE_ACTION_NAMES.map((id) => [id, PIXEL_PET_ACTIONS[id].label]));
  visual.actionPacks?.forEach((pack) => {
    Object.entries(pack.actions).forEach(([id, action]) => entries.set(id, action.label || id));
  });
  return [...entries].map(([id, label]) => ({ id, label }));
}

export function needsSpriteSheetRepair(
  visual: Pick<PixelPetProfile, "generationMode" | "spriteNormalizationVersion">,
) {
  return visual.generationMode === "aigc"
    && (visual.spriteNormalizationVersion ?? 1) < PIXEL_PET_SPRITE_NORMALIZATION_VERSION;
}

export function canSmartRepairSpriteSheet(
  visual: Pick<PixelPetProfile, "generationMode" | "spriteNormalizationVersion">,
) {
  return visual.generationMode === "aigc"
    && visual.spriteNormalizationVersion === PIXEL_PET_SMART_REPAIR_VERSION;
}

export function resolvePixelPetAction(visual: PixelPetProfile, requested: PixelPetRuntimeActionName) {
  const extension = [...(visual.actionPacks || [])].reverse().find((pack) => {
    const irreparableGeneratedPack = pack.id.startsWith("generated-actions-")
      && (pack.spriteNormalizationVersion ?? 1) < PIXEL_PET_SMART_REPAIR_VERSION;
    return !irreparableGeneratedPack && pack.actions[requested];
  });
  if (extension) {
    const requiresSmartRepair = extension.id.startsWith("generated-actions-")
      && extension.spriteNormalizationVersion === PIXEL_PET_SMART_REPAIR_VERSION;
    return {
      action: requested,
      config: {
        ...extension.actions[requested],
        unit: normalizeActionUnitMetadata(extension.actions[requested].unit, requested, extension.actions[requested].label),
      },
      sheetUrl: extension.sheetUrl,
      grid: extension.grid,
      requiresSmartRepair,
    };
  }
  const action = (PIXEL_PET_BASE_ACTION_NAMES as readonly string[]).includes(requested) ? requested : "idle";
  const baseConfig = PIXEL_PET_ACTIONS[action as keyof typeof PIXEL_PET_ACTIONS];
  const requiresSmartRepair = canSmartRepairSpriteSheet(visual);
  if (needsSpriteSheetRepair(visual) && !requiresSmartRepair) {
    const safeFacingFrames = PIXEL_PET_DIRECTIONAL_BASE_FRAMES_V2.idle;
    return {
      action: action as PixelPetRuntimeActionName,
      config: {
        ...baseConfig,
        frames: safeFacingFrames?.front || [0, 1, 0, 1],
        facingFrames: safeFacingFrames,
      },
      sheetUrl: visual.spriteSheetUrl || "",
      grid: visual.grid,
      requiresSmartRepair: false,
    };
  }
  const directionalMap = visual.orientationProtocol === PIXEL_PET_ORIENTATION_PROTOCOL
    ? PIXEL_PET_DIRECTIONAL_BASE_FRAMES_V2
    : visual.orientationProtocol === PIXEL_PET_LEGACY_ORIENTATION_PROTOCOL
      ? PIXEL_PET_DIRECTIONAL_BASE_FRAMES_V1
      : null;
  const facingFrames = directionalMap?.[action as PixelPetActionName];
  const defaultFrames = facingFrames?.front || facingFrames?.right || baseConfig.frames;
  return {
    action: action as PixelPetRuntimeActionName,
    config: facingFrames ? { ...baseConfig, frames: defaultFrames, facingFrames } : baseConfig,
    sheetUrl: visual.spriteSheetUrl || "",
    grid: visual.grid,
    requiresSmartRepair,
  };
}

export function createPixelPetActionExtensionRequest(visual: PixelPetProfile, requestedActions: string[]): PixelPetActionExtensionRequest {
  const packs = visual.actionPacks || [];
  return {
    schema: "pixel-pet/action-request/v1",
    requestedActions,
    existingActions: availablePixelPetActions(visual),
    parentVersion: packs.length ? `extension-v${Math.max(...packs.map((pack) => pack.version))}` : "base-v1",
    mergePolicy: "append-only",
    referenceUrl: visual.referenceUrl,
  };
}

export function createDraftPixelPet(promptBrief: string, hueRotate = 0): PixelPetProfile {
  return {
    schema: PIXEL_PET_SCHEMA,
    status: "draft",
    provider: "pixel-pet-agent",
    promptBrief,
    sourceName: "pixel-pet-demo.png",
    referenceUrl: DEMO_REFERENCE_URL,
    spriteSheetUrl: null,
    grid: { columns: 4, rows: 3, frameWidth: 362, frameHeight: 362 },
    anchor: { x: 0.5, y: 0.9 },
    interactionRig: createEstimatedInteractionRig(362, 362),
    qa: null,
    generatedAt: null,
    generationModel: null,
    generationMode: null,
    generationWarning: null,
    orientationProtocol: null,
    spriteNormalizationVersion: null,
    actionRevision: 1,
    actionPacks: [],
    previousForge: null,
    hueRotate,
    usesDemoAsset: true,
  };
}

/** Migrates the former AIGC placeholder profile without breaking saved timelines. */
export function normalizePixelPetProfile(
  value: unknown,
  promptBrief: string,
  hueRotate = 0,
): PixelPetProfile {
  const draft = createDraftPixelPet(promptBrief, hueRotate);
  if (!value || typeof value !== "object") return draft;
  const visual = value as Partial<PixelPetProfile> & { assetUrl?: string | null };
  const legacyStatus = (value as { status?: string }).status;
  if (visual.schema === PIXEL_PET_SCHEMA) {
    const grid = { ...draft.grid, ...visual.grid };
    return {
      ...draft,
      ...visual,
      grid,
      anchor: { ...draft.anchor, ...visual.anchor },
      interactionRig: normalizeInteractionRig(visual.interactionRig, grid.frameWidth, grid.frameHeight),
      qa: visual.qa ? {
        ...visual.qa,
        orientationCoverage: Number(visual.qa.orientationCoverage) || 0,
        frameCompleteness: Number(visual.qa.frameCompleteness) || 0,
        boundaryConfidence: Number(visual.qa.boundaryConfidence) || 0,
      } : null,
      orientationProtocol: visual.orientationProtocol === PIXEL_PET_ORIENTATION_PROTOCOL
        || visual.orientationProtocol === PIXEL_PET_LEGACY_ORIENTATION_PROTOCOL
        ? visual.orientationProtocol
        : null,
      previousForge: visual.previousForge?.spriteSheetUrl ? visual.previousForge : null,
      hueRotate: visual.hueRotate ?? hueRotate,
    } as PixelPetProfile;
  }

  // Version 3 only had an unimplemented AIGC slot. Existing towns receive the
  // bundled, validated pet so a saved story remains playable after migration.
  if (legacyStatus === "placeholder" || legacyStatus === "queued" || legacyStatus === "ready") {
    return {
      ...draft,
      status: "ready",
      sourceName: "migrated-pixel-pet.png",
      spriteSheetUrl: visual.assetUrl || DEMO_SPRITE_SHEET_URL,
      qa: DEMO_QA_METRICS,
      generatedAt: new Date(0).toISOString(),
    };
  }
  return draft;
}
