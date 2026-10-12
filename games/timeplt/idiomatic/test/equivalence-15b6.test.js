// SPDX-License-Identifier: GPL-3.0-only
/**
 * hideAllSprites — memory-equivalent to the frozen oracle at ROM 0x15B6.
 *
 * GATE: crafted-entry. The real dispatch is kept as one arm, but it is only PARTLY informative
 *   and the teeth live on entries this file builds.
 *
 * What it exercises, holes stated:
 *   1. EQUAL at the real dispatch. Driven by the coin -> start tape, 0x15B6 first enters at
 *      frame 402; an undriven attract run of 2000 frames never enters it at all, so this
 *      routine is reachable only once a coin is taken.
 *   2. BLIND, PINNED. At that entry only the first four of the twenty-four target cells hold a
 *      non-zero value, so twenty of the twenty-four writes put zero over zero and are
 *      invisible. Asserted both ways: the no-op twin IS caught there (so the RAM diff is not a
 *      tautology), and a twin clearing only those first four is NOT. No larger maxFrames helps
 *      — unitEquivalence clones the FIRST entry.
 *   3. CRAFTED, EXHAUSTIVE over the write-set boundary. For every address in 0xAA30-0xAA7F the
 *      band is zeroed, that one address is marked, and both arms run: the pair must agree, and
 *      exactly 24 markers must be cleared, at exactly the expected addresses. This is what
 *      pins WHICH cells move, and every twin below is scored by an exact catch count over it.
 *   4. REGISTERS AND PC ARE EXCLUDED, DELIBERATELY, and the excluded set is measured rather
 *      than assumed. Two whole-session arms complement every general register at the dispatch
 *      seam: doing it BEFORE the routine changes nothing anywhere in 2000 frames (it consumes
 *      no register), and doing it AFTER changes exactly two bytes of dead stack scratch below
 *      the return (nothing consumes one either). The after-arm is what proves the before-arm
 *      is not blind: the same complement IS observable, just nowhere that matters.
 *   5. WHOLE SESSION with the rewrite wired through the real callers, 2000 frames, three
 *      dispatches, run asserted complete. Divergence is exactly four bytes of stack scratch.
 *
 * HOLE, and it is deliberate: the rewrite models no stack, so the session arms bracket it with
 * the return the translated callers' manual push expects. Without that bracket the mixed layer
 * unwinds and the run dies at frame 1256 — the documented mixed-migration leak, recorded here
 * rather than fixed, since the four residual bytes are asserted, not excluded.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-15b6.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { hideAllSprites } from "../hideAllSprites.js";
import { loc_15b6 as oracle } from "../../translated/loc_15b6.js";
import { firstStateDiff, unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const skip = romsPresent() ? false : "ROM images are gitignored and absent";

const TARGET = 0x15b6;
const FIRST_VERTICAL = 0xaa41;
const SLOT_STRIDE = 2;
const SLOT_COUNT = 24;
const CLEARED = Array.from({ length: SLOT_COUNT }, (_, s) => FIRST_VERTICAL + s * SLOT_STRIDE);
const LAST_VERTICAL = CLEARED[SLOT_COUNT - 1];

const BAND_LO = 0xaa30;
const BAND_HI = 0xaa80;
const BAND_SIZE = BAND_HI - BAND_LO;
const MARKER = 0xc3;

const SESSION_FRAMES = 2000;
const SESSION_DISPATCHES = 3;
const STACK_SCRATCH = [0xafe2, 0xafe3, 0xaffd, 0xaffe];
const SEEN_BY_DISPLAY = 0xb43f;

// The registers the memory-equivalence contract drops. Written out so it cannot quietly widen:
// arm 4 complements this exact list at the seam AND bounds the moved set by MOVED_BY_THE_PAIR,
// so adding a name to either changes what it claims.
const WIDE_REGS = new Set(["ix", "iy"]);
const EXCLUDED_REGS = ["a", "f", "b", "c", "d", "e", "h", "l", "ix", "iy"];
const MOVED_BY_THE_PAIR = ["a", "f", "b", "h", "l", "sp"];

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const hexList = (xs) => xs.map(hex4).join(" ");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

// ── the unit gate, with the real entry harvested off the candidate arm's clone ───────────────

let entry = null;

function gate(candidate) {
  return unitEquivalence(
    makeMachine,
    TARGET,
    oracle,
    (m) => {
      if (entry === null) entry = m.clone();
      return candidate(m);
    },
    { maxFrames: ENTRY_FRAMES },
  );
}

function entryState() {
  if (entry === null) gate(hideAllSprites);
  return entry;
}

/** Slots holding a non-zero native-Y position at the captured entry — the only ones it can see. */
function liveSlotsAtEntry() {
  const live = [];
  for (let s = 0; s < SLOT_COUNT; s++) if (entryState().mem8[CLEARED[s]] !== 0) live.push(s);
  return live;
}

// ── crafted entries: the band zeroed, one address marked ─────────────────────────────────────

function craft(marked) {
  const m = entryState().clone();
  for (let a = BAND_LO; a < BAND_HI; a++) m.mem8[a] = 0;
  m.mem8[marked] = MARKER;
  return m;
}

function craftedDiff(candidate, marked) {
  const a = craft(marked);
  const b = craft(marked);
  oracle(a);
  candidate(b);
  return firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
}

function sweepCaught(candidate) {
  let caught = 0;
  for (let p = BAND_LO; p < BAND_HI; p++) if (craftedDiff(candidate, p)) caught++;
  return caught;
}

// ── whole-session plumbing ───────────────────────────────────────────────────────────────────

let baseline = null;

function baseSession() {
  if (baseline === null) {
    const m = makeMachine();
    const frames = m.runFrames(SESSION_FRAMES);
    assert.equal(m.stoppedBy, null, "baseline session stopped early");
    assert.equal(frames.length, SESSION_FRAMES, "baseline session was truncated");
    baseline = { frames, offToAddr: (o) => m.stateOffsetToAddr(o) };
  }
  return baseline;
}

/** Every address whose byte differed from the baseline on any frame of a full session. */
function sessionDiff(fn) {
  const { frames, offToAddr } = baseSession();
  let dispatches = 0;
  const m = makeMachine(new Map([[TARGET, (mm) => (dispatches++, fn(mm))]]));
  const got = m.runFrames(SESSION_FRAMES);
  const addrs = new Set();
  for (let f = 0; f < Math.min(frames.length, got.length); f++) {
    const a = frames[f];
    const b = got[f];
    for (let o = 0; o < a.length; o++) if (a[o] !== b[o]) addrs.add(offToAddr(o));
  }
  return { dispatches, stoppedBy: m.stoppedBy, frames: got.length, addrs: [...addrs].sort((x, y) => x - y) };
}

/** A truncated session finds no divergence and reads as a pass, so every arm asserts this. */
function assertSessionRan(r, label) {
  assert.equal(r.stoppedBy, null, `${label}: the session stopped early`);
  assert.equal(r.frames, SESSION_FRAMES, `${label}: the session was truncated`);
  assert.equal(r.dispatches, SESSION_DISPATCHES, `${label}: the routine did not dispatch`);
}

/** The seam bracket: a translated caller pushes its own return, so something must pop it. */
const withReturn = (fn) => (m) => {
  fn(m);
  m.ret();
};

const flipRegisters = (m) => {
  for (const k of EXCLUDED_REGS) m.regs[k] ^= WIDE_REGS.has(k) ? 0xffff : 0xff;
};

// ── arm 1: the real dispatch ─────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: hideAllSprites == oracle on RAM", { skip }, () => {
  const r = gate(hideAllSprites);
  assert.equal(r.ram, null, `RAM diverged — ${show(r.ram)}`);
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  console.log(`  EQUAL: entered within ${ENTRY_FRAMES} frames; RAM identical`);
});

// ── arm 2: what that dispatch cannot see, pinned ─────────────────────────────────────────────

test("BLIND: the real dispatch sees only four of the twenty-four writes", { skip }, () => {
  assert.deepEqual(liveSlotsAtEntry(), [0, 1, 2, 3], "the captured entry changed shape");

  const caught = gate(() => {});
  assert.notEqual(caught.ram, null, "the no-op twin PASSED — RAM is a tautology at this entry");

  const fourOnly = (m) => {
    for (const s of [0, 1, 2, 3]) m.mem8[CLEARED[s]] = 0;
  };
  const missed = gate(fourOnly);
  assert.equal(missed.ram, null, "the four-slot twin now fails here; re-derive the blindness");
  console.log(`  BLIND: four live slots; the four-slot twin passes, the no-op twin is caught`);
});

// ── arm 3: crafted entries, exhaustive over the band ─────────────────────────────────────────

test("CRAFTED: the pair agrees on every one of the band's marked entries", { skip }, () => {
  let swept = 0;
  for (let p = BAND_LO; p < BAND_HI; p++) {
    const d = craftedDiff(hideAllSprites, p);
    assert.equal(d, null, `marker at ${hex4(p)}: ${show(d)}`);
    swept++;
  }
  assert.equal(swept, BAND_SIZE, "the sweep must cover the whole band");
  console.log(`  CRAFTED: ${swept} marked entries identical`);
});

test("WRITE-SET: exactly the twenty-four expected cells are cleared, and nothing else", { skip }, () => {
  const cleared = [];
  const mangled = [];
  const m = entryState().clone();
  for (let a = BAND_LO; a < BAND_HI; a++) m.mem8[a] = MARKER;
  hideAllSprites(m);
  for (let a = BAND_LO; a < BAND_HI; a++) {
    if (m.mem8[a] === 0) cleared.push(a);
    else if (m.mem8[a] !== MARKER) mangled.push(a);
  }
  assert.deepEqual(cleared, CLEARED, "the write-set moved");
  assert.deepEqual(mangled, [], `cells changed to a third value: ${hexList(mangled)}`);
  assert.equal(cleared.length, SLOT_COUNT, "one cell per slot");
  console.log(`  WRITE-SET: ${cleared.length} cells, ${hex4(cleared[0])}..${hex4(LAST_VERTICAL)}`);
});

// ── arm 4: the excluded registers, measured ──────────────────────────────────────────────────

test("EXCLUDED, deliberately: registers and pc diverge and nothing else does", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  hideAllSprites(b);

  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  const unexpected = moved.filter((k) => !MOVED_BY_THE_PAIR.includes(k));
  assert.deepEqual(unexpected, [], "a register diverged outside the excluded set");
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  for (const addr of CLEARED) assert.equal(a.mem8[addr], b.mem8[addr], `live-out ${hex4(addr)}`);
  console.log(`  EXCLUDED: registers ${moved.join(", ")} and pc — RAM unaffected`);
});

test("LIVE-IN: complementing every register BEFORE the routine changes nothing", { skip }, () => {
  const r = sessionDiff((m) => {
    flipRegisters(m);
    oracle(m);
  });
  assertSessionRan(r, "live-in");
  assert.deepEqual(r.addrs, [], `the routine consumes a register: ${hexList(r.addrs)}`);
  console.log(`  LIVE-IN: ${EXCLUDED_REGS.length} registers complemented, ${r.frames} frames identical`);
});

test("LIVE-OUT: complementing every register AFTER it reaches only dead stack scratch", { skip }, () => {
  const r = sessionDiff((m) => {
    oracle(m);
    flipRegisters(m);
  });
  assertSessionRan(r, "live-out");
  assert.deepEqual(r.addrs, [0xafe2, 0xafe3], `a caller consumes a register: ${hexList(r.addrs)}`);
  console.log(`  LIVE-OUT: memory only — the complement lands in ${hexList(r.addrs)} and nowhere else`);
});

// ── arm 5: the rewrite through a whole session ───────────────────────────────────────────────

test("SESSION: the rewrite dispatches through the real callers for the whole run", { skip }, () => {
  const r = sessionDiff(withReturn(hideAllSprites));
  assertSessionRan(r, "session");
  assert.deepEqual(r.addrs, STACK_SCRATCH, `state diverged outside the scratch: ${hexList(r.addrs)}`);
  console.log(`  SESSION: ${r.frames} frames, ${r.dispatches} dispatches, scratch ${hexList(r.addrs)}`);
});

// ── teeth ────────────────────────────────────────────────────────────────────────────────────
// A gate that cannot fail is worthless. Each twin is a plausible way to get this routine wrong,
// and each is scored by an EXACT count over the same crafted sweep the real arm passes clean.

/** BUG: does nothing at all — the tell that a gate is measuring an unreached routine. */
const twinNoOp = () => {};

/** BUG: clears only the four slots that happen to be live at the real dispatch. */
const twinFourOnly = (m) => {
  for (const s of [0, 1, 2, 3]) m.mem8[CLEARED[s]] = 0;
};

/** BUG: walks one cell per slot instead of two, so it eats the neighbouring field. */
const twinStrideOne = (m) => {
  for (let s = 0; s < SLOT_COUNT; s++) m.mem8[FIRST_VERTICAL + s] = 0;
};

/** BUG: stops one slot early, leaving the last sprite where it was. */
const twinOneShort = (m) => {
  for (let s = 0; s < SLOT_COUNT - 1; s++) m.mem8[CLEARED[s]] = 0;
};

/** BUG: runs one slot past the end, into whatever follows the table. */
const twinOneOver = (m) => {
  for (let s = 0; s <= SLOT_COUNT; s++) m.mem8[FIRST_VERTICAL + s * SLOT_STRIDE] = 0;
};

/** BUG: starts one cell low, so it clears the companion field of every slot instead. */
const twinShiftedBase = (m) => {
  for (let s = 0; s < SLOT_COUNT; s++) m.mem8[FIRST_VERTICAL - 1 + s * SLOT_STRIDE] = 0;
};

for (const [label, twin, expected] of [
  ["no-op", twinNoOp, 24],
  ["four-slot", twinFourOnly, 20],
  ["stride-one", twinStrideOne, 24],
  ["one-short", twinOneShort, 1],
  ["one-over", twinOneOver, 1],
  ["shifted-base", twinShiftedBase, 48],
]) {
  test(`TEETH: the ${label} twin is CAUGHT on exactly ${expected} crafted entries`, { skip }, () => {
    assert.equal(sweepCaught(hideAllSprites), 0, "the real arm must pass the comparison scoring the twin");
    const caught = sweepCaught(twin);
    assert.equal(caught, expected, `the ${label} twin scored ${caught} of ${BAND_SIZE}`);
    console.log(`  TEETH/${label}: caught on ${caught} of ${BAND_SIZE} crafted entries`);
  });
}

test("TEETH: the no-op twin is CAUGHT across a whole session, out to the display", { skip }, () => {
  const r = sessionDiff(withReturn(twinNoOp));
  assertSessionRan(r, "no-op session");
  assert.equal(r.addrs.length, 40, `the no-op twin moved ${hexList(r.addrs)}`);
  assert.ok(r.addrs.includes(SEEN_BY_DISPLAY), "the divergence never reached the display");
  for (const addr of STACK_SCRATCH) assert.ok(r.addrs.includes(addr), `scratch ${hex4(addr)} missing`);
  console.log(`  TEETH/no-op session: ${r.addrs.length} addresses, reaching ${hex4(SEEN_BY_DISPLAY)}`);
});

test("TEETH: the one-short twin strands exactly one sprite, all the way to the display", { skip }, () => {
  const r = sessionDiff(withReturn(twinOneShort));
  assertSessionRan(r, "one-short session");
  assert.deepEqual(
    r.addrs,
    [LAST_VERTICAL, ...STACK_SCRATCH, SEEN_BY_DISPLAY].sort((x, y) => x - y),
    `the stranded slot did not surface where expected: ${hexList(r.addrs)}`,
  );
  console.log(`  TEETH/one-short session: ${hex4(LAST_VERTICAL)} stranded, ${hex4(SEEN_BY_DISPLAY)} follows`);
});
