// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for armMarioClimbAtLadderEnd (ROM 0x1AFE) — the hammer-climb collision handler: look
 * Mario's grid cell up in the type-0 object-parameter table and, on a hit, stamp the climb
 * sprite code, write the near-end-of-scan flag at 0x621A, and commit this frame's climb-limit
 * pair before driving the climb.
 *
 * The oracle's control flow has FIVE exits and each nets exactly ONE caller return:
 *   • hammer gate (MARIO_HAMMER_ACTIVE == 1) — `ret z`, one ret;
 *   • object-table MISS (findOppositeLadderEnd not found) — findOppositeLadderEnd double-unwinds, one net ret;
 *   • found tag 0 — tail-call loc_1b4e (commit pair the ordinary way, climb up); one net ret;
 *   • found tag 1, flag != 0 — `ret nz`, one ret;
 *   • found tag 1, flag == 0 — write the pair SWAPPED, tail-call climbDownWhileHeld; one net ret.
 * The idiomatic routine models no stack (direct calls + plain JS returns), so the harness does
 * ONE m.ret() on the candidate after it runs, lining pc + SP up with the oracle. The dissolved
 * `call 0x236e`, the push-af/pop-af bracket, and the tail-call return brackets all churn dead
 * STACK_SCRATCH — excluded by the memory-equivalence contract (RAM − the stack scratch below the entry SP + pc + SP;
 * live-out is memory-only). Real dispatches have SP ~0x6bea, so that churn stays inside
 * STACK_SCRATCH.
 *
 *   1. REACHABILITY — 0x1AFE dispatches every hammer-climb frame during attract, spanning the
 *      hammer-gate early-out, the tag-0 arm, and the tag-1/flag-0 arm.
 *
 *   2. EQUAL (real dispatches) — hook 0x1AFE in a real attract run and compare oracle vs
 *      candidate on RAM − the stack scratch below the entry SP + pc + SP for every captured entry.
 *
 *   3. EQUAL (crafted) — from a real base, plant a controlled table (+ fix Mario's cell) to drive
 *      the two arms attract does not reach: the not-found MISS (writes nothing live) and the
 *      tag-1/flag-1 return arm (stamps only the sprite code + the 0x621A flag, no limit writes),
 *      plus a clean tag-1/flag-0 arm that pins the swapped-order limit pair. Each asserts the
 *      oracle's own arm non-vacuously.
 *
 *   4. TEETH — two deliberately-broken twins, each the SAME contract MUST catch:
 *        (a) wrong sprite code — stamps 0x07 instead of 0x06; caught on any found path at
 *            MARIO_SPRITE_CODE.
 *        (b) swapped limits — writes the tag-1/flag-0 pair in loc_1b4e's order instead of the
 *            opposite order; caught on the crafted flag-0 arm at MARIO_CLIMB_LIMIT_A.
 *
 * LIVE-OUT, cross-file and therefore recorded here rather than in the routine: memory-only. The
 * caller (walkLeftWhileHeld) tail-returns this routine's result and consumes no register it leaves;
 * the oracle's residual registers and flags, its push-af/pop-af bracket, and its terminal returns
 * are dead ABI.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1afe.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1afe as oracle } from "../../translated/loc_1afe.js";
import { armMarioClimbAtLadderEnd } from "../armMarioClimbAtLadderEnd.js";
import { findOppositeLadderEnd } from "../findOppositeLadderEnd.js";                 // ROM 0x236E — used by the teeth twins
import { loc_1b4e } from "../loc_1b4e.js";                 // ROM 0x1B4E — used by the teeth twins
import { climbDownWhileHeld } from "../climbDownWhileHeld.js"; // ROM 0x1B38 — used by the teeth twins
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  P1_INPUT,
  MARIO_ON_LADDER,
  MARIO_HAMMER_ACTIVE,
  MARIO_X,
  MARIO_Y,
  MARIO_SPRITE_CODE,
  MARIO_CLIMB_LIMIT_A,
  MARIO_CLIMB_LIMIT_B,
  OBJ_PARAM_TABLE0,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1afe;
const CLIMB_FLAG = 0x621a; // the shared board flag this routine writes (unnamed in names.js)
const NEAR = 0x15;         // near paired-slot offset past a matched table byte (findOppositeLadderEnd stride)
const FAR = 0x2a;          // far paired-slot offset past a matched table byte (findOppositeLadderEnd stride)
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// A fixed cell + table layout for the crafted arms. searchKey = (X|3)&0xfb always has its low
// three bits == 0b011, so a 0xFF filler can never alias it; yLimit = (Y+8).
const FIXED_X = 0x80;
const FIXED_Y = 0x40;
const SEARCH_KEY = (FIXED_X | 0x03) & 0xfb; // 0x83
const Y_LIMIT = (FIXED_Y + 8) & 0xff;       // 0x48
const FAR_BYTE = 0x55;                      // the paired far-slot byte findOppositeLadderEnd returns in B
const FILLER = 0xff;                        // table filler; (FILLER & 7) != (SEARCH_KEY & 7)

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP (the dead stack the
 *  dissolved call/push-af/tail-call churn writes — the standard gate excludes it). */
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

/** All non-stack RAM addresses that changed between two machines (write-set checks). */
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

/** Run the ORACLE on a fresh clone. Every selected path ends in a net `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/** Run a candidate on a fresh clone, then model the chain's single net return with one m.ret()
 *  so pc + SP match the oracle's (the idiomatic routine uses the JS call stack, never pc/SP). */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over the contract: RAM − the stack scratch below the entry SP, pc, SP. NO registers —
 *  live-out is memory-only. Returns human-readable mismatches. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

// -- capture (memoised — attract is deterministic) ----------------------------

let CAPS = null;
/** Hook 0x1AFE in a real attract run and clone the machine at each real dispatch. The wrapper
 *  snapshots the entry state, then runs the oracle so the host game proceeds undisturbed. */
function getCaps() {
  if (CAPS) return CAPS;
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < 400) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(9000);
  CAPS = caps;
  return caps;
}

/** Classify a captured/crafted entry by the oracle arm it will take (for reachability + picking
 *  representative bases). Runs the registry's 236e on a throwaway clone — non-destructive. */
function classify(entry) {
  const t = entry.clone();
  if (t.mem.read8(MARIO_HAMMER_ACTIVE) === 1) return "early-ret";
  const yLimit = (t.mem.read8(MARIO_Y) + 8) & 0xff;
  const key = (t.mem.read8(MARIO_X) | 0x03) & 0xfb;
  t.regs.a = key; t.regs.d = yLimit; t.regs.bc = 0x0015;
  const found = t.call(0x236e); // translated sub_236e through the registry
  if (!found) return "miss";
  const tag = t.regs.a;
  const flag = t.regs.c <= 4 ? 1 : 0;
  if (tag === 0) return "tag0";
  return flag === 0 ? "tag1flag0" : "tag1flag1";
}

// -- crafted bases ------------------------------------------------------------

/** Force the object-table lookup to MISS: proceed past the hammer gate, then fill the whole
 *  scan window with a filler the search key can never equal. */
function craftMiss(base) {
  const e = base.clone();
  e.mem.write8(MARIO_HAMMER_ACTIVE, 2); // != 1 -> proceed
  for (let i = 0; i < 21; i++) e.mem.write8((OBJ_PARAM_TABLE0 + i) & 0xffff, FILLER);
  return e;
}

/** Plant a table with the key at `matchOffset` and the discriminator on the NEAR slot, so
 *  findOppositeLadderEnd returns tag 1. The residual count (21 − (matchOffset+1)) then decides the flag:
 *  matchOffset 0 -> residual 20 -> flag 0; matchOffset 16 -> residual 4 -> flag 1. */
function craftTag1(base, { matchOffset, input, onLadder } = {}) {
  const e = base.clone();
  e.mem.write8(MARIO_HAMMER_ACTIVE, 2);   // proceed
  e.mem.write8(MARIO_X, FIXED_X);          // pin the search key
  e.mem.write8(MARIO_Y, FIXED_Y);          // pin the discriminator / (Y+8) limit
  e.mem.write8(MARIO_SPRITE_CODE, 0x00);   // so the 0x06 stamp is a visible change
  e.mem.write8(MARIO_CLIMB_LIMIT_A, 0x00); // clean before/after for the limit checks
  e.mem.write8(MARIO_CLIMB_LIMIT_B, 0x00);
  e.mem.write8(CLIMB_FLAG, 0xee);          // so the 0/1 flag write is a visible change
  for (let i = 0; i < 21; i++) e.mem.write8((OBJ_PARAM_TABLE0 + i) & 0xffff, FILLER);
  const M = (OBJ_PARAM_TABLE0 + matchOffset) & 0xffff;
  e.mem.write8(M, SEARCH_KEY);                    // the matched entry
  e.mem.write8((M + NEAR) & 0xffff, Y_LIMIT);     // discriminator on the near slot -> tag 1
  e.mem.write8((M + FAR) & 0xffff, FAR_BYTE);     // the OTHER slot -> returned in B
  if (input !== undefined) e.mem.write8(P1_INPUT, input);
  if (onLadder !== undefined) e.mem.write8(MARIO_ON_LADDER, onLadder);
  return e;
}

// -- teeth twins (same shape as armMarioClimbAtLadderEnd, one thing broken) -------------------

/** Shared body: run the real setup + lookup, then apply a per-twin break at the writes. */
function twinBody(m, { spriteOr, swapLimits }) {
  const { regs, mem } = m;
  if (mem.read8(MARIO_HAMMER_ACTIVE) === 1) return;
  const yLimit = (mem.read8(MARIO_Y) + 8) & 0xff;
  const searchKey = (mem.read8(MARIO_X) | 0x03) & 0xfb;
  regs.a = searchKey; regs.d = yLimit; regs.bc = 21;
  if (!findOppositeLadderEnd(m).hit) return;
  const tag = regs.a, slotByte = regs.b, residualCount = regs.c;
  mem.write8(MARIO_SPRITE_CODE, (mem.read8(MARIO_SPRITE_CODE) & 0x80) | spriteOr);
  const nearEndOfScan = residualCount <= 4 ? 1 : 0;
  mem.write8(CLIMB_FLAG, nearEndOfScan);
  if (tag === 0) {
    regs.b = slotByte; regs.d = yLimit;
    loc_1b4e(m);
    return;
  }
  if (nearEndOfScan !== 0) return;
  if (swapLimits) {
    mem.write8(MARIO_CLIMB_LIMIT_A, slotByte); // BUG: opposite of the oracle (should be yLimit)
    mem.write8(MARIO_CLIMB_LIMIT_B, yLimit);   // BUG
  } else {
    mem.write8(MARIO_CLIMB_LIMIT_A, yLimit);
    mem.write8(MARIO_CLIMB_LIMIT_B, slotByte);
  }
  climbDownWhileHeld(m);
}
const brokenSpriteCode = (m) => twinBody(m, { spriteOr: 0x07, swapLimits: false }); // (a)
const brokenSwappedLimits = (m) => twinBody(m, { spriteOr: 0x06, swapLimits: true }); // (b)

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x1AFE dispatches during attract, spanning the hammer gate + found arms", () => {
  const caps = getCaps();
  assert.ok(caps.length >= 1, "expected at least one real 0x1AFE dispatch during attract");
  const counts = {};
  for (const c of caps) counts[classify(c)] = (counts[classify(c)] || 0) + 1;
  assert.ok((counts["early-ret"] || 0) >= 1, "expected the hammer-gate early-out");
  assert.ok((counts["tag0"] || 0) + (counts["tag1flag0"] || 0) >= 1, "expected at least one found arm");
  console.log(`  REACHABILITY: ${caps.length} dispatches — ${JSON.stringify(counts)}`);
});

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): armMarioClimbAtLadderEnd == oracle on every captured 0x1AFE entry", () => {
  const caps = getCaps();
  assert.ok(caps.length >= 1, "expected at least one real 0x1AFE dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, armMarioClimbAtLadderEnd); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical on RAM+pc+SP`);
});

// -- 2. EQUAL (crafted arms attract never reaches) ----------------------------

test("EQUAL (crafted): MISS, tag1/flag1 (ret), tag1/flag0 (swapped pair) all match the oracle", () => {
  const caps = getCaps();
  const seed = caps.find((c) => classify(c) !== "early-ret") || caps[0];

  // MISS — the object key is not in the table: the routine writes NO live RAM.
  const miss = craftMiss(seed);
  assert.equal(classify(miss), "miss", "craftMiss must actually miss");
  assert.equal(contractDiffs(miss, armMarioClimbAtLadderEnd).length, 0, "MISS arm diverged");
  assert.equal(changedAddrs(miss, runOracle(miss), miss.regs.sp).length, 0, "MISS arm wrote live RAM (should be inert)");

  // tag 1, flag 1 — match near the end of the scan: stamp sprite code + flag, then return; no
  // limit writes.
  const flag1 = craftTag1(seed, { matchOffset: 16 });
  assert.equal(classify(flag1), "tag1flag1", "craftTag1(offset 16) must be tag1/flag1");
  assert.equal(contractDiffs(flag1, armMarioClimbAtLadderEnd).length, 0, "tag1/flag1 arm diverged");
  const f1 = runOracle(flag1);
  assert.equal(f1.mem.read8(MARIO_SPRITE_CODE), 0x06, "tag1/flag1: sprite code stamped 0x06");
  assert.equal(f1.mem.read8(CLIMB_FLAG), 1, "tag1/flag1: near-end flag set to 1");
  assert.equal(f1.mem.read8(MARIO_CLIMB_LIMIT_A), 0x00, "tag1/flag1: MUST NOT write limit A");
  assert.equal(f1.mem.read8(MARIO_CLIMB_LIMIT_B), 0x00, "tag1/flag1: MUST NOT write limit B");

  // tag 1, flag 0 — match at the head: write the pair SWAPPED (A<-Y+8, B<-slot), then the climb
  // dispatch (a no-op here: Down clear + off-ladder). Distinct A/B so order is observable.
  const flag0 = craftTag1(seed, { matchOffset: 0, input: 0x00, onLadder: 0x00 });
  assert.equal(classify(flag0), "tag1flag0", "craftTag1(offset 0) must be tag1/flag0");
  assert.equal(contractDiffs(flag0, armMarioClimbAtLadderEnd).length, 0, "tag1/flag0 arm diverged");
  const f0 = runOracle(flag0);
  assert.equal(f0.mem.read8(CLIMB_FLAG), 0, "tag1/flag0: near-end flag cleared to 0");
  assert.equal(f0.mem.read8(MARIO_CLIMB_LIMIT_A), Y_LIMIT, "tag1/flag0: limit A <- (Y+8)");
  assert.equal(f0.mem.read8(MARIO_CLIMB_LIMIT_B), FAR_BYTE, "tag1/flag0: limit B <- slot byte");

  console.log("  EQUAL/crafted: MISS (inert), tag1/flag1 (sprite+flag only), tag1/flag0 (swapped pair) all identical");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: wrong-sprite-code and swapped-limit twins are CAUGHT", () => {
  const caps = getCaps();

  // (a) wrong sprite code — caught on any found path at MARIO_SPRITE_CODE.
  const found = caps.find((c) => classify(c) === "tag1flag0" || classify(c) === "tag0");
  assert.ok(found, "need a real found dispatch to bait the sprite-code twin");
  const spriteDiffs = contractDiffs(found, brokenSpriteCode);
  assert.ok(spriteDiffs.length > 0, "the wrong-sprite-code twin escaped — the gate is worthless");
  assert.ok(
    spriteDiffs[0].startsWith(`RAM@0x${MARIO_SPRITE_CODE.toString(16)}`),
    `expected the sprite-code diff at MARIO_SPRITE_CODE, got ${spriteDiffs[0]}`,
  );

  // (b) swapped limits — caught on the crafted flag-0 arm at MARIO_CLIMB_LIMIT_A (Y+8 != slot).
  const seed = caps.find((c) => classify(c) !== "early-ret") || caps[0];
  const flag0 = craftTag1(seed, { matchOffset: 0, input: 0x00, onLadder: 0x00 });
  const swapDiffs = contractDiffs(flag0, brokenSwappedLimits);
  assert.ok(swapDiffs.length > 0, "the swapped-limit twin escaped — the gate is worthless");
  assert.ok(
    swapDiffs[0].startsWith(`RAM@0x${MARIO_CLIMB_LIMIT_A.toString(16)}`),
    `expected the swap diff at MARIO_CLIMB_LIMIT_A, got ${swapDiffs[0]}`,
  );

  console.log(`  TEETH: wrong-sprite caught (${spriteDiffs[0]}); swapped-limit caught (${swapDiffs[0]})`);
});
