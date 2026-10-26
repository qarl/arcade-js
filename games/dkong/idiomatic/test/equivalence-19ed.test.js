// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for confirmObjectHit (ROM 0x19ED) — the confirm half of sub_19da's
 * object-slot scan.
 *
 * confirmObjectHit WRITES memory (registers a hit into the object-interaction flag trio
 * 0x6343 / 0x6342 / 0x6340) and takes HL as LIVE-IN (the X-matched object record), so it
 * is gated by capture / clone / replay (docs/decompiler-pipeline) with a FRESH clone per case. Its logic is
 * two guards over the record HL points at — Mario's Y (0x6205) must equal the record's Y
 * byte (+3), and bit 3 of the record's flag byte (+1) must be CLEAR — and, only when both
 * pass, the three flag writes.
 *
 * A 6000-frame attract run dispatches 0x19ED ZERO times: sub_19da (the upstream X-search)
 * runs ~1532x, but the 0x6A0C object table is empty in attract (all-zero), so Mario's X
 * never matches and the `jp z` into 0x19ED never fires. So — exactly as docs/decompiler-pipeline prescribes
 * for arms attract never reaches — the gate is CRAFTED: a real booted attract machine,
 * cloned, with the record pointer + the deciding bytes surgically poked, then
 * oracle-vs-idiomatic on independent fresh clones. Because the deciding inputs are single
 * bytes, the crafted sweeps are EXHAUSTIVE, which is stronger than any one captured dispatch:
 *
 *   1. STRUCTURE — on a crafted "register" entry (Y matched, eligible) confirm game-visible
 *      RAM is identical, the oracle wrote the trio (0x6340=1, 0x6342=0, 0x6343=record), the
 *      oracle's `ret` pops only from dead STACK_SCRATCH, and the idiomatic side models
 *      neither SP nor pc.
 *
 *   2. Y-GATE (exhaustive) — fix an eligible record, sweep Mario's Y over all 256 values.
 *      Pins the gate: exactly ONE value (the record's Y) registers the hit; the other 255
 *      touch nothing. Both arms asserted.
 *
 *   3. ELIGIBILITY-GATE (exhaustive) — with Y matched, sweep the record's flag byte over all
 *      256 values. Pins the gate: the 128 bit-3-CLEAR values register; the 128 bit-3-SET
 *      values touch nothing. Both arms asserted.
 *
 *   4. L-WRAP (edge set) — register a hit for records whose base L is near 0xFF, so the +1 /
 *      +3 offsets wrap the low byte within the 0x6Axx page. Confirms the idiomatic `& 0xff`
 *      offset walk matches the oracle's `inc l` (H-fixed) at every wrap edge, and that the
 *      stored pointer is the wrapped base.
 *
 *   5. TEETH — two twins the sweeps MUST catch: (a) a wrong-eligibility-bit twin (tests bit 2
 *      instead of bit 3) caught by the ELIGIBILITY sweep, naming 0x6340; (b) a 16-bit
 *      HL-walk twin (reads the +3 offset without the low-byte wrap) caught at a wrap record,
 *      naming 0x6340 — the faithfulness check the L-WRAP arm exists for.
 *
 *   6. REALISM — hook 0x19ED over a long attract run; replay any real dispatch if one occurs,
 *      else record that attract never reaches it (why crafted is the gate).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-19ed.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_19ed as oracle } from "../../translated/loc_19ed.js";
import { confirmObjectHit as idiomatic } from "../confirmObjectHit.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, MARIO_Y } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x19ed;
const SP_CRAFT = 0x6bf8; // inside STACK_SCRATCH, headroom for the oracle's ret pop
const HIT_STATE = 0x6340; //  := 1 on a registered hit
const HIT_SUB = 0x6342; //    := 0 on a registered hit
const HIT_PTR = 0x6343; //    := record pointer (word) on a registered hit
const SLOT = 0x6a0c; //       default record base (no low-byte wrap)
const SENTINEL = 0x99; //     a value none of the trio takes on a real hit, so any wrongful
//                            write is visible (HIT_STATE=1, HIT_SUB=0, HIT_PTR=0x6a??)

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inStack = (a) => a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const recAddr = (slot, off) => (slot & 0xff00) | ((slot + off) & 0xff);

/**
 * First game-visible differing RAM byte between two machines, EXCLUDING the dead
 * stack-scratch region (the memory-equivalence contract is RAM − the stack scratch below the entry SP).
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
// entry (cloned per case, never mutated). Genuine work RAM; only the record pointer and
// the deciding bytes move — the "real state + surgical nudge" the crafted method wants.
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
 * Two independent fresh clones of the base, identically poked (docs/decompiler-pipeline fresh clone per
 * case — this routine writes RAM). `record` = HL live-in; Mario's Y := playerY; the
 * record's Y (+3) := recY; the record's flag byte (+1) := flags. The trio is pre-set to
 * SENTINEL so any wrongful write shows. Returns [oracleClone, candidateClone].
 */
function craftPair(record, playerY, recY, flags) {
  const a = base().clone(), b = base().clone();
  for (const m of [a, b]) {
    m.regs.hl = record;
    m.regs.sp = SP_CRAFT;
    m.mem.write8(MARIO_Y, playerY);
    m.mem.write8(recAddr(record, 3), recY);
    m.mem.write8(recAddr(record, 1), flags);
    m.mem.write8(HIT_STATE, SENTINEL);
    m.mem.write8(HIT_SUB, SENTINEL);
    m.mem.write8(HIT_PTR, SENTINEL);
    m.mem.write8(HIT_PTR + 1, SENTINEL);
  }
  return [a, b];
}

const registered = (m) => m.mem.read8(HIT_STATE) !== SENTINEL; // trio written iff hit fired

// -- 1. STRUCTURE -------------------------------------------------------------

test("STRUCTURE: crafted register entry — trio written, game-visible RAM identical, SP/pc unmodelled", () => {
  const [a, b] = craftPair(SLOT, 0x50, 0x50, 0x00); // Y matches, bit 3 clear -> register
  const aFloor = a.regs.sp;
  oracle(a);
  idiomatic(b);

  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.equal(bad, null, bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);

  // The oracle must have registered the hit into the trio.
  assert.equal(a.mem.read8(HIT_STATE), 0x01, "oracle must set 0x6340 := 1 (hit registered)");
  assert.equal(a.mem.read8(HIT_SUB), 0x00, "oracle must set 0x6342 := 0");
  assert.equal(a.mem.read16(HIT_PTR), SLOT, "oracle must store the record base pointer at 0x6343");

  // The oracle's `ret` pops [SP, SP+1]; both must sit in STACK_SCRATCH, so excluding the
  // stack region in the diff cannot hide a real difference (the routine pushes nothing).
  assert.ok(inStack(SP_CRAFT) && inStack((SP_CRAFT + 1) & 0xffff),
    `oracle ret pop target must sit inside STACK_SCRATCH (SP=${hx(SP_CRAFT)})`);

  // idiomatic must model neither the stack nor the return: SP and pc unchanged from entry.
  const c = base().clone();
  c.regs.hl = SLOT; c.regs.sp = SP_CRAFT;
  c.mem.write8(MARIO_Y, 0x50); c.mem.write8(recAddr(SLOT, 3), 0x50); c.mem.write8(recAddr(SLOT, 1), 0x00);
  const sp0 = c.regs.sp, pc0 = c.pc;
  idiomatic(c);
  assert.equal(c.regs.sp, sp0, "confirmObjectHit must leave SP unchanged (no stack modelling)");
  assert.equal(c.pc, pc0, "confirmObjectHit must leave pc unchanged (no ret modelling)");
  console.log("  STRUCTURE: trio written; game-visible-identical; idiomatic touches no SP/pc; ret pops dead stack");
});

// -- 2. Y-GATE (exhaustive) ---------------------------------------------------

test("Y-GATE (exhaustive): confirmObjectHit == oracle over all 256 Mario-Y values (eligible record)", () => {
  const recY = 0x50;
  let count = 0, hits = 0, mismatch = null;
  for (let y = 0; y < 256 && !mismatch; y++) {
    const [a, b] = craftPair(SLOT, y, recY, 0x00); // flag byte eligible (bit 3 clear)
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    count++;
    if (registered(a)) hits++;
    if (bad) mismatch = { y, bad };
  }
  assert.equal(mismatch, null,
    mismatch && `mismatch at Mario-Y=${hx(mismatch.y)}: RAM diff at ${hx(mismatch.bad.addr)} ` +
      `(oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`);
  assert.equal(count, 256, "must have swept all 256 Mario-Y values");
  assert.equal(hits, 1, "exactly one Mario-Y (== the record's Y) may register the hit");
  console.log(`  Y-GATE/exhaustive: 256 values — game-visible RAM identical (1 registers, 255 no-op)`);
});

// -- 3. ELIGIBILITY-GATE (exhaustive) -----------------------------------------

test("ELIGIBILITY-GATE (exhaustive): confirmObjectHit == oracle over all 256 flag bytes (Y matched)", () => {
  let count = 0, hits = 0, mismatch = null;
  for (let flags = 0; flags < 256 && !mismatch; flags++) {
    const [a, b] = craftPair(SLOT, 0x50, 0x50, flags); // Y matched; sweep eligibility flag byte
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    count++;
    if (registered(a)) hits++;
    if (bad) mismatch = { flags, bad };
  }
  assert.equal(mismatch, null,
    mismatch && `mismatch at flags=${hx(mismatch.flags)}: RAM diff at ${hx(mismatch.bad.addr)} ` +
      `(oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`);
  assert.equal(count, 256, "must have swept all 256 flag bytes");
  assert.equal(hits, 128, "exactly the 128 bit-3-CLEAR flag bytes may register the hit");
  console.log(`  ELIGIBILITY-GATE/exhaustive: 256 values — game-visible RAM identical (128 eligible register, 128 consumed no-op)`);
});

// -- 4. L-WRAP (edge set) -----------------------------------------------------

test("L-WRAP: confirmObjectHit == oracle for records whose +1/+3 offsets wrap the low byte", () => {
  // Base L values chosen so (+1) and/or (+3) cross the 0x100 boundary; H = 0x6A fixed.
  const RECORDS = [0x6a0c, 0x6afc, 0x6afd, 0x6afe, 0x6aff, 0x6a00, 0x6a01];
  for (const record of RECORDS) {
    const [a, b] = craftPair(record, 0x50, 0x50, 0x00); // Y matched, eligible -> register
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(bad, null,
      bad && `record ${hx(record)}: RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
    assert.equal(a.mem.read8(HIT_STATE), 0x01, `record ${hx(record)}: oracle must register the hit`);
    assert.equal(a.mem.read16(HIT_PTR), record, `record ${hx(record)}: stored pointer must be the wrapped base`);
  }
  console.log(`  L-WRAP: ${RECORDS.length} wrap-edge records — game-visible RAM identical; H-fixed low-byte walk confirmed`);
});

// -- 5. TEETH -----------------------------------------------------------------

/** Twin (a): reads bit 2 (mask 0x04) of the flag byte instead of bit 3 (0x08) for the
 *  eligibility gate — a plausible off-by-one-bit bug. Diverges from the oracle on flag
 *  bytes where bits 2 and 3 differ, so only a real sweep catches it. */
function brokenWrongBit(m) {
  const { regs, mem } = m;
  const record = regs.hl;
  const page = record & 0xff00, b = record & 0xff;
  const rb = (off) => mem.read8(page | ((b + off) & 0xff));
  if (mem.read8(MARIO_Y) !== rb(3)) return;
  if (rb(1) & 0x04) return; // BUG: 0x04 should be 0x08
  mem.write16(0x6343, record);
  mem.write8(0x6342, 0x00);
  mem.write8(0x6340, 0x01);
}

/** Twin (b): walks the record offsets with a 16-bit HL add (no low-byte `& 0xff` wrap),
 *  so at a wrap record it reads the NEXT page for +3 instead of wrapping within 0x6Axx —
 *  the exact faithfulness bug the L-WRAP arm guards against. */
function broken16bitWalk(m) {
  const { regs, mem } = m;
  const record = regs.hl;
  if (mem.read8(MARIO_Y) !== mem.read8((record + 3) & 0xffff)) return; // BUG: no low-byte wrap
  if (mem.read8((record + 1) & 0xffff) & 0x08) return;
  mem.write16(0x6343, record);
  mem.write8(0x6342, 0x00);
  mem.write8(0x6340, 0x01);
}

test("TEETH (wrong-bit): the bit-2 eligibility twin is CAUGHT by the ELIGIBILITY sweep, names 0x6340", () => {
  let caught = null;
  for (let flags = 0; flags < 256 && !caught; flags++) {
    const [a, b] = craftPair(SLOT, 0x50, 0x50, flags);
    const aFloor = a.regs.sp;
    oracle(a);
    brokenWrongBit(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    if (bad) caught = { flags, bad };
  }
  assert.notEqual(caught, null, "the ELIGIBILITY sweep FAILED to catch a wrong eligibility bit — it is worthless");
  assert.equal(caught.bad.addr, HIT_STATE, `expected the caught diff at 0x6340, got ${hx(caught.bad.addr)}`);
  console.log(`  TEETH/wrong-bit: caught at flags=${hx(caught.flags)} (0x6340 oracle=${caught.bad.a} broken=${caught.bad.b})`);
});

test("TEETH (16-bit-walk): the no-wrap HL twin is CAUGHT at a wrap record, names 0x6340", () => {
  const record = 0x6afe; // (+3) wraps to 0x6a01; a 16-bit walk wrongly reads 0x6b01
  const wrongAddr = (record + 3) & 0xffff; // 0x6b01 — the byte the buggy walk reads
  const a = base().clone(), b = base().clone();
  const aFloor = SP_CRAFT;
  for (const m of [a, b]) {
    m.regs.hl = record;
    m.regs.sp = SP_CRAFT;
    m.mem.write8(MARIO_Y, 0x50);
    m.mem.write8(recAddr(record, 3), 0x50); // correct wrapped +3 (0x6a01) MATCHES Mario-Y
    m.mem.write8(recAddr(record, 1), 0x00); // eligible
    m.mem.write8(wrongAddr, 0x00); // the next-page byte the buggy walk reads MISMATCHES (0x00 != 0x50)
    m.mem.write8(HIT_STATE, SENTINEL);
    m.mem.write8(HIT_SUB, SENTINEL);
    m.mem.write8(HIT_PTR, SENTINEL);
    m.mem.write8(HIT_PTR + 1, SENTINEL);
  }
  oracle(a); //          reads wrapped 0x6a01 (0x50) -> match + eligible -> registers
  broken16bitWalk(b); // reads 0x6b01 (0x00) -> Y mismatch -> no-op
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the L-WRAP setup FAILED to catch a 16-bit (non-wrapping) offset walk — it is worthless");
  assert.equal(bad.addr, HIT_STATE, `expected the caught diff at 0x6340, got ${hx(bad.addr)}`);
  console.log(`  TEETH/16-bit-walk: caught at record ${hx(record)} (0x6340 oracle=${bad.a} broken=${bad.b})`);
});

// -- 6. REALISM (attract capture, if any) -------------------------------------

test("REALISM: replay any real 0x19ED dispatch; else record that attract never reaches it", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < 16) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(6000);

  for (const entry of caps) {
    const a = entry.clone(), b = entry.clone();
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(bad, null, bad && `real-dispatch RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
  }
  if (caps.length === 0) {
    console.log("  REALISM: 0 real 0x19ED dispatches in 6000 attract frames — the 0x6A0C table is empty in attract, so no X-match reaches it; crafted sweeps are the gate");
  } else {
    console.log(`  REALISM: ${caps.length} real 0x19ED dispatch(es) — game-visible RAM identical to the oracle`);
  }
});
