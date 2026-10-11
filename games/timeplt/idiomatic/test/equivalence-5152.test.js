// SPDX-License-Identifier: GPL-3.0-only
/**
 * destroySlotsAndPlayerOnContact — memory-equivalent to the frozen oracle at ROM 0x5152.
 *
 * GATE: unit-capture judged by a MASKED RAM diff, a replayed corpus of every dispatch from two
 *   sessions, a crafted sweep that drives the sweep into and out of both windows, and teeth.
 *
 *   THE ONE EXCLUSION is the dead stack scratch: on a hit the frozen routine calls the scoring
 *   post, which pushes further, so up to eight bytes below the entry stack pointer can hold
 *   return slots the rewrite never writes. The window is exactly [SP-8, SP) and every arm PINS
 *   it — each walks the whole dump and asserts no divergence escapes it.
 *
 * What it exercises, holes stated:
 *   1. EQUAL at the real dispatch — identical outside that eight-byte window.
 *   2. NOT VACUOUS — an empty candidate FAILS, at a crafted entry that really registers a hit,
 *      because the real dispatch need not have one.
 *   3. CORPUS — every dispatch of a driven and an undriven session, counts asserted, with the
 *      number of dispatches that actually HIT reported, so a corpus of pure misses is visible
 *      rather than read as coverage.
 *   4. EXCLUDED — the register divergence pinned to a measured set.
 *   5. CRAFTED — both of the player's coordinates swept over their whole 0..255 against a slot
 *      that is in range on the other axis, which walks the sweep in and out of each window in
 *      turn; plus the caller's bias and width varied, both states of the player's own mark, and
 *      a run length of zero, which the routine treats as a full two hundred and fifty-six; and
 *      a family with SEVERAL slots seated on the player at once, which is the only one where a
 *      sweep that stops at its first hit can be told from one that carries on.
 *   6. TEETH — eight twins, each caught on an exact count of crafted entries. Several score in
 *      single figures, and those numbers are the family's shape rather than a weakness: a twin
 *      that only differs once the player has ALREADY been taken can differ on the handful of
 *      points that reach that state, and no more.
 *
 * HOLE: the crafted family leaves the record and entry cursors where the captured dispatch had
 * them, so the two strides are exercised only through the slots that dispatch presents. The
 * wrong-stride twins are caught by that, but a stride error that lands on another LIVE slot
 * would not be, and nothing here rules that out.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-5152.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { destroySlotsAndPlayerOnContact } from "../destroySlotsAndPlayerOnContact.js";
import { postChainedHitScore } from "../postChainedHitScore.js";
import { loc_5152 as oracle } from "../../translated/loc_5152.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { u8, u16 } from "../../../../core/int.js";
import { PLAYER_STATE } from "../names.js";

const TARGET = 0x5152;
const skip = romsPresent() ? false : "ROM images are gitignored and absent";

const SCRATCH_BYTES = 8;
const PLAYER_FIRST = 0xaa10;
const PLAYER_SECOND = 0xaa41;
const WHOLE = 0xff;
const HIT = 0xf0;
const FIRST_COORDINATE = 0x00;
const SECOND_COORDINATE = 0x31;
const SECOND_BIAS = 8;
const SECOND_WIDTH = 17;
const RECORD_STRIDE = 16;
const ENTRY_STRIDE = 2;

const CORPUS_FRAMES = 2000;
const TAPES = [["shared", {}], ["attract", { tape: [] }]];
/** Dispatches each session produces in CORPUS_FRAMES frames. Measured; a move here is a finding. */
const DISPATCHES = { shared: 300, attract: 440 };

// a/f are dissolved-arithmetic residue; b is the loop counter the rewrite leaves at its entry value
// where the oracle's djnz lands on 0; sp reflects the oracle's nested score-post pushes. E and IY are
// NOT excluded: they carry the record/entry cursor thread on into the next unarmed sweep
// (destroyEraObjectsAndPlayerOnContact), so the rewrite hands them back exactly as loc_5152 does.
const EXCLUDED = ["a", "f", "b", "sp"];

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: frozen=${d.a} candidate=${d.b}` : "identical");

// ── the entry, and the masked comparison ────────────────────────────────────────────────

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
  if (entry === null) gate(destroySlotsAndPlayerOnContact);
  return entry;
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

/** Does the frozen routine take at least one slot from this state? */
function hits(machine) {
  const probe = machine.clone();
  oracle(probe);
  return probe.mem8[PLAYER_STATE] === HIT && machine.mem8[PLAYER_STATE] === WHOLE;
}

/**
 * A crafted entry. The FIRST slot of the run is forced whole and seated on the player, so the
 * sweep really can reach the marking arm; everything else is what the session left.
 */
function craft({
  first, second, playerState = WHOLE, bias = null, width = null, slots = null, seated = 1,
}) {
  const m = entryState().clone();
  m.mem8[PLAYER_STATE] = playerState;
  m.mem8[PLAYER_FIRST] = first;
  m.mem8[PLAYER_SECOND] = second;
  for (let i = 0; i < seated; i++) {
    m.mem8[(m.regs.de & 0xff00) | u8(m.regs.de + i * RECORD_STRIDE)] = WHOLE;
    const slot = u16(m.regs.iy + i * ENTRY_STRIDE);
    m.mem8[u16(slot + FIRST_COORDINATE)] = 0x80;
    m.mem8[u16(slot + SECOND_COORDINATE)] = 0x80;
  }
  if (bias !== null) m.regs.l = bias;
  if (width !== null) m.regs.h = width;
  if (slots !== null) m.regs.b = slots;
  return m;
}

function craftedPoints() {
  const points = [];
  for (let v = 0; v < 256; v++) {
    points.push({ first: v, second: 0x80 });
    points.push({ first: 0x80, second: v });
  }
  for (const bias of [0, 7, 255]) {
    for (const width of [1, 15, 255]) points.push({ first: 0x80, second: 0x80, bias, width });
  }
  for (const playerState of [WHOLE, HIT, 0]) points.push({ first: 0x80, second: 0x80, playerState });
  for (const slots of [0, 1, 3, 7]) points.push({ first: 0x80, second: 0x80, slots });
  // Several slots seated on the player at once: the only family in which a sweep that stops at
  // the first slot it takes can differ from one that carries on.
  for (const seated of [2, 3, 4]) points.push({ first: 0x80, second: 0x80, seated });
  return points;
}

const POINTS = craftedPoints();

function sweepCaught(candidate) {
  let caught = 0;
  for (const spec of POINTS) if (unitDiff(candidate, craft(spec))) caught++;
  return caught;
}

// ── replaying whole sessions ────────────────────────────────────────────────────────────

function replaySession(opts, candidate) {
  let dispatches = 0;
  let caught = 0;
  let hitting = 0;
  const m = makeMachine(
    new Map([[TARGET, (mm) => {
      dispatches++;
      if (hits(mm)) hitting++;
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
    opts,
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, hitting };
}

let sessionCache = null;
function sessions() {
  if (!sessionCache) {
    sessionCache = TAPES.map(([label, opts]) => ({ label, ...replaySession(opts, destroySlotsAndPlayerOnContact) }));
  }
  return sessionCache;
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

function sweepSlots(m, {
  checkPlayer = true,
  stopAtFirst = false,
  secondWidth = SECOND_WIDTH,
  markPlayer = true,
  markSlot = true,
  recordStride = RECORD_STRIDE,
  entryStride = ENTRY_STRIDE,
  score = true,
} = {}) {
  const { mem8, regs } = m;
  if (checkPlayer && mem8[PLAYER_STATE] !== WHOLE) return;
  let record = regs.de;
  let slot = regs.iy;
  let left = regs.b;
  do {
    const acrossFirst = u8(mem8[PLAYER_FIRST] - mem8[u16(slot + FIRST_COORDINATE)]);
    const acrossSecond = u8(mem8[PLAYER_SECOND] - mem8[u16(slot + SECOND_COORDINATE)]);
    if (
      mem8[record] === WHOLE &&
      u8(acrossFirst + regs.l) < regs.h &&
      u8(acrossSecond + SECOND_BIAS) < secondWidth
    ) {
      if (markPlayer) mem8[PLAYER_STATE] = HIT;
      if (markSlot) mem8[record] = HIT;
      if (score) postChainedHitScore(m);
      if (stopAtFirst) return;
    }
    record = (record & 0xff00) | u8(record + recordStride);
    slot = u16(slot + entryStride);
    left = u8(left - 1);
  } while (left !== 0);
}

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: the sweep runs even when the player has already been taken. */
function brokenIgnoresThePlayerGuard(m) {
  sweepSlots(m, { checkPlayer: false });
}

/** BUG: the sweep stops at the first slot it takes. */
function brokenStopsAtTheFirst(m) {
  sweepSlots(m, { stopAtFirst: true });
}

/** BUG: the fixed window is one wider. */
function brokenSecondWindowTooWide(m) {
  sweepSlots(m, { secondWidth: SECOND_WIDTH + 1 });
}

/** BUG: the slot is taken and the player walks away. */
function brokenDoesNotMarkThePlayer(m) {
  sweepSlots(m, { markPlayer: false });
}

/** BUG: the player is taken and the slot survives. */
function brokenDoesNotMarkTheSlot(m) {
  sweepSlots(m, { markSlot: false });
}

/** BUG: the record cursor steps by the sprite-entry stride. */
function brokenWrongRecordStride(m) {
  sweepSlots(m, { recordStride: ENTRY_STRIDE });
}

/** BUG: no score is posted for what it takes. */
function brokenPostsNoScore(m) {
  sweepSlots(m, { score: false });
}

const TWINS = [
  ["no-op", brokenNoOp, 45],
  ["ignores-the-player-guard", brokenIgnoresThePlayerGuard, 2],
  ["stops-at-the-first", brokenStopsAtTheFirst, 3],
  ["second-window-too-wide", brokenSecondWindowTooWide, 1],
  ["does-not-mark-the-player", brokenDoesNotMarkThePlayer, 45],
  ["does-not-mark-the-slot", brokenDoesNotMarkTheSlot, 45],
  ["wrong-record-stride", brokenWrongRecordStride, 3],
  ["posts-no-score", brokenPostsNoScore, 45],
];

const hittingEntry = () => craft({ first: 0x80, second: 0x80 });

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside the eight-byte scratch window", { skip }, () => {
  gate(destroySlotsAndPlayerOnContact);
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  const sp = entryState().regs.sp;
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  destroySlotsAndPlayerOnContact(b);
  const strays = allDiffs(a, b).filter((d) => !inScratch(d.addr, sp));
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  console.log(
    `  EQUAL: records=${hex4(entryState().regs.de)} slots=${entryState().regs.b} ` +
      `bias=${entryState().regs.l} width=${entryState().regs.h} hit=${hits(entryState())}`,
  );
});

test("NOT VACUOUS: an empty candidate FAILS, at an entry that really takes a slot", { skip }, () => {
  const hitting = hittingEntry();
  assert.ok(hits(hitting), "the crafted entry no longer reaches the marking arm");
  const d = unitDiff(brokenNoOp, hitting);
  assert.notEqual(d, null, "the masked diff passed an empty candidate at a hitting entry");
  console.log(`  NOT VACUOUS: caught at a hitting entry — ${show(d)}`);
});

test("CORPUS: every dispatch of two whole sessions, with the hits it found", { skip }, () => {
  let total = 0;
  let hitting = 0;
  for (const s of sessions()) {
    assert.equal(s.dispatches, DISPATCHES[s.label], `the ${s.label} dispatch count moved`);
    assert.ok(s.dispatches > 0, `vacuous: the ${s.label} tape never reached the routine`);
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
    hitting += s.hitting;
  }
  console.log(
    `  CORPUS: ${total} dispatches, identical on each; ${hitting} of them take a slot — ` +
      sessions().map((s) => `${s.label} ${s.hitting}/${s.dispatches}`).join(", "),
  );
});

test("EXCLUDED, deliberately: registers and pc, and the scratch pushes", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  destroySlotsAndPlayerOnContact(b);
  assert.deepEqual(
    REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
    EXCLUDED,
    "the excluded set changed shape",
  );
  assert.notEqual(a.pc, b.pc, "the frozen routine's return moves pc; the rewrite returns to JS");
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")} and pc`);
});

test("CRAFTED: both coordinates swept in and out of both windows", { skip }, () => {
  assert.equal(sweepCaught(destroySlotsAndPlayerOnContact), 0, "the rewrite diverged somewhere in the crafted space");
  const hitting = POINTS.filter((p) => hits(craft(p))).length;
  assert.ok(hitting > 0, "vacuous: no crafted point reaches the marking arm");
  assert.ok(hitting < POINTS.length, "every crafted point hits, so the misses are not covered");
  console.log(`  CRAFTED: ${POINTS.length} entries identical, ${hitting} of them taking a slot`);
});

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.equal(sweepCaught(twin), expected, `the ${label} twin's catch count moved`);
    assert.ok(expected > 0, `the ${label} twin is not caught at all`);
    console.log(`  TEETH/${label}: caught on ${expected} of ${POINTS.length} crafted entries`);
  });
}
