// SPDX-License-Identifier: GPL-3.0-only
/**
 * serviceSlotByHeadByte — memory-equivalent to the frozen oracle at ROM 0x3DEB.
 *
 * WHAT IT IS. A three-way split on the head byte of one slot's record, with all three arms
 * already decompiled, so each transfer is dissolved into a direct call in the rewrite.
 *
 * ★ HOW THIS FILE HANDLES THE MISSING RETURN, because it is the whole reason it can compare pc and
 *   SP instead of excusing them. Every exit of the oracle nets exactly one return: two of them are
 *   its own conditional returns, the third is a transfer whose target returns for it. The rewrite
 *   performs none, which is the shape the dispatch seam is built for — so the candidate is run
 *   THROUGH that seam here, exactly as an assembled run would reach it. The seam MEASURES what the
 *   rewrite did to the stack and throws if it is neither shape, so wiring it in is an assertion and
 *   not an accommodation, and it lets SP and pc be compared for EQUALITY on every entry below.
 *   Nothing in this file asserts that the candidate DIFFERS from the oracle anywhere.
 *
 * ★ THE ENTRY THE UNDRIVEN DEMO PRESENTS IS THE INERT ARM, every single time: the head byte is
 *   zero on all of them, so the real corpus alone cannot tell the rewrite from a routine that does
 *   nothing. The crafted arms are what carry this gate, and the VACUOUS arm states that in an
 *   assertion rather than in prose.
 *
 * GATE: crafted-entry over the routine's whole input byte, plus every dispatch of two real
 *   sessions and a whole-machine replay. What it exercises, holes stated:
 *
 *   1. CORPUS SHAPE — how many dispatches each session presents, and that all of them are inert.
 *   2. EQUAL at the real dispatch — RAM outside the dead stack window, SP and pc all identical.
 *   3. VACUOUS AT THE REAL ENTRY — a do-nothing twin PASSES there, asserted, so the crafted cross
 *      is known to be load-bearing rather than assumed to be.
 *   4. NOT VACUOUS CRAFTED — the same comparison catches the do-nothing twin on 255 of 256 heads.
 *   5. SEAM — SP and pc agree on every crafted entry and every real dispatch, not just the first.
 *   6. EXCLUDED — the registers that move are reported and bounded by a CEILING, asserted as a
 *      subset rather than an equality so that a rewrite agreeing MORE closely cannot fail. SP, pc
 *      and both index registers are asserted to be outside it.
 *   7. EXHAUSTIVE — all 256 head bytes, which is the entire space of the one byte read to choose
 *      an arm.
 *   8. ARMS — the cross is shown to reach all four outcomes, including the retire that only
 *      happens once a flown object lands on a line.
 *   9. CORPUS — every dispatch of both sessions replays identically.
 *  10. WHOLE-MACHINE — the demo session with the rewrite wired through the seam.
 *  11. TEETH — seven twins, each with an exact crafted catch count, plus the whole-machine arm's
 *      own verdict on the do-nothing twin, which is BLIND and is recorded as blind rather than
 *      glossed: the demo takes the inert arm every time, so a candidate doing nothing leaves the
 *      same RAM the oracle does through the entire run.
 *
 * HOLE: one captured machine. The head byte and the two coordinate bytes the line test reads are
 * varied; the rest of RAM, and which slot the index registers point at, are whatever the captured
 * frame left.
 * HOLE: the crafted cross reaches the retire-after-flying outcome by moving the coordinates, not by
 * letting an object fly there over many frames, so nothing here speaks for a slot that crosses a
 * line gradually.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-3deb.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { withOmittedRet } from "../../machine.js";
import { serviceSlotByHeadByte } from "../serviceSlotByHeadByte.js";
import { loc_3deb as oracle } from "../../translated/loc_3deb.js";
import { flyAlongStoredVelocity } from "../flyAlongStoredVelocity.js";
import { hasReachedRetireLine } from "../hasReachedRetireLine.js";
import { retireSlot } from "../retireSlot.js";
import { retireSlotIntoSharedCooldown } from "../retireSlotIntoSharedCooldown.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x3deb;
const ALL_ONES = 255;
const COOLDOWN_BYTE = 14;
const SECOND_AXIS = 49;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

/** Measured: the widest divergence below the entry stack pointer, over the corpus and the cross. */
const SCRATCH_BYTES = 2;

/**
 * A CEILING on the registers that may differ, not a pin. Membership is asserted as a subset, so a
 * rewrite that happens to agree on one of these still passes; what is asserted positively is that
 * SP, pc and the two index registers are NOT in it.
 */
const MAY_MOVE = ["a", "f", "d", "e", "h", "l", "b", "c"];
const HELD = ["ix", "iy", "sp"];

const CORPUS_FRAMES = 2500;
const SESSIONS = [
  ["demo", { tape: [] }],
  ["coin-start", {}],
];
/** Measured over CORPUS_FRAMES. The coin-then-start tape does not reach this entry at all. */
const DISPATCHES = { demo: 1379, "coin-start": 0 };

/**
 * Measured: the dead stack bytes a whole wired demo session leaves differing, and the span they
 * have to lie in. The rewrite spends no cycles, so the interrupt lands between different
 * instructions and its pushed bytes come to rest at a different depth; they are popped again
 * before any frame is sampled, and what survives is residue under the live stack.
 */
const SESSION_SCRATCH = [0xaffd, 0xaffe];
const STACK_FLOOR = 0xaf00;
const STACK_TOP = 0xb000;

/** Coordinates crossed against the all-ones head, chosen to straddle both retire lines. */
const COLUMNS = [0, 2, 3, 4, 5, 6, 130, 254, 255];
const ROWS = [0, 100, 246, 247, 248, 249, 250, 255];

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

/** The candidate as an assembled run reaches it: through the seam that supplies the omitted return. */
const seam = (candidate) => withOmittedRet(candidate, TARGET);

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

const inScratch = (addr, sp) => addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;

/** Oracle vs seam-wrapped candidate on two clones: masked RAM, then SP, then pc. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  seam(candidate)(b);
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  if (a.regs.sp !== b.regs.sp) return { addr: null, key: "sp", a: a.regs.sp, b: b.regs.sp };
  if (a.pc !== b.pc) return { addr: null, key: "pc", a: a.pc, b: b.pc };
  return null;
}

let entry = null;
function entryState() {
  if (entry === null) {
    const m = makeMachine(
      new Map([[TARGET, (mm) => {
        if (entry === null) entry = mm.clone();
        return oracle(mm);
      }]]),
      { tape: [] },
    );
    m.runFrames(CORPUS_FRAMES);
  }
  assert.notEqual(entry, null, "vacuous: the demo session never reached the routine");
  return entry;
}

/** A real captured machine with the head byte, and optionally the two coordinates, forced. */
function craft(head, column, row) {
  const m = entryState().clone();
  m.mem8[m.regs.ix] = head;
  if (column !== undefined) m.mem8[m.regs.iy] = column;
  if (row !== undefined) m.mem8[(m.regs.iy + SECOND_AXIS) & 0xffff] = row;
  return m;
}

let crossCache = null;
function cross() {
  if (crossCache) return crossCache;
  const out = [];
  for (let head = 0; head < 256; head++) out.push([head, undefined, undefined]);
  for (const column of COLUMNS) for (const row of ROWS) out.push([ALL_ONES, column, row]);
  crossCache = out;
  return out;
}

const craftedCaught = (candidate) =>
  cross().filter(([h, c, r]) => unitDiff(candidate, craft(h, c, r)) !== null).length;

function replaySession(opts, candidate) {
  let dispatches = 0;
  let caught = 0;
  let inert = 0;
  const m = makeMachine(
    new Map([[TARGET, (mm) => {
      dispatches++;
      if (mm.mem8[mm.regs.ix] === 0) inert++;
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
    opts,
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, inert };
}

let sessionCache = null;
function sessions() {
  if (!sessionCache) {
    sessionCache = SESSIONS.map(([label, opts]) => ({ label, ...replaySession(opts, serviceSlotByHeadByte) }));
  }
  return sessionCache;
}

function wholeRunCells(candidate) {
  const base = makeMachine(null, { tape: [] });
  const baseFrames = base.runFrames(CORPUS_FRAMES);
  let fired = 0;
  const host = makeMachine(
    new Map([[TARGET, seam((mm) => (fired++, candidate(mm)))]]),
    { tape: [] },
  );
  let hostFrames = [];
  let threw = null;
  const floors = recordFrameFloors(host);
  try {
    hostFrames = host.runFrames(CORPUS_FRAMES);
  } catch (e) {
    threw = String(e).slice(0, 90);
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

/** BUG: does nothing at all, whatever the head byte says. */
function brokenNoOp() {}

/** BUG: the flying arm and the retire-now arm are the wrong way round. */
function brokenSwappedArms(m) {
  const head = m.mem8[m.regs.ix];
  if (head === 0) return;
  if (head === ALL_ONES) {
    retireSlotIntoSharedCooldown(m);
    return;
  }
  flyAlongStoredVelocity(m);
  if (hasReachedRetireLine(m)) retireSlotIntoSharedCooldown(m);
}

/** BUG: every non-zero head retires at once, so nothing ever flies. */
function brokenNeverFlies(m) {
  if (m.mem8[m.regs.ix] === 0) return;
  retireSlotIntoSharedCooldown(m);
}

/** BUG: a flown object is retired whether or not it reached a line. */
function brokenRetiresUnconditionally(m) {
  const head = m.mem8[m.regs.ix];
  if (head === 0) return;
  if (head !== ALL_ONES) {
    retireSlotIntoSharedCooldown(m);
    return;
  }
  flyAlongStoredVelocity(m);
  retireSlotIntoSharedCooldown(m);
}

/** BUG: a flown object is never retired, so it drifts past the line and stays. */
function brokenNeverRetiresAfterFlying(m) {
  const head = m.mem8[m.regs.ix];
  if (head === 0) return;
  if (head !== ALL_ONES) {
    retireSlotIntoSharedCooldown(m);
    return;
  }
  flyAlongStoredVelocity(m);
}

/** BUG: the plain retire is used, so the slot goes out without the shared byte stocked. */
function brokenPlainRetire(m) {
  const head = m.mem8[m.regs.ix];
  if (head === 0) return;
  if (head !== ALL_ONES) {
    retireSlot(m);
    return;
  }
  flyAlongStoredVelocity(m);
  if (hasReachedRetireLine(m)) retireSlot(m);
}

/** BUG: the empty head is serviced like any other, so a free slot is retired again. */
function brokenServicesTheEmptyHead(m) {
  const head = m.mem8[m.regs.ix];
  if (head !== ALL_ONES) {
    retireSlotIntoSharedCooldown(m);
    return;
  }
  flyAlongStoredVelocity(m);
  if (hasReachedRetireLine(m)) retireSlotIntoSharedCooldown(m);
}

/** Measured: how many of the crafted entries each twin is caught on. */
const TWINS = [
  ["no-op", brokenNoOp, 327],
  ["swapped-arms", brokenSwappedArms, 327],
  ["never-flies", brokenNeverFlies, 73],
  ["retires-unconditionally", brokenRetiresUnconditionally, 31],
  ["never-retires-after-flying", brokenNeverRetiresAfterFlying, 42],
  ["plain-retire", brokenPlainRetire, 296],
  ["services-the-empty-head", brokenServicesTheEmptyHead, 1],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("CORPUS SHAPE: what each session presents, and that all of it is the inert arm", { skip }, () => {
  const seen = sessions();
  for (const s of seen) {
    assert.equal(s.dispatches, DISPATCHES[s.label], `the ${s.label} dispatch count moved`);
    assert.equal(s.inert, s.dispatches, `${s.label} now presents a non-zero head byte, so the real ` +
      "corpus is no longer inert and this file's account of why the crafted cross carries it is stale");
  }
  const total = seen.reduce((n, s) => n + s.dispatches, 0);
  assert.ok(total > 0, "vacuous: no session reaches the routine at all");
  console.log(`  CORPUS SHAPE: ${seen.map((s) => `${s.label} ${s.dispatches}`).join("; ")}, all inert`);
});

test("EQUAL at the real dispatch: RAM, SP and pc all identical", { skip }, () => {
  const e = entryState();
  const sp = e.regs.sp;
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  seam(serviceSlotByHeadByte)(b);
  const strays = allDiffs(a, b).filter((d) => !inScratch(d.addr, sp));
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.equal(a.regs.sp, b.regs.sp, "the stack pointer must come back to the same seat");
  assert.equal(a.pc, b.pc, "the seam must land pc on the address the caller's slot held");
  console.log(`  EQUAL: slot ${hex4(e.regs.ix)} head ${e.mem8[e.regs.ix]}; sp ${hex4(a.regs.sp)} pc ${hex4(a.pc)}`);
});

test("VACUOUS AT THE REAL ENTRY: a do-nothing twin PASSES there, as recorded", { skip }, () => {
  assert.equal(
    entryState().mem8[entryState().regs.ix],
    0,
    "the captured entry's head byte is no longer zero, so the real dispatch may now have teeth; " +
      "re-derive this file rather than leaning on the crafted cross alone",
  );
  assert.equal(
    unitDiff(brokenNoOp, entryState()),
    null,
    "the do-nothing twin is now CAUGHT at the real entry — good news, but this file documents the " +
      "opposite and must be rewritten",
  );
  console.log("  VACUOUS AT THE REAL ENTRY: head byte zero, the empty candidate passes");
});

test("NOT VACUOUS CRAFTED: the same comparison catches the do-nothing twin", { skip }, () => {
  const caught = craftedCaught(brokenNoOp);
  assert.ok(caught > 0, "the crafted cross passed a candidate that does nothing, so it is not a gate");
  console.log(`  NOT VACUOUS CRAFTED: the empty candidate is caught on ${caught} of ${cross().length}`);
});

test("SEAM: SP and pc agree on every crafted entry and every real dispatch", { skip }, () => {
  for (const [head, column, row] of cross()) {
    const m = craft(head, column, row);
    const sp = m.regs.sp;
    const a = m.clone();
    const b = m.clone();
    oracle(a);
    seam(serviceSlotByHeadByte)(b);
    assert.equal(b.regs.sp, a.regs.sp, `head ${head} col ${column} row ${row}: the seam left SP adrift`);
    assert.equal(b.pc, a.pc, `head ${head} col ${column} row ${row}: the seam left pc adrift`);
    assert.equal(a.regs.sp, (sp + 2) & 0xffff, `head ${head}: the oracle did not net exactly one return`);
  }
  for (const s of sessions()) assert.equal(s.caught, 0, `${s.label} diverged`);
  console.log(`  SEAM: ${cross().length} crafted entries and every real dispatch place identically`);
});

test("EXCLUDED: the registers that move, bounded by a ceiling; SP, pc and the slots are held", { skip }, () => {
  const moved = new Set();
  for (const [head, column, row] of cross()) {
    const m = craft(head, column, row);
    const a = m.clone();
    const b = m.clone();
    oracle(a);
    seam(serviceSlotByHeadByte)(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
    for (const k of HELD) assert.equal(b.regs[k], a.regs[k], `head ${head}: ${k} must be held`);
  }
  const list = REG_FIELDS.filter((k) => moved.has(k));
  for (const k of list) assert.ok(MAY_MOVE.includes(k), `${k} moved and is not on the ceiling`);
  console.log(`  EXCLUDED (measured): ${list.join(", ")} — ceiling ${MAY_MOVE.join(", ")}`);
});

test("EXHAUSTIVE: all 256 head bytes, and the coordinate cross, are identical", { skip }, () => {
  for (const [head, column, row] of cross()) {
    const d = unitDiff(serviceSlotByHeadByte, craft(head, column, row));
    assert.equal(d, null, `head ${head} col ${column} row ${row}: ${show(d)}`);
  }
  console.log(`  EXHAUSTIVE: ${cross().length} crafted entries identical`);
});

test("ARMS: the cross reaches all four outcomes, not just the inert one", { skip }, () => {
  let inert = 0;
  let retiredAtOnce = 0;
  let flewAndStayed = 0;
  let flewAndRetired = 0;
  for (const [head, column, row] of cross()) {
    const before = craft(head, column, row);
    const after = before.clone();
    oracle(after);
    const wrote = allDiffs(before, after).some((d) => d.addr !== null && !inScratch(d.addr, before.regs.sp));
    const stocked = after.mem8[(after.regs.ix + COOLDOWN_BYTE) & 0xffff];
    if (head === 0) {
      assert.equal(wrote, false, "the empty head must write nothing at all");
      inert++;
    } else if (head !== ALL_ONES) {
      assert.equal(after.mem8[after.regs.ix], 0, `head ${head} must retire the slot at once`);
      retiredAtOnce++;
    } else if (after.mem8[after.regs.ix] === 0) {
      flewAndRetired++;
    } else {
      assert.ok(wrote, "a flown object must move even when it does not reach a line");
      flewAndStayed++;
    }
    if (after.mem8[after.regs.ix] === 0 && head !== 0) {
      assert.equal(stocked, after.mem8[0xa8f6], "a retired slot must go out holding the shared byte");
    }
  }
  assert.ok(inert > 0 && retiredAtOnce > 0 && flewAndStayed > 0 && flewAndRetired > 0, "an arm is unreached");
  console.log(
    `  ARMS: inert ${inert}, retired at once ${retiredAtOnce}, flew and stayed ${flewAndStayed}, ` +
      `flew and retired ${flewAndRetired}`,
  );
});

test("CORPUS: every dispatch of both sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  console.log(`  CORPUS: ${total} real dispatches, identical outside the window`);
});

test("WHOLE-MACHINE: a wired demo session differs only in dead stack bytes", { skip }, () => {
  const r = wholeRunCells(serviceSlotByHeadByte);
  assert.equal(r.threw, null, `the run threw: ${r.threw}`);
  assert.equal(r.stopped, null, `the run stopped early (${r.stopped})`);
  assert.equal(r.frames, CORPUS_FRAMES, `compared ${r.frames} of ${CORPUS_FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  for (const cell of r.cells) {
    assert.ok(cell >= STACK_FLOOR && cell < STACK_TOP, `${hex4(cell)} is not a stack address`);
  }
  assert.deepEqual(r.cells, SESSION_SCRATCH, "the set of dead stack bytes a whole run leaves " +
    "differing moved, so the exclusion is no longer the measured one");
  console.log(`  WHOLE-MACHINE: ${r.fired} dispatches, only ${r.cells.map(hex4).join(" ")} differ`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    const caught = craftedCaught(twin);
    assert.ok(caught > 0, `the crafted cross missed the ${label} twin everywhere`);
    assert.equal(caught, expected, `the ${label} twin's crafted catch count moved`);
    console.log(`  TEETH/${label}: caught on ${caught} of ${cross().length} crafted entries`);
  });
}

test("TEETH: the whole-machine arm is BLIND to a do-nothing twin, and says so", { skip }, () => {
  // The demo session presents nothing but the inert arm, so a candidate that does nothing
  // produces the same RAM the oracle does on every one of its dispatches. What the whole-machine
  // arm proves here is that the seam places the dispatch and the run survives, not that the logic
  // is right; the crafted cross is what holds the logic.
  const r = wholeRunCells(brokenNoOp);
  assert.equal(r.threw, null, `the run threw: ${r.threw}`);
  assert.ok(r.fired > 0, "vacuous: the twin never dispatched");
  const escaped = r.cells.filter((c) => !SESSION_SCRATCH.includes(c));
  assert.deepEqual(escaped, [], "the whole run now CATCHES the do-nothing twin — good news, but " +
    "this file records it as blind and must be rewritten");
  console.log(`  TEETH/whole-machine: blind to the no-op, as recorded (${r.fired} dispatches)`);
});
