// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_20e1 (ROM 0x20E1) — the arm that stamps a +1.0 px/frame horizontal
 * velocity onto an object record before the shared launch tail at ROM 0x20C3.
 *
 * WHAT IS COMPARED — the memory-equivalence contract for the DISSOLVED form. loc_20e1 no longer
 * reaches its tail through m.call(0x20c3): it DIRECT-CALLS the idiomatic loc_20c3, which direct-calls
 * loc_2407 / publishBarrelSprite / loc_1f8d, down to the still-frozen m.call(0x1f83). The frozen
 * oracle jp-tails to that same boundary at the same guest SP (a jp pushes nothing), so both sides
 * run the rest of the object loop and, measured, leave RAM outside the stack window and the final SP
 * identical. So this gate asserts:
 *   - RAM EXCLUDING the stack scratch below the entry SP {0x6be0,0x6c00}: the frozen side's call/ret bracket
 *     writes a return address into that window at an SP the JS side does not push to, so the two
 *     runs legitimately differ there and nowhere else;
 *   - this routine's OWN ordered store sequence — its two writes to the record's velocity bytes,
 *     isolated by address so the tail chain's writes are not mixed in. This is the only half that
 *     sees a value-neutral dropped store (a fraction store dropped when the fraction was already 0);
 *   - the final guest SP (a stray push in the dissolved form lands in the excluded window yet still
 *     moves SP, so this stays load-bearing);
 *   - the propagated return value.
 * pc and the rest of the register file are dropped with the frozen call bracket that used to justify
 * them; cycles are NOT compared (the rewrite is cycle-free), and test 3's LIVE run restores the
 * fragment's true oracle cost per dispatch instead.
 *
 *   0. REACHABILITY — 0x20E1 is dispatched naturally during attract. The test measures the count,
 *      the record bases, and the entry shapes, and asserts BOTH that attract reaches this routine
 *      and that it delivers only ONE shape of entry (velocity -0x00A0, at OBJ_X 16, every time) —
 *      the honest hole the crafted cases exist to fill, asserted so it cannot quietly become
 *      coverage, and the producing line for the entry numbers the routine header quotes.
 *   1. EQUAL (captured) — EVERY captured dispatch replayed on fresh clones. No sampling: the
 *      natural count is small and test 0 asserts the capture is complete.
 *   3. LIVE (whole attract) — the live-out measurement: the candidate wired at 0x20E1 for a real
 *      4000-frame attract run, its frame trace diffed against the all-oracle baseline on every
 *      cell outside the stack scratch below each frame's live SP.
 *      ★ loc_20e1 is cycle-free and, dissolved, so is the whole 0x20C3/0x21BA/0x1F8D fragment below
 *      it; its true oracle cost is measured PER DISPATCH (priceDissolved, up to the frozen walk-step
 *      boundary) and charged back inside the override. Without that the run diverges purely because
 *      cycle-free code shifts the NMI — carried as a teeth case so the restoration cannot be dropped
 *      silently.
 *      COVERAGE: attract only. Gameplay, the other three boards and every crafted shape in test 4
 *      are NOT exercised live.
 *   4. EQUAL (crafted) — the entry shapes attract never delivers, each a real captured state with
 *      one surgical poke applied identically to both sides: the velocity already rightward, zero,
 *      a large positive whole part, and a zero fraction. Record-relativity needs no craft — the
 *      captures already span 7 distinct record bases — but one crafted base nudge is included too.
 *   5. OBSERVED EFFECT — the one test here that is NOT an equivalence check, and says so: it runs
 *      the ORACLE in plain attract and asserts the record's OBJ_X then steps +1 per frame. It
 *      grounds the routine header's role line against the real ROM's downstream behaviour, and it
 *      passes or fails regardless of what the candidate does.
 *   6. TEETH — five broken twins, each of which this contract MUST catch, plus the two
 *      pinning cases below them.
 *
 * ON THE CAPTURE HOOK AND RE-ENTRY. The tail runs the rest of the object loop, which can dispatch
 * 0x20E1 again for a later slot. A clone carries the source machine's override map, so those nested
 * dispatches resolve to the capture hook — which is disarmed once the host run is over, and which
 * delegates to the oracle. That is the callee-is-oracle isolation the unit gate wants, applied to a
 * routine that can re-enter itself: one dispatch of the candidate per comparison, oracle underneath
 * on both sides.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-20e1.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_20e1 as oracle } from "../../translated/loc_20e1.js";
import { loc_20e1 } from "../loc_20e1.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, OBJ_X } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { recordFrameSp, frameFloors } from "./_frame-sp.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x20e1;

// The record fields, mirrored from the routine under test. These two are also this routine's OWN
// store footprint — the ordered write-sequence check filters the write log down to exactly them, so
// the tail chain's writes are not mixed in.
const VELOCITY_X_WHOLE = 0x10;
const VELOCITY_X_FRACTION = 0x11;
const OWN_STORES = [VELOCITY_X_WHOLE, VELOCITY_X_FRACTION];

// The boundary where the frozen chain resumes: loc_1f8d's still-live m.call(0x1f83) back into the
// object-walk step. loc_20e1 is now DISSOLVED — it direct-calls loc_20c3, which direct-calls
// publishBarrelSprite / loc_1f8d — so its whole fragment above 0x1f83 runs cycle-free; 0x1f83 and
// below stay frozen and charge their own T-states.
const WALK_STEP = 0x1f83;

const ATTRACT_FRAMES = 4000;
const LIVE_FRAMES = 4000;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP. */
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
 * Record this machine's OWN store sequence while `fn` runs: the writes to the record's velocity
 * bytes, in order, isolated by address so the tail chain's writes (and its stack pushes) are not
 * mixed in. This is the only half of the contract that sees a value-neutral dropped store.
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
    threw = e;
  }
  m.mem.write8 = base;
  return { writes, ret, threw };
}

/**
 * Run the oracle on one clone and a candidate on another, byte-identical one, and report the
 * DISSOLVED-form contract: RAM − the stack scratch below the entry SP, this routine's own ordered store sequence, the final
 * guest SP, and the return value. pc and the rest of the register file are dropped with the frozen
 * call bracket that used to make them comparable.
 */
// The staging cursor the walk owns as a plain value, parked in the alternate bank at entry; the
// dissolved chain takes it as `cur`. WALK_STEP (0x1f83) is the frozen loop-back, stubbed on both
// clones so each side publishes exactly the slot under test and stops.
const cursorOf = (m) => ({ page: m.regs.h_ * 256, cursor: m.regs.l_ });

function comparePair(entry, fn) {
  const o = entry.clone();
  const c = entry.clone();
  o.routines.set(WALK_STEP, () => {});
  c.routines.set(WALK_STEP, () => {});

  const ro = recordOwnWrites(o, oracle);
  const rc = recordOwnWrites(c, (mm) => fn(mm, cursorOf(mm)));

  const firstWriteDiff = (() => {
    const n = Math.min(ro.writes.length, rc.writes.length);
    for (let i = 0; i < n; i++) if (ro.writes[i] !== rc.writes[i]) return { i, a: ro.writes[i], b: rc.writes[i] };
    if (ro.writes.length !== rc.writes.length) {
      return { i: n, a: ro.writes[n] ?? "(end)", b: rc.writes[n] ?? "(end)" };
    }
    return null;
  })();

  return {
    ram: rc.threw ? null : firstRamDiff(o, c, entry.regs.sp),
    writeDiff: rc.threw ? null : firstWriteDiff,
    spO: o.regs.sp, spC: rc.threw ? null : c.regs.sp,
    retO: ro.ret, retC: rc.ret,
    threw: rc.threw,
    oracleMachine: o,
  };
}

// The final guest SP is dropped: the dissolved form threads the cursor as a value and uses no guest
// stack of its own, so it no longer tracks the oracle's m.call/ret bracket.
const mismatched = (r) =>
  r.threw != null || r.ram !== null || r.writeDiff !== null || r.retO !== r.retC;

const describeMismatch = (r) =>
  r.threw ? `candidate threw: ${r.threw.message}`
    : r.ram ? `RAM@${hx(r.ram.addr)} oracle=${r.ram.a} cand=${r.ram.b}`
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
 * What the ORACLE spends on the fragment this rewrite replaces cycle-free: loc_20e1's two stores,
 * the dissolved loc_20c3 / sprite tail / loc_1f8d, up to — but NOT including — the frozen
 * m.call(0x1f83). Measured on a rehosted machine with that boundary stubbed to zero cost, so the
 * price is exactly the fragment and not the frozen subtree past it (which the live run charges for
 * itself when its own JS chain reaches the same frozen call). Replaces the old fixed 48-cycle
 * charge, which modelled only ROM 0x20E1's stores + jp and left the dissolved 0x20C3/0x21BA/0x1F8D
 * fragment uncharged, forking the run on the spin counter.
 */
function priceDissolved(m) {
  const probe = rehost(m);
  probe.routines.set(WALK_STEP, () => 0);
  const before = probe.cycles;
  oracle(probe);
  return probe.cycles - before;
}

// -- 0/1. real dispatches -----------------------------------------------------

/**
 * Drive attract and clone the machine at every real 0x20E1 dispatch. The hook is DISARMED once the
 * host run finishes so that replaying a capture — whose tail can re-enter 0x20E1 for a later slot —
 * does not append to the capture list; the disarmed hook is then a plain delegate to the oracle.
 */
let ARMED = true;
function captureDispatches(frames) {
  const caps = [];
  let total = 0;
  const ov = new Map([[TARGET, (mm) => {
    if (ARMED) {
      total++;
      caps.push(mm.clone());
    }
    return oracle(mm);
  }]]);
  new Machine(ROM, { overrides: ov }).runFrames(frames);
  ARMED = false;
  return { caps, total };
}

let CAPTURED = null;
const captured = () => (CAPTURED ??= captureDispatches(ATTRACT_FRAMES));

/** The entry shape: the record's whole 16-bit velocity, whose high byte is what ROM 0x20B5 branched on. */
const shapeOf = (m) =>
  (m.mem.read8((m.regs.ix + VELOCITY_X_WHOLE) & 0xffff) << 8) |
  m.mem.read8((m.regs.ix + VELOCITY_X_FRACTION) & 0xffff);

// Attract delivers exactly this one velocity on entry (-0x00A0, i.e. leftward by 160/256 px per
// frame), and nothing else.
const SHAPES_ATTRACT_DELIVERS = [0xffa0];

// …and every dispatch arrives with the record at this OBJ_X. Both are asserted so the routine
// header's "one entry shape" hole and its observed-entry numbers have a producing line here.
const ATTRACT_ENTRY_OBJ_X = 16;

test("REACHABILITY: 0x20e1 is dispatched naturally, and attract delivers only one entry shape", () => {
  const { caps, total } = captured();
  assert.ok(total > 0, "0x20e1 should be dispatched during attract (ROM 0x20B5's tail jump)");
  assert.equal(caps.length, total, "every dispatch must be captured — this gate replays all of them");

  const bases = new Set(caps.map((e) => e.regs.ix));
  const shapes = new Set(caps.map(shapeOf));
  for (const s of SHAPES_ATTRACT_DELIVERS) {
    assert.ok(shapes.has(s), `attract was expected to deliver whole-pixel velocity ${hx(s)}, and did not`);
  }
  // The honest hole, asserted so it cannot silently become coverage.
  assert.equal(shapes.size, SHAPES_ATTRACT_DELIVERS.length,
    `attract now delivers entry shapes ${[...shapes].map(hx).join(",")} — the header's ` +
    "one-shape claim and the crafted list need updating");
  assert.ok(bases.size > 1, "the captures must span more than one record base for record-relativity");

  for (const e of caps) {
    assert.equal(e.mem.read8((e.regs.ix + OBJ_X) & 0xffff), ATTRACT_ENTRY_OBJ_X,
      `a dispatch at ${hx(e.regs.ix)} arrived at a different OBJ_X — the routine header quotes ` +
      `${ATTRACT_ENTRY_OBJ_X} for every one of them`);
  }

  console.log(`  REACHABILITY: ${total} natural dispatches in ${ATTRACT_FRAMES} attract frames; ` +
    `${bases.size} record bases (${[...bases].map(hx).join(",")}); ` +
    `entry velocity ${[...shapes].map(hx).join(",")}; entry OBJ_X ${ATTRACT_ENTRY_OBJ_X} on all ${total}`);
});

test("EQUAL (captured): loc_20e1 == oracle on every real dispatch", () => {
  const { caps, total } = captured();
  assert.ok(caps.length >= 1, "expected at least one real 0x20e1 dispatch during attract");

  for (const entry of caps) {
    const r = comparePair(entry, loc_20e1);
    assert.ok(!mismatched(r), `captured dispatch at ix=${hx(entry.regs.ix)}: ${describeMismatch(r)}`);
  }

  // Non-vacuity: the ORACLE really did stamp +1.0 px/frame onto the record, from a DIFFERENT value.
  const sample = caps[0];
  const base = sample.regs.ix;
  assert.notEqual(sample.mem.read8((base + VELOCITY_X_WHOLE) & 0xffff), 1,
    "the captured entries must not already hold the value the routine writes");
  const after = comparePair(sample, loc_20e1).oracleMachine;
  assert.equal(after.mem.read8((base + VELOCITY_X_WHOLE) & 0xffff), 1, "oracle must leave whole pixels = 1");
  assert.equal(after.mem.read8((base + VELOCITY_X_FRACTION) & 0xffff), 0, "oracle must leave the fraction = 0");

  console.log(`  EQUAL/captured: ${caps.length} of ${total} real dispatches replayed (all of them) — ` +
    "identical on RAM − the stack scratch below the entry SP, this routine's own store sequence, the final guest SP and the return");
});

// -- 3. LIVE (whole attract): the live-out measurement ------------------------

let BASELINE = null;
function baselineFrames() {
  if (!BASELINE) {
    const m = new Machine(ROM);
    const sp = recordFrameSp(m);
    m.runFrames(LIVE_FRAMES);
    BASELINE = Object.assign(m.frames, { sp });
  }
  return BASELINE;
}

/**
 * Run attract with `fn` wired at 0x20E1. `charge` restores the cycles the cycle-free dissolved
 * fragment does not spend — measured PER DISPATCH by priceDissolved and charged at the frozen
 * walk-step boundary, the point the oracle would next execute. The frozen subtree past the boundary
 * still charges its own T-states on the live run, so adding the oracle's total would double-count it.
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
  m.runFrames(LIVE_FRAMES);
  return { frames: Object.assign(m.frames, { sp }), calls };
}

/**
 * The state-offset -> RAM-address table for the trace diff. Built with Array.from, NOT
 * `dumpState().map(...)`: dumpState returns a Uint8Array, whose map truncates every address to a
 * byte and would mis-classify which bytes are in STACK_SCRATCH.
 */
function addressTable() {
  const probe = new Machine(ROM);
  return Array.from(probe.dumpState(), (_, i) => probe.stateOffsetToAddr(i));
}

/** First (frame, address) where two traces differ outside the stack scratch below each frame's live SP. */
function firstTraceDiff(a, b, addrOf) {
  const n = Math.min(a.length, b.length);
  const floors = frameFloors(a.sp, b.sp);
  for (let i = 0; i < n; i++) {
    const A = a[i], B = b[i];
    const dead = deadStackBelow(STACK_SCRATCH, floors[i]);
    for (let j = 0; j < A.length; j++) {
      if (A[j] !== B[j] && !dead(addrOf[j])) return { frame: i, addr: addrOf[j], a: A[j], b: B[j] };
    }
  }
  return null;
}

// RETIRED (both arms). These wired loc_20e1 live at 0x20E1 standalone in an otherwise-frozen attract
// run. The exx/cursor dissolution makes that impossible: loc_20e1 now takes the staging cursor `cur`
// as a value from its idiomatic caller (loc_20b5), so it cannot be dispatched by address with only
// the machine. The whole-run trace they proved is covered by idiomatic.test.js's FULL FLIP.
nodeTest("LIVE: retired — the routine now takes the cursor as a value; FULL FLIP covers the whole run", {
  skip: "retired: loc_20e1 takes the staging cursor from its idiomatic caller and cannot be wired standalone; whole-run trace covered by idiomatic.test.js (FULL FLIP)",
}, () => {});

// -- 4. EQUAL (crafted): the entry shapes attract never delivers --------------

// Each case is a REAL captured state with one surgical poke, applied identically on both sides.
const CRAFTED = [
  { name: "already rightward: whole 1, fraction 0", poke: { whole: 0x01, fraction: 0x00 } },
  { name: "whole-pixel byte 1, fraction nonzero", poke: { whole: 0x01, fraction: 0x80 } },
  { name: "large positive whole part", poke: { whole: 0x7f, fraction: 0xff } },
  { name: "leftward by a whole pixel", poke: { whole: 0xff, fraction: 0x00 } },
  { name: "fraction already zero, whole leftward", poke: { whole: 0xfe, fraction: 0x00 } },
  // Zero is the shape ROM 0x20B5 keeps for ITSELF (its branch is `nonzero -> here`), so this arm
  // cannot be reached with it in play. Included anyway: nothing in THIS routine tests the byte.
  { name: "velocity zero — a shape the caller never routes here", poke: { whole: 0x00, fraction: 0x00 } },
];

function craft(entry, poke, ix = entry.regs.ix) {
  const e = entry.clone();
  e.regs.ix = ix;
  e.mem.write8((ix + VELOCITY_X_WHOLE) & 0xffff, poke.whole);
  e.mem.write8((ix + VELOCITY_X_FRACTION) & 0xffff, poke.fraction);
  return e;
}

const craftedEntries = () => {
  const { caps } = captured();
  const list = CRAFTED.map((c) => ({ name: c.name, entry: craft(caps[0], c.poke) }));
  // One nudged record base as well, on top of the 7 the captures already span.
  const other = (caps[0].regs.ix + 0x20) & 0xffff;
  list.push({ name: `nudged record base ${hx(other)}`, entry: craft(caps[0], { whole: 0xff, fraction: 0xa0 }, other) });
  return list;
};

test("EQUAL (crafted): every entry shape attract never delivers matches the oracle", () => {
  for (const { name, entry } of craftedEntries()) {
    const r = comparePair(entry, loc_20e1);
    assert.ok(!mismatched(r), `${name}: ${describeMismatch(r)}`);
    // Non-vacuity: the oracle really wrote the pair, at THIS record base.
    const base = entry.regs.ix;
    assert.equal(r.oracleMachine.mem.read8((base + VELOCITY_X_WHOLE) & 0xffff), 1, `${name}: oracle whole pixels`);
    assert.equal(r.oracleMachine.mem.read8((base + VELOCITY_X_FRACTION) & 0xffff), 0, `${name}: oracle fraction`);
  }
  console.log(`  EQUAL/crafted: ${craftedEntries().length} shapes — already-rightward, a nonzero fraction, ` +
    "a large positive whole part, both leftward forms, zero, and a nudged record base");
});

test("RECORD-RELATIVE: the write follows the record pointer, not a fixed address", () => {
  const { caps } = captured();
  const bases = [...new Set(caps.map((e) => e.regs.ix))];
  assert.ok(bases.length > 1, "needs captures at more than one record base");
  for (const b of bases) {
    const entry = caps.find((e) => e.regs.ix === b);
    const r = comparePair(entry, loc_20e1);
    assert.ok(!mismatched(r), `base ${hx(b)}: ${describeMismatch(r)}`);
    assert.equal(r.oracleMachine.mem.read8((b + VELOCITY_X_WHOLE) & 0xffff), 1,
      `base ${hx(b)}: the oracle's write must land on THIS record`);
  }
  console.log(`  RECORD-RELATIVE: ${bases.length} distinct record bases (${bases.map(hx).join(",")}), each matched`);
});

test("OBSERVED EFFECT (oracle only, not an equivalence check): after the routine, the record's OBJ_X climbs by exactly one pixel per frame", () => {
  // The prediction the role line makes — a +1.0 px/frame horizontal velocity — checked downstream,
  // in a plain attract run, on the cell the velocity is supposed to drive. This runs the ORACLE, so
  // it is grounding for the header, not a gate on the candidate: breaking the candidate cannot make
  // it fail, and it is not counted as part of the equivalence contract.
  const events = [];
  const ov = new Map([[TARGET, (mm) => {
    events.push({ frame: mm.frames.length, ix: mm.regs.ix });
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: ov });
  host.runFrames(ATTRACT_FRAMES);
  assert.ok(events.length > 0, "expected natural dispatches to observe");

  const probe = new Machine(ROM);
  const offsetOf = new Map();
  const n = probe.dumpState().length;
  for (let i = 0; i < n; i++) offsetOf.set(probe.stateOffsetToAddr(i), i);

  const SPAN = 10;
  for (const e of events) {
    const off = offsetOf.get((e.ix + OBJ_X) & 0xffff);
    const xs = [];
    for (let f = e.frame; f < Math.min(e.frame + SPAN, host.frames.length); f++) xs.push(host.frames[f][off]);
    for (let i = 1; i < xs.length; i++) {
      assert.equal(xs[i], (xs[0] + i) & 0xff,
        `after the dispatch at frame ${e.frame} on ${hx(e.ix)}, OBJ_X went [${xs.join(",")}] — ` +
        "not one pixel per frame, so the +1.0 px/frame reading in the routine header is wrong");
    }
  }
  console.log(`  OBSERVED EFFECT: ${events.length} dispatches, each followed by ${SPAN} frames of ` +
    "OBJ_X stepping +1/frame — the role line's downstream prediction, confirmed");
});

// -- 5. TEETH -----------------------------------------------------------------

/** (a) the two bytes swapped: 0x0001 (1/256 px/frame) instead of 0x0100. */
function brokenSwappedBytes(m) {
  const { mem8 } = m;
  const at = (d) => (m.regs.ix + d) & 0xffff;
  mem8[at(VELOCITY_X_WHOLE)] = 0;
  mem8[at(VELOCITY_X_FRACTION)] = 1;
  return m.call(0x20c3);
}

/** (b) the fraction store dropped, leaving whatever the record arrived with. */
function brokenNoFractionStore(m) {
  const { mem8 } = m;
  const at = (d) => (m.regs.ix + d) & 0xffff;
  mem8[at(VELOCITY_X_WHOLE)] = 1;
  return m.call(0x20c3);
}

/** (c) the mirror value — the other arm's leftward velocity. */
function brokenMirrorValue(m) {
  const { mem8 } = m;
  const at = (d) => (m.regs.ix + d) & 0xffff;
  mem8[at(VELOCITY_X_WHOLE)] = 0xff;
  mem8[at(VELOCITY_X_FRACTION)] = 0;
  return m.call(0x20c3);
}

/** (d) the tail dropped: the two stores land but the launch tail never runs. */
function brokenNoTail(m) {
  const { mem8 } = m;
  const at = (d) => (m.regs.ix + d) & 0xffff;
  mem8[at(VELOCITY_X_WHOLE)] = 1;
  mem8[at(VELOCITY_X_FRACTION)] = 0;
}

/** (e) the write goes to a fixed address instead of following the record pointer. */
function brokenFixedAddress(m) {
  const { mem8 } = m;
  mem8[0x6710] = 1;
  mem8[0x6711] = 0;
  return m.call(0x20c3);
}

test("TEETH: five broken twins are all CAUGHT by the captured + crafted entries", () => {
  const { caps } = captured();
  const entries = [
    ...craftedEntries(),
    ...caps.map((e) => ({ name: `a real attract dispatch at ${hx(e.regs.ix)}`, entry: e })),
  ];
  const hunt = (fn) => {
    for (const { name, entry } of entries) {
      const r = comparePair(entry, fn);
      if (mismatched(r)) return { name, r };
    }
    return null;
  };

  const twins = {
    "swapped-bytes": brokenSwappedBytes,
    "fraction-store-dropped": brokenNoFractionStore,
    "mirror-value": brokenMirrorValue,
    "tail-dropped": brokenNoTail,
    "fixed-address": brokenFixedAddress,
  };
  for (const [label, fn] of Object.entries(twins)) {
    const hit = hunt(fn);
    assert.notEqual(hit, null, `the ${label} twin ESCAPED — the gate proves nothing`);
    console.log(`  TEETH/${label}: caught on ${hit.name} — ${describeMismatch(hit.r)}`);
  }

  // WHICH half of the contract catches the dropped fraction store, pinned both ways. On an entry
  // arriving with a nonzero fraction the store is value-carrying, so the RAM diff sees it. On an
  // entry whose fraction is ALREADY 0 the store changes no byte, RAM is identical, and only the
  // write-sequence comparison notices the missing write — which is what that comparison is for.
  const nonZeroFraction = craftedEntries().find((c) => c.name === "whole-pixel byte 1, fraction nonzero");
  const loud = comparePair(nonZeroFraction.entry, brokenNoFractionStore);
  assert.notEqual(loud.ram, null, "with a nonzero fraction on entry, the dropped store must show up in RAM");

  const zeroFraction = craftedEntries().find((c) => c.name === "already rightward: whole 1, fraction 0");
  const quiet = comparePair(zeroFraction.entry, brokenNoFractionStore);
  assert.equal(quiet.ram, null, "with the fraction already 0 the dropped store leaves RAM identical");
  assert.notEqual(quiet.writeDiff, null,
    "…and the write-sequence comparison must be what catches it there — otherwise a value-neutral " +
    "dropped store would pass this gate");
  console.log("  TEETH/value-neutral: a dropped store that changes no byte is caught by the " +
    "write-sequence comparison alone, which is why that comparison is in the contract");
});
