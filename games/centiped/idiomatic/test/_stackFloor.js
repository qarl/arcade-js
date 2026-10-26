// SPDX-License-Identifier: GPL-3.0-only
// The RAM diff skips only stack scratch BELOW the compared routine's entry SP. 6502 S is the next free
// slot, so the caller's live frame starts at 0x100 + S + 1; it is read when the oracle is entered (first
// entry wins, so a multi-dispatch span keeps its start) and every cell from it up is compared.
import { deadStackBelow } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const FLOOR = new WeakMap();
const GeneratorFunction = function* () {}.constructor;

export const entryFloor = (m) => 0x100 + m.regs.s + 1;

export function markEntry(m) {
  if (!FLOOR.has(m)) FLOOR.set(m, entryFloor(m));
  return m;
}

export function stampEntry(fn) {
  if (fn instanceof GeneratorFunction) return function* (m, ...args) { markEntry(m); return yield* fn(m, ...args); };
  return (m, ...args) => fn(markEntry(m), ...args);
}

// Both sides start from one state; a side never entered (a rewrite twin) takes the other's floor.
export function deadStackAtEntry(...machines) {
  return deadStackDeepAtEntry(0, ...machines);
}

// The same, also skipping `depth` bytes below the floor where the entry SP sits under STACK_SCRATCH.lo.
export function deadStackDeepAtEntry(depth, ...machines) {
  const floors = machines.map((m) => FLOOR.get(m)).filter((f) => f != null);
  if (floors.length === 0) throw new Error("no entry SP stamped: enter the oracle via stampEntry or markEntry first");
  if (floors.some((f) => f !== floors[0])) throw new Error(`entry SP floors differ: ${floors.map((f) => f.toString(16))}`);
  const lo = Math.max(0x100, Math.min(STACK_SCRATCH.lo, floors[0] - depth));
  return deadStackBelow({ lo, hi: STACK_SCRATCH.hi }, floors[0]);
}
