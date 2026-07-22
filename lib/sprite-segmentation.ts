export type SpriteComponent = {
  id: number;
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centerX: number;
  centerY: number;
};

export type SegmentedSpriteCell = {
  column: number;
  row: number;
  componentIds: number[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  complete: boolean;
};

export type SpriteSegmentation = {
  labels: Int32Array;
  columnEdges: number[];
  rowEdges: number[];
  cells: SegmentedSpriteCell[];
  frameCompleteness: number;
  boundaryConfidence: number;
};

function projection(mask: Uint8Array, width: number, height: number, axis: "x" | "y") {
  const length = axis === "x" ? width : height;
  const perpendicular = axis === "x" ? height : width;
  const values = new Array<number>(length).fill(0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      values[axis === "x" ? x : y] += 1 / perpendicular;
    }
  }
  return values;
}

function findAdaptiveEdges(values: number[], segments: number) {
  const length = values.length;
  const nominal = length / segments;
  const edges = [0];
  const boundaryDensities: number[] = [];
  const meanDensity = values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);

  for (let index = 1; index < segments; index += 1) {
    const expected = nominal * index;
    const radius = Math.max(3, Math.round(nominal * 0.32));
    const minimumGap = Math.max(3, Math.round(nominal * 0.52));
    const lower = Math.max(edges[index - 1] + minimumGap, Math.round(expected - radius));
    const upper = Math.min(length - (segments - index) * minimumGap, Math.round(expected + radius));
    const band = Math.max(1, Math.round(nominal * 0.012));
    let best = Math.round(expected);
    let bestDensity = Number.POSITIVE_INFINITY;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let candidate = lower; candidate <= upper; candidate += 1) {
      let density = 0;
      let samples = 0;
      for (let offset = -band; offset <= band; offset += 1) {
        const position = candidate + offset;
        if (position < 0 || position >= length) continue;
        density += values[position];
        samples += 1;
      }
      density /= Math.max(1, samples);
      const distancePenalty = (Math.abs(candidate - expected) / Math.max(1, radius)) * Math.max(0.006, meanDensity * 0.08);
      const score = density + distancePenalty;
      if (score < bestScore || (score === bestScore && Math.abs(candidate - expected) < Math.abs(best - expected))) {
        best = candidate;
        bestDensity = density;
        bestScore = score;
      }
    }
    edges.push(best);
    boundaryDensities.push(bestDensity);
  }
  edges.push(length);
  const boundaryDensity = boundaryDensities.length
    ? boundaryDensities.reduce((total, value) => total + value, 0) / boundaryDensities.length
    : 0;
  const confidence = Math.max(0, Math.min(100, (1 - boundaryDensity / Math.max(0.01, meanDensity * 0.55)) * 100));
  return { edges, confidence };
}

function labelForeground(mask: Uint8Array, width: number, height: number) {
  const labels = new Int32Array(mask.length);
  const queue = new Int32Array(mask.length);
  const components: SpriteComponent[] = [];
  let nextId = 0;

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || labels[start]) continue;
    nextId += 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = nextId;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let sumX = 0;
    let sumY = 0;

    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      sumX += x;
      sumY += y;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (!mask[next] || labels[next]) continue;
          labels[next] = nextId;
          queue[tail++] = next;
        }
      }
    }
    components.push({
      id: nextId,
      area,
      minX,
      minY,
      maxX,
      maxY,
      centerX: sumX / Math.max(1, area),
      centerY: sumY / Math.max(1, area),
    });
  }
  return { labels, components };
}

function boxDistance(left: SpriteComponent, right: SpriteComponent) {
  const dx = Math.max(0, left.minX - right.maxX - 1, right.minX - left.maxX - 1);
  const dy = Math.max(0, left.minY - right.maxY - 1, right.minY - left.maxY - 1);
  return Math.hypot(dx, dy);
}

function nearestSlot(value: number, edges: number[]) {
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < edges.length - 1; index += 1) {
    const center = (edges[index] + edges[index + 1]) / 2;
    const nextDistance = Math.abs(value - center);
    if (nextDistance < distance) {
      best = index;
      distance = nextDistance;
    }
  }
  return best;
}

export function segmentSpriteFrames(
  mask: Uint8Array,
  width: number,
  height: number,
  columns: number,
  rows: number,
): SpriteSegmentation {
  if (mask.length !== width * height) throw new Error("前景蒙版尺寸与图片不一致");
  const columnLayout = findAdaptiveEdges(projection(mask, width, height, "x"), columns);
  const rowLayout = findAdaptiveEdges(projection(mask, width, height, "y"), rows);
  const { labels, components } = labelForeground(mask, width, height);
  const nominalWidth = width / columns;
  const nominalHeight = height / rows;
  const minimumArea = Math.max(9, Math.round(nominalWidth * nominalHeight * 0.00015));
  const useful = components.filter((component) => {
    const componentWidth = component.maxX - component.minX + 1;
    const componentHeight = component.maxY - component.minY + 1;
    return component.area >= minimumArea
      && componentWidth < width * 0.62
      && componentHeight < height * 0.62
      && componentWidth <= nominalWidth * 1.55
      && componentHeight <= nominalHeight * 1.65;
  });
  const slots = Array.from({ length: rows * columns }, () => [] as SpriteComponent[]);
  useful.forEach((component) => {
    const column = nearestSlot(component.centerX, columnLayout.edges);
    const row = nearestSlot(component.centerY, rowLayout.edges);
    slots[row * columns + column].push(component);
  });

  const preliminary = slots.map((componentsInSlot, slot) => {
    const column = slot % columns;
    const row = Math.floor(slot / columns);
    const main = [...componentsInSlot].sort((left, right) => right.area - left.area)[0];
    if (!main) return { column, row, componentIds: [], bounds: null, complete: false } satisfies SegmentedSpriteCell;
    const proximity = Math.min(nominalWidth, nominalHeight) * 0.18;
    const included = componentsInSlot.filter((component) => {
      const distance = boxDistance(component, main);
      return component.id === main.id
        || distance <= proximity
        || (component.area >= main.area * 0.015 && distance <= Math.min(nominalWidth, nominalHeight) * 0.55);
    });
    const bounds = included.reduce((current, component) => ({
      minX: Math.min(current.minX, component.minX),
      minY: Math.min(current.minY, component.minY),
      maxX: Math.max(current.maxX, component.maxX),
      maxY: Math.max(current.maxY, component.maxY),
    }), { minX: main.minX, minY: main.minY, maxX: main.maxX, maxY: main.maxY });
    return {
      column,
      row,
      componentIds: included.map((component) => component.id),
      bounds,
      complete: true,
    } satisfies SegmentedSpriteCell;
  });

  const widths = preliminary.flatMap((cell) => cell.bounds ? [cell.bounds.maxX - cell.bounds.minX + 1] : []);
  const heights = preliminary.flatMap((cell) => cell.bounds ? [cell.bounds.maxY - cell.bounds.minY + 1] : []);
  const median = (values: number[]) => {
    if (!values.length) return 0;
    const ordered = [...values].sort((left, right) => left - right);
    return ordered[Math.floor(ordered.length / 2)];
  };
  const medianWidth = median(widths);
  const medianHeight = median(heights);
  const cells = preliminary.map((cell) => {
    if (!cell.bounds) return cell;
    const cellWidth = cell.bounds.maxX - cell.bounds.minX + 1;
    const cellHeight = cell.bounds.maxY - cell.bounds.minY + 1;
    const touchesOuterEdge = cell.bounds.minX <= 0 || cell.bounds.minY <= 0
      || cell.bounds.maxX >= width - 1 || cell.bounds.maxY >= height - 1;
    return {
      ...cell,
      complete: !touchesOuterEdge
        && cellWidth >= Math.max(4, medianWidth * 0.45)
        && cellHeight >= Math.max(4, medianHeight * 0.55)
        && cellWidth <= medianWidth * 1.85
        && cellHeight <= medianHeight * 1.85,
    };
  });
  const completeFrames = cells.filter((cell) => cell.complete).length;
  const frameCompleteness = completeFrames / Math.max(1, cells.length) * 100;
  const boundaryConfidence = Math.min(
    100,
    (columnLayout.confidence + rowLayout.confidence) * 0.4 + frameCompleteness * 0.2,
  );
  return {
    labels,
    columnEdges: columnLayout.edges,
    rowEdges: rowLayout.edges,
    cells,
    frameCompleteness,
    boundaryConfidence,
  };
}
