// SPDX-License-Identifier: GPL-3.0-only
/**
 * coldStartClearPlayRamAndSetMode — crafted-entry equivalence vs the frozen cold-start mid-entry at ROM
 * 0x0567. The four render/setup callees (0x0038 clear-screen, 0x0b67 credit, 0x0f69 score-rank, 0x0b1f
 * header) are now lifted and directly called; the oracle's m.calls resolve to the same idiomatic
 * overrides, so they cancel and the diff isolates this routine's body: the three play-RAM LDIR clears,
 * the game-state + difficulty-word + flip-latch zeros, GAME_MODE = 3, and the two work-RAM clears
 * (0x07e6 + 0x07eb). Pace tail 0x0368 severed. RAM compared, dead stack scratch masked; flip latches in
 * IO asserted directly. Teeth: no-op, a wrong game-mode twin, a twin that skips the LDIR block.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent, STACK_SCRATCH } from "./_harness.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { buildRoutines } from "../../routines.js";
import { coldStartClearPlayRamAndSetMode as cand } from "../coldStartClearPlayRamAndSetMode.js";
import { loc_0567 as oracle } from "../../translated/loc_0547.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const GAME_MODE = 0x83d6, PLAY_FLAG = 0x83fe;
const LDIR_LO = 0x8100, LDIR_HI = 0x825f, OBJ0 = 0x8000, OBJ0_END = 0x8004, OBJP = 0x800c, OBJP_END = 0x803a;
const DIFF_LO = 0x8293, DIFF_HI = 0x8294;
const STATE_CELLS = [0x83c3, 0x83fe, 0x83bf, 0x83c9, 0x83ca, 0x83bb, 0x83cb, 0x83d8, 0x83c4, 0x83ba, 0x8295, 0x825b];

const noop = () => {};

// The routines map: pace tail severed; the four render callees + 0x07e6/0x07eb run real on both sides.
const MAP = buildRoutines();
MAP.set(0x0368, noop);

let seed = null;
function seedMachine() {
  if (seed) return seed;
  const m = makeMachine();
  m.runFrames(ENTRY_FRAMES);
  if (m.stoppedBy !== null) throw new Error(`the seed run stopped early: ${m.stoppedBy}`);
  seed = m.clone();
  return seed;
}

function craft(mut) {
  const e = seedMachine().clone();
  e.routines = MAP;
  e.regs.sp = STACK_SCRATCH.hi;
  e.io.setFlipX(1); e.io.setFlipY(1);
  e.mem8[GAME_MODE] = 0xff;
  e.mem8[PLAY_FLAG] = 0; // attract; the early 0x07e6 takes its clear arm
  for (const a of [LDIR_LO, LDIR_HI, OBJ0, OBJ0_END, OBJP, OBJP_END, DIFF_LO, DIFF_HI, ...STATE_CELLS]) e.mem8[a] = 0xff;
  if (mut) mut(e.mem8, e);
  return e;
}

function ramDiff(orc, cnd, entry) {
  const dead = deadStackBelow(STACK_SCRATCH, entry.regs.sp);
  const a = entry.clone(); a.routines = MAP; orc(a);
  const b = entry.clone(); b.routines = MAP; cnd(b);
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

test("EQUAL (crafted): coldStartClearPlayRamAndSetMode == oracle", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, craft()), null, "cold-start mid-entry diverged");

  // Positive controls: run the oracle and confirm the writes really land (non-vacuous).
  const e = craft(); const a = e.clone(); a.routines = MAP; oracle(a);
  assert.equal(a.mem8[GAME_MODE], 0x03, "positive control: GAME_MODE 0xff -> 3");
  assert.notEqual(e.mem8[GAME_MODE], 0x03, "positive control vacuous: GAME_MODE already 3");
  assert.equal(a.mem8[LDIR_LO], 0, "positive control: LDIR base 0xff -> 0");
  assert.equal(a.mem8[LDIR_HI], 0, "positive control: LDIR end (0x825f) 0xff -> 0");
  assert.equal(a.mem8[OBJP_END], 0, "positive control: object-page end (0x803a) 0xff -> 0");
  assert.equal(a.mem8[DIFF_HI], 0, "positive control: difficulty-word high (0x8294) 0xff -> 0");
  for (const c of STATE_CELLS) assert.equal(a.mem8[c], 0, `positive control: state cell 0x${c.toString(16)} -> 0`);
  assert.equal(a.io.flipX, 0, "positive control: flip_x latch 1 -> 0");
  assert.equal(a.io.flipY, 0, "positive control: flip_y latch 1 -> 0");

  // The candidate clears the same IO flip latches (not part of the RAM diff).
  const b = e.clone(); b.routines = MAP; cand(b);
  assert.equal(b.io.flipX, 0, "candidate left flip_x set");
  assert.equal(b.io.flipY, 0, "candidate left flip_y set");
  console.log(`  EQUAL: mid-entry; GAME_MODE ${e.mem8[GAME_MODE]}->3, LDIR + state cells + flip latches cleared`);
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const wrongMode = (m) => { cand(m); m.mem8[GAME_MODE] = 0x02; };            // mode 2, not 3
  const skipLdir = (m) => { cand(m); m.mem8[LDIR_LO] = 0xff; };               // leaves an LDIR cell dirty
  const skipFlip = (m) => { cand(m); m.io.setFlipX(1); };                     // IO teeth (checked separately)
  assert.ok(ramDiff(oracle, noOp, craft()), "no-op twin escaped");
  assert.ok(ramDiff(oracle, wrongMode, craft()), "wrong-mode twin escaped");
  assert.ok(ramDiff(oracle, skipLdir, craft()), "skip-LDIR twin escaped");

  // IO flip teeth: the RAM diff can't see it, so assert on io directly.
  const e = craft(); const b = e.clone(); b.routines = MAP; skipFlip(b);
  assert.equal(b.io.flipX, 1, "skip-flip twin: flip_x stayed 1 as intended (teeth non-vacuous)");
  console.log("  TEETH: no-op, wrong-mode, skip-LDIR caught; flip teeth non-vacuous");
});
