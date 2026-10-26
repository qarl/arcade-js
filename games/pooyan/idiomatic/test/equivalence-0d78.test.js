// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for startSelectedPlayerGameConsumingCredits (ROM 0x0d78, Pooyan) — coin/credit post-handler on IN0 bits.
 *
 * Bit 3 (1P-start) of INPUT_PORT0 (0x8810) hands off to startOnePlayerGameOnCredit. Otherwise, unless bit 4 (2P-start)
 * is set it returns. With bit 4 set it consumes two credits (0x8802) — returning early if fewer than
 * two — runs a ROM checksum over 0x776b (bumping the 0x89ea tamper counter on a nonzero fold), then
 * continues into beginTwoPlayerStartOfLife. The dissolved tails (startOnePlayerGameOnCredit, beginTwoPlayerStartOfLife -> startNewGamePlay) run their idiomatic
 * modules; equality is therefore transitive on those gates.
 *
 * Cycle-free memory-equivalence: a fresh clone per side, RAM (dumpState) minus stack scratch below the entry SP.
 * No register live-out. SP parked in dead stack scratch.
 *
 * Jobs:
 *   1. EQUAL — bit3 (startOnePlayerGameOnCredit 0df4 path), bit4-clear return, bit4-set/credits<2 return, and
 *      bit4-set/credits>=2 (checksum + beginTwoPlayerStartOfLife): module == oracle (RAM −stack).
 *   2. WRITE-SET — the consume path subtracts 2 credits; the credits<2 path is inert.
 *   3. TEETH — a corrupted credit byte and a twin that skips the subtract are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0d78.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0d78 as oracle } from "../../translated/loc_0cf8.js";
import { startSelectedPlayerGameConsumingCredits } from "../startSelectedPlayerGameConsumingCredits.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const INPUT_PORT0 = 0x8810;
const CREDIT_COUNT = 0x8802;
const PLAY_STATE_INDEX = 0x880a;
const PLAYER_CTRL = 0x880e;
const RING_WRITE_PTR = 0x88a0;
const RING_PAGE = 0x8800;
const RING_START = 0xc0;
const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function craft({ in0, credits, state = 0x00, ctrl = 0x00 }) {
  const m = BASE.clone();
  m.mem.write8(INPUT_PORT0, in0 & 0xff);
  m.mem.write8(CREDIT_COUNT, credits & 0xff);
  m.mem.write8(PLAY_STATE_INDEX, state & 0xff); // != 0x0e so startOnePlayerGameOnCredit's 0df4 path sets 0x8805
  m.mem.write8(PLAYER_CTRL, ctrl & 0xff); // bit0 clear -> startNewGamePlay's shorter (ret nc) path
  m.mem.write8(RING_WRITE_PTR, RING_START);
  for (let c = RING_START; c <= 0xff; c++) m.mem.write8(RING_PAGE + c, 0x80); // all slots free
  m.regs.sp = SP0;
  return m;
}

const CASES = {
  "bit3 -> startOnePlayerGameOnCredit": { in0: 0x08, credits: 0x00, state: 0x00 },
  "bit4 clear -> return": { in0: 0x00, credits: 0x03 },
  "bit4 set, credits<2 -> return": { in0: 0x10, credits: 0x01 },
  "bit4 set, credits>=2 -> beginTwoPlayerStartOfLife": { in0: 0x10, credits: 0x05 },
};

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: startSelectedPlayerGameConsumingCredits == oracle in RAM (−stack)", () => {
  for (const [name, args] of Object.entries(CASES)) {
    const o = craft(args);
    const c = craft(args);
    oracle(o);
    startSelectedPlayerGameConsumingCredits(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the consume path subtracts 2 credits; the credits<2 path is inert", () => {
  const consume = craft(CASES["bit4 set, credits>=2 -> beginTwoPlayerStartOfLife"]);
  oracle(consume);
  assert.equal(consume.mem.read8(CREDIT_COUNT), 0x03, "0x05 - 2 = 0x03 credits after the consume path");

  const few = craft(CASES["bit4 set, credits<2 -> return"]);
  const before = few.dumpState();
  oracle(few);
  assert.deepEqual([...few.dumpState()], [...before], "credits<2 must leave RAM untouched");
  console.log("  WRITE-SET: consume -2; credits<2 inert");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted credit byte is CAUGHT by the RAM diff", () => {
  const o = craft(CASES["bit4 set, credits>=2 -> beginTwoPlayerStartOfLife"]);
  const c = craft(CASES["bit4 set, credits>=2 -> beginTwoPlayerStartOfLife"]);
  oracle(o);
  startSelectedPlayerGameConsumingCredits(c);
  c.mem.write8(CREDIT_COUNT, (o.mem.read8(CREDIT_COUNT) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted credit byte");
  assert.equal(d.addr, CREDIT_COUNT, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the credit subtract diverges from the oracle", () => {
  const o = craft(CASES["bit4 set, credits>=2 -> beginTwoPlayerStartOfLife"]);
  const c = craft(CASES["bit4 set, credits>=2 -> beginTwoPlayerStartOfLife"]);
  oracle(o);
  // twin: leave credits at 0x05 (skip the -2) but otherwise identical clone
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped credit subtract must be caught by the RAM diff");
  console.log(`  TEETH(skip): caught at ${hx(d.addr ?? 0)}`);
});
