// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for mainLoopStep (ROM loc_020f) — the main-loop state driver's per-
 * iteration body. The §4 idiomatic module dispatches the display-command ring's worker/command
 * slots as a JS switch; the §3 oracle (translated/mainLoopStep) steps byte-faithful loc_020f.
 *
 * Both invoke the SAME idiomatic handlers with the same command parameter, so for any crafted ring
 * slot they must agree in RAM (−stack); the routine's own live-out is the returned boolean (worker
 * iteration vs command dispatch). Registers are scratch and not compared.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-020f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { mainLoopStep as oracle } from "../../translated/mainLoopStep.js";
import { mainLoopStep } from "../mainLoopStep.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, DISPLAY_CMD_RING_READ_PTR } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RING_PAGE = DISPLAY_CMD_RING_READ_PTR & ~0xff; // 0x8800
const SP0 = 0x8fe0; //                                inside STACK_SCRATCH
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;
const ramDiff = (a, b) => firstStateDiff(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o), inDeadStack);

/** Seat SP + point the read cursor at a crafted ring slot (value + following param byte). */
function craft(slot, param, cursorLo = 0xc0) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.regs.pcKnown = true;
  m.mem8[DISPLAY_CMD_RING_READ_PTR] = cursorLo;
  m.mem8[RING_PAGE | cursorLo] = slot;
  m.mem8[(RING_PAGE | cursorLo) + 1] = param;
  return m;
}

// command N (slot byte N, N<0x80) dispatches table entry 2N; bit-7 slots run the worker.
const CASES = [
  { name: "worker slot (bit 7 set)", slot: 0x80, param: 0x00 },
  { name: "command 0 -> paintActorCountColumn", slot: 0x00, param: 0x11 },
  { name: "command 1 -> renderPhaseGauge", slot: 0x01, param: 0x22 },
  { name: "command 2 -> paintAttractHudAndHighScores", slot: 0x02, param: 0x33 },
  { name: "command 3 -> accrueScoreAndUpdateHighScore (param)", slot: 0x03, param: 0x02 },
  { name: "command 4 -> resetBcdCounterAndRepaintColumn (param)", slot: 0x04, param: 0x01 },
  { name: "command 5 -> drawBcdCounterColumn (param)", slot: 0x05, param: 0x01 },
  { name: "command 6 -> drawStackedCharField (param)", slot: 0x06, param: 0x01 },
  { name: "command 7 -> drawCreditCountAndTamperCheck", slot: 0x07, param: 0x44 },
  { name: "command 8 -> flagHighScore...", slot: 0x08, param: 0x55 },
  { name: "cursor wraps past the ring top", slot: 0x02, param: 0x33, cursorLo: 0xfe },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: mainLoopStep §4 == §3 oracle in RAM (−stack) + return", () => {
  for (const cse of CASES) {
    const o = craft(cse.slot, cse.param, cse.cursorLo);
    const c = craft(cse.slot, cse.param, cse.cursorLo);
    const ro = oracle(o);
    const rc = mainLoopStep(c);
    assert.equal(rc, ro, `[${cse.name}] return mismatch: oracle=${ro} module=${rc}`);
    const d = ramDiff(o, c);
    assert.equal(d, null, d && `[${cse.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} ring slots identical (RAM −stack + return)`);
});

// -- 2. TEETH -----------------------------------------------------------------

test("TEETH: a mis-advanced cursor is CAUGHT by the RAM diff", () => {
  const o = craft(0x02, 0x33);
  const c = craft(0x02, 0x33);
  oracle(o);
  mainLoopStep(c);
  c.mem8[DISPLAY_CMD_RING_READ_PTR] = (c.mem8[DISPLAY_CMD_RING_READ_PTR] + 1) & 0xff; // wrong advance
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a mis-advanced cursor");
  assert.equal(d.addr, DISPLAY_CMD_RING_READ_PTR, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: mis-advanced cursor caught at ${hx(d.addr)}`);
});
