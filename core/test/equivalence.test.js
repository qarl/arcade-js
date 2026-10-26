// SPDX-License-Identifier: GPL-3.0-only
import { test } from "node:test";
import assert from "node:assert/strict";
import { deadStackBelow, firstStateDiff } from "../equivalence.js";

const SCRATCH = { lo: 0x10, hi: 0x20 };

test("deadStackBelow skips only scratch below the live floor", () => {
  const dead = deadStackBelow(SCRATCH, 0x18);
  assert.deepEqual([0x0f, 0x10, 0x17, 0x18, 0x1f, 0x20, null].map(dead), [false, true, true, false, false, false, false]);
  assert.equal(deadStackBelow(SCRATCH, 0x30)(0x1f), true, "a floor above the window caps at its top");
  assert.equal(deadStackBelow(SCRATCH, 0x08)(0x10), false, "a floor below the window excludes nothing");
});

test("teeth: a write into the caller's frame is a diff, a push below it is not", () => {
  const at = (i) => i;
  const a = new Uint8Array(0x30), push = a.slice(), frame = a.slice();
  push[0x16] = 1;
  frame[0x1a] = 1;
  const dead = deadStackBelow(SCRATCH, 0x18);
  assert.equal(firstStateDiff(a, push, at, dead), null);
  assert.equal(firstStateDiff(a, frame, at, dead).addr, 0x1a);
});
