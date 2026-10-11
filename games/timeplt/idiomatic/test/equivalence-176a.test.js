// SPDX-License-Identifier: GPL-3.0-only
/**
 * paintReadoutsThenSampleWitnessOrDerail — memory-equivalent to the frozen oracle at ROM 0x176a.
 *
 * GATE: strict unit-capture over every dispatch of an undriven attract session, one MEASURED stack
 *   window, a crafted wrong-glyph derail, a crafted tamper-sample readback, and teeth.
 *
 * ★ WHERE THE LIVE-OUT COMES FROM. The routine is not reached by any `call` in the image; it is a
 *   table-dispatched sequence arm whose two transfers both leave through the return the dispatcher
 *   parked — the wrong-glyph derail into derailIntoMotherShipWreckCountdown (0x459b) and the tail step
 *   through advanceSequenceSubStep (0x0f1a). Each successor reloads every register it uses before
 *   reading one, so NO register is live out and the live-out is memory only. The register ceiling
 *   below is wide for that reason, not because the rewrite is untidy.
 *
 * ★ THE ORACLE PUSHES AND THE REWRITE DOES NOT. The oracle reaches its callees (checkColours,
 *   postCommand, paint, the tail step, and — on the derail — the mother-ship handler) through the
 *   registry, seating return words below the entry seat that the direct-called rewrite never seats.
 *   The window is MEASURED — the WINDOW arm instruments the oracle's own `push16` over this file's
 *   whole sweep — never assumed and never copied from another gate.
 *
 * ★ BOTH DERAILS ARE COMPARED AT THE TRANSFER. The wrong-glyph derail enters the wreck countdown's
 *   misaligned prologue (0x459b) and the colour guard's enters a caption record run as code (0x49fa);
 *   neither has a routine form, so the rewrite raises NotImplemented where the transfer would begin.
 *   The oracle is stopped on entry to the landing (test/_tamperDerail.js), and the two sides must
 *   reach the SAME landing after the SAME work outside the window. On the genuine image neither is
 *   taken: this arm runs only after the copyright screen is built and its line re-flashed every frame
 *   in its two colours, and the "K" at 0xa67c is that line's third glyph in both records.
 *
 * What it exercises, holes stated:
 *   1. CORPUS   — every dispatch of an undriven attract session, replayed from its own captured
 *                 machine, identical outside the measured window.
 *   2. WINDOW   — the oracle's own deepest push, measured over the whole sweep and PINNED.
 *   3. BOUNDARY — a planted divergence one byte BELOW the window is caught, one AT the seat is
 *                 caught, one INSIDE is masked. The third shows the first two are not the
 *                 instrument catching everything.
 *   4. DERAIL   — the glyph cell is forced OFF its expected value on a real captured machine; both
 *                 sides reach the 0x459b derail landing and agree outside the window up to it.
 *   5. SAMPLE   — on the clean path the sampled glyph/colour pair is marked and read back out of
 *                 the tamper witness cells by value, and the sequence index is shown to step.
 *   6. TEETH    — broken twins with their exact catch counts.
 *
 * HOLE: the five callees are gated by their own files. What this file gates is that they are
 * reached, in order, on the right branch — and which cells the sampling reads and writes.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-176a.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { paintReadoutsThenSampleWitnessOrDerail } from "../paintReadoutsThenSampleWitnessOrDerail.js";
import { checkTheCopyrightLineColoursOrDerail } from "../checkTheCopyrightLineColoursOrDerail.js";
import { derailIntoMotherShipWreckCountdown } from "../derailIntoMotherShipWreckCountdown.js";
import { postCommand } from "../postCommand.js";
import { paintFiveLabelledNumericReadouts } from "../paintFiveLabelledNumericReadouts.js";
import { advanceSequenceSubStep } from "../advanceSequenceSubStep.js";
import { loc_176a as oracle } from "../../translated/loc_176a.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { stopAtDerails, faultClass } from "./_tamperDerail.js";
import {
  TAMPER_GLYPH_SOURCE_CELL,
  TAMPER_SAMPLE_GLYPH_CELL,
  TAMPER_SAMPLE_COLOUR_CELL,
  TAMPER_GLYPH_READBACK,
  TAMPER_COLOUR_READBACK,
  SEQUENCE_SUBSTEP,
  COMMAND_RING,
} from "../names.js";

const TARGET = 0x176a;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const EXPECTED_GLYPH = 0x7c;
const WRITE_CURSOR = 0xa9b2;
const FREE = 255;

/** No register is live out (see header), so the whole main register file may differ. CEILING. */
const MOVED = REG_FIELDS.slice();

/**
 * A glyph the char plane can hold that no copyright COLOUR cell holds (colours are guarded to
 * 0x10/0x05). The COLOUR source cell 0xa1dc is one of the guarded copyright-line colour cells, so
 * it is NEVER poked — its real value (0x10 or 0x05) is read back instead, and GLYPH_MARK differs
 * from both so the one-plane twin is visible.
 */
const GLYPH_MARK = 0x5b;
/** A sentinel the readback destinations cannot already hold, so the copy is provably fresh. */
const READBACK_SENTINEL = 0xa4;

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => {
  if (!d) return "identical";
  return d.addr === null
    ? `${d.reg}: oracle=${d.a} candidate=${d.b}`
    : `${hex4(d.addr)}: oracle=${d.a} candidate=${d.b}`;
};

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

/** The masked window: the bytes the oracle's own pushes reach below the entry seat, and no others. */
const inScratch = (addr, sp, width) => addr !== null && addr >= sp - width && addr < sp;

/**
 * Oracle vs candidate on clones of `machine`: the whole dump masked to the measured window, then
 * every register outside the ceiling. Only the candidate's side is wrapped, because a raise from
 * the oracle is a harness fault and must not be swallowed.
 */
function unitDiff(candidate, machine, width) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  try {
    candidate(b);
  } catch (e) {
    return { addr: null, reg: "raised", a: "returned", b: String(e).slice(0, 40) };
  }
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp, width));
  if (ram) return ram;
  for (const k of REG_FIELDS) {
    if (MOVED.includes(k)) continue;
    if (a.regs[k] !== b.regs[k]) return { addr: null, reg: k, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

/**
 * Outcome comparison for the two DERAIL branches. The oracle is stopped on entry to a tamper landing
 * and the rewrite raises there (see the header), so the OUTCOMES must agree — both reach the same
 * landing, or both return — and memory must agree outside the window either way, since both stop at
 * the same program point. A twin that skips a derail RETURNS where the oracle stops — caught. Any
 * other fault on either side is reported as itself, never as a derail. Returns the diff (null when
 * equal) and the landing both sides reached.
 */
function outcomeDiff(candidate, machine, width) {
  const sp = machine.regs.sp;
  const a = stopAtDerails(machine.clone());
  const b = machine.clone();
  let ra = null;
  let rb = null;
  try { oracle(a); } catch (e) { ra = faultClass(e); }
  try { candidate(b); } catch (e) { rb = faultClass(e); }
  if (ra !== rb) {
    return { addr: null, reg: "outcome", a: ra ? `raised(${ra})` : "returned", b: rb ? `raised(${rb})` : "returned" };
  }
  if (ra !== null && !ra.startsWith("derail@")) {
    return { addr: null, reg: "outcome", a: `raised(${ra})`, b: `raised(${rb})` };
  }
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp, width));
  if (ram) return ram;
  if (ra !== null) return null; // stopped at the transfer: the registers are the landing's, not a live-out
  for (const k of REG_FIELDS) {
    if (MOVED.includes(k)) continue;
    if (a.regs[k] !== b.regs[k]) return { addr: null, reg: k, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

/** Which landing the ORACLE reaches from `machine`, or null if it returns. */
function oracleLanding(machine) {
  try { oracle(stopAtDerails(machine.clone())); } catch (e) { return faultClass(e); }
  return null;
}

/** How far below its seat the oracle's own pushes take the stack pointer, on one entry state. */
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

// ── the captured corpus ─────────────────────────────────────────────────────────────────

let corpus = null;

/** One pristine machine per dispatch of an undriven attract session. Nothing is poked. */
function captureCorpus() {
  if (corpus) return corpus;
  const entries = [];
  const m = makeMachine(new Map([[TARGET, (mm) => {
    entries.push(mm.clone());
    return oracle(mm);
  }]]), { tape: [] });
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `corpus run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "corpus run ran short");
  assert.ok(entries.length > 0, "vacuous: attract never reached the routine");
  corpus = entries;
  return corpus;
}

/** The measured stack window, taken over the whole corpus and pinned by the WINDOW arm. */
let WINDOW = null;
function windowBytes() {
  if (WINDOW !== null) return WINDOW;
  let deepest = 0;
  for (const m of captureCorpus()) deepest = Math.max(deepest, oracleDepth(m));
  WINDOW = deepest;
  return WINDOW;
}

// ── broken twins ────────────────────────────────────────────────────────────────────────
// Each is the module with one thing wrong, built the way the module is built — direct calls to
// the idiomatic callees, so a twin's stack traffic matches the rewrite's and the mask is honest.

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: never checks the copyright colours, so a tampered image is not derailed. */
function brokenNoColourGuard(m) {
  const { mem8 } = m;
  if (mem8[TAMPER_GLYPH_SOURCE_CELL] !== EXPECTED_GLYPH) { derailIntoMotherShipWreckCountdown(m); return; }
  postCommand(m, 0x01, 0x13);
  paintFiveLabelledNumericReadouts(m);
  mem8[TAMPER_GLYPH_READBACK] = mem8[TAMPER_SAMPLE_GLYPH_CELL];
  mem8[TAMPER_COLOUR_READBACK] = mem8[TAMPER_SAMPLE_COLOUR_CELL];
  advanceSequenceSubStep(m);
}

/** BUG: never queues the caption command. */
function brokenNoCaption(m) {
  const { mem8 } = m;
  checkTheCopyrightLineColoursOrDerail(m);
  if (mem8[TAMPER_GLYPH_SOURCE_CELL] !== EXPECTED_GLYPH) { derailIntoMotherShipWreckCountdown(m); return; }
  paintFiveLabelledNumericReadouts(m);
  mem8[TAMPER_GLYPH_READBACK] = mem8[TAMPER_SAMPLE_GLYPH_CELL];
  mem8[TAMPER_COLOUR_READBACK] = mem8[TAMPER_SAMPLE_COLOUR_CELL];
  advanceSequenceSubStep(m);
}

/** BUG: never repaints the readouts. */
function brokenNoPaint(m) {
  const { mem8 } = m;
  checkTheCopyrightLineColoursOrDerail(m);
  if (mem8[TAMPER_GLYPH_SOURCE_CELL] !== EXPECTED_GLYPH) { derailIntoMotherShipWreckCountdown(m); return; }
  postCommand(m, 0x01, 0x13);
  mem8[TAMPER_GLYPH_READBACK] = mem8[TAMPER_SAMPLE_GLYPH_CELL];
  mem8[TAMPER_COLOUR_READBACK] = mem8[TAMPER_SAMPLE_COLOUR_CELL];
  advanceSequenceSubStep(m);
}

/** BUG: samples the colour from the glyph plane, so the witness keeps two glyphs. */
function brokenSampleOnePlane(m) {
  const { mem8 } = m;
  checkTheCopyrightLineColoursOrDerail(m);
  if (mem8[TAMPER_GLYPH_SOURCE_CELL] !== EXPECTED_GLYPH) { derailIntoMotherShipWreckCountdown(m); return; }
  postCommand(m, 0x01, 0x13);
  paintFiveLabelledNumericReadouts(m);
  mem8[TAMPER_GLYPH_READBACK] = mem8[TAMPER_SAMPLE_GLYPH_CELL];
  mem8[TAMPER_COLOUR_READBACK] = mem8[TAMPER_SAMPLE_GLYPH_CELL];
  advanceSequenceSubStep(m);
}

/** BUG: never steps the sequence on, so the arm stalls after its work. */
function brokenNoAdvance(m) {
  const { mem8 } = m;
  checkTheCopyrightLineColoursOrDerail(m);
  if (mem8[TAMPER_GLYPH_SOURCE_CELL] !== EXPECTED_GLYPH) { derailIntoMotherShipWreckCountdown(m); return; }
  postCommand(m, 0x01, 0x13);
  paintFiveLabelledNumericReadouts(m);
  mem8[TAMPER_GLYPH_READBACK] = mem8[TAMPER_SAMPLE_GLYPH_CELL];
  mem8[TAMPER_COLOUR_READBACK] = mem8[TAMPER_SAMPLE_COLOUR_CELL];
}

/** BUG: ignores the wrong-glyph derail and does the clean work regardless. */
function brokenNoDerail(m) {
  const { mem8 } = m;
  checkTheCopyrightLineColoursOrDerail(m);
  postCommand(m, 0x01, 0x13);
  paintFiveLabelledNumericReadouts(m);
  mem8[TAMPER_GLYPH_READBACK] = mem8[TAMPER_SAMPLE_GLYPH_CELL];
  mem8[TAMPER_COLOUR_READBACK] = mem8[TAMPER_SAMPLE_COLOUR_CELL];
  advanceSequenceSubStep(m);
}

// no-colour-guard is not here: on a clean state the colour guard is a pure no-op (it only derails
// on a tampered colour), so it is memory-invisible and gets its own crafted bad-colour arm below.
const CLEAN_TWINS = [
  ["no-op", brokenNoOp],
  ["no-caption", brokenNoCaption],
  ["no-paint", brokenNoPaint],
  ["sample-one-plane", brokenSampleOnePlane],
  ["no-advance", brokenNoAdvance],
];

/**
 * The BOUNDARY arm's probe: the ORACLE ITSELF, plus one byte flipped at `sp + offset`. Built on
 * the oracle so what the arm reports is a property of the MASK alone.
 */
function scribbler(offset) {
  return (m) => {
    const at = (m.regs.sp + offset) & 0xffff;
    oracle(m);
    m.mem8[at] ^= 0xff;
  };
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("WINDOW: the oracle's own deepest push, measured over the whole corpus", { skip }, () => {
  const w = windowBytes();
  console.log(`  WINDOW (measured): the oracle reaches ${w} bytes below its seat`);
  assert.ok(w >= 0 && w < 0x100, "the measured stack window is implausible");
});

test("CORPUS: every captured dispatch replays identically outside the window", { skip }, () => {
  const entries = captureCorpus();
  const w = windowBytes();
  let clean = 0;
  for (const e of entries) {
    const d = unitDiff(paintReadoutsThenSampleWitnessOrDerail, e, w);
    assert.equal(d, null, `dispatch ${clean}: ${show(d)}`);
    // Every real dispatch is the clean path: the glyph holds its expected value.
    assert.equal(e.mem8[TAMPER_GLYPH_SOURCE_CELL], EXPECTED_GLYPH, "a real dispatch was off the clean path");
    clean++;
  }
  console.log(`  CORPUS: ${entries.length} dispatches, identical outside the ${w}-byte window`);
});

test("BOUNDARY: the exclusion is exactly as wide as it declares", { skip }, () => {
  const at = captureCorpus()[0].clone();
  const w = windowBytes();
  const sp = at.regs.sp;
  const below = unitDiff(scribbler(-w - 1), at, w);
  const seat = unitDiff(scribbler(0), at, w);
  const inside = w > 0 ? unitDiff(scribbler(-1), at, w) : null;
  console.log(
    `  BOUNDARY: ${hex4(sp - w - 1)} caught, ${hex4(sp)} caught` +
      (w > 0 ? `, ${hex4(sp - 1)} masked` : " (window is zero-wide)"),
  );
  assert.notEqual(below, null, "a divergence one byte BELOW the window was swallowed");
  assert.notEqual(seat, null, "a divergence AT the entry seat was swallowed");
  if (w > 0) assert.equal(inside, null, "a divergence INSIDE the window was caught, so the two " +
    "catches above are the instrument catching everything rather than the boundary being real");
});

test("DERAIL: a wrong glyph transfers into the mother-ship handler on both sides", { skip }, () => {
  const w = windowBytes();
  // Force the glyph off its expected value on a real captured machine: the oracle must reach the
  // 0x459b derail landing (the probe proves the transfer, not merely a crash), and the rewrite must
  // raise there after the same work — see outcomeDiff.
  const badGlyphs = [0x00, 0x7d, 0xff, EXPECTED_GLYPH ^ 0x01];
  for (const bad of badGlyphs) {
    const e = captureCorpus()[0].clone();
    e.mem8[TAMPER_GLYPH_SOURCE_CELL] = bad;
    assert.equal(oracleLanding(e), "derail@0x459b", `glyph=${hex4(bad)}: the oracle did not reach 0x459b`);
    const d = outcomeDiff(paintReadoutsThenSampleWitnessOrDerail, e, w);
    assert.equal(d, null, `glyph=${hex4(bad)}: ${show(d)}`);
  }
  console.log(`  DERAIL: ${badGlyphs.length} wrong-glyph values, both sides stop at 0x459b after the same work`);
});

test("SAMPLE: the clean path marks and reads back the tamper witness pair", { skip }, () => {
  const e = captureCorpus()[0].clone();
  assert.equal(e.mem8[TAMPER_GLYPH_SOURCE_CELL], EXPECTED_GLYPH, "corpus[0] is not on the clean path");
  // Only the glyph plane is marked; the colour cell 0xa1dc is guarded, so read its real value.
  e.mem8[TAMPER_SAMPLE_GLYPH_CELL] = GLYPH_MARK;
  const realColour = e.mem8[TAMPER_SAMPLE_COLOUR_CELL];
  e.mem8[TAMPER_GLYPH_READBACK] = READBACK_SENTINEL;
  e.mem8[TAMPER_COLOUR_READBACK] = READBACK_SENTINEL;
  assert.notEqual(GLYPH_MARK, realColour, "the glyph mark collides with the real colour");
  // free the ring ahead of the cursor so the caption pair actually lands
  const cursor = e.mem8[WRITE_CURSOR];
  for (let i = 0; i < 4; i++) e.mem8[COMMAND_RING + ((cursor + i) & 63)] = FREE;
  const stepBefore = e.mem8[SEQUENCE_SUBSTEP];
  paintReadoutsThenSampleWitnessOrDerail(e);
  assert.equal(e.mem8[TAMPER_GLYPH_READBACK], GLYPH_MARK, "the glyph must be copied from the char plane");
  assert.equal(e.mem8[TAMPER_COLOUR_READBACK], realColour, "the colour must be copied from the colour plane");
  assert.equal(e.mem8[SEQUENCE_SUBSTEP], (stepBefore + 1) & 0xff, "the sequence must step on the clean path");
  const after = e.mem8[WRITE_CURSOR];
  const tail = [2, 1].map((back) => e.mem8[COMMAND_RING + ((after - back) & 63)]);
  assert.deepEqual(tail, [0x01, 0x13], "the queued caption pair must be command 1, argument 0x13");
  console.log(`  SAMPLE: glyph ${GLYPH_MARK} and colour ${realColour} read back, caption 1/0x13 queued, sequence stepped`);
});

test("TEETH: the no-derail twin is CAUGHT on a wrong glyph", { skip }, () => {
  const w = windowBytes();
  const e = captureCorpus()[0].clone();
  e.mem8[TAMPER_GLYPH_SOURCE_CELL] = 0x00; // wrong glyph: the oracle derails (raises), the twin returns
  const cursor = e.mem8[WRITE_CURSOR];
  for (let i = 0; i < 4; i++) e.mem8[COMMAND_RING + ((cursor + i) & 63)] = FREE;
  const d = outcomeDiff(brokenNoDerail, e, w);
  console.log(`  TEETH/no-derail: ${show(d)}`);
  assert.notEqual(d, null, "the twin that skips the wrong-glyph derail was not caught");
});

test("TEETH: the no-colour-guard twin is CAUGHT on a bad colour", { skip }, () => {
  // A guarded copyright colour cell (0xa1dc, the sample colour source) forced OFF 0x10/0x05 makes
  // the colour guard transfer into its caption-record landing (0x49fa). The glyph is left correct so
  // the ONLY difference is the missing guard. The oracle must reach that landing, the rewrite must
  // stop there after the same work, and the guardless twin — which returns — must be caught.
  const w = windowBytes();
  const e = captureCorpus()[0].clone();
  assert.equal(e.mem8[TAMPER_GLYPH_SOURCE_CELL], EXPECTED_GLYPH, "corpus[0] is not on the clean path");
  e.mem8[TAMPER_SAMPLE_COLOUR_CELL] = 0x00; // 0xa1dc: neither 0x10 nor 0x05 -> guard derails
  const cursor = e.mem8[WRITE_CURSOR];
  for (let i = 0; i < 4; i++) e.mem8[COMMAND_RING + ((cursor + i) & 63)] = FREE;
  assert.equal(oracleLanding(e), "derail@0x49fa", "the oracle did not reach the colour guard's landing");
  const rewrite = outcomeDiff(paintReadoutsThenSampleWitnessOrDerail, e, w);
  assert.equal(rewrite, null, `the rewrite disagreed on a bad colour: ${show(rewrite)}`);
  const d = outcomeDiff(brokenNoColourGuard, e, w);
  console.log(`  TEETH/no-colour-guard: ${show(d)}`);
  assert.notEqual(d, null, "the twin that skips the colour guard was not caught");
});

for (const [label, twin] of CLEAN_TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip }, () => {
    const w = windowBytes();
    let caught = 0;
    let firstAt = null;
    for (const e of captureCorpus()) {
      const primed = e.clone();
      // Only the glyph plane is marked; 0xa1dc is a guarded colour cell and must keep its value.
      primed.mem8[TAMPER_SAMPLE_GLYPH_CELL] = GLYPH_MARK;
      primed.mem8[TAMPER_GLYPH_READBACK] = READBACK_SENTINEL;
      primed.mem8[TAMPER_COLOUR_READBACK] = READBACK_SENTINEL;
      const cursor = primed.mem8[WRITE_CURSOR];
      for (let i = 0; i < 4; i++) primed.mem8[COMMAND_RING + ((cursor + i) & 63)] = FREE;
      const d = unitDiff(twin, primed, w);
      if (d === null) continue;
      caught++;
      if (firstAt === null) firstAt = show(d);
    }
    console.log(`  TEETH/${label}: caught at ${caught} dispatches — ${firstAt}`);
    assert.ok(caught > 0, `the masked comparison PASSED the ${label} twin at every dispatch`);
  });
}
