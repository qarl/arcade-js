// SPDX-License-Identifier: GPL-3.0-only
/**
 * flyRoundIntroFlashingEraYearThenEraseIntroCaptions — memory-equivalent to the frozen oracle at ROM 0x16AF.
 *
 * GATE: masked strict, run through the game's omitted-return seam so SP and pc are compared EXACTLY.
 *   The rewrite omits its closing return and the seam completes it, as in the live game; the frozen
 *   side returns for itself. RAM must match outside the stack scratch window [low, seat), where
 *   `low` is the deepest stack word either side pushed; the window is asserted to sit above data.
 *
 * SCANLINE PIN. Two callees read the raster counter and the frozen side's T-state accounting drifts
 *   that read across a pass, while the rewrite charges none. The counter is pinned to 0xFF on both
 *   sides before every comparison: every armed fixup slot fires and no multiplex slot waits on the
 *   beam, so both sides do the same work deterministically. The pin is the one timing control.
 *
 * LIVE-OUT: memory only. Derived from the oracle's one continuation (the fixed tail its dispatcher
 *   parks, ROM 0x0F54): every path there reloads the accumulator from memory before testing it, and
 *   nothing reads B/C/D/E/H/L/IX/IY before writing them. The CONTINUATION arm runs that frozen tail
 *   on both sides after the routine and compares RAM again, so a register leak would show there.
 *
 * What it exercises:
 *   1. REAL DISPATCHES — every captured entry under the coin/start tape (capped), identical.
 *   2. CRAFTED ARMS — from a real entry, the frame tick / delay / round-intro-pending flag / era poked identically
 *      on both sides to force each branch: expiry tail, odd-frame count-down without expiry, each
 *      of the three nibble commands, an unlisted nibble, and no round intro pending.
 *   3. CONTINUATION — the frozen fixed tail run on both sides afterwards; RAM still identical.
 *   3a. HELD REQUEST — a crafted entry whose last multiplex slot carries a request the fixups leave
 *      standing (the beam sits before its line until the multiplex pass, then past every hold),
 *      so the closing multiplex pass has a write to make. Under the plain pin every armed request
 *      is taken by the second fixup first, so without this entry the closing pass writes nothing.
 *   4. SP TOOTH — the rewrite is placeable through the seam on every entry, and a twin that still
 *      lays a word down for the plain-return fixup, which never lifts it, is NOT (the stray-word
 *      class memory-eq cannot see).
 *   5. TEETH — broken twins, each caught on at least one entry of the pool.
 *
 * HOLE: the crafted arms vary only the timer cells and the era; everything else is the captured
 *   entry. The callees' own gates carry their input spaces.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-16af.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { withOmittedRet } from "../../machine.js";
import { seamPlaceable } from "../../../../core/equivalence.js";
import { flyRoundIntroFlashingEraYearThenEraseIntroCaptions as candidate } from "../flyRoundIntroFlashingEraYearThenEraseIntroCaptions.js";
import { loc_16af as oracle } from "../../translated/loc_16af.js";
import { loc_0f54 as continuation } from "../../translated/loc_0f54.js";
import { loc_0f1f as frozenDispatcher } from "../../translated/loc_0f1f.js";

import { multiplexSpriteSlotsSkipping } from "../multiplexSpriteSlotsSkipping.js";
import { dispatchPlayerFrameByState } from "../dispatchPlayerFrameByState.js";
import { runSceneryForEra } from "../runSceneryForEra.js";
import { multiplexSpriteSlots } from "../multiplexSpriteSlots.js";
import { postCommand } from "../postCommand.js";
import { advanceSequenceSubStep } from "../advanceSequenceSubStep.js";

const TARGET = 0x16af;
const DISPATCHER = 0x0f1f;
const CONTINUATION_SLOT = 0x0f54;

// Cells derived here from the oracle's own operands, independently of the module's imports.
const SEQUENCE_PHASE = 0xa9ab;
const SEQUENCE_SUBSTEP = 0xa9ac;
const FRAME_TICK = 0xa980;
const SEQUENCE_DELAY = 0xa9eb;
const ROUND_INTRO_PENDING = 0xad0e;
const ERA_INDEX = 0xad04;
const FOLD_BLOCK = 0x4d9f;
const PINNED_SCANLINE = 0xff;
// From the frozen multiplex pass (ROM 0x1098): its span, and its last slot's request/partner pair.
const MUX_START = 0x1098;
const MUX_END = 0x1198;
const LAST_MUX_REQUEST = 0xb43f;
const LAST_MUX_PARTNER = 0xb03e;
// A beam line the fixups do not carry past for the request below (0x90 + 0x40 < 0x100).
const BEAM_BEFORE_HOLD = 0x40;
const HELD_REQUEST = 0x90;

const DATA_TOP = 0xadff;
const CAP = 24;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${d.addr == null ? "reg" : hex4(d.addr)}: frozen=${d.a} rewrite=${d.b}` : "identical");

function lean(mm) {
  mm.assets = {};
  mm.video = null;
  return mm;
}

// ── entries ─────────────────────────────────────────────────────────────────────────────────

let captured = null;
/** Real dispatches of this address under the coin/start tape, plus the dispatcher's own entries as
 *  a fallback base for crafting when the tape never reaches this arm. */
function capture() {
  if (captured) return captured;
  const entries = [];
  const dispatcherEntries = [];
  let dispatches = 0;
  const m = makeMachine(new Map([
    [TARGET, (mm) => {
      dispatches++;
      if (entries.length < CAP) entries.push(lean(mm.clone()));
      return oracle(mm);
    }],
    [DISPATCHER, (mm) => {
      if (dispatcherEntries.length < 1) dispatcherEntries.push(lean(mm.clone()));
      return frozenDispatcher(mm);
    }],
  ]));
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the capture run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "the capture run ran short");
  captured = { entries, dispatches, dispatcherEntries };
  return captured;
}

/** A base entry to craft from: a real dispatch, else the dispatcher's entry with its parked
 *  continuation slot pushed and the sub-step set to this arm, as the dispatcher would leave it. */
function base() {
  const { entries, dispatcherEntries } = capture();
  if (entries.length > 0) return entries[0];
  assert.ok(dispatcherEntries.length > 0, "neither this arm nor its dispatcher was reached");
  const e = dispatcherEntries[0].clone();
  e.push16(CONTINUATION_SLOT);
  e.mem8[SEQUENCE_SUBSTEP] = 0x05;
  return e;
}

function craft(pokes) {
  const e = base().clone();
  for (const [addr, v] of pokes) e.mem8[addr] = v;
  return e;
}

const CRAFTED = [
  ["expiry", [[FRAME_TICK, 0x01], [SEQUENCE_DELAY, 0x01], [ROUND_INTRO_PENDING, 0xff]]],
  ["count-down wraps from 0", [[FRAME_TICK, 0x03], [SEQUENCE_DELAY, 0x00], [ROUND_INTRO_PENDING, 0xff]]],
  ["count-down, nibble 5", [[FRAME_TICK, 0x15], [SEQUENCE_DELAY, 0x07], [ROUND_INTRO_PENDING, 0xff], [ERA_INDEX, 0x02]]],
  ["even, nibble 0", [[FRAME_TICK, 0x20], [SEQUENCE_DELAY, 0x07], [ROUND_INTRO_PENDING, 0x01], [ERA_INDEX, 0x00]]],
  ["even, nibble 10", [[FRAME_TICK, 0x3a], [SEQUENCE_DELAY, 0x07], [ROUND_INTRO_PENDING, 0xff], [ERA_INDEX, 0x04]]],
  ["even, unlisted nibble", [[FRAME_TICK, 0x04], [SEQUENCE_DELAY, 0x07], [ROUND_INTRO_PENDING, 0xff]]],
  ["odd, unlisted nibble", [[FRAME_TICK, 0x07], [SEQUENCE_DELAY, 0x07], [ROUND_INTRO_PENDING, 0xff]]],
  ["no intro pending, nibble 0", [[FRAME_TICK, 0x10], [SEQUENCE_DELAY, 0x07], [ROUND_INTRO_PENDING, 0x00]]],
  ["no intro pending, count-down", [[FRAME_TICK, 0x05], [SEQUENCE_DELAY, 0x09], [ROUND_INTRO_PENDING, 0x00]]],
  // The fold nets out only for some phase values; this one it moves, so the fold itself is exercised.
  ["phase the fold moves", [[SEQUENCE_PHASE, 0x00], [FRAME_TICK, 0x04], [SEQUENCE_DELAY, 0x07], [ROUND_INTRO_PENDING, 0xff]]],
];

const craftedEntries = () => CRAFTED.map(([label, pokes]) => [label, craft(pokes)]);

// ── the comparison ──────────────────────────────────────────────────────────────────────────

/** Entries whose beam sits at a given line until the frozen multiplex pass waits, then past every hold. */
const beamBeforeHold = new WeakMap();

function pin(mm, from = null) {
  const line = from ? beamBeforeHold.get(from) : undefined;
  if (line === undefined) {
    mm.io.readScanline = () => PINNED_SCANLINE;
    return;
  }
  // Keyed on the frozen side's pc: the rewrite's multiplex pass never reads the beam, and the fixups
  // on both sides read it outside that span, so both sides see the same lines at the same reads.
  mm.io.readScanline = () => (mm.pc >= MUX_START && mm.pc < MUX_END ? PINNED_SCANLINE : line);
}

/** A real entry whose last multiplex slot holds a request the fixups leave to the multiplex pass. */
function heldRequestEntry() {
  const e = craft([[FRAME_TICK, 0x04], [SEQUENCE_DELAY, 0x07], [ROUND_INTRO_PENDING, 0xff], [LAST_MUX_REQUEST, HELD_REQUEST]]);
  beamBeforeHold.set(e, BEAM_BEFORE_HOLD);
  return e;
}

/** Track the deepest stack word a side reaches. */
function trackLow(mm, box) {
  const push = mm.push16.bind(mm);
  mm.push16 = (v) => { push(v); if (mm.regs.sp < box.low) box.low = mm.regs.sp; };
}

/** Frozen side direct (it returns for itself); rewrite through the seam. Masked RAM, then SP and pc. */
function unitDiff(fn, machine, { thenContinue = false } = {}) {
  const a = machine.clone();
  const b = machine.clone();
  pin(a, machine);
  pin(b, machine);
  const seat = a.regs.sp;
  const box = { low: seat };
  trackLow(a, box);
  trackLow(b, box);
  oracle(a);
  try {
    withOmittedRet(fn, TARGET)(b);
  } catch (e) {
    return { addr: null, a: "placed", b: String(e.message ?? e).slice(0, 60) };
  }
  if (a.regs.sp !== b.regs.sp) return { addr: null, a: `sp ${hex4(a.regs.sp)}`, b: `sp ${hex4(b.regs.sp)}` };
  if (a.pc !== b.pc) return { addr: null, a: `pc ${hex4(a.pc)}`, b: `pc ${hex4(b.pc)}` };
  if (thenContinue) {
    for (const mm of [a, b]) {
      mm.push16(CONTINUATION_SLOT);
      continuation(mm);
    }
  }
  const da = a.dumpState();
  const db = b.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr !== null && addr >= box.low && addr < seat) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

function stackWindow(machine) {
  const a = machine.clone();
  pin(a, machine);
  const box = { low: a.regs.sp };
  trackLow(a, box);
  oracle(a);
  return box.low;
}

// ── broken twins ────────────────────────────────────────────────────────────────────────────

const fix = multiplexSpriteSlotsSkipping;
function services(m, { closingPass = true } = {}) {
  fix(m);
  dispatchPlayerFrameByState(m);
  fix(m);
  runSceneryForEra(m);
  if (closingPass) multiplexSpriteSlots(m);
}
function fold(m, key = 0xa2) {
  let a = m.mem8[SEQUENCE_PHASE];
  for (let i = 0; i < 256; i++) a = (a - m.mem8[FOLD_BLOCK + i]) & 0xff;
  m.mem8[SEQUENCE_PHASE] = a ^ key;
}
function timer(m, { parity = 1, rearm = 0x2a, clearArmed = true, advance = true, guard = true, cmds = { 0: 2, 5: 0x0a, 10: 0x0b } } = {}) {
  const tick = m.mem8[FRAME_TICK];
  if ((tick & 1) === parity) {
    const d = (m.mem8[SEQUENCE_DELAY] - 1) & 0xff;
    m.mem8[SEQUENCE_DELAY] = d;
    if (d === 0) {
      for (const e of [0x09, 0x0e, 0x1a]) postCommand(m, 0x03, e);
      if (clearArmed) m.mem8[ROUND_INTRO_PENDING] = 0;
      m.mem8[SEQUENCE_DELAY] = rearm;
      if (advance) advanceSequenceSubStep(m);
      return;
    }
  }
  if (guard && m.mem8[ROUND_INTRO_PENDING] === 0) return;
  const c = cmds[tick & 0x0f];
  if (c === undefined) return;
  postCommand(m, c, (m.mem8[ERA_INDEX] + 0x1a) & 0xff);
}

const TWINS = [
  ["no-op", () => {}],
  ["no-fold", (m) => { services(m); timer(m); }],
  ["wrong-fold-key", (m) => { fold(m, 0x90); services(m); timer(m); }],
  ["even-frame-countdown", (m) => { fold(m); services(m); timer(m, { parity: 0 }); }],
  ["no-sub-step-advance", (m) => { fold(m); services(m); timer(m, { advance: false }); }],
  ["intro-left-pending-on-expiry", (m) => { fold(m); services(m); timer(m, { clearArmed: false }); }],
  ["wrong-rearm", (m) => { fold(m); services(m); timer(m, { rearm: 0x5a }); }],
  ["no-armed-guard", (m) => { fold(m); services(m); timer(m, { guard: false }); }],
  ["swapped-nibble-commands", (m) => { fold(m); services(m); timer(m, { cmds: { 0: 0x0b, 5: 0x0a, 10: 2 } }); }],
  ["drop-last-mux", (m) => { fold(m); services(m, { closingPass: false }); timer(m); }],
];

// A stray stack word: memory-identical in the scratch window, caught only by stack placement.
const strayWord = (m) => {
  fold(m);
  m.push16(0);
  multiplexSpriteSlotsSkipping(m);
  dispatchPlayerFrameByState(m);
  fix(m);
  runSceneryForEra(m);
  multiplexSpriteSlots(m);
  timer(m);
};

function pool() {
  return [...capture().entries.slice(0, 8), ...craftedEntries().map(([, e]) => e), heldRequestEntry()];
}

// ── the gate ────────────────────────────────────────────────────────────────────────────────

test("REAL DISPATCHES: every captured entry is identical (RAM outside scratch, SP, pc)", { skip }, () => {
  const { entries, dispatches } = capture();
  if (entries.length === 0) {
    console.log("  REAL DISPATCHES: the coin/start tape never reached this arm; crafted arms carry the gate");
    return;
  }
  for (const e of entries) {
    assert.equal(e.mem8[SEQUENCE_SUBSTEP] & 0x0f, 0x05, "captured entry is not the sub-step-5 arm");
    const d = unitDiff(candidate, e);
    assert.equal(d, null, `a real dispatch diverged: ${show(d)}`);
  }
  console.log(`  REAL DISPATCHES: ${dispatches} dispatched, ${entries.length} captured, all identical`);
});

test("CRAFTED ARMS: every forced branch is identical, and the branches really differ", { skip }, () => {
  const footprints = new Map();
  for (const [label, e] of craftedEntries()) {
    const d = unitDiff(candidate, e);
    assert.equal(d, null, `the ${label} arm diverged: ${show(d)}`);
    const a = e.clone();
    pin(a);
    oracle(a);
    footprints.set(label, [a.mem8[SEQUENCE_SUBSTEP], a.mem8[SEQUENCE_DELAY], a.mem8[ROUND_INTRO_PENDING]].join("."));
  }
  const expired = craft(CRAFTED[0][1]);
  const subBefore = expired.mem8[SEQUENCE_SUBSTEP];
  pin(expired);
  oracle(expired);
  assert.equal(expired.mem8[SEQUENCE_SUBSTEP], (subBefore + 1) & 0xff, "the expiry arm did not advance the sub-step");
  assert.equal(expired.mem8[SEQUENCE_DELAY], 0x2a, "the expiry arm did not re-arm the delay");
  assert.equal(expired.mem8[ROUND_INTRO_PENDING], 0x00, "the expiry arm did not clear the round-intro-pending flag");
  console.log(`  CRAFTED ARMS: ${CRAFTED.length} identical; ${new Set(footprints.values()).size} distinct timer outcomes`);
});

test("CONTINUATION: the frozen fixed tail after the routine leaves RAM identical (register live-out is dead)", { skip }, () => {
  const entries = [...capture().entries.slice(0, 4), ...craftedEntries().map(([, e]) => e)];
  for (const e of entries) {
    const d = unitDiff(candidate, e, { thenContinue: true });
    assert.equal(d, null, `the continuation diverged: ${show(d)}`);
  }
  console.log(`  CONTINUATION: ${entries.length} entries identical through the fixed tail`);
});

test("HELD REQUEST: the closing multiplex pass has a write to make, and both sides make it", { skip }, () => {
  const e = heldRequestEntry();
  const d = unitDiff(candidate, e);
  assert.equal(d, null, `the held-request entry diverged: ${show(d)}`);
  // The request survives everything before the closing pass (fixups, player frame, scenery) ...
  const before = e.clone();
  pin(before, e);
  services(before, { closingPass: false });
  assert.equal(before.mem8[LAST_MUX_REQUEST], HELD_REQUEST, "the fixups took the held request before the closing pass");
  // ... and the frozen routine's closing pass takes it and moves the partner half a range.
  const a = e.clone();
  pin(a, e);
  const partner = a.mem8[LAST_MUX_PARTNER];
  oracle(a);
  assert.equal(a.mem8[LAST_MUX_REQUEST], HELD_REQUEST & 0x7f, "the held request was not taken");
  assert.equal(a.mem8[LAST_MUX_PARTNER], (partner + 0x80) & 0xff, "the held request's partner did not move half a range");
  // Control: under the plain pin the second fixup takes the same request, leaving the closing pass nothing.
  const plain = e.clone();
  pin(plain);
  services(plain, { closingPass: false });
  assert.equal(plain.mem8[LAST_MUX_REQUEST], HELD_REQUEST & 0x7f, "control: under the plain pin the fixup did not take the request");
  console.log("  HELD REQUEST: identical; the request reached the closing pass, which took it");
});

test("STACK WINDOW: the excluded scratch sits above data", { skip }, () => {
  for (const e of pool()) {
    const low = stackWindow(e);
    assert.ok(low > DATA_TOP, `the stack window reached into data (${hex4(low)})`);
  }
});

test("SP TOOTH: the rewrite is seam-placeable; a stray stack word is not", { skip }, () => {
  for (const e of pool()) {
    const good = e.clone();
    pin(good, e);
    const r = seamPlaceable(withOmittedRet, candidate, TARGET, good);
    assert.equal(r.placeable, true, `the rewrite is not placeable: ${r.error}`);
  }
  let caught = 0;
  for (const e of pool()) {
    const bad = e.clone();
    pin(bad, e);
    if (!seamPlaceable(withOmittedRet, strayWord, TARGET, bad).placeable) caught++;
  }
  assert.equal(caught, pool().length, `the stray-word twin escaped on ${pool().length - caught} entries`);
  console.log(`  SP TOOTH: rewrite placeable everywhere; stray-word twin refused by the seam on all ${caught}`);
});

test("TEETH: every broken twin is caught, and the real routine passes the same pool", { skip }, () => {
  const entries = pool();
  for (const e of entries) assert.equal(unitDiff(candidate, e), null, "the real routine diverged on a pool entry");
  const counts = [];
  for (const [label, twin] of TWINS) {
    const caught = entries.filter((e) => unitDiff(twin, e)).length;
    assert.ok(caught > 0, `every entry PASSED the ${label} twin`);
    counts.push(`${label}=${caught}`);
  }
  console.log(`  TEETH: ${TWINS.length} twins caught over ${entries.length} entries (${counts.join(", ")})`);
});
