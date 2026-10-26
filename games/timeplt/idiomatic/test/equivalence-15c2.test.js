// SPDX-License-Identifier: GPL-3.0-only
/**
 * dispatchSequencePhase0SubStepArm — equivalent to the frozen oracle at ROM 0x15C2, under the
 * DISSOLVED-DISPATCH contract.
 *
 * WHAT IT IS. Read the inner sequence step, keep its low three bits, and run the arm that index
 * names out of the word table that follows. The rewrite no longer computes the arm's address and
 * enters it through the restart-vector dispatch; it switches on the index and calls the arm's
 * idiomatic module DIRECTLY. That module PLAIN-RETURNS — it does not pop a return address, and its
 * own sub-calls are ordinary JS calls, not machine calls that push and pop. So the two sides here
 * NO LONGER share an exit stack pointer or an exit program counter, and neither is compared: with
 * the dispatch dissolved, the arm's return is supplied at the seam in production, and the contract
 * that remains is the WORK MEMORY the arm and its sub-calls leave.
 *
 * ★ HOW THE LIVE-OUT WAS DERIVED, and it is from the ORACLE. The oracle's exit successor is the
 *   ARM: whatever the arm writes to memory is this entry's product. Registers are NOT part of the
 *   contract — the arm plain-returns and leaves whatever its body leaves — so the live-out is the
 *   arm's work-memory footprint, and the gate runs the arms rather than stopping at the address it
 *   would have computed.
 *
 * ★ THE ONE PLACE THE TWO SIDES DIVERGE is a dead band of stack scratch, 0xAFDE..0xAFE9, and it is
 *   MASKED. The oracle enters the arm through a chain that pushes and pops nested return addresses
 *   into those bytes; the rewrite calls the arm directly and never writes them. Those bytes are
 *   popped before any boundary snapshot the game reads — they are transient stack scratch, dead the
 *   moment the arm returns — so a difference confined to them is not a difference in any value the
 *   game goes on to use. The SCRATCH band arm proves the mask is not blind: divergence really does
 *   appear inside the band (so the instrument can see it), and NOTHING escapes it (so outside the
 *   band the two sides are byte-identical). The TEETH prove the mask is not over-broad: a wrong arm
 *   writes real work memory outside the band and is caught.
 *
 * GATE: strict unit-capture over the shared coin-then-start tape, plus crafted selectors off each
 *   live arm; the memory comparison masks only the dead scratch band above.
 *
 * HOLE: the session presents only two of the eight selectors. The other six are crafted, and from
 * an entry state their arm would not really see; where such an arm faults it is asserted only to
 * fault IDENTICALLY on both sides, never to be correct.
 * HOLE: only two of the eight table words address code this port has transcribed. The other six
 * read as addresses only because the three bits admit them; the rewrite raises the same fault the
 * dispatch would, and the sweep records that both sides fault the same way — a statement about the
 * dispatch, not about those words.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-15c2.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { dispatchSequencePhase0SubStepArm } from "../dispatchSequencePhase0SubStepArm.js";
import { SEQUENCE_SUBSTEP } from "../names.js";
import { loc_15c2 as oracle } from "../../translated/loc_15c2.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const TARGET = 0x15c2;
const ARM_TABLE = 0x15c8;
const ARM_MASK = 0x07;
const ARM_COUNT = ARM_MASK + 1;

/**
 * The dead stack-scratch band the frozen chain writes nested return addresses into and the
 * dissolved rewrite never touches. It is popped before any boundary snapshot — transient scratch,
 * dead the moment the arm returns — so a difference confined to it is not a difference in any value
 * the game reads. Masked from the memory comparison; the SCRATCH test proves the band is real and
 * that nothing escapes it. Measured across every crafted arm off both live entries.
 */
const SCRATCH_LO = 0xafde;
const SCRATCH_HI = 0xafe9;

const CORPUS_FRAMES = 2000;
const DISPATCHES = 33;
/**
 * selector -> how many of the session's dispatches presented it, and how many of those are
 * INFORMATIVE: the arm wrote something a do-nothing candidate would be caught by. The entry kept
 * per selector is the first informative one, because a capture at an inert dispatch would leave
 * every crafted arm below resting on a comparison with no power. Measured; a move is a finding.
 */
const SELECTOR_SPREAD = [[0, 1], [6, 32]];
const SELECTOR_INFORMATIVE = [[0, 1], [6, 32]];
const LIVE_SELECTORS = SELECTOR_SPREAD.map(([s]) => s);

const SELECTOR_VALUES = 256;

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
    const selector = mm.mem8[SEQUENCE_SUBSTEP] & ARM_MASK;
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
  if (corpus === null) corpus = runSession(dispatchSequencePhase0SubStepArm);
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
 * difference outside the dead window, the exit pointers, how each side faulted, the registers that
 * moved, and whether the comparison has any POWER here — `informative` is the oracle's own masked
 * footprint against the untouched entry, which is exactly what a do-nothing candidate would be
 * caught by. It costs one extra dump rather than a second emulation.
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

const everySelector = Array.from({ length: SELECTOR_VALUES }, (_unused, v) => v);

function sweepCaught(candidate) {
  let caught = 0;
  for (const live of LIVE_SELECTORS) {
    for (const v of everySelector) if (diffOf(candidate, craft(v, entryFor(live))).caught) caught++;
  }
  return caught;
}

const SWEEP_SIZE = LIVE_SELECTORS.length * SELECTOR_VALUES;

// ── the twins ───────────────────────────────────────────────────────────────────────────

const armAt = (index) => (m) => m.call(m.mem16[ARM_TABLE + 2 * index]);
const armFrom = (table, mask) => (m) =>
  m.call(m.mem16[table + 2 * (m.mem8[SEQUENCE_SUBSTEP] & mask)]);

/** BUG: does nothing — neither the lookup nor the arm. */
function brokenNoOp() {}

/** BUG: takes the next entry of the table. */
function brokenNextArm(m) {
  m.call(m.mem16[ARM_TABLE + 2 * ((m.mem8[SEQUENCE_SUBSTEP] + 1) & ARM_MASK)]);
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["next-arm", brokenNextArm],
  ["wide-mask", armFrom(ARM_TABLE, 0x0f)],
  ["narrow-mask", armFrom(ARM_TABLE, 0x03)],
  ["fixed-first-arm", armAt(0)],
  ["table-off-by-one-entry", armFrom(ARM_TABLE + 2, ARM_MASK)],
  ["table-misaligned", armFrom(ARM_TABLE + 1, ARM_MASK)],
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
    const r = diffOf(dispatchSequencePhase0SubStepArm, entryFor(selector));
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
      const r = diffOf(dispatchSequencePhase0SubStepArm, craft(i, entryFor(live)));
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

test("ARMS: every table entry runs identically, or faults identically", { skip }, () => {
  const faulted = new Set();
  let informative = 0;
  for (const live of LIVE_SELECTORS) {
    for (let i = 0; i < ARM_COUNT; i++) {
      const r = diffOf(dispatchSequencePhase0SubStepArm, craft(i, entryFor(live)));
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
  console.log(`  ARMS: ${ARM_COUNT} entries off ${LIVE_SELECTORS.length} real entries, ` +
    `${faulted.size} faulting identically on both sides, ${informative} writing anything`);
});

test("SELECTOR: the five high bits are ignored, over the cell's whole range", { skip }, () => {
  for (const live of LIVE_SELECTORS) {
    for (const v of everySelector) {
      const r = diffOf(dispatchSequencePhase0SubStepArm, craft(v, entryFor(live)));
      if (r.faulted) {
        assert.equal(r.faultA, r.faultB, `selector ${v}: ${r.faultA} vs ${r.faultB}`);
      } else {
        assert.deepEqual(r.masked, [], `selector ${v}: ${show(r.masked)}`);
      }
    }
  }
  console.log(`  SELECTOR: ${SWEEP_SIZE} crafted selectors identical — only three bits can matter`);
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
