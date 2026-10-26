// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueDisplayCommandAndRebuildSpriteList (Pooyan) — a two-instruction tail: enqueue the display
 * command held in DE via the (already idiomatic) ring helper enqueueDisplayCommand, then tail into the per-frame
 * sprite-display-list rebuild rebuildSpriteDisplayList.
 *
 * REGISTER BRIDGE: cmd = m.regs.de. Each case seats a FREE ring slot so the enqueue path writes and
 * the command bytes join the compared RAM. Compared on RAM (dumpState) minus stack scratch below the entry SP; SP is
 * parked in STACK_SCRATCH so the oracle's push/ret drop out of the diff.
 *
 * Jobs: 1. EQUAL over several DE values; 2. DE-THREADED (two commands produce different RAM, so the
 * register bridge is load-bearing and correctly forwarded); 3. TEETH (a corrupted enqueued byte is
 * caught by the RAM diff).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6bae.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6bae as oracle } from "../../translated/loc_6bae.js";
import { queueDisplayCommandAndRebuildSpriteList } from "../queueDisplayCommandAndRebuildSpriteList.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, DISPLAY_CMD_RING_WRITE_PTR } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8ff0; // inside STACK_SCRATCH
const RING_PAGE = 0x8800;
const RING_SLOT_LOW = 0xc0;
const CMD_HI_SLOT = RING_PAGE + RING_SLOT_LOW; // where the enqueue stores the command's high byte

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function seat(cmd) {
  const m = BASE.clone();
  m.regs.de = cmd & 0xffff;
  m.regs.sp = SP0;
  m.mem.write8(DISPLAY_CMD_RING_WRITE_PTR, RING_SLOT_LOW);
  m.mem.write8(CMD_HI_SLOT, 0x80); // free slot (bit 7 set) so the enqueue writes
  return m;
}

const CMDS = [0x0642, 0x06ab, 0x0200, 0x068b];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: queueDisplayCommandAndRebuildSpriteList == oracle in RAM (−stack) across DE values", () => {
  for (const cmd of CMDS) {
    const o = seat(cmd);
    const c = seat(cmd);
    oracle(o);
    queueDisplayCommandAndRebuildSpriteList(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `cmd=${hx(cmd)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CMDS.length} DE values identical (RAM −stack, incl. enqueue + display rebuild)`);
});

// -- 2. DE-THREADED -----------------------------------------------------------

test("DE-THREADED: distinct commands produce distinct RAM (the register bridge is load-bearing)", () => {
  const a = seat(0x0642);
  const b = seat(0x06ab);
  queueDisplayCommandAndRebuildSpriteList(a);
  queueDisplayCommandAndRebuildSpriteList(b);
  assert.notEqual(ramDiffMinusStack(a, b), null, "two DE values must enqueue different bytes");
  // and the enqueued high byte is exactly the command's high byte
  const one = seat(0x0642);
  queueDisplayCommandAndRebuildSpriteList(one);
  assert.equal(one.mem.read8(CMD_HI_SLOT), 0x06, "enqueued high byte == DE >> 8");
  console.log("  DE-THREADED: distinct commands diverge in RAM; enqueue reflects DE");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted enqueued byte is CAUGHT by the RAM diff", () => {
  const o = seat(0x0642);
  const c = seat(0x0642);
  oracle(o);
  queueDisplayCommandAndRebuildSpriteList(c);
  c.mem.write8(CMD_HI_SLOT, (o.mem.read8(CMD_HI_SLOT) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted enqueued byte");
  assert.equal(d.addr, CMD_HI_SLOT, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});
