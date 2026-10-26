// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2b53 (ROM 0x2b53) — the non-25m arm of the player-vs-tilemap
 * descent probe (reached from entry_2b29 when (0x6227) != 1). It probes the tilemap under
 * Mario at up to two offset points via the tile classifier probeTileForLanding:
 *
 *   probe 1 at (X-3, Y+7); probe 2 at (X+4, Y+7).
 *
 * Each probe has three outcomes: the classifier reports "landed" (it has already snapped
 * MARIO_Y and unwound the whole collision walk — its false return, which this routine
 * propagates); the "over a snap column" code 2 (hand off to loc_2b7a, the horizontal
 * X-snap tail); or code 0, no surface here (fall through). Both probes code 0 -> normal
 * return. The routine returns { skip, verdict }: skip is the caller-skip (true on the normal
 * return, false for the two-frame unwind); verdict is the descent value formerly left in A.
 *
 * STACK MODEL. In the oracle, loc_2b53 pushes each `call 0x2b9b` return and either `ret`s
 * once on the normal path (0x2B70 ret z) or is unwound two frames up by probeTileForLanding's own
 * landed-double-skip (entry_2be1 pop x2 + ret) / loc_2b7a's pop hl + ret. The idiomatic
 * routine models no stack (direct calls, a { skip, verdict } return), so runCandidate replays the
 * net stack op the oracle nets on each path, keyed on skip: on the false (unwind) paths one
 * discarded pop + one ret (SP += 4, pc -> two frames up); on the true (normal) path one ret
 * (SP += 2, pc -> the caller). The dissolved push/pop churn lives in STACK_SCRATCH,
 * excluded by the memory-equivalence contract; every live cell is kept.
 *
 *   1. EQUAL (crafted, all five paths) — a real attract base with the tilemap tile under
 *      each probe point poked (reject 0x00 / surface 0xB0) and the descent inputs set to
 *      reach: first-probe landed, first-probe snap, both-reject normal return,
 *      second-probe landed, second-probe snap. Each asserts RAM (minus the stack scratch below the entry SP) +
 *      pc + SP + the result code identical to the oracle, that the idiomatic skip and the
 *      threaded verdict match, and (non-vacuity) that the oracle really took the expected path
 *      (MARIO_Y snapped on a landing / MARIO_X committed on a snap / nothing written on
 *      the normal return).
 *
 *   2. TEETH — three deliberately-broken twins, each MUST be caught:
 *      (a) second-probe-no-offset — the second probe forgets the +7 on its high byte, so
 *          it reads the wrong tile cell; caught on the second-probe paths.
 *      (b) first-no-propagate — drops the first landed-unwind propagation and blunders on
 *          into the second probe; caught on the first-probe-landed path (pc/SP diverge).
 *      (c) invert-snap-test — routes code 0 (not code 2) into loc_2b7a after the first
 *          probe; caught where it wrongly snaps (RAM + pc/SP diverge).
 *
 *   3. REALISM — hook 0x2b53 over a long attract run; replay any real dispatch, else
 *      record that attract never reaches it (entry_2b29, its only caller, is not wired
 *      into the live dispatcher), which is why the crafted paths are the gate.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2b53.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { u8 } from "../../../../core/int.js";
import { loc_2b53 as oracle } from "../../translated/loc_2b53.js";
import { loc_2b53 } from "../loc_2b53.js";
import { probeTileForLanding } from "../probeTileForLanding.js";
import { loc_2b7a } from "../loc_2b7a.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, MARIO_X, MARIO_Y, MARIO_AIR_PREV_Y, MARIO_AIR_VX_HI, MARIO_SPRITE_RECORD, SPRITE_X } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2b53;
const SPRITE_X_ADDR = (MARIO_SPRITE_RECORD + SPRITE_X) & 0xffff; // 0x694c — Mario's sprite record +0 (X)
const IX_BASE = 0x6200;   // object pointer -> Mario block, so ix+5 aliases MARIO_Y (0x6205)
const RET_L0 = 0x2b20;    // loc_2b53's own return (the normal `ret z` lands here; the unwind discards it)
const RET_L1 = 0x1c08;    // the grandparent the two-frame unwind lands on
const SP_TOP = 0x6bf8;    // inside STACK_SCRATCH; RET_L0 at 0x6bf8, RET_L1 at 0x6bfa
const POISON_A = 0xaa;    // entry accumulator; overwritten by the first probe's coordinate load

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// loc_2b53 now returns { skip, verdict } (skip = the old caller-skip boolean; verdict = the value
// the airborne handler branches on, formerly left in A). The frozen oracle and the broken twins
// still return the bare boolean — read either shape uniformly.
const skipOf = (r) => (r && typeof r === "object") ? r.skip : r;
const verdictOf = (r) => (r && typeof r === "object") ? r.verdict : undefined;

// tileAddrForPixel (ROM 0x2FF0), replicated to poke the tile cell under a probe point.
const tileAddr = (y, x) => (0x7400 + (((~y) & 0xff) >> 3) * 32 + ((x >> 3) & 0x1f)) & 0xffff;

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP (the dead
 *  stack region excluded by contract — the dissolved push/pop churn lives there). */
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

/** All non-stack RAM addresses that changed between two machines (for non-vacuity). */
function changedAddrs(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const out = [];
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    out.push(addr);
  }
  return out;
}

/** Run the ORACLE on a fresh clone. Its `m.call` reaches the translated classifier /
 *  X-snap chain, which performs the real rets and (on a landing/snap) the two-frame
 *  unwind. Returns {c, ret}. */
function runOracle(entry) {
  const c = entry.clone();
  const ret = oracle(c);
  return { c, ret };
}

/** Run a candidate on a fresh clone, then replay the net stack op the oracle nets on the
 *  path the candidate took (the idiomatic routine uses the JS call stack and returns a
 *  boolean; it never touches pc/SP itself):
 *    - false (unwind): one discarded pop + one ret  -> SP += 4, pc two frames up.
 *    - true  (normal): one ret                      -> SP += 2, pc to the caller. */
function runCandidate(entry, fn) {
  const c = entry.clone();
  const ret = fn(c);
  if (skipOf(ret) === false) {
    c.pop16(); // discard loc_2b53's own return (the unwind's first pop)
    c.ret();   // net return two frames up
  } else {
    c.ret();   // the normal `ret z`
  }
  return { c, ret };
}

/** Compare candidate vs oracle over the contract: RAM − the stack scratch below the entry SP, pc, SP, and the
 *  LIVE result register (the grandparent reads it back). HL/flags are dead ABI. */
function contractDiffs(entry, fn) {
  const { c: o } = runOracle(entry);
  const { c } = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=0x${(ram.a & 0xff).toString(16)} cand=0x${(ram.b & 0xff).toString(16)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  if (o.regs.a !== c.regs.a) diffs.push(`A oracle=0x${(o.regs.a & 0xff).toString(16)} cand=0x${(c.regs.a & 0xff).toString(16)}`);
  return diffs;
}

// A real booted attract machine, built once and reused as the base for every crafted
// entry (cloned per case, never mutated).
let _base = null;
function base() {
  if (!_base) {
    const host = new Machine(ROM);
    host.runFrames(200);
    assert.equal(host.stoppedBy, null, "attract base run must reach the vblank spin cleanly");
    _base = host.clone();
  }
  return _base;
}

// Fixed probe geometry: X=0x50, Y=0x40 keeps the two probe points in DISTINCT tile cells
// and gives boundary C = ((Y+7) & 0xf8) - 1 = 0x3f, probe value = MARIO_AIR_PREV_Y + 7.
const X = 0x50, Y = 0x40;
const ADDR1 = tileAddr(u8(X - 3), u8(Y + 7)); // first probe cell
const ADDR2 = tileAddr(u8(u8(X - 3) + 7), u8(Y + 7)); // second probe cell (high byte +7)
const SNAPPED_X = u8((X | 0x07) - 4); // 0x53 — the X loc_2b7a commits (same for both its arms)
const LANDED_Y = u8(0x3f - 7); // 0x38 — MARIO_Y after a landing (C - 7)

/** A fresh crafted entry: real attract RAM; Mario's X/Y, the previous-frame airborne Y,
 *  the airborne-velocity high byte, and the object pointer poked; the tile under each
 *  probe cell set (0x00 reject / 0xB0 surface); the sprite-record X pre-poked to a
 *  sentinel so a snap write shows; a poisoned entry accumulator; and a controlled return
 *  stack — RET_L0 (loc_2b53's own return) then RET_L1 (the grandparent) in STACK_SCRATCH. */
function craftEntry({ tile1, tile2, prevY, vxHi = 0x01 }) {
  const e = base().clone();
  e.nextNmi = Infinity;      // neutralise the frame machinery so the oracle's `m.step`
  e.nextBoundary = Infinity; // cannot fire an NMI or push a frame while running isolated
  e.mem.write8(MARIO_X, X);
  e.mem.write8(MARIO_Y, Y);
  e.mem.write8(MARIO_AIR_PREV_Y, prevY & 0xff);
  e.mem.write8(MARIO_AIR_VX_HI, vxHi & 0xff);
  e.mem.write8(SPRITE_X_ADDR, (SNAPPED_X ^ 0xff) & 0xff); // sentinel != the snapped X
  e.mem.write8(ADDR1, tile1 & 0xff);
  e.mem.write8(ADDR2, tile2 & 0xff);
  e.regs.ix = IX_BASE;
  e.regs.a = POISON_A;
  e.regs.sp = 0x6bfc;
  e.push16(RET_L1); // -> 0x6bfa
  e.push16(RET_L0); // -> 0x6bf8 (loc_2b53's own return; SP now SP_TOP)
  assert.equal(e.regs.sp, SP_TOP, "staged SP must be SP_TOP");
  return e;
}

// The five terminal paths, each pinned by an oracle post-condition (non-vacuity).
const CASES = [
  { name: "first-probe landed",  opts: { tile1: 0xb0, tile2: 0x00, prevY: 0x00 }, ret: false, verdict: 1,
    check: (o) => o.mem.read8(MARIO_Y) === LANDED_Y && o.mem.read8(MARIO_X) === X },
  { name: "first-probe snap",    opts: { tile1: 0xb0, tile2: 0x00, prevY: 0x40 }, ret: false, verdict: 1,
    check: (o) => o.mem.read8(MARIO_X) === SNAPPED_X && o.mem.read8(MARIO_Y) === Y },
  { name: "both-reject normal",  opts: { tile1: 0x00, tile2: 0x00, prevY: 0x00 }, ret: true, verdict: 0,
    check: (o) => o.mem.read8(MARIO_Y) === Y && o.mem.read8(MARIO_X) === X },
  { name: "second-probe landed", opts: { tile1: 0x00, tile2: 0xb0, prevY: 0x00 }, ret: false, verdict: 1,
    check: (o) => o.mem.read8(MARIO_Y) === LANDED_Y },
  { name: "second-probe snap",   opts: { tile1: 0x00, tile2: 0xb0, prevY: 0x40 }, ret: false, verdict: 1,
    check: (o) => o.mem.read8(MARIO_X) === SNAPPED_X },
];

// -- 1. EQUAL (crafted, all five paths) ---------------------------------------

test("EQUAL: loc_2b53 == oracle on RAM+pc+SP+A across all five terminal paths", () => {
  assert.notEqual(ADDR1, ADDR2, "the two probe cells must be distinct so tile1/tile2 are independent");

  for (const { name, opts, ret, verdict, check } of CASES) {
    const entry = craftEntry(opts);

    // Non-vacuity: the oracle really took the expected path.
    const { c: o, ret: oret } = runOracle(entry);
    assert.equal(oret, ret, `${name}: oracle return should be ${ret}`);
    assert.ok(check(o), `${name}: oracle did not take the expected path (post-condition failed)`);

    // Equivalence: candidate identical to the oracle over the contract, same caller-skip, and the
    // threaded verdict equal to the oracle's first result byte (the value formerly read from A).
    const diffs = contractDiffs(entry, loc_2b53);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
    const cand = runCandidate(entry, loc_2b53);
    assert.equal(skipOf(cand.ret), ret, `${name}: idiomatic caller-skip should be ${ret}`);
    assert.equal(verdictOf(cand.ret), verdict, `${name}: idiomatic verdict should be ${verdict}`);
    assert.equal(verdictOf(cand.ret), o.regs.a, `${name}: verdict must equal the oracle's first result byte`);

    // The normal-return path writes NO non-stack RAM; the unwind paths write exactly one
    // live cell (MARIO_Y on a landing, or MARIO_X + the sprite X on a snap).
    if (ret === true) {
      assert.deepEqual(changedAddrs(entry, o, entry.regs.sp), [], `${name}: normal return wrote non-stack RAM`);
    }
  }

  console.log(`  EQUAL: ${CASES.length} paths (first landed/snap, both-reject normal, second landed/snap) — RAM+pc+SP+A identical to the oracle; SNAPPED_X=${hx(SNAPPED_X)}, LANDED_Y=${hx(LANDED_Y)}, probe cells ${hx(ADDR1)}/${hx(ADDR2)}`);
});

// -- 2. TEETH -----------------------------------------------------------------

/** (a) second-probe-no-offset — the second probe forgets the +7 on its high byte. */
function brokenSecondProbeNoOffset(m) {
  const { regs } = m;
  regs.hl = (u8(m.mem.read8(MARIO_X) - 3) << 8) | u8(m.mem.read8(MARIO_Y) + 7);
  if (probeTileForLanding(m).skip === false) return false;
  if (regs.a === 2) return loc_2b7a(m);
  regs.hl = (u8(regs.d) << 8) | u8(regs.e); // BUG: no +7 on the high byte
  if (probeTileForLanding(m).skip === false) return false;
  if (regs.a === 0) return true;
  return loc_2b7a(m);
}

/** (b) first-no-propagate — drops the first landed-unwind propagation. */
function brokenFirstNoPropagate(m) {
  const { regs } = m;
  regs.hl = (u8(m.mem.read8(MARIO_X) - 3) << 8) | u8(m.mem.read8(MARIO_Y) + 7);
  probeTileForLanding(m); // BUG: no `if (=== false) return false`
  if (regs.a === 2) return loc_2b7a(m);
  regs.hl = (u8(regs.d + 7) << 8) | u8(regs.e);
  if (probeTileForLanding(m).skip === false) return false;
  if (regs.a === 0) return true;
  return loc_2b7a(m);
}

/** (c) invert-snap-test — routes code 0 (not code 2) into loc_2b7a after the first probe. */
function brokenInvertSnapTest(m) {
  const { regs } = m;
  regs.hl = (u8(m.mem.read8(MARIO_X) - 3) << 8) | u8(m.mem.read8(MARIO_Y) + 7);
  if (probeTileForLanding(m).skip === false) return false;
  if (regs.a === 0) return loc_2b7a(m); // BUG: should be === 2
  regs.hl = (u8(regs.d + 7) << 8) | u8(regs.e);
  if (probeTileForLanding(m).skip === false) return false;
  if (regs.a === 0) return true;
  return loc_2b7a(m);
}

/** First case (by name) where `candidate` diverges from the oracle, or null. */
function firstCatch(candidate) {
  for (const { name, opts } of CASES) {
    const diffs = contractDiffs(craftEntry(opts), candidate);
    if (diffs.length) return { name, diffs };
  }
  return null;
}

test("TEETH: second-probe-no-offset, first-no-propagate and invert-snap-test twins are CAUGHT", () => {
  const noOffset = firstCatch(brokenSecondProbeNoOffset);
  const noPropagate = firstCatch(brokenFirstNoPropagate);
  const invertSnap = firstCatch(brokenInvertSnapTest);

  assert.notEqual(noOffset, null, "the second-probe-no-offset twin escaped — the second probe's offset is untested");
  assert.notEqual(noPropagate, null, "the first-no-propagate twin escaped — the landed-unwind propagation is untested");
  assert.notEqual(invertSnap, null, "the invert-snap-test twin escaped — the snap-code test is untested");

  console.log(
    `  TEETH: second-probe-no-offset caught @${noOffset.name} (${noOffset.diffs[0]}); ` +
      `first-no-propagate caught @${noPropagate.name} (${noPropagate.diffs[0]}); ` +
      `invert-snap-test caught @${invertSnap.name} (${invertSnap.diffs[0]})`,
  );
});

// -- 3. REALISM (attract capture, if any) -------------------------------------

test("REALISM: replay any real 0x2b53 dispatch; else record that attract never reaches it", () => {
  const caps = [];
  const snapMap = new Map([[TARGET, (mm) => { if (caps.length < 16) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snapMap });
  host.runFrames(8000);

  for (const entry of caps) {
    entry.nextNmi = Infinity;
    entry.nextBoundary = Infinity;
    const diffs = contractDiffs(entry, loc_2b53);
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  if (caps.length === 0) {
    console.log("  REALISM: 0 real 0x2b53 dispatches in 8000 attract frames — entry_2b29 (its only caller) is not wired into the live dispatcher; the crafted paths are the gate");
  } else {
    console.log(`  REALISM: ${caps.length} real 0x2b53 dispatch(es) — RAM+pc+SP+A identical to the oracle`);
  }
});
