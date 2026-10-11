// SPDX-License-Identifier: GPL-3.0-only
/**
 * destroyPlayerAndMotherShipOnContactByEra — memory-equivalent to the frozen oracle at ROM 0x50B1. It picks a collision box by the
 * era: two eras transfer to the wider check (destroyPlayerAndMotherShipOnContact), the rest run a narrower one inline. Both
 * dissolved transfers land in already-decompiled modules, so the oracle's tail ret is gone and RAM
 * is compared with the dead stack scratch below the seated SP masked out, the +2 SP re-seat and the
 * return value checked, and registers bounded rather than compared. The tapes reach this entry
 * (unlike destroyPlayerAndMotherShipOnContact) but only ever on the inline path with the destroy conditions unmet, so the
 * destroy and transfer paths are exercised by a crafted sweep. Run:
 *   node --test games/timeplt/idiomatic/test/equivalence-50b1.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { destroyPlayerAndMotherShipOnContactByEra as candidate } from "../destroyPlayerAndMotherShipOnContactByEra.js";
import { loc_50b1 as oracle } from "../../translated/loc_50b1.js";
import { destroyPlayerAndMotherShipOnContact } from "../destroyPlayerAndMotherShipOnContact.js";
import { postChainedHitScore } from "../postChainedHitScore.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { ERA_INDEX, PLAYER_STATE, MOTHER_SHIP_STATE } from "../names.js";
import { u8, u16 } from "../../../../core/int.js";

const TARGET = 0x50b1;
const ENTRY = 0xaa10;
const ENTRY_SECOND_AXIS = 49;
const CLEARED_BESIDE = 0xa8a4;
const SECOND_FIRST_AXIS = 0xaa24;
const SECOND_SECOND_AXIS = 0xaa55;

const LIVE = 255;
const DESTROYED = 240;
const WIDE_ERAS = [0, 4];
const FIRST_AXIS_REACH = 6;
const FIRST_AXIS_SPAN = 13;
const SECOND_AXIS_REACH = 25;
const SECOND_AXIS_SPAN = 35;

// The transfer's score helper brackets its work below the seated SP; measured, then pinned.
const SCRATCH_BYTES = 6;
const SCRATCH_OFFSETS = [-6, -5, -4, -3, -2, -1];
const DATA_TOP = 0xadff;

// a and f carry the four tests, the oracle loads the sprite base into ix and the rewrite does not,
// and the dropped ret lifts sp. A bound over the crafted space, not a per-entry list.
const EXCLUDED = ["a", "f", "ix", "sp"];

const CORPUS_FRAMES = 6000;
const NATURAL = { "coin-start": 8, attract: 325 };
const CRAFTED_DESTROYS = 304;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const within = (a, b, reach, span) => u8(u8(a - b) + reach) < span;

// ── the masked comparison ─────────────────────────────────────────────────────────────────

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

function unitDiff(cand, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  cand(b);
  return allDiffs(a, b).find((d) => !inScratch(d.addr, sp)) ?? null;
}

const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

// ── the natural corpus, captured from the tapes ─────────────────────────────────────────────

function session(cand, opts) {
  let dispatches = 0;
  let caught = 0;
  let firstLive = 0;
  let bothLive = 0;
  let pastAxis1 = 0;
  let destroyed = 0;
  let first = null;
  const m = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    if (first === null) first = mm.clone();
    const one = mm.mem8[PLAYER_STATE] === LIVE;
    const two = one && mm.mem8[MOTHER_SHIP_STATE] === LIVE;
    const near = two &&
      within(mm.mem8[SECOND_FIRST_AXIS], mm.mem8[ENTRY], FIRST_AXIS_REACH, FIRST_AXIS_SPAN);
    if (one) firstLive++;
    if (two) bothLive++;
    if (near) pastAxis1++;
    if (unitDiff(cand, mm)) caught++;
    const after = oracle(mm);
    if (mm.mem8[PLAYER_STATE] === DESTROYED && mm.mem8[MOTHER_SHIP_STATE] === DESTROYED) destroyed++;
    return after;
  }]]), opts);
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, firstLive, bothLive, pastAxis1, destroyed, first };
}

let baseCache = null;
function entryState() {
  if (baseCache === null) baseCache = session(candidate, { tape: [] }).first;
  assert.notEqual(baseCache, null, "vacuous: the attract tape never reached the entry");
  return baseCache;
}

// ── the crafted space ───────────────────────────────────────────────────────────────────────

const ERAS = [0, 1, 4];
const STATE_PAIRS = [[LIVE, LIVE], [LIVE, 0], [0, LIVE], [0, 0]];
const BASES = [0x00, 0xf8];
const INSIDE = 100;

function craft(era, one, two, firstBase, firstCoord, secondBase, secondCoord) {
  const m = entryState().clone();
  m.mem8[ERA_INDEX] = era;
  m.mem8[PLAYER_STATE] = one;
  m.mem8[MOTHER_SHIP_STATE] = two;
  m.mem8[ENTRY] = firstBase;
  m.mem8[SECOND_FIRST_AXIS] = firstCoord;
  m.mem8[u16(ENTRY + ENTRY_SECOND_AXIS)] = secondBase;
  m.mem8[SECOND_SECOND_AXIS] = secondCoord;
  return m;
}

function overSweep(fn) {
  for (const era of ERAS) {
    for (const [one, two] of STATE_PAIRS) {
      for (const base of BASES) {
        for (let c = 0; c < 256; c++) fn(craft(era, one, two, base, c, INSIDE, INSIDE));
      }
      for (const base of BASES) {
        for (let c = 0; c < 256; c++) fn(craft(era, one, two, INSIDE, INSIDE, base, c));
      }
    }
  }
}

const SWEEP_SIZE = ERAS.length * STATE_PAIRS.length * BASES.length * 256 * 2;

function sweepCaught(cand) {
  let caught = 0;
  overSweep((m) => {
    if (unitDiff(cand, m)) caught++;
  });
  return caught;
}

// ── the twins ─────────────────────────────────────────────────────────────────────────────

function variant({ eras = WIDE_ERAS, r1 = FIRST_AXIS_REACH, s1 = FIRST_AXIS_SPAN,
  r2 = SECOND_AXIS_REACH, s2 = SECOND_AXIS_SPAN,
  skipFirst = false, skipSecond = false, keepThird = false, noScore = false } = {}) {
  return (m) => {
    const { mem8 } = m;
    if (eras.includes(mem8[ERA_INDEX])) return destroyPlayerAndMotherShipOnContact(m);
    if (!skipFirst && mem8[PLAYER_STATE] !== LIVE) return;
    if (!skipSecond && mem8[MOTHER_SHIP_STATE] !== LIVE) return;
    if (!within(mem8[SECOND_FIRST_AXIS], mem8[ENTRY], r1, s1)) return;
    if (!within(mem8[SECOND_SECOND_AXIS], mem8[u16(ENTRY + ENTRY_SECOND_AXIS)], r2, s2)) return;
    mem8[PLAYER_STATE] = DESTROYED;
    mem8[MOTHER_SHIP_STATE] = DESTROYED;
    if (!keepThird) mem8[CLEARED_BESIDE] = 0;
    if (!noScore) postChainedHitScore(m);
    return undefined;
  };
}

// label, twin, crafted catches. only-era-zero and wide-inline are the destroyPlayerAndMotherShipOnContactByEra-specific teeth: one
// runs era 4 down the narrow inline path, the other widens the inline window to destroyPlayerAndMotherShipOnContact's.
const TWINS = [
  ["no-op", () => {}, 304],
  ["only-era-zero", variant({ eras: [0] }), 8],
  ["wide-inline", variant({ r1: 8, s1: 17 }), 8],
  ["ignores-first-state", variant({ skipFirst: true }), 96],
  ["ignores-second-state", variant({ skipSecond: true }), 96],
  ["keeps-third-cell", variant({ keepThird: true }), 96],
  ["no-score", variant({ noScore: true }), 96],
  ["axis1-span-narrow", variant({ s1: FIRST_AXIS_SPAN - 1 }), 2],
  ["axis2-centred", variant({ r2: 17 }), 32],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────────

test("REACHED: both tapes dispatch this entry, always inline, and never through the destroy path",
  { skip }, () => {
    for (const [label, opts] of [["coin-start", {}], ["attract", { tape: [] }]]) {
      const s = session(candidate, opts);
      assert.ok(s.dispatches > 0, `vacuous: the ${label} tape never reached the entry`);
      assert.equal(s.dispatches, NATURAL[label], `the ${label} dispatch count moved`);
      assert.equal(s.caught, 0, `the rewrite diverged on a ${label} dispatch`);
      // ★ The destroy path never runs on real data; the guard-progress counts are the positive
      // control that the same tap WOULD have seen a destroy had one occurred.
      assert.equal(s.destroyed, 0, `the ${label} tape now drives a real destroy; re-derive the hole`);
      assert.ok(s.firstLive > 0, `dead instrument: no ${label} dispatch arrives with the first live`);
      console.log(`  REACHED/${label}: ${s.dispatches} dispatches, ${s.bothLive} both-live, ` +
        `${s.pastAxis1} past axis 1, 0 destroys`);
    }
  });

test("EQUAL at a real dispatch: RAM identical outside the masked stack scratch", { skip }, () => {
  const base = entryState();
  const d = unitDiff(candidate, base);
  assert.equal(d, null, d && `escaped the mask: ${show(d)}`);
  const a = base.clone();
  const b = base.clone();
  oracle(a);
  candidate(b);
  assert.equal(a.regs.sp - b.regs.sp, 2, "the oracle pops the caller's return and the rewrite does not");
  console.log(`  EQUAL: era ${base.mem8[ERA_INDEX]}, sp ${hex4(base.regs.sp)}, identical outside scratch`);
});

test("EXHAUSTIVE: eras x state pairs x each axis over 256 coordinates from two bases", { skip }, () => {
  let destroys = 0;
  overSweep((m) => {
    const a = m.clone();
    oracle(a);
    if (a.mem8[PLAYER_STATE] === DESTROYED && a.mem8[MOTHER_SHIP_STATE] === DESTROYED) destroys++;
  });
  assert.equal(destroys, CRAFTED_DESTROYS, "the crafted destroy count moved");
  assert.equal(sweepCaught(candidate), 0, "the rewrite diverged somewhere in the crafted space");
  console.log(`  EXHAUSTIVE: ${SWEEP_SIZE} comparisons identical, ${destroys} destroying`);
});

test("TRANSFER: eras 0 and 4 delegate to the wide check, which really differs from the narrow one",
  { skip }, () => {
    // A first-axis coord in the +/-7,+/-8 band destroys under the wide window but not the narrow.
    const bandCoord = INSIDE + 8;
    assert.equal(unitDiff(candidate, craft(0, LIVE, LIVE, INSIDE, bandCoord, INSIDE, INSIDE)), null,
      "the era-0 transfer diverged");
    assert.equal(unitDiff(candidate, craft(4, LIVE, LIVE, INSIDE, bandCoord, INSIDE, INSIDE)), null,
      "the era-4 transfer diverged");
    const wide = craft(0, LIVE, LIVE, INSIDE, bandCoord, INSIDE, INSIDE).clone();
    const narrow = craft(1, LIVE, LIVE, INSIDE, bandCoord, INSIDE, INSIDE).clone();
    oracle(wide);
    oracle(narrow);
    assert.equal(wide.mem8[PLAYER_STATE], DESTROYED, "the wide window did not destroy in its band");
    assert.equal(narrow.mem8[PLAYER_STATE], LIVE, "the narrow window destroyed in the wide-only band");
    console.log("  TRANSFER: eras 0 and 4 destroy in the wide-only band, era 1 does not");
  });

test("MASK is load-bearing: the destroy entries differ unmasked, all inside the pinned window",
  { skip }, () => {
    let unmasked = 0;
    const offsets = new Set();
    let floor = Infinity;
    overSweep((m) => {
      const sp = m.regs.sp;
      const a = m.clone();
      const b = m.clone();
      oracle(a);
      candidate(b);
      const diffs = allDiffs(a, b);
      if (diffs.length === 0) return;
      unmasked++;
      for (const d of diffs) {
        offsets.add(d.addr - sp);
        if (d.addr < floor) floor = d.addr;
      }
    });
    assert.equal(unmasked, CRAFTED_DESTROYS, "the count an UNMASKED comparison rejects moved");
    assert.deepEqual([...offsets].sort((a, b) => a - b), SCRATCH_OFFSETS, "the scratch window changed shape");
    assert.ok(floor > DATA_TOP, `the mask floor ${hex4(floor)} reached into game data`);
    console.log(`  MASK: ${unmasked} of ${SWEEP_SIZE} differ unmasked, all in [sp-${SCRATCH_BYTES}, sp)`);
  });

test("EXCLUDED, deliberately: register divergence is bounded over the whole crafted space", { skip }, () => {
  const moved = new Set();
  overSweep((m) => {
    const a = m.clone();
    const b = m.clone();
    oracle(a);
    candidate(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  });
  const unexpected = REG_FIELDS.filter((k) => moved.has(k) && !EXCLUDED.includes(k));
  assert.deepEqual(unexpected, [], "a register diverged outside the excluded set");
  console.log(`  EXCLUDED: ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")}; live-out is memory`);
});

test("SP and RETURN: +2 on every crafted path, and both sides return the same", { skip }, () => {
  for (const m of [
    craft(1, LIVE, LIVE, INSIDE, INSIDE, INSIDE, INSIDE),
    craft(1, 0, LIVE, INSIDE, INSIDE, INSIDE, INSIDE),
    craft(0, LIVE, LIVE, INSIDE, INSIDE, INSIDE, INSIDE),
    craft(4, 0, 0, INSIDE, INSIDE, INSIDE, INSIDE),
  ]) {
    const a = m.clone();
    const b = m.clone();
    const r1 = oracle(a);
    const r2 = candidate(b);
    assert.equal(a.regs.sp - b.regs.sp, 2, "the SP drift moved off the dropped return");
    assert.equal(r1, r2, "the return value diverged");
  }
  console.log("  SP: +2 on destroy, non-destroy and transfer paths; returns identical");
});

for (const [label, twin, craftedCaught] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.ok(craftedCaught > 0, `the ${label} twin is not caught at all`);
    assert.equal(sweepCaught(twin), craftedCaught, `the ${label} twin's crafted catch count moved`);
    console.log(`  TEETH/${label}: caught on ${craftedCaught} of ${SWEEP_SIZE} crafted entries`);
  });
}
