// SPDX-License-Identifier: GPL-3.0-only
// Entry stack floor for the equivalence gates' RAM diff. atEntry(oracle, floorOf) records floorOf(m) at each
// top-level oracle entry into a machine -- by default the lowest live page-1 cell, 0x100 + S + 1 (S names the
// next free slot) -- and keeps the lowest across sequential entries; an entry made while that machine's oracle is
// already running lies inside the running oracle's frame and is ignored. The diff excludes only stack scratch
// below that floor and compares every caller frame above it.

import { deadStackBelow } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const FLOOR = new WeakMap();
const DEPTH = new WeakMap();

export const stackFloor = (m) => 0x100 + m.regs.s + 1;

/** A routine whose ROM reseats S (txs) before any push and never returns has no caller frame. */
export const reseatedTop = () => 0x200;

/** Record m's entry floor now (the lowest of its top-level entries), unless m's oracle is already running. */
export function markEntry(m, floorOf = stackFloor) {
  if ((DEPTH.get(m) ?? 0) > 0) return m;
  const f = floorOf(m);
  FLOOR.set(m, Math.min(FLOOR.get(m) ?? f, f));
  return m;
}

/** The oracle, recording its machine's entry floor before it runs. */
export const atEntry = (fn, floorOf = stackFloor) => (m, ...args) => {
  markEntry(m, floorOf);
  DEPTH.set(m, (DEPTH.get(m) ?? 0) + 1);
  try { return fn(m, ...args); } finally { DEPTH.set(m, DEPTH.get(m) - 1); }
};

/** The dead-stack predicate for comparing ma with mb: scratch below the recorded entry floor only. */
export function deadStackAtEntry(ma, mb) {
  const fs = [FLOOR.get(ma), FLOOR.get(mb)].filter((f) => f !== undefined);
  if (fs.length === 0) throw new Error("ramDiff: no entry floor recorded (run the oracle via atEntry or markEntry)");
  return deadStackBelow(STACK_SCRATCH, Math.min(...fs));
}
