// SPDX-License-Identifier: GPL-3.0-only
/**
 * Shared capture + diff for the frog-hop handler equivalence gates. The hop handlers fire only when
 * the frog is mid-hop, which plain attract never reaches, so a coherent post-boot state is captured at
 * the per-frame score-header redraw (0x0b1f) and the hop cells are poked to drive each branch. Both
 * sides run on a fresh clone with the frog X/Y cursors armed (HL=FROG_X, DE=FROG_Y), as the real callers
 * arm them; live-out is memory-only so RAM is compared minus the dead stack scratch below the entry SP.
 */
import assert from "node:assert/strict";
import { makeMachine, ENTRY_FRAMES, romsPresent, STACK_SCRATCH } from "./_harness.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { ROUTINES as TRANSLATED } from "../../routines.js";

export { romsPresent };

export const FROG_X = 0x8044, FROG_SPRITE = 0x8045, FROG_Y = 0x8047;
export const PLAY_FLAG = 0x83fe, FURTHEST = 0x8269;

// Per-direction cell bases (index by direction 0=DOWN,1=UP,2=RIGHT,3=LEFT).
export const ACTIVE = [0x8248, 0x8249, 0x824a, 0x824b];
export const ARRIVAL = [0x824c, 0x824d, 0x824e, 0x824f];
export const COUNTER = [0x8250, 0x8251, 0x8252, 0x8253];
export const RELOAD = [0x8256, 0x8257, 0x8258, 0x8259];
export const VDELTA = 0x8254, HDELTA = 0x8255;

const NEIGHBOUR = 0x0b1f;

let seed = null;
export function seedState() {
  if (seed) return seed;
  const real = TRANSLATED.get(NEIGHBOUR);
  const m = makeMachine(new Map([[NEIGHBOUR, (mm) => {
    if (!seed) seed = mm.clone();
    return real(mm);
  }]]));
  m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `capture run stopped early: ${m.stoppedBy}`);
  assert.ok(seed, "vacuous: the neighbour was never dispatched");
  return seed;
}

// A fresh entry clone with the frog cursors armed, then mutated by `mut(mem8, machine)`.
export function craft(mut) {
  const c = seedState().clone();
  c.regs.hl = FROG_X;
  c.regs.de = FROG_Y;
  if (mut) mut(c.mem8, c);
  return c;
}

// null == RAM-equivalent (dead stack scratch masked); else a string naming the first differing address.
export function ramDiff(oracle, cand, entry) {
  const dead = deadStackBelow(STACK_SCRATCH, entry.regs.sp);
  const a = entry.clone(); oracle(a);
  const b = entry.clone(); cand(b);
  const A = a.dumpState(), B = b.dumpState();
  const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i++) {
    if (A[i] === B[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return `0x${(addr ?? 0).toString(16)}: ${A[i]} vs ${B[i]}`;
  }
  return null;
}
