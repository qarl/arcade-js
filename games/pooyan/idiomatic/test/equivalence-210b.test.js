// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for spawnTargetActorOnLaunchTrigger (ROM 0x210b, Pooyan) — the one-shot target-slot spawn. It
 * samples and clears a trigger bit; if the bit was clear or a once latch is already set it stops.
 * Otherwise it arms the latch, optionally marks the first slot special, scans two slots for the
 * first free one and seeds it (position, timers, an optional buffer clear, a pair of side flags),
 * then tails to the actor-animation stepper. If both slots are busy the tamper guard decides:
 * nonzero tails to the tamper re-scan, else it returns.
 *
 * SEATING: BALANCED / TAIL-CALL. Reached by a plain call from the boot-frontier sub-dispatch, which
 * reads no register back, so live-out is void; equivalence is RAM (dumpState) minus stack scratch below the entry SP.
 * The init tail (0x22b1) and the fill helper (0x0010) are decompiled and imported; the tamper
 * re-scan (0x2157) is not lifted this batch, so the module keeps m.call(0x2157) and the oracle
 * drives the same frozen re-scan — both walk identical downstream code. The animation stepper is
 * held to its skip branch (grab latch set) so the init cases isolate spawnTargetActorOnLaunchTrigger's own writes.
 *
 * Cases are CRAFTED: a plain boot does not seat the trigger/slot geometry.
 *
 * Jobs:
 *   1. EQUAL — not triggered, already latched, ordinary-slot init, special-slot init (with the
 *      arming precondition), both-busy tamper re-scan, and both-busy return: oracle == module in
 *      RAM (−stack).
 *   2. WRITE-SET — not-triggered only clears the trigger byte; an init seeds the slot fields and the
 *      side flags and arms the latch.
 *   3. TEETH — a wrong seeded byte is caught by the RAM diff; an init-skip twin (never claims the
 *      free slot) diverges on the ordinary-init input.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-210b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_210b as oracle } from "../../translated/loc_210b.js";
import { spawnTargetActorOnLaunchTrigger } from "../spawnTargetActorOnLaunchTrigger.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ACTOR = 0x8a80; // actor source (IX base)
const TRIGGER = ACTOR + 0x07;
const SRC_X = ACTOR + 0x04;
const SRC_Y = ACTOR + 0x06;
const LATCH = 0x8f02; // TARGET_SPAWN_ARM_LATCH
const LAUNCH = 0x8f30; // LAUNCH_STATE
const SLOT0 = 0x8c90; // ENEMY_TARGET_REC0 (IY)
const STRIDE = 0x18;
const SLOT1 = SLOT0 + STRIDE;
const SPECIAL_BUF = 0x8a98; // ACTOR_TABLE_SLOT1, cleared for a special slot
const FLASH = 0x8d19; // FLASH_CELL_BASE
const SIDE_FLAG_8D77 = 0x8d77; // set for a special slot
const GUARD = 0x8a3c; // TAMPER_STRIKES_HUD_GUARD
const GRAB = 0x8d32; // GRAB_ACTIVE_FLAG; set -> the animation stepper skips
const TAMPER_MATCH = 0x8f00; // held to the re-scan's match value so it stays shallow
const SP0 = 0x8ff0;
const D = 0xee; // pre-dirty marker

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Base seat: SP, the stepper held to skip, and the actor source pre-seeded. */
function seat(m) {
  m.regs.sp = SP0;
  m.mem.write8(GRAB, 0x01); // animation stepper skips its pass
  m.mem.write8(SRC_X, 0x50);
  m.mem.write8(SRC_Y, 0x30);
  return m;
}

function craftNotTriggered() {
  const m = seat(BASE.clone());
  m.mem.write8(TRIGGER, 0x0f); // bit4 clear, other bits set -> cleared, then return
  return m;
}
function craftAlreadyLatched() {
  const m = seat(BASE.clone());
  m.mem.write8(TRIGGER, 0x10); // bit4 set
  m.mem.write8(LATCH, 0x01); // latch already armed -> return
  return m;
}
function craftInitOrdinary() {
  const m = seat(BASE.clone());
  m.mem.write8(TRIGGER, 0x10);
  m.mem.write8(LATCH, 0x00);
  m.mem.write8(LAUNCH, 0x00); // below threshold -> no arming
  m.mem.write8(SLOT0, 0x00); // slot 0 free
  for (const off of [0x04, 0x06, 0x0f, 0x10]) m.mem.write8(SLOT0 + off, D);
  m.mem.write8(FLASH, D);
  m.mem.write8(FLASH + 2, D);
  return m;
}
function craftInitSpecial() {
  const m = seat(BASE.clone());
  m.mem.write8(TRIGGER, 0x10);
  m.mem.write8(LATCH, 0x00);
  m.mem.write8(LAUNCH, 0x02); // at threshold
  m.mem.write8(SLOT1, 0x02); // second slot ready-idle -> arms the special mark
  m.mem.write8(SLOT0, 0x00); // slot 0 free
  for (const off of [0x04, 0x06, 0x0f, 0x10]) m.mem.write8(SLOT0 + off, D);
  for (let i = 0; i < STRIDE; i++) m.mem.write8(SPECIAL_BUF + i, D);
  m.mem.write8(SIDE_FLAG_8D77, D);
  m.mem.write8(FLASH, D);
  m.mem.write8(FLASH + 2, D);
  return m;
}
/** Both slots busy; seat the re-scan records so its per-object step stays shallow. */
function craftBothBusy(guard) {
  const m = seat(BASE.clone());
  m.mem.write8(TRIGGER, 0x10);
  m.mem.write8(LATCH, 0x00);
  m.mem.write8(LAUNCH, 0x00);
  for (const rec of [SLOT0, SLOT1]) {
    m.mem.write8(rec + 0x00, 0x01); // in-use (busy) + bit1 clear
    m.mem.write8(rec + 0x06, 0x40); // non-expiring
    m.mem.write8(rec + 0x07, 0x00);
    m.mem.write8(rec + 0x12, 0xff); // skip the one-shot prime
  }
  m.mem.write8(TAMPER_MATCH, 0xd5); // re-scan's tamper check matches -> shallow ret
  m.mem.write8(GUARD, guard);
  return m;
}
const craftReScan = () => craftBothBusy(0x01); // guard nonzero -> tamper re-scan
const craftReturn = () => craftBothBusy(0x00); // guard zero -> return

const CASES = [
  { name: "not triggered", craft: craftNotTriggered },
  { name: "already latched", craft: craftAlreadyLatched },
  { name: "ordinary-slot init", craft: craftInitOrdinary },
  { name: "special-slot init", craft: craftInitSpecial },
  { name: "both busy -> tamper re-scan", craft: craftReScan },
  { name: "both busy -> return", craft: craftReturn },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: spawnTargetActorOnLaunchTrigger == oracle in RAM (−stack)", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    spawnTargetActorOnLaunchTrigger(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: not-triggered only clears the trigger; an init seeds the slot and arms the latch", () => {
  const nt = craftNotTriggered();
  const before = [...nt.dumpState()];
  oracle(nt);
  nt.mem.write8(TRIGGER, 0x0f); // undo just the cleared byte...
  assert.deepEqual([...nt.dumpState()], before, "not-triggered touches only the trigger byte");

  const init = craftInitOrdinary();
  spawnTargetActorOnLaunchTrigger(init);
  assert.equal(init.mem.read8(TRIGGER), 0x00, "trigger cleared");
  assert.equal(init.mem.read8(LATCH), 0x01, "once latch armed");
  assert.equal(init.mem.read8(SLOT0), 0x01, "slot claimed (in-use bit)");
  assert.equal(init.mem.read8(SLOT0 + 0x04), (0x50 - 0x03) & 0xff, "one axis seeded from the source");
  assert.equal(init.mem.read8(SLOT0 + 0x06), (0x30 + 0x04) & 0xff, "other axis seeded from the source");
  assert.equal(init.mem.read8(SLOT0 + 0x0f), 0x14, "ordinary-slot timer");
  assert.equal(init.mem.read8(SLOT0 + 0x10), 0x40, "shared timer");
  assert.equal(init.mem.read8(FLASH), 0x00, "first side flag cleared");
  assert.equal(init.mem.read8(FLASH + 2), 0x00, "second side flag cleared");
  console.log("  WRITE-SET: not-triggered inert; init seeds + arms");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const o = craftInitOrdinary();
  const c = craftInitOrdinary();
  oracle(o);
  spawnTargetActorOnLaunchTrigger(c);
  c.mem.write8(SLOT0 + 0x04, (o.mem.read8(SLOT0 + 0x04) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted slot byte");
  assert.equal(d.addr, SLOT0 + 0x04, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: an init-skip twin (never claims the free slot) diverges", () => {
  const o = craftInitOrdinary();
  const twin = craftInitOrdinary();
  oracle(o);
  // twin performs only the trigger clear + latch, never the slot init
  twin.mem.write8(TRIGGER, 0x00);
  twin.mem.write8(LATCH, 0x01);
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "the gate FAILED to catch a skipped slot init");
  console.log(`  TEETH(init-skip): caught at ${hx(d.addr ?? 0)}`);
});
