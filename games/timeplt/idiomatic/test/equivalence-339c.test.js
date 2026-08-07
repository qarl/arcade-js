// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_339c — memory-equivalent to the frozen oracle at ROM 0x339C.
 *
 * GATE: crafted-entry, because the strict one CANNOT run here. Neither the shared coin -> start
 *   tape nor an undriven session dispatches 0x339C in two thousand frames — nor does any of its
 *   three callers — so unitEquivalence throws "never entered" and the first arm ASSERTS that
 *   throw. The entry is BUILT instead: a real machine, cloned at the end of the tape's session,
 *   with the three cells this routine reads forced.
 *
 *   ONE EXCLUSION, the dead stack scratch: the frozen routine reaches its table lookup through a
 *   call, so the two bytes just below the entry stack pointer can hold that call's return slot.
 *   The window is exactly [SP-2, SP) and every arm PINS it.
 *
 * What it exercises, holes stated:
 *   1. UNREACHED — measured on both sessions and on all three callers, not assumed.
 *   2. NOT VACUOUS — an empty candidate FAILS the crafted comparison, from poisoned destinations.
 *   3. EXCLUDED — the register divergence pinned to a measured set.
 *   4. EXHAUSTIVE — the whole input space is three bytes, and all of it is swept: three states of
 *      the player-up flag against every one of 256 index values, with the OTHER player's index
 *      set to a different value at each point so a routine that read the wrong one is visible.
 *      The doubling of the index wraps at eight bits, so indices past the half-way mark fold back
 *      onto the head of the table; those are in the sweep too.
 *   5. THE TWO PLAYERS DO NOT CROSS — asserted directly: the field the routine does not write is
 *      left exactly as it was found.
 *   6. TEETH — seven twins, each caught on an exact count of crafted entries. Two score three
 *      and six short of the total, which is where a wrong index happens to select the same two
 *      bytes as the right one; the counts record that rather than rounding it away.
 *
 * HOLE: one backdrop, and the table the routine reads is part of the program image rather than
 * anything this file varies — so what is covered is the SELECTION and the copy, not the contents
 * of what gets copied.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-339c.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_339c } from "../loc_339c.js";
import { loc_339c as oracle } from "../../translated/loc_339c.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { u8, u16 } from "../../../../core/int.js";
import { ACTIVE_PLAYER } from "../names.js";

const TARGET = 0x339c;
const skip = romsPresent() ? false : "ROM images are gitignored and absent";

const SCRATCH_BYTES = 2;
const PLAYER_ONE_ROUND = 0xad14;
const PLAYER_TWO_ROUND = 0xad24;
const PLAYER_ONE_FIELD = 0xad1b;
const PLAYER_TWO_FIELD = 0xad2b;
const FIELD_TABLE = 0x0f8d;
const FIELD_WIDTH = 2;

const CORPUS_FRAMES = 2000;
const TAPES = [["shared", {}], ["attract", { tape: [] }]];
/** The three sites that transfer here. None of them runs either, which is asserted. */
const CALLERS = [0x49fa, 0x4a0f, 0x4a42];
const EXCLUDED = ["f", "b", "c", "d", "e", "l", "sp"];

const UP_STATES = [0, 1, 0xff];
/** A poison the correct answer never leaves in either field. */
const POISON = 0xa5;
const LIVE_POINT = [0, 0];

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: frozen=${d.a} candidate=${d.b}` : "identical");

// ── the session, and the entry built off it ─────────────────────────────────────────────

let session = null;
function sessionRun() {
  if (session) return session;
  let host = null;
  let threw = null;
  try {
    unitEquivalence((overrides) => (host = makeMachine(overrides)), TARGET, oracle, loc_339c, {
      maxFrames: ENTRY_FRAMES,
    });
  } catch (e) {
    threw = e;
  }
  session = { host, threw };
  return session;
}

let pristineEntry = null;
function pristine() {
  if (!pristineEntry) pristineEntry = sessionRun().host.clone();
  return pristineEntry;
}

const inScratch = (addr, sp) => addr >= sp - SCRATCH_BYTES && addr < sp;

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b).find((d) => !inScratch(d.addr, sp)) ?? null;
}

function craft([up, round]) {
  const m = pristine().clone();
  m.mem8[ACTIVE_PLAYER] = up;
  m.mem8[PLAYER_ONE_ROUND] = round;
  m.mem8[PLAYER_TWO_ROUND] = u8(255 - round);
  for (const field of [PLAYER_ONE_FIELD, PLAYER_TWO_FIELD]) {
    m.mem8[field] = POISON;
    m.mem8[field + 1] = POISON;
  }
  return m;
}

const POINTS = [];
for (const up of UP_STATES) for (let round = 0; round < 256; round++) POINTS.push([up, round]);

function sweepCaught(candidate) {
  let caught = 0;
  for (const spec of POINTS) if (unitDiff(candidate, craft(spec))) caught++;
  return caught;
}

function dispatchCounts(opts) {
  const counts = new Map([[TARGET, 0], ...CALLERS.map((a) => [a, 0])]);
  const overrides = new Map();
  for (const addr of counts.keys()) {
    overrides.set(addr, (mm) => {
      counts.set(addr, counts.get(addr) + 1);
      return addr === TARGET ? oracle(mm) : undefined;
    });
  }
  const m = makeMachine(overrides, opts);
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return counts;
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

function copyField(m, { crossPlayers = false, width = FIELD_WIDTH, bytes = 2, offset = true } = {}) {
  const { mem8 } = m;
  const secondUp = mem8[ACTIVE_PLAYER] !== 0;
  const readerIsSecond = crossPlayers ? !secondUp : secondUp;
  const field = secondUp ? PLAYER_TWO_FIELD : PLAYER_ONE_FIELD;
  const round = mem8[readerIsSecond ? PLAYER_TWO_ROUND : PLAYER_ONE_ROUND];
  const entry = u16(FIELD_TABLE + (offset ? u8(round * width) : 0));
  for (let i = 0; i < bytes; i++) mem8[u16(field + i)] = mem8[u16(entry + i)];
}

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: the index is read from the OTHER player's record. */
function brokenReadsTheOtherPlayer(m) {
  copyField(m, { crossPlayers: true });
}

/** BUG: the index is not scaled, so it selects a field straddling two entries. */
function brokenIndexNotScaled(m) {
  copyField(m, { width: 1 });
}

/** BUG: only the first byte of the field is copied. */
function brokenCopiesOneByte(m) {
  copyField(m, { bytes: 1 });
}

/** BUG: a third byte is copied, past the end of the field. */
function brokenCopiesThreeBytes(m) {
  copyField(m, { bytes: 3 });
}

/** BUG: the index never reaches the table, so the head of it is copied every time. */
function brokenAlwaysTakesTheFirstEntry(m) {
  copyField(m, { offset: false });
}

/** BUG: the field lands in the other player's record. */
function brokenWritesTheOtherPlayer(m) {
  const { mem8 } = m;
  const secondUp = mem8[ACTIVE_PLAYER] !== 0;
  const field = secondUp ? PLAYER_ONE_FIELD : PLAYER_TWO_FIELD;
  const round = mem8[secondUp ? PLAYER_TWO_ROUND : PLAYER_ONE_ROUND];
  const entry = u16(FIELD_TABLE + u8(round * FIELD_WIDTH));
  mem8[field] = mem8[entry];
  mem8[u16(field + 1)] = mem8[u16(entry + 1)];
}

const TWINS = [
  ["no-op", brokenNoOp, 768],
  ["reads-the-other-player", brokenReadsTheOtherPlayer, 768],
  ["index-not-scaled", brokenIndexNotScaled, 765],
  ["copies-one-byte", brokenCopiesOneByte, 768],
  ["copies-three-bytes", brokenCopiesThreeBytes, 768],
  ["always-takes-the-first-entry", brokenAlwaysTakesTheFirstEntry, 762],
  ["writes-the-other-player", brokenWritesTheOtherPlayer, 768],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("UNREACHED: neither the routine nor any of its callers runs", { skip }, () => {
  assert.notEqual(sessionRun().threw, null, "the shared tape now reaches this routine, so the " +
    "strict unit-capture gate is available and this file should use it");
  assert.match(String(sessionRun().threw), /never entered/, "the harness failed for another reason");
  for (const [label, opts] of TAPES) {
    for (const [addr, n] of dispatchCounts(opts)) {
      assert.equal(n, 0, `the ${label} session dispatches ${hex4(addr)} ${n} times`);
    }
  }
  console.log(
    `  UNREACHED: over ${TAPES.length} sessions of ${CORPUS_FRAMES} frames, neither this routine ` +
      `nor any of its ${CALLERS.length} callers runs once`,
  );
});

test("NOT VACUOUS: a candidate that does nothing FAILS, from poisoned fields", { skip }, () => {
  const d = unitDiff(brokenNoOp, craft(LIVE_POINT));
  assert.notEqual(d, null, "the comparison passed an empty candidate, so it measures nothing");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: registers and pc, and the scratch push", { skip }, () => {
  const a = craft(LIVE_POINT);
  const b = a.clone();
  oracle(a);
  loc_339c(b);
  assert.deepEqual(
    REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
    EXCLUDED,
    "the excluded set changed shape",
  );
  assert.notEqual(a.pc, b.pc, "the frozen routine's return moves pc; the rewrite returns to JS");
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")} and pc`);
});

test("EXHAUSTIVE: three states of the player-up flag against every index", { skip }, () => {
  assert.equal(sweepCaught(loc_339c), 0, "the rewrite diverged somewhere in the crafted space");
  const folding = POINTS.filter(([, round]) => round * FIELD_WIDTH > 255).length;
  assert.ok(folding > 0, "vacuous: no swept index folds back onto the head of the table");
  console.log(`  EXHAUSTIVE: ${POINTS.length} crafted entries identical, ${folding} of them folding`);
});

test("THE TWO PLAYERS DO NOT CROSS: the other field is left exactly as found", { skip }, () => {
  for (const [up, expected, untouched] of [
    [0, PLAYER_ONE_FIELD, PLAYER_TWO_FIELD],
    [1, PLAYER_TWO_FIELD, PLAYER_ONE_FIELD],
  ]) {
    const m = craft([up, 2]);
    loc_339c(m);
    assert.notEqual(m.mem8[expected], POISON, `${hex4(expected)} was not written`);
    assert.equal(m.mem8[untouched], POISON, `${hex4(untouched)} was written as well`);
    assert.equal(m.mem8[untouched + 1], POISON, `${hex4(untouched + 1)} was written as well`);
  }
  console.log("  NO CROSSING: each state of the flag writes its own field and leaves the other");
});

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.equal(sweepCaught(twin), expected, `the ${label} twin's catch count moved`);
    assert.ok(expected > 0, `the ${label} twin is not caught at all`);
    console.log(`  TEETH/${label}: caught on ${expected} of ${POINTS.length} crafted entries`);
  });
}
