// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for generatePlayerControlInput (Pooyan) — per-frame setup of the lead-actor control byte.
 *
 * Always sets LAUNCH_ARMED_FLAG := 1. Then: an inactive slot (ACTOR_TABLE+0x02 != 0) OR a global
 * pause/teardown (WAVE_TEARDOWN_STATE | SECONDARY_TEARDOWN_FLAG != 0) clears the control byte
 * (ACTOR_TABLE+0x07) and returns. Otherwise it stores the complement of an input port — IN1 when
 * FLIP_SCREEN_FLAG != 0, else IN2 — into the control byte, and clears bit 4 of it when the actor
 * has no live sub-timer (ACTOR_TABLE+0x1e == 0).
 *
 * The routine takes NO register inputs (the oracle seats ix/iy/a from constants), so every case is
 * a memory poke. Compared on RAM (dumpState) minus stack scratch below the entry SP; SP is parked in STACK_SCRATCH so
 * the oracle's ret drop falls out of the diff. Input-port values are read from the shared clone, so
 * both sides read the same byte regardless of whether the port cell is writable.
 *
 * Jobs: 1. EQUAL across the clear / IN1 / IN2 / bit4-clear branches; 2. WRITE-SET (flag + control
 * byte, per branch); 3. TEETH (a corrupted control byte is caught; the branches differ).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1042.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1042 as oracle } from "../../translated/loc_1042.js";
import { generatePlayerControlInput } from "../generatePlayerControlInput.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  LAUNCH_ARMED_FLAG,
  ACTOR_TABLE,
  WAVE_TEARDOWN_STATE,
  SECONDARY_TEARDOWN_FLAG,
  FLIP_SCREEN_FLAG,
  IN1_PORT,
  IN2_PORT,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const STATE = ACTOR_TABLE + 0x02;
const CONTROL = ACTOR_TABLE + 0x07;
const SUBTIMER = ACTOR_TABLE + 0x1e;
const SP0 = 0x8ff0; // inside STACK_SCRATCH
const CONTROL_BIT4 = 0x10;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the branch selectors; the control byte is pre-dirtied so a clear/store is observable. */
function seat({ state = 0x00, teardown = 0x00, teardown2 = 0x00, flip = 0x01, subtimer = 0x01 } = {}) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write8(STATE, state);
  m.mem.write8(WAVE_TEARDOWN_STATE, teardown);
  m.mem.write8(SECONDARY_TEARDOWN_FLAG, teardown2);
  m.mem.write8(FLIP_SCREEN_FLAG, flip);
  m.mem.write8(SUBTIMER, subtimer);
  m.mem.write8(CONTROL, 0xaa); // pre-dirty so a clear or store is visible
  m.mem.write8(LAUNCH_ARMED_FLAG, 0x00); // pre-dirty so the arm write is visible
  return m;
}

const CASES = [
  { name: "inactive slot -> clear", cfg: { state: 0x05 } },
  { name: "teardown (primary) -> clear", cfg: { teardown: 0x01 } },
  { name: "teardown (secondary) -> clear", cfg: { teardown2: 0x80 } },
  { name: "IN1 path, sub-timer live", cfg: { flip: 0x01, subtimer: 0x01 } },
  { name: "IN2 path, sub-timer live", cfg: { flip: 0x00, subtimer: 0x01 } },
  { name: "IN1 path, sub-timer zero -> clear bit4", cfg: { flip: 0x01, subtimer: 0x00 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: generatePlayerControlInput == oracle in RAM (−stack)", () => {
  for (const { name, cfg } of CASES) {
    const o = seat(cfg);
    const c = seat(cfg);
    oracle(o);
    generatePlayerControlInput(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} branches identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: arm flag always := 1; control byte cleared/stored per branch", () => {
  // clear branch (inactive slot)
  const clr = seat({ state: 0x05 });
  oracle(clr);
  assert.equal(clr.mem.read8(LAUNCH_ARMED_FLAG), 1, "launch flag armed");
  assert.equal(clr.mem.read8(CONTROL), 0x00, "inactive slot clears the control byte");

  // IN1 store branch, sub-timer live (no bit4 clear)
  const in1 = seat({ flip: 0x01, subtimer: 0x01 });
  const port1 = in1.mem.read8(IN1_PORT);
  oracle(in1);
  assert.equal(in1.mem.read8(CONTROL), (~port1) & 0xff, "IN1 complement stored");

  // IN2 store branch
  const in2 = seat({ flip: 0x00, subtimer: 0x01 });
  const port2 = in2.mem.read8(IN2_PORT);
  oracle(in2);
  assert.equal(in2.mem.read8(CONTROL), (~port2) & 0xff, "IN2 complement stored");

  // sub-timer zero -> bit 4 cleared
  const b4 = seat({ flip: 0x01, subtimer: 0x00 });
  const port4 = b4.mem.read8(IN1_PORT);
  oracle(b4);
  assert.equal(b4.mem.read8(CONTROL), (~port4) & 0xff & ~CONTROL_BIT4, "bit 4 cleared with no sub-timer");
  console.log("  WRITE-SET: LAUNCH_ARMED_FLAG:=1; control = clear / ~IN1 / ~IN2 / ~IN1&~bit4");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted control byte is CAUGHT; branches are load-bearing", () => {
  const o = seat({ flip: 0x01, subtimer: 0x01 });
  const c = seat({ flip: 0x01, subtimer: 0x01 });
  oracle(o);
  generatePlayerControlInput(c);
  c.mem.write8(CONTROL, (o.mem.read8(CONTROL) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted control byte");
  assert.equal(d.addr, CONTROL, `teeth caught wrong address ${hx(d.addr ?? 0)}`);

  // clear vs store branches must differ, or the guard is dead
  const clr = seat({ state: 0x05 });
  const store = seat({ flip: 0x01, subtimer: 0x01 });
  oracle(clr);
  oracle(store);
  assert.notEqual(ramDiffMinusStack(clr, store), null, "clear and store branches must differ");
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}; guard branch load-bearing`);
});
