// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for armTileFillFromPlayfieldBase (Pooyan ROM 0x02e3) — the "reset fill pointer to 0x8402"
 * variant of arming the row-by-row tile fill. It seeds the fixed VRAM start into the 16-bit fill
 * cursor (TILE_FILL_PTR, little-endian) and the row counter (FILL_ROW_COUNTER) to 0x20, delegating
 * to the shared arming routine.
 *
 * Cycle-free / memory-equivalence gate. Compared on RAM (dumpState) MINUS stack scratch below the entry SP, PLUS the A
 * live-out. pc/SP/cycles are NOT compared. A := 0x20 (the row count) is a genuine live-out — the
 * arming routine leaves it for the caller's watchdog kick — so the module's return is checked against
 * the oracle's A, and the module must also SET A on its own clone. HL (the oracle leaves it at 0x8402)
 * is NOT part of the contract: it is re-established by the fill loop, not consumed downstream.
 *
 * The routine takes no input register (the start is fixed), so every case is CRAFTED; a best-effort
 * CAPTURE replays any real dispatch a boot happens to reach.
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — real dispatches agree in RAM + A.
 *   2. CRAFTED — pre-dirtied target cells: identical RAM, cursor = 0x8402, counter = 0x20, A = 0x20.
 *   3. WRITE-SET — the only writes are the two cursor bytes and the counter cell.
 *   4. TEETH — a wrong cursor high byte and a wrong A live-out are both caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-02e3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_02e3 as oracle } from "../../translated/loc_02e3.js";
import { armTileFillFromPlayfieldBase } from "../armTileFillFromPlayfieldBase.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, TILE_FILL_PTR, FILL_ROW_COUNTER, PLAYFIELD_TILE_BASE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TARGET = 0x02e3;
const COUNTER = FILL_ROW_COUNTER; // 0x8809
const PTR_LO = TILE_FILL_PTR; //     0x880b
const PTR_HI = TILE_FILL_PTR + 1; // 0x880c
const ROW_COUNT = 0x20;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), dead);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** Fresh clone with the three target cells pre-dirtied to 0xAA (HL is irrelevant — start is fixed). */
function craft() {
  const m = BASE.clone();
  m.mem.write8(COUNTER, 0xaa);
  m.mem.write8(PTR_LO, 0xaa);
  m.mem.write8(PTR_HI, 0xaa);
  m.regs.sp = 0x8ffe; // in STACK_SCRATCH; the ret only POPs (reads)
  return m;
}

// -- 1. CAPTURE (best-effort) -------------------------------------------------

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  try {
    const host = new Machine(ROM, { overrides: snap });
    host.runFrames(maxFrames);
  } catch {
    /* keep whatever we captured */
  }
  return caps;
}

test("CAPTURE: real 0x02e3 dispatches — armTileFillFromPlayfieldBase == oracle in RAM (−stack) + A", () => {
  const caps = ROM_PRESENT ? captureDispatches(8, 1500) : [];
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    const ret = armTileFillFromPlayfieldBase(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, o.regs.a, `A live-out module ${hx(ret)} != oracle ${hx(o.regs.a)}`);
    assert.equal(c.regs.a, o.regs.a, "module must SET A on its own clone");
  }
  console.log(`  CAPTURE: ${caps.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED ---------------------------------------------------------------

test("CRAFTED: pre-dirtied cells — identical RAM, cursor 0x8402, counter + A = 0x20", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  const ret = armTileFillFromPlayfieldBase(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assert.equal(ret, o.regs.a, `A live-out module ${hx(ret)} != oracle ${hx(o.regs.a)}`);
  assert.equal(ret, ROW_COUNT, "A must be the row count 0x20");
  assert.equal(c.regs.a, o.regs.a, "module must SET A on its own clone");
  assert.equal(c.mem.read8(PTR_LO), PLAYFIELD_TILE_BASE & 0xff, "cursor low byte");
  assert.equal(c.mem.read8(PTR_HI), (PLAYFIELD_TILE_BASE >> 8) & 0xff, "cursor high byte");
  assert.equal(c.mem.read8(COUNTER), ROW_COUNT, "counter seed");
  console.log("  CRAFTED: cursor 0x8402 + counter 0x20 stamped, A == 0x20");
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the only writes are {counter, cursor low, cursor high}", () => {
  const written = new Set([COUNTER, PTR_LO, PTR_HI]);
  const before = craft();
  const after = craft();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = new Set();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.add(after.stateOffsetToAddr(off));
  }
  for (const addr of changed) {
    assert.ok(written.has(addr), `oracle wrote unexpected addr ${hx(addr)}`);
  }
  for (const addr of written) {
    assert.ok(changed.has(addr), `expected a change at ${hx(addr)}`);
  }
  console.log("  WRITE-SET: every write is within {0x8809, 0x880b, 0x880c}");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong cursor high byte is CAUGHT at 0x880c", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  armTileFillFromPlayfieldBase(c);
  c.mem.write8(PTR_HI, ((PLAYFIELD_TILE_BASE >> 8) ^ 0x01) & 0xff); // BUG: wrong high byte
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong cursor high byte — it is worthless");
  assert.equal(d.addr, PTR_HI, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong high byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong A live-out is CAUGHT by the return check", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  const brokenRet = (armTileFillFromPlayfieldBase(c) ^ 0x01) & 0xff; // module runs, its return perturbed
  assert.notEqual(brokenRet, o.regs.a, "the return check must reject an A that differs from the oracle's");
  console.log(`  TEETH: a perturbed return (${hx(brokenRet)}) differs from the oracle's ${hx(o.regs.a)}`);
});
