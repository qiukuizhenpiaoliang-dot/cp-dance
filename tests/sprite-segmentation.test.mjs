import assert from "node:assert/strict";
import test from "node:test";
import { segmentSpriteFrames } from "../lib/sprite-segmentation.ts";

function fill(mask, width, left, top, rectangleWidth, rectangleHeight) {
  for (let y = top; y < top + rectangleHeight; y += 1) {
    for (let x = left; x < left + rectangleWidth; x += 1) mask[y * width + x] = 1;
  }
}

test("foreground segmentation keeps all twenty shifted characters intact", () => {
  const width = 80;
  const height = 120;
  const columns = 4;
  const rows = 5;
  const mask = new Uint8Array(width * height);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const left = column * 20 + 5 + (row % 2);
      const top = 5 + row * 22 + ((column + row) % 3) - 1;
      fill(mask, width, left, top, 10, 18);
    }
  }

  const fixedRowEdges = [24, 48, 72, 96];
  const crossesFixedCut = fixedRowEdges.some((edge) => {
    for (let row = Math.max(0, edge - 2); row <= Math.min(height - 1, edge + 2); row += 1) {
      if (mask.slice(row * width, (row + 1) * width).some(Boolean)) return true;
    }
    return false;
  });
  assert.equal(crossesFixedCut, true, "fixture must reproduce a fixed boundary crossing a character");

  const segmented = segmentSpriteFrames(mask, width, height, columns, rows);
  assert.equal(segmented.cells.length, 20);
  assert.equal(segmented.cells.filter((cell) => cell.complete).length, 20);
  assert.equal(segmented.frameCompleteness, 100);
  assert.ok(segmented.boundaryConfidence >= 55);
  segmented.cells.forEach((cell) => {
    assert.ok(cell.bounds);
    assert.ok(cell.componentIds.length >= 1);
    assert.ok(cell.bounds.maxY - cell.bounds.minY + 1 >= 18);
  });
});

test("segmentation groups a detached accessory with the nearest character", () => {
  const width = 80;
  const height = 120;
  const mask = new Uint8Array(width * height);
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      fill(mask, width, column * 20 + 6, row * 24 + 5, 9, 15);
    }
  }
  fill(mask, width, 16, 8, 4, 4);
  const segmented = segmentSpriteFrames(mask, width, height, 4, 5);
  const first = segmented.cells[0];
  assert.equal(first.complete, true);
  assert.ok(first.componentIds.length >= 2);
  assert.equal(first.bounds.maxX, 19);
});
