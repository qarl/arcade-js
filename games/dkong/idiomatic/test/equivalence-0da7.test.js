// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_0da7 (ROM 0x0DA7) — walk the board-layout segment table
 * and draw each segment.
 *
 * loc_0da7 WRITES memory (the segment scratch 0x63ab/0x63af/0x63b3/0x63b4 and, via
 * loc_0dd3 and its girder/ladder renderers, tiles across VRAM) and is NOT a leaf, so
 * it is gated by capture / clone / replay (docs/decompiler-pipeline) with a FRESH clone per case. Its
 * callees are idiomatic loc_0dd3 (already gated) and the frozen oracle loc_2ff0
 * (no idiomatic yet), called directly. Those model no stack on this path — the ONLY
 * stack traffic is loc_2ff0's `ret`, a read that drifts SP but writes nothing — so the
 * comparison is RAM minus the stack scratch below the entry SP (SP/pc are the dropped stack
 * model, not compared). The gate:
 *
 *   1. REALISM (real captured dispatches) — hook 0x0da7 during attract. Board setup
 *      dispatches it once per board (its record walk is internal — the `jp 0x0da7`
 *      loop-back is a return, not a re-dispatch), so one capture replays a WHOLE board
 *      draw and its many segment records. Run the ORACLE on one clone and idiomatic on
 *      another and confirm identical game-visible RAM (and, as a walk-integrity
 *      cross-check, identical final DE — not a live-out, since the walk is internal).
 *
 *   2. CRAFTED (synthetic tables) — on a real base, point DE at a hand-built record
 *      table in scratch RAM (identical on both sides). This pins both arms of the
 *      `sub b / jp nc / neg` absolute difference — a non-borrow record (y2 >= y) and a
 *      borrow record (y2 < y, which takes the neg) — plus the empty-table terminator
 *      and a kind-2 girder record, each compared to the oracle.
 *
 *   3. TEETH — two deliberately-broken twins MUST be caught by the RAM diff:
 *      (a) DROPPED-NEG — computes (y2 - y) & 0xff without the abs, so the borrow arm
 *          yields the wrong height. Caught at 0x63b1 (loc_0dd3 stores the height A there).
 *      (b) WIDE-MASK — writes y & 0x0f instead of y & 0x07 to the sub-tile phase.
 *          Caught at 0x63b4 whenever y has bit 3 set.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0da7.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0da7 as oracle } from "../../translated/loc_0da7.js";
import { drawBoardLayout as idiomatic } from "../drawBoardLayout.js";
import { loc_2ff0 } from "../../translated/loc_2ff0.js"; // oracle callee, for the teeth twins
import { loc_0dd3 } from "../loc_0dd3.js"; // idiomatic callee, for the teeth twins
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0da7;
const KIND = 0x63b3;
const ADDR1 = 0x63ab;
const PHASE_Y1 = 0x63b4;
const SUBTILE1 = 0x63af;
const CRAFT_AT = 0x6100; // scratch RAM the draw never writes — a safe home for synthetic tables

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- comparison plumbing ------------------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
function firstRamDiffOutsideStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState();
  const db = b.dumpState();
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
 * Run oracle and a candidate on two FRESH clones of `entry` (a memory-writing routine
 * demands a fresh clone per side) and return the game-visible RAM diff plus each side's
 * final DE (a walk-integrity cross-check — the table cursor both sides step identically).
 */
function replay(entry, cand) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  cand(b);
  return {
    ram: firstRamDiffOutsideStack(a, b, entry.regs.sp),
    deOracle: a.regs.de & 0xffff,
    deCand: b.regs.de & 0xffff,
  };
}

/**
 * Hook 0x0da7 in a real attract run and clone the machine at up to K real dispatches.
 * Board setup's `call 0x0da7` resolves to this wrapper, which clones the entry state
 * then runs the ORACLE so the host game proceeds to a clean stop. 0x0da7 fires once per
 * board (the record walk is internal), so even a handful of frames past board setup
 * captures a full board draw.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}

let CACHED_CAPS = null;
function realCaptures() {
  if (!CACHED_CAPS) CACHED_CAPS = captureDispatches(16, 2500);
  return CACHED_CAPS;
}

/** Clone a real base and point DE at a hand-built record table written into scratch RAM. */
function craftTable(base, bytes) {
  const seed = base.clone();
  for (let i = 0; i < bytes.length; i++) seed.mem.write8(CRAFT_AT + i, bytes[i]);
  seed.regs.de = CRAFT_AT;
  return seed;
}

// -- 1. REALISM (captured dispatches) -----------------------------------------

test("REALISM: real captured 0x0da7 board draws — game-visible RAM + DE match the oracle", () => {
  const caps = realCaptures();
  assert.ok(caps.length >= 1, "expected at least one real 0x0da7 dispatch during attract");

  for (const entry of caps) {
    // Both sides confine ALL stack traffic to STACK_SCRATCH (the oracle's push/pop; the
    // idiomatic side writes no stack at all), so excluding that region cannot mask a
    // game-visible divergence. Margin covers the oracle's deepest per-record push.
    assert.ok(
      (entry.regs.sp - 8) >= STACK_SCRATCH.lo && entry.regs.sp <= STACK_SCRATCH.hi,
      `entry SP must sit inside STACK_SCRATCH with margin (SP=${hx(entry.regs.sp)})`,
    );

    const { ram, deOracle, deCand } = replay(entry, idiomatic);
    assert.equal(
      ram,
      null,
      ram && `game-visible RAM diff at ${hx(ram.addr)} (oracle=${ram.a} idiomatic=${ram.b}) DE=${hx(entry.regs.de)}`,
    );
    assert.equal(deCand, deOracle, `final DE mismatch: oracle=${hx(deOracle)} idiomatic=${hx(deCand)}`);
  }
  console.log(`  REALISM: ${caps.length} real 0x0da7 board draw(s) — full-board RAM (ex-stack) + DE identical`);
});

// -- 2. CRAFTED (synthetic tables) --------------------------------------------

test("CRAFTED: synthetic tables pin both abs-diff arms + empty + girder — RAM + DE match", () => {
  const base = realCaptures()[0];
  const cases = {
    "non-borrow (y2>=y)": [0x00, 0x50, 0x48, 0x70, 0x60, 0xaa], // y=0x50 y2=0x70 -> A=0x20, jp nc
    "borrow (y2<y, neg)": [0x00, 0x70, 0x48, 0x50, 0x60, 0xaa], // y=0x70 y2=0x50 -> A=0x20 via neg
    "empty (terminator)": [0xaa],
    "girder (kind 2)": [0x02, 0x50, 0x48, 0x80, 0x48, 0xaa],
  };
  let n = 0;
  for (const [name, bytes] of Object.entries(cases)) {
    const { ram, deOracle, deCand } = replay(craftTable(base, bytes), idiomatic);
    assert.equal(ram, null, ram && `${name}: RAM diff at ${hx(ram.addr)} (oracle=${ram.a} idiomatic=${ram.b})`);
    assert.equal(deCand, deOracle, `${name}: DE mismatch oracle=${hx(deOracle)} idiomatic=${hx(deCand)}`);
    n++;
  }
  console.log(`  CRAFTED: ${n} synthetic tables (both abs-diff arms + empty + girder) — RAM (ex-stack) + DE identical`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Twin (a): drops the neg on the borrow arm — the height A is (y2 - y) & 0xff, not |y2 - y|. */
function brokenDroppedNeg(m) {
  const { regs, mem } = m;
  const spBase = regs.sp;
  for (;;) {
    regs.sp = spBase;
    const kind = mem.read8(regs.de);
    mem.write8(KIND, kind);
    if (kind === 0xaa) return;
    regs.de = (regs.de + 1) & 0xffff;
    const y = mem.read8(regs.de);
    regs.h = y;
    regs.b = y;
    regs.de = (regs.de + 1) & 0xffff;
    const x = mem.read8(regs.de);
    regs.l = x;
    regs.c = x;
    const savedDe = regs.de;
    loc_2ff0(m);
    regs.de = savedDe;
    mem.write16(ADDR1, regs.hl);
    mem.write8(PHASE_Y1, y & 0x07);
    mem.write8(SUBTILE1, x & 0x07);
    regs.de = (regs.de + 1) & 0xffff;
    const y2 = mem.read8(regs.de);
    regs.h = y2;
    regs.a = (y2 - y) & 0xff; // BUG: no abs — the neg on borrow is dropped
    loc_0dd3(m);
  }
}

/** Twin (b): widens the sub-tile phase mask to 0x0f — differs from 0x07 when y bit 3 is set. */
function brokenWideMask(m) {
  const { regs, mem } = m;
  const spBase = regs.sp;
  for (;;) {
    regs.sp = spBase;
    const kind = mem.read8(regs.de);
    mem.write8(KIND, kind);
    if (kind === 0xaa) return;
    regs.de = (regs.de + 1) & 0xffff;
    const y = mem.read8(regs.de);
    regs.h = y;
    regs.b = y;
    regs.de = (regs.de + 1) & 0xffff;
    const x = mem.read8(regs.de);
    regs.l = x;
    regs.c = x;
    const savedDe = regs.de;
    loc_2ff0(m);
    regs.de = savedDe;
    mem.write16(ADDR1, regs.hl);
    mem.write8(PHASE_Y1, y & 0x0f); // BUG: should be & 0x07
    mem.write8(SUBTILE1, x & 0x07);
    regs.de = (regs.de + 1) & 0xffff;
    const y2 = mem.read8(regs.de);
    regs.h = y2;
    regs.a = Math.abs(y2 - y) & 0xff;
    loc_0dd3(m);
  }
}

test("TEETH (dropped-neg): the missing abs on the borrow arm is CAUGHT by the RAM diff", () => {
  const base = realCaptures()[0];
  const borrow = [0x00, 0x70, 0x48, 0x50, 0x60, 0xaa]; // y2 < y -> the neg matters
  const { ram } = replay(craftTable(base, borrow), brokenDroppedNeg);
  assert.notEqual(ram, null, "the RAM gate FAILED to catch a dropped abs-difference — it is worthless");
  assert.equal(ram.addr, 0x63b1, `expected the height byte 0x63b1 to differ, got ${hx(ram.addr)}`);
  console.log(`  TEETH/dropped-neg: caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

test("TEETH (wide-mask): the 0x0f sub-tile phase mask is CAUGHT by the RAM diff", () => {
  const base = realCaptures()[0];
  const bit3 = [0x00, 0x58, 0x48, 0x70, 0x60, 0xaa]; // y=0x58: y&0xf=8, y&7=0 -> the mask matters
  const { ram } = replay(craftTable(base, bit3), brokenWideMask);
  assert.notEqual(ram, null, "the RAM gate FAILED to catch a widened sub-tile mask — it is worthless");
  assert.equal(ram.addr, PHASE_Y1, `expected the sub-tile phase 0x63b4 to differ, got ${hx(ram.addr)}`);
  console.log(`  TEETH/wide-mask: caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});
