// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceWriteAnimTileIndexOnCountdown (ROM 0x7f0e, Pooyan) — write-anim dispatch handler
 * (0x7e94 table, entry 1). It decrements the 16-bit counter 0x8e2b; on zero it tails into floodWriteAnimCellsAndLatchPhase.
 * Otherwise the flag byte pointed to by loc_8e21 selects an index direction: bit 3 set counts the
 * index (0x8e23) DOWN (wrap below 0x10 -> 0x2c); bit 3 clear + bit 2 clear tails into appendWriteAnimBlockRowOnPhase;
 * bit 3 clear + bit 2 set counts the index UP (wrap above 0x2c -> 0x10). Each index path first ticks
 * the 0x0c-reload sub-timer 0x8e24 (returns while it counts), then stores the index byte through the
 * 0x8e27 pointer and falls through into appendWriteAnimBlockRowOnPhase.
 *
 * SEATING: TAIL. The oracle has no ret of its own — it either returns while the reload sub-timer is
 * counting (seam completes) or tail-delegates via the routines map into floodWriteAnimCellsAndLatchPhase / appendWriteAnimBlockRowOnPhase (their ret
 * is advanceWriteAnimTileIndexOnCountdown's seating, net SP 0). The module dissolves those tails to direct idiomatic calls; the
 * oracle drives them through the routines map. LIVE-OUT is memory only, so equivalence is RAM
 * (dumpState) minus stack scratch below the entry SP (SP parked there so the oracle's pushes/pops drop out of the diff).
 *
 * Jobs:
 *   1. EQUAL — every load-bearing arm (counter-expired tail, DOWN no-wrap/wrap/hold, bit-2-clear tail,
 *      UP no-wrap/wrap/hold, and a DOWN arm whose flags drive appendWriteAnimBlockRowOnPhase's active writeback): oracle == module.
 *   2. TEETH/RAM — a wrong index byte is CAUGHT by the RAM diff.
 *   3. TEETH/BRANCH — the flag byte is load-bearing: DOWN vs UP diverge at the index cell.
 *   4. SP-TOOTH — the tail-dispatch and omitted-ret arms are seam-placeable (net SP 0).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7f0e.test.js
 */
import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7f0e as oracle } from "../../translated/loc_7f0e.js";
import { advanceWriteAnimTileIndexOnCountdown } from "../advanceWriteAnimTileIndexOnCountdown.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ANIM_COUNTER = 0x8e2b; // 16-bit down-counter
const FLAG_PTR = 0x8e21; //     loc_8e21 — 16-bit pointer to the direction flag byte
const RELOAD_TIMER = 0x8e24; // 0x0c-reload sub-timer
const INDEX_CELL = 0x8e23; //   animation index byte
const DEST_PTR = 0x8e27; //     16-bit pointer the index byte is stored through
const WB_PTR = 0x8e1f; //       appendWriteAnimBlockRowOnPhase writeback pointer
const COUNTDOWN = 0x8e25; //    appendWriteAnimBlockRowOnPhase/floodWriteAnimCellsAndLatchPhase countdown (0 keeps floodWriteAnimCellsAndLatchPhase's fill loop off)
const RING = 0x8e29; //         appendWriteAnimBlockRowOnPhase shift ring

const FLAG_BYTE = 0x8e40; //    where FLAG_PTR points (writable scratch)
const DEST_CELL = 0x8e42; //    where DEST_PTR points (writable scratch)
const WB_CELL = 0x8e44; //      where WB_PTR points (writable scratch)

const SP0 = 0x8ff0; //          inside STACK_SCRATCH
const CALLER_RET = 0xfffc; //   caller-return word at SP0; the seam/oracle-ret pops it

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function w16(m, addr, v) {
  m.mem8[addr] = v & 0xff;
  m.mem8[addr + 1] = (v >> 8) & 0xff;
}

/** counterInit is the 16-bit value BEFORE the handler's dec; flags is the direction byte. */
function craft({ counter, flags, reload, index }) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write16(SP0, CALLER_RET);
  w16(m, ANIM_COUNTER, counter);
  w16(m, FLAG_PTR, FLAG_BYTE); // loc_8e21 -> flag byte
  w16(m, DEST_PTR, DEST_CELL); // 0x8e27 -> store target
  w16(m, WB_PTR, WB_CELL); //    0x8e1f -> appendWriteAnimBlockRowOnPhase writeback target
  m.mem8[FLAG_BYTE] = flags & 0xff;
  m.mem8[RELOAD_TIMER] = reload & 0xff;
  m.mem8[INDEX_CELL] = index & 0xff;
  m.mem8[COUNTDOWN] = 0x00;
  m.mem8[RING] = 0x00;
  return m;
}

// Load-bearing arms. counter 0x0001 -> dec 0x0000 fires the counter-expired tail; 0x0100 -> 0x00ff otherwise.
const ARMS = [
  ["counter-expired -> floodWriteAnimCellsAndLatchPhase", { counter: 0x0001, flags: 0x08, reload: 0x01, index: 0x20 }],
  ["DOWN no-wrap", { counter: 0x0100, flags: 0x08, reload: 0x01, index: 0x20 }],
  ["DOWN wrap (<0x10 -> 0x2c)", { counter: 0x0100, flags: 0x08, reload: 0x01, index: 0x10 }],
  ["DOWN reload holds", { counter: 0x0100, flags: 0x08, reload: 0x05, index: 0x20 }],
  ["bit-2-clear -> appendWriteAnimBlockRowOnPhase", { counter: 0x0100, flags: 0x00, reload: 0x01, index: 0x20 }],
  ["UP no-wrap", { counter: 0x0100, flags: 0x04, reload: 0x01, index: 0x20 }],
  ["UP wrap (>0x2c -> 0x10)", { counter: 0x0100, flags: 0x04, reload: 0x01, index: 0x2c }],
  ["UP reload holds", { counter: 0x0100, flags: 0x04, reload: 0x05, index: 0x20 }],
  // bit4 set drives appendWriteAnimBlockRowOnPhase's active writeback path (ring gate hits 1) through the fall-through tail.
  ["DOWN + appendWriteAnimBlockRowOnPhase active writeback", { counter: 0x0100, flags: 0x18, reload: 0x01, index: 0x20 }],
];

// -- 1. EQUAL -----------------------------------------------------------------
test("EQUAL: every load-bearing arm — module == oracle in RAM (−stack)", () => {
  for (const [label, opts] of ARMS) {
    const o = craft(opts);
    oracle(o);
    const c = craft(opts);
    advanceWriteAnimTileIndexOnCountdown(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${ARMS.length} arms identical (RAM −stack)`);
});

// -- 2. TEETH/RAM -------------------------------------------------------------
test("TEETH/RAM: a wrong stepped index byte is CAUGHT by the RAM diff", () => {
  const opts = { counter: 0x0100, flags: 0x08, reload: 0x01, index: 0x10 }; // DOWN wrap -> 0x2c
  const o = craft(opts);
  const c = craft(opts);
  oracle(o);
  advanceWriteAnimTileIndexOnCountdown(c);
  assert.equal(ramDiffMinusStack(o, c), null, "sanity: unmodified arm must match before corrupting");
  c.mem8[INDEX_CELL] = (c.mem8[INDEX_CELL] + 1) & 0xff; // corrupt the stepped index
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong index byte — it is worthless");
  assert.equal(d.addr, INDEX_CELL, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong index caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 3. TEETH/BRANCH ----------------------------------------------------------
test("TEETH/BRANCH: the flag byte is load-bearing — DOWN vs UP diverge at the index cell", () => {
  const down = craft({ counter: 0x0100, flags: 0x08, reload: 0x01, index: 0x20 }); // -> 0x1f
  const up = craft({ counter: 0x0100, flags: 0x04, reload: 0x01, index: 0x20 }); //   -> 0x21
  oracle(down);
  oracle(up);
  const d = ramDiffMinusStack(down, up);
  assert.notEqual(d, null, "DOWN and UP produced identical RAM — the direction flag does nothing");
  assert.equal(d.addr, INDEX_CELL, `direction should first diverge at the index cell, got ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/BRANCH: DOWN(${hx(d.a)}) vs UP(${hx(d.b)}) diverge at ${hx(d.addr)}`);
});

// -- 4. SP-TOOTH (R36) --------------------------------------------------------
test("SP-TOOTH: tail-dispatch and omitted-ret arms are both seam-placeable (net SP 0)", () => {
  const cases = [
    ["counter-expired tail (floodWriteAnimCellsAndLatchPhase)", { counter: 0x0001, flags: 0x08, reload: 0x01, index: 0x20 }],
    ["bit-2-clear tail (appendWriteAnimBlockRowOnPhase)", { counter: 0x0100, flags: 0x00, reload: 0x01, index: 0x20 }],
    ["fall-through tail (appendWriteAnimBlockRowOnPhase)", { counter: 0x0100, flags: 0x08, reload: 0x01, index: 0x20 }],
    ["omitted-ret (reload holds)", { counter: 0x0100, flags: 0x08, reload: 0x05, index: 0x20 }],
  ];
  for (const [label, opts] of cases) {
    const r = seamPlaceable(withOmittedRet, advanceWriteAnimTileIndexOnCountdown, 0x7f0e, craft(opts));
    assert.equal(r.placeable, true, `[${label}] must be seam-placeable; got: ${r.error}`);
  }
  console.log("  SP-TOOTH: all tail-dispatch + omitted-ret arms seam-placeable (moved 0)");
});
