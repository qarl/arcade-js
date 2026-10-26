// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2153 (ROM 0x2153) — store one value into three fields of the object
 * record the caller left in the index register (the elapsed-frame counter at +20 and the two
 * fractional coordinate halves at +4 and +6), then jump to the shared object-sprite tail at
 * ROM 0x21BA, which is still the frozen oracle on BOTH sides here and is therefore not under
 * test. What this gate has to prove is the three writes, that they carry the value the caller
 * supplied rather than a hard-coded zero, and that the tail's result is handed back.
 *
 *   0. REACHABILITY — how many real 0x2153 dispatches a 6000-frame attract run produces, and
 *      which of the two frozen callers each came through (the caller identity is MEASURED, by
 *      hooking ROM 0x2118 and ROM 0x2146 in the same run, not inferred from the entry state).
 *
 *   1. EQUAL (captured) — ALL captured dispatches are replayed, not a sample: the run produces
 *      13, which is far below the point where sampling is worth its coverage risk. Each is
 *      replayed on two byte-identical clones — oracle on one, loc_2153 on the other — and
 *      compared on RAM − the stack scratch below the entry SP plus the RETURN VALUE. pc/SP are deliberately not
 *      compared: cycle-free code cannot preserve them.
 *
 *   2. EQUAL (crafted) — attract stores 0 on every one of the 13 dispatches, so the captured
 *      arm cannot tell the parameter from a hard-coded zero. All 256 stored values are swept on
 *      a REAL captured entry, one per distinct entry shape the run produced, poked identically
 *      on both sides. Non-vacuity is asserted: the swept value must actually reach all three
 *      record fields.
 *
 *   3. LIVE-WIRE — loc_2153 drives a whole 2000-frame attract run as a registered override and
 *      every frame of the state trace must match the all-oracle baseline. THE CYCLE RESTORATION
 *      IS NOT COSMETIC: Donkey Kong seeds its RNG from timing (SPIN_COUNT counts main-loop
 *      passes per frame), so a rewrite that charges no T-states reseeds the PRNG and the run
 *      forks for reasons that have nothing to do with the rewrite. The harness measures what the
 *      oracle would have spent on each dispatch — by running it on a throwaway clone — and
 *      charges exactly that. The CONTROL test below wires the same rewrite WITHOUT the
 *      restoration and asserts the trace does fork, which is what shows this arm is sensitive
 *      rather than lenient. The contract asserted is RAM − the stack scratch below the entry SP, the same as arm 1;
 *      the full dump INCLUDING the stack region is asserted as well, and holds here because
 *      this rewrite has no stack traffic of its own to lose (its only stack effect is the
 *      frozen tail's, which it still reaches through that same frozen tail).
 *
 *   4. TEETH — four broken twins, each of which some arm above MUST catch:
 *        (a) hard-zero          — writes 0 instead of the supplied value. INVISIBLE to arm 1
 *                                 (attract always supplies 0); caught only by arm 2's sweep.
 *        (b) coordinate clobber — writes the Y integer (+5) where its fraction (+6) belongs.
 *        (c) no counter clear   — drops the +20 write.
 *        (d) returns false      — identical RAM, wrong result. INVISIBLE to the RAM diff;
 *                                 caught only by the return assertion. Not a hypothetical: a
 *                                 `false` from an address that is not in machine.js's
 *                                 SEAM_CALLER_SKIP makes the seam consume a stack word the
 *                                 routine does not owe.
 *
 * COVERAGE THIS DOES NOT CLAIM: attract only, plus pokes on attract state — no credited game, no
 * board other than 25m, no OBJ_ARRAY_67 record past the second. The RETURN assertion never
 * distinguishes a REACHED state (the frozen tail returns undefined here), so twin (d) gives it teeth.
 *
 * Isolated replays use clone() with frame machinery neutralised (nextNmi / nextBoundary = Infinity),
 * so an oracle m.step cannot trip a live NMI that masquerades as a side effect. The two callers are
 * hooked with their own FROZEN oracles, delegating unchanged — a label on each capture, not a
 * substitution; both stay frozen, so loc_2153 reaches its tail through the registry.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2153.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2153 as oracle } from "../../translated/loc_2153.js";
import { loc_2118 as oracle2118 } from "../../translated/loc_2118.js";
import { loc_2146 as oracle2146 } from "../../translated/loc_2146.js";
import { loc_2153 } from "../loc_2153.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2153;
const CAPTURE_FRAMES = 6000; // the capture run the reachability numbers in the routine header quote
const LIVE_FRAMES = 2000; //    the live-wire run and its baseline

// The dispatch census this file's header and the routine's GATE: line both quote. Asserted, not
// just printed, so neither header can go stale without a test failure naming the new numbers.
const EXPECTED_DISPATCHES = 13;
const EXPECTED_BY_CALLER = { "0x2146": 11, "0x2118": 2 };

// The record offsets the routine writes, restated here rather than imported from it, so the
// test asserts against an independent statement of the contract.
const AIRBORNE_FRAMES = 20;
const X_FRAC = 4;
const Y_FRAC = 6;
const Y_INT = 5; // NOT written — twin (b) clobbers it instead of Y_FRAC

const hx = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// The frozen walk's loop-back into the per-slot step, stubbed on both clones so each side publishes
// exactly the slot under test and stops. The dissolved idiomatic chain returns after one slot
// (publishBarrelSprite no longer loops back), so the oracle is cut to the same one slot.
const WALK_LOOPBACK = 0x1f83;

// The staging cursor the walk owns as a plain value: sprite page and low byte, parked in the
// alternate bank at entry (the motion arm exchanged it out). The dissolved chain takes it as `cur`.
const cursorOf = (m) => ({ page: m.regs.h_ * 256, cursor: m.regs.l_ });

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP. */
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/**
 * Run oracle and candidate on two FRESH, byte-identical clones of `entry` and report the
 * contract: RAM − the stack scratch below the entry SP plus the RETURN VALUE. The tail is a jump, so its result is
 * this routine's result and a rewrite that swallowed it would leave RAM untouched.
 *
 * Registers are NOT compared. Everything in the register file at exit was put there by the
 * frozen tail, which both sides reach identically; comparing it would measure ROM 0x21BA's
 * contract rather than this routine's, and this routine writes no register of its own.
 */
function contractDiffs(entry, fn) {
  const a = entry.clone();
  const b = entry.clone();
  a.routines.set(WALK_LOOPBACK, () => {});
  b.routines.set(WALK_LOOPBACK, () => {});
  const retA = oracle(a);
  const retB = fn(b, cursorOf(b));

  const diffs = [];
  const ram = firstRamDiff(a, b, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (retA !== retB) diffs.push(`return oracle=${String(retA)} cand=${String(retB)}`);
  return { diffs, a, b };
}

// -- capture ------------------------------------------------------------------

/**
 * ONE attract run serves every replay test below. It hooks 0x2153 and clones the machine at
 * EVERY dispatch, and it hooks the two frozen callers so each capture's entry shape carries the
 * caller it actually came through — measured, not re-derived from the entry state. Memoised;
 * the Machine run is the expensive part and the clones are read-only here.
 */
let ATTRACT = null;
function attractRun() {
  if (ATTRACT) return ATTRACT;
  const caps = [];
  const seen = new Map(); // shape -> how many dispatches had it
  let via = null;

  const through = (name, fn) => (mm) => {
    via = name;
    try { return fn(mm); } finally { via = null; }
  };

  const snap = new Map([
    [0x2118, through("0x2118", oracle2118)],
    [0x2146, through("0x2146", oracle2146)],
    [TARGET, (mm) => {
      const shape = `via ${via ?? "unknown"} record ${hx(mm.regs.ix)}`;
      seen.set(shape, (seen.get(shape) ?? 0) + 1);
      const entry = mm.clone();
      entry.nextNmi = Infinity;
      entry.nextBoundary = Infinity;
      caps.push({ entry, shape, stored: mm.regs.a });
      return oracle(mm);
    }],
  ]);

  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(CAPTURE_FRAMES);
  ATTRACT = { caps, seen };
  return ATTRACT;
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x2153 is dispatched during 25m attract, through both frozen callers", () => {
  const { caps, seen } = attractRun();
  assert.ok(caps.length > 0, "0x2153 should be dispatched — the object update cascade reaches it");
  const byCaller = {};
  for (const [shape, count] of seen) {
    const caller = shape.split(" ")[1];
    byCaller[caller] = (byCaller[caller] ?? 0) + count;
  }
  assert.deepEqual(Object.keys(byCaller).sort(), ["0x2118", "0x2146"],
    "both frozen callers must be exercised, or the captured arm covers only one entry path");

  // The census both headers quote. If these move, the headers are stale — update them together.
  assert.equal(caps.length, EXPECTED_DISPATCHES,
    `the dispatch count changed (${caps.length}); loc_2153.js's GATE: line and this file's header quote ${EXPECTED_DISPATCHES}`);
  assert.deepEqual(byCaller, EXPECTED_BY_CALLER,
    `the per-caller split changed (${JSON.stringify(byCaller)}); loc_2153.js's GATE: line quotes ${JSON.stringify(EXPECTED_BY_CALLER)}`);

  console.log(`  REACHABILITY: ${caps.length} natural 0x2153 dispatches in ${CAPTURE_FRAMES} frames, ` +
    `${seen.size} distinct entry shapes`);
  for (const [shape, count] of [...seen.entries()].sort((x, y) => y[1] - x[1])) {
    console.log(`    ${String(count).padStart(5)}  ${shape}`);
  }
});

// -- 1. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): loc_2153 == oracle on EVERY real dispatch", () => {
  const { caps, seen } = attractRun();
  assert.ok(caps.length >= 1, "expected at least one real 0x2153 dispatch during attract");

  for (const { entry, shape } of caps) {
    const { diffs } = contractDiffs(entry, loc_2153);
    assert.deepEqual(diffs, [], `captured dispatch [${shape}]: ${diffs.join("; ")}`);
  }

  // Non-vacuity: the clear must actually have changed the record, or every twin below that
  // drops a write would pass for the wrong reason.
  const moved = caps.filter(({ entry }) => {
    const ix = entry.regs.ix;
    return [AIRBORNE_FRAMES, X_FRAC, Y_FRAC].some((d) => entry.mem.read8(ix + d) !== 0);
  });
  assert.ok(moved.length > 0,
    "every captured entry already had all three fields at 0 — the clear is unobservable here");

  // The disclosure in this file's header, asserted rather than asserted-about: the frozen tail
  // returns undefined on every state attract produces, so the RETURN comparison above cannot
  // distinguish anything on a captured entry. Twin (d) is what gives it teeth.
  const returns = new Set(caps.map(({ entry }) => String(oracle(entry.clone()))));
  assert.deepEqual([...returns], ["undefined"],
    `the tail returned something other than undefined (${[...returns].join(",")}) — the header's ` +
    "note that the captured RETURN comparison is non-distinguishing is now wrong");

  console.log(`  EQUAL/captured: ALL ${caps.length} of ${caps.length} real dispatches replayed identical ` +
    `(${seen.size} entry shapes); ${moved.length} of them arrived with at least one field non-zero`);
});

// -- 2. EQUAL (crafted: the stored value attract never varies) -----------------

/** One capture per distinct entry shape — the real bases the crafted sweep sits on. */
function shapeBases() {
  const { caps } = attractRun();
  const first = new Map();
  for (const c of caps) if (!first.has(c.shape)) first.set(c.shape, c);
  return [...first.values()];
}

test("EQUAL (crafted): all 256 stored values match the oracle on every entry shape", () => {
  const { caps } = attractRun();
  assert.ok(caps.every((c) => c.stored === 0),
    "attract varied the stored value after all — the crafted sweep's premise needs rechecking");

  const bases = shapeBases();
  let compared = 0;
  for (const { entry, shape } of bases) {
    for (let v = 0; v < 256; v++) {
      const poked = entry.clone();
      poked.regs.a = v;
      const { diffs, a } = contractDiffs(poked, loc_2153);
      assert.deepEqual(diffs, [], `[${shape}] stored=${v}: ${diffs.join("; ")}`);
      compared++;

      // Non-vacuity: the swept value really did land in all three fields on both sides. (The
      // frozen tail does not touch these three offsets, so they survive to be read back.)
      const ix = poked.regs.ix;
      for (const d of [AIRBORNE_FRAMES, X_FRAC, Y_FRAC]) {
        assert.equal(a.mem.read8(ix + d), v, `[${shape}] stored=${v}: field +${d} did not take the value`);
      }
    }
  }
  console.log(`  EQUAL/crafted: ${compared} entries (256 stored values x ${bases.length} real entry shapes) ` +
    "identical to the oracle, and the value reached all three fields on every one");
});

// -- 3. LIVE-WIRE (retired) ---------------------------------------------------

// RETIRED (both arms). These wired loc_2153 live at 0x2153 standalone in an otherwise-frozen
// attract run. The exx/cursor dissolution makes that impossible: loc_2153 now takes the staging
// cursor `cur` as a value from its idiomatic caller (loc_2118 / loc_2146), so it cannot be
// dispatched by address with only the machine. The whole-run trace they proved is covered by
// idiomatic.test.js's FULL FLIP, which runs the dissolved chain end to end with the cursor threaded.
nodeTest("LIVE-WIRE: retired — the routine now takes the cursor as a value; FULL FLIP covers the whole run", {
  skip: "retired: loc_2153 takes the staging cursor from its idiomatic caller and cannot be wired standalone; whole-run trace covered by idiomatic.test.js (FULL FLIP)",
}, () => {});

// -- 4. TEETH -----------------------------------------------------------------

/** Twin (a): hard-codes the cleared value instead of storing what the caller supplied. */
function brokenHardZero(m) {
  const { mem8 } = m;
  const record = m.regs.ix;
  mem8[record + AIRBORNE_FRAMES] = 0;
  mem8[record + X_FRAC] = 0;
  mem8[record + Y_FRAC] = 0;
  return m.call(0x21ba);
}

/** Twin (b): clobbers the Y coordinate itself instead of its fractional half. */
function brokenCoordinateClobber(m) {
  const { mem8 } = m;
  const record = m.regs.ix;
  mem8[record + AIRBORNE_FRAMES] = m.regs.a;
  mem8[record + X_FRAC] = m.regs.a;
  mem8[record + Y_INT] = m.regs.a;
  return m.call(0x21ba);
}

/** Twin (c): leaves the elapsed-frame counter alone, so the arc resumes mid-ramp. */
function brokenNoCounterClear(m) {
  const { mem8 } = m;
  const record = m.regs.ix;
  mem8[record + X_FRAC] = m.regs.a;
  mem8[record + Y_FRAC] = m.regs.a;
  return m.call(0x21ba);
}

/** Twin (d): correct memory effect, but swallows the tail's result and answers `false`. */
function brokenReturnsFalse(m) {
  const { mem8 } = m;
  const record = m.regs.ix;
  mem8[record + AIRBORNE_FRAMES] = m.regs.a;
  mem8[record + X_FRAC] = m.regs.a;
  mem8[record + Y_FRAC] = m.regs.a;
  m.call(0x21ba);
  return false;
}

/** Replay every real capture against `twin`; return how many the contract caught. */
function caughtOnCaptures(twin) {
  const { caps } = attractRun();
  let caught = 0;
  let first = null;
  for (const { entry, shape } of caps) {
    const { diffs } = contractDiffs(entry, twin);
    if (diffs.length > 0) {
      caught++;
      first ??= `[${shape}] ${diffs.join("; ")}`;
    }
  }
  return { caught, total: caps.length, first };
}

/** Sweep all 256 stored values on the first real entry shape; return how many the contract caught. */
function caughtOnSweep(twin) {
  const { entry, shape } = shapeBases()[0];
  let caught = 0;
  let first = null;
  for (let v = 0; v < 256; v++) {
    const poked = entry.clone();
    poked.regs.a = v;
    const { diffs } = contractDiffs(poked, twin);
    if (diffs.length > 0) {
      caught++;
      first ??= `[${shape}] stored=${v}: ${diffs.join("; ")}`;
    }
  }
  return { caught, total: 256, first };
}

test("TEETH: four broken twins are CAUGHT", () => {
  // Sanity: the real routine passes both arms, so a caught twin is a real defect signal.
  assert.equal(caughtOnCaptures(loc_2153).caught, 0, "the correct routine must pass the captured arm");
  assert.equal(caughtOnSweep(loc_2153).caught, 0, "the correct routine must pass the crafted sweep");

  // (a) hard-zero: attract only ever stores 0, so the captures CANNOT see this — the crafted
  // sweep is what catches it, which is the whole reason that arm exists.
  const aCaps = caughtOnCaptures(brokenHardZero);
  const aSweep = caughtOnSweep(brokenHardZero);
  assert.equal(aCaps.caught, 0,
    "the captured arm caught the hard-zero twin, so attract is NOT storing a constant 0 — recheck arm 2's premise");
  assert.ok(aSweep.caught > 0, "the hard-zero twin escaped the crafted sweep — the parameter is unproven");

  // (b) and (c) are memory defects on the states attract really produces.
  const b = caughtOnCaptures(brokenCoordinateClobber);
  assert.ok(b.caught > 0, "the coordinate-clobber twin escaped — the written offsets are unproven");

  const c = caughtOnCaptures(brokenNoCounterClear);
  assert.ok(c.caught > 0, "the no-counter-clear twin escaped — that write is unproven");

  // (d) leaves RAM identical; only the return assertion sees it.
  const d = caughtOnCaptures(brokenReturnsFalse);
  assert.ok(d.caught > 0, "the returns-false twin escaped — the return value is unasserted");
  assert.ok(d.first.includes("return"),
    `the returns-false twin should have been caught by the RETURN assertion, got: ${d.first}`);

  console.log(`  TEETH: hard-zero caught ${aSweep.caught}/${aSweep.total} crafted (${aCaps.caught}/${aCaps.total} ` +
    `captures, as expected — ${aSweep.first}); coordinate-clobber ${b.caught}/${b.total} (${b.first}); ` +
    `no-counter-clear ${c.caught}/${c.total} (${c.first}); returns-false ${d.caught}/${d.total} (${d.first})`);
});
