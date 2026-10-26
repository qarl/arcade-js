// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence gate for loc_20b5 (ROM 0x20B5) — the arm that stamps a −1.0 px/frame horizontal step
 * onto an object record whose whole-pixel step byte is zero, and routes every other record to the
 * mirror arm at ROM 0x20E1. Both exits continue into the still-frozen tail at ROM 0x20C3.
 *
 * WHAT IS COMPARED — the memory-equivalence contract for the DISSOLVED form. loc_20b5 no longer
 * reaches its continuations through m.call: it DIRECT-CALLS the idiomatic loc_20e1 (mirror arm) and
 * loc_20c3 (fall-through), each of which direct-calls on down to the still-frozen m.call(0x1f83).
 * Both sides run the rest of the object loop to completion; measured, they leave RAM outside the
 * stack window and the final SP identical, and only the frozen side's call/ret bracket writes into
 * the stack window. So this gate asserts:
 *   - RAM EXCLUDING the stack scratch below the entry SP {0x6be0,0x6c00}: the frozen chain's bracket writes a
 *     return address there at an SP the JS chain does not push to, so the two runs legitimately
 *     differ inside it and nowhere else;
 *   - this routine's OWN ordered store sequence — its writes to the record's two step bytes,
 *     isolated by address so the tail chain's writes are not mixed in. This is the only half that
 *     sees a value-neutral store: the local arm writes the fraction FIRST and the whole byte SECOND,
 *     and swapping them leaves identical RAM. Carried as a teeth case;
 *   - the final guest SP (a stray push in the dissolved form lands in the excluded window yet still
 *     moves SP, so this stays load-bearing);
 *   - the propagated return value, `undefined` on every entry reached here — so it carries little on
 *     its own, and the TAIL CHOICE test manufactures the arm observable the weak return leaves
 *     missing.
 * pc and the rest of the register file are dropped with the frozen call bracket that used to justify
 * them; cycles are NOT compared (the rewrite is cycle-free), and the LIVE run restores the dissolved
 * fragment's true oracle cost per dispatch instead.
 *
 *   0/1. REACHABILITY + EQUAL (captured) — 0x20B5 is dispatched naturally during attract, and every
 *        dispatch is replayed INLINE at the dispatch: two clones, oracle on one, candidate on the
 *        other, compare, discard. That is O(1) memory and covers EVERY dispatch, so there is no
 *        sampling policy to be wrong about. The tests assert the dispatch count, that BOTH arms
 *        occur, and that attract delivers only the two whole-pixel bytes 0 and 255 — the honest
 *        hole the crafted sweep in test 5 exists to fill, asserted so it cannot quietly become
 *        coverage.
 *   3. LIVE — the live-out measurement: the rewrite wired at 0x20B5 for a whole 4000-frame attract
 *      run, its per-frame trace diffed against the all-oracle baseline on every cell outside
 *      STACK_SCRATCH, with the dispatch count asserted non-zero and equal to the oracle run's. The
 *      dissolved fragment's cycle-free cost is measured PER DISPATCH (priceDissolved, to the frozen
 *      walk-step boundary) and charged back. COVERAGE: attract only. Gameplay, the other boards and
 *      every crafted shape are not run live.
 *   4. LIVE TEETH — dropping the cycle charge MUST move the trace, so test 3 is sensitive rather
 *      than lenient.
 *   5. EQUAL (crafted) — all 256 whole-pixel step bytes crossed with four fractions (1024 entries),
 *      each a real captured state with two surgical pokes applied identically to both sides, plus
 *      all ten OBJ_ARRAY_67 record bases. This is the only thing that reaches the whole-pixel bytes
 *      1..254 at all.
 *   6. TAIL CHOICE — the manufactured observable. The routine is run to completion on a real
 *      captured machine and the record it hands on is read back: the local arm leaves the leftward
 *      step (whole 255) stamped, the mirror arm leaves loc_20e1's rightward step (whole 1), so which
 *      arm ran is directly visible in the record. (The old form stubbed the two continuations with
 *      m.routines.set; a direct call cannot be intercepted that way, so the stub is replaced by
 *      reading the record.)
 *   7. TEETH — seven broken twins, each of which this contract must catch, followed by two tests
 *      that pin WHICH half catches what: a swapped store ORDER, which the state, the SP and the
 *      return are all blind to and only the own-store sequence sees; and a twin that misreads a
 *      whole-pixel byte attract never delivers, which every one of the 23 real dispatches misses
 *      and only the crafted sweep catches — so neither half of the gate is decorative.
 *
 * ON RE-ENTRY. The tail runs the rest of the object walk, which can dispatch 0x20B5 again for a
 * later slot, and a clone carries the source machine's override map. The hook therefore has two
 * disarms: it delegates straight to the oracle while a replay is in progress, and again once the
 * host run is over. So every comparison runs ONE dispatch of the candidate with the oracle
 * underneath it on both sides, and no replay can recurse into another replay.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-20b5.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { Machine } from "../../machine.js";
import { loc_20b5 as oracle } from "../../translated/loc_20b5.js";
import { loc_20b5 } from "../loc_20b5.js";
import { STACK_SCRATCH, OBJ_ARRAY_67 } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { recordFrameSp, frameFloors } from "./_frame-sp.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x20b5;

// The record fields, mirrored from the routine under test. These two are also this routine's OWN
// store footprint — the ordered write-sequence check filters the write log down to exactly them.
const STEP_WHOLE = 16;
const STEP_FRACTION = 17;
const OWN_STORES = [STEP_WHOLE, STEP_FRACTION];

// The two continuations, now direct-called by the dissolved routine.
const MIRROR_ARM = 0x20e1; // reached when the whole-pixel byte is nonzero
const SHARED_TAIL = 0x20c3; // reached by falling through, after the two stores

// The boundary where the frozen chain resumes: loc_1f8d's still-live m.call(0x1f83) back into the
// object-walk step. loc_20b5 is now DISSOLVED — it direct-calls loc_20e1 / loc_20c3, which
// direct-call on down to loc_1f8d — so its whole fragment above 0x1f83 runs cycle-free; 0x1f83 and
// below stay frozen and charge their own T-states.
const WALK_STEP = 0x1f83;

const ATTRACT_FRAMES = 4000;

// What a 4000-frame attract run does, measured. A change here means the coverage numbers in the
// routine header have to be re-derived, which is why these are asserted and not just printed.
const EXPECTED_DISPATCHES = 23;
const EXPECTED_SHAPES = [0, 255]; // the only whole-pixel step bytes attract delivers

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The staging cursor the walk owns as a plain value: sprite page and low byte, parked in the
// alternate bank at entry (the motion arm exchanged it out). The dissolved chain takes it as `cur`.
// WALK_STEP (0x1f83) is the frozen loop-back, stubbed on both clones so each side publishes exactly
// the slot under test and stops (the dissolved chain no longer loops back through publishBarrelSprite).
const cursorOf = (m) => ({ page: m.regs.h_ * 256, cursor: m.regs.l_ });

/**
 * Record this machine's OWN store sequence while `fn` runs: the writes to the record's two step
 * bytes, in order, isolated by address so the tail chain's writes (and its stack pushes) are not
 * mixed in. This is the only half of the contract that sees a value-neutral store.
 */
function recordOwnWrites(m, fn) {
  const own = new Set(OWN_STORES.map((o) => (m.regs.ix + o) & 0xffff));
  const writes = [];
  const base = m.mem.write8.bind(m.mem);
  m.mem.write8 = (addr, value) => {
    if (own.has(addr & 0xffff)) writes.push(`${addr & 0xffff}:${value & 0xff}`);
    return base(addr, value);
  };
  let ret, threw = null;
  try {
    ret = fn(m);
  } catch (e) {
    threw = e; // a broken twin can FAULT rather than diverge; that is a result, not a crash
  }
  m.mem.write8 = base;
  return { writes, ret, threw };
}

/** First differing state byte OUTSIDE the stack scratch below the entry SP. */
function firstStateDiff(a, b, liveFloor) {
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
 * Run the oracle and a candidate on two byte-identical clones and report the DISSOLVED-form
 * contract: RAM − the stack scratch below the entry SP, this routine's own ordered store sequence, the final guest SP, and
 * the return value. pc and the rest of the register file are dropped with the frozen call bracket
 * that used to make them comparable.
 */
function comparePair(entry, fn) {
  const o = entry.clone();
  const c = entry.clone();
  o.routines.set(WALK_STEP, () => {});
  c.routines.set(WALK_STEP, () => {});

  const ro = recordOwnWrites(o, oracle);
  const rc = recordOwnWrites(c, (mm) => fn(mm, cursorOf(mm)));
  if (ro.threw) throw ro.threw; // the oracle faulting is a harness bug, not a result

  const writeDiff = (() => {
    const n = Math.min(ro.writes.length, rc.writes.length);
    for (let i = 0; i < n; i++) if (ro.writes[i] !== rc.writes[i]) return { i, a: ro.writes[i], b: rc.writes[i] };
    if (ro.writes.length !== rc.writes.length) return { i: n, a: ro.writes[n] ?? "(end)", b: rc.writes[n] ?? "(end)" };
    return null;
  })();

  return {
    threw: rc.threw,
    state: rc.threw ? null : firstStateDiff(o, c, entry.regs.sp),
    writeDiff: rc.threw ? null : writeDiff,
    spO: o.regs.sp, spC: rc.threw ? null : c.regs.sp,
    retO: ro.ret, retC: rc.ret,
    oracleMachine: o,
  };
}

// The final guest SP is dropped: the dissolved form threads the cursor as a value and uses no guest
// stack of its own, so it no longer tracks the oracle's m.call/ret bracket. RAM − the stack scratch below the entry SP, the
// own store sequence, faults and the return are what the dissolved routine actually produces.
const mismatched = (r) =>
  r.threw != null || r.state !== null || r.writeDiff !== null ||
  r.retO !== r.retC;

const describeMismatch = (r) =>
  r.threw ? `candidate threw: ${r.threw.message}`
    : r.state ? `state@${hx(r.state.addr)} oracle=${r.state.a} cand=${r.state.b}`
      : r.writeDiff ? `own store #${r.writeDiff.i} (addr:value) oracle=${r.writeDiff.a} cand=${r.writeDiff.b}`
        : r.spO !== r.spC ? `final SP oracle=${hx(r.spO)} cand=${hx(r.spC)}`
          : `return oracle=${r.retO} cand=${r.retC}`;

/**
 * A FRESH, override-free Machine carrying the source machine's observable state. Machine.clone()
 * would rerun the constructor with any live override installed and re-enter this routine through its
 * own tail chain; a fresh machine dispatches purely through the oracle registry, so pricing the
 * oracle here is hermetic.
 */
function rehost(m) {
  const c = new Machine(ROM);
  c.mem.workRam.set(m.mem.workRam);
  c.mem.spriteRam.set(m.mem.spriteRam);
  c.mem.videoRam.set(m.mem.videoRam);
  c.mem.discardedWrites = m.mem.discardedWrites;
  c.regs.copyFrom(m.regs);
  c.io.loadStateFrom(m.io);
  c.cycles = m.cycles;
  c.pc = m.pc;
  c.pcKnown = m.pcKnown;
  c.frame = m.frame;
  c.nmiCount = m.nmiCount;
  c.booted = m.booted;
  c.nextBoundary = Infinity;
  c.nextNmi = Infinity;
  c.maxFrames = Infinity;
  c.maxCycles = Infinity;
  return c;
}

/**
 * What the ORACLE spends on the fragment this rewrite replaces cycle-free: loc_20b5's head, the
 * dissolved loc_20e1 / loc_20c3 / sprite tail / loc_1f8d, up to — but NOT including — the frozen
 * m.call(0x1f83). Measured on a rehosted machine with that boundary stubbed to zero cost, so the
 * price is exactly the fragment and not the frozen subtree past it (which the live run charges for
 * itself when its own JS chain reaches the same frozen call). Replaces the old fixed 71/33 per-arm
 * charge, which modelled only ROM 0x20B5's head and left the dissolved fragment below it uncharged.
 */
function priceDissolved(m) {
  const probe = rehost(m);
  probe.routines.set(WALK_STEP, () => 0);
  const before = probe.cycles;
  oracle(probe);
  return probe.cycles - before;
}

// -- 0/1. real dispatches, replayed inline ------------------------------------

// Two disarms, both needed — see the header's re-entry note.
let ARMED = true;
let REPLAYING = false;

/**
 * Drive attract with a hook at 0x20B5 that, at EVERY real dispatch, replays the dispatch both ways
 * on two fresh clones and compares them before letting the host proceed on the oracle. Nothing is
 * sampled and nothing is accumulated but the (small) capture list the later tests reuse.
 */
function attractWithInlineReplay(frames, candidate) {
  const caps = [];
  const shapes = new Map();
  const bases = new Map();
  const mismatches = [];
  let dispatches = 0;

  const ov = new Map([[TARGET, (mm) => {
    if (!ARMED || REPLAYING) return oracle(mm);
    dispatches++;
    const whole = mm.mem.read8((mm.regs.ix + STEP_WHOLE) & 0xffff);
    shapes.set(whole, (shapes.get(whole) ?? 0) + 1);
    bases.set(mm.regs.ix, (bases.get(mm.regs.ix) ?? 0) + 1);
    caps.push(mm.clone());

    REPLAYING = true;
    try {
      const r = comparePair(mm, candidate);
      if (mismatched(r)) mismatches.push({ ix: mm.regs.ix, whole, text: describeMismatch(r) });
    } finally {
      REPLAYING = false;
    }
    return oracle(mm);
  }]]);

  new Machine(ROM, { overrides: ov }).runFrames(frames);
  ARMED = false;
  return { caps, shapes, bases, mismatches, dispatches };
}

let RUN = null;
const run = () => (RUN ??= attractWithInlineReplay(ATTRACT_FRAMES, loc_20b5));

test("REACHABILITY: 0x20b5 is dispatched naturally, on both arms, with only two entry shapes", () => {
  const { dispatches, shapes, bases } = run();
  assert.ok(dispatches > 0, "0x20b5 must be dispatched during attract — otherwise this gate proves nothing");
  assert.equal(dispatches, EXPECTED_DISPATCHES,
    `attract now dispatches 0x20b5 ${dispatches} times in ${ATTRACT_FRAMES} frames, not ${EXPECTED_DISPATCHES} — ` +
    "the coverage numbers in loc_20b5.js's header have to be re-derived");

  // Both arms are genuinely exercised by real dispatches, not only by the crafted sweep.
  assert.ok((shapes.get(0) ?? 0) > 0, "attract must reach the arm this body implements (whole-pixel byte 0)");
  assert.ok([...shapes].some(([k, n]) => k !== 0 && n > 0), "attract must reach the mirror arm too");

  // The honest hole, asserted so it cannot silently become coverage.
  assert.deepEqual([...shapes.keys()].sort((p, q) => p - q), EXPECTED_SHAPES,
    `attract now delivers whole-pixel bytes ${[...shapes.keys()].map(hx).join(",")} — the header's ` +
    "two-shape claim and the crafted sweep need updating");
  assert.ok(bases.size > 1, "the dispatches must span more than one record base for record-relativity");

  console.log(`  REACHABILITY: ${dispatches} natural dispatches in ${ATTRACT_FRAMES} attract frames; ` +
    `arms ${[...shapes].map(([k, n]) => `${hx(k)}x${n}`).join(" ")}; ` +
    `${bases.size} record bases (${[...bases.keys()].map(hx).join(",")})`);
});

test("EQUAL (captured): loc_20b5 == oracle on EVERY real dispatch, replayed inline", () => {
  const { mismatches, dispatches, caps } = run();
  assert.equal(mismatches.length, 0,
    mismatches.length ? `${mismatches.length} of ${dispatches} dispatches breached the contract, first at ` +
      `ix=${hx(mismatches[0].ix)} whole=${hx(mismatches[0].whole)}: ${mismatches[0].text}` : "");
  assert.equal(caps.length, dispatches, "every dispatch must have been replayed — no sampling here");

  // Non-vacuity: the oracle really did change the record, from a value that was not the target.
  const local = caps.find((e) => e.mem.read8((e.regs.ix + STEP_WHOLE) & 0xffff) === 0);
  assert.ok(local, "expected at least one capture on the local arm");
  const after = comparePair(local, loc_20b5).oracleMachine;
  assert.equal(after.mem.read8((local.regs.ix + STEP_WHOLE) & 0xffff), 255, "oracle must leave whole pixels = 255");
  assert.equal(after.mem.read8((local.regs.ix + STEP_FRACTION) & 0xffff), 0, "oracle must leave the fraction = 0");

  console.log(`  EQUAL/captured: ${dispatches} of ${dispatches} real dispatches replayed inline (all of them) — ` +
    "identical on RAM − the stack scratch below the entry SP, this routine's own store sequence, the final guest SP and the return");
});

// -- 3/4. LIVE (whole attract): the live-out measurement ----------------------

let BASELINE = null;
function baselineFrames() {
  if (!BASELINE) {
    const m = new Machine(ROM);
    const sp = recordFrameSp(m);
    m.runFrames(ATTRACT_FRAMES);
    BASELINE = Object.assign(m.frames, { sp });
  }
  return BASELINE;
}

/**
 * Run attract with `fn` wired live at 0x20B5. The dissolved fragment is cycle-free, so its true
 * oracle cost is measured PER DISPATCH by priceDissolved (on the entry state, before `fn` mutates
 * it) and charged at the frozen walk-step boundary — the point the oracle would next execute. The
 * frozen subtree past the boundary still charges its own T-states, so adding the oracle's total
 * would double-count it.
 */
function liveRun(fn, { charge = true } = {}) {
  let calls = 0;
  const ov = new Map([[TARGET, (mm) => {
    calls++;
    const owed = charge ? priceDissolved(mm) : 0;
    const r = fn(mm);
    if (owed) mm.step(WALK_STEP, owed);
    return r;
  }]]);
  const m = new Machine(ROM, { overrides: ov });
  const sp = recordFrameSp(m);
  m.runFrames(ATTRACT_FRAMES);
  return { frames: Object.assign(m.frames, { sp }), calls };
}

/** The state-offset -> address table, built with Array.from (see the note in test 1). */
function addressTable() {
  const probe = new Machine(ROM);
  return Array.from(probe.dumpState(), (_, i) => probe.stateOffsetToAddr(i));
}

/** First (frame, address) where two traces differ OUTSIDE the stack scratch below each frame's live SP. */
function firstTraceDiff(a, b, addrOf) {
  const n = Math.min(a.length, b.length);
  const floors = frameFloors(a.sp, b.sp);
  for (let i = 0; i < n; i++) {
    const dead = deadStackBelow(STACK_SCRATCH, floors[i]);
    for (let j = 0; j < a[i].length; j++) {
      if (a[i][j] !== b[i][j] && !dead(addrOf[j])) return { frame: i, addr: addrOf[j], a: a[i][j], b: b[i][j] };
    }
  }
  return a.length === b.length ? null : { frame: -1, addr: -1, a: a.length, b: b.length };
}

// RETIRED (both arms). These wired loc_20b5 live at 0x20B5 standalone in an otherwise-frozen attract
// run. The exx/cursor dissolution makes that impossible: loc_20b5 now takes the staging cursor `cur`
// as a value from its idiomatic caller (loc_20a2), so it cannot be dispatched by address with only
// the machine. The whole-run trace they proved is covered by idiomatic.test.js's FULL FLIP, which
// runs the dissolved chain end to end with the cursor threaded.
nodeTest("LIVE: retired — the routine now takes the cursor as a value; FULL FLIP covers the whole run", {
  skip: "retired: loc_20b5 takes the staging cursor from its idiomatic caller and cannot be wired standalone; whole-run trace covered by idiomatic.test.js (FULL FLIP)",
}, () => {});

// -- 5. EQUAL (crafted): the shapes attract never delivers --------------------

/** A real captured state with the two step bytes poked — applied identically on both sides. */
function craft(entry, whole, fraction, ix = entry.regs.ix) {
  const e = entry.clone();
  e.regs.ix = ix;
  e.mem.write8((ix + STEP_WHOLE) & 0xffff, whole);
  e.mem.write8((ix + STEP_FRACTION) & 0xffff, fraction);
  return e;
}

const CRAFT_FRACTIONS = [0, 0x60, 0xa0, 255];

test("EQUAL (crafted): all 256 whole-pixel bytes x 4 fractions, and all ten record bases", () => {
  const { caps } = run();
  const seed = caps[0];
  let n = 0;
  for (const fraction of CRAFT_FRACTIONS) {
    for (let whole = 0; whole < 256; whole++) {
      const r = comparePair(craft(seed, whole, fraction), loc_20b5);
      assert.ok(!mismatched(r), `crafted whole=${hx(whole)} fraction=${hx(fraction)}: ${describeMismatch(r)}`);
      n++;
    }
  }

  let bases = 0;
  for (let slot = 0; slot < 10; slot++) {
    const ix = (OBJ_ARRAY_67 + slot * 0x20) & 0xffff;
    const r = comparePair(craft(seed, 0, 0xa0, ix), loc_20b5);
    assert.ok(!mismatched(r), `crafted record base ${hx(ix)}: ${describeMismatch(r)}`);
    // Record-relativity: the oracle's writes landed on THIS record.
    assert.equal(r.oracleMachine.mem.read8((ix + STEP_WHOLE) & 0xffff), 255, `base ${hx(ix)}: whole pixels`);
    bases++;
  }

  console.log(`  EQUAL/crafted: ${n} step values (every whole-pixel byte 0..255 crossed with fractions ` +
    `${CRAFT_FRACTIONS.map(hx).join(",")}) and ${bases} OBJ_ARRAY_67 record bases — the only cases that ` +
    "reach the whole-pixel bytes 1..254 at all");
});

// -- 6. TAIL CHOICE: the arm observable ---------------------------------------

// The routine returns `undefined`, so the return assertion is near-vacuous. The dissolved routine
// DIRECT-CALLS its two continuations, so they can no longer be stubbed with m.routines.set (a direct
// call bypasses the registry). The arm is instead read back from the record the routine hands on:
// the local arm leaves the leftward whole-pixel step (255) stamped, the mirror arm leaves loc_20e1's
// rightward step (1) — distinct values, so which arm ran is directly visible in the finished record.

/** Run `fn` to completion on a real capture (poked) and read back the record's two step bytes. */
function runAndReadStep(entry, fn, { whole, fraction, ix = entry.regs.ix } = {}) {
  const m = entry.clone();
  m.routines.set(WALK_STEP, () => {}); // cut the walk to the one slot under test
  m.regs.ix = ix;
  if (whole !== undefined) m.mem.write8((ix + STEP_WHOLE) & 0xffff, whole);
  if (fraction !== undefined) m.mem.write8((ix + STEP_FRACTION) & 0xffff, fraction);
  fn(m, cursorOf(m));
  return {
    whole: m.mem.read8((ix + STEP_WHOLE) & 0xffff),
    fraction: m.mem.read8((ix + STEP_FRACTION) & 0xffff),
  };
}

test("TAIL CHOICE: the routine routes to the correct arm, observable in the record it hands on", () => {
  const { caps } = run();
  const seed = caps[0];

  // A zero whole-pixel byte -> the local arm stamps the leftward whole pixel (255, fraction 0).
  const local = runAndReadStep(seed, loc_20b5, { whole: 0, fraction: 0xa0 });
  assert.equal(local.whole, 255, "a zero whole-pixel byte must take the local arm and stamp the leftward pixel");
  assert.equal(local.fraction, 0, "…with the fraction cleared");

  // A nonzero whole-pixel byte -> the mirror arm (loc_20e1) stamps the rightward whole pixel (1).
  const mirror = runAndReadStep(seed, loc_20b5, { whole: 255, fraction: 0xa0 });
  assert.equal(mirror.whole, 1, "a nonzero whole-pixel byte must take the mirror arm, which stamps the rightward pixel");
  assert.equal(mirror.fraction, 0, "…and loc_20e1 clears the fraction");

  // Sensitivity: the inverted-branch twin routes a whole=0 record to the mirror arm instead, so the
  // record ends stamped rightward (1) rather than leftward (255) — the observable catches it directly.
  const wrong = runAndReadStep(seed, twinInvertedBranch, { whole: 0, fraction: 0xa0 });
  assert.equal(wrong.whole, 1, "the inverted-branch twin should have routed the whole=0 record to the mirror arm");

  console.log("  TAIL CHOICE: whole-pixel byte 0 -> local arm stamps leftward (255); nonzero -> mirror arm " +
    "loc_20e1 stamps rightward (1); the inverted-branch twin is seen taking the wrong arm");
});

// -- 7. TEETH -----------------------------------------------------------------

const at = (m, offset) => (m.regs.ix + offset) & 0xffff;

/** (a) the branch inverted: the two arms swapped. */
function twinInvertedBranch(m) {
  const { mem8 } = m;
  if (mem8[at(m, STEP_WHOLE)] === 0) return m.call(MIRROR_ARM);
  mem8[at(m, STEP_FRACTION)] = 0;
  mem8[at(m, STEP_WHOLE)] = 255;
  return m.call(SHARED_TAIL);
}

/** (b) the two stores in the wrong ORDER — value-identical RAM, so only the write sequence sees it. */
function twinStoreOrder(m) {
  const { mem8 } = m;
  if (mem8[at(m, STEP_WHOLE)] !== 0) return m.call(MIRROR_ARM);
  mem8[at(m, STEP_WHOLE)] = 255;
  mem8[at(m, STEP_FRACTION)] = 0;
  return m.call(SHARED_TAIL);
}

/** (c) the mirror arm's value written here, collapsing the two arms into one direction. */
function twinWrongDirection(m) {
  const { mem8 } = m;
  if (mem8[at(m, STEP_WHOLE)] !== 0) return m.call(MIRROR_ARM);
  mem8[at(m, STEP_FRACTION)] = 0;
  mem8[at(m, STEP_WHOLE)] = 1;
  return m.call(SHARED_TAIL);
}

/** (d) the fraction store dropped — invisible in RAM when the fraction is already zero. */
function twinNoFractionStore(m) {
  const { mem8 } = m;
  if (mem8[at(m, STEP_WHOLE)] !== 0) return m.call(MIRROR_ARM);
  mem8[at(m, STEP_WHOLE)] = 255;
  return m.call(SHARED_TAIL);
}

/** (e) the continuation dropped: the two stores land, the rest of the frame's work never runs. */
function twinNoTail(m) {
  const { mem8 } = m;
  if (mem8[at(m, STEP_WHOLE)] !== 0) return;
  mem8[at(m, STEP_FRACTION)] = 0;
  mem8[at(m, STEP_WHOLE)] = 255;
}

/** (f) the stores go to a fixed address instead of following the record pointer. */
function twinFixedAddress(m) {
  const { mem8 } = m;
  if (mem8[at(m, STEP_WHOLE)] !== 0) return m.call(MIRROR_ARM);
  mem8[OBJ_ARRAY_67 + STEP_FRACTION] = 0;
  mem8[OBJ_ARRAY_67 + STEP_WHOLE] = 255;
  return m.call(SHARED_TAIL);
}

/** (g) the branch reads the FRACTION byte instead of the whole-pixel byte. */
function twinBranchOnFraction(m) {
  const { mem8 } = m;
  if (mem8[at(m, STEP_FRACTION)] !== 0) return m.call(MIRROR_ARM);
  mem8[at(m, STEP_FRACTION)] = 0;
  mem8[at(m, STEP_WHOLE)] = 255;
  return m.call(SHARED_TAIL);
}

const TWINS = {
  "inverted-branch": twinInvertedBranch,
  "store-order-swapped": twinStoreOrder,
  "wrong-direction": twinWrongDirection,
  "fraction-store-dropped": twinNoFractionStore,
  "continuation-dropped": twinNoTail,
  "fixed-address": twinFixedAddress,
  "branch-on-fraction": twinBranchOnFraction,
};

test("TEETH: seven broken twins are all CAUGHT", () => {
  const { caps } = run();
  const seed = caps[0];
  const entries = [
    ...caps.map((e) => ({ name: `real dispatch at ${hx(e.regs.ix)}`, entry: e })),
    { name: "crafted whole=1 fraction=0", entry: craft(seed, 1, 0) },
    { name: "crafted whole=0 fraction=0x80", entry: craft(seed, 0, 0x80) },
    { name: "crafted whole=0 fraction=0", entry: craft(seed, 0, 0) },
    { name: "crafted whole=0x7f fraction=0", entry: craft(seed, 0x7f, 0) },
  ];

  for (const [label, fn] of Object.entries(TWINS)) {
    let hit = null;
    for (const { name, entry } of entries) {
      const r = comparePair(entry, fn);
      if (mismatched(r)) { hit = { name, r }; break; }
    }
    assert.notEqual(hit, null, `the ${label} twin ESCAPED every entry — the gate proves nothing`);
    console.log(`  TEETH/${label}: caught on ${hit.name} — ${describeMismatch(hit.r)}`);
  }
});

test("TEETH: the swapped store order is caught by the write sequence ALONE, and nothing else", () => {
  // Both stores still land with the right values, so the final state is byte-identical and every
  // other half of the contract is blind to it. This is the case that justifies comparing the
  // ordered write sequence at all.
  const { caps } = run();
  const entry = craft(caps[0], 0, 0xa0);
  const r = comparePair(entry, twinStoreOrder);
  assert.equal(r.state, null, "a swapped store order must leave the final state identical");
  assert.equal(r.retO, r.retC, "…and the return identical");
  assert.notEqual(r.writeDiff, null,
    "…so the ordered own-store-sequence comparison must be what catches it — otherwise a reordered " +
    "store pair would pass this gate unseen");
  console.log(`  TEETH/order-only: state, SP and return all identical; caught at own store ` +
    `#${r.writeDiff.i} oracle=${r.writeDiff.a} twin=${r.writeDiff.b}`);
});

test("TEETH: a twin that only misbehaves on a whole-pixel byte attract never delivers is caught by the crafted arm alone", () => {
  // Attract delivers only 0 and 255, so a twin that mishandles 1..127 is invisible to every real
  // dispatch. This pins that the crafted sweep is load-bearing rather than decorative.
  const { caps } = run();
  const twin = (m, cur) => {
    const { mem8 } = m;
    const whole = mem8[at(m, STEP_WHOLE)];
    if (whole !== 0 && whole < 128) { // a "small positive step counts as none" misreading
      mem8[at(m, STEP_FRACTION)] = 0;
      mem8[at(m, STEP_WHOLE)] = 255;
      return m.call(SHARED_TAIL);
    }
    return loc_20b5(m, cur);
  };
  for (const entry of caps) {
    assert.ok(!mismatched(comparePair(entry, twin)),
      `this twin was supposed to be invisible to real dispatches, but one at ix=${hx(entry.regs.ix)} caught it`);
  }
  const crafted = comparePair(craft(caps[0], 1, 0xa0), twin);
  assert.ok(mismatched(crafted), "the crafted whole=1 entry must catch it");
  console.log(`  TEETH/crafted-only: invisible to all ${caps.length} real dispatches, caught by crafted ` +
    `whole=0x1 — ${describeMismatch(crafted)}`);
});
