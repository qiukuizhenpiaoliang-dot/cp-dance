import { segmentSpriteFrames } from "@/lib/sprite-segmentation";

export type ForegroundAwareSpriteSheet = {
  sheetUrl: string;
  frameWidth: number;
  frameHeight: number;
  backgroundUniformity: number;
  frameCompleteness: number;
  boundaryConfidence: number;
};

function loadSpriteImage(path: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法读取角色动作表"));
    image.src = path;
  });
}

function sampleBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  columns: number,
  rows: number,
) {
  const coordinates: Array<[number, number]> = [];
  const edgeSamples = 48;
  for (let index = 0; index <= edgeSamples; index += 1) {
    const x = Math.min(width - 1, Math.round((index / edgeSamples) * (width - 1)));
    const y = Math.min(height - 1, Math.round((index / edgeSamples) * (height - 1)));
    coordinates.push([x, 1], [x, Math.max(0, height - 2)], [1, y], [Math.max(0, width - 2), y]);
  }
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const centerX = Math.min(width - 1, Math.max(0, Math.round((column / columns) * width)));
      const centerY = Math.min(height - 1, Math.max(0, Math.round((row / rows) * height)));
      for (const offset of [-3, 0, 3]) {
        coordinates.push([
          Math.min(width - 1, Math.max(0, centerX + offset)),
          Math.min(height - 1, Math.max(0, centerY + offset)),
        ]);
      }
    }
  }

  const samples = coordinates.map(([x, y]) => {
    const offset = (y * width + x) * 4;
    return { r: data[offset], g: data[offset + 1], b: data[offset + 2], a: data[offset + 3] };
  });
  const transparentSamples = samples.filter((sample) => sample.a < 32).length;
  const transparentSource = transparentSamples / Math.max(1, samples.length) >= 0.55;
  if (transparentSource) return { transparentSource, key: [0, 0, 0] as const, uniformity: 100 };

  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  samples.filter((sample) => sample.a >= 32).forEach((sample) => {
    const bucket = `${sample.r >> 4}:${sample.g >> 4}:${sample.b >> 4}`;
    const current = buckets.get(bucket) || { count: 0, r: 0, g: 0, b: 0 };
    current.count += 1;
    current.r += sample.r;
    current.g += sample.g;
    current.b += sample.b;
    buckets.set(bucket, current);
  });
  const dominant = [...buckets.values()].sort((left, right) => right.count - left.count)[0]
    || { count: 1, r: 255, g: 255, b: 255 };
  const key = [dominant.r / dominant.count, dominant.g / dominant.count, dominant.b / dominant.count] as const;
  const opaqueSamples = samples.filter((sample) => sample.a >= 32);
  const uniformity = opaqueSamples.filter((sample) => Math.hypot(
    sample.r - key[0],
    sample.g - key[1],
    sample.b - key[2],
  ) <= 42).length / Math.max(1, opaqueSamples.length) * 100;
  return { transparentSource, key, uniformity };
}

function isolateForeground(
  frame: ImageData,
  columns: number,
  rows: number,
) {
  const { data, width, height } = frame;
  const background = sampleBackground(data, width, height, columns, rows);
  const mask = new Uint8Array(width * height);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    if (!background.transparentSource) {
      const distance = Math.hypot(
        data[offset] - background.key[0],
        data[offset + 1] - background.key[1],
        data[offset + 2] - background.key[2],
      );
      if (distance <= 20) data[offset + 3] = 0;
      else if (distance < 112) data[offset + 3] = Math.round(data[offset + 3] * ((distance - 20) / 92));
      if (data[offset + 3] > 0
        && background.key[1] > background.key[0] * 1.45
        && background.key[1] > background.key[2] * 1.45) {
        data[offset + 1] = Math.min(data[offset + 1], Math.round((data[offset] + data[offset + 2]) / 2 + 22));
      }
    }
    if (data[offset + 3] > 48) mask[pixel] = 1;
  }
  return { mask, backgroundUniformity: background.uniformity };
}

export async function normalizeForegroundAwareSpriteSheet(
  imageUrl: string,
  columns: number,
  rows: number,
  frameSize: number,
): Promise<ForegroundAwareSpriteSheet> {
  const image = await loadSpriteImage(imageUrl);
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = image.naturalWidth;
  sourceCanvas.height = image.naturalHeight;
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) throw new Error("当前浏览器不支持动作表前景识别");
  sourceContext.imageSmoothingEnabled = false;
  sourceContext.drawImage(image, 0, 0);
  const sourceFrame = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const foreground = isolateForeground(sourceFrame, columns, rows);
  sourceContext.putImageData(sourceFrame, 0, 0);
  const segmentation = segmentSpriteFrames(
    foreground.mask,
    sourceCanvas.width,
    sourceCanvas.height,
    columns,
    rows,
  );

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = frameSize * columns;
  outputCanvas.height = frameSize * rows;
  const outputContext = outputCanvas.getContext("2d");
  if (!outputContext) throw new Error("当前浏览器不支持动作表重建");
  outputContext.imageSmoothingEnabled = false;
  const targetPadding = Math.max(4, Math.round(frameSize * 0.065));

  segmentation.cells.forEach((cell) => {
    if (!cell.bounds || !cell.componentIds.length) return;
    const bounds = cell.bounds;
    const cropWidth = bounds.maxX - bounds.minX + 1;
    const cropHeight = bounds.maxY - bounds.minY + 1;
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cropWidth;
    cropCanvas.height = cropHeight;
    const cropContext = cropCanvas.getContext("2d");
    if (!cropContext) return;
    const crop = cropContext.createImageData(cropWidth, cropHeight);
    const included = new Set(cell.componentIds);
    for (let y = 0; y < cropHeight; y += 1) {
      for (let x = 0; x < cropWidth; x += 1) {
        const sourceX: number = bounds.minX + x;
        const sourceY: number = bounds.minY + y;
        const sourcePixel = sourceY * sourceCanvas.width + sourceX;
        if (!included.has(segmentation.labels[sourcePixel])) continue;
        const sourceOffset = sourcePixel * 4;
        const targetOffset = (y * cropWidth + x) * 4;
        crop.data[targetOffset] = sourceFrame.data[sourceOffset];
        crop.data[targetOffset + 1] = sourceFrame.data[sourceOffset + 1];
        crop.data[targetOffset + 2] = sourceFrame.data[sourceOffset + 2];
        crop.data[targetOffset + 3] = sourceFrame.data[sourceOffset + 3];
      }
    }
    cropContext.putImageData(crop, 0, 0);
    const scale = Math.min(
      (frameSize - targetPadding * 2) / Math.max(1, cropWidth),
      (frameSize - targetPadding * 2) / Math.max(1, cropHeight),
    );
    const targetWidth = Math.max(1, Math.round(cropWidth * scale));
    const targetHeight = Math.max(1, Math.round(cropHeight * scale));
    const targetX = cell.column * frameSize + Math.round((frameSize - targetWidth) / 2);
    const targetY = cell.row * frameSize + frameSize - targetPadding - targetHeight;
    outputContext.drawImage(cropCanvas, 0, 0, cropWidth, cropHeight, targetX, targetY, targetWidth, targetHeight);
  });

  return {
    sheetUrl: outputCanvas.toDataURL("image/png"),
    frameWidth: frameSize,
    frameHeight: frameSize,
    backgroundUniformity: foreground.backgroundUniformity,
    frameCompleteness: segmentation.frameCompleteness,
    boundaryConfidence: segmentation.boundaryConfidence,
  };
}

const repairCache = new Map<string, Promise<ForegroundAwareSpriteSheet>>();

export function repairExistingSpriteSheet(imageUrl: string, columns: number, rows: number, frameSize = 256) {
  const key = `${imageUrl}|${columns}x${rows}|${frameSize}`;
  const cached = repairCache.get(key);
  if (cached) return cached;
  const repair = normalizeForegroundAwareSpriteSheet(imageUrl, columns, rows, frameSize).then((result) => {
    if (result.frameCompleteness < 100) throw new Error(`旧动作表只有 ${result.frameCompleteness.toFixed(1)}% 帧可完整识别`);
    return result;
  });
  repairCache.set(key, repair);
  return repair;
}
