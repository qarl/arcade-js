// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceTargetActorAlongVelocityElseDespawn (ROM 0x2226, Pooyan) — the two-axis object stepper at IY.
 *
 * The module direct-calls the idiomatic phase reload (loadPhaseMotionParamsAndAdvancePhase) and the record-clear (clearTargetActorRecord);
 * the oracle drives the frozen siblings through the registry that new Machine(ROM) builds. advanceTargetActorAlongVelocityElseDespawn
 * is a void stepper — no register survives — so the register file is not compared; equivalence is
 * RAM (dumpState) minus stack scratch below the entry SP, SP parked in dead stack so nested pushes drop out.
 *
 * The load-bearing subtlety: on a reload the phase-param routine's final `cp 0x09` leaves a Z80
 * carry the X `sbc hl,de` consumes, so a reload+subtract subtracts one extra. The idiomatic reload
 * is flag-free, so the module reconstructs that borrow from the pre-reload phase — this gate proves
 * the reconstruction against the oracle's real flag.
 *
 * Jobs:
 *   1. EQUAL — move/add, move/subtract, spent (record blanked), reload+subtract WITH borrow, and
 *      reload+subtract WITHOUT borrow (phase 8): oracle == module in RAM (−stack).
 *   2. WRITE-SET — a spent object clears its scratch cells and blanks its record; a live object
 *      ticks the phase counter down.
 *   3. TEETH — a wrong stored X byte is caught by the RAM diff; and on the reload path the borrow
 *      is observable — the oracle's stored X is one below the no-borrow result.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2226.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2226 as oracle } from "../../translated/loc_2226.js";
import { advanceTargetActorAlongVelocityElseDespawn } from "../advanceTargetActorAlongVelocityElseDespawn.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const OBJ = 0x8b40; //   record base (low bit3 clear -> reads the base sign byte 0x8d19)
const PHASE_CT = 0x8f0e; // phase counter: 0 triggers a reload
const PHASE_IX = 0x8f0f; // phase index the reload advances
const XVEL = 0x8f10; //  X velocity word
const YVEL = 0x8f12; //  Y velocity word
const SIGN = 0x8d19; //  direction sign byte pair (0x8d19/0x8d1a); bit0 = add vs subtract
const LAUNCH_STATE = 0x8f30;
const SCR45 = 0x8d45;
const SCR77 = 0x8d77;
const LAUNCH_ARMED = 0x8f3f;
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const u16 = (v) => v & 0xffff;
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone with IY seated at the record and the case cells poked. */
function craft(o = {}) {
  const m = BASE.clone();
  m.regs.iy = OBJ;
  m.regs.sp = SP0;
  m.mem8[PHASE_CT] = o.phaseCt ?? 0x05; // nonzero -> no reload by default
  m.mem8[PHASE_IX] = o.phaseIx ?? 0x03;
  m.mem16[XVEL] = o.xv ?? 0x0010;
  m.mem16[YVEL] = o.yv ?? 0x0020;
  m.mem8[SIGN] = o.sign ?? 0x01; // bit0 set -> add
  // record body: X low sub-pixel and position; Y sub-pixel and position
  m.mem8[OBJ + 0x03] = o.ylo ?? 0x00;
  m.mem8[OBJ + 0x04] = o.yhi ?? 0x10;
  m.mem8[OBJ + 0x05] = o.xlo ?? 0x80;
  m.mem8[OBJ + 0x06] = o.xhi ?? 0x40;
  // pre-dirty the scratch cells the spent path clears
  for (const a of [LAUNCH_STATE, SCR45, SCR77, LAUNCH_ARMED]) m.mem8[a] = 0xee;
  return m;
}

const CASES = {
  "move/add": {},
  "move/subtract": { sign: 0x00 },
  "spent": { ylo: 0x00, yhi: 0xe7, yv: 0x0100 }, // Y high crosses 0xe8
  "reload+subtract borrow": { phaseCt: 0x00, phaseIx: 0x03, sign: 0x00 }, // phase 3 -> borrow
  "reload+subtract no-borrow": { phaseCt: 0x00, phaseIx: 0x08, sign: 0x00 }, // phase 8 -> no borrow
};

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: advanceTargetActorAlongVelocityElseDespawn == oracle in RAM (−stack)", () => {
  for (const [label, o] of Object.entries(CASES)) {
    const a = craft(o);
    const b = craft(o);
    oracle(a);
    advanceTargetActorAlongVelocityElseDespawn(b);
    const d = ramDiffMinusStack(a, b);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: spent clears scratch + blanks the record; live ticks the phase counter", () => {
  const spent = craft(CASES["spent"]);
  oracle(spent);
  for (const a of [PHASE_CT, PHASE_IX, LAUNCH_STATE, SCR45, SCR77, LAUNCH_ARMED])
    assert.equal(spent.mem8[a], 0x00, `spent must clear ${hx(a)}`);
  assert.equal(spent.mem8[OBJ + 0x00], 0x00, "spent must blank the record head");

  const live = craft({ phaseCt: 0x05 });
  oracle(live);
  assert.equal(live.mem8[PHASE_CT], 0x04, "a live object ticks the phase counter down");
  console.log("  WRITE-SET: spent clears+blanks; live decrements the counter");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong stored X byte is CAUGHT by the RAM diff", () => {
  const a = craft(CASES["move/add"]);
  const b = craft(CASES["move/add"]);
  oracle(a);
  advanceTargetActorAlongVelocityElseDespawn(b);
  b.mem8[OBJ + 0x05] = (a.mem8[OBJ + 0x05] ^ 0xff) & 0xff; // corrupt the stored X low
  const d = ramDiffMinusStack(a, b);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted X byte — worthless");
  assert.equal(d.addr, OBJ + 0x05, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong X byte caught at ${hx(d.addr)}`);
});

test("TEETH: the reload borrow is observable — stored X is one below the no-borrow result", () => {
  const xBefore = (craft(CASES["reload+subtract borrow"]).mem8[OBJ + 0x05]) |
    (craft(CASES["reload+subtract borrow"]).mem8[OBJ + 0x06] << 8);
  const a = craft(CASES["reload+subtract borrow"]);
  oracle(a);
  const xv = a.mem16[XVEL]; // velocity reloaded by loadPhaseMotionParamsAndAdvancePhase
  const stored = a.mem8[OBJ + 0x05] | (a.mem8[OBJ + 0x06] << 8);
  assert.equal(stored, u16(xBefore - xv - 1), "reload+subtract must borrow one from the reload's carry");
  assert.notEqual(stored, u16(xBefore - xv), "a no-borrow subtract would differ — the borrow is load-bearing");
  console.log(`  TEETH/borrow: stored=${hx(stored)} == (xBefore−xv−1), != no-borrow ${hx(u16(xBefore - xv))}`);
});
