// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_215f (ROM 0x215F) — hand one object's position to the grader,
 * then fall into the shared object-sprite tail.
 *
 * loc_215f writes no work RAM itself. It stages three register values for startBarrelDescentAtLadder
 * (the search key, the second field plus five as the vertical discriminator, and 21 as the scan
 * count) and jumps to loc_21ba, still the frozen oracle. So oracle and candidate BOTH run the whole
 * shared tail and everything downstream to its `ret`; the contract is:
 *   - RAM identical minus the stack scratch below the entry SP (the oracle's push/ret bracket and two nested lookup pushes
 *     are the only dead stack; the deepest guest push reaches 0x6BE2, inside STACK_SCRATCH).
 *   - The return value the walk's tail propagates back to loc_1FF6's caller.
 * pc and SP are not compared: cycle-free code cannot preserve pc, and SP is the tail chain's
 * business (the LIVE case checked guest SP over a whole run instead).
 *
 * The tail chain RE-ENTERS 0x215F for later slots and clone() carries the override map, so the
 * capture list is frozen before any replay and the hook stays installed to run the ORACLE on both
 * sides — making each replay a unit test of ONE dispatch.
 *
 *   1. REACHABILITY — 0x215F dispatched 605 times in a 4000-frame attract run.
 *   2. EQUAL (captured) — every one of the 605 is replayed (no sample); all three lookup arms
 *      (table miss, tag-0 hit, tag-1 hit) and both velocity signs are asserted present.
 *   3. EQUAL (swept, crafted) — attract presents only 27 keys / 58 rows and never wraps +5, so both
 *      live-ins are swept over all 256 values on a real captured base.
 *   4/5. LIVE / LIVE-OUT — retired (see the skip below).
 *   6. TEETH — three broken twins the captured replay MUST catch: the dropped +5 on the
 *      discriminator, the two live-ins swapped, and a scan count of 10 instead of 21.
 *
 * The scan count is held only from BELOW: 10 diverges on capture 2, but 42 is byte-identical across
 * all captures and both sweeps (a longer scan matters only when it finds a key the short scan
 * missed, which no reachable state does). "21" is justified by the table's de-interleave stride.
 * ALL OF THIS IS ATTRACT. Gameplay is not covered by any case here.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-215f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_215f as oracle } from "../../translated/loc_215f.js";
import { loc_215f } from "../loc_215f.js";
import { startBarrelDescentAtLadder } from "../startBarrelDescentAtLadder.js"; // the direct callee, reused to build faithful broken twins
import { findOppositeLadderEnd } from "../findOppositeLadderEnd.js"; // classifies each capture's lookup arm for coverage evidence
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x215f;
const CAPTURE_FRAMES = 4000; // the run the captured/teeth cases draw from
const LIVE_FRAMES = 2500;    // the whole-machine run cases 4 and 5 compare
// Produced by the capture loop below and ASSERTED, not assumed — the run is deterministic,
// so a drift in any of these three is a change in what this gate covers.
const EXPECTED_CAPTURES = 605;
const EXPECTED_DISTINCT_KEYS = 27;
const EXPECTED_DISTINCT_ROWS = 58;

// What the routine stages for the grader — repeated here so a twin can get one wrong.
const PARAM_TABLE_COLUMN = 21;
const DISCRIMINATOR_OFFSET = 5;

// The shadow-bank fields the candidate leaves different from the oracle, and the poison
// values case 5 stamps into them.
const SHADOW_RESIDUE = ["b_", "c_", "e_", "h_", "l_"];

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs, skipping the stack scratch below the entry SP. { addr, a, b } | null.
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
 * Capture every real 0x215F dispatch of an attract run. The list is FROZEN when the run
 * ends (the hook stops recording) because the routine's own tail chain re-enters 0x215F
 * during replay; the hook stays installed so those nested dispatches run the oracle.
 */
let CAPTURES = null;
function captureAttract() {
  if (CAPTURES) return CAPTURES; // the run is deterministic; five cases share one pass
  const orig = new Machine(ROM).routines.get(TARGET);
  let recording = true;
  const caps = [];
  const host = new Machine(ROM, {
    overrides: new Map([[TARGET, (mm) => {
      if (recording) caps.push(mm.clone());
      return orig(mm);
    }]]),
  });
  host.runFrames(CAPTURE_FRAMES);
  recording = false;
  CAPTURES = caps;
  return caps;
}

/**
 * Run the oracle and a candidate on two fresh, byte-identical clones and return the
 * contract diffs: RAM − the stack scratch below the entry SP, plus the return value.
 */
// The frozen walk's loop-back into the per-slot step, stubbed on both clones so each side publishes
// exactly the slot under test and stops. The dissolved idiomatic chain returns after one slot
// (publishBarrelSprite no longer loops back). The staging cursor the walk owns as a value is parked
// in the alternate bank at entry (the coordinate registers h/l are the ladder detour's own scratch);
// the dissolved chain takes it as `cur`.
const WALK_LOOPBACK = 0x1f83;
const cursorOf = (m) => ({ page: m.regs.h_ * 256, cursor: m.regs.l_ });

function contractDiffs(entry, candidate) {
  const a = entry.clone();
  const b = entry.clone();
  a.routines.set(WALK_LOOPBACK, () => {});
  b.routines.set(WALK_LOOPBACK, () => {});
  const ra = oracle(a);
  const rb = candidate(b, cursorOf(b));
  const diffs = [];
  const ram = firstRamDiff(a, b, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (ra !== rb) diffs.push(`return oracle=${String(ra)} cand=${String(rb)}`);
  return diffs;
}

/** Which arm the grader's table lookup takes for this entry: "miss" | "tag0" | "tag1". */
function lookupArm(entry) {
  const probe = entry.clone();
  probe.regs.d = probe.regs.l + DISCRIMINATOR_OFFSET;
  probe.regs.a = probe.regs.h;
  probe.regs.bc = PARAM_TABLE_COLUMN;
  if (!findOppositeLadderEnd(probe).hit) return "miss";
  return probe.regs.a === 1 ? "tag1" : "tag0";
}

/** A real capture with ONE register nudged — the crafted-entry form. */
function nudge(entry, reg, value) {
  const e = entry.clone();
  e.regs[reg] = value;
  return e;
}

// -- 1. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x215F is dispatched during boot/attract", () => {
  const caps = captureAttract();
  assert.ok(caps.length > 0, "0x215F should dispatch — the object walk runs in the attract demo");
  assert.equal(caps.length, EXPECTED_CAPTURES,
    `the header claims ${EXPECTED_CAPTURES} captures in ${CAPTURE_FRAMES} frames; the run produced ${caps.length}`);
  console.log(`  REACHABILITY: ${caps.length} natural 0x215F dispatches in ${CAPTURE_FRAMES} frames`);
});

// -- 2. EQUAL (every captured dispatch) ---------------------------------------

test("EQUAL (captured): loc_215f == oracle on EVERY real dispatch", () => {
  const caps = captureAttract();
  const arms = { miss: 0, tag0: 0, tag1: 0 };
  const bases = new Set();
  const velocities = new Set();
  const shapes = new Set();
  const keys = new Set();
  const rows = new Set();

  for (const cap of caps) {
    const diffs = contractDiffs(cap, loc_215f);
    assert.equal(diffs.length, 0,
      `captured dispatch (H=${hx(cap.regs.h)} L=${hx(cap.regs.l)} BC=${hx(cap.regs.bc)} IX=${hx(cap.regs.ix)}): ${diffs.join("; ")}`);
    arms[lookupArm(cap)]++;
    bases.add(cap.regs.ix);
    velocities.add(cap.regs.bc);
    keys.add(cap.regs.h);
    rows.add(cap.regs.l);
    shapes.add(`${cap.regs.h},${cap.regs.l},${cap.regs.bc},${cap.regs.ix}`);
  }

  // Non-vacuity: the replay must actually span the grader's three lookup outcomes and
  // both directions of travel, or "605 dispatches" would be 605 copies of one arm.
  assert.ok(arms.miss > 0, "no captured dispatch missed the table");
  assert.ok(arms.tag0 > 0, "no captured dispatch produced a tag-0 hit");
  assert.ok(arms.tag1 > 0, "no captured dispatch produced a tag-1 hit");
  assert.equal(velocities.size, 2, `expected both velocity signs among the captures, saw ${velocities.size}`);
  assert.ok(bases.size >= 5, `expected several object records among the captures, saw ${bases.size}`);

  // The two numbers the headers use to justify the swept case existing at all.
  assert.equal(keys.size, EXPECTED_DISTINCT_KEYS, `distinct search keys in attract: ${keys.size}`);
  assert.equal(rows.size, EXPECTED_DISTINCT_ROWS, `distinct row fields in attract: ${rows.size}`);
  assert.equal([...rows].filter((v) => v + DISCRIMINATOR_OFFSET > 255).length, 0,
    "attract was expected never to produce a row field whose +5 wraps");

  console.log(
    `  EQUAL/captured: all ${caps.length} real dispatches identical (RAM − the stack scratch below the entry SP + return) — ` +
      `${shapes.size} distinct entry shapes, ${bases.size} record bases, ${keys.size} search keys, ` +
      `${rows.size} row fields (none wrapping), lookup arms ` +
      `miss=${arms.miss} tag0=${arms.tag0} tag1=${arms.tag1}`,
  );
});

// -- 3. EQUAL (swept live-ins, crafted) ---------------------------------------

test("EQUAL (swept): both live-ins swept over all 256 values on a real base", () => {
  const caps = captureAttract();
  const base = caps[0];

  const sweep = (reg, label) => {
    const arms = { miss: 0, tag0: 0, tag1: 0 };
    for (let v = 0; v < 256; v++) {
      const entry = nudge(base, reg, v);
      const diffs = contractDiffs(entry, loc_215f);
      assert.equal(diffs.length, 0, `${label}=${hx(v)}: ${diffs.join("; ")}`);
      arms[lookupArm(entry)]++;
    }
    return arms;
  };

  const keyArms = sweep("h", "searchKey");
  const rowArms = sweep("l", "rowField");

  // Non-vacuity: a sweep that only ever missed the table would prove nothing about the
  // values this routine stages, since a miss ignores the discriminator entirely.
  assert.ok(keyArms.tag0 + keyArms.tag1 > 0, "the search-key sweep never hit the table");
  assert.ok(rowArms.tag0 + rowArms.tag1 > 0, "the row-field sweep never hit the table");

  console.log(
    `  EQUAL/swept: 256 search keys (miss=${keyArms.miss} tag0=${keyArms.tag0} tag1=${keyArms.tag1}) and ` +
      `256 row fields (miss=${rowArms.miss} tag0=${rowArms.tag0} tag1=${rowArms.tag1}) — all identical, ` +
      "including the 251..255 rows whose +5 wraps and which attract never produces",
  );
});

// -- 4/5. LIVE / LIVE-OUT (retired) -------------------------------------------

// RETIRED (both arms). These wired loc_215f live at 0x215F standalone in an otherwise-frozen attract
// run, and probed the shadow-bank residue the old exx form left. The exx/cursor dissolution makes
// both obsolete: loc_215f now takes the staging cursor `cur` as a value from its idiomatic caller
// (advanceRollingBarrel) and touches no shadow bank at all, so it cannot be dispatched by address
// with only the machine and there is no shadow residue to poison. The whole-run trace and the
// guest-SP balance they proved are covered by idiomatic.test.js's FULL FLIP ("all idiomatic routines
// live, guest stack balanced every frame").
nodeTest("LIVE / LIVE-OUT: retired — the routine takes the cursor as a value and touches no shadow bank; FULL FLIP covers the whole run", {
  skip: "retired: loc_215f takes the staging cursor from its idiomatic caller and no longer uses the shadow bank; whole-run trace + guest-SP balance covered by idiomatic.test.js (FULL FLIP)",
}, () => {});

// -- 6. TEETH -----------------------------------------------------------------

const SHORT_SCAN = 10; // the wrong scan count the third twin stages (see the header)

/**
 * A faithful re-implementation of loc_215f with a single switchable bug, so each twin is
 * the real routine minus one correct behaviour (it reuses the real, gated startBarrelDescentAtLadder).
 */
function brokenLoc215f(m, bug) {
  const { regs } = m;
  const key = bug === "swap" ? regs.l : regs.h;
  const row = bug === "swap" ? regs.h : regs.l;
  regs.d = row + (bug === "noOffset" ? 0 : DISCRIMINATOR_OFFSET);
  regs.a = key;
  regs.bc = bug === "shortScan" ? SHORT_SCAN : PARAM_TABLE_COLUMN;
  startBarrelDescentAtLadder(m);
  return m.call(0x21ba);
}

test("TEETH: dropped +5, swapped live-ins and a wrong scan count are all CAUGHT", () => {
  const caps = captureAttract();

  // Sanity: the real routine passes the same replay, so a caught twin is a real signal.
  for (const cap of caps) {
    assert.equal(contractDiffs(cap, loc_215f).length, 0, "the correct routine must pass the replay");
  }

  // A twin that walks off the mapped address space is a divergence too — the oracle
  // completes on the same entry — so record it rather than letting it abort the case.
  const firstCatch = (bug) => {
    for (let i = 0; i < caps.length; i++) {
      let diffs;
      try {
        diffs = contractDiffs(caps[i], (mm) => brokenLoc215f(mm, bug));
      } catch (e) {
        return `capture ${i}: threw where the oracle completed — ${e.message}`;
      }
      if (diffs.length > 0) return `capture ${i}: ${diffs.join("; ")}`;
    }
    return null;
  };

  const noOffset = firstCatch("noOffset");
  assert.notEqual(noOffset, null, "the replay FAILED to catch a dropped +5 — the discriminator offset is unproven");
  const swap = firstCatch("swap");
  assert.notEqual(swap, null, "the replay FAILED to catch swapped live-ins — the key/row roles are unproven");
  const shortScan = firstCatch("shortScan");
  assert.notEqual(shortScan, null, `the replay FAILED to catch a scan count of ${SHORT_SCAN} — the count is unproven`);

  console.log(
    `  TEETH: dropped +5 caught (${noOffset}); swapped live-ins caught (${swap}); ` +
      `scan count ${SHORT_SCAN} caught (${shortScan})`,
  );
});
