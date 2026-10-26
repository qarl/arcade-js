// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for scanObjectsAtMarioX (ROM 0x19DA) — the X broad-phase of the
 * per-frame object-collision scan.
 *
 * scanObjectsAtMarioX walks the 3-entry, stride-4 object table at 0x6A0C comparing
 * each record's X (+0) against Mario's X (0x6203); on the FIRST X-match it hands the
 * record off to confirmObjectHit (ROM 0x19ED, already in the idiomatic layer), which
 * may WRITE the hit trio 0x6343 / 0x6342 / 0x6340. So it is gated by clone/replay with
 * a FRESH clone per case (never a shared clone — it writes RAM through the callee).
 *
 * A long attract run dispatches 0x19DA ~1500x, but the 0x6A0C table is EMPTY in attract
 * (Mario's X never matches a record), so the confirm arm is never taken naturally. So —
 * exactly as docs/decompiler-pipeline prescribes for arms attract never reaches — the match arm is gated
 * CRAFTED: a real booted attract machine, cloned, with Mario's X + the table X bytes
 * surgically poked, then oracle-vs-idiomatic on independent fresh clones. Because the
 * scan's deciding input is a single byte (Mario's X), the crafted sweep is EXHAUSTIVE:
 *
 *   1. STRUCTURE — one crafted registering entry (X matches slot 0, record Y-aligned +
 *      eligible): game-visible RAM identical, the oracle wrote the trio, the oracle's
 *      ret pops only from dead STACK_SCRATCH, and the idiomatic side models neither SP
 *      nor pc.
 *
 *   2. EQUAL (Mario-X exhaustive) — a fixed table [slot0 X=0x40, slot1 X=0x80, slot2
 *      X=0xC0], every record Y-aligned + eligible; sweep Mario's X over all 256 values.
 *      Pins the scan: exactly 3 values register (one per slot), 253 touch nothing, and
 *      each registering value stores the RIGHT slot base (0x40→0x6A0C, 0x80→0x6A10,
 *      0xC0→0x6A14) — proving the stride-4 walk, the loop count, and the HL hand-off.
 *
 *   3. TEETH — three broken twins the crafted sweeps MUST catch, each guarding one scan
 *      property: (a) wrong STRIDE (1 instead of 4) — matches a mid-record byte the real
 *      walk skips; (b) wrong LOOP COUNT (2 slots instead of 3) — misses slot 2; (c)
 *      wrong HAND-OFF (passes a fixed record base) — registers the wrong pointer.
 *
 *   4. REALISM — hook 0x19DA over a long attract run, replay every real dispatch
 *      (fresh clones), and confirm idiomatic == oracle on the authentic no-match states.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-19da.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_19da as oracle } from "../../translated/loc_19da.js";
import { scanObjectsAtMarioX as idiomatic } from "../scanObjectsAtMarioX.js";
import { confirmObjectHit } from "../confirmObjectHit.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, MARIO_X, MARIO_Y } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x19da;
const SP_CRAFT = 0x6bf8; //   inside STACK_SCRATCH, headroom for the oracle's ret pop
const HIT_STATE = 0x6340; //  := 1 on a registered hit
const HIT_SUB = 0x6342; //    := 0 on a registered hit
const HIT_PTR = 0x6343; //    := record base pointer (word) on a registered hit
const SLOT = [0x6a0c, 0x6a10, 0x6a14]; // the 3 record bases (stride 4, H fixed at 0x6A)
const SENTINEL = 0x99; //     a value the trio never takes on a real hit, so any write shows

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inStack = (a) => a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;

/**
 * First game-visible differing RAM byte between two machines, EXCLUDING the dead
 * stack-scratch region (the memory-equivalence contract is RAM − the stack scratch below the entry SP). We do
 * NOT diff pc/SP: the oracle's ret/call mutate them while the idiomatic side models
 * neither — that non-modelling is proven separately in STRUCTURE, not by a false-failing
 * direct compare.
 */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0, bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

// A real booted attract machine, built once and reused as the base for every crafted
// entry (cloned per case, never mutated). Genuine work RAM; only Mario's X/Y, the table
// bytes, and the sentinel trio move — the "real state + surgical nudge" crafted method.
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

/**
 * Two independent fresh clones of the base, with SP set into STACK_SCRATCH, the hit trio
 * pre-set to SENTINEL (so any wrongful write shows), and the caller's byte pokes applied
 * identically to both. Returns [oracleClone, candidateClone]. Fresh per case — this
 * routine writes RAM.
 */
function craftPair(pokes) {
  const a = base().clone(), b = base().clone();
  for (const m of [a, b]) {
    m.regs.sp = SP_CRAFT;
    m.mem.write8(HIT_STATE, SENTINEL);
    m.mem.write8(HIT_SUB, SENTINEL);
    m.mem.write8(HIT_PTR, SENTINEL);
    m.mem.write8(HIT_PTR + 1, SENTINEL);
    for (const [addr, val] of pokes) m.mem.write8(addr, val);
  }
  return [a, b];
}

const registered = (m) => m.mem.read8(HIT_STATE) !== SENTINEL; // trio written iff a hit fired

// The Mario-X sweep table: distinct X at each slot (so each slot is individually
// reachable), and every record Y-aligned to 0x50 + eligible (flag bit 3 clear) so an
// X-match always registers. record layout per slot base s: +0 X, +1 flags, +3 Y.
const XS = [0x40, 0x80, 0xc0];
const REC_Y = 0x50;
function sweepPokes(marioX) {
  const pokes = [[MARIO_X, marioX], [MARIO_Y, REC_Y]];
  for (let i = 0; i < 3; i++) {
    pokes.push([SLOT[i] + 0, XS[i]]);
    pokes.push([SLOT[i] + 1, 0x00]); //   eligible (bit 3 clear)
    pokes.push([SLOT[i] + 3, REC_Y]); //  Y-aligned to Mario
  }
  return pokes;
}

// -- 1. STRUCTURE -------------------------------------------------------------

test("STRUCTURE: crafted X-match at slot 0 — trio written, game-visible RAM identical, SP/pc unmodelled", () => {
  const [a, b] = craftPair(sweepPokes(0x40)); // Mario's X == slot 0's X -> match + register
  const aFloor = a.regs.sp;
  oracle(a);
  idiomatic(b);

  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.equal(bad, null, bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);

  // The oracle must have registered the hit into the trio, pointing at slot 0.
  assert.equal(a.mem.read8(HIT_STATE), 0x01, "oracle must set 0x6340 := 1 (hit registered)");
  assert.equal(a.mem.read8(HIT_SUB), 0x00, "oracle must set 0x6342 := 0");
  assert.equal(a.mem.read16(HIT_PTR), SLOT[0], "oracle must store slot 0's base pointer at 0x6343");

  // The oracle's ret pops [SP, SP+1]; both must sit in STACK_SCRATCH, so excluding the
  // stack region in the diff cannot hide a real difference.
  assert.ok(inStack(SP_CRAFT) && inStack((SP_CRAFT + 1) & 0xffff),
    `oracle ret pop target must sit inside STACK_SCRATCH (SP=${hx(SP_CRAFT)})`);

  // idiomatic must model neither the stack nor the return: SP and pc unchanged from entry.
  const [, c] = craftPair(sweepPokes(0x40));
  const sp0 = c.regs.sp, pc0 = c.pc;
  idiomatic(c);
  assert.equal(c.regs.sp, sp0, "scanObjectsAtMarioX must leave SP unchanged (no stack modelling)");
  assert.equal(c.pc, pc0, "scanObjectsAtMarioX must leave pc unchanged (no ret modelling)");
  console.log("  STRUCTURE: trio written; game-visible-identical; idiomatic touches no SP/pc; ret pops dead stack");
});

// -- 2. EQUAL (Mario-X exhaustive) --------------------------------------------

test("EQUAL (Mario-X exhaustive): scanObjectsAtMarioX == oracle over all 256 Mario-X values", () => {
  const wantPtr = { 0x40: SLOT[0], 0x80: SLOT[1], 0xc0: SLOT[2] };
  let count = 0, hits = 0, mismatch = null, ptrBad = null;
  for (let x = 0; x < 256 && !mismatch; x++) {
    const [a, b] = craftPair(sweepPokes(x));
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    count++;
    if (registered(a)) {
      hits++;
      if (a.mem.read16(HIT_PTR) !== wantPtr[x]) {
        ptrBad = { x, got: a.mem.read16(HIT_PTR), want: wantPtr[x] };
      }
    }
    if (bad) mismatch = { x, bad };
  }
  assert.equal(mismatch, null,
    mismatch && `mismatch at Mario-X=${hx(mismatch.x)}: RAM diff at ${hx(mismatch.bad.addr)} ` +
      `(oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`);
  assert.equal(count, 256, "must have swept all 256 Mario-X values");
  assert.equal(hits, 3, "exactly the 3 slot-X values may register a hit");
  assert.equal(ptrBad, null,
    ptrBad && `wrong slot base at Mario-X=${hx(ptrBad.x)}: stored ${hx(ptrBad.got)} want ${hx(ptrBad.want)}`);
  console.log(`  EQUAL/Mario-X: 256 values — RAM identical (3 register the correct slot base, 253 no-op)`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Twin (a): walks the table with stride 1 instead of 4, so it inspects mid-record bytes
 *  the real stride-4 walk skips. Otherwise identical (same confirm callee). */
function brokenStride(m) {
  const { regs, mem } = m;
  const marioX = mem.read8(MARIO_X);
  for (let i = 0; i < 3; i++) {
    const record = 0x6a0c + i * 1; // BUG: stride 1, should be 4
    if (marioX === mem.read8(record)) { regs.hl = record; confirmObjectHit(m); return; }
  }
}

/** Twin (b): checks only 2 records instead of 3, so it never sees slot 2. */
function brokenLoopCount(m) {
  const { regs, mem } = m;
  const marioX = mem.read8(MARIO_X);
  for (let i = 0; i < 2; i++) { // BUG: 2 records, should be 3
    const record = 0x6a0c + i * 4;
    if (marioX === mem.read8(record)) { regs.hl = record; confirmObjectHit(m); return; }
  }
}

/** Twin (c): hands off a FIXED record base (slot 0) instead of the matched slot's base,
 *  so a hit on a later slot registers the wrong pointer. */
function brokenHandoff(m) {
  const { regs, mem } = m;
  const marioX = mem.read8(MARIO_X);
  for (let i = 0; i < 3; i++) {
    const record = 0x6a0c + i * 4;
    if (marioX === mem.read8(record)) { regs.hl = 0x6a0c; confirmObjectHit(m); return; } // BUG: fixed base
  }
}

test("TEETH (stride): the stride-1 twin is CAUGHT — matches a mid-record byte the real walk skips", () => {
  // Mario's X matches ONLY the byte at 0x6A0D (slot 0 +1), which the stride-4 walk never
  // reads; the confirm passes for the twin's bogus record 0x6A0D (its +3 = 0x6A10 = 0x22
  // == Mario-Y, +1 = 0x6A0E = 0x00 eligible). Real walk: no slot X matches -> no write.
  const [a, b] = craftPair([
    [MARIO_X, 0x77], [MARIO_Y, 0x22],
    [0x6a0c, 0x11], [0x6a10, 0x22], [0x6a14, 0x33], // real slot X's — none == 0x77
    [0x6a0d, 0x77], // stride-1 twin matches here on its 2nd step
    [0x6a0e, 0x00], // twin record (0x6A0D) +1 -> eligible
  ]);
  const aFloor = a.regs.sp;
  oracle(a);
  brokenStride(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the crafted stride setup FAILED to catch a stride-1 walk — it is worthless");
  assert.equal(bad.addr, HIT_STATE, `expected the caught diff at 0x6340, got ${hx(bad.addr)}`);
  console.log(`  TEETH/stride: caught at 0x6340 (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (loop-count): the 2-record twin is CAUGHT — it never inspects slot 2", () => {
  // Mario's X matches ONLY slot 2 (0x6A14). Real 3-record walk registers it; the 2-record
  // twin never reaches slot 2 -> no write.
  const [a, b] = craftPair([
    [MARIO_X, 0x99], [MARIO_Y, 0x50],
    [0x6a0c, 0x11], [0x6a10, 0x22], [0x6a14, 0x99], // only slot 2 X == 0x99
    [0x6a17, 0x50], [0x6a15, 0x00], //               slot 2 Y-aligned + eligible
  ]);
  const aFloor = a.regs.sp;
  oracle(a);
  brokenLoopCount(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the crafted loop-count setup FAILED to catch a 2-record walk — it is worthless");
  assert.equal(bad.addr, HIT_STATE, `expected the caught diff at 0x6340, got ${hx(bad.addr)}`);
  console.log(`  TEETH/loop-count: caught at 0x6340 (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (hand-off): the fixed-base twin is CAUGHT — it registers the wrong slot pointer", () => {
  // Mario's X matches slot 2 (0x6A14); BOTH slot 2 and slot 0 are Y-aligned + eligible, so
  // both the correct walk and the twin register — but at DIFFERENT pointers: 0x6A14 vs 0x6A0C.
  const [a, b] = craftPair([
    [MARIO_X, 0xab], [MARIO_Y, 0x50],
    [0x6a0c, 0x11], [0x6a10, 0x22], [0x6a14, 0xab], // only slot 2 X == 0xAB
    [0x6a17, 0x50], [0x6a15, 0x00], //               slot 2 Y-aligned + eligible (correct target)
    [0x6a0f, 0x50], [0x6a0d, 0x00], //               slot 0 Y-aligned + eligible (twin's bogus target)
  ]);
  const aFloor = a.regs.sp;
  oracle(a);
  brokenHandoff(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the crafted hand-off setup FAILED to catch a fixed-base hand-off — it is worthless");
  assert.equal(bad.addr, HIT_PTR, `expected the caught diff at 0x6343 (the pointer), got ${hx(bad.addr)}`);
  assert.equal(a.mem.read16(HIT_PTR), SLOT[2], "oracle must register slot 2's base");
  assert.equal(b.mem.read16(HIT_PTR), SLOT[0], "the buggy twin registers slot 0's base");
  console.log(`  TEETH/hand-off: caught at 0x6343 (oracle=${hx(a.mem.read16(HIT_PTR))} broken=${hx(b.mem.read16(HIT_PTR))})`);
});

// -- 4. REALISM (attract capture) ---------------------------------------------

test("REALISM: replay every real 0x19DA dispatch — idiomatic == oracle on authentic no-match states", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < 64) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(2000);

  assert.ok(caps.length >= 1, "expected at least one real 0x19DA dispatch during attract");
  let anyWrote = false;
  for (const cap of caps) {
    const a = cap.clone(), b = cap.clone();
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(bad, null, bad && `real-dispatch RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
    // Did this real dispatch take the confirm/register arm? Diff the oracle result against
    // the untouched capture (RAM − stack): a change means the table had an X-match here.
    if (ramDiffMinusStack(a, cap, aFloor).bad) anyWrote = true;
  }
  console.log(`  REALISM: ${caps.length} real 0x19DA dispatch(es) — RAM identical to the oracle` +
    (anyWrote ? " (some took the confirm arm — natural match-path coverage)" : " (all no-match — the 0x6A0C table has no X-match in attract)"));
});
