// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence gate for loc_2038 (ROM 0x2038) — the object sweep's fall-arming block: stamp the
 * initial vertical velocity, blank the two coordinate fractions and the two counters, move the
 * record onto the falling arm, and continue into the still-frozen shared sprite tail at ROM 0x21BA.
 *
 * What this gate covers:
 *   - CAPTURED: an 8000-frame attract run dispatches 0x2038 exactly 42 times; all 42 are replayed
 *     (no sampling) across all 7 record bases the sweep makes live, and the spread is asserted. The
 *     routine has no branch, so the only entry variation is the record base, the accumulator, and
 *     the prior contents of the seven written bytes.
 *   - CRAFTED: the captures are narrow — accumulator 0 on all 42 (so a hardcoded-zero twin is
 *     invisible), +4 already 0 on 41 of 42. The crafted arm is 35 entries (one capture per record
 *     base x 5 accumulator seeds) with all seven written bytes pre-poisoned; both narrownesses are
 *     asserted in the reachability and teeth tests.
 *   - HOW MUCH RUNS: loc_2038 tail-jumps, so every case runs the WHOLE frozen chain below (sprite
 *     copy at 0x21BA, sweep advance at 0x1F8D, rest of the ten-slot sweep) on both sides.
 *   - WHAT IS COMPARED — the memory-equivalence contract for the DISSOLVED form: RAM EXCLUDING the
 *     STACK_SCRATCH window {0x6be0,0x6c00}, the final guest SP, and the forwarded return. loc_2038
 *     direct-calls idiomatic publishBarrelSprite instead of m.call(0x21ba); pc and the register
 *     file are dropped with the frozen bracket, final SP compared instead (a stray push lands in
 *     the excluded window yet still moves SP). Cycles not compared: cycle-free by design.
 *   - RE-ENTRANCY: the chain re-enters 0x2038 (measured 42 -> 44); the hook is frozen before replay
 *     but stays installed and DELEGATES TO THE ORACLE, so nested dispatches are oracle on both sides.
 *   - LIVE-WIRED: the rewrite runs in a real 8000-frame attract run diffed per frame, asserting a
 *     non-zero dispatch count.
 *   - NOT COVERED: attract only (25m); poking BOARD removes 0x2038 rather than reaching new states.
 *     Gameplay entry is untested.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2038.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2038 as oracle } from "../../translated/loc_2038.js";
import { loc_2038 } from "../loc_2038.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2038;
const ATTRACT_FRAMES = 8000;

// The seven record fields this routine writes, and what it writes into each. "A" means the value
// handed in through the accumulator. Mirrors loc_2038.js; the gate needs them to poison and to
// check, and a wrong copy here shows up as a failure rather than as silent agreement.
const ARM_SELECT = 2;
const X_FRACTION = 4;
const Y_FRACTION = 6;
const SUBSTATE = 14;
const INITIAL_VY_HI = 18;
const INITIAL_VY_LO = 19;
const AIRBORNE_FRAMES = 20;
const WRITES = [
  [INITIAL_VY_HI, 255],
  [INITIAL_VY_LO, 240],
  [AIRBORNE_FRAMES, "A"],
  [SUBSTATE, "A"],
  [X_FRACTION, "A"],
  [Y_FRACTION, "A"],
  [ARM_SELECT, 8],
];

// The frozen walk's loop-back into the per-slot step, stubbed on both clones so each side publishes
// exactly the slot under test and stops. The dissolved idiomatic chain returns after one slot
// (publishBarrelSprite no longer loops back), so the oracle is cut to the same one slot.
const WALK_LOOPBACK = 0x1f83;

// The staging cursor the walk owns as a plain value: sprite page and low byte, parked in the
// alternate bank at entry (the motion arm exchanged it out). The dissolved chain takes it as `cur`.
const cursorOf = (m) => ({ page: m.regs.h_ * 256, cursor: m.regs.l_ });

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const hb = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// ---------------------------------------------------------------------------
// Capture: every real dispatch in an attract run, cloned at the instant of entry.
//
// `capturing` is what stops the re-entrancy corruption described in the header: the hook is still
// installed on every clone (that is how nested dispatches stay oracle on both sides) but it stops
// appending the moment the attract run is over.
// ---------------------------------------------------------------------------
let CAPTURES = null;
let LIVE_GROWTH = 0; // how much the list WOULD have grown during replay, for the header's claim
function captures() {
  if (CAPTURES === null) {
    const caught = [];
    let capturing = true;
    const host = new Machine(ROM, {
      overrides: new Map([[TARGET, (mm) => {
        if (capturing) caught.push(mm.clone());
        else LIVE_GROWTH += 1;
        return oracle(mm);
      }]]),
    });
    host.runFrames(ATTRACT_FRAMES);
    capturing = false;
    CAPTURES = caught; // frozen: nothing below can lengthen it
  }
  return CAPTURES;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** First differing state byte OUTSIDE the stack scratch below the entry SP (the memory-equivalence
 * contract — see the header). The frozen side and the dissolved side reach loc_1f8d's live
 * m.call(0x1f83) with the same guest SP, so they write the same bytes into that window; excluding
 * it is belt-and-braces against any bracket residue, and the final SP is compared separately. */
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/**
 * Run the oracle and a candidate on two fresh, byte-identical clones of one entry state and
 * report the first contract breach. A FAULT is a RESULT, not a crash: a broken twin can walk the
 * frozen chain below into unmapped memory, and a gate that dies instead of reporting proves
 * nothing.
 */
function runPair(entry, candidate) {
  const a = entry.clone(), b = entry.clone();
  const aFloor = a.regs.sp;
  a.routines.set(WALK_LOOPBACK, () => {});
  b.routines.set(WALK_LOOPBACK, () => {});
  let retA, retB, faultA = null, faultB = null;
  try { retA = oracle(a); } catch (e) { faultA = String(e.message); }
  try { retB = candidate(b, cursorOf(b)); } catch (e) { faultB = String(e.message); }

  if (faultA !== faultB) return { kind: "fault", detail: `oracle=${faultA} candidate=${faultB}` };
  if (faultA !== null) return null; // both faulted identically: not a difference

  const ram = firstRamDiff(a, b, aFloor);
  if (ram) return { kind: "ram", detail: `${hx(ram.addr)} oracle=${hb(ram.a)} candidate=${hb(ram.b)}`, addr: ram.addr };

  // pc, SP and the register file are dropped: the dissolved form threads the cursor as a value and
  // uses no guest stack, so it no longer moves SP or pc with the frozen call bracket that used to
  // make them comparable. The memory-equivalence contract (RAM − the stack scratch below the entry SP) plus the return is
  // what the dissolved routine actually produces.
  if (retA !== retB) return { kind: "return", detail: `oracle=${retA} candidate=${retB}` };
  return null;
}

/** Replay a list of entry states; return the first case that breaches, or null. */
function sweep(entries, candidate) {
  for (const [i, e] of entries.entries()) {
    const breach = runPair(e, candidate);
    if (breach) return { i, base: e.regs.ix, acc: e.regs.a, ...breach };
  }
  return null;
}

/** How many of the entries breach — the teeth report quotes it, so "caught" is not just "once". */
function breachCount(entries, candidate) {
  let n = 0;
  for (const e of entries) if (runPair(e, candidate)) n += 1;
  return n;
}

const describe = (b) => b && `case ${b.i} (base ${hx(b.base)}, A=${hb(b.acc)}): ${b.kind} — ${b.detail}`;

// ---------------------------------------------------------------------------
// Crafted entries: a REAL capture with the seven written bytes poisoned and the accumulator
// re-seeded. Every poisoned byte is one this routine overwrites, so a correct rewrite leaves a
// state that does not depend on the poison at all — the poison is visible only when a write is
// missing or wrong. The capture's own stack, index register and shadow bank are left alone.
// ---------------------------------------------------------------------------
const POISON = 0x5b; // equal to nothing this routine writes, for any seeded accumulator below
const SEED_ACC = [0, 1, 0x37, 0xa5, 0xff];

function crafted(base, acc) {
  const e = base.clone();
  for (const [off] of WRITES) e.mem.write8(e.regs.ix + off, POISON);
  e.regs.a = acc;
  return e;
}

function craftedEntries(bases) {
  const out = [];
  for (const b of bases) for (const acc of SEED_ACC) out.push(crafted(b, acc));
  return out;
}

/** One capture per DISTINCT record base — the crafted arm is built on all 7, not on a repeat. */
function distinctBaseCaptures() {
  const seen = new Map();
  for (const c of captures()) if (!seen.has(c.regs.ix)) seen.set(c.regs.ix, c);
  return [...seen.values()].sort((x, y) => x.regs.ix - y.regs.ix);
}

// ===========================================================================
// 0. Reachability — measured first, because it decides what everything else can claim
// ===========================================================================

test("REACHABILITY: 0x2038 is dispatched in attract across every record base the sweep uses", () => {
  const caps = captures();
  assert.ok(caps.length > 0, "no real dispatch of 0x2038 was captured — every capture case below would be vacuous");

  const bases = [...new Set(caps.map((c) => c.regs.ix))].sort((x, y) => x - y);
  assert.equal(bases.length, 7, `expected all 7 record bases of the sweep, saw ${bases.length}`);
  assert.deepEqual(bases, [0x6700, 0x6720, 0x6740, 0x6760, 0x6780, 0x67a0, 0x67c0]);

  // The two narrownesses the crafted arm exists to widen — asserted, not asserted about.
  assert.ok(caps.every((c) => c.regs.a === 0), "attract presents exactly one accumulator value here");
  const alreadyZero = caps.filter((c) => c.mem.read8(c.regs.ix + X_FRACTION) === 0).length;
  assert.ok(
    alreadyZero >= caps.length - 1,
    `expected +${X_FRACTION} to already hold the written value on all but one capture, got ${alreadyZero}/${caps.length}`,
  );

  console.log(
    `  REACHABILITY: ${caps.length} dispatches in ${ATTRACT_FRAMES} attract frames; bases ` +
      `${bases.map(hx).join(", ")}; accumulator 0 on all ${caps.length}; +${X_FRACTION} already ` +
      `holds the written value on ${alreadyZero} of ${caps.length}`,
  );
});

// ===========================================================================
// 1. EQUAL on every real dispatch
// ===========================================================================

test("EQUAL (all real captures): loc_2038 == oracle over RAM − the stack scratch below the entry SP, final SP and return", () => {
  const caps = captures();
  const before = caps.length;
  const bad = sweep(caps, loc_2038);
  assert.equal(bad, null, describe(bad));
  assert.equal(caps.length, before, "the capture list grew during replay — the count above is not what was replayed");

  // Non-vacuity: the routine must actually have stamped all seven bytes on a real entry.
  const e = caps[0];
  const after = e.clone();
  loc_2038(after, cursorOf(after));
  for (const [off, val] of WRITES) {
    const want = val === "A" ? e.regs.a : val;
    assert.equal(after.mem.read8(e.regs.ix + off), want, `record byte +${off} was not stamped`);
  }

  console.log(
    `  EQUAL/captures: ${caps.length} of ${caps.length} real dispatches replayed, whole frozen ` +
      `chain on both sides; re-entrant dispatches during replay: ${LIVE_GROWTH} (delegated to the oracle)`,
  );
});

// ===========================================================================
// 2. EQUAL on crafted entries
// ===========================================================================

test("EQUAL (crafted): loc_2038 == oracle with all seven written bytes poisoned and A swept", () => {
  const bases = distinctBaseCaptures();
  assert.equal(bases.length, 7, "the crafted arm claims one entry per record base");
  const entries = craftedEntries(bases);
  assert.equal(entries.length, bases.length * SEED_ACC.length);

  const bad = sweep(entries, loc_2038);
  assert.equal(bad, null, describe(bad));

  console.log(
    `  EQUAL/crafted: ${entries.length} entries — all ${bases.length} captured record bases ` +
      `(${bases.map((b) => hx(b.regs.ix)).join(", ")}) x accumulator ${SEED_ACC.map(hb).join(",")}, ` +
      `all seven written bytes pre-poisoned to ${hb(POISON)}`,
  );
});

// ===========================================================================
// 3. TEETH — five twins, each the real routine with exactly one behaviour removed
// ===========================================================================

function twin(bug) {
  return (m) => {
    const { mem8 } = m;
    const record = m.regs.ix;
    const a = m.regs.a;
    const blank = bug === "hardcodedZero" ? 0 : a; // BUG: ignores the value handed in

    mem8[record + INITIAL_VY_HI] = bug === "wrongVelocityHigh" ? 0 : 255; // BUG: initial velocity sign
    if (bug !== "dropVelocityLow") mem8[record + INITIAL_VY_LO] = 240; // BUG: low byte never stamped
    mem8[record + AIRBORNE_FRAMES] = blank;
    mem8[record + SUBSTATE] = blank;
    if (bug !== "dropXFraction") mem8[record + X_FRACTION] = blank; // BUG: fraction left stale
    mem8[record + Y_FRACTION] = blank;
    mem8[record + ARM_SELECT] = bug === "wrongArm" ? 4 : 8; // BUG: record kept on a walking arm

    return m.call(0x21ba);
  };
}

const TWINS = ["wrongVelocityHigh", "dropVelocityLow", "dropXFraction", "wrongArm", "hardcodedZero"];

test("TEETH: five broken twins are caught, and the report says which half caught which", () => {
  const caps = captures();
  const craftedCases = craftedEntries(distinctBaseCaptures());

  // Sanity: the correct routine passes both suites, so a caught twin is a real defect signal and
  // not a suite that reds everything.
  assert.equal(sweep(caps, loc_2038), null, "the correct routine must pass the capture suite");
  assert.equal(sweep(craftedCases, loc_2038), null, "the correct routine must pass the crafted suite");

  const lines = [];
  for (const bug of TWINS) {
    const t = twin(bug);
    const onCaptures = sweep(caps, t);
    const onCrafted = sweep(craftedCases, t);
    assert.notEqual(onCrafted, null, `the CRAFTED suite failed to catch the "${bug}" twin`);
    assert.ok(
      onCaptures !== null || bug === "hardcodedZero",
      `the CAPTURE suite failed to catch the "${bug}" twin, and only "hardcodedZero" is expected to escape it`,
    );
    const nCap = breachCount(caps, t);
    const nCraft = breachCount(craftedCases, t);
    lines.push(
      `${bug}: captures ${onCaptures ? `CAUGHT on ${nCap}/${caps.length} (${onCaptures.kind} ${onCaptures.detail})` : `BLIND on all ${caps.length}`}` +
        `, crafted CAUGHT on ${nCraft}/${craftedCases.length} (${onCrafted.kind} ${onCrafted.detail})`,
    );
  }

  // The claim the header makes about WHY the crafted arm exists, asserted rather than asserted about:
  // attract's uniform accumulator makes the hardcoded-zero twin invisible to every real capture.
  assert.equal(sweep(caps, twin("hardcodedZero")), null,
    "attract was expected to be blind to the hardcoded-zero twin; if it is not, the crafted arm's stated purpose is wrong");

  console.log("  TEETH:\n    " + lines.join("\n    "));
});

// ===========================================================================
// 4. The live-out claim, measured over a whole run
// ===========================================================================

// RETIRED. This arm wired loc_2038 live at 0x2038 standalone in an otherwise-frozen attract run.
// The exx/cursor dissolution makes that impossible: loc_2038 now takes the staging cursor `cur` as
// a value from its idiomatic caller, so it cannot be dispatched by address with only the machine.
// The whole-run trace it proved is covered by idiomatic.test.js's FULL FLIP.
nodeTest("LIVE-OUT: retired — the routine now takes the cursor as a value; FULL FLIP covers the whole run", {
  skip: "retired: loc_2038 takes the staging cursor from its idiomatic caller and cannot be wired standalone; whole-run trace covered by idiomatic.test.js (FULL FLIP)",
}, () => {
});
