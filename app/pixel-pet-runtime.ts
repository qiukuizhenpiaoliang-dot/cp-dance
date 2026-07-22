import {
  createPixelPetActionExtensionRequest,
  DEMO_SPRITE_SHEET_URL,
  PIXEL_PET_ORIENTATION_PROTOCOL,
  PIXEL_PET_SPRITE_NORMALIZATION_VERSION,
  type PixelPetActionPack,
  type PixelPetOrientationProtocol,
  type PixelPetProfile,
  type PixelPetQaMetrics,
} from "@/lib/pixel-pet";
import { inferActionUnitMetadata } from "@/lib/action-unit";
import type { GameState } from "@/lib/agent-engine";
import { createEstimatedInteractionRig, type InteractionRig } from "@/lib/duo-interaction";
import { normalizeForegroundAwareSpriteSheet } from "./sprite-sheet-normalizer";

const COLUMNS = 4;
const LEGACY_BASE_ROWS = 3;
const DIRECTIONAL_BASE_ROWS = 5;
const DIRECTIONAL_ACTION_ROWS = 3;
const GENERATED_FRAME_SIZE = 192;

type SpriteGridShape = { columns: number; rows: number };
type OrientationFrameGroup = { front?: number; left: number; right: number };

const BASE_ORIENTATION_GROUPS: OrientationFrameGroup[] = [
  { front: 0, left: 2, right: 3 },
  { left: 4, right: 6 },
  { left: 5, right: 7 },
  { front: 8, left: 10, right: 11 },
  { front: 12, left: 13, right: 14 },
  { front: 16, left: 17, right: 18 },
];

function loadImage(path: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法读取角色图片"));
    image.src = path;
  });
}

function canvasToDataUrl(canvas: HTMLCanvasElement, quality = 0.9) {
  const webp = canvas.toDataURL("image/webp", quality);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
}

export async function normalizeReferenceFile(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("请选择 PNG、JPG 或 WebP 图片");
  if (file.size > 10 * 1024 * 1024) throw new Error("参考图不能超过 10 MB");
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const size = 420;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器不支持图像归一化");
    context.imageSmoothingEnabled = false;
    const scale = Math.min((size * 0.88) / image.naturalWidth, (size * 0.88) / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, (size - width) / 2, size - height - size * 0.06, width, height);
    return canvasToDataUrl(canvas, 0.86);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function drawPixelHeart(context: CanvasRenderingContext2D, x: number, y: number, size: number) {
  context.fillStyle = "#ff6f9f";
  context.fillRect(x, y, size, size);
  context.fillRect(x + size * 2, y, size, size);
  context.fillRect(x - size, y + size, size * 5, size * 2);
  context.fillRect(x, y + size * 3, size * 3, size);
  context.fillRect(x + size, y + size * 4, size, size);
}

async function buildFallbackMotionSheet(referenceUrl: string) {
  const image = await loadImage(referenceUrl);
  const frameSize = GENERATED_FRAME_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = frameSize * COLUMNS;
  canvas.height = frameSize * LEGACY_BASE_ROWS;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持 Sprite Sheet 生成");
  context.imageSmoothingEnabled = false;

  const poses = [
    [0, 0, 1, 0], [0, -3, 1, 0], [0, 0, 0.985, 0], [0, -1, 1.015, 0],
    [-4, 0, 1, -0.025], [2, -3, 1, 0.02], [5, 0, 1, 0.03], [-1, -3, 1, -0.02],
    [0, -1, 1, -0.04], [0, -4, 1, 0.045], [0, 1, 0.99, -0.015], [0, -4, 1.02, 0],
  ] as const;

  const baseScale = Math.min((frameSize * 0.78) / image.naturalWidth, (frameSize * 0.78) / image.naturalHeight);
  const baseWidth = image.naturalWidth * baseScale;
  const baseHeight = image.naturalHeight * baseScale;

  poses.forEach(([dx, dy, scale, rotation], index) => {
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const originX = column * frameSize;
    const originY = row * frameSize;
    context.save();
    context.beginPath();
    context.rect(originX, originY, frameSize, frameSize);
    context.clip();
    context.translate(originX + frameSize / 2 + dx, originY + frameSize * 0.9 + dy);
    context.rotate(rotation);
    context.scale(scale, scale);
    context.drawImage(image, -baseWidth / 2, -baseHeight, baseWidth, baseHeight);
    context.restore();

    if (index === 10) {
      context.fillStyle = "#62c7f2";
      context.fillRect(originX + frameSize * 0.6, originY + frameSize * 0.43, 5, 18);
      context.fillRect(originX + frameSize * 0.6 - 3, originY + frameSize * 0.43 + 14, 11, 8);
    }
    if (index === 11) {
      drawPixelHeart(context, originX + 22, originY + 24, 4);
      drawPixelHeart(context, originX + frameSize - 43, originY + 35, 3);
    }
  });

  return {
    spriteSheetUrl: canvasToDataUrl(canvas, 0.88),
    frameWidth: frameSize,
    frameHeight: frameSize,
  };
}

export async function analyzePixelPetSpriteSheet(
  path: string,
  grid: SpriteGridShape = { columns: COLUMNS, rows: LEGACY_BASE_ROWS },
  orientationGroups: OrientationFrameGroup[] = [],
): Promise<PixelPetQaMetrics> {
  const image = await loadImage(path);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前浏览器不支持逐帧校验");
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const frameWidth = Math.floor(canvas.width / grid.columns);
  const frameHeight = Math.floor(canvas.height / grid.rows);
  const baselines: number[] = [];
  const occupancies: number[] = [];
  const dimensions: number[] = [];
  const frameBounds: Array<{ column: number; row: number; minX: number; minY: number; maxX: number; maxY: number; occupied: number }> = [];
  let transparentCornerPixels = 0;
  let cornerPixelCount = 0;
  const cornerSize = Math.max(6, Math.round(Math.min(frameWidth, frameHeight) * 0.04));

  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      let minX = frameWidth;
      let maxX = 0;
      let minY = frameHeight;
      let maxY = 0;
      let occupied = 0;
      for (let y = 0; y < frameHeight; y += 1) {
        for (let x = 0; x < frameWidth; x += 1) {
          const absoluteX = column * frameWidth + x;
          const absoluteY = row * frameHeight + y;
          const alpha = pixels[(absoluteY * canvas.width + absoluteX) * 4 + 3];
          if (alpha > 48) {
            occupied += 1;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
          const corner = (x < cornerSize || x >= frameWidth - cornerSize)
            && (y < cornerSize || y >= frameHeight - cornerSize);
          if (corner) {
            cornerPixelCount += 1;
            if (alpha < 16) transparentCornerPixels += 1;
          }
        }
      }
      baselines.push(maxY);
      occupancies.push(occupied);
      dimensions.push(Math.max(1, maxX - minX) * Math.max(1, maxY - minY));
      frameBounds.push({ column, row, minX, minY, maxX, maxY, occupied });
    }
  }

  const signatureSize = 16;
  const signatures = frameBounds.map((bounds) => {
    const signature = new Array<number>(signatureSize * signatureSize).fill(0);
    if (!bounds.occupied || bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) return signature;
    for (let sampleY = 0; sampleY < signatureSize; sampleY += 1) {
      for (let sampleX = 0; sampleX < signatureSize; sampleX += 1) {
        const x = Math.round(bounds.minX + (sampleX / (signatureSize - 1)) * (bounds.maxX - bounds.minX));
        const y = Math.round(bounds.minY + (sampleY / (signatureSize - 1)) * (bounds.maxY - bounds.minY));
        const absoluteX = bounds.column * frameWidth + x;
        const absoluteY = bounds.row * frameHeight + y;
        signature[sampleY * signatureSize + sampleX] = pixels[(absoluteY * canvas.width + absoluteX) * 4 + 3] > 48 ? 1 : 0;
      }
    }
    return signature;
  });
  const signatureDistance = (left: number[], right: number[]) => left.reduce((total, value, index) => total + Math.abs(value - right[index]), 0) / left.length;
  const mirrorSignature = (signature: number[]) => Array.from({ length: signatureSize }, (_, row) =>
    signature.slice(row * signatureSize, (row + 1) * signatureSize).reverse()).flat();
  const representativeFrames = (grid.rows >= DIRECTIONAL_BASE_ROWS ? [4, 8, 12, 16] : [4, 8, 10, 11])
    .filter((index) => signatures[index]);
  const actionDiversity = representativeFrames.length
    ? representativeFrames.reduce((total, index) => total + signatureDistance(signatures[0], signatures[index]), 0) / representativeFrames.length * 100
    : 0;
  const uniqueSignatures: number[][] = [];
  signatures.forEach((signature) => {
    if (!uniqueSignatures.some((known) => signatureDistance(known, signature) < 0.045)) uniqueSignatures.push(signature);
  });

  const orientationCoverage = orientationGroups.length ? orientationGroups.reduce((total, group) => {
    const leftBounds = frameBounds[group.left];
    const rightBounds = frameBounds[group.right];
    const frontBounds = group.front === undefined ? null : frameBounds[group.front];
    const present = Boolean(leftBounds?.occupied && rightBounds?.occupied && (!frontBounds || frontBounds.occupied));
    if (!present) return total;
    const left = signatures[group.left];
    const right = signatures[group.right];
    const rawDifference = signatureDistance(left, right);
    const mirroredDifference = signatureDistance(mirrorSignature(left), right);
    const pairDistinctness = Math.min(1, rawDifference / 0.055);
    const mirroredCoherence = Math.max(0, 1 - mirroredDifference / 0.24);
    const turnDistinctness = group.front === undefined ? 1 : Math.min(1,
      (signatureDistance(signatures[group.front], left) + signatureDistance(signatures[group.front], right)) / 0.11);
    return total + 0.25 + pairDistinctness * 0.3 + mirroredCoherence * 0.3 + turnDistinctness * 0.15;
  }, 0) / orientationGroups.length * 100 : 0;

  const mean = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;
  const deviation = (values: number[], average = mean(values)) =>
    Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
  const occupiedFrames = occupancies.filter((value) => value > 0);
  const occupiedDimensions = dimensions.filter((value, index) => occupancies[index] > 0);
  if (!occupiedFrames.length) occupiedFrames.push(0);
  if (!occupiedDimensions.length) occupiedDimensions.push(0);
  const occupancyMean = Math.max(1, mean(occupiedFrames));
  const areaMean = Math.max(1, mean(occupiedDimensions));
  const silhouetteDrift = (deviation(occupiedFrames, occupancyMean) / occupancyMean) * 100;
  const areaDrift = (deviation(occupiedDimensions, areaMean) / areaMean) * 100;
  const baseline = deviation(baselines, mean(baselines));
  const identity = Math.max(0, 100 - Math.min(24, silhouetteDrift * 0.38 + areaDrift * 0.2 + baseline * 0.22));

  const transparentCorners = cornerPixelCount ? (transparentCornerPixels / cornerPixelCount) * 100 : 0;
  const completeFrames = frameBounds.filter((bounds) => bounds.occupied
    && bounds.minX > 1
    && bounds.minY > 1
    && bounds.maxX < frameWidth - 2
    && bounds.maxY < frameHeight - 2).length;
  return {
    identity,
    baseline,
    transparentCorners,
    backgroundUniformity: transparentCorners,
    silhouetteDrift,
    actionDiversity,
    orientationCoverage,
    uniquePoseCount: uniqueSignatures.length,
    frameCompleteness: completeFrames / Math.max(1, frameBounds.length) * 100,
    boundaryConfidence: 100,
    frameWidth,
    frameHeight,
  };
}

export async function analyzeInteractionRig(
  path: string,
  grid: SpriteGridShape = { columns: COLUMNS, rows: LEGACY_BASE_ROWS },
  frameIndex = 0,
): Promise<InteractionRig> {
  const image = await loadImage(path);
  const frameWidth = Math.floor(image.naturalWidth / grid.columns);
  const frameHeight = Math.floor(image.naturalHeight / grid.rows);
  const canvas = document.createElement("canvas");
  canvas.width = frameWidth;
  canvas.height = frameHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return createEstimatedInteractionRig(frameWidth, frameHeight);
  const sourceColumn = frameIndex % grid.columns;
  const sourceRow = Math.floor(frameIndex / grid.columns);
  context.drawImage(image, sourceColumn * frameWidth, sourceRow * frameHeight, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
  const pixels = context.getImageData(0, 0, frameWidth, frameHeight).data;
  let minX = frameWidth;
  let minY = frameHeight;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < frameHeight; y += 1) {
    for (let x = 0; x < frameWidth; x += 1) {
      if (pixels[(y * frameWidth + x) * 4 + 3] <= 48) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX <= minX || maxY <= minY) return createEstimatedInteractionRig(frameWidth, frameHeight);
  const height = maxY - minY;
  const rig = createEstimatedInteractionRig(frameWidth, frameHeight, {
    minX: minX / frameWidth,
    minY: minY / frameHeight,
    maxX: maxX / frameWidth,
    maxY: maxY / frameHeight,
  }, "alpha-analysis");
  const handBandStart = Math.round(minY + height * 0.36);
  const handBandEnd = Math.round(minY + height * 0.63);
  let left = { x: maxX, y: Math.round((handBandStart + handBandEnd) / 2) };
  let right = { x: minX, y: left.y };
  for (let y = handBandStart; y <= handBandEnd; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (pixels[(y * frameWidth + x) * 4 + 3] <= 48) continue;
      if (x < left.x) left = { x, y };
      if (x > right.x) right = { x, y };
    }
  }
  return {
    ...rig,
    points: {
      ...rig.points,
      leftHand: { x: left.x / frameWidth, y: left.y / frameHeight, confidence: 0.72 },
      rightHand: { x: right.x / frameWidth, y: right.y / frameHeight, confidence: 0.72 },
    },
  };
}

type CharacterForgeRequest = {
  name: string;
  personality: string;
  background: string;
  referenceUrl: string;
  usesPresetAsset: boolean;
  presetSpriteSheetUrl?: string;
};

type CharacterGenerationResponse = {
  imageDataUrl: string;
  model: string;
  usedReference: boolean;
  protocol?: string;
};

type PixelPetImageAgentStatus = {
  imageConfigured: boolean;
  imageModel?: string;
  imageProtocol?: string;
  error?: string;
};

export type PixelPetForgeResult = {
  spriteSheetUrl: string;
  frameWidth: number;
  frameHeight: number;
  rows: number;
  backgroundUniformity?: number;
  qa: PixelPetQaMetrics;
  interactionRig: InteractionRig;
  generationModel: string | null;
  generationMode: "aigc" | "local-fallback";
  warning: string | null;
  orientationProtocol: PixelPetOrientationProtocol | null;
  spriteNormalizationVersion: number | null;
};

export async function getPixelPetImageAgentStatus(): Promise<PixelPetImageAgentStatus> {
  let response: Response;
  try {
    response = await fetch("/api/ai/status", { cache: "no-store" });
  } catch {
    throw new Error("无法连接角色制作 Agent 状态接口，请确认当前站点已部署 Worker API");
  }
  const payload = await response.json().catch(() => null) as PixelPetImageAgentStatus | null;
  if (!response.ok || !payload) throw new Error(payload?.error || "无法读取角色制作 Agent 状态");
  if (!payload.imageConfigured) {
    throw new Error("角色制作 Agent 尚未配置，请检查服务端 NEWAPI_IMAGE_API_KEY 与图像 API 地址");
  }
  return payload;
}

async function requestAiCharacter(input: CharacterForgeRequest): Promise<CharacterGenerationResponse> {
  await getPixelPetImageAgentStatus();
  const referenceUrl = input.referenceUrl ? await imageUrlToDataUrl(input.referenceUrl) : "";
  const response = await fetch("/api/ai/character", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      personality: input.personality,
      background: input.background,
      referenceUrl: referenceUrl || null,
    }),
  });
  const payload = await response.json().catch(() => null) as (CharacterGenerationResponse & { error?: string }) | null;
  if (!response.ok || !payload?.imageDataUrl) throw new Error(payload?.error || "角色图像模型暂不可用");
  return payload;
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("无法读取动作参考图"));
    reader.readAsDataURL(blob);
  });
}

async function imageUrlToDataUrl(url: string) {
  if (url.startsWith("data:image/")) return url;
  if (!url) throw new Error("角色缺少可用参考图，无法生成增量动作");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`无法读取现有角色动作表（HTTP ${response.status}）`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("现有角色动作表不是可用图片，无法提交给动作 Agent");
  return blobToDataUrl(blob);
}

async function normalizeGeneratedActionSheet(imageDataUrl: string) {
  return normalizeForegroundAwareSpriteSheet(imageDataUrl, COLUMNS, DIRECTIONAL_ACTION_ROWS, 256);
}

async function normalizeGeneratedBaseSheet(imageDataUrl: string) {
  return normalizeForegroundAwareSpriteSheet(imageDataUrl, COLUMNS, DIRECTIONAL_BASE_ROWS, 256);
}

type GeneratedActionResponse = {
  imageDataUrl: string;
  model: string;
  actions: string[];
  metadataProtocol?: "pixel-pet/action-unit/v1";
};

function actionId(label: string, version: number, index: number) {
  const known: Record<string, string> = { 害羞: "shy", 生气: "angry", 交谈: "talk", 倾听: "listen" };
  const semantic = Object.entries(known).find(([name]) => label.includes(name))?.[1];
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  return known[label] || semantic || slug || `generated-v${version}-${index + 1}`;
}

export async function generatePixelPetActionPack(input: {
  visual: PixelPetProfile;
  requestedActions: string[];
}): Promise<PixelPetActionPack> {
  await getPixelPetImageAgentStatus();
  const request = createPixelPetActionExtensionRequest(input.visual, input.requestedActions.slice(0, 4));
  const referenceUrl = await imageUrlToDataUrl(input.visual.spriteSheetUrl || input.visual.referenceUrl || "");
  const response = await fetch("/api/ai/pet-actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...request, referenceUrl }),
  });
  const payload = await response.json().catch(() => null) as (GeneratedActionResponse & { error?: string }) | null;
  if (!response.ok || !payload?.imageDataUrl || !payload.actions?.length) {
    throw new Error(payload?.error || `增量动作模型返回无效结果（HTTP ${response.status}）`);
  }
  const normalized = await normalizeGeneratedActionSheet(payload.imageDataUrl);
  const generatedLabels = payload.actions.slice(0, 4);
  const orientationGroups = generatedLabels.map((_, index) => ({
    front: index,
    left: index + COLUMNS,
    right: index + COLUMNS * 2,
  }));
  const analyzedActionQa = await analyzePixelPetSpriteSheet(
    normalized.sheetUrl,
    { columns: COLUMNS, rows: DIRECTIONAL_ACTION_ROWS },
    orientationGroups,
  );
  const actionQa = {
    ...analyzedActionQa,
    frameCompleteness: normalized.frameCompleteness,
    boundaryConfidence: normalized.boundaryConfidence,
  };
  const minimumUniquePoses = Math.max(2, generatedLabels.length * 2);
  if (actionQa.orientationCoverage < 55
    || actionQa.uniquePoseCount < minimumUniquePoses
    || actionQa.transparentCorners < 80
    || actionQa.frameCompleteness < 100
    || actionQa.boundaryConfidence < 55) {
    throw new Error(`增量动作表未通过完整性校验：完整帧 ${actionQa.frameCompleteness.toFixed(1)}%，边界置信 ${actionQa.boundaryConfidence.toFixed(1)}%，朝向覆盖 ${actionQa.orientationCoverage.toFixed(1)}%`);
  }
  const version = Math.max(1, ...(input.visual.actionPacks || []).map((pack) => pack.version)) + 1;
  const keyframeRigs = await Promise.all(generatedLabels.map(async (_, index) => {
    const [front, left, right] = await Promise.all([
      analyzeInteractionRig(normalized.sheetUrl, { columns: COLUMNS, rows: DIRECTIONAL_ACTION_ROWS }, index),
      analyzeInteractionRig(normalized.sheetUrl, { columns: COLUMNS, rows: DIRECTIONAL_ACTION_ROWS }, index + COLUMNS),
      analyzeInteractionRig(normalized.sheetUrl, { columns: COLUMNS, rows: DIRECTIONAL_ACTION_ROWS }, index + COLUMNS * 2),
    ]);
    return { front, left, right };
  }));
  const actions = Object.fromEntries(generatedLabels.map((label, index) => [
    actionId(label, version, index),
    {
      label,
      frames: [index, index, index],
      facingFrames: {
        front: [index, index, index],
        left: [index + COLUMNS, index + COLUMNS, index + COLUMNS],
        right: [index + COLUMNS * 2, index + COLUMNS * 2, index + COLUMNS * 2],
      },
      frameDuration: 360,
      loop: false,
      unit: {
        ...inferActionUnitMetadata(actionId(label, version, index), label),
        rigSource: "keyframe-analysis" as const,
        keyframeRigs: {
          contact_start: keyframeRigs[index],
          contact_hold: keyframeRigs[index],
          contact_end: keyframeRigs[index],
        },
      },
    },
  ]));
  return {
    schema: "pixel-pet/action-pack/v1",
    id: `generated-actions-v${version}-${Date.now()}`,
    version,
    parentVersion: request.parentVersion,
    generatedBy: "pixel-pet-agent",
    request: generatedLabels.join("、"),
    sheetUrl: normalized.sheetUrl,
    grid: { columns: COLUMNS, rows: DIRECTIONAL_ACTION_ROWS, frameWidth: normalized.frameWidth, frameHeight: normalized.frameHeight },
    actions,
    spriteNormalizationVersion: PIXEL_PET_SPRITE_NORMALIZATION_VERSION,
    createdAt: new Date().toISOString(),
  };
}

async function finalizeForgedCharacter(
  generated: {
    spriteSheetUrl: string;
    frameWidth: number;
    frameHeight: number;
    rows: number;
    backgroundUniformity?: number;
    frameCompleteness?: number;
    boundaryConfidence?: number;
  },
  generationMode: "aigc" | "local-fallback",
  generationModel: string | null,
  warning: string | null,
): Promise<PixelPetForgeResult> {
  const grid = { columns: COLUMNS, rows: generated.rows };
  const [analyzedQa, interactionRig] = await Promise.all([
    analyzePixelPetSpriteSheet(generated.spriteSheetUrl, grid, generationMode === "aigc" ? BASE_ORIENTATION_GROUPS : []),
    analyzeInteractionRig(generated.spriteSheetUrl, grid),
  ]);
  const qa = {
    ...analyzedQa,
    backgroundUniformity: generated.backgroundUniformity ?? analyzedQa.backgroundUniformity,
    frameCompleteness: generated.frameCompleteness ?? analyzedQa.frameCompleteness,
    boundaryConfidence: generated.boundaryConfidence ?? analyzedQa.boundaryConfidence,
  };
  if (generationMode === "aigc" && (qa.actionDiversity < 6
    || qa.uniquePoseCount < 8
    || qa.orientationCoverage < 55
    || qa.transparentCorners < 80
    || qa.backgroundUniformity < 85
    || qa.frameCompleteness < 100
    || qa.boundaryConfidence < 55)) {
    throw new Error(`图像模型返回的动作表未通过完整性校验：完整帧 ${qa.frameCompleteness.toFixed(1)}%，边界置信 ${qa.boundaryConfidence.toFixed(1)}%，朝向覆盖 ${qa.orientationCoverage.toFixed(1)}%，独立姿势 ${qa.uniquePoseCount}/20`);
  }
  return {
    ...generated,
    qa,
    interactionRig,
    generationModel,
    generationMode,
    warning,
    orientationProtocol: generationMode === "aigc" ? PIXEL_PET_ORIENTATION_PROTOCOL : null,
    spriteNormalizationVersion: generationMode === "aigc" ? PIXEL_PET_SPRITE_NORMALIZATION_VERSION : null,
  };
}

/** The primary forge path is fail-closed: only a verified image Agent result can complete it. */
export async function forgePixelPet(input: CharacterForgeRequest): Promise<PixelPetForgeResult> {
  const character = await requestAiCharacter(input);
  const normalized = await normalizeGeneratedBaseSheet(character.imageDataUrl);
  return finalizeForgedCharacter(
    {
      spriteSheetUrl: normalized.sheetUrl,
      frameWidth: normalized.frameWidth,
      frameHeight: normalized.frameHeight,
      rows: DIRECTIONAL_BASE_ROWS,
      backgroundUniformity: normalized.backgroundUniformity,
      frameCompleteness: normalized.frameCompleteness,
      boundaryConfidence: normalized.boundaryConfidence,
    },
    "aigc",
    character.model,
    null,
  );
}

/** Local preview is intentionally separate so callers can only enter it after an explicit user action. */
export async function forgePixelPetFallback(input: CharacterForgeRequest): Promise<PixelPetForgeResult> {
  const generated = input.usesPresetAsset
    ? { spriteSheetUrl: input.presetSpriteSheetUrl || DEMO_SPRITE_SHEET_URL, frameWidth: 362, frameHeight: 362, rows: LEGACY_BASE_ROWS }
    : { ...await buildFallbackMotionSheet(input.referenceUrl), rows: LEGACY_BASE_ROWS };
  return finalizeForgedCharacter(
    generated,
    "local-fallback",
    null,
    "用户明确选择了本地预览；该动作表不是角色制作 Agent 的生成结果",
  );
}

export type DesktopPetRuntimeSnapshot = {
  surface: "desktop_pet";
  mode: "natural";
  agents: Array<Pick<GameState["agents"][number], "id" | "name" | "mood" | "visual">>;
  relationships: GameState["relationships"];
  spatial: GameState["spatial"];
  statusText: string;
};

/** The desktop shell consumes the same natural-mode relationship core. */
export function createDesktopPetRuntimeSnapshot(state: GameState): DesktopPetRuntimeSnapshot {
  return {
    surface: "desktop_pet",
    mode: "natural",
    agents: state.agents.map(({ id, name, mood, visual }) => ({ id, name, mood, visual })),
    relationships: state.relationships,
    spatial: state.spatial,
    statusText: state.running ? "角色正在自然生活" : "自然时间已暂停",
  };
}
