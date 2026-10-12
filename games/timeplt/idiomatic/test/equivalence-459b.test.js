// SPDX-License-Identifier: GPL-3.0-only
/**
 * derailIntoMotherShipWreckCountdown — the misaligned entry at ROM 0x459B, dissolved to a fault.
 *
 * 0x459B is entered on exactly two transfers, both anti-tamper derails: 0x176A jumps here when a
 * caption glyph read off the screen is not the genuine one, and 0x43F0 (at 0x4646) jumps here when
 * the tamper-witness pair does not hold the genuine values. Entered here, the prologue pops the
 * caller's return slot as data, steps SP by one, pops again out of step, and every exit returns
 * through a slot at an odd offset from the frame — control is destroyed rather than handed back. The
 * Mother-Ship's genuine wreck countdown is entered past this prologue (0x45B3) and is gated elsewhere.
 * So the rewrite raises NotImplemented at this entry, and this gate no longer byte-replays the body
 * that runs on a broken stack — it asserts the fault and PROVES the fault stands in for no live path:
 *
 *   THROWS    — the entry raises NotImplemented, before writing a byte, on every captured and
 *               crafted state the old gate replayed; the pre-fault form (the frozen body) is the
 *               control that this arm can fail.
 *   LANDING   — why raising is the faithful form: on every one of those states the frozen body ends
 *               with SP an ODD distance from its seat, so its return is read out of step.
 *   UNREACHED — over the coin-start tape and a long undriven run the target is never dispatched,
 *               while its two dispatchers and the drift site are (the positive controls).
 *   GENUINE   — the two guards' inputs, measured over the same runs: at every 0x176A dispatch the
 *               glyph cell holds the genuine glyph; every write to the witness pair after the boot's
 *               plant holds a genuine value, and that plant lands before the first 0x43F0 dispatch.
 *   TAMPER    — each guard is genuinely conditional: the idiomatic 0x176A arm raises THIS fault on a
 *               poked glyph (and the frozen 0x176A reaches this address), and returns on the genuine
 *               one; the idiomatic 0x4646 arm raises THIS fault on a zeroed witness and returns on
 *               each genuine witness pair.
 *
 * HOLE: GENUINE is measured over the runs named, not derived symbolically — the glyph and witness
 * cells are RAM painted and sampled at run time.
 * Run: node --test games/timeplt/idiomatic/test/equivalence-459b.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { ROUTINES as TRANSLATED } from "../../routines.js";
import { derailIntoMotherShipWreckCountdown } from "../derailIntoMotherShipWreckCountdown.js";
import { paintReadoutsThenSampleWitnessOrDerail } from "../paintReadoutsThenSampleWitnessOrDerail.js";
import { retireMotherShipAndRaiseRoundHold } from "../loc_43f0.js";
import { loc_459b as oracle } from "../../translated/loc_459b.js";
import { loc_176a as oracle176a } from "../../translated/loc_176a.js";
import { NotImplemented } from "../../../../boards/timeplt/io.js";

const TARGET = 0x459b;
const DRIFT_SITE = 0x2b60;
const GLYPH_DISPATCHER = 0x176a;
const WITNESS_DISPATCHER = 0x43f0;
const DISPATCHERS = [GLYPH_DISPATCHER, WITNESS_DISPATCHER];
const LOSE_LIFE = 0x11ed;

const GLYPH_CELL = 0xa67c;
const GENUINE_GLYPH = 0x7c;
const WITNESS = 0xab43;
const WITNESS_GLYPH = 0x7c;
const WITNESS_COLOURS = [0x10, 0x05];
const LONG_UNDRIVEN_FRAMES = 6000;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// ── captured states: the drift site the body calls, with the same object ix / sprite iy ───────────

let drifts = null;
function captureDrifts() {
  if (drifts) return drifts;
  const entries = [];
  const real = TRANSLATED.get(DRIFT_SITE);
  const m = makeMachine(new Map([[DRIFT_SITE, (mm) => {
    if (entries.length < 40) entries.push(mm.clone());
    return real(mm);
  }]]));
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the drift run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "the drift run ran short");
  assert.ok(entries.length > 0, "vacuous: the drift site was never dispatched, so there is no state");
  // A copy: clones share the capture hook, so later arms that run the frozen body would otherwise
  // keep appending to the very set they iterate.
  drifts = [...entries];
  return drifts;
}

/** A real drift-site machine with the object's state byte forced, to walk every branch. */
function craft(stateByte, mut) {
  const c = captureDrifts()[0].clone();
  c.mem8[c.regs.ix & 0xffff] = stateByte;
  if (mut) mut(c);
  return c;
}

/** The prologue's `adc a,b` carries when a popped word's high byte plus b overflow. */
function craftLoseLife() {
  const c = captureDrifts()[0].clone();
  const sp = c.regs.sp & 0xffff;
  c.regs.b = 0xff;
  c.mem8[(sp + 1) & 0xffff] = 0x00;
  c.mem8[(sp + 2) & 0xffff] = 0xff;
  return c;
}

const CRAFTS = [
  ["below-trigger", () => craft(0x30)],
  ["at-trigger", () => craft(0xb4)],
  ["at-trigger+warp", () => craft(0xb4, (c) => { c.mem8[0xa800] = 0xff; })],
  ["above-trigger", () => craft(0xc4)],
  ["spends-to-idle", () => craft(0x01)],
  ["down-to-0x5a", () => craft(0x5b)],
  ["life-loss", craftLoseLife],
];

function states() {
  return [...captureDrifts().map((m, i) => [`drift-${i}`, m]), ...CRAFTS.map(([l, make]) => [l, make()])];
}

/** Whether a side raises NotImplemented before writing anything; else what it did. */
function faultsClean(fn, machine) {
  const c = machine.clone();
  const before = c.dumpState().slice();
  try {
    fn(c);
  } catch (e) {
    if (!(e instanceof NotImplemented)) return `raised ${String(e).slice(0, 40)}`;
    const after = c.dumpState();
    for (let i = 0; i < after.length; i++) {
      if (after[i] !== before[i]) return `wrote ${hex4(c.stateOffsetToAddr(i))} before raising`;
    }
    return null;
  }
  return "returned";
}

/** The frozen body with the life-loss handover probed out, so the arm stays on the unit. */
function frozen(mm) {
  const real = mm.routines.get(LOSE_LIFE);
  mm.routines = new Map(mm.routines);
  mm.routines.set(LOSE_LIFE, () => {});
  try { return oracle(mm); } finally { mm.routines.set(LOSE_LIFE, real); }
}

// ── broken twins ───────────────────────────────────────────────────────────────────────────

/** BUG: the pre-fault form — runs the body on the broken stack. */
const brokenRunsTheBody = frozen;
/** BUG: returns quietly instead of raising. */
const brokenNoOp = () => {};
/** BUG: raises, but a plain error rather than the untranscribed-code fault. */
const brokenPlainError = () => { throw new Error("tampered"); };
/** BUG: raises the right fault, but after a write. */
const brokenWritesFirst = (m) => { m.mem8[m.regs.ix & 0xffff] ^= 0xff; throw new NotImplemented("late"); };

const TWINS = [
  ["runs-the-body", brokenRunsTheBody],
  ["no-op", brokenNoOp],
  ["plain-error", brokenPlainError],
  ["writes-first", brokenWritesFirst],
];

// ── the gate ───────────────────────────────────────────────────────────────────────────────

test("THROWS: the entry raises NotImplemented before writing a byte, on every state", { skip }, () => {
  const all = states();
  for (const [label, s] of all) {
    assert.equal(faultsClean(derailIntoMotherShipWreckCountdown, s), null, `${label}: the entry did not fault cleanly`);
  }
  console.log(`  THROWS: ${all.length} states (${captureDrifts().length} captured, ${CRAFTS.length} crafted) raise NotImplemented, nothing written`);
});

test("LANDING: the frozen body ends every state with SP an odd distance from its seat", { skip }, () => {
  const offsets = new Set();
  for (const [label, s] of states()) {
    const c = s.clone();
    const seat = c.regs.sp;
    frozen(c);
    const moved = (c.regs.sp - seat) & 0xffff;
    assert.equal(moved & 1, 1, `${label}: the frozen body left SP ${moved} from its seat — not out of step`);
    offsets.add(moved);
  }
  console.log(`  LANDING: every frozen exit reads its return out of step (SP moved ${[...offsets].join("/")})`);
});

/** One run's counts and the guards' inputs, under a read and write tap on the witness pair. Every
 *  tapped event and every counted dispatch takes the next tick, so their order is known. */
function measure(opts, frames) {
  const seen = { [TARGET]: 0, [DRIFT_SITE]: 0, [GLYPH_DISPATCHER]: 0, [WITNESS_DISPATCHER]: 0 };
  const glyphs = [];
  const events = [];
  let tick = 0;
  let firstWitnessDispatch = Infinity;
  const map = new Map();
  for (const addr of Object.keys(seen).map(Number)) {
    const real = TRANSLATED.get(addr);
    map.set(addr, (mm) => {
      seen[addr]++;
      tick++;
      if (addr === GLYPH_DISPATCHER) glyphs.push(mm.mem8[GLYPH_CELL]);
      if (addr === WITNESS_DISPATCHER && firstWitnessDispatch === Infinity) firstWitnessDispatch = tick;
      return real(mm);
    });
  }
  const m = makeMachine(map, opts);
  const inPair = (addr) => addr === WITNESS || addr === WITNESS + 1;
  const note = (kind, addr, v) => { if (inPair(addr)) events.push({ at: ++tick, kind, addr, v: v & 0xff }); };
  const { read8, write8, write16 } = m.mem;
  m.mem.read8 = (addr, ...rest) => { const v = read8.call(m.mem, addr, ...rest); note("read", addr, v); return v; };
  m.mem.write8 = (addr, v, ...rest) => { note("write", addr, v); return write8.call(m.mem, addr, v, ...rest); };
  m.mem.write16 = (addr, v, ...rest) => {
    note("write", addr, v);
    note("write", (addr + 1) & 0xffff, v >> 8);
    return write16.call(m.mem, addr, v, ...rest);
  };
  m.runFrames(frames);
  return { seen, glyphs, events, firstWitnessDispatch, stopped: m.stoppedBy };
}

let runs = null;
function measured() {
  runs ??= [["coin-start", measure({}, ENTRY_FRAMES)], ["long-undriven", measure({ tape: [] }, LONG_UNDRIVEN_FRAMES)]];
  return runs;
}

test("UNREACHED: no run branches into this address, with live controls", { skip }, () => {
  for (const [label, r] of measured()) {
    assert.equal(r.stopped, null, `the ${label} run stopped early: ${r.stopped}`);
    assert.ok(r.seen[DRIFT_SITE] > 0, `${label}: the drift site never ran, so the zero below means nothing`);
    assert.equal(r.seen[TARGET], 0, `${label} dispatched ${hex4(TARGET)} on a genuine image`);
    console.log(`  UNREACHED: ${label} — target 0, dispatchers ${DISPATCHERS.map((d) => r.seen[d]).join("/")}, drift ${r.seen[DRIFT_SITE]}`);
  }
  for (const d of DISPATCHERS) {
    assert.ok(measured().some(([, r]) => r.seen[d] > 0), `no run dispatched ${hex4(d)}, so its zero transfers mean nothing`);
  }
});

test("GENUINE: both guards' inputs hold genuine values whenever they can be read", { skip }, () => {
  let gateReads = 0;
  let glyphReads = 0;
  for (const [label, r] of measured()) {
    assert.deepEqual(r.glyphs.filter((g) => g !== GENUINE_GLYPH), [], `${label}: a glyph dispatch read a non-genuine glyph`);
    glyphReads += r.glyphs.length;
    const plant = r.events.find((e) => e.kind === "write" && e.addr === WITNESS && e.v === WITNESS_GLYPH);
    assert.ok(plant, `${label}: the witness was never planted`);
    // Before the plant the pair holds the cold-start clear; nothing past the first witness dispatch
    // may read it until the plant lands.
    const early = r.events.filter((e) => e.kind === "read" && e.at > r.firstWitnessDispatch && e.at < plant.at);
    assert.deepEqual(early, [], `${label}: the witness pair was read after its dispatcher started and before the plant`);
    const after = r.events.filter((e) => e.at > plant.at);
    const bad = after.filter((e) => (e.addr === WITNESS ? e.v !== WITNESS_GLYPH : !WITNESS_COLOURS.includes(e.v)));
    assert.deepEqual(bad, [], `${label}: after the plant the witness pair held a non-genuine value`);
    const reads = after.filter((e) => e.kind === "read").length;
    gateReads += reads;
    console.log(`  GENUINE: ${label} — ${r.glyphs.length} glyph read(s) genuine; ${after.length} witness ` +
      `access(es) after the plant (${reads} read), all genuine`);
  }
  // Positive controls: the guards' inputs were actually read somewhere, so the zeros above count.
  assert.ok(glyphReads > 0, "no run read the glyph guard's input");
  assert.ok(gateReads > 0, "no run read the witness pair after the plant");
});

let glyphEntry = null;
function captureGlyphDispatch() {
  if (glyphEntry) return glyphEntry;
  const m = makeMachine(new Map([[GLYPH_DISPATCHER, (mm) => {
    glyphEntry ??= mm.clone();
    return oracle176a(mm);
  }]]), { tape: [] });
  m.runFrames(ENTRY_FRAMES);
  assert.notEqual(glyphEntry, null, "vacuous: the glyph dispatcher never ran");
  return glyphEntry;
}

function raisesHere(fn) {
  try {
    fn();
  } catch (e) {
    return e instanceof NotImplemented && String(e.message).includes("derailIntoMotherShipWreckCountdown");
  }
  return false;
}

test("TAMPER: each guard reaches this fault only on a tampered value", { skip }, () => {
  // The glyph guard: the idiomatic arm raises THIS fault on a poked glyph, runs clean on the genuine
  // one, and the frozen arm really transfers here.
  const genuine = captureGlyphDispatch();
  assert.equal(genuine.mem8[GLYPH_CELL], GENUINE_GLYPH, "the captured glyph is not the genuine one");
  assert.ok(!raisesHere(() => paintReadoutsThenSampleWitnessOrDerail(genuine.clone())), "the genuine glyph raised");
  const poked = genuine.clone();
  poked.mem8[GLYPH_CELL] = GENUINE_GLYPH ^ 0x01;
  assert.ok(raisesHere(() => paintReadoutsThenSampleWitnessOrDerail(poked.clone())), "a poked glyph did not raise this fault");
  const probed = poked.clone();
  probed.routines = new Map(probed.routines);
  let landed = 0;
  probed.routines.set(TARGET, () => { landed++; });
  oracle176a(probed);
  assert.equal(landed, 1, "the frozen glyph arm did not transfer to this address on a poked glyph");

  // The witness gate: genuine pairs return, a zeroed witness raises THIS fault.
  const d = captureDrifts()[0];
  const ix = d.regs.ix & 0xffff;
  for (const colour of WITNESS_COLOURS) {
    const c = d.clone();
    c.mem8[WITNESS] = WITNESS_GLYPH;
    c.mem8[WITNESS + 1] = colour;
    assert.ok(!raisesHere(() => retireMotherShipAndRaiseRoundHold(c, ix)), `the genuine witness (colour ${colour}) raised`);
  }
  for (const [glyph, colour] of [[0x00, 0x05], [WITNESS_GLYPH, 0x00]]) {
    const c = d.clone();
    c.mem8[WITNESS] = glyph;
    c.mem8[WITNESS + 1] = colour;
    assert.ok(raisesHere(() => retireMotherShipAndRaiseRoundHold(c, ix)), `a tampered witness ${glyph}/${colour} did not raise this fault`);
  }
  console.log("  TAMPER: glyph guard and witness gate each raise this fault only on a tampered value; " +
    "the frozen glyph arm is seen transferring here");
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip }, () => {
    const all = states();
    const caught = all.filter(([, s]) => faultsClean(twin, s) !== null).length;
    console.log(`  TEETH/${label}: caught on ${caught}/${all.length}`);
    assert.equal(caught, all.length, `the ${label} twin escaped THROWS on some state`);
  });
}
