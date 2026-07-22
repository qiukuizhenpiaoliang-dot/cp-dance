export type OccupancyCoordinateSpace = "stage" | "desktop";

export type OccupancySpatialState = {
  agentId: string;
  x: number;
  y: number;
  coordinateSpace?: OccupancyCoordinateSpace;
  renderScale?: number;
};

export type OccupancyAgent = { id: string };
export type OccupancyDistanceBand = "near" | "normal" | "far";

const CENTERED_STAGE_OPENING_POSITIONS = {
  1: [{ x: 50, y: 70 }],
  2: [{ x: 39, y: 70 }, { x: 61, y: 70 }],
  3: [{ x: 28, y: 70 }, { x: 50, y: 70 }, { x: 72, y: 70 }],
} as const;

const OCCUPANCY_RULES = {
  stage: { minX: 12, maxX: 88, minY: 57, maxY: 79, horizontalGap: 20, verticalGap: 26, maximumOverlapRatio: 0 },
  desktop: { minX: 4, maxX: 96, minY: 8, maxY: 92, horizontalGap: 16, verticalGap: 18, maximumOverlapRatio: 0.5 },
} as const;

function coordinateSpaceOf(spatial: OccupancySpatialState): OccupancyCoordinateSpace {
  return spatial.coordinateSpace === "desktop" ? "desktop" : "stage";
}

function occupancyScale(spatial: OccupancySpatialState) {
  return Math.max(0.82, Math.min(1.18, spatial.renderScale || 1));
}

function occupancyDimensions(spatial: OccupancySpatialState) {
  const rules = OCCUPANCY_RULES[coordinateSpaceOf(spatial)];
  const scale = occupancyScale(spatial);
  return { width: rules.horizontalGap * scale, height: rules.verticalGap * scale };
}

export function centeredStageOpeningPosition(agentCount: number, index: number) {
  const count = Math.max(1, Math.min(3, Math.round(agentCount))) as 1 | 2 | 3;
  const positions = CENTERED_STAGE_OPENING_POSITIONS[count];
  return positions[Math.max(0, Math.min(positions.length - 1, Math.round(index)))];
}

export function minimumOccupancyHorizontalGap(
  left: OccupancySpatialState,
  right: OccupancySpatialState,
) {
  const space = coordinateSpaceOf(left);
  if (space !== coordinateSpaceOf(right)) return 0;
  const leftBox = occupancyDimensions(left);
  const rightBox = occupancyDimensions(right);
  return (leftBox.width + rightBox.width) / 2;
}

export function centerDistanceForBodyGap(
  left: OccupancySpatialState,
  right: OccupancySpatialState,
  gapInBodies: number,
) {
  return minimumOccupancyHorizontalGap(left, right) * (1 + Math.max(0, gapInBodies));
}

export function occupancyGapInBodies(
  left: OccupancySpatialState,
  right: OccupancySpatialState,
  centerDistance: number,
) {
  const bodyWidth = minimumOccupancyHorizontalGap(left, right);
  if (bodyWidth <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, centerDistance - bodyWidth) / bodyWidth;
}

export function occupancyDistanceBand(
  left: OccupancySpatialState,
  right: OccupancySpatialState,
  centerDistance: number,
): OccupancyDistanceBand {
  const bodyGap = occupancyGapInBodies(left, right, centerDistance);
  if (bodyGap <= 0.5 + 0.001) return "near";
  if (bodyGap < 2 - 0.001) return "normal";
  return "far";
}

export function relativeExplorePosition(spatial: OccupancySpatialState, seed: number) {
  const rules = OCCUPANCY_RULES[coordinateSpaceOf(spatial)];
  const bodyWidth = minimumOccupancyHorizontalGap(spatial, spatial);
  const xStep = Math.max(3, bodyWidth * (0.28 + (seed % 4) * 0.06));
  const yStep = Math.max(2, bodyWidth * (0.1 + (Math.floor(seed / 7) % 3) * 0.04));
  const xDirection = seed % 2 === 0 ? 1 : -1;
  const yDirection = Math.floor(seed / 2) % 2 === 0 ? 1 : -1;
  const bound = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value)));
  let x = bound(spatial.x + xDirection * xStep, rules.minX, rules.maxX);
  let y = bound(spatial.y + yDirection * yStep, rules.minY, rules.maxY);
  if (x === spatial.x) x = bound(spatial.x - xDirection * xStep, rules.minX, rules.maxX);
  if (y === spatial.y) y = bound(spatial.y - yDirection * yStep, rules.minY, rules.maxY);
  return { x, y };
}

export function spatialOccupancyOverlaps(
  left: OccupancySpatialState,
  right: OccupancySpatialState,
) {
  const space = coordinateSpaceOf(left);
  if (space !== coordinateSpaceOf(right)) return false;
  return spatialOccupancyOverlapRatio(left, right) > OCCUPANCY_RULES[space].maximumOverlapRatio + 0.001;
}

export function spatialOccupancyOverlapRatio(
  left: OccupancySpatialState,
  right: OccupancySpatialState,
) {
  const space = coordinateSpaceOf(left);
  if (space !== coordinateSpaceOf(right)) return 0;
  const leftBox = occupancyDimensions(left);
  const rightBox = occupancyDimensions(right);
  const intersectionWidth = Math.max(0,
    Math.min(left.x + leftBox.width / 2, right.x + rightBox.width / 2)
      - Math.max(left.x - leftBox.width / 2, right.x - rightBox.width / 2));
  const intersectionHeight = Math.max(0,
    Math.min(left.y + leftBox.height / 2, right.y + rightBox.height / 2)
      - Math.max(left.y - leftBox.height / 2, right.y - rightBox.height / 2));
  const smallerArea = Math.min(leftBox.width * leftBox.height, rightBox.width * rightBox.height);
  return smallerArea > 0 ? intersectionWidth * intersectionHeight / smallerArea : 0;
}

function minimumOccupancySeparationX(
  left: OccupancySpatialState,
  right: OccupancySpatialState,
) {
  const space = coordinateSpaceOf(left);
  if (space !== coordinateSpaceOf(right)) return 0;
  const rules = OCCUPANCY_RULES[space];
  const leftBox = occupancyDimensions(left);
  const rightBox = occupancyDimensions(right);
  const intersectionHeight = Math.max(0,
    Math.min(left.y + leftBox.height / 2, right.y + rightBox.height / 2)
      - Math.max(left.y - leftBox.height / 2, right.y - rightBox.height / 2));
  if (intersectionHeight <= 0) return 0;
  const smallerArea = Math.min(leftBox.width * leftBox.height, rightBox.width * rightBox.height);
  const allowedIntersectionWidth = rules.maximumOverlapRatio * smallerArea / intersectionHeight;
  return Math.max(0, (leftBox.width + rightBox.width) / 2 - allowedIntersectionWidth);
}

function separatePair<T extends OccupancySpatialState>(left: T, right: T): [T, T] {
  const space = coordinateSpaceOf(left);
  const rules = OCCUPANCY_RULES[space];
  const requiredGap = minimumOccupancySeparationX(left, right);
  const leftFirst = left.x === right.x
    ? left.agentId.localeCompare(right.agentId) <= 0
    : left.x < right.x;
  const first = leftFirst ? left : right;
  const second = leftFirst ? right : left;
  const missingGap = requiredGap - Math.abs(second.x - first.x);
  let firstX = first.x - missingGap / 2;
  let secondX = second.x + missingGap / 2;

  if (firstX < rules.minX) {
    secondX += rules.minX - firstX;
    firstX = rules.minX;
  }
  if (secondX > rules.maxX) {
    firstX -= secondX - rules.maxX;
    secondX = rules.maxX;
  }
  firstX = Math.max(rules.minX, firstX);
  secondX = Math.min(rules.maxX, secondX);

  const nextFirst = { ...first, x: firstX } as T;
  const nextSecond = { ...second, x: secondX } as T;
  return leftFirst ? [nextFirst, nextSecond] : [nextSecond, nextFirst];
}

function separateAroundFixed<T extends OccupancySpatialState>(
  agents: readonly OccupancyAgent[],
  spatial: Record<string, T>,
  fixedIds: ReadonlySet<string>,
) {
  const next = Object.fromEntries(Object.entries(spatial).map(([id, value]) => [id, { ...value }])) as Record<string, T>;
  const movedIds = new Set<string>();
  const placed: T[] = agents.filter((agent) => fixedIds.has(agent.id)).map((agent) => next[agent.id]).filter(Boolean);
  const movable = agents.filter((agent) => !fixedIds.has(agent.id)).map((agent) => next[agent.id]).filter(Boolean);

  for (const current of movable) {
    if (!placed.some((other) => spatialOccupancyOverlaps(current, other))) {
      placed.push(current);
      continue;
    }
    const rules = OCCUPANCY_RULES[coordinateSpaceOf(current)];
    const candidates = new Set<number>([current.x, rules.minX, rules.maxX]);
    for (const other of placed) {
      const gap = minimumOccupancySeparationX(current, other);
      candidates.add(other.x - gap);
      candidates.add(other.x + gap);
    }
    for (let x = rules.minX; x <= rules.maxX; x += 0.25) candidates.add(x);
    const available = [...candidates]
      .filter((x) => x >= rules.minX && x <= rules.maxX)
      .map((x) => ({ x, candidate: { ...current, x } as T }))
      .filter(({ candidate }) => !placed.some((other) => spatialOccupancyOverlaps(candidate, other)))
      .sort((left, right) => Math.abs(left.x - current.x) - Math.abs(right.x - current.x) || left.x - right.x)[0];
    const positioned = available?.candidate || current;
    next[current.agentId] = positioned;
    if (Math.abs(positioned.x - current.x) > 0.001) movedIds.add(current.agentId);
    placed.push(positioned);
  }

  return { spatial: next, movedIds: [...movedIds] };
}

export function separateSpatialOccupancy<T extends OccupancySpatialState>(
  agents: readonly OccupancyAgent[],
  spatial: Record<string, T>,
  options: { fixedIds?: readonly string[] } = {},
) {
  const next = Object.fromEntries(Object.entries(spatial).map(([id, value]) => [id, { ...value }])) as Record<string, T>;
  const movedIds = new Set<string>();
  const fixedIds = new Set(options.fixedIds || []);
  if (fixedIds.size > 0) return separateAroundFixed(agents, next, fixedIds);

  for (let pass = 0; pass < Math.max(8, agents.length * 16); pass += 1) {
    let changed = false;
    for (let leftIndex = 0; leftIndex < agents.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < agents.length; rightIndex += 1) {
        const left = next[agents[leftIndex].id];
        const right = next[agents[rightIndex].id];
        if (!left || !right || !spatialOccupancyOverlaps(left, right)) continue;
        const [nextLeft, nextRight] = separatePair(left, right);
        const leftMoved = Math.abs(nextLeft.x - left.x) > 0.001;
        const rightMoved = Math.abs(nextRight.x - right.x) > 0.001;
        if (!leftMoved && !rightMoved) continue;
        next[left.agentId] = nextLeft;
        next[right.agentId] = nextRight;
        if (leftMoved) movedIds.add(left.agentId);
        if (rightMoved) movedIds.add(right.agentId);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return { spatial: next, movedIds: [...movedIds] };
}
