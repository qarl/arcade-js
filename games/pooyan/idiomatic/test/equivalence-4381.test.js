// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for paintDisplayListRunToVram (ROM 0x4381) — the display-list interpreter. On entry it
 * picks a dest/src pointer pair: the primary pair (0x8f43)/(0x8f45) when (0x8920)==0, else the
 * alternate pair (0x88b8)/(0x88ba). It then walks up to 0x1d source bytes: a plain byte copies
 * src->dest; a 0x10 opcode advances dest by the next byte and shrinks the remaining count; a 0xff
 * opcode reloads dest from the stream and adds the next byte to the sub-phase tick (0x88b7). On exit
 * the advanced pointers are stored back to whichever pair was chosen. Fully self-contained (no calls).
 *
 * This is the cycle-free / memory-equivalence gate. The routine WRITES video RAM + pointer cells, so
 * every case uses a FRESH clone per side. Contract: RAM (dumpState, minus stack scratch below the entry SP). paintDisplayListRunToVram
 * takes no register inputs and leaves nothing live in a register for a reader (all results go to
 * memory), so pc/SP/cycles/registers are NOT compared. All inputs live in memory, so cases are
 * CRAFTED: identical pointer cells + source streams poked on both sides.
 *
 * Jobs:
 *   1. EQUAL — over crafted streams (literal / reload / skip / alternate pair) paintDisplayListRunToVram == oracle.
 *   2. WRITE-SET — the literal case changes only the copied cells + the advanced primary pointer.
 *   3. CRAFTED — the reload opcode's tick bump + pointer reload matches (an arm a plain copy misses).
 *   4. TEETH — a wrong copied byte AND a wrong stored pointer MUST each be caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-4381.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_4381 as oracle } from "../../translated/loc_4381.js";
import { paintDisplayListRunToVram } from "../paintDisplayListRunToVram.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// Pointer cells and work areas.
const SEL = 0x8920; // pair selector
const P_DST = 0x8f43, P_SRC = 0x8f45; // primary pair
const A_DST = 0x88b8, A_SRC = 0x88ba; // alternate pair
const TICK = 0x88b7; // sub-phase tick, bumped by the reload opcode
const DST = 0x8500, SRC = 0x8b00; // primary work regions
const ADST = 0x8600, ASRC = 0x8b40; // alternate work regions
const FILL = 0xee; // pre-clear sentinel so each literal copy is a visible change
const LIT = 0x42; // a literal that is neither 0x10 nor 0xff

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function poke16(m, addr, val) {
  m.mem.write8(addr, val & 0xff);
  m.mem.write8((addr + 1) & 0xffff, (val >> 8) & 0xff);
}
function seat(m, addr, bytes) {
  bytes.forEach((b, i) => m.mem.write8((addr + i) & 0xffff, b & 0xff));
}
function fresh() {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe; // the two ret exits pop here; excluded as stack scratch
  return m;
}

const SCENARIOS = {
  "primary literal": (m) => {
    m.mem.write8(SEL, 0x00);
    poke16(m, P_DST, DST);
    poke16(m, P_SRC, SRC);
    for (let i = 0; i < 0x1d; i++) m.mem.write8(DST + i, FILL);
    seat(m, SRC, new Array(0x1d).fill(LIT));
  },
  "primary reload": (m) => {
    m.mem.write8(SEL, 0x00);
    poke16(m, P_DST, DST);
    poke16(m, P_SRC, SRC);
    seat(m, SRC, [0xff, 0x60, 0x85, 0x07]); // reload dest=0x8560, tick += 7
  },
  "primary skip": (m) => {
    m.mem.write8(SEL, 0x00);
    poke16(m, P_DST, DST);
    poke16(m, P_SRC, SRC);
    seat(m, SRC, [0x10, 0x05]); // advance dest by 5, then literals
    for (let i = 0; i < 0x1d; i++) m.mem.write8(SRC + 2 + i, LIT);
    for (let i = 0; i < 0x40; i++) m.mem.write8(DST + i, FILL);
  },
  "alternate literal": (m) => {
    m.mem.write8(SEL, 0x01);
    poke16(m, A_DST, ADST);
    poke16(m, A_SRC, ASRC);
    for (let i = 0; i < 0x1d; i++) m.mem.write8(ADST + i, FILL);
    seat(m, ASRC, new Array(0x1d).fill(LIT));
  },
};

// -- 1. EQUAL ----------------------------------------------------------------

test("EQUAL: paintDisplayListRunToVram == oracle in RAM (−stack) over crafted streams", () => {
  for (const [name, setup] of Object.entries(SCENARIOS)) {
    const o = fresh();
    const c = fresh();
    setup(o);
    setup(c);
    oracle(o);
    paintDisplayListRunToVram(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)} for "${name}": oracle=${d.a} idiomatic=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(SCENARIOS).length} crafted streams identical (RAM −stack)`);
});

// -- 2. WRITE-SET ------------------------------------------------------------

test("WRITE-SET: the literal case writes only the copied cells + the advanced primary pointer", () => {
  const before = fresh();
  const after = fresh();
  SCENARIOS["primary literal"](before);
  SCENARIOS["primary literal"](after);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const allowed = new Set();
  for (let i = 0; i < 0x1d; i++) allowed.add((DST + i) & 0xffff);
  for (const a of [P_DST, P_DST + 1, P_SRC, P_SRC + 1]) allowed.add(a & 0xffff);

  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue;
    assert.ok(allowed.has(addr), `unexpected write at ${hx(addr)} (=${a1[off]})`);
  }
  for (let i = 0; i < 0x1d; i++) {
    assert.equal(after.mem.read8(DST + i), LIT, `copied cell ${hx(DST + i)} must be ${hx(LIT)}`);
  }
  // dest advanced 0x1d copies + the tail 3-step; src advanced 0x1d.
  assert.equal(after.mem.read8(P_DST) | (after.mem.read8(P_DST + 1) << 8), (DST + 0x1d + 3) & 0xffff, "stored dest pointer");
  assert.equal(after.mem.read8(P_SRC) | (after.mem.read8(P_SRC + 1) << 8), (SRC + 0x1d) & 0xffff, "stored src pointer");
  assert.equal(after.mem.read8(TICK), before.mem.read8(TICK), "literal path must NOT touch the tick");
  console.log("  WRITE-SET: 0x1d copied cells + advanced primary pointer; tick untouched");
});

// -- 3. CRAFTED (reload opcode) ----------------------------------------------

test("CRAFTED: the reload opcode bumps the tick and reloads the pointer identically", () => {
  const o = fresh();
  const c = fresh();
  SCENARIOS["primary reload"](o);
  SCENARIOS["primary reload"](c);
  const tick0 = o.mem.read8(TICK);
  oracle(o);
  paintDisplayListRunToVram(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
  assert.equal(c.mem.read8(TICK), (tick0 + 0x07) & 0xff, "tick bumped by the reload byte");
  assert.equal(c.mem.read8(P_DST) | (c.mem.read8(P_DST + 1) << 8), 0x8560, "dest reloaded from the stream");
  assert.equal(c.mem.read8(P_SRC) | (c.mem.read8(P_SRC + 1) << 8), (SRC + 4) & 0xffff, "src advanced past the 4-byte opcode");
  console.log("  CRAFTED: reload bumped the tick + reloaded the dest pointer, matching the oracle");
});

// -- 4. TEETH ----------------------------------------------------------------

test("TEETH: a wrong copied byte is CAUGHT by the RAM diff", () => {
  const o = fresh();
  const c = fresh();
  SCENARIOS["primary literal"](o);
  SCENARIOS["primary literal"](c);
  oracle(o);
  paintDisplayListRunToVram(c);
  const victim = DST + 0x0a;
  c.mem.write8(victim, 0x00); // BUG: this cell must be the literal 0x42

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong copied byte — it is worthless");
  assert.equal(d.addr, victim, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(victim)})`);
  console.log(`  TEETH/copy: wrong copied byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong stored pointer is CAUGHT by the RAM diff", () => {
  const o = fresh();
  const c = fresh();
  SCENARIOS["primary literal"](o);
  SCENARIOS["primary literal"](c);
  oracle(o);
  paintDisplayListRunToVram(c);
  c.mem.write8(P_DST, (c.mem.read8(P_DST) + 1) & 0xff); // BUG: dest pointer off by one

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong stored pointer");
  assert.equal(d.addr, P_DST, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(P_DST)})`);
  console.log(`  TEETH/ptr: wrong stored pointer caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
