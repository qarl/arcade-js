// SPDX-License-Identifier: GPL-3.0-only
/**
 * flyAtFastestSpeed — memory-equivalent to the frozen oracle at ROM 0x58A4.
 *
 * WHAT IT IS. Two instructions: load a fixed table pointer, then tail-jump to the per-object move
 * at 0x58BC, which is ALREADY decompiled — so the rewrite calls flyAlongHeading directly with the
 * table as an argument, and dissolving that transfer belongs to this caller's unit. The whole
 * content of this entry is the CHOICE OF TABLE, plus the fact that a pointer the caller was
 * holding is thrown away.
 *
 * ★ THE TABLE IS THE ONLY THING THIS ENTRY DECIDES, so the twins are the NEIGHBOURING rungs of the
 *   ladder of velocity tables, not arbitrary wrong pointers. A gate that cannot tell this table
 *   from the one immediately below it is measuring nothing about this file.
 *
 * ★ NO PLAIN TAPE REACHES THIS ENTRY, and the UNREACHED arm asserts it: the shared coin-then-start
 *   tape, undriven attract, and the very same turning tape used below all dispatch it ZERO times
 *   in the corpus budget. The corpus session is that turning tape with the ERA INDEX PINNED — one
 *   cell poked, after which the game dispatches this entry itself, thousands of times. The pin is
 *   the A/B's single variable.
 *
 * GATE: strict unit-capture over every dispatch of that session, an exhaustive heading sweep, and
 *   a whole-machine replay. What it exercises, holes stated:
 *
 *   1. EQUAL at the real dispatch — RAM byte-identical across the whole dump. NOTHING is excluded
 *      from the RAM comparison here, not even the bytes under the stack pointer: neither side
 *      WRITES the stack, since the oracle's chain only pops a return the caller had already
 *      pushed. The arm asserts that rather than assuming it, by masking nothing.
 *   2. NOT VACUOUS — a candidate that does nothing FAILS that same diff.
 *   3. EXCLUDED, DELIBERATELY — the register file differs in exactly {a, f, d, e, h, l, sp} and pc,
 *      asserted as a set. Those are dead, and the whole-machine arm is what holds that claim.
 *   4. CORPUS — every dispatch replayed, with the dispatch count and the heading spread asserted.
 *   5. EXHAUSTIVE — all 256 headings on a real entry, which is the entry's whole input space apart
 *      from the object's position and the shared displacement.
 *   6. WHOLE-MACHINE — the pinned session with the rewrite wired through the omitted-return seam.
 *      The only cells allowed to differ are the two at the top of the stack that the frame
 *      interrupt pushes and pops; the arm asserts that exact pair, so a real cell cannot hide.
 *   7. TEETH — six twins: the rung below, the bottom rung, a pointer one entry along, a pointer one
 *      BYTE along so the two samples straddle, a candidate that moves nothing, and one that applies
 *      the object's own velocity without the shared displacement. Two of them are caught on 255 and
 *      254 of the 256 crafted headings rather than all of them, which is a real property of the
 *      table and not slack: at those headings the samples the wrong pointer reads happen to move
 *      the object the same distance.
 *
 * HOLE: the corpus is one era, because that is the only era this entry's caller runs in, and the
 * pin holds it there.
 * HOLE: the crafted sweep varies the HEADING and holds the object bases and the shared
 * displacement at the real ones, so nothing here speaks for a different slot.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-58a4.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, romsPresent } from "./_harness.js";
import { withOmittedRet } from "../../machine.js";
import { flyAtFastestSpeed } from "../flyAtFastestSpeed.js";
import { flyAlongHeading } from "../flyAlongHeading.js";
import { velocityForHeading } from "../velocityForHeading.js";
import { ERA_INDEX } from "../names.js";
import { loc_58a4 as oracle } from "../../translated/loc_58a4.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x58a4;

const HEADING_IN_RECORD = 2;

/** The one table this entry exists to select, and the ladder it is the top rung of. */
const VELOCITY_TABLE = 0x08fa;
const LADDER = [0x59d7, 0x5c00, 0x5e00, 0x2530, 0x2e3e, 0x08fa];
const RUNG_BELOW = LADDER[LADDER.length - 2];
const BOTTOM_RUNG = LADDER[0];
const MISALIGNED = VELOCITY_TABLE + 1;
const OFF_BY_ONE_ENTRY = VELOCITY_TABLE + 2;

const EXCLUDED = ["a", "f", "d", "e", "h", "l", "sp"];

/**
 * The only bytes a WHOLE session leaves differing: the two at the very top of the stack, where the
 * frame interrupt pushes the program counter it pops again. They move because the rewrite charges
 * no T-states, so the interrupt lands on a different instruction; nothing reads them. Measured.
 */
const SESSION_SCRATCH = [0xaffd, 0xaffe];

const CORPUS_FRAMES = 2000;
const DISPATCHES = 2479;

const PINNED_ERA = 3;
const PIN_FROM_FRAME = 700;

const IN0 = 0xc300;
const IN1 = 0xc320;
const HOLD = 8;
const TURN_HOLD = 60;

const skip = romsPresent() ? false : "ROM images are not assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

/** Coin, start, trigger held, and the stick walked round the compass for the whole session. */
function playTape() {
  const tape = [
    { frame: COIN_FRAME, port: IN0, bits: 0x01, dur: HOLD },
    { frame: START_FRAME, port: IN0, bits: 0x08, dur: HOLD },
    { frame: START_FRAME + 100, port: IN1, bits: 0x10, dur: CORPUS_FRAMES },
  ];
  const compass = [0x01, 0x05, 0x04, 0x06, 0x02, 0x0a, 0x08, 0x09];
  let frame = START_FRAME + 140;
  let i = 0;
  while (frame < CORPUS_FRAMES) {
    tape.push({ frame, port: IN1, bits: compass[i++ % compass.length], dur: TURN_HOLD });
    frame += TURN_HOLD;
  }
  return tape;
}

const TAPE = playTape();

function pinnedMachine(overrides) {
  const m = makeMachine(overrides, { tape: TAPE });
  m.pokes = [{ addr: ERA_INDEX, val: PINNED_ERA, frame: PIN_FROM_FRAME, dur: null }];
  return m;
}

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

/** Oracle vs candidate on clones of one machine. No mask: nothing is excluded from RAM here. */
function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b)[0] ?? null;
}

function replaySession(candidate) {
  let dispatches = 0;
  let caught = 0;
  const headings = new Set();
  const m = pinnedMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    headings.add(mm.mem8[(mm.regs.ix + HEADING_IN_RECORD) & 0xffff]);
    if (unitDiff(candidate, mm)) caught++;
    return oracle(mm);
  }]]));
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, headings };
}

let cache = null;
const session = () => (cache ??= replaySession(flyAtFastestSpeed));

let entry = null;
function entryState() {
  if (entry === null) {
    const m = pinnedMachine(new Map([[TARGET, (mm) => {
      if (entry === null) entry = mm.clone();
      return oracle(mm);
    }]]));
    m.runFrames(CORPUS_FRAMES);
  }
  assert.notEqual(entry, null, "vacuous: the pinned session never reached the routine");
  return entry;
}

function craft(heading) {
  const m = entryState().clone();
  m.mem8[(m.regs.ix + HEADING_IN_RECORD) & 0xffff] = heading;
  return m;
}

const HEADINGS = Array.from({ length: 256 }, (_unused, h) => h);

function sweepCaught(candidate) {
  let caught = 0;
  for (const heading of HEADINGS) if (unitDiff(candidate, craft(heading))) caught++;
  return caught;
}

function wholeRunCells(candidate) {
  const base = pinnedMachine();
  const baseFrames = base.runFrames(CORPUS_FRAMES);
  let fired = 0;
  const host = pinnedMachine(new Map([[TARGET, withOmittedRet((mm) => (fired++, candidate(mm)))]]));
  let hostFrames = [];
  let threw = null;
  const floors = recordFrameFloors(host);
  try {
    hostFrames = host.runFrames(CORPUS_FRAMES);
  } catch (e) {
    threw = String(e).slice(0, 70);
  }
  const cells = new Set();
  const n = Math.min(baseFrames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    for (let o = 0; o < baseFrames[i].length; o++) {
      if (baseFrames[i][o] !== hostFrames[i][o]) cells.add(base.stateOffsetToAddr(o));
    }
  }
  const live = liveStackDiffs(baseFrames, hostFrames, floors, (o) => base.stateOffsetToAddr(o));
  // A cell that differs in a live frame fails the run like a throw: it is never stack scratch.
  if (live.length && threw === null) threw = `live stack ${live.map((c) => c.toString(16)).join(",")} differs at or above a frame sample's SP`;
  return { cells: [...cells].sort((a, b) => a - b), frames: n, fired, threw, stopped: host.stoppedBy };
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all. */
function brokenNoOp() {}

const atRung = (table) => (m) => flyAlongHeading(m, table);

/** BUG: the object's own velocity is applied without the displacement everything shares. */
function brokenNoSharedDisplacement(m) {
  const object = m.regs.ix;
  const sprite = m.regs.iy;
  velocityForHeading(m, VELOCITY_TABLE, m.mem8[(object + HEADING_IN_RECORD) & 0xffff]);
  const first = m.regs.de;
  const second = m.regs.bc;
  step(m, (sprite + 49) & 0xffff, (object + 3) & 0xffff, first);
  step(m, sprite & 0xffff, (object + 5) & 0xffff, second);
}

function step(m, wholeAddr, fractionAddr, displacement) {
  const moved = (m.mem8[wholeAddr] << 8) + m.mem8[fractionAddr] + displacement;
  m.mem8[wholeAddr] = moved >> 8;
  m.mem8[fractionAddr] = moved;
}

const TWINS = [
  ["no-op", brokenNoOp, 255, 2447],
  ["rung-below", atRung(RUNG_BELOW), 256, 2479],
  ["bottom-rung", atRung(BOTTOM_RUNG), 256, 2479],
  ["off-by-one-entry", atRung(OFF_BY_ONE_ENTRY), 254, 2479],
  ["misaligned", atRung(MISALIGNED), 256, 2479],
  ["no-shared-displacement", brokenNoSharedDisplacement, 256, 2479],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("UNREACHED: no plain tape dispatches this entry, which is why the era is pinned", { skip }, () => {
  for (const [label, opts] of [["shared", {}], ["attract", { tape: [] }], ["turning", { tape: TAPE }]]) {
    let hits = 0;
    const m = makeMachine(new Map([[TARGET, (mm) => (hits++, oracle(mm))]]), opts);
    m.runFrames(CORPUS_FRAMES);
    assert.equal(hits, 0, `the ${label} tape now reaches this entry, so the pin is no longer the variable`);
  }
  console.log("  UNREACHED: shared, attract and the same turning tape unpinned all reach it 0 times");
});

test("EQUAL at the real dispatch: flyAtFastestSpeed == oracle on the WHOLE dump", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  flyAtFastestSpeed(b);
  const strays = allDiffs(a, b);
  assert.deepEqual(strays, [], `RAM diverged: ${show(strays[0])}`);
  console.log(
    `  EQUAL: heading=${entryState().mem8[(entryState().regs.ix + HEADING_IN_RECORD) & 0xffff]}; ` +
      "identical with nothing masked, stack bytes included",
  );
});

test("NOT VACUOUS: a no-op candidate FAILS the same comparison", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the diff passed a candidate that does nothing");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: registers and pc, and nothing else", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  flyAtFastestSpeed(b);
  assert.deepEqual(
    REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
    EXCLUDED,
    "the excluded set changed shape",
  );
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")} and pc`);
});

test("CORPUS: every dispatch of the pinned session replays identically", { skip }, () => {
  const s = session();
  assert.equal(s.dispatches, DISPATCHES, "the dispatch count moved");
  assert.equal(s.caught, 0, "the rewrite diverged on a real dispatch");
  assert.ok(s.headings.size > 1, "vacuous: every dispatch presented the same heading");
  console.log(`  CORPUS: ${s.dispatches} real dispatches over ${s.headings.size} distinct headings`);
});

test("EXHAUSTIVE: all 256 headings behave as the oracle", { skip }, () => {
  assert.equal(sweepCaught(flyAtFastestSpeed), 0, "the rewrite diverged somewhere in the crafted space");
  console.log(`  EXHAUSTIVE: ${HEADINGS.length} headings identical`);
});

test("WHOLE-MACHINE: the pinned session differs only where the interrupt pushes", { skip }, () => {
  const r = wholeRunCells(flyAtFastestSpeed);
  assert.equal(r.threw, null, `the run threw: ${r.threw}`);
  assert.equal(r.stopped, null, `the run stopped early (${r.stopped})`);
  assert.equal(r.frames, CORPUS_FRAMES, `compared ${r.frames} of ${CORPUS_FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  assert.deepEqual(r.cells, SESSION_SCRATCH, "a divergence escaped the interrupt's own push");
  console.log(`  WHOLE-MACHINE: ${r.fired} dispatches, only ${r.cells.map(hex4).join(" ")} differ`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, craftedCaught, realCaught] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted headings`, { skip }, () => {
    assert.equal(sweepCaught(twin), craftedCaught, `the ${label} twin's crafted catch count moved`);
    console.log(`  TEETH/${label}: caught on ${craftedCaught} of ${HEADINGS.length} headings`);
  });

  test(`TEETH: the ${label} twin is caught on an exact count of real dispatches`, { skip }, () => {
    const r = replaySession(twin);
    assert.equal(r.dispatches, DISPATCHES, "the session's dispatch count moved");
    assert.equal(r.caught, realCaught, `the ${label} twin's real catch count moved`);
    console.log(`  TEETH/${label}: the real session catches ${r.caught} of ${r.dispatches}`);
  });
}
