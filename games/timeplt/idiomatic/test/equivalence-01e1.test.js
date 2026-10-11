// SPDX-License-Identifier: GPL-3.0-only
/**
 * armThePenRouteThenColdStartOnATamperedImage — memory-equivalent to the frozen oracle at ROM 0x01E1.
 *
 * ★ THREE CALL SITES, ONE OR TWO DISPATCHES A SESSION. `call 0x01E1` appears at 0x076A, 0x3333
 *   and 0x3396; measured through our own harness the entry runs twice over the driven tape and
 *   once over the undriven demo. A gate resting on that would be testing one prior state of three
 *   cells against one program image, so CELLS, SEEDS, BLOCK and TAMPER are what carry this file.
 *
 * ★ THE SEEDED COORDINATES ARE NOT LITERALS, and SEEDS is what establishes it. Each is read out
 *   of a fixed pair of program bytes, so a rewrite that hard-coded the two values it happens to
 *   find there would pass every arm that runs the genuine image. SEEDS edits those bytes in a
 *   private copy of the image and requires both sides to follow — which is also a positive
 *   control that the private-image machinery below really does change what the entry reads.
 *
 * ★ THE FAILING BRANCH IS UNREACHABLE ON A GENUINE IMAGE, and the rewrite RAISES there. The
 *   checked run lies wholly inside the program image, so its total is a constant of the image;
 *   GUARD computes it from the genuine image and finds exactly the value the check subtracts, so
 *   the mismatch arm is dead. The oracle's trap is the cold-start entry, which wipes the machine's
 *   whole state; on the oracle side that address is replaced with a probe, and the rewrite in its
 *   place raises NotImplemented — THROWS pins that, with a twin that still cold-starts as its
 *   control. TAMPER changes one image byte and requires the oracle to reach the trap exactly when
 *   the rewrite raises; BLOCK walks the tamper to the first byte of the checked run, the last, and
 *   the bytes either side, so the run's extent is measured rather than declared.
 *
 * What it exercises, holes stated:
 *   1. CORPUS — every real dispatch, whole state dump plus a register-ceiling check. Vacuity
 *      guarded, and the entry is shown not to be degenerate.
 *   2. WINDOW — the oracle pushes nothing on the passing path, measured, with a control.
 *   3. CELLS — the three seeded cells over every prior byte value they could hold.
 *   4. SEEDS — the two coordinates are read from the image, not baked in.
 *   5. ENTRY-STATE — crafted register entries, including the one that makes the counter move.
 *   6. BLOCK — the checked run's first and last byte trip the check; the bytes either side do not.
 *   7. TAMPER — a changed image sends the oracle to the trap and makes the rewrite raise; the
 *      genuine one does neither.
 *   7a. GUARD — the genuine image's total, computed, is the expected one: the raise is dead code.
 *   7b. THROWS — a tampered image raises NotImplemented (not any error), with the pen already
 *      parked exactly as the oracle parks it, and a still-cold-starting twin is caught.
 *   8. EXCLUDED — nothing outside the declared ceiling moves, with a control twin.
 *   9. DRIVEN — the rewrite wired live for a whole session; divergence confined to dead stack.
 *  10. TEETH — six twins, each caught, with the arm that caught it named.
 *
 * HOLE: what the pen then DOES with those cells is not exercised here. This entry only parks it;
 * the walking, the stamping and the route table belong to the routines that read them.
 * HOLE: TAMPER changes one byte at a time. A pair of changes that cancel in an eight-bit sum is
 * exactly what the check cannot see, and nothing here pretends otherwise.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-01e1.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { withOmittedRet } from "../../machine.js";
import { armThePenRouteThenColdStartOnATamperedImage } from "../armThePenRouteThenColdStartOnATamperedImage.js";
import { loc_01e1 as oracle } from "../../translated/loc_01e1.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { NotImplemented } from "../../../../boards/timeplt/io.js";

const TARGET = 0x01e1;
const TRAP = 0x0069;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const PEN_ROUTE_LEG = 0xa9e2;
const PEN_FIRST_AXIS = 0xa9e3;
const PEN_SECOND_AXIS = 0xa9e5;
const FIRST_AXIS_START = 0x0d45;
const SECOND_AXIS_START = 0x280c;

const CHECKED_BLOCK = 0x0e33;
const CHECKED_BYTES = 0x100;
const GENUINE_TOTAL = 0xfd;

/** Measured by WINDOW: on the passing path the oracle pushes nothing at all. */
const SCRATCH_BYTES = 0;
/** The oracle DOES push a return address on the failing path, so TAMPER masks that much. */
const TRAP_SCRATCH_BYTES = 2;

const STACK_SEAT = 0xb000;
const DRIVEN_FRAMES = 700;
const VALUES = 256;

/**
 * The ceiling on register divergence. The oracle leaves the running total in the accumulator with
 * the expected value already taken off it, the flags that subtraction set, a spent loop counter,
 * the cursor one past the checked run, and a stack pointer two higher for the return it takes.
 * None of it is read at any call site: one restores the accumulator and its flags off the stack
 * the instruction after the call, one reloads the counter, the cursor and the accumulator before
 * touching them, and the third transfers straight into an entry that loads its own cursor and
 * writes through it. A subset check, so a rewrite diverging on fewer still passes.
 */
const MOVED = ["a", "f", "b", "h", "l", "sp"];

// Read at import, so it must be guarded by romsPresent(): the ROMs
// are gitignored, and an unguarded read throws before `skip` can spare a single test.
const ROM_IMAGE = romsPresent() ? readFileSync(new URL("../../rom/maincpu.bin", import.meta.url)) : null;

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

function lean(mm) {
  mm.assets = {};
  mm.video = null;
  return mm;
}

// ── the captured machines ───────────────────────────────────────────────────────────────

let captured = null;
function capture() {
  if (captured) return captured;
  const entries = [];
  const m = makeMachine(new Map([[TARGET, (mm) => {
    entries.push(lean(mm.clone()));
    return oracle(mm);
  }]]));
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `capture run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "capture run ran short");
  assert.notEqual(entries.length, 0, "vacuous: the tape never reached the routine");
  captured = entries;
  return captured;
}

const entry = () => capture()[0];

/**
 * A clone whose trap address answers with a COUNTER instead of the routine that lives there.
 * Every comparison below runs on one of these, because the real trap is the cold start: it wipes
 * the machine and jumps into the boot chain, which on a clone (frame machinery neutralised) never
 * comes back. A twin that traps would hang the suite rather than fail it.
 */
function armed(machine) {
  const c = machine.clone();
  c.routines = new Map(c.routines);
  const hits = { n: 0 };
  c.routines.set(TRAP, () => { hits.n++; });
  return { c, hits };
}

function unitDiff(candidate, machine) {
  const seat = machine.regs.sp;
  const { c: a, hits: ha } = armed(machine);
  const { c: b, hits: hb } = armed(machine);
  oracle(a);
  try {
    candidate(b);
  } catch (e) {
    return { addr: null, a: "returned", b: String(e).slice(0, 50) };
  }
  if (ha.n !== hb.n) return { addr: null, a: `trapped ${ha.n}x`, b: `trapped ${hb.n}x` };
  // The oracle pushes a return address on the way to the trap and the rewrite does not, so the
  // masked window is wider on the arm where it traps and zero on the arm where it does not.
  const mask = ha.n > 0 ? TRAP_SCRATCH_BYTES : SCRATCH_BYTES;
  const da = a.dumpState();
  const db = b.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr < seat - mask || addr >= seat) return { addr, a: da[i], b: db[i] };
  }
  for (const k of REG_FIELDS) {
    if (MOVED.includes(k)) continue;
    if (a.regs[k] !== b.regs[k]) return { addr: null, a: `${k}=${a.regs[k]}`, b: `${k}=${b.regs[k]}` };
  }
  return null;
}

function oracleDepth(machine) {
  const c = machine.clone();
  const seat = c.regs.sp;
  let deepest = seat;
  const push = c.push16.bind(c);
  c.push16 = (v) => {
    const r = push(v);
    if (c.regs.sp < deepest) deepest = c.regs.sp;
    return r;
  };
  oracle(c);
  return seat - deepest;
}

// ── a machine over a private, editable program image ────────────────────────────────────

/**
 * A clone of a captured entry reading a PRIVATE copy of the image with the given bytes changed,
 * and with the trap address replaced by a counting probe. Both the image and the routine map are
 * copied rather than shared: the harness caches one of each across every gate in the suite, and
 * editing either in place would poison the rest of the run.
 */
function patched(edits) {
  const image = Uint8Array.from(ROM_IMAGE);
  for (const [at, value] of edits) image[at] = value & 0xff;
  const c = entry().clone();
  c.mem.rom = image;
  c.routines = new Map(c.routines);
  const hits = { n: 0 };
  c.routines.set(TRAP, () => { hits.n++; });
  return { machine: c, hits };
}

const bumped = (at, delta) => [[at, (ROM_IMAGE[at] + delta) & 0xff]];

/** How often each side reaches the trap. The rewrite reaches it by RAISING NotImplemented (counted
 * once); a twin may still reach it through the probe. Any other error reads as -1, never a match. */
function trapHits(candidate, edits) {
  const o = patched(edits);
  const r = patched(edits);
  oracle(o.machine);
  try {
    candidate(r.machine);
  } catch (e) {
    return { oracle: o.hits.n, candidate: e instanceof NotImplemented ? r.hits.n + 1 : -1 };
  }
  return { oracle: o.hits.n, candidate: r.hits.n };
}

// ── broken twins ────────────────────────────────────────────────────────────────────────

const sum = (m, base, n) => {
  let t = 0;
  for (let i = 0; i < n; i++) t = (t + m.mem8[(base + i) & 0xffff]) & 0xff;
  return t;
};
const check = (m) => (sum(m, CHECKED_BLOCK, CHECKED_BYTES) !== 0xfd ? m.call(TRAP) : undefined);

/** BUG: does nothing — the tell that a gate is measuring an idle entry. */
function brokenNoOp() {}

/** BUG: parks the pen but never sends it back to the route's first leg. */
function brokenKeepsLeg(m) {
  m.mem16[PEN_FIRST_AXIS] = m.mem16[FIRST_AXIS_START];
  m.mem16[PEN_SECOND_AXIS] = m.mem16[SECOND_AXIS_START];
  return check(m);
}

/** BUG: writes the whole coordinate into one axis and leaves the other where it was. */
function brokenOneAxis(m) {
  m.mem8[PEN_ROUTE_LEG] = 0;
  m.mem16[PEN_FIRST_AXIS] = m.mem16[FIRST_AXIS_START];
  return check(m);
}

/** BUG: writes only the cell index of each coordinate, leaving the fraction below it standing. */
function brokenIndexOnly(m) {
  m.mem8[PEN_ROUTE_LEG] = 0;
  m.mem8[PEN_FIRST_AXIS + 1] = m.mem8[FIRST_AXIS_START + 1];
  m.mem8[PEN_SECOND_AXIS + 1] = m.mem8[SECOND_AXIS_START + 1];
  return check(m);
}

/** BUG: bakes in the two values a genuine image happens to hold instead of reading them. */
function brokenBakedSeeds(m) {
  m.mem8[PEN_ROUTE_LEG] = 0;
  m.mem16[PEN_FIRST_AXIS] = 0x1000;
  m.mem16[PEN_SECOND_AXIS] = 0x0400;
  return check(m);
}

/** BUG: the check runs one byte short, so the last byte of the run is never covered. */
function brokenShortRun(m) {
  m.mem8[PEN_ROUTE_LEG] = 0;
  m.mem16[PEN_FIRST_AXIS] = m.mem16[FIRST_AXIS_START];
  m.mem16[PEN_SECOND_AXIS] = m.mem16[SECOND_AXIS_START];
  if (sum(m, CHECKED_BLOCK, CHECKED_BYTES - 1) !== 0xfd) return m.call(TRAP);
}

/** BUG: the total is never held against anything, so a tampered image sails through. */
function brokenNeverTraps(m) {
  m.mem8[PEN_ROUTE_LEG] = 0;
  m.mem16[PEN_FIRST_AXIS] = m.mem16[FIRST_AXIS_START];
  m.mem16[PEN_SECOND_AXIS] = m.mem16[SECOND_AXIS_START];
}

/** BUG: scribbles on an index register — the control for the register ceiling. */
function brokenMovesIndex(m) {
  armThePenRouteThenColdStartOnATamperedImage(m);
  m.regs.ix = (m.regs.ix + 1) & 0xffff;
}

/** BUG: the pre-fault form — still hands a tampered image to the cold start instead of raising. */
function brokenStillColdStarts(m) {
  m.mem8[PEN_ROUTE_LEG] = 0;
  m.mem16[PEN_FIRST_AXIS] = m.mem16[FIRST_AXIS_START];
  m.mem16[PEN_SECOND_AXIS] = m.mem16[SECOND_AXIS_START];
  return check(m);
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["keeps-leg", brokenKeepsLeg],
  ["one-axis", brokenOneAxis],
  ["index-only", brokenIndexOnly],
  ["baked-seeds", brokenBakedSeeds],
  ["short-run", brokenShortRun],
  ["never-traps", brokenNeverTraps],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("CORPUS: every real dispatch replays identically", { skip }, () => {
  const entries = capture();
  for (const e of entries) {
    const d = unitDiff(armThePenRouteThenColdStartOnATamperedImage, e);
    assert.equal(d, null, show(d));
  }
  const before = entry();
  const idle = before.mem8[PEN_ROUTE_LEG] === 0 &&
    before.mem16[PEN_FIRST_AXIS] === before.mem16[FIRST_AXIS_START] &&
    before.mem16[PEN_SECOND_AXIS] === before.mem16[SECOND_AXIS_START];
  assert.equal(idle, false, "the captured entry already holds everything this routine writes, so " +
    "the CORPUS arm is degenerate and only the crafted arms below are load-bearing");
  console.log(`  CORPUS: ${entries.length} real dispatch(es) identical; entry held leg ` +
    `${before.mem8[PEN_ROUTE_LEG]}, axes ${hex4(before.mem16[PEN_FIRST_AXIS])} and ` +
    `${hex4(before.mem16[PEN_SECOND_AXIS])}`);
});

test("WINDOW: the oracle pushes nothing on the passing path", { skip }, () => {
  let deepest = 0;
  for (const e of capture()) deepest = Math.max(deepest, oracleDepth(e));
  for (let v = 0; v < VALUES; v += 17) {
    const c = entry().clone();
    c.mem8[PEN_ROUTE_LEG] = v;
    c.mem16[PEN_FIRST_AXIS] = v * 0x0101;
    deepest = Math.max(deepest, oracleDepth(c));
  }
  const probe = entry().clone();
  const seat = probe.regs.sp;
  let seen = seat;
  const push = probe.push16.bind(probe);
  probe.push16 = (v) => { const r = push(v); if (probe.regs.sp < seen) seen = probe.regs.sp; return r; };
  probe.push16(0x1234);
  assert.equal(seat - seen, 2, "the depth instrument does not notice a push it was handed, so " +
    "the number below means nothing");
  console.log(`  WINDOW (measured): the oracle reaches ${deepest} bytes below its seat`);
  assert.equal(deepest, SCRATCH_BYTES, "the oracle now pushes on the passing path, so the whole " +
    "dump is being compared over bytes it has a right to move");
});

test("CELLS: all three seeded cells land whatever they held before", { skip }, () => {
  const wantFirst = entry().mem16[FIRST_AXIS_START];
  const wantSecond = entry().mem16[SECOND_AXIS_START];
  let compared = 0;
  for (let v = 0; v < VALUES; v++) {
    const c = entry().clone();
    c.mem8[PEN_ROUTE_LEG] = v;
    c.mem8[PEN_FIRST_AXIS] = v;
    c.mem8[PEN_FIRST_AXIS + 1] = (v * 3) & 0xff;
    c.mem8[PEN_SECOND_AXIS] = (v * 5) & 0xff;
    c.mem8[PEN_SECOND_AXIS + 1] = (v * 7) & 0xff;
    const d = unitDiff(armThePenRouteThenColdStartOnATamperedImage, c);
    assert.equal(d, null, `prior value ${v} diverged — ${show(d)}`);
    const after = c.clone();
    armThePenRouteThenColdStartOnATamperedImage(after);
    assert.equal(after.mem8[PEN_ROUTE_LEG], 0, `prior ${v}: the leg was not reset`);
    assert.equal(after.mem16[PEN_FIRST_AXIS], wantFirst, `prior ${v}: first axis wrong`);
    assert.equal(after.mem16[PEN_SECOND_AXIS], wantSecond, `prior ${v}: second axis wrong`);
    compared++;
  }
  console.log(`  CELLS: ${compared} prior states identical; the route start is ` +
    `${hex4(wantFirst)} and ${hex4(wantSecond)}`);
});

test("SEEDS: the coordinates are read from the image, not baked in", { skip }, () => {
  let moved = 0;
  for (const [first, second] of [[0x0000, 0xffff], [0x1234, 0x5678], [0xabcd, 0x0001]]) {
    const edits = [
      [FIRST_AXIS_START, first & 0xff], [FIRST_AXIS_START + 1, first >> 8],
      [SECOND_AXIS_START, second & 0xff], [SECOND_AXIS_START + 1, second >> 8],
    ];
    const o = patched(edits);
    const r = patched(edits);
    oracle(o.machine);
    armThePenRouteThenColdStartOnATamperedImage(r.machine);
    assert.equal(o.machine.mem16[PEN_FIRST_AXIS], first, "the oracle did not follow the image");
    assert.equal(r.machine.mem16[PEN_FIRST_AXIS], first, `first axis: expected ${hex4(first)}, ` +
      `got ${hex4(r.machine.mem16[PEN_FIRST_AXIS])} — the value is baked in, not read`);
    assert.equal(r.machine.mem16[PEN_SECOND_AXIS], second, `second axis: expected ${hex4(second)}, ` +
      `got ${hex4(r.machine.mem16[PEN_SECOND_AXIS])} — the value is baked in, not read`);
    assert.equal(o.hits.n, 0, "editing outside the checked run tripped the check");
    assert.equal(r.hits.n, 0, "the rewrite tripped the check on an edit outside the checked run");
    moved++;
  }
  // The absence of a failure is evidence only because the twin that DOES bake them is caught.
  const edits = [[FIRST_AXIS_START, 0x99], [FIRST_AXIS_START + 1, 0x88]];
  const control = patched(edits);
  brokenBakedSeeds(control.machine);
  assert.notEqual(control.machine.mem16[PEN_FIRST_AXIS], 0x8899,
    "the baked-seeds twin followed the image too, so this arm cannot tell the two apart");
  console.log(`  SEEDS: ${moved} edited images followed on both sides, and the baked twin is ` +
    "seen ignoring the edit");
});

test("ENTRY-STATE: crafted register entries, the loop counter included", { skip }, () => {
  let compared = 0;
  for (const b of [0, 1, 7, 0x80, 0xff]) {
    for (const hl of [0x0000, 0x0e33, 0xffff]) {
      const c = entry().clone();
      c.regs.b = b;
      c.regs.hl = hl;
      c.regs.a = (b ^ 0x5a) & 0xff;
      c.regs.de = 0x9876;
      const d = unitDiff(armThePenRouteThenColdStartOnATamperedImage, c);
      assert.equal(d, null, `entry b=${b} hl=${hex4(hl)} diverged — ${show(d)}`);
      compared++;
    }
  }
  const withCounter = entry().clone();
  withCounter.regs.b = 0x33;
  const a = withCounter.clone();
  const bb = withCounter.clone();
  oracle(a);
  armThePenRouteThenColdStartOnATamperedImage(bb);
  assert.notEqual(a.regs.b, bb.regs.b, "the loop counter no longer moves, so listing it in the " +
    "excluded set is dead weight nothing would catch");
  console.log(`  ENTRY-STATE: ${compared} crafted entries identical; the counter moves ` +
    `${bb.regs.b} -> ${a.regs.b} on the oracle side`);
});

test("BLOCK: the checked run's extent, measured at both ends", { skip }, () => {
  const cases = [
    ["one byte before the run", CHECKED_BLOCK - 1, false],
    ["the run's first byte", CHECKED_BLOCK, true],
    ["the run's last byte", CHECKED_BLOCK + CHECKED_BYTES - 1, true],
    ["one byte after the run", CHECKED_BLOCK + CHECKED_BYTES, false],
  ];
  for (const [label, at, shouldTrap] of cases) {
    const r = trapHits(armThePenRouteThenColdStartOnATamperedImage, bumped(at, 1));
    assert.equal(r.oracle, shouldTrap ? 1 : 0, `${label}: the oracle disagrees with this file's ` +
      "idea of where the checked run starts and ends");
    assert.equal(r.candidate, r.oracle, `${label}: the rewrite reached the trap ${r.candidate} ` +
      `time(s) and the oracle ${r.oracle}`);
  }
  console.log("  BLOCK: both ends of the run trip the check, both neighbours do not, on both sides");
});

test("GUARD: the genuine image folds to exactly the expected total, so the raise is dead", { skip }, () => {
  let total = 0;
  for (let i = 0; i < CHECKED_BYTES; i++) total = (total + ROM_IMAGE[CHECKED_BLOCK + i]) & 0xff;
  assert.equal(total, GENUINE_TOTAL, "the genuine image no longer folds to the expected total");
  assert.ok(CHECKED_BLOCK + CHECKED_BYTES <= ROM_IMAGE.length,
    "the checked run leaves the program image, so its total is not a constant of the image");
  // The fold is read through the machine exactly as the routine reads it: a clone at the real entry
  // sees the same bytes, so no RAM or port can move the total.
  const c = entry().clone();
  let seen = 0;
  for (let i = 0; i < CHECKED_BYTES; i++) seen = (seen + c.mem8[CHECKED_BLOCK + i]) & 0xff;
  assert.equal(seen, GENUINE_TOTAL, "the machine reads a different run than the image holds");
  console.log(`  GUARD: the genuine run folds to ${hex4(total)}, the expected total — the raise is dead`);
});

test("THROWS: a tampered image raises NotImplemented after parking the pen as the oracle does", { skip }, () => {
  const edits = bumped(CHECKED_BLOCK + 5, 1);
  const o = patched(edits);
  const r = patched(edits);
  const seat = o.machine.regs.sp;
  oracle(o.machine);
  assert.equal(o.hits.n, 1, "the tampered oracle did not reach its trap");
  assert.throws(() => armThePenRouteThenColdStartOnATamperedImage(r.machine), NotImplemented,
    "the rewrite no longer raises NotImplemented on a tampered image");
  assert.equal(r.hits.n, 0, "the rewrite reached the cold-start trap instead of raising");
  const da = o.machine.dumpState();
  const db = r.machine.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = o.machine.stateOffsetToAddr(i);
    assert.ok(addr >= seat - TRAP_SCRATCH_BYTES && addr < seat,
      `before the trap the two sides differ at ${hex4(addr)}: oracle=${da[i]} rewrite=${db[i]}`);
  }
  // Control: the pre-fault form, which still cold-starts, must fail this arm.
  const t = patched(edits);
  let raised = false;
  try { brokenStillColdStarts(t.machine); } catch (e) { raised = e instanceof NotImplemented; }
  assert.ok(!raised && t.hits.n === 1, "the still-cold-starting twin is indistinguishable here");
  console.log("  THROWS: tampered image raises NotImplemented; pen parked identically; the " +
    "cold-starting twin is seen reaching the trap instead");
});

test("TAMPER: a changed image sends the oracle to the trap and makes the rewrite raise", { skip }, () => {
  const clean = trapHits(armThePenRouteThenColdStartOnATamperedImage, []);
  assert.equal(clean.oracle, 0, "the genuine image already fails the check");
  assert.equal(clean.candidate, 0, "the rewrite raises on a genuine image");

  let caught = 0;
  const offsets = [0, 1, 37, 128, CHECKED_BYTES - 2, CHECKED_BYTES - 1];
  for (const off of offsets) {
    for (const delta of [1, 0x40, 0xff]) {
      const r = trapHits(armThePenRouteThenColdStartOnATamperedImage, bumped(CHECKED_BLOCK + off, delta));
      assert.equal(r.candidate, r.oracle, `offset ${off} delta ${delta}: trap counts differ`);
      if (r.oracle > 0) caught++;
    }
  }
  assert.equal(caught, offsets.length * 3, "a changed byte failed to trip the check, so the " +
    "instrument cannot see the tamper it exists to see");

  const blind = trapHits(brokenNeverTraps, bumped(CHECKED_BLOCK, 1));
  assert.equal(blind.oracle, 1, "the tampered oracle stopped trapping");
  assert.equal(blind.candidate, 0, "the never-traps twin reached the trap, so it is not the " +
    "control this arm needs");
  console.log(`  TAMPER: ${caught} single-byte changes trapped (oracle) and raised (rewrite), the genuine image ` +
    "on neither, and the check-free twin is seen sailing through");
});

function movedOver(candidate) {
  const moved = new Set();
  const machines = [...capture()];
  for (const b of [0, 0x33, 0xff]) {
    const c = entry().clone();
    c.regs.b = b;
    c.regs.hl = 0x1234;
    machines.push(c);
  }
  for (const m of machines) {
    const a = m.clone();
    const bb = m.clone();
    oracle(a);
    try {
      candidate(bb);
    } catch {
      continue;
    }
    for (const k of REG_FIELDS) if (a.regs[k] !== bb.regs[k]) moved.add(k);
  }
  return moved;
}

test("EXCLUDED, deliberately: the total, the flags, the counter, the cursor, the stack pointer",
  { skip }, () => {
    const moved = movedOver(armThePenRouteThenColdStartOnATamperedImage);
    const control = movedOver(brokenMovesIndex);
    assert.ok(REG_FIELDS.some((k) => control.has(k) && !MOVED.includes(k)),
      "the measurement reports nothing outside the ceiling even for a twin that scribbles on an " +
        "index register, so a clean reading below proves nothing");
    console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")} — ` +
      `ceiling ${MOVED.join(", ")}; the control twin also moves ` +
      `${REG_FIELDS.filter((k) => control.has(k) && !MOVED.includes(k)).join(", ")}`);
    assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k)), [],
      "a register diverged outside the excluded set");
  });

// ── the driven run ──────────────────────────────────────────────────────────────────────

function driven(candidate, baseline) {
  let calls = 0;
  let lowSp = 0xffff;
  const m = makeMachine(new Map([[TARGET, (mm) => {
    calls++;
    if (mm.regs.sp < lowSp) lowSp = mm.regs.sp;
    return candidate(mm);
  }]]));
  let frames = [];
  let threw = null;
  try {
    frames = m.runFrames(DRIVEN_FRAMES);
  } catch (e) {
    threw = String(e).slice(0, 60);
    frames = m.frames;
  }
  const differing = new Set();
  const compared = baseline === null ? 0 : Math.min(baseline.frames.length, frames.length);
  for (let f = 0; f < compared; f++) {
    const a = baseline.frames[f];
    const b = frames[f];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differing.add(m.stateOffsetToAddr(i));
  }
  return { frames, calls, lowSp, threw, compared, stopped: m.stoppedBy ? String(m.stoppedBy) : null,
    differing: [...differing].sort((x, y) => x - y) };
}

let baselineRun = null;
function baseline() {
  if (!baselineRun) {
    baselineRun = driven(oracle, null);
    assert.equal(baselineRun.threw, null, `the baseline itself threw: ${baselineRun.threw}`);
    assert.equal(baselineRun.stopped, null, `the baseline stopped early: ${baselineRun.stopped}`);
  }
  return baselineRun;
}

test("DRIVEN: wired live for a whole session, divergence confined to dead stack", { skip }, () => {
  const base = baseline();
  const r = driven(withOmittedRet(armThePenRouteThenColdStartOnATamperedImage, TARGET), base);
  assert.equal(r.threw, null, `the driven run threw: ${r.threw}`);
  assert.equal(r.stopped, null, `the driven run stopped early: ${r.stopped}`);
  assert.equal(r.compared, DRIVEN_FRAMES, "the driven run did not reach the frames asked for");
  assert.ok(r.calls > 0, "vacuous: the rewrite was never dispatched in the driven run");

  const floor = base.lowSp - TRAP_SCRATCH_BYTES;
  const escaped = r.differing.filter((a) => a < floor || a >= STACK_SEAT);
  assert.deepEqual(escaped.map(hex4), [], "a divergence reached memory outside the dead stack " +
    "region, so this rewrite is not a transparent swap after all");
  console.log(`  DRIVEN: ${r.calls} dispatch(es) over ${DRIVEN_FRAMES} frames; ` +
    `${r.differing.length} byte(s) differ, all dead stack: ${r.differing.map(hex4).join(" ")}`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip }, () => {
    const spaces = [];
    spaces.push(["corpus", capture().filter((e) => unitDiff(twin, e) !== null).length, capture().length]);

    const cells = [];
    for (let v = 0; v < VALUES; v += 5) {
      const c = entry().clone();
      c.mem8[PEN_ROUTE_LEG] = v;
      c.mem8[PEN_FIRST_AXIS] = v;
      c.mem8[PEN_FIRST_AXIS + 1] = (v * 3) & 0xff;
      c.mem8[PEN_SECOND_AXIS] = (v * 5) & 0xff;
      c.mem8[PEN_SECOND_AXIS + 1] = (v * 7) & 0xff;
      cells.push(c);
    }
    spaces.push(["cells", cells.filter((c) => unitDiff(twin, c) !== null).length, cells.length]);

    // An edited image is the only place a baked-in coordinate or a shifted run shows itself.
    const seedEdit = [[FIRST_AXIS_START, 0x99], [FIRST_AXIS_START + 1, 0x88],
      [SECOND_AXIS_START, 0x77], [SECOND_AXIS_START + 1, 0x66]];
    const s = patched(seedEdit);
    const sc = patched(seedEdit);
    oracle(s.machine);
    let seedCaught = 0;
    try {
      twin(sc.machine);
      if (s.machine.mem16[PEN_FIRST_AXIS] !== sc.machine.mem16[PEN_FIRST_AXIS] ||
          s.machine.mem16[PEN_SECOND_AXIS] !== sc.machine.mem16[PEN_SECOND_AXIS]) seedCaught = 1;
    } catch {
      seedCaught = 1;
    }
    spaces.push(["seeds", seedCaught, 1]);

    const spots = [CHECKED_BLOCK - 1, CHECKED_BLOCK, CHECKED_BLOCK + CHECKED_BYTES - 1,
      CHECKED_BLOCK + CHECKED_BYTES];
    const tamperCaught = spots.filter((at) => {
      const r = trapHits(twin, bumped(at, 1));
      return r.candidate !== r.oracle;
    }).length;
    spaces.push(["tamper", tamperCaught, spots.length]);

    const total = spaces.reduce((n, s2) => n + s2[1], 0);
    console.log(`  TEETH/${label}: caught on ${spaces.map((x) => `${x[0]} ${x[1]}/${x[2]}`).join(", ")}`);
    assert.ok(total > 0, `every arm PASSED the ${label} twin — no teeth against it`);
  });
}

test("TEETH: the driven arm catches a twin too", { skip }, () => {
  const r = driven(withOmittedRet(brokenNoOp, TARGET), baseline());
  const floor = baseline().lowSp - TRAP_SCRATCH_BYTES;
  const escaped = r.differing.filter((a) => a < floor || a >= STACK_SEAT);
  assert.ok(r.threw !== null || r.stopped !== null || escaped.length > 0,
    "the driven arm PASSED a no-op twin, so its confinement result is vacuous");
  console.log(`  TEETH/driven: no-op twin — reached frame ${r.frames.length}, ` +
    `${escaped.length} escaped byte(s), ${r.threw ?? r.stopped ?? "ran clean"}`);
});
