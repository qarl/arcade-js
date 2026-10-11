// SPDX-License-Identifier: GPL-3.0-only
/**
 * dispatchSequencePhase1SubStepArm — equivalent to the frozen oracle at ROM 0x1651, under the
 * DISSOLVED-DISPATCH contract.
 *
 * WHAT IT IS. Read the inner sequence sub-step and run the arm that index names out of the word table
 * that follows this entry, then run this mode's shared tail. The index is taken RAW; the doubling that
 * reaches a two-byte entry wraps at eight bits, so an index and that index plus 128 pick the same slot
 * — the low seven bits are what chooses. The rewrite no longer computes the arm's address and enters
 * it through the restart-vector dispatch; it switches on the low seven bits and calls the arm's
 * idiomatic module DIRECTLY for slots 0..12, then returns the shared tail. Each arm PLAIN-RETURNS —
 * it does not pop a return address, and its sub-calls are ordinary JS calls, not machine calls that
 * push and pop. So the two sides here NO LONGER share an exit stack pointer or an exit program
 * counter, and NEITHER is compared: with the dispatch dissolved, the dispatcher's return is supplied
 * at the seam in production (withOmittedRet), and the contract that remains is the WORK MEMORY the
 * arm, its sub-calls, AND the shared tail leave.
 *
 * ★ THE SHARED TAIL IS PART OF THE CONTRACT — this is where phase 1 differs from phase 2. Phase 2's
 *   tail does nothing; phase 1's tail `advanceSequenceElseStartFreePlayGame` DOES work (it advances
 *   the sequence / may start a free-play game). The oracle runs arm THEN tail, and so does the
 *   rewrite, so whatever the tail writes to memory is compared here exactly as the oracle produces it
 *   — it is NOT masked. The skips-the-tail twin below proves this is load-bearing: dropping the tail
 *   is caught on the DRIVEN corpus, where the tail really does write live memory (0xa9ab/0xa9ac).
 *
 * ★ THE ONE PLACE THE TWO SIDES DIVERGE is a dead band of stack scratch, the SCRATCH_BYTES below the
 *   entry stack pointer, and it is MASKED. The oracle reaches the arm through a chain that brackets
 *   the lookup with pushes and pops of nested return addresses; the rewrite calls directly, so the
 *   two write different bytes below the stack pointer both sides leave — transient scratch, dead the
 *   moment the routine returns. The band is MEASURED (an exact ceiling asserted in CORPUS, so a change
 *   surfaces here rather than being absorbed). The SCRATCH test proves the mask is not blind:
 *   divergence really appears inside the band, and NOTHING escapes it. The TEETH prove the mask is not
 *   over-broad: a wrong arm — or a dropped tail — writes real work memory outside the band and is
 *   caught.
 *
 * GATE: strict unit-capture over the shared coin-then-start tape and the attract tape, a replayed
 *   corpus of every dispatch of both, a crafted sweep of the table's own slots (and their eight-bit
 *   wraps), and teeth. The memory comparison masks only the dead scratch band above.
 *
 * ★ A TAMPER TRANSFER IS COMPARED WHERE IT HAPPENS. A crafted slot can run an arm on a state its
 *   screen was never drawn for, so the arm's anti-tamper guard fails. The oracle then transfers into
 *   a landing with no routine form (the misaligned prologue 0x459b of the Mother-Ship's wreck countdown, or the caption
 *   record 0x49fa run as code) and faults somewhere inside it; the rewrite raises NotImplemented at
 *   the transfer. The oracle is stopped on entry to either landing (test/_tamperDerail.js), and the
 *   two sides must reach the SAME landing after the SAME work outside the band. A genuine image
 *   never takes these transfers; only the crafted sweep does.
 *
 * HOLE: what each arm DOES is not exercised here beyond the indices the two sessions present; crafted
 * slots are asserted only to select the SAME arm the oracle's table selects (same masked memory, or
 * the SAME fault), never to be correct.
 * HOLE: the index is taken RAW, so the crafted sweep is scoped to the table's own thirteen slots
 * (0..12) and the same slots reached through the eight-bit wrap (128..140). Indices between those two
 * runs select bytes further down the image that are NOT part of this table; the rewrite raises
 * NotImplemented for them, and while the oracle raises the same fault for most, a handful of those
 * garbage indices (low seven bits 52, 55, 58, 110, 112, 120) address bytes that happen to enter
 * mapped code and DO NOT fault. What the oracle does at those raw indices is outside this entry's
 * contract — the corpus never presents any index past 12 — and is not asserted here. (Flagged to the
 * confirmer/LEAD: this is a property of the raw index reaching non-table bytes, not of the arms.)
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-1651.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { dispatchSequencePhase1SubStepArm } from "../dispatchSequencePhase1SubStepArm.js";
import { SEQUENCE_SUBSTEP } from "../names.js";
import { loc_1651 as oracle } from "../../translated/loc_1651.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { stopAtDerails, faultClass } from "./_tamperDerail.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const TARGET = 0x1651;
const ARM_TABLE = 0x1659;
const SHARED_TAIL = 0x167b;
// Only the low seven bits pick a slot: the doubling that reaches a two-byte entry wraps at eight bits.
const ENTRY_MASK = 0x7f;
// The table's own transcribed slots (0..12), before the words run into non-routine bytes further down.
const ARM_COUNT = 13;
// The same slots reached again through the eight-bit wrap — index + this lands on slot index.
const WRAP_OFFSET = 128;
const CORPUS_FRAMES = 2500;

/**
 * The dead stack-scratch band, in bytes below the entry stack pointer: the bytes the frozen chain
 * writes nested return addresses into and the rewrite reaches to a different depth (its arms' own
 * sub-calls). It lies below the stack pointer both sides leave — transient scratch, dead the moment
 * the routine returns — so a difference confined to it is not a difference in any value the game
 * reads. MEASURED as the widest divergence any dispatch of the two sessions produces (attract reaches
 * sp-16, driven sp-12), and asserted as an EXACT ceiling in CORPUS rather than assumed. The SCRATCH
 * test proves the band is real and that nothing escapes it; the TEETH prove it is not over-broad.
 */
const SCRATCH_BYTES = 16;

const TAPES = [
  ["attract", { tape: [] }],
  ["driven", {}],
];
const DISPATCHES = { attract: 521, driven: 187 };

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (ds) =>
  ds.length === 0 ? "identical" : ds.map((d) => `${hex4(d.addr)}(${d.a}/${d.b})`).join(" ");

// ── entry capture ─────────────────────────────────────────────────────────────────────────

/**
 * The pristine machine at the instant 0x1651 is first entered off the coin-then-start tape. Captured
 * through unitEquivalence purely for its side effect; its own comparison (which still checks
 * registers and sp) is IGNORED, because those are no longer part of this dissolved contract.
 */
let entry = null;

function captureEntry() {
  if (entry === null) {
    unitEquivalence(
      makeMachine,
      TARGET,
      oracle,
      (m) => {
        if (entry === null) entry = m.clone();
        return dispatchSequencePhase1SubStepArm(m);
      },
      { maxFrames: ENTRY_FRAMES },
    );
  }
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  return entry;
}

/** A clone of the real entry with the sub-step index forced. */
function craft(index) {
  const m = captureEntry().clone();
  m.mem8[SEQUENCE_SUBSTEP] = index;
  return m;
}

// ── the comparison ──────────────────────────────────────────────────────────────────────

const inScratch = (addr, sp) => addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;

/**
 * Run both sides on clones of one machine and report everything the contract needs: the raw byte
 * difference, the difference outside the dead scratch band, how each side faulted, and whether the
 * comparison has any POWER here — `informative` is the oracle's own footprint outside the band
 * against the untouched entry, which is exactly what a do-nothing candidate would be caught by.
 * Registers, sp and pc are NOT read: the dispatch is dissolved, so they are not part of the contract.
 */
function diffOf(candidate, machine) {
  const sp = machine.regs.sp;
  const before = machine.dumpState();
  const a = stopAtDerails(machine.clone());
  const b = machine.clone();
  let faultA = null;
  let faultB = null;
  try { oracle(a); } catch (e) { faultA = faultClass(e); }
  try { candidate(b); } catch (e) { faultB = faultClass(e); }
  const da = a.dumpState();
  const db = b.dumpState();
  const outside = (addr) => !inScratch(addr, sp);
  const raw = [];
  let informative = false;
  for (let off = 0; off < da.length; off++) {
    const addr = a.stateOffsetToAddr(off);
    if (da[off] !== db[off]) raw.push({ addr, a: da[off], b: db[off] });
    if (da[off] !== before[off] && outside(addr)) informative = true;
  }
  const masked = raw.filter((d) => outside(d.addr));
  const faulted = faultA !== null || faultB !== null;
  // Both sides stopped at the same tamper transfer: that is the same program point, so the work
  // done before it must also match. Any other fault aborts mid-arm and leaves partial writes.
  const derailed = faulted && faultA === faultB && faultA.startsWith("derail@");
  return {
    raw,
    masked,
    informative,
    faultA,
    faultB,
    faulted,
    // The dead band is the ONLY licensed divergence: outside it, a fault must match a fault and a
    // byte must match a byte, or the candidate is caught.
    caught: faulted ? faultA !== faultB || (derailed && masked.length > 0) : masked.length > 0,
    derailed,
  };
}

// ── the replayed sessions ─────────────────────────────────────────────────────────────────

/** Replay a whole session, comparing the candidate to the oracle at every dispatch. */
function replaySession(opts, candidate) {
  let dispatches = 0;
  let caught = 0;
  let widest = 0;
  const indices = new Set();
  const m = makeMachine(
    new Map([[TARGET, (mm) => {
      dispatches++;
      indices.add(mm.mem8[SEQUENCE_SUBSTEP]);
      const sp = mm.regs.sp;
      const a = stopAtDerails(mm.clone());
      const b = mm.clone();
      let faultA = null;
      let faultB = null;
      try { oracle(a); } catch (e) { faultA = faultClass(e); }
      try { candidate(b); } catch (e) { faultB = faultClass(e); }
      if (faultA !== null || faultB !== null) {
        if (faultA !== faultB) caught++;
      } else {
        const da = a.dumpState();
        const db = b.dumpState();
        let stray = false;
        for (let off = 0; off < da.length; off++) {
          if (da[off] === db[off]) continue;
          const addr = a.stateOffsetToAddr(off);
          if (addr !== null && addr < sp) widest = Math.max(widest, sp - addr);
          if (!inScratch(addr, sp)) stray = true;
        }
        if (stray) caught++;
      }
      return oracle(mm); // let the host proceed on the oracle
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
    dispatches,
    caught,
    widest,
    indices,
    stopped: threw ?? (m.stoppedBy === null ? null : String(m.stoppedBy).slice(0, 80)),
    short: frames.length !== CORPUS_FRAMES,
  };
}

let sessionCache = null;
function sessions() {
  if (!sessionCache) {
    sessionCache = TAPES.map(([label, opts]) => ({
      label,
      ...replaySession(opts, dispatchSequencePhase1SubStepArm),
    }));
  }
  return sessionCache;
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

// Each twin is built from the SAME translated pieces the oracle reaches — the arm at a table slot,
// entered by a machine call, and the shared tail, likewise — so a twin's catch reflects ONLY the bug
// injected into the SELECTION or the presence of the tail, never idiomatic-vs-translated noise. A
// correct wiring (right slot, tail present) is byte-identical to the oracle outside the scratch band.
const armAt = (m, slot) => m.call(m.mem16[(ARM_TABLE + 2 * (slot & ENTRY_MASK)) & 0xffff]);

/** BUG: does nothing at all — the tell that a gate is measuring an unreached routine. */
function brokenNoOp() {}

/** BUG: always runs the first arm, whatever the index selects. */
function brokenFixedFirstArm(m) {
  armAt(m, 0);
  m.call(SHARED_TAIL);
}

/** BUG: runs the neighbouring slot's arm. */
function brokenNextArm(m) {
  armAt(m, (m.mem8[SEQUENCE_SUBSTEP] + 1) & 0xff);
  m.call(SHARED_TAIL);
}

/** BUG: reads the table one entry along, so every index selects its neighbour's arm. */
function brokenOffByOneEntry(m) {
  m.call(m.mem16[(ARM_TABLE + 2 + 2 * (m.mem8[SEQUENCE_SUBSTEP] & ENTRY_MASK)) & 0xffff]);
  m.call(SHARED_TAIL);
}

/**
 * BUG: runs the correct arm but drops the shared tail. The tail is where phase 1's work lives, so
 * this is the twin the shared-tail contract exists to catch. The attract session's states leave the
 * tail with nothing live to write, so the crafted sweep cannot see it; the DRIVEN corpus can, and the
 * dedicated teeth test below catches it there.
 */
function brokenSkipsTheTail(m) {
  armAt(m, m.mem8[SEQUENCE_SUBSTEP]);
}

const SWEEP_TWINS = [
  ["no-op", brokenNoOp],
  ["fixed-first-arm", brokenFixedFirstArm],
  ["next-arm", brokenNextArm],
  ["off-by-one-entry", brokenOffByOneEntry],
];

function sweepCaught(candidate) {
  let caught = 0;
  for (let i = 0; i < ARM_COUNT; i++) {
    if (diffOf(candidate, craft(i)).caught) caught++;
  }
  return caught;
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside the dead stack window", { skip }, () => {
  const r = diffOf(dispatchSequencePhase1SubStepArm, captureEntry());
  assert.equal(r.faultA, null, `the oracle faulted (${r.faultA})`);
  assert.equal(r.faultB, null, `the rewrite faulted (${r.faultB})`);
  assert.deepEqual(r.masked, [], `a divergence escaped the scratch window: ${show(r.masked)}`);
  console.log(
    `  EQUAL: entry index=${captureEntry().mem8[SEQUENCE_SUBSTEP]} ` +
      `sp=${hex4(captureEntry().regs.sp)}; identical outside [sp-${SCRATCH_BYTES}, sp), raw ` +
      `difference ${show(r.raw)}`,
  );
});

test("NOT VACUOUS: the same masked comparison catches a candidate that does nothing", { skip }, () => {
  const r = diffOf(brokenNoOp, captureEntry());
  assert.ok(r.caught, "the masked diff passed a do-nothing candidate, so it is not a gate");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(r.masked)}`);
});

test("SCRATCH: divergence is confined to the dead band, and the band is really there", { skip }, () => {
  // The mask is only honest if BOTH hold: something really differs in the band (else the mask hides a
  // phantom and proves nothing), and nothing escapes it (else the rewrite is diverging in live memory
  // and the mask is swallowing the evidence).
  let rawInBand = 0;
  let widest = 0;
  for (let i = 0; i < ARM_COUNT; i++) {
    const m = craft(i);
    const sp = m.regs.sp;
    const r = diffOf(dispatchSequencePhase1SubStepArm, m);
    // A slot that faults on both sides (DISPATCH asserts the fault matches) aborts partway and leaves
    // meaningless partial writes; the band is a statement about arms that RUN to completion.
    if (r.faulted) continue;
    assert.deepEqual(r.masked, [], `slot ${i}: a difference escaped the band — ${show(r.masked)}`);
    for (const d of r.raw) {
      assert.ok(inScratch(d.addr, sp), `slot ${i}: ${hex4(d.addr)} differs outside the masked band`);
      widest = Math.max(widest, sp - d.addr);
      rawInBand++;
    }
  }
  assert.ok(
    rawInBand > 0,
    "no byte ever differed in the band: masking it is unjustified — the two sides may simply be " +
      "identical here",
  );
  console.log(
    `  SCRATCH: ${rawInBand} differing bytes, all within [sp-${SCRATCH_BYTES}, sp) ` +
      `(deepest seen sp-${widest}); nothing escaped the band`,
  );
});

test("DISPATCH: each table slot selects the SAME arm-then-tail, or faults identically", { skip }, () => {
  const faulted = new Set();
  const derailed = new Set();
  let informative = 0;
  for (let i = 0; i < ARM_COUNT; i++) {
    const r = diffOf(dispatchSequencePhase1SubStepArm, craft(i));
    if (r.informative) informative++;
    if (r.faulted) {
      assert.equal(r.faultA, r.faultB, `slot ${i}: ${r.faultA} on one side, ${r.faultB} on the other`);
      if (r.derailed) {
        assert.deepEqual(r.masked, [], `slot ${i}: both reach ${r.faultA}, after different work: ${show(r.masked)}`);
        derailed.add(i);
      }
      faulted.add(i);
      continue;
    }
    assert.deepEqual(r.masked, [], `slot ${i}: ${show(r.masked)}`);
  }
  assert.ok(faulted.size < ARM_COUNT, "every slot faulted: this sweep proves nothing");
  assert.ok(
    informative > 0,
    "no swept slot wrote anything outside the window, so `identical` here is a comparison with no " +
      "power rather than a result",
  );
  console.log(
    `  DISPATCH: ${ARM_COUNT} slots, ${faulted.size} faulting identically on both sides ` +
      `(${[...faulted].sort((a, b) => a - b).join(",")}; at a tamper transfer: ` +
      `${[...derailed].sort((a, b) => a - b).join(",") || "none"}), ${informative} writing real memory`,
  );
});

test("WRAP: the eighth bit does not choose — a slot and that slot plus 128 behave alike", { skip }, () => {
  // Only the low seven bits pick a slot. Sweep each slot at face value and again 128 higher and
  // require the two sides to agree the same way at both. Scoped to the table's own slots and their
  // wrapped twins; the indices between select non-table bytes and are not this entry's contract.
  for (let i = 0; i < ARM_COUNT; i++) {
    const lowR = diffOf(dispatchSequencePhase1SubStepArm, craft(i));
    const wrapR = diffOf(dispatchSequencePhase1SubStepArm, craft(i + WRAP_OFFSET));
    assert.equal(wrapR.faultA, lowR.faultA, `slot ${i}+128: the oracle took a different path`);
    assert.equal(wrapR.faultB, lowR.faultB, `slot ${i}+128: the rewrite took a different path`);
    if (lowR.faulted) {
      assert.equal(lowR.faultA, lowR.faultB, `slot ${i}: ${lowR.faultA} vs ${lowR.faultB}`);
      assert.equal(wrapR.faultA, wrapR.faultB, `slot ${i}+128: ${wrapR.faultA} vs ${wrapR.faultB}`);
      if (lowR.derailed) assert.deepEqual(lowR.masked, [], `slot ${i}: ${show(lowR.masked)}`);
      if (wrapR.derailed) assert.deepEqual(wrapR.masked, [], `slot ${i}+128: ${show(wrapR.masked)}`);
    } else {
      assert.deepEqual(lowR.masked, [], `slot ${i}: ${show(lowR.masked)}`);
      assert.deepEqual(wrapR.masked, [], `slot ${i}+128: ${show(wrapR.masked)}`);
    }
  }
  console.log(`  WRAP: ${ARM_COUNT} slot/slot+128 pairs behave alike — the eighth bit cannot choose`);
});

test("CORPUS: every dispatch of both sessions replays identically", { skip }, () => {
  const seen = sessions();
  let total = 0;
  let widest = 0;
  for (const s of seen) {
    assert.ok(s.dispatches > 0, `vacuous: the ${s.label} tape never reached the routine`);
    assert.equal(s.stopped, null, `the ${s.label} session stopped early: ${s.stopped}`);
    assert.equal(s.short, false, `the ${s.label} session ran short`);
    assert.equal(s.dispatches, DISPATCHES[s.label], `the ${s.label} dispatch count moved`);
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
    widest = Math.max(widest, s.widest);
  }
  assert.equal(
    widest,
    SCRATCH_BYTES,
    "the widest scratch divergence moved, so the exclusion is the wrong size — it is asserted as an " +
      "exact ceiling precisely so a change shows up here rather than being absorbed",
  );
  const demo = seen.find((s) => s.label === "attract");
  console.log(
    `  CORPUS: ${total} dispatches over two sessions; demo indices ` +
      `${[...demo.indices].sort((x, y) => x - y).join(",")}; widest scratch sp-${widest}`,
  );
});

// The exit stack pointer, the exit program counter and the register file are NO LONGER part of the
// contract and are not asserted anywhere above. The dispatch is dissolved: the arm's idiomatic module
// is called directly and PLAIN-RETURNS, so the stack pointer is left where the arm found it (the
// omitted dispatcher return is supplied at the seam in production) and the registers hold whatever the
// arm and the shared tail leave. The contract that remains is work memory, checked outside the dead
// band above — and that memory includes the shared tail's writes, which both sides produce.

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin] of SWEEP_TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT on the crafted sweep`, { skip }, () => {
    const caught = sweepCaught(twin);
    assert.ok(
      caught > 0,
      `the masked comparison PASSED the ${label} twin on every slot — either the twin is not ` +
        "broken or the band has swallowed the evidence",
    );
    console.log(`  TEETH/${label}: caught on ${caught} of ${ARM_COUNT} crafted slots`);
  });
}

test("TEETH: dropping the shared tail is CAUGHT on the driven corpus", { skip }, () => {
  // The tail's memory effects are part of the contract, and the crafted attract states leave it with
  // nothing live to write. The driven tape reaches states where the tail writes real memory, so a
  // candidate that runs the right arm but skips the tail is caught there — proof the tail is not
  // absorbed by the scratch mask.
  const r = replaySession({}, brokenSkipsTheTail);
  assert.equal(r.stopped, null, `the skips-the-tail twin stopped the session: ${r.stopped}`);
  assert.ok(
    r.caught > 0,
    "the masked comparison PASSED a candidate that drops the shared tail — the tail's writes are " +
      "being masked away, so the tail is not really in the contract",
  );
  console.log(`  TEETH/skips-the-tail: caught on ${r.caught} of ${r.dispatches} driven dispatches`);
});
