// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for launchNextScriptedObjectOnDelay (ROM 0x6e86, Pooyan) — scripted single-object launcher. A
 * per-call delay ticks down (decrement-and-return until it elapses); on expiry it reloads the delay
 * from the sequence counter's bit1, pulls the next script byte (0xff terminates), indexes an
 * enemy-actor record from it, and — if a projectile slot is free — arms the record, points it at its
 * animation, launches through the shared spawner, and bumps the sequence counter; with no free slot
 * it backs the script pointer up one.
 *
 * SEATING: BALANCED — every oracle exit is a plain `ret`. LIVE-OUT: none (the caller reads no
 * register back), so the register file is not compared; equivalence is RAM (dumpState) minus
 * stack scratch below the entry SP, with SP parked in STACK_SCRATCH so the callee pushes drop from the diff.
 *
 * Cases are CRAFTED: the script pointer is aimed at a RAM scratch script the test owns.
 *
 * Jobs:
 *   1. EQUAL — delay ticking, script terminator, a full launch (whole spawner tree), and no-free-slot
 *      backup: oracle == module in RAM (−stack).
 *   2. WRITE-SET — ticking only decrements the delay; a launch arms the record and bumps the counter;
 *      no-free-slot restores the pointer.
 *   3. TEETH — a wrong seeded byte in a launched record is caught by the RAM diff; a twin that skips
 *      the delay decrement diverges at the delay cell.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6e86.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6e86 as oracle } from "../../translated/loc_6e86.js";
import { launchNextScriptedObjectOnDelay } from "../launchNextScriptedObjectOnDelay.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const DELAY = 0x8f48; // INTRO_DELAY_CKSUM_WORD (used here as the per-call delay byte)
const SEQ = 0x8f49; // LAUNCH_SEQ_COUNTER
const SCRIPT_PTR = 0x8f4a; // LAUNCH_SCRIPT_PTR (16-bit)
const EAT = 0x8ae0; // ENEMY_ACTOR_TABLE
const PROJ = 0x8bea; // PROJECTILE_SLOT_STATE
const STRIDE = 0x18;
const SCRIPT_AREA = 0x8f60; // RAM scratch the test fills with a script
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the launcher: delay, sequence counter, a script pointed at the scratch area, slot state. */
function seat(m, { delay = 0x00, seq = 0x00, entry = 0x01, slotsBusy = false } = {}) {
  m.regs.sp = SP0;
  m.mem.write8(DELAY, delay);
  m.mem.write8(SEQ, seq);
  m.mem.write16(SCRIPT_PTR, SCRIPT_AREA);
  m.mem.write8(SCRIPT_AREA, entry);
  for (let i = 0; i < 3; i++) m.mem.write8(PROJ + i * STRIDE, slotsBusy ? 0x01 : 0x00);
  return m;
}

const craftTick = () => seat(BASE.clone(), { delay: 0x05 }); //             delay running -> decrement
const craftTerminator = () => seat(BASE.clone(), { delay: 0x00, entry: 0xff }); // script done
const craftLaunch = () => seat(BASE.clone(), { delay: 0x00, entry: 0x01, slotsBusy: false });
const craftNoRoom = () => seat(BASE.clone(), { delay: 0x00, entry: 0x01, slotsBusy: true });

const CASES = [
  { name: "delay ticking -> decrement", craft: craftTick },
  { name: "script terminator -> return", craft: craftTerminator },
  { name: "free slot -> full launch", craft: craftLaunch },
  { name: "no free slot -> back up pointer", craft: craftNoRoom },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: launchNextScriptedObjectOnDelay == oracle in RAM (−stack)", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    launchNextScriptedObjectOnDelay(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: tick decrements only; launch arms + bumps; no-room restores the pointer", () => {
  const tick = craftTick();
  oracle(tick);
  assert.equal(tick.mem.read8(DELAY), 0x04, "ticking decrements the delay");
  assert.equal(tick.mem.read8(SEQ), 0x00, "ticking does not touch the sequence counter");

  const launch = craftLaunch();
  const seqBefore = launch.mem.read8(SEQ);
  oracle(launch);
  assert.equal(launch.mem.read8(EAT + 0x02), 0x06, "the launch arms the selected record state");
  assert.equal(launch.mem.read8(SEQ), (seqBefore + 1) & 0xff, "the launch bumps the sequence counter");

  const noRoom = craftNoRoom();
  oracle(noRoom);
  assert.equal(noRoom.mem.read16(SCRIPT_PTR), SCRIPT_AREA, "no free slot restores the script pointer");
  console.log("  WRITE-SET: tick / launch / no-room footprints confirmed");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong launched-record byte is CAUGHT by the RAM diff", () => {
  const o = craftLaunch();
  const c = craftLaunch();
  oracle(o);
  launchNextScriptedObjectOnDelay(c);
  c.mem.write8(EAT + 0x02, (o.mem.read8(EAT + 0x02) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted record byte");
  assert.equal(d.addr, EAT + 0x02, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the delay decrement diverges at the delay cell", () => {
  const o = craftTick();
  const twin = craftTick(); // a broken launcher that never decrements
  oracle(o);
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "the gate FAILED to catch a missing delay decrement — worthless");
  assert.equal(d.addr, DELAY, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(skip-decrement): caught at ${hx(d.addr)}`);
});
