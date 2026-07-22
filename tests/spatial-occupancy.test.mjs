import test from "node:test";
import assert from "node:assert/strict";
import {
  centeredStageOpeningPosition,
  centerDistanceForBodyGap,
  minimumOccupancyHorizontalGap,
  occupancyDistanceBand,
  relativeExplorePosition,
  separateSpatialOccupancy,
  spatialOccupancyOverlapRatio,
  spatialOccupancyOverlaps,
} from "../lib/spatial-occupancy.ts";

const agents = [{ id: "a" }, { id: "b" }, { id: "c" }];
const point = (agentId, x, y, extra = {}) => ({ agentId, x, y, coordinateSpace: "stage", renderScale: 1, ...extra });

test("centers every supported opening cast without overlapping", () => {
  for (const count of [1, 2, 3]) {
    const positions = Array.from({ length: count }, (_, index) => centeredStageOpeningPosition(count, index));
    const averageX = positions.reduce((total, position) => total + position.x, 0) / positions.length;
    assert.equal(averageX, 50);
    const spatial = Object.fromEntries(positions.map((position, index) => {
      const agent = agents[index];
      return [agent.id, point(agent.id, position.x, position.y)];
    }));
    for (let left = 0; left < count; left += 1) {
      for (let right = left + 1; right < count; right += 1) {
        assert.equal(spatialOccupancyOverlaps(spatial[agents[left].id], spatial[agents[right].id]), false);
      }
    }
  }
});

test("separates two stage characters that occupy the same visible box", () => {
  const result = separateSpatialOccupancy(agents.slice(0, 2), {
    a: point("a", 50, 70),
    b: point("b", 50, 70),
  });

  assert.deepEqual(new Set(result.movedIds), new Set(["a", "b"]));
  assert.equal(spatialOccupancyOverlaps(result.spatial.a, result.spatial.b), false);
  assert.ok(Math.abs(result.spatial.a.x - result.spatial.b.x) >= minimumOccupancyHorizontalGap(result.spatial.a, result.spatial.b) - 0.01);
});

test("resolves a three-character pile without moving outside stage bounds", () => {
  const result = separateSpatialOccupancy(agents, {
    a: point("a", 50, 70),
    b: point("b", 50, 70),
    c: point("c", 50, 70),
  });

  for (const current of Object.values(result.spatial)) assert.ok(current.x >= 12 && current.x <= 88);
  assert.equal(spatialOccupancyOverlaps(result.spatial.a, result.spatial.b), false);
  assert.equal(spatialOccupancyOverlaps(result.spatial.a, result.spatial.c), false);
  assert.equal(spatialOccupancyOverlaps(result.spatial.b, result.spatial.c), false);
});

test("resolves a scaled three-character pile against a stage boundary", () => {
  const result = separateSpatialOccupancy(agents, {
    a: point("a", 88, 70, { renderScale: 1.18 }),
    b: point("b", 88, 70, { renderScale: 1.18 }),
    c: point("c", 88, 70, { renderScale: 1.18 }),
  });

  for (let left = 0; left < agents.length; left += 1) {
    for (let right = left + 1; right < agents.length; right += 1) {
      assert.equal(spatialOccupancyOverlaps(result.spatial[agents[left].id], result.spatial[agents[right].id]), false);
    }
  }
});

test("leaves already separated characters unchanged", () => {
  const spatial = { a: point("a", 20, 70), b: point("b", 70, 70) };
  const result = separateSpatialOccupancy(agents.slice(0, 2), spatial);
  assert.deepEqual(result.movedIds, []);
  assert.deepEqual(result.spatial, spatial);
});

test("keeps the dragged character fixed and moves the overlapping character aside", () => {
  const result = separateSpatialOccupancy(agents.slice(0, 2), {
    a: point("a", 72, 70, { coordinateSpace: "desktop" }),
    b: point("b", 72, 70, { coordinateSpace: "desktop" }),
  }, { fixedIds: ["a"] });

  assert.equal(result.spatial.a.x, 72);
  assert.equal(result.spatial.a.y, 70);
  assert.deepEqual(result.movedIds, ["b"]);
  assert.equal(spatialOccupancyOverlaps(result.spatial.a, result.spatial.b), false);
  assert.ok(spatialOccupancyOverlapRatio(result.spatial.a, result.spatial.b) <= 0.501);
  assert.ok(spatialOccupancyOverlapRatio(result.spatial.a, result.spatial.b) >= 0.49);
  assert.ok(Math.abs(result.spatial.b.x - 72) <= 8.01);
});

test("allows ordinary desktop overlap up to half the visible area", () => {
  const spatial = {
    a: point("a", 72, 70, { coordinateSpace: "desktop" }),
    b: point("b", 80, 70, { coordinateSpace: "desktop" }),
  };
  assert.ok(Math.abs(spatialOccupancyOverlapRatio(spatial.a, spatial.b) - 0.5) < 0.001);
  const result = separateSpatialOccupancy(agents.slice(0, 2), spatial, { fixedIds: ["a"] });
  assert.deepEqual(result.movedIds, []);
  assert.deepEqual(result.spatial, spatial);
});

test("resolves a three-character desktop pile around the dropped character", () => {
  const result = separateSpatialOccupancy(agents, {
    a: point("a", 50, 54, { coordinateSpace: "desktop" }),
    b: point("b", 50, 54, { coordinateSpace: "desktop" }),
    c: point("c", 50, 54, { coordinateSpace: "desktop" }),
  }, { fixedIds: ["a"] });

  assert.equal(result.spatial.a.x, 50);
  assert.equal(result.spatial.a.y, 54);
  for (let left = 0; left < agents.length; left += 1) {
    for (let right = left + 1; right < agents.length; right += 1) {
      const ratio = spatialOccupancyOverlapRatio(result.spatial[agents[left].id], result.spatial[agents[right].id]);
      assert.ok(ratio <= 0.501, `${agents[left].id}/${agents[right].id} overlap ratio ${ratio}`);
    }
  }
});

test("classifies visible gaps in body-width units", () => {
  const left = point("a", 20, 70);
  const right = point("b", 40, 70);
  assert.equal(occupancyDistanceBand(left, right, centerDistanceForBodyGap(left, right, 0.5)), "near");
  assert.equal(occupancyDistanceBand(left, right, centerDistanceForBodyGap(left, right, 1)), "normal");
  assert.equal(occupancyDistanceBand(left, right, centerDistanceForBodyGap(left, right, 2)), "far");
});

test("starts autonomous desktop movement from the dragged position", () => {
  const dragged = point("a", 81, 36, { coordinateSpace: "desktop" });
  const next = relativeExplorePosition(dragged, 42);
  assert.ok(Math.abs(next.x - dragged.x) <= 8);
  assert.ok(Math.abs(next.y - dragged.y) <= 4);
  assert.notDeepEqual(next, { x: 18 + 42 % 64, y: 62 + 42 % 15 });
});

test("accounts for render scale when finding the visible edge", () => {
  const normal = point("a", 20, 70);
  const large = point("b", 40, 70, { renderScale: 1.18 });
  assert.ok(Math.abs(minimumOccupancyHorizontalGap(normal, large) - 21.8) < 0.001);
  assert.equal(spatialOccupancyOverlaps(normal, large), true);
});

test("does not separate desktop characters whose boxes are vertically apart", () => {
  const spatial = {
    a: point("a", 50, 20, { coordinateSpace: "desktop" }),
    b: point("b", 50, 70, { coordinateSpace: "desktop" }),
  };
  const result = separateSpatialOccupancy(agents.slice(0, 2), spatial);
  assert.deepEqual(result.movedIds, []);
  assert.deepEqual(result.spatial, spatial);
});
