// SPDX-License-Identifier: GPL-3.0-only
/**
 * dispatchSequencePhase2SubStepArm — equivalent to the frozen oracle at ROM 0x17FE, under the
 * DISSOLVED-DISPATCH contract.
 *
 * WHAT IT IS. Read the inner sequence step and run the arm that index names out of the word table
 * that follows this entry. The index is taken RAW; the doubling that reaches a two-byte entry wraps
 * at eight bits, so an index and that index plus 128 pick the same slot — the low seven bits are what
 * chooses. The rewrite no longer computes the arm's address and enters it through the restart-vector
 * dispatch; it switches on the low seven bits of the index and calls the arm's idiomatic module
 * DIRECTLY. That module PLAIN-RETURNS — it does not pop a return address, and its own sub-calls are
 * ordinary JS calls, not machine calls that push and pop. So the two sides here NO LONGER share an
 * exit stack pointer or an exit program counter, and neither is compared: with the dispatch dissolved,
 * the arm's return is supplied at the seam in production, and the contract that remains is the WORK
 * MEMORY the arm and its sub-calls leave.
 *
 * ★ HOW THE LIVE-OUT WAS DERIVED, and it is from the ORACLE. The oracle's exit successor is the ARM
 *   (this mode's shared tail does nothing at all): whatever the arm writes to memory is this entry's
 *   product. Registers are NOT part of the contract — the arm plain-returns and leaves whatever its
 *   body leaves — so the live-out is the arm's work-memory footprint, and the gate runs the arms
 *   rather than stopping at the address it would have computed.
 *
 * ★ THE ONE PLACE THE TWO SIDES DIVERGE is a dead band of stack scratch, 0xAFE2..0xAFE7, and it is
 *   MASKED. The oracle enters the arm through a chain that pushes and pops nested return addresses
 *   into those bytes; the rewrite calls the arm directly and never writes them. Those bytes lie below
 *   the stack pointer both sides leave, so they are transient stack scratch, dead the moment the arm
 *   returns — a difference confined to them is not a difference in any value the game goes on to use.
 *   The SCRATCH test proves the mask is not blind: divergence really does appear inside the band (so
 *   the instrument can see it), and NOTHING escapes it (so outside the band the two sides are
 *   byte-identical). The TEETH prove the mask is not over-broad: a wrong arm writes real work memory
 *   outside the band and is caught.
 *
 * GATE: strict unit-capture over the shared coin-then-start tape, plus crafted selectors off each
 *   live arm; the memory comparison masks only the dead scratch band above.
 *
 * HOLE: the session presents four of the table's slots (0..3). The rest are crafted, and from an
 * entry state their arm would not really see; where such an arm faults it is asserted only to fault
 * IDENTICALLY on both sides, never to be correct.
 * HOLE: only the first five slots address code this port has transcribed. The rewrite raises the
 * same fault the dispatch would for the slots beyond them, and the sweep records that both sides
 * fault the same way — a statement about the dispatch, not about those words.
 * HOLE: the index is taken RAW, so the crafted sweep is scoped to the table's own slots (0..7) and
 * the same slots reached through the eight-bit wrap (128..135). Indices between those two runs select
 * bytes further down the image that are not part of this table; what the oracle does there is outside
 * this entry's contract and is not asserted.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-17fe.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { dispatchSequencePhase2SubStepArm } from "../dispatchSequencePhase2SubStepArm.js";
import { SEQUENCE_SUBSTEP } from "../names.js";
import { loc_17fe as oracle } from "../../translated/loc_17fe.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const TARGET = 0x17fe;
const ARM_TABLE = 0x1806;
// Only the low seven bits pick a slot: the doubling that reaches a two-byte entry wraps at eight bits.
const ENTRY_MASK = 0x7f;
// The table's own slots, before the words run into caption data further down the image.
const ARM_COUNT = 8;
// The same slots reached again through the eight-bit wrap — index + this lands on slot index.
const WRAP_OFFSET = 128;

/**
 * The dead stack-scratch band the frozen chain writes nested return addresses into and the
 * dissolved rewrite never touches. It lies below the stack pointer both sides leave — transient
 * scratch, dead the moment the arm returns — so a difference confined to it is not a difference in
 * any value the game reads. Masked from the memory comparison; the SCRATCH test proves the band is
 * real and that nothing escapes it. Measured across every crafted arm off both live entries.
 */
const SCRATCH_LO = 0xafe2;
const SCRATCH_HI = 0xafe7;

const CORPUS_FRAMES = 2500;
const DISPATCHES = 100;
/**
 * selector -> how many of the session's dispatches presented it, and how many of those are
 * INFORMATIVE: the arm wrote something a do-nothing candidate would be caught by. The entry kept
 * per selector is the first informative one, because a capture at an inert dispatch would leave
 * every crafted arm below resting on a comparison with no power. Measured; a move is a finding.
 */
const SELECTOR_SPREAD = [[0, 1], [1, 27], [2, 1], [3, 71]];
const SELECTOR_INFORMATIVE = [[0, 1], [1, 27], [2, 1], [3, 71]];
const LIVE_SELECTORS = SELECTOR_SPREAD.map(([s]) => s);

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (ds) =>
  ds.length === 0 ? "identical" : ds.map((d) => `${hex4(d.addr)}(${d.a}/${d.b})`).join(" ");

// ── the session ─────────────────────────────────────────────────────────────────────────

/** One captured entry per selector the session really presents, plus the session's own tallies. */
let corpus = null;

function runSession(candidate) {
  const entries = new Map();
  const spread = new Map();
  const informative = new Map();
  const moved = new Set();
  let dispatches = 0;
  let caught = 0;
  const m = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    const selector = mm.mem8[SEQUENCE_SUBSTEP] & ENTRY_MASK;
    spread.set(selector, (spread.get(selector) ?? 0) + 1);
    const r = diffOf(candidate, mm);
    if (r.informative) {
      informative.set(selector, (informative.get(selector) ?? 0) + 1);
      if (!entries.has(selector)) entries.set(selector, mm.clone());
    }
    for (const k of r.moved) moved.add(k);
    if (r.caught) caught++;
    return oracle(mm);
  }]]));
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `the session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "the session ran short");
  return { entries, spread, informative, moved, dispatches, caught };
}

function session() {
  if (corpus === null) corpus = runSession(dispatchSequencePhase2SubStepArm);
  assert.notEqual(corpus.dispatches, 0, "vacuous: the session never reached the routine");
  return corpus;
}

const entryFor = (selector) => {
  const e = session().entries.get(selector);
  assert.notEqual(e, undefined, `the session no longer presents selector ${selector}`);
  return e;
};

/**
 * Run both sides on clones of one machine and report EVERYTHING: the raw byte difference, the
 * difference outside the dead window, how each side faulted, the registers that moved, and whether
 * the comparison has any POWER here — `informative` is the oracle's own masked footprint against the
 * untouched entry, which is exactly what a do-nothing candidate would be caught by. It costs one
 * extra dump rather than a second emulation.
 */
function diffOf(candidate, machine) {
  const before = machine.dumpState();
  const a = machine.clone();
  const b = machine.clone();
  let faultA = null;
  let faultB = null;
  try { oracle(a); } catch (e) { faultA = e.constructor.name; }
  try { candidate(b); } catch (e) { faultB = e.constructor.name; }
  const moved = faultA || faultB ? [] : REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);

  const da = a.dumpState();
  const db = b.dumpState();
  const exitSp = a.regs.sp;
  // The only place the dissolved rewrite may differ from the oracle is the dead stack-scratch band;
  // everything else is the live contract. `outside` is what the memory comparison actually enforces.
  const dead = deadStackBelow({ lo: SCRATCH_LO, hi: SCRATCH_HI + 1 }, machine.regs.sp); // cut at the entry SP
  const outside = (addr) => !dead(addr);
  const raw = [];
  let informative = false;
  for (let off = 0; off < da.length; off++) {
    const addr = a.stateOffsetToAddr(off);
    if (da[off] !== db[off]) raw.push({ addr, a: da[off], b: db[off] });
    if (da[off] !== before[off] && outside(addr)) informative = true;
  }
  const masked = raw.filter((d) => outside(d.addr));
  const faulted = faultA !== null || faultB !== null;
  return {
    raw,
    masked,
    informative,
    moved,
    exitSp,
    spB: b.regs.sp,
    pcA: a.pc,
    pcB: b.pc,
    faultA,
    faultB,
    faulted,
    caught: faulted ? faultA !== faultB : masked.length > 0,
  };
}

/** A clone of a real entry with the selector forced. */
function craft(selector, base = entryFor(LIVE_SELECTORS[0])) {
  const m = base.clone();
  m.mem8[SEQUENCE_SUBSTEP] = selector;
  return m;
}

function sweepCaught(candidate) {
  let caught = 0;
  for (const live of LIVE_SELECTORS) {
    for (let i = 0; i < ARM_COUNT; i++) {
      if (diffOf(candidate, craft(i, entryFor(live))).caught) caught++;
    }
  }
  return caught;
}

const SWEEP_SIZE = LIVE_SELECTORS.length * ARM_COUNT;

// ── the twins ───────────────────────────────────────────────────────────────────────────

const armAt = (index) => (m) => m.call(m.mem16[ARM_TABLE + 2 * index]);
const armFrom = (table, mask) => (m) =>
  m.call(m.mem16[table + 2 * (m.mem8[SEQUENCE_SUBSTEP] & mask)]);

/** BUG: does nothing — neither the lookup nor the arm. */
function brokenNoOp() {}

/** BUG: takes the next slot of the table. */
function brokenNextArm(m) {
  m.call(m.mem16[ARM_TABLE + 2 * ((m.mem8[SEQUENCE_SUBSTEP] + 1) & ENTRY_MASK)]);
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["next-arm", brokenNextArm],
  ["fixed-first-arm", armAt(0)],
  ["table-off-by-one-entry", armFrom(ARM_TABLE + 2, ENTRY_MASK)],
  ["table-misaligned", armFrom(ARM_TABLE + 1, ENTRY_MASK)],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("DISPATCHED: the session reaches this entry, presenting a measured spread", { skip }, () => {
  const s = session();
  assert.equal(s.dispatches, DISPATCHES, "the dispatch count moved");
  assert.deepEqual(
    [...s.spread.entries()].sort((a, b) => a[0] - b[0]),
    SELECTOR_SPREAD,
    "the spread of selectors the session presents moved",
  );
  assert.deepEqual(
    [...s.informative.entries()].sort((a, b) => a[0] - b[0]),
    SELECTOR_INFORMATIVE,
    "the share of dispatches at which the arm writes anything moved",
  );
  console.log(
    `  DISPATCHED: ${s.dispatches} times, selectors ` +
      `${[...s.spread].map(([k, v]) => `${k}x${v}`).join(" ")}; informative ` +
      `${[...s.informative].map(([k, v]) => `${k}x${v}`).join(" ")}`,
  );
});

test("EQUAL at every real dispatch: masked RAM identical on each live selector", { skip }, () => {
  for (const selector of LIVE_SELECTORS) {
    const r = diffOf(dispatchSequencePhase2SubStepArm, entryFor(selector));
    assert.equal(r.faultA, null, `selector ${selector}: the oracle faulted (${r.faultA})`);
    assert.equal(r.faultB, null, `selector ${selector}: the rewrite faulted (${r.faultB})`);
    assert.deepEqual(r.masked, [], `selector ${selector}: ${show(r.masked)}`);
    console.log(
      `  EQUAL: selector ${selector}, exit pointer ${hex4(r.exitSp)}, raw difference ` +
        show(r.raw),
    );
  }
});

test("NOT VACUOUS: a candidate that does nothing FAILS the same comparison", { skip }, () => {
  for (const selector of LIVE_SELECTORS) {
    const r = diffOf(brokenNoOp, entryFor(selector));
    assert.ok(r.caught, `selector ${selector}: the comparison passed a candidate that does nothing`);
  }
  const r = diffOf(brokenNoOp, entryFor(LIVE_SELECTORS[0]));
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(r.masked)}`);
});

test("SCRATCH: divergence is confined to the dead band, and the band is really there", { skip }, () => {
  // The mask is only honest if BOTH of these hold. If nothing ever differed in the band, the mask
  // would be hiding a phantom and proving nothing; if a difference escaped the band, the rewrite
  // would be diverging in live memory and the mask would be swallowing the evidence.
  let rawInBand = 0;
  let lo = 0x10000;
  let hi = 0;
  for (const live of LIVE_SELECTORS) {
    for (let i = 0; i < ARM_COUNT; i++) {
      const r = diffOf(dispatchSequencePhase2SubStepArm, craft(i, entryFor(live)));
      // Nothing escapes the band: outside the dead scratch the two sides are byte-identical.
      assert.deepEqual(r.masked, [], `selector ${i}: a difference escaped the band — ${show(r.masked)}`);
      for (const d of r.raw) {
        assert.ok(
          d.addr >= SCRATCH_LO && d.addr <= SCRATCH_HI,
          `selector ${i}: ${hex4(d.addr)} differs outside the masked band`,
        );
        lo = Math.min(lo, d.addr);
        hi = Math.max(hi, d.addr);
        rawInBand++;
      }
    }
  }
  // The band is not a phantom: the two sides really do differ inside it (the chain writes the dead
  // return-address bytes, the direct call does not), so the instrument can see into what it masks.
  assert.ok(rawInBand > 0, "no byte ever differed in the band: the mask is hiding nothing real, so " +
    "masking it is unjustified — the two sides may simply be register-for-register identical here");
  console.log(
    `  SCRATCH: ${rawInBand} differing bytes, all within [${hex4(SCRATCH_LO)}..${hex4(SCRATCH_HI)}] ` +
      `(seen ${hex4(lo)}..${hex4(hi)}); nothing escaped the band`,
  );
});

test("CORPUS: every dispatch of the session replays identically", { skip }, () => {
  const s = session();
  assert.equal(s.caught, 0, "the rewrite diverged on a real dispatch");
  console.log(`  CORPUS: ${s.dispatches} real dispatches, none diverging`);
});

test("ARMS: every table slot runs identically, or faults identically", { skip }, () => {
  const faulted = new Set();
  let informative = 0;
  for (const live of LIVE_SELECTORS) {
    for (let i = 0; i < ARM_COUNT; i++) {
      const r = diffOf(dispatchSequencePhase2SubStepArm, craft(i, entryFor(live)));
      if (r.informative) informative++;
      if (r.faulted) {
        assert.equal(r.faultA, r.faultB, `arm ${i}: ${r.faultA} on one side, ${r.faultB} on the other`);
        faulted.add(`${live}/${i}`);
        continue;
      }
      assert.deepEqual(r.masked, [], `arm ${i}: ${show(r.masked)}`);
    }
  }
  assert.ok(
    faulted.size < ARM_COUNT * LIVE_SELECTORS.length,
    "every arm faulted, on both entries: this sweep proves nothing",
  );
  assert.ok(informative > 0, "no swept arm wrote anything outside the window, so `identical` here " +
    "is a comparison with no power rather than a result");
  console.log(`  ARMS: ${ARM_COUNT} slots off ${LIVE_SELECTORS.length} real entries, ` +
    `${faulted.size} faulting identically on both sides, ${informative} writing anything`);
});

test("WRAP: the eighth bit does not choose — a slot and that slot plus 128 behave alike", { skip }, () => {
  // The doubling that reaches a two-byte entry wraps at eight bits, so only the low seven bits pick a
  // slot. Sweep each slot at its face value and again 128 higher, off every live entry, and require
  // the two sides to agree the same way at both — running identically where the slot names an arm and
  // faulting identically where it does not. Scoped to the table's own slots and their wrapped twins;
  // the indices between select bytes outside this table and are not this entry's contract.
  let pairs = 0;
  for (const live of LIVE_SELECTORS) {
    for (let i = 0; i < ARM_COUNT; i++) {
      const lowR = diffOf(dispatchSequencePhase2SubStepArm, craft(i, entryFor(live)));
      const wrapR = diffOf(dispatchSequencePhase2SubStepArm, craft(i + WRAP_OFFSET, entryFor(live)));
      if (lowR.faulted) {
        assert.equal(lowR.faultA, lowR.faultB, `slot ${i}: ${lowR.faultA} vs ${lowR.faultB}`);
      } else {
        assert.deepEqual(lowR.masked, [], `slot ${i}: ${show(lowR.masked)}`);
      }
      assert.equal(wrapR.faultA, lowR.faultA, `slot ${i}+128: the oracle took a different path`);
      assert.equal(wrapR.faultB, lowR.faultB, `slot ${i}+128: the rewrite took a different path`);
      if (wrapR.faulted) {
        assert.equal(wrapR.faultA, wrapR.faultB, `slot ${i}+128: ${wrapR.faultA} vs ${wrapR.faultB}`);
      } else {
        assert.deepEqual(wrapR.masked, [], `slot ${i}+128: ${show(wrapR.masked)}`);
      }
      pairs++;
    }
  }
  console.log(`  WRAP: ${pairs} slot/slot+128 pairs behave alike — the eighth bit cannot choose`);
});

// The exit stack pointer, the exit program counter, and the set of registers that move are NO
// LONGER part of the contract and are not asserted. The dispatch is dissolved: the arm's idiomatic
// module is called directly and PLAIN-RETURNS, so the stack pointer is left where the arm found it
// (the omitted return is supplied at the seam in production) and the registers hold whatever the
// arm's body leaves. The contract that remains is work memory, checked outside the dead band above.

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT outside the band`, { skip }, () => {
    const caught = sweepCaught(twin);
    assert.ok(
      caught > 0,
      `the masked comparison PASSED the ${label} twin on every selector — either the twin is ` +
        "not broken or the band has swallowed the evidence",
    );
    console.log(`  TEETH/${label}: caught on ${caught} of ${SWEEP_SIZE} crafted selectors`);
  });
}
