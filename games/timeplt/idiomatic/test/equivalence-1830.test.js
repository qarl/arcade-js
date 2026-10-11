// SPDX-License-Identifier: GPL-3.0-only
/**
 * postPushStartScreenCaptions — memory-equivalent to the frozen oracle at ROM 0x1830.
 * GATE: unit-capture with a 4-byte dead-stack window, a replayed corpus, a crafted 2x2 branch
 *   grid, the frozen continuation run on both sides, a seam-placement arm, and teeth. Every callee
 *   is a direct call that lays nothing on the stack, so the window is the frozen side's own call
 *   slot plus the word its ring writer saves beneath it. Hole: what each posted code draws is not
 *   checked here, only that the same (1, code) pairs reach the writer and the same counter bumps
 *   land. Run: node --test games/timeplt/idiomatic/test/equivalence-1830.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { ROUTINES as TRANSLATED } from "../../routines.js";
import { postPushStartScreenCaptions } from "../postPushStartScreenCaptions.js";
import { loc_1830 as oracle } from "../../translated/loc_1830.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { seamPlaceable } from "../../../../core/equivalence.js";
import { withOmittedRet } from "../../machine.js";
import { stampCopyrightStrip } from "../stampCopyrightStrip.js";
import { flashCopyrightLine } from "../flashCopyrightLine.js";
import { postCommand } from "../postCommand.js";
import { advanceSequenceSubStep } from "../advanceSequenceSubStep.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const TARGET = 0x1830;
const DISPATCHER = 0x1651; // fires every frame the sequence runs, so it mints a real-state corpus
const CONTINUATION = 0x167b; // the fixed tail the dispatcher parks beneath every arm it runs
const SCRATCH_BYTES = 4;
// The frozen side leaves scratch the rewrite does not reproduce: its copyright-strip and flash
// callees leave b/c/iy and the flags, its ring writer leaves a/f and walks e, and its closing
// inc-and-ret leaves f/h/l and pops two bytes the rewrite keeps. All dead: the continuation the
// dispatcher parks reloads a from memory and seats hl before any use, reads no other register,
// and the CONTINUATION arm runs it on both sides to show it. sp is proved on its own arm.
const EXCLUDED_REGS = ["a", "b", "c", "e", "f", "h", "l", "iy", "sp"];
const FLIP_CELL = 0xa9c3;
const BRANCH_CELL = 0xa986;
// Read by the continuation on a zero credit count, from the frozen tail's own operands.
const FREE_PLAY_CELL = 0xa9c0;
const START_INPUT_CELL = 0xa9ae;
const START_ONE = 0x08;
const START_TWO = 0x10;
const PLAY_ACTIVE_CELL = 0xad30;
const CORPUS_CAP = 200;

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

let entry = null;
let continuation = null;
const corpus = [];
function capture() {
  if (entry !== null) return;
  const real1830 = TRANSLATED.get(TARGET);
  continuation = TRANSLATED.get(CONTINUATION);
  const real1651 = TRANSLATED.get(DISPATCHER);
  const m = makeMachine(new Map([
    [TARGET, (mm) => { if (entry === null) entry = mm.clone(); return real1830(mm); }],
    [DISPATCHER, (mm) => { if (corpus.length < CORPUS_CAP) corpus.push(mm.clone()); return real1651(mm); }],
  ]));
  m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the capture run stopped early: ${m.stoppedBy}`);
}

/** The first divergence OUTSIDE the dead stack window, registers included, or null. */
function stray(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  try {
    candidate(b);
  } catch (e) {
    return { threw: String(e).slice(0, 60) };
  }
  const da = a.dumpState();
  const db = b.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) {
      const ad = a.stateOffsetToAddr(i);
      if (ad === null || ad < sp - SCRATCH_BYTES || ad >= sp) return { addr: ad, a: da[i], b: db[i] };
    }
  }
  const moved = REG_FIELDS.filter((k) => !EXCLUDED_REGS.includes(k) && a.regs[k] !== b.regs[k]);
  if (moved.length) return { reg: moved[0], a: a.regs[moved[0]], b: b.regs[moved[0]] };
  return null;
}

/** A real state with the two decision cells forced, to reach the branches the tape does not. */
function craft(flip, branch) {
  const s = entry.clone();
  s.mem8[FLIP_CELL] = flip;
  s.mem8[BRANCH_CELL] = branch;
  return s;
}
// branch spans the a986>=2 credit boundary: 1 below, 2 AT it (guards the >=2/>2 off-by-one), 5 above.
const GRID = [[0, 1], [0x80, 1], [0, 2], [0x80, 2], [0, 5], [0x80, 5]];

// ── twins ─────────────────────────────────────────────────────────────────────────────────
/** The arm rebuilt from its parts, with one knob per defect a twin carries. */
function build({ leading = [0x01, 0x14, 0x15], readFlip = true, readBranch = true, bumps = 2 } = {}) {
  return (m) => {
    const { mem8 } = m;
    const post = (c) => postCommand(m, 0x01, c);
    stampCopyrightStrip(m);
    flashCopyrightLine(m);
    for (const c of leading) post(c);
    const flip = readFlip && mem8[FLIP_CELL] !== 0 ? 0x11 : 0x0f;
    post(flip); post(flip + 1); post(0x16); post(0x00);
    if (readBranch && mem8[BRANCH_CELL] >= 2) {
      post(0x19);
      for (let i = 0; i < bumps; i++) advanceSequenceSubStep(m);
      return;
    }
    post(0x17);
    advanceSequenceSubStep(m);
  };
}
const twinDropPost = build({ leading: [0x01, 0x14] }); // one code short
const twinIgnoreFlip = build({ readFlip: false }); // flip cell never consulted
const twinIgnoreBranch = build({ readBranch: false }); // always the low arm, one counter bump
const twinSingleCounter = build({ bumps: 1 }); // bumps once, not twice
/** A stray word laid on the stack that nothing lifts: memory-identical in the window, seam-refused. */
const twinStrayWord = (m) => { m.push16(0); postPushStartScreenCaptions(m); };

// ── the gate ──────────────────────────────────────────────────────────────────────────────
test("EQUAL: the real dispatch is identical outside the dead stack window", { skip }, () => {
  capture();
  assert.notEqual(entry, null, "vacuous: the tape never reached this arm");
  assert.equal(stray(postPushStartScreenCaptions, entry), null, "a divergence escaped the scratch window");
  console.log(`  EQUAL: flip=${entry.mem8[FLIP_CELL]} branch=${entry.mem8[BRANCH_CELL]} sp=${hex4(entry.regs.sp)}`);
});

test("SP: the rewrite drops exactly the tail return the oracle pops", { skip }, () => {
  capture();
  for (const s of [entry, ...corpus]) {
    const a = s.clone(); const b = s.clone();
    oracle(a); postPushStartScreenCaptions(b);
    assert.equal((a.regs.sp - b.regs.sp) & 0xffff, 2,
      "the sp drift is not the single dropped tail return advanceSequenceSubStep omits");
  }
  console.log(`  SP: oracle pops the tail return, the rewrite leaves it — sp+2 across ${corpus.length + 1} states`);
});

test("NOT VACUOUS: the masked diff catches a do-nothing twin", { skip }, () => {
  capture();
  assert.notEqual(stray(() => {}, entry), null, "the masked diff passed a no-op, so it is not a gate");
});

test("WINDOW: the widest divergence is exactly the declared window", { skip }, () => {
  capture();
  let widest = 0;
  for (const s of [entry, ...corpus, ...GRID.map(([f, b]) => craft(f, b))]) {
    const sp = s.regs.sp; const a = s.clone(); const b = s.clone();
    oracle(a); postPushStartScreenCaptions(b);
    const da = a.dumpState(); const db = b.dumpState();
    for (let i = 0; i < da.length; i++) {
      if (da[i] !== db[i]) { const ad = a.stateOffsetToAddr(i); if (ad !== null && ad < sp) widest = Math.max(widest, sp - ad); }
    }
  }
  assert.equal(widest, SCRATCH_BYTES, "the widest scratch divergence moved; the window is the wrong size");
  console.log(`  WINDOW: widest divergence sp-${widest}`);
});

test("SEAM: a direct call leaves the stack where it found it, and the seam places the arm", { skip }, () => {
  capture();
  const states = [entry, ...corpus, ...GRID.map(([f, b]) => craft(f, b))];
  for (const s of states) {
    const direct = s.clone();
    postPushStartScreenCaptions(direct);
    assert.equal(direct.regs.sp, s.regs.sp, "a direct call moved the stack pointer");
    const r = seamPlaceable(withOmittedRet, postPushStartScreenCaptions, TARGET, s.clone());
    assert.equal(r.placeable, true, `the seam cannot place the arm: ${r.error}`);
  }
  // ★ control: a stray word is invisible to the masked diff (it lands in the window) but not here.
  let refused = 0;
  for (const s of states) if (!seamPlaceable(withOmittedRet, twinStrayWord, TARGET, s.clone()).placeable) refused++;
  assert.equal(refused, states.length, "the stray-word control was placed on some state");
  console.log(`  SEAM: ${states.length} states SP-neutral and placeable; the stray-word control refused on each`);
});

/** Zero credits with free play on and a start button held: the continuation's deepest path, which
 *  starts a game rather than stepping the sequence. */
function craftFreePlayStart(start) {
  const s = craft(0, 0);
  s.mem8[FREE_PLAY_CELL] = 1;
  s.mem8[START_INPUT_CELL] = start;
  return s;
}

test("CONTINUATION: the frozen tail after the arm leaves RAM identical (the excluded registers are dead)", { skip }, () => {
  capture();
  const states = [
    entry, ...corpus, ...GRID.map(([f, b]) => craft(f, b)),
    craftFreePlayStart(START_ONE), craftFreePlayStart(START_TWO),
  ];
  const afterTail = (s, arm) => {
    const a = s.clone(); const b = s.clone();
    oracle(a); arm(b);
    // Seat both sides on the same stack pointer so the tail's own pushes land on the same bytes.
    b.regs.sp = a.regs.sp;
    continuation(a); continuation(b);
    const sp = s.regs.sp;
    const da = a.dumpState(); const db = b.dumpState();
    for (let i = 0; i < da.length; i++) {
      if (da[i] === db[i]) continue;
      const ad = a.stateOffsetToAddr(i);
      if (ad !== null && ad < sp && ad >= sp - SCRATCH_BYTES) continue;
      return { addr: ad, a: da[i], b: db[i] };
    }
    return null;
  };
  for (const s of states) {
    const d = afterTail(s, postPushStartScreenCaptions);
    assert.equal(d, null, `the continuation diverged at ${d && hex4(d.addr)}`);
  }
  // The deepest path is really taken: the two-player start raises the play-active cell.
  const deep = craftFreePlayStart(START_TWO);
  postPushStartScreenCaptions(deep);
  continuation(deep);
  assert.equal(deep.mem8[PLAY_ACTIVE_CELL], 0xff, "the free-play start state never reached the game-start path");
  // ★ control: the same comparison still sees a real defect once the tail has run.
  assert.notEqual(afterTail(craft(0x80, 2), twinIgnoreFlip), null, "the tail hid a wrong caption pair");
  console.log(`  CONTINUATION: ${states.length} states identical through the frozen tail; a wrong caption pair still shows`);
});

test("CORPUS: every captured real state replays identically", { skip }, () => {
  capture();
  assert.ok(corpus.length > 0, "vacuous: no states captured");
  let caught = 0;
  for (const s of corpus) if (stray(postPushStartScreenCaptions, s)) caught++;
  assert.equal(caught, 0, `the rewrite diverged on ${caught} of ${corpus.length} captured states`);
  console.log(`  CORPUS: ${corpus.length} states identical`);
});

test("CRAFTED: both branch decisions replay identically", { skip }, () => {
  capture();
  for (const [flip, branch] of GRID) {
    assert.equal(stray(postPushStartScreenCaptions, craft(flip, branch)), null, `flip=${flip} branch=${branch} diverged`);
  }
  console.log("  CRAFTED: the 2x2 branch grid is identical");
});

test("EXCLUDED: only the dead registers differ, and a scribbling control is still caught", { skip }, () => {
  capture();
  const a = entry.clone(); const b = entry.clone();
  oracle(a); postPushStartScreenCaptions(b);
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  assert.deepEqual(moved.filter((k) => !EXCLUDED_REGS.includes(k)), [], "a register diverged outside the dead set");
  assert.ok(EXCLUDED_REGS.some((k) => moved.includes(k)), "no dead register moved, so the exclusion measures nothing");
  const scribble = (m) => { postPushStartScreenCaptions(m); m.regs.d = (m.regs.d + 1) & 0xff; };
  assert.notEqual(stray(scribble, entry), null, "the register check cannot even see a scribbled live register");
  console.log(`  EXCLUDED: ${moved.join(", ")} move (all dead); a scribble on a live register is caught`);
});

// a stray word is a stack-only defect the sp-excluded diff cannot see; the SEAM arm above is its gate.
const STRUCTURAL = [["no-op", () => {}], ["drop-a-post", twinDropPost]];
for (const [label, twin] of STRUCTURAL) {
  test(`TEETH: the ${label} twin is caught across the whole corpus`, { skip }, () => {
    capture();
    assert.notEqual(stray(twin, entry), null, `${label} slipped past the real dispatch`);
    let caught = 0;
    for (const s of corpus) if (stray(twin, s)) caught++;
    assert.equal(caught, corpus.length, `${label} escaped ${corpus.length - caught} captured states`);
    console.log(`  TEETH/${label}: caught on the real dispatch and all ${corpus.length} states`);
  });
}

const BRANCH = [
  ["ignore-flip", twinIgnoreFlip, ([flip]) => flip !== 0],
  ["ignore-branch", twinIgnoreBranch, ([, branch]) => branch >= 2],
  ["single-counter", twinSingleCounter, ([, branch]) => branch >= 2],
];
for (const [label, twin, shouldCatch] of BRANCH) {
  test(`TEETH: the ${label} twin is caught on exactly the crafted combos that trip it`, { skip }, () => {
    capture();
    for (const combo of GRID) {
      const caught = stray(twin, craft(combo[0], combo[1])) !== null;
      assert.equal(caught, shouldCatch(combo), `${label} at flip=${combo[0]} branch=${combo[1]}: caught=${caught}`);
    }
    console.log(`  TEETH/${label}: caught on exactly the combos that trip it`);
  });
}
