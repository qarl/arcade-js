// SPDX-License-Identifier: GPL-3.0-only
/**
 * dispatchSequenceSubStepArm — equivalent to the frozen oracle at ROM 0x0F1F, under the
 * DISSOLVED-DISPATCH contract.
 *
 * WHAT IT IS. Read the sequence sub-step, keep its low nibble, run the arm that nibble names out of
 * the sixteen-word table that follows the entry, then run the fixed continuation every arm returns
 * into. The rewrite no longer parks the continuation as the arm's return slot and enters the arm
 * through the restart-vector dispatch; it switches on the nibble and calls each arm's idiomatic
 * module DIRECTLY, then calls the continuation. Every arm PLAIN-RETURNS, so nothing is pushed for it
 * and nothing is popped.
 *
 * ★ THE STACK IS STILL COMPARED, through the dispatch seam. In production this entry is reached
 *   through the game's `withOmittedRet` seam, which supplies the `ret` the rewrite omits. Every
 *   candidate here is run THROUGH that seam, so the exit stack pointer and the exit program counter
 *   are compared exactly against the oracle's — the oracle's continuation rets into the caller's slot,
 *   the seam does the same for the rewrite. A rewrite that left a pushed word behind (the missing- or
 *   extra-push class, invisible to a memory diff because the stray word lands in dead scratch) makes
 *   the seam THROW, and a thrown seam is a fault on one side only, which fails every arm below. The
 *   SP-TOOTH test proves this directly with a mutant that keeps the old parked return slot.
 *
 * ★ THE ONE LICENSED DIVERGENCE is a dead band of stack scratch just below the exit stack pointer.
 *   The oracle reaches its arm through a chain of nested calls that push and pop return addresses
 *   under the arm's frame, and its arms are the frozen transcriptions; the rewrite calls idiomatic
 *   arms, whose own sub-calls reach the stack to different depths. Transient scratch, dead the moment
 *   the routine returns. The band is MEASURED as an exact ceiling (CORPUS asserts it), the SCRATCH arm
 *   proves it is really there and that nothing escapes it, and the TEETH prove it is not over-broad.
 *
 * GATE: unit-capture at the first real dispatch, a replayed corpus of every dispatch of two sessions
 *   (coin-then-start and the undriven attract), a sweep of all sixteen slots and of the selector's
 *   whole byte, an idle-state arm that makes the continuation observable, an SP tooth, and teeth.
 *
 * HOLE: the sweeps force the selector off one captured machine, so an arm the sessions never select
 * runs against a state it would not really see; where that faults it is asserted only to fault
 * IDENTICALLY on both sides, never to be correct.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0f1f.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { dispatchSequenceSubStepArm } from "../dispatchSequenceSubStepArm.js";
import { PLAY_ACTIVE, SEQUENCE_SUBSTEP } from "../names.js";
import { loc_0f1f as oracle } from "../../translated/loc_0f1f.js";
import { withOmittedRet } from "../../machine.js";
import { deadStackBelow, seamPlaceable } from "../../../../core/equivalence.js";

const TARGET = 0x0f1f;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const ARM_TABLE = 0x0f29;
const ARM_MASK = 0x0f;
const ARM_COUNT = ARM_MASK + 1;
const AFTER_ARM = 0x0f54;
/**
 * Bytes below the exit stack pointer the dead scratch reaches: MEASURED as the widest divergence any
 * dispatch of the two sessions produces, and asserted as an EXACT ceiling in CORPUS.
 */
const WINDOW = 20;
const CORPUS_FRAMES = 2500;
const TAPES = [
  ["driven", {}],
  ["attract", { tape: [] }],
];
const DISPATCHES = { driven: 1945, attract: 1711 };
/**
 * The second cell the continuation tests, after the play flag. With play active the continuation
 * returns at once and writes nothing, so nothing can tell whether it ran; the IDLE arm clears the
 * play flag and sets this one, which is the state in which it writes.
 */
const SECOND_TEST_CELL = 0xa986;

let entry = null;
let dispatches = 0;

function entryState() {
  if (entry === null) {
    const ov = new Map([
      [TARGET, (mm) => {
        dispatches++;
        if (entry === null) entry = mm.clone();
        return oracle(mm);
      }],
    ]);
    makeMachine(ov).runFrames(ENTRY_FRAMES);
    assert.notEqual(entry, null, `0x0f1f never entered within ${ENTRY_FRAMES} frames`);
  }
  return entry;
}

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (ds) =>
  ds.length === 0 ? "identical" : ds.slice(0, 8).map((d) => `${hex4(d.addr)}(${d.a}/${d.b})`).join(" ");

/** The candidate as production reaches it: through the dispatch seam, which supplies its `ret`. */
const seated = (candidate) => withOmittedRet(candidate, TARGET);

/**
 * Run the oracle and the SEATED candidate on clones of one machine and report everything the contract
 * needs: the raw byte difference, the difference outside the dead band, the exit stack pointer and
 * program counter of each side, how each side faulted, and whether the comparison has any POWER —
 * `informative` is the oracle's own footprint outside the band, which a do-nothing candidate would be
 * caught by.
 */
function diffOf(candidate, machine) {
  const before = machine.dumpState();
  const a = machine.clone();
  const b = machine.clone();
  let faultA = null;
  let faultB = null;
  try { oracle(a); } catch (e) { faultA = e.constructor.name; }
  try { seated(candidate)(b); } catch (e) { faultB = e.constructor.name; }
  const exitSp = a.regs.sp;
  const dead = deadStackBelow({ lo: exitSp - WINDOW, hi: exitSp }, machine.regs.sp); // cut at the entry SP
  const outside = (addr) => !dead(addr);
  const da = a.dumpState();
  const db = b.dumpState();
  const raw = [];
  let informative = false;
  for (let off = 0; off < da.length; off++) {
    const addr = a.stateOffsetToAddr(off);
    if (da[off] !== db[off]) raw.push({ addr, a: da[off], b: db[off] });
    if (da[off] !== before[off] && outside(addr)) informative = true;
  }
  const masked = raw.filter((d) => outside(d.addr));
  const faulted = faultA !== null || faultB !== null;
  const stackMoved = !faulted && (a.regs.sp !== b.regs.sp || a.pc !== b.pc);
  return {
    raw,
    masked,
    informative,
    exitSp,
    spB: b.regs.sp,
    pcA: a.pc,
    pcB: b.pc,
    faultA,
    faultB,
    faulted,
    stackMoved,
    caught: faulted ? faultA !== faultB : masked.length > 0 || stackMoved,
  };
}

function craft(index, idle = false) {
  const m = entryState().clone();
  if (index !== undefined) m.mem8[SEQUENCE_SUBSTEP] = index;
  if (idle) {
    m.mem8[PLAY_ACTIVE] = 0;
    m.mem8[SECOND_TEST_CELL] = 1;
  }
  return m;
}

// ── the replayed sessions ───────────────────────────────────────────────────────────────

function replaySession(opts, candidate) {
  let count = 0;
  let caught = 0;
  let widest = 0;
  let escaped = 0;
  const nibbles = new Set();
  const m = makeMachine(
    new Map([[TARGET, (mm) => {
      count++;
      nibbles.add(mm.mem8[SEQUENCE_SUBSTEP] & ARM_MASK);
      const r = diffOf(candidate, mm);
      if (r.caught) caught++;
      if (!r.faulted) {
        for (const d of r.raw) {
          if (d.addr === null || d.addr >= r.exitSp) escaped++;
          else widest = Math.max(widest, r.exitSp - d.addr);
        }
      }
      return oracle(mm); // the host proceeds on the oracle
    }]]),
    opts,
  );
  let frames = [];
  let threw = null;
  try {
    frames = m.runFrames(CORPUS_FRAMES);
  } catch (e) {
    threw = String(e).slice(0, 80);
  }
  return {
    dispatches: count,
    caught,
    widest,
    escaped,
    nibbles,
    stopped: threw ?? (m.stoppedBy === null ? null : String(m.stoppedBy).slice(0, 80)),
    short: frames.length !== CORPUS_FRAMES,
  };
}

let sessionCache = null;
function sessions() {
  if (!sessionCache) {
    sessionCache = TAPES.map(([label, opts]) => ({ label, ...replaySession(opts, dispatchSequenceSubStepArm) }));
  }
  return sessionCache;
}

// ── broken twins ────────────────────────────────────────────────────────────────────────

// Each twin is built from the SAME translated pieces the oracle reaches — the arm at a table slot,
// entered by a machine call over a parked continuation, then the continuation — so a twin's catch
// reflects ONLY the bug injected, never idiomatic-vs-translated noise.
const armThenAfter = (index) => (m) => {
  m.push16(AFTER_ARM);
  m.call(m.mem16[ARM_TABLE + 2 * index]);
  m.call(AFTER_ARM);
};

/** BUG: does nothing — neither the arm nor the continuation. */
function brokenNoOp() {}

/** BUG: takes the next entry of the table. */
function brokenNextArm(m) {
  armThenAfter((m.mem8[SEQUENCE_SUBSTEP] + 1) & ARM_MASK)(m);
}

/** BUG: runs the arm and stops, never reaching the continuation. */
function brokenSkipsAfter(m) {
  m.push16(AFTER_ARM);
  m.call(m.mem16[ARM_TABLE + 2 * (m.mem8[SEQUENCE_SUBSTEP] & ARM_MASK)]);
}

/** BUG: masks one bit too wide, so half the selectors index past the table. */
function brokenWideMask(m) {
  armThenAfter(m.mem8[SEQUENCE_SUBSTEP] & 0x1f)(m);
}

/** BUG: always runs the first arm, whatever the selector. */
function brokenFixedFirstArm(m) {
  armThenAfter(0)(m);
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["next-arm", brokenNextArm],
  ["skips-after", brokenSkipsAfter],
  ["wide-mask", brokenWideMask],
  ["fixed-first-arm", brokenFixedFirstArm],
];

/**
 * SP MUTANT: the rewrite exactly, but still parking the continuation as a return slot the way the
 * undissolved dispatch did. Every arm now plain-returns, so nothing pops that word: it is left on the
 * stack, in dead scratch where a memory diff cannot see it. Only the seam can.
 */
function mutantKeepsParkedSlot(m) {
  m.push16(AFTER_ARM);
  dispatchSequenceSubStepArm(m);
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("DISPATCHED: the tape reaches the routine, repeatedly", { skip }, () => {
  const e = entryState();
  assert.ok(dispatches > 1, `only ${dispatches} dispatch(es): this is not the live path`);
  console.log(
    `  DISPATCHED: ${dispatches} times in ${ENTRY_FRAMES} frames; captured with selector ` +
      `${e.mem8[SEQUENCE_SUBSTEP] & ARM_MASK}`,
  );
});

test("EQUAL at the real dispatch: masked RAM, exit SP and exit pc identical", { skip }, () => {
  const r = diffOf(dispatchSequenceSubStepArm, craft());
  assert.equal(r.faultA, null, `the oracle faulted (${r.faultA})`);
  assert.equal(r.faultB, null, `the seated rewrite faulted (${r.faultB})`);
  assert.deepEqual(r.masked, [], `RAM diverged outside the dead window — ${show(r.masked)}`);
  assert.equal(r.spB, r.exitSp, `exit SP ${hex4(r.spB)} vs the oracle's ${hex4(r.exitSp)}`);
  assert.equal(r.pcB, r.pcA, `exit pc ${hex4(r.pcB)} vs the oracle's ${hex4(r.pcA)}`);
  console.log(`  EQUAL: masked RAM identical, exit ${hex4(r.exitSp)}/${hex4(r.pcA)}; raw ${show(r.raw)}`);
});

test("NOT VACUOUS: the same comparison catches a candidate that does nothing", { skip }, () => {
  assert.ok(diffOf(brokenNoOp, craft()).caught, "the masked diff passed a do-nothing candidate");
});

test("SP-TOOTH: the seam places the rewrite, and REFUSES one that leaves a parked slot", { skip }, () => {
  let placed = 0;
  for (let i = 0; i < ARM_COUNT; i++) {
    const good = seamPlaceable(withOmittedRet, dispatchSequenceSubStepArm, TARGET, craft(i));
    const oracleFaults = diffOf(dispatchSequenceSubStepArm, craft(i)).faultA !== null;
    if (oracleFaults) continue;
    assert.equal(good.placeable, true, `slot ${i}: the seam could not place the rewrite — ${good.error}`);
    const bad = seamPlaceable(withOmittedRet, mutantKeepsParkedSlot, TARGET, craft(i));
    assert.equal(bad.placeable, false, `slot ${i}: the seam placed a rewrite that leaves a word on the stack`);
    placed++;
  }
  assert.ok(placed > 0, "no slot completed, so the seam was never asked to place anything");
  const escapes = diffOf(mutantKeepsParkedSlot, craft());
  assert.ok(escapes.caught, "the comparison passed the parked-slot mutant — the seam is not in the loop");
  console.log(`  SP-TOOTH: ${placed} completing slots placed; the parked-slot mutant refused on every one`);
});

test("SCRATCH: the whole raw difference lies below the exit pointer, inside the window", { skip }, () => {
  let deepest = 0;
  let seen = 0;
  for (let i = 0; i < ARM_COUNT; i++) {
    const r = diffOf(dispatchSequenceSubStepArm, craft(i));
    if (r.faulted) continue;
    for (const d of r.raw) {
      assert.ok(d.addr < r.exitSp, `slot ${i}: ${hex4(d.addr)} is at or above the exit pointer`);
      deepest = Math.max(deepest, r.exitSp - d.addr);
      seen++;
    }
  }
  assert.ok(seen > 0, "no raw difference at all: the mask is not measuring anything");
  assert.ok(
    deepest <= WINDOW,
    `the deepest difference is ${deepest} bytes below the exit pointer, past the ${WINDOW}-` +
      "byte window this file masks — widen it deliberately, do not let it drift",
  );
  console.log(`  SCRATCH: ${seen} differing bytes, deepest ${deepest} below the exit pointer, window ${WINDOW}`);
});

test("ARMS: every table entry runs identically, or faults identically", { skip }, () => {
  const faulted = [];
  let informative = 0;
  for (const idle of [false, true]) {
    for (let i = 0; i < ARM_COUNT; i++) {
      const r = diffOf(dispatchSequenceSubStepArm, craft(i, idle));
      if (r.informative) informative++;
      if (r.faulted) {
        assert.equal(r.faultA, r.faultB, `slot ${i}: ${r.faultA} on one side, ${r.faultB} on the other`);
        faulted.push(`${idle ? "idle " : ""}${i}`);
        continue;
      }
      assert.deepEqual(r.masked, [], `slot ${i}${idle ? " (idle)" : ""}: ${show(r.masked)}`);
      assert.equal(r.stackMoved, false, `slot ${i}: exit ${hex4(r.spB)}/${hex4(r.pcB)} vs ${hex4(r.exitSp)}/${hex4(r.pcA)}`);
    }
  }
  assert.ok(faulted.length < 2 * ARM_COUNT, "every arm faulted: this sweep proves nothing");
  assert.ok(informative > 0, "no swept arm wrote anything outside the window");
  console.log(
    `  ARMS: ${ARM_COUNT} slots x live/idle, ${faulted.length} faulting identically ` +
      `(${faulted.join(", ") || "none"}), ${informative} writing real memory`,
  );
});

test("SELECTOR: the high nibble is ignored, over the cell's whole range", { skip }, () => {
  for (let v = 0; v < 256; v++) {
    const r = diffOf(dispatchSequenceSubStepArm, craft(v));
    if (r.faulted) {
      assert.equal(r.faultA, r.faultB, `selector ${v}: ${r.faultA} vs ${r.faultB}`);
    } else {
      assert.deepEqual(r.masked, [], `selector ${v}: ${show(r.masked)}`);
      assert.equal(r.stackMoved, false, `selector ${v}: the exit stack pointer or pc moved`);
    }
  }
  console.log("  SELECTOR: 256 values identical — only the low nibble can matter");
});

test("IDLE ARM: with play inactive the continuation stops doing nothing", { skip }, () => {
  const busy = diffOf(brokenSkipsAfter, craft(0, false));
  const idle = diffOf(brokenSkipsAfter, craft(0, true));
  assert.deepEqual(
    busy.masked,
    [],
    "the continuation now writes while play is active, so this arm's premise is gone and the " +
      "skips-after twin should be gated on the live entry instead",
  );
  assert.ok(idle.masked.length > 0, "the continuation writes nothing even with play inactive");
  console.log(`  IDLE ARM: inert while play is active, live with it clear — ${show(idle.masked)}`);
});

test("CORPUS: every dispatch of both sessions replays identically", { skip }, () => {
  let widest = 0;
  for (const s of sessions()) {
    assert.ok(s.dispatches > 0, `vacuous: the ${s.label} session never reached the routine`);
    assert.equal(s.stopped, null, `the ${s.label} session stopped early: ${s.stopped}`);
    assert.equal(s.short, false, `the ${s.label} session ran short`);
    assert.equal(s.dispatches, DISPATCHES[s.label], `the ${s.label} dispatch count moved`);
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    assert.equal(s.escaped, 0, `${s.label}: a difference reached or passed the exit pointer`);
    widest = Math.max(widest, s.widest);
    console.log(
      `  CORPUS/${s.label}: ${s.dispatches} dispatches, slots ` +
        `${[...s.nibbles].sort((x, y) => x - y).join(",")}, widest scratch ${s.widest}`,
    );
  }
  assert.equal(
    widest,
    WINDOW,
    "the widest scratch divergence moved, so the window is the wrong size — it is asserted as an " +
      "exact ceiling precisely so a change shows up here rather than being absorbed",
  );
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT outside the window`, { skip }, () => {
    const caught = [];
    for (const idle of [false, true]) {
      for (let v = 0; v < 256; v++) {
        if (diffOf(twin, craft(v, idle)).caught) caught.push(`${idle ? "idle " : ""}${v}`);
      }
    }
    assert.ok(
      caught.length > 0,
      `the comparison PASSED the ${label} twin on every selector — either the twin is not ` +
        "broken or the window has swallowed the evidence",
    );
    console.log(`  TEETH/${label}: caught on ${caught.length} selectors, first ${caught[0]}`);
  });
}
