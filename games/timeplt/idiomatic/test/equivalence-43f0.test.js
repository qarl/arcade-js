// SPDX-License-Identifier: GPL-3.0-only
/** loc_43f0 — memory-equivalent to the frozen oracle. Nothing dispatches this deep-state driver on
 * either tape (a live control proves the run counts), so it runs on CRAFTED entries poked onto real
 * captured machines to force every state-byte arm, full work-RAM compared with the dead stack scratch
 * masked off both sides' pushes, and broken twins caught in memory. No register is compared: the
 * DEAD AT EXIT arm (assertDeadAtExit) measures on the ORACLE that none it leaves — the record/sprite
 * pair the live arm walks on included — is heard anywhere, the stack page included, over three armed
 * sessions (eras 0, 2 and 4), while a complemented stack pointer is heard at once. The rewrite threads the pair through every arm and
 * into every callee as arguments and leaves it nowhere.
 * The spent-sequence tamper gate (TAMPER_GLYPH_COPY) has its own DERAIL arm: when it fails the oracle
 * falls into the misaligned prologue of the Mother-Ship's wreck countdown (0x459b, derailIntoMotherShipWreckCountdown), which has no routine form, so the
 * rewrite raises there and the two are compared AT the transfer (test/_tamperDerail.js). On a genuine
 * image the gate always passes: every writer of the pair seats the "K" glyph 0x7c and one of the
 * copyright line's two colours (the ROM witness seed table at 0x163f, and the copies taken off the drawn line).
 * Run: node --test games/timeplt/idiomatic/test/equivalence-43f0.test.js */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { ROUTINES as TRANSLATED } from "../../routines.js";
import { loc_43f0 as candidate } from "../loc_43f0.js";
import { derailIntoMotherShipWreckCountdown } from "../derailIntoMotherShipWreckCountdown.js";
import { loc_598e } from "../loc_598e.js";
import { loc_5994 } from "../loc_5994.js";
import { loc_43f0 as oracle } from "../../translated/loc_43f0.js";
import { stopAtDerails, faultClass } from "./_tamperDerail.js";
import { assertDeadAtExit } from "./_deadAtExit.js";

const TARGET = 0x43f0;
const ANCHOR = 0x43b7; // reached on the tape; seats this object's bank
const RECORD = 0xa8a0;
const SPRITE = 0xaa24;
const GATE = 0xad0d; // the caller's deep-state gate
const STACK_FLOOR = 0xae00; // data below, the stack seats up at 0xb000
const BASES = 2;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
/** The sessions DEAD AT EXIT poisons over (JS frames): the kill quota spent, the ship armed, in three eras. */
const DEAD_FRAMES = 3000;
const QUOTA_SPENT = { addr: 0xad02, val: 0, frame: 621, dur: null };
const DEAD_SESSIONS = {
  "era 0": [QUOTA_SPENT],
  "era 2": [QUOTA_SPENT, { addr: 0xad04, val: 2, frame: 701, dur: null }],
  "era 4": [QUOTA_SPENT, { addr: 0xad04, val: 4, frame: 701, dur: null }],
};
/** Every register the oracle can leave behind, the stack pointer apart. */
const LEFT_BEHIND = ["a", "f", "b", "c", "d", "e", "h", "l", "ix", "iy", "a_", "f_", "b_", "c_", "d_", "e_", "h_", "l_"];
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

const COOLDOWN = 0xa817;
function liveProximity(c) {
  c.mem8[COOLDOWN] = 0x00;
  c.mem8[0xa827] = 0x10; // half-width, so the near-band test admits the player
  c.mem8[SPRITE + 0x00] = 0x40;
  c.mem8[SPRITE + 0x31] = 0x40;
}

// [label, state byte, mutator forcing that arm's reads]
const WRITING = [
  ["idle-delay", 0x00, (c) => { c.mem8[RECORD + 0x0e] = 0x05; }],
  ["idle-spawn-neg", 0x00, (c) => { c.mem8[RECORD + 0x0e] = 0; c.mem8[0xacc6] = 0; c.mem8[0xa980] = 0x00; c.mem8[RECORD + 0x04] = 0x0a; c.mem8[0xad04] = 0x01; }],
  ["idle-spawn-keep", 0x00, (c) => { c.mem8[RECORD + 0x0e] = 0; c.mem8[0xacc6] = 0; c.mem8[0xa980] = 0x08; c.mem8[RECORD + 0x04] = 0x02; c.mem8[0xad04] = 0x00; }],
  ["countdown", 0x05, (c) => { c.mem8[RECORD + 0x04] = 0x03; }],
  ["field-sweep", 0xef, (c) => { c.mem8[RECORD + 0x04] = 0; c.mem8[0xa810] = 0xff; c.mem8[0xa820] = 0xfe; c.mem8[0xa830] = 0x05; }],
  ["award-label-warp", 0xb4, (c) => { c.mem8[RECORD + 0x04] = 0; c.mem8[0xa800] = 0xff; }],
  ["below-label-step", 0x30, (c) => { c.mem8[RECORD + 0x04] = 0; }],
  ["above-label-step", 0xc4, (c) => { c.mem8[RECORD + 0x04] = 0; }],
  ["spend-idle", 0x01, (c) => { c.mem8[RECORD + 0x04] = 0; }],
  ["reach-5a", 0x5b, (c) => { c.mem8[RECORD + 0x04] = 0; }],
  ["live-cooldown", 0xff, (c) => { c.mem8[COOLDOWN] = 0x01; }],
  ["live-nofree", 0xff, (c) => { liveProximity(c); c.mem8[0xa830] = 0x11; c.mem8[0xa840] = 0x22; }],
  ["live-spawn", 0xff, (c) => { liveProximity(c); c.mem8[0xa830] = 0x00; c.mem8[0xad04] = 0x00; }], // era-0 velocity arm
  ["live-spawn-s2", 0xff, (c) => { liveProximity(c); c.mem8[0xa830] = 0x00; c.mem8[0xad04] = 0x02; }], // era-2 velocity arm
  ["live-noprox", 0xff, (c) => { c.mem8[COOLDOWN] = 0; c.mem8[SPRITE + 0] = 0; c.mem8[SPRITE + 0x31] = 0; }],
];
// The spent sequence on a tampered copy of the glyph pair: 4646 falls into the 0x459b landing.
const TAMPER_GLYPH_COPY = 0xab43;
const SPEND_WARP = ["spend-warp", 0x01, (c) => { c.mem8[RECORD + 0x04] = 0; c.mem8[TAMPER_GLYPH_COPY] = 0x00; }];
// An arm that only reads and returns — its live-out is that it writes nothing.
const EARLY = ["idle-locked", 0x00, (c) => { c.mem8[RECORD + 0x0e] = 0; c.mem8[0xacc6] = 0x01; }];

let cache = null;
function setup() {
  if (cache) return cache;
  const bases = [];
  let anchorHits = 0, targetHits = 0;
  const realAnchor = TRANSLATED.get(ANCHOR);
  const realTarget = TRANSLATED.get(TARGET);
  const m = makeMachine(new Map([
    [ANCHOR, (mm) => { if (anchorHits % 80 === 0 && bases.length < BASES) bases.push(mm.clone()); anchorHits++; return realAnchor(mm); }],
    [TARGET, (mm) => { targetHits++; return realTarget(mm); }],
  ]));
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the capture run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "the capture run ran short");
  cache = { bases, anchorHits, targetHits };
  return cache;
}
const bases = () => setup().bases;

function craft(base, state, mut) {
  const c = base.clone();
  c.mem8[RECORD] = state;
  c.mem8[GATE] = 0x01; // arm the deep-state gate the caller would have set
  mut(c);
  return c;
}
function corpus(rows = WRITING) {
  const out = [];
  for (const base of bases()) for (const [label, st, mut] of rows) out.push([label, craft(base, st, mut)]);
  return out;
}

/** Oracle vs candidate on independent clones, the stack scratch both sides push masked off. */
function compare(cand, machine) {
  const a = machine.clone(), b = machine.clone();
  const scratch = new Set();
  let minSp = a.regs.sp;
  const track = (mm) => {
    const push = mm.push16.bind(mm);
    mm.push16 = (v) => { const sp = (mm.regs.sp - 2) & 0xffff; scratch.add(sp).add((sp + 1) & 0xffff); if (sp < minSp) minSp = sp; push(v); };
  };
  track(a); track(b);
  oracle(a); cand(b);
  const da = a.dumpState(), db = b.dumpState();
  let escaped = null;
  for (let i = 0; i < da.length && escaped === null; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (scratch.has(addr)) continue;
    escaped = { addr, oracle: da[i], candidate: db[i] };
  }
  return { escaped, minSp };
}

function footprint(machine) {
  const before = machine.dumpState().slice();
  const a = machine.clone();
  oracle(a);
  const now = a.dumpState();
  const cells = new Set();
  for (let i = 0; i < now.length; i++) {
    const addr = a.stateOffsetToAddr(i);
    if (now[i] !== before[i] && addr < STACK_FLOOR) cells.add(addr); // data writes only
  }
  return cells;
}

test("SETUP: the tape never dispatches this deep-state routine, with a live control", { skip }, () => {
  const s = setup();
  assert.equal(s.targetHits, 0, "this routine now dispatches on the tape; capture plain entries instead");
  assert.ok(s.anchorHits > 0, "the anchor was never reached, so the zero above proves nothing");
  assert.equal(s.bases.length, BASES, "the base count moved");
  console.log(`  SETUP: target ${s.targetHits}, control anchor ${s.anchorHits}, bases ${s.bases.length}`);
});

test("EQUAL: every crafted arm replays identically, and the corpus is not vacuous", { skip }, () => {
  const rows = corpus([...WRITING, EARLY]);
  for (const [label, c] of rows) {
    const r = compare(candidate, c);
    assert.equal(r.escaped, null, `${label}: escaped at ${r.escaped && hex4(r.escaped.addr)} oracle=${r.escaped && r.escaped.oracle} rewrite=${r.escaped && r.escaped.candidate}`);
    assert.ok(r.minSp > STACK_FLOOR, `${label}: a push reached ${hex4(r.minSp)}, into game data`);
  }
  console.log(`  EQUAL: ${rows.length} crafted entries identical outside the scratch`);
});

test("INFORMATIVE: writing arms move memory, the early-ret arm writes nothing", { skip }, () => {
  for (const [label, c] of corpus()) assert.ok(footprint(c).size > 0, `${label} moved no memory, so a no-op would pass it`);
  for (const [label, c] of corpus([EARLY])) assert.equal(footprint(c).size, 0, `${label} wrote memory; it is meant to be a pure early return`);
  console.log(`  INFORMATIVE: ${corpus().length} writing entries all move memory; the locked-out arm writes nothing`);
});

test("PATHS: the arms move different cells, so a twin confusing them is not invisible", { skip }, () => {
  const foot = (label) => footprint(craft(bases()[0], ...pick(label)));
  const eq = (x, y) => x.size === y.size && [...x].every((v) => y.has(v));
  assert.ok(!eq(foot("field-sweep"), foot("live-spawn")), "the field-sweep and live-spawn arms touch the same cells");
  assert.ok(!eq(foot("idle-delay"), foot("countdown")), "the idle and countdown arms touch the same cells");
  console.log(`  PATHS: field-sweep ${foot("field-sweep").size}, live-spawn ${foot("live-spawn").size}, idle ${foot("idle-delay").size} cells`);
});
function pick(label) {
  const row = WRITING.find((r) => r[0] === label);
  return [row[1], row[2]];
}

test("DEAD AT EXIT: no register the oracle leaves is heard, and a complemented stack pointer is", { skip }, () => {
  // assertDeadAtExit: every session reaches this routine and nothing differs, the stack page
  // included; beside the helper's own SP flip, a COMPLEMENTED stack pointer at the same exit must be
  // heard in game data (dataOnly) in every session, as before.
  assertDeadAtExit({
    at: TARGET, poison: LEFT_BEHIND, frames: DEAD_FRAMES, reachEvery: true,
    sessions: Object.entries(DEAD_SESSIONS).map(([label, pokes]) => ({ label, pokes })),
    controls: [{
      label: "complemented SP", poison: ["sp"], expect: "heard", every: true, reachEvery: true, dataOnly: true,
    }],
  });
});

const noOp = () => {};
const scribbleData = (m) => { candidate(m); m.mem8[RECORD + 0x20] ^= 0xff; };
// The body re-expresses its Z80 register scratch as JS locals and no register is live-out (DEAD AT
// EXIT). A twin that scribbles a main register after the routine is DELIBERATELY not flagged -- the
// same memory measurement must still catch a scribbled RAM cell, or the clean read on the register
// twin is worthless.
const scribbleScratchReg = (m) => { candidate(m); m.regs.a = (m.regs.a + 1) & 0xff; m.regs.b = (m.regs.b + 1) & 0xff; };

test("SCRATCH NOT PINNED: a main-register-only twin passes; a RAM scribble is caught", { skip }, () => {
  for (const [label, c] of corpus()) {
    const r = compare(scribbleScratchReg, c);
    assert.equal(r.escaped, null, `${label}: a scratch-register scribble moved memory`);
    assert.ok(biteInMemory(scribbleData, c), `${label}: the RAM measurement missed a scribbled cell, so it has no teeth`);
  }
  console.log(`  SCRATCH NOT PINNED: register twin ignored; RAM twin caught on all ${corpus().length}`);
});

/** memory-only catch, so the held-register check cannot be what is biting. */
function biteInMemory(twin, machine) {
  const a = machine.clone(), b = machine.clone();
  const scratch = new Set();
  const push = a.push16.bind(a);
  a.push16 = (v) => { const sp = (a.regs.sp - 2) & 0xffff; scratch.add(sp).add((sp + 1) & 0xffff); push(v); };
  const bpush = b.push16.bind(b);
  b.push16 = (v) => { const sp = (b.regs.sp - 2) & 0xffff; scratch.add(sp).add((sp + 1) & 0xffff); bpush(v); };
  oracle(a);
  try { twin(b); } catch { return true; }
  const da = a.dumpState(), db = b.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    if (scratch.has(a.stateOffsetToAddr(i))) continue;
    return true;
  }
  return false;
}

test("TEETH: broken twins are caught in memory on every writing arm", { skip }, () => {
  const rows = corpus();
  for (const [label, c] of rows) {
    assert.ok(biteInMemory(noOp, c), `the no-op twin escaped ${label}`);
    assert.ok(biteInMemory(scribbleData, c), `the data-scribble twin escaped ${label}`);
  }
  console.log(`  TEETH: no-op and data-scribble caught on all ${rows.length} writing entries`);
});

// The launch path picks one of two velocity arms by the era and lands the pair it hands back into the
// spawned record's 0x0a..0x0d cells. Those cells are ordinary work RAM the EQUAL comparison covers,
// so a dispatch that ran the wrong arm would land the wrong pair and fail EQUAL on one of the two
// live-spawn entries. This is the positive control that the two arms are genuinely different: pointed
// at the same heading they hand back different pairs, so choosing between them is observable and the
// EQUAL check above has teeth over the choice. If they ever agreed, EQUAL could not catch a swap.
const STAGE_HEADINGS = [0x08, 0x20, 0x40, 0x60, 0x80, 0xa0, 0xc0, 0xe0];
test("VELOCITY ARMS DIFFER: the two era arms hand back different vectors, so the dispatch is observable", { skip }, () => {
  const vec = (arm, heading) => {
    const m = bases()[0].clone();
    m.regs.ix = RECORD;
    m.mem8[RECORD + 0x02] = heading;
    arm(m);
    return [m.regs.e, m.regs.d, m.regs.c, m.regs.b];
  };
  let differing = 0;
  for (const h of STAGE_HEADINGS) {
    const a = vec(loc_598e, h);
    const b = vec(loc_5994, h);
    if (a.some((v, i) => v !== b[i])) differing++;
  }
  assert.ok(
    differing > 0,
    "the two velocity arms handed back the same vector on every heading tried, so a dispatch that " +
      "picked the wrong arm could never be caught by the EQUAL memory comparison",
  );
  console.log(`  VELOCITY ARMS DIFFER: ${differing} of ${STAGE_HEADINGS.length} headings distinguish the two arms`);
});

// ── the tamper derail ───────────────────────────────────────────────────────────────────

/**
 * Both sides on clones of `machine`, the oracle stopped on entry to a tamper landing. Returns each
 * side's fault class (null when it returned) and the first memory difference outside both sides'
 * push scratch — the two stop at the same program point, so the work before it must match.
 */
function compareToDerail(cand, machine) {
  const a = stopAtDerails(machine.clone()), b = machine.clone();
  const scratch = new Set();
  for (const mm of [a, b]) {
    const push = mm.push16.bind(mm);
    mm.push16 = (v) => { const sp = (mm.regs.sp - 2) & 0xffff; scratch.add(sp).add((sp + 1) & 0xffff); push(v); };
  }
  let fa = null, fb = null;
  try { oracle(a); } catch (e) { fa = faultClass(e); }
  try { cand(b); } catch (e) { fb = faultClass(e); }
  const da = a.dumpState(), db = b.dumpState();
  let escaped = null;
  for (let i = 0; i < da.length && escaped === null; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (!scratch.has(addr)) escaped = { addr, oracle: da[i], candidate: db[i] };
  }
  return { fa, fb, escaped };
}

/** BUG: ignores the tamper gate and ends the spent sequence cleanly. */
const noDerail = (m) => { m.mem8[TAMPER_GLYPH_COPY] = 0x7c; m.mem8[TAMPER_GLYPH_COPY + 1] = 0x10; candidate(m); };
/** BUG: takes the right landing, but before the spent sequence goes back to idle. */
const derailsEarly = () => derailIntoMotherShipWreckCountdown();

test("DERAIL: a tampered glyph copy stops both sides at 0x459b after the same work", { skip }, () => {
  let n = 0;
  for (const base of bases()) {
    const c = craft(base, SPEND_WARP[1], SPEND_WARP[2]);
    const r = compareToDerail(candidate, c);
    assert.equal(r.fa, "derail@0x459b", "the oracle did not fall into the 0x459b landing");
    assert.equal(r.fb, "derail@0x459b", `the rewrite did not raise at 0x459b (${r.fb})`);
    assert.equal(r.escaped, null, `escaped at ${r.escaped && hex4(r.escaped.addr)} oracle=${r.escaped && r.escaped.oracle} rewrite=${r.escaped && r.escaped.candidate}`);
    // The work before the transfer is real: the spent sequence goes idle and holds the round.
    assert.ok(footprintToDerail(c).size > 0, "the oracle wrote nothing before the transfer, so the memory check has no power");
    n++;
  }
  // The same bases with the pair intact end the sequence cleanly (the spend-idle arm), so the gate,
  // not the state byte, is what sends control to the landing.
  for (const base of bases()) {
    const c = craft(base, ...pick("spend-idle"));
    assert.equal(compareToDerail(candidate, c).fa, null, "the untampered spend reached a landing");
  }
  console.log(`  DERAIL: ${n} tampered spends stop at 0x459b on both sides after the same work`);
});

function footprintToDerail(machine) {
  const before = machine.dumpState().slice();
  const a = stopAtDerails(machine.clone());
  try { oracle(a); } catch { /* stopped at the landing */ }
  const now = a.dumpState();
  const cells = new Set();
  for (let i = 0; i < now.length; i++) {
    const addr = a.stateOffsetToAddr(i);
    if (now[i] !== before[i] && addr < STACK_FLOOR) cells.add(addr);
  }
  return cells;
}

test("TEETH: a twin that skips the tamper gate, or derails early, is CAUGHT", { skip }, () => {
  for (const base of bases()) {
    const c = craft(base, SPEND_WARP[1], SPEND_WARP[2]);
    const skipped = compareToDerail(noDerail, c);
    assert.notEqual(skipped.fa, skipped.fb, "the twin that ignores the tamper gate was not caught");
    const early = compareToDerail(derailsEarly, c);
    assert.equal(early.fb, early.fa, "the early twin must reach the same landing, so only memory can catch it");
    assert.notEqual(early.escaped, null, "a twin that derails before the idle work was not caught in memory");
  }
  console.log(`  TEETH/derail: the gate-skipping and early-derail twins caught on ${bases().length} bases`);
});
