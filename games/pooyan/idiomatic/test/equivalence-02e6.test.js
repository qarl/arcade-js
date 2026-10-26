// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for seedTileFillCursor (ROM 0x02e6) — "arm the row-by-row tile
 * fill": store HL as the 16-bit TILE_FILL_PTR write cursor (0x880b, little-endian) and seed
 * FILL_ROW_COUNTER (0x8809) to 0x20.
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine
 * WRITES work RAM, so every case uses a FRESH clone per side. The oracle runs on one clone,
 * seedTileFillCursor on another, and they are compared on the go-forward contract:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP) + the A live-out.
 *
 * pc is deliberately NOT compared. HL (the pointer) is the only input. A GENUINE live-out is
 * A := 0x20, which the caller runSelfTestAndInitMachineState kicks the watchdog with (mem.write8(0xa000, A)) right
 * after the call — so the module's return is compared against the oracle clone's final A.
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — hook 0x02e6 in a real boot; any dispatch must agree in RAM + A.
 *   2. CRAFTED (load-bearing) — pre-dirty the three target cells to 0xAA and vary HL; both sides
 *      land the same pointer + counter and A == 0x20.
 *   3. WRITE-SET — the oracle's only writes are {0x8809, 0x880b, 0x880c}.
 *   4. TEETH — a twin that writes a WRONG pointer high byte MUST be caught at 0x880c, and a twin
 *      returning a WRONG A MUST be caught by the live-out check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-02e6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_02e6 as oracle } from "../../translated/loc_02e6.js";
import { seedTileFillCursor } from "../seedTileFillCursor.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, TILE_FILL_PTR, FILL_ROW_COUNTER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TARGET = 0x02e6;
const COUNTER = FILL_ROW_COUNTER;   // 0x8809
const PTR_LO = TILE_FILL_PTR;       // 0x880b
const PTR_HI = TILE_FILL_PTR + 1;   // 0x880c
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

/** First RAM difference on the go-forward contract: whole dump minus stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** Fresh clone with HL = ptr and the three target cells pre-dirtied to 0xAA. */
function craft(ptr) {
  const m = BASE.clone();
  m.mem.write8(COUNTER, 0xaa);
  m.mem.write8(PTR_LO, 0xaa);
  m.mem.write8(PTR_HI, 0xaa);
  m.regs.hl = ptr & 0xffff;
  m.regs.sp = 0x8ffe; // in STACK_SCRATCH; the oracle's ret only POPs (reads), never writes
  return m;
}

// The real entry pointer (0x8402, from armTileFillFromPlayfieldBase) plus edges/varied bytes.
const PTRS = [0x8402, 0x0000, 0xffff, 0x1234, 0x83c0];

// -- 1. CAPTURE (best-effort) -------------------------------------------------

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  return caps;
}

const CAPS = ROM_PRESENT ? captureDispatches(8, 1500) : [];

test("CAPTURE: real 0x02e6 dispatches — seedTileFillCursor == oracle in RAM (−stack) + A", () => {
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    const ret = seedTileFillCursor(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, o.regs.a, `A live-out: module ${hx(ret)} != oracle ${hx(o.regs.a)}`);
    assert.equal(c.regs.a, o.regs.a, `module must SET A (side effect) for the watchdog kick: c ${hx(c.regs.a)} != o ${hx(o.regs.a)}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: pre-dirtied cells + varied HL — RAM identical, pointer + counter stamped, A == 0x20", () => {
  for (const ptr of PTRS) {
    const o = craft(ptr);
    const c = craft(ptr);
    oracle(o);
    const ret = seedTileFillCursor(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `ptr ${hx(ptr)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, o.regs.a, `ptr ${hx(ptr)}: A live-out module ${hx(ret)} != oracle ${hx(o.regs.a)}`);
    assert.equal(c.regs.a, o.regs.a, `ptr ${hx(ptr)}: module must SET A (side effect): c ${hx(c.regs.a)} != o ${hx(o.regs.a)}`);

    assert.equal(c.mem.read8(PTR_LO), ptr & 0xff, `ptr ${hx(ptr)}: cursor low byte`);
    assert.equal(c.mem.read8(PTR_HI), (ptr >> 8) & 0xff, `ptr ${hx(ptr)}: cursor high byte`);
    assert.equal(c.mem.read8(COUNTER), 0x20, `ptr ${hx(ptr)}: counter seed`);
  }
  console.log(`  CRAFTED: ${PTRS.length} pointers stamped identically, A == 0x20`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle writes exactly {0x8809, 0x880b, 0x880c}", () => {
  const written = new Set([COUNTER, PTR_LO, PTR_HI]);
  for (const ptr of PTRS) {
    const before = craft(ptr);
    const after = before.clone();
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();

    const changed = new Set();
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] !== a1[off]) changed.add(after.stateOffsetToAddr(off));
    }
    for (const addr of changed) {
      assert.ok(written.has(addr), `ptr ${hx(ptr)}: oracle wrote unexpected addr ${hx(addr)}`);
    }
    // The counter always flips 0xAA -> 0x20; assert it landed (pointer bytes could equal 0xAA).
    assert.ok(changed.has(COUNTER), `ptr ${hx(ptr)}: counter ${hx(COUNTER)} should have changed`);
  }
  console.log("  WRITE-SET: every oracle write is within {0x8809, 0x880b, 0x880c}");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: corrupts the pointer HIGH byte — must be caught at 0x880c. */
function brokenSeed(m, ptr = m.regs.hl) {
  const ret = seedTileFillCursor(m, ptr);
  m.mem.write8(PTR_HI, (((ptr >> 8) & 0xff) ^ 0x01) & 0xff); // BUG: wrong high byte
  return ret;
}

test("TEETH: a wrong pointer high byte is CAUGHT at 0x880c", () => {
  let caught = null;
  for (const ptr of PTRS) {
    const o = craft(ptr);
    const c = craft(ptr);
    oracle(o);
    brokenSeed(c);
    const d = ramDiffMinusStack(o, c);
    if (d) { caught = d; break; }
  }
  assert.notEqual(caught, null, "the gate FAILED to catch a wrong pointer high byte — it is worthless");
  assert.equal(caught.addr, PTR_HI, `teeth caught the wrong address ${hx(caught.addr ?? 0)}`);
  console.log(`  TEETH: wrong high byte caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});

test("TEETH: a wrong A live-out is CAUGHT by the return check", () => {
  const ptr = PTRS[0];
  const o = craft(ptr);
  const c = craft(ptr);
  oracle(o);
  const brokenRet = (seedTileFillCursor(c) ^ 0x01) & 0xff; // module runs, its return perturbed
  assert.notEqual(brokenRet, o.regs.a, "the return check must reject an A that differs from the oracle's");
  console.log(`  TEETH: a perturbed return (${hx(brokenRet)}) differs from the oracle's ${hx(o.regs.a)}`);
});
