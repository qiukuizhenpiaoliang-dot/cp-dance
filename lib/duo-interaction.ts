export const INTERACTION_RIG_SCHEMA = "cp-dance/interaction-rig/v1" as const;

export type RigPoint = { x: number; y: number; confidence: number };
export type RigPointName = "head" | "chest" | "hip" | "leftHand" | "rightHand" | "leftFoot" | "rightFoot";

export type InteractionRig = {
  schema: typeof INTERACTION_RIG_SCHEMA;
  source: "alpha-analysis" | "estimated";
  frameWidth: number;
  frameHeight: number;
  silhouette: { minX: number; minY: number; maxX: number; maxY: number; bodyHeight: number };
  points: Record<RigPointName, RigPoint>;
};

export type DuoInteractionKind = "touch" | "hand_contact" | "hug" | "cuddle" | "head_touch" | "shoulder_lean" | "pat" | "push" | "shared_action" | "joint_walk" | "dance" | "chase" | "assist" | "conversation" | "eye_contact";
export type DuoMatchQuality = "perfect" | "acceptable" | "invalid";

export type DuoInteractionValidation = {
  schema: "cp-dance/duo-validation/v1";
  interaction: DuoInteractionKind;
  compatible: boolean;
  contactPair: { actor: RigPointName; target: RigPointName };
  heightDifferencePercent: number;
  requiredScale: number;
  residualContactError: number;
  idealDistance: number;
  allowedError: number;
  maxRootCorrection: number;
  match: DuoMatchQuality;
  adjustments: {
    actor: { x: number; y: number; scale: number };
    target: { x: number; y: number; scale: number };
  };
  warnings: string[];
  summary: string;
};

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

function point(x: number, y: number, confidence: number): RigPoint {
  return { x: clamp(x), y: clamp(y), confidence: clamp(confidence) };
}

export function createEstimatedInteractionRig(
  frameWidth: number,
  frameHeight: number,
  bounds = { minX: 0.2, minY: 0.08, maxX: 0.8, maxY: 0.92 },
  source: InteractionRig["source"] = "estimated",
): InteractionRig {
  const width = Math.max(0.08, bounds.maxX - bounds.minX);
  const height = Math.max(0.12, bounds.maxY - bounds.minY);
  const centerX = bounds.minX + width / 2;
  const confidence = source === "alpha-analysis" ? 0.78 : 0.52;
  return {
    schema: INTERACTION_RIG_SCHEMA,
    source,
    frameWidth: Math.max(1, Math.round(frameWidth)),
    frameHeight: Math.max(1, Math.round(frameHeight)),
    silhouette: { ...bounds, bodyHeight: height },
    points: {
      head: point(centerX, bounds.minY + height * 0.13, confidence),
      chest: point(centerX, bounds.minY + height * 0.36, confidence),
      hip: point(centerX, bounds.minY + height * 0.62, confidence),
      leftHand: point(bounds.minX + width * 0.12, bounds.minY + height * 0.5, confidence * 0.86),
      rightHand: point(bounds.maxX - width * 0.12, bounds.minY + height * 0.5, confidence * 0.86),
      leftFoot: point(bounds.minX + width * 0.35, bounds.maxY, confidence),
      rightFoot: point(bounds.minX + width * 0.65, bounds.maxY, confidence),
    },
  };
}

function validPoint(value: unknown): value is RigPoint {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RigPoint>;
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y) && Number.isFinite(candidate.confidence);
}

export function normalizeInteractionRig(value: unknown, frameWidth: number, frameHeight: number): InteractionRig {
  const fallback = createEstimatedInteractionRig(frameWidth, frameHeight);
  if (!value || typeof value !== "object") return fallback;
  const rig = value as Partial<InteractionRig>;
  if (rig.schema !== INTERACTION_RIG_SCHEMA || !rig.points || !rig.silhouette) return fallback;
  const names: RigPointName[] = ["head", "chest", "hip", "leftHand", "rightHand", "leftFoot", "rightFoot"];
  if (!names.every((name) => validPoint(rig.points?.[name]))) return fallback;
  const minX = clamp(Number(rig.silhouette.minX));
  const minY = clamp(Number(rig.silhouette.minY));
  const maxX = clamp(Number(rig.silhouette.maxX));
  const maxY = clamp(Number(rig.silhouette.maxY));
  if (maxX <= minX || maxY <= minY) return fallback;
  return {
    schema: INTERACTION_RIG_SCHEMA,
    source: rig.source === "alpha-analysis" ? "alpha-analysis" : "estimated",
    frameWidth: Math.max(1, Math.round(Number(rig.frameWidth) || frameWidth)),
    frameHeight: Math.max(1, Math.round(Number(rig.frameHeight) || frameHeight)),
    silhouette: { minX, minY, maxX, maxY, bodyHeight: maxY - minY },
    points: Object.fromEntries(names.map((name) => {
      const candidate = rig.points![name];
      return [name, point(candidate.x, candidate.y, candidate.confidence)];
    })) as Record<RigPointName, RigPoint>,
  };
}

const INTERACTION_RULES: Record<DuoInteractionKind, {
  actor: RigPointName;
  target: RigPointName;
  maxHeightDifference: number;
  maxResidual: number;
  stageGap: number;
  maxRootCorrection: number;
}> = {
  touch: { actor: "rightHand", target: "chest", maxHeightDifference: 0.5, maxResidual: 0.16, stageGap: 10, maxRootCorrection: 4 },
  hand_contact: { actor: "rightHand", target: "leftHand", maxHeightDifference: 0.42, maxResidual: 0.13, stageGap: 12, maxRootCorrection: 4 },
  hug: { actor: "chest", target: "chest", maxHeightDifference: 0.36, maxResidual: 0.11, stageGap: 7, maxRootCorrection: 4 },
  cuddle: { actor: "chest", target: "chest", maxHeightDifference: 0.46, maxResidual: 0.14, stageGap: 8, maxRootCorrection: 4 },
  head_touch: { actor: "rightHand", target: "head", maxHeightDifference: 0.5, maxResidual: 0.15, stageGap: 10, maxRootCorrection: 4 },
  shoulder_lean: { actor: "head", target: "chest", maxHeightDifference: 0.46, maxResidual: 0.14, stageGap: 8, maxRootCorrection: 4 },
  pat: { actor: "rightHand", target: "chest", maxHeightDifference: 0.52, maxResidual: 0.17, stageGap: 11, maxRootCorrection: 4 },
  push: { actor: "rightHand", target: "chest", maxHeightDifference: 0.52, maxResidual: 0.17, stageGap: 13, maxRootCorrection: 3 },
  shared_action: { actor: "hip", target: "hip", maxHeightDifference: 0.58, maxResidual: 0.18, stageGap: 16, maxRootCorrection: 3 },
  joint_walk: { actor: "hip", target: "hip", maxHeightDifference: 0.58, maxResidual: 0.18, stageGap: 15, maxRootCorrection: 3 },
  dance: { actor: "rightHand", target: "leftHand", maxHeightDifference: 0.5, maxResidual: 0.16, stageGap: 13, maxRootCorrection: 4 },
  chase: { actor: "hip", target: "hip", maxHeightDifference: 0.7, maxResidual: 0.24, stageGap: 22, maxRootCorrection: 2 },
  assist: { actor: "chest", target: "chest", maxHeightDifference: 0.52, maxResidual: 0.16, stageGap: 12, maxRootCorrection: 4 },
  conversation: { actor: "chest", target: "chest", maxHeightDifference: 0.78, maxResidual: 0.3, stageGap: 24, maxRootCorrection: 0 },
  eye_contact: { actor: "head", target: "head", maxHeightDifference: 0.78, maxResidual: 0.3, stageGap: 24, maxRootCorrection: 0 },
};

export function validateDuoInteraction(
  actorValue: unknown,
  targetValue: unknown,
  interaction: DuoInteractionKind,
  actorFrame = { width: 192, height: 192 },
  targetFrame = { width: 192, height: 192 },
): DuoInteractionValidation {
  const actor = normalizeInteractionRig(actorValue, actorFrame.width, actorFrame.height);
  const target = normalizeInteractionRig(targetValue, targetFrame.width, targetFrame.height);
  const rule = INTERACTION_RULES[interaction];
  const actorAnchor = actor.points[rule.actor];
  const targetAnchor = target.points[rule.target];
  const actorFoot = (actor.points.leftFoot.y + actor.points.rightFoot.y) / 2;
  const targetFoot = (target.points.leftFoot.y + target.points.rightFoot.y) / 2;
  const actorContactHeight = Math.max(0.04, actorFoot - actorAnchor.y);
  const targetContactHeight = Math.max(0.04, targetFoot - targetAnchor.y);
  // Scale by the silhouettes, not by the two selected anchors. A hand-to-chest
  // touch intentionally uses anchors at different heights; treating that
  // difference as a body-scale mismatch made an otherwise valid touch fail.
  const rawScale = actor.silhouette.bodyHeight / Math.max(target.silhouette.bodyHeight, 0.04);
  const targetScale = clamp(rawScale, 0.82, 1.18);
  const scaleResidual = Math.abs(actor.silhouette.bodyHeight - target.silhouette.bodyHeight * targetScale);
  const verticalAlignment = Math.abs(actorContactHeight - targetContactHeight * targetScale);
  const actorHorizontalReach = Math.abs(actorAnchor.x - 0.5);
  const targetHorizontalReach = Math.abs(targetAnchor.x - 0.5) * targetScale;
  // The stage can translate a pair vertically and move their centres together.
  // Only the part that cannot be compensated safely contributes to the error.
  const verticalResidual = Math.max(0, verticalAlignment - 0.18);
  const horizontalResidual = Math.max(0, Math.abs(actorHorizontalReach - targetHorizontalReach) - 0.18);
  const residualContactError = Math.hypot(scaleResidual, verticalResidual, horizontalResidual);
  const heightDifference = Math.abs(actor.silhouette.bodyHeight - target.silhouette.bodyHeight)
    / Math.max(actor.silhouette.bodyHeight, target.silhouette.bodyHeight, 0.01);
  const confidence = Math.min(actorAnchor.confidence, targetAnchor.confidence);
  const compatible = heightDifference <= rule.maxHeightDifference
    && residualContactError <= rule.maxResidual
    && confidence >= 0.4;
  const match: DuoMatchQuality = !compatible
    ? "invalid"
    : heightDifference <= rule.maxHeightDifference * 0.55
      && residualContactError <= rule.maxResidual * 0.55
      && confidence >= 0.62
      ? "perfect"
      : "acceptable";
  const warnings: string[] = [];
  if (actor.source === "estimated" || target.source === "estimated") warnings.push("至少一名角色使用估算骨骼；完成新形象制作后会自动提高接触精度");
  if (heightDifference > rule.maxHeightDifference) warnings.push("身高差超过该动作的安全校验范围");
  if (residualContactError > rule.maxResidual) warnings.push("接触点无法在允许的缩放范围内稳定对齐");
  if (confidence < 0.4) warnings.push("骨骼接触点置信度不足");
  const scaledTargetAnchorY = targetFoot - targetContactHeight * targetScale;
  const verticalShift = clamp((actorAnchor.y - scaledTargetAnchorY) * 24, -4, 4);
  const contactReach = actorHorizontalReach + targetHorizontalReach;
  const stageGap = clamp(rule.stageGap * (0.85 + contactReach), rule.stageGap * 0.75, rule.stageGap * 1.25);
  const summary = compatible
    ? `骨骼 ${rule.actor}↔${rule.target} 已对齐，身高差 ${Math.round(heightDifference * 100)}%`
    : `双角色动作已降级为安全近距离表现：${warnings[0] || "接触点未通过校验"}`;
  return {
    schema: "cp-dance/duo-validation/v1",
    interaction,
    compatible,
    contactPair: { actor: rule.actor, target: rule.target },
    heightDifferencePercent: Math.round(heightDifference * 1000) / 10,
    requiredScale: Math.round(targetScale * 1000) / 1000,
    residualContactError: Math.round(residualContactError * 1000) / 1000,
    idealDistance: Math.round(stageGap * 10) / 10,
    allowedError: Math.max(2, Math.round(rule.stageGap * 0.24 * 10) / 10),
    maxRootCorrection: rule.maxRootCorrection,
    match,
    adjustments: {
      actor: { x: -stageGap / 2, y: -verticalShift / 2, scale: 1 },
      target: { x: stageGap / 2, y: verticalShift / 2, scale: Math.round(targetScale * 1000) / 1000 },
    },
    warnings,
    summary,
  };
}
