// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueCreditDisplayRefresh (ROM 0x5a97, Pooyan) — queue the score-drip display command.
 *
 * SEATING: BALANCED (loads DE, calls the frozen rst-0x38 dispatcher, rets). LIVE-OUT is memory only
 * (the display-command ring the dispatcher writes); the register file is not compared, SP parked in
 * STACK_SCRATCH so the push16 + the handler's push hl drop out of the RAM diff. Both layers marshal
 * the same command word through DE into the SAME frozen handler, so RAM agrees by construction.
 *
 * Jobs:
 *   1. EQUAL — oracle == module in RAM (−stack).
 *   2. WRITE-SET — the queued command byte lands in the display ring.
 *   3. TEETH — a corrupted post-run ring byte is caught; a twin queuing a different word diverges.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5a97.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5a97 as oracle } from "../../translated/loc_5a56.js";
import { queueCreditDisplayRefresh } from "../queueCreditDisplayRefresh.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RING_PTR = 0x88a0; // display-ring write pointer the handler reads/advances
const SLOT = 0x88c0; //     ring slot the pointer selects; bit7 set = free -> enqueue runs
const SP0 = 0x8ff0; //      inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the display ring on the enqueue path (free slot) with SP in dead scratch. */
function seat(m) {
  m.regs.sp = SP0;
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  m.mem.write8(RING_PTR, 0xc0); // pointer at ring start
  m.mem.write8(SLOT, 0x80); //     slot free (bit7 set) -> handler enqueues
  return m;
}

/** A twin that queues a DIFFERENT command word -> the handler writes a different E byte. */
function brokenTwin(m) {
  m.regs.de = 0x0702; // wrong command word
  m.push16(0x5a9b);
  m.call(0x0038);
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: queueCreditDisplayRefresh == oracle in RAM (−stack)", () => {
  const o = seat(BASE.clone());
  const c = seat(BASE.clone());
  oracle(o);
  queueCreditDisplayRefresh(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL: display-command queue identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the command word lands in the ring and the pointer advances", () => {
  const c = seat(BASE.clone());
  queueCreditDisplayRefresh(c);
  assert.equal(c.mem.read8(SLOT), 0x07, "D=0x07 enqueued at the ring slot");
  assert.equal(c.mem.read8(SLOT + 1), 0x01, "E=0x01 enqueued at the next ring byte");
  assert.equal(c.mem.read8(RING_PTR), 0xc2, "ring pointer advanced by 2");
  console.log("  WRITE-SET: 0x0701 queued, pointer +2");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted post-run ring byte is CAUGHT by the RAM diff", () => {
  const o = seat(BASE.clone());
  const c = seat(BASE.clone());
  oracle(o);
  queueCreditDisplayRefresh(c);
  c.mem.write8(SLOT, (o.mem.read8(SLOT) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, SLOT, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin queuing a different command word diverges from the oracle", () => {
  const o = seat(BASE.clone());
  const t = seat(BASE.clone());
  oracle(o);
  brokenTwin(t);
  const d = ramDiffMinusStack(o, t);
  assert.notEqual(d, null, "a different command word must be caught by the RAM diff");
  console.log(`  TEETH(twin): caught at ${hx(d.addr ?? 0)}`);
});
