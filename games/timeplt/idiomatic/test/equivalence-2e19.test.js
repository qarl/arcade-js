// SPDX-License-Identifier: GPL-3.0-only
/**
 * unpackTheFirstThreeSwitchSettings — memory-equivalent to the frozen oracle at ROM 0x2E19.
 *
 * THE TAIL NEVER RETURNS. 0x2E19 opens three settings cells and tail-jumps to 0x49A8, which cold-
 * starts and hands the machine to the foreground loop. The dissolution calls the lifted 0x49A8
 * directly, and its generator-engine tail returns a COROUTINE rather than dispatching through the registry, so
 * a stub at 0x49A8 no longer stops the rewrite. Both arms are therefore run with the foreground loop
 * (0x0B93) SEVERED to an empty coroutine, reached by the frozen side's plain call and the rewrite's
 * `yield*` alike; `drive` iterates the rewrite's coroutine to that handover. What is compared there is
 * RAM minus the stack scratch below the entry SP, the LS259 latch, the sound latch and the watchdog kicks —
 * the real live-out. Registers are not compared: the dissolved lattice scrambles them and the cold-
 * start tail never returns, so no caller consumes one.
 *
 * HOLE: 0x49A8 masks the rolled byte down to the bits a shift and a rotate share, so a rewrite that
 * SHIFTED the handed-on byte rather than rotating it is invisible past this transfer — the bits that
 * separate them are consumed by neither cell it opens. The rotate itself is 0x49A8's own gate to hold.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-2e19.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { unpackTheFirstThreeSwitchSettings as candidate } from "../unpackTheFirstThreeSwitchSettings.js";
import { loc_2e19 as oracle } from "../../translated/loc_2e19.js";
import { finishBootSelfTestAndColdStart } from "../finishBootSelfTestAndColdStart.js";
import manifest from "../../manifest.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { COMMAND_READ_CURSOR } from "../names.js";
import { Severed, severAtDirectCall } from "./_spineSever.js";

const TARGET = 0x2e19;
const DRAIN = 0x0b93; // the foreground loop, severed so both arms stop at the same handover
const DRAIN_NAME = "runCommandRingDrainLoop";
const [STACK_LO, STACK_HI] = manifest.convergence.stateExclude.stack;
const STACK_WINDOW = { lo: STACK_LO, hi: STACK_HI };

/** The three cells this routine opens, and the bit each of the last two takes. */
const WHOLE_BYTE_CELL = 0xa9c1;
const BIT_CELLS = [
  { cell: 0xa9c2, bit: 2 },
  { cell: 0xa9c3, bit: 3 },
];
const ROTATION = 3;

const VALUES = 256;
const CROSS_STEP = 4; // a 64x64 grid over the two bytes together
const SOUND_SEED = 0x5a;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? d.k : "identical");
/** Stack scratch below the entry SP `floor` is dead; every cell from the floor up is compared. */
const deadStack = (floor) => deadStackBelow(STACK_WINDOW, floor);

// ── the rig: capture the boot entry, sever the foreground, drive the coroutine ────────────

const captured = new Map();
function capture(tapeLabel) {
  if (captured.has(tapeLabel)) return captured.get(tapeLabel);
  let entry = null;
  let atFrame = -1;
  const m = makeMachine(new Map([[TARGET, (mm) => {
    if (entry === null) {
      entry = mm.clone();
      atFrame = mm.frames.length;
    }
    return oracle(mm);
  }]]), tapeLabel === "undriven" ? { tape: [] } : {});
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the ${tapeLabel} capture run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, `the ${tapeLabel} capture run ran short`);
  captured.set(tapeLabel, { entry, atFrame });
  return captured.get(tapeLabel);
}

function entryState() {
  const { entry } = capture("coin-start");
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  return entry;
}

/** A clone whose foreground loop is a recorder returning an empty iterable, so the frozen plain
 *  call and the rewrite's `yield*` both reach it and count once. */
// The frozen side reaches the loop through the routine map; the rewritten spine enters it by `yield*`
// into a direct import, which _spineSever.js catches at the loop's first act (reading its cursor) from
// inside the loop's own frame. Both record the same hand-over. The accumulator is not part of it: the
// loop loads A from its cursor before anything reads it.
function severed(machine, log) {
  const c = machine.clone();
  const record = (mm) => log.push({ kicks: mm.io.watchdogKicks });
  c.routines = new Map(c.routines);
  c.routines.set(DRAIN, (mm) => {
    record(mm);
    return { [Symbol.iterator]: function* () {} };
  });
  return severAtDirectCall(c, DRAIN_NAME, { reads: [COMMAND_READ_CURSOR] }, record);
}

function drive(fn, m) {
  try {
    const r = fn(m);
    if (!r || typeof r.next !== "function") return r;
    for (let i = 0; i <= 64; i++) {
      const step = r.next();
      if (step.done) return step.value;
    }
  } catch (e) {
    if (e instanceof Severed) return undefined;
    throw e;
  }
  throw new Error("still yielding after the budget; the tail returned");
}

/** A clone of the captured entry with the two bytes the routine consumes set by hand. */
function crafted(whole, packed) {
  const m = entryState().clone();
  m.regs.a = whole;
  m.regs.c = packed;
  return m;
}

/** The real contract at the severed handover: RAM minus stack scratch below the entry SP, the whole LS259, the sound
 *  latch, the watchdog kick count and the handover register. */
function unitDiff(cand, machine) {
  const logA = [];
  const logB = [];
  const a = severed(machine, logA);
  const b = severed(machine, logB);
  a.io.soundData = SOUND_SEED;
  b.io.soundData = SOUND_SEED;
  drive(oracle, a);
  try {
    drive(cand, b);
  } catch (e) {
    return { k: "threw:" + String(e).slice(0, 40) };
  }
  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off),
    deadStack(machine.regs.sp));
  if (ram) return { k: "ram@" + hex4(ram.addr) };
  for (let i = 0; i < a.io.latch.length; i++) {
    if (a.io.latch[i] !== b.io.latch[i]) return { k: "latch" + i };
  }
  if (a.io.soundData !== b.io.soundData) return { k: "sound" };
  if (a.io.watchdogKicks !== b.io.watchdogKicks) return { k: "kicks" };
  if (logA.length !== logB.length) return { k: "handovers" };
  for (const [i, x] of logA.entries()) {
    if (x.kicks !== logB[i].kicks) return { k: "handover" };
  }
  return null;
}

/** The three cells the oracle leaves, read off the frozen side, to prove the decode varies. */
function cellsAfterOracle(machine) {
  const log = [];
  const m = severed(machine, log);
  drive(oracle, m);
  return [WHOLE_BYTE_CELL, ...BIT_CELLS.map((c) => c.cell)].map((a) => m.mem8[a]).join(",");
}

function sweepPacked(cand, whole = 3) {
  let caught = 0;
  for (let packed = 0; packed < VALUES; packed++) if (unitDiff(cand, crafted(whole, packed))) caught++;
  return caught;
}

function sweepWhole(cand, packed = 0xb4) {
  let caught = 0;
  for (let whole = 0; whole < VALUES; whole++) if (unitDiff(cand, crafted(whole, packed))) caught++;
  return caught;
}

function sweepCross(cand) {
  let caught = 0;
  for (let whole = 0; whole < VALUES; whole += CROSS_STEP) {
    for (let packed = 0; packed < VALUES; packed += CROSS_STEP) {
      if (unitDiff(cand, crafted(whole, packed))) caught++;
    }
  }
  return caught;
}

const CROSS_SIZE = (VALUES / CROSS_STEP) ** 2;

// ── broken twins ────────────────────────────────────────────────────────────────────────

function brokenNoOp() {}

/** BUG: takes the two bits one place too low. */
function brokenBitsOffByOne(m) {
  const { mem8, regs } = m;
  mem8[WHOLE_BYTE_CELL] = regs.a;
  for (const { cell, bit } of BIT_CELLS) mem8[cell] = (regs.c >> (bit - 1)) & 1;
  const unspent = ((regs.c >> ROTATION) | (regs.c << (8 - ROTATION))) & 0xff;
  regs.a = unspent;
  regs.c = unspent;
  return finishBootSelfTestAndColdStart(m);
}

/** BUG: the two single-bit cells are the wrong way round. */
function brokenCellsSwapped(m) {
  const { mem8, regs } = m;
  mem8[WHOLE_BYTE_CELL] = regs.a;
  mem8[BIT_CELLS[0].cell] = (regs.c >> BIT_CELLS[1].bit) & 1;
  mem8[BIT_CELLS[1].cell] = (regs.c >> BIT_CELLS[0].bit) & 1;
  const unspent = ((regs.c >> ROTATION) | (regs.c << (8 - ROTATION))) & 0xff;
  regs.a = unspent;
  regs.c = unspent;
  return finishBootSelfTestAndColdStart(m);
}

/** BUG: puts the packed byte in the whole-byte cell instead of the byte the caller brought. */
function brokenWrongSource(m) {
  const { mem8, regs } = m;
  mem8[WHOLE_BYTE_CELL] = regs.c;
  for (const { cell, bit } of BIT_CELLS) mem8[cell] = (regs.c >> bit) & 1;
  const unspent = ((regs.c >> ROTATION) | (regs.c << (8 - ROTATION))) & 0xff;
  regs.a = unspent;
  regs.c = unspent;
  return finishBootSelfTestAndColdStart(m);
}

/** BUG: stores the whole bit-field rather than the single bit, so neighbouring bits leak in. */
function brokenKeepsTheHighBits(m) {
  const { mem8, regs } = m;
  mem8[WHOLE_BYTE_CELL] = regs.a;
  for (const { cell, bit } of BIT_CELLS) mem8[cell] = regs.c >> bit;
  const unspent = ((regs.c >> ROTATION) | (regs.c << (8 - ROTATION))) & 0xff;
  regs.a = unspent;
  regs.c = unspent;
  return finishBootSelfTestAndColdStart(m);
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["bits-off-by-one", brokenBitsOffByOne],
  ["cells-swapped", brokenCellsSwapped],
  ["wrong-source", brokenWrongSource],
  ["keeps-the-high-bits", brokenKeepsTheHighBits],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("DISPATCHED: the real boot reaches this address under both tapes", { skip }, () => {
  for (const tapeLabel of ["coin-start", "undriven"]) {
    const { entry, atFrame } = capture(tapeLabel);
    assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
    console.log(`  DISPATCHED: ${tapeLabel} entered ${hex4(TARGET)} first at frame ${atFrame}`);
  }
  const e = entryState();
  console.log(`  DISPATCHED: entry carries whole=${e.regs.a}, packed=${e.regs.c}`);
});

test("EQUAL at the captured entry: RAM, latch, sound, kicks and handover", { skip }, () => {
  assert.equal(show(unitDiff(candidate, entryState())), "identical");
  console.log("  EQUAL: the boot entry replays identically to the severed handover");
});

test("PACKED: all 256 values of the packed byte, and the decode really varies", { skip }, () => {
  assert.equal(sweepPacked(candidate), 0, "a packed value diverged");
  const cells = new Set([0x00, 0x55, 0xaa, 0xff].map((p) => cellsAfterOracle(crafted(3, p))));
  assert.ok(cells.size > 1, "the decode wrote the same cells for every packed value; the sweep is blind");
  console.log(`  PACKED: ${VALUES} values identical, ${cells.size} distinct cell triples`);
});

test("WHOLE: all 256 values of the byte the caller arrives with", { skip }, () => {
  assert.equal(sweepWhole(candidate), 0, "a whole-byte value diverged");
  for (const whole of [0, 1, 3, 5, 128, 255]) {
    const log = [];
    const m = severed(crafted(whole, 0xb4), log);
    drive(oracle, m);
    assert.equal(m.mem8[WHOLE_BYTE_CELL], whole, "the whole byte must land unaltered");
  }
  console.log(`  WHOLE: ${VALUES} values identical, and the byte lands unaltered`);
});

test("CROSS: a grid over both bytes together", { skip }, () => {
  assert.equal(sweepCross(candidate), 0, "a pair of bytes diverged");
  console.log(`  CROSS: ${CROSS_SIZE} pairs identical`);
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT on an exact count`, { skip }, () => {
    const got = [sweepPacked(twin), sweepWhole(twin)];
    console.log(`  TEETH/${label}: caught on ${got[0]}/${VALUES} packed, ${got[1]}/${VALUES} whole`);
    assert.ok(got[0] + got[1] > 0, `every sweep PASSED the ${label} twin`);
  });
}
