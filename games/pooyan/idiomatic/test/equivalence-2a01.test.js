// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for advanceActorState2AndCapWaveArrival (ROM 0x2a01) — the CALLER that dissolves the climbHunterToLaunchRowThenPromoteGroup
 * caller-skip. advanceActorState2AndCapWaveArrival reseats a record, paints tiles, advances the record state, then
 * integrity-checks the field attribute source table (8-bit sum of 0x20 bytes == 1). On a clean
 * check it enqueues a display command and caps the wave-arrival counter; on a mismatch it
 * TAIL-JUMPS into climbHunterToLaunchRowThenPromoteGroup, propagating that routine's caller-skip boolean.
 *
 * Contract compared per case: RAM (dumpState, minus stack scratch below the entry SP). advanceActorState2AndCapWaveArrival has no register
 * live-out of its own; on the tamper branch it forwards climbHunterToLaunchRowThenPromoteGroup's boolean, which the EQUAL jobs
 * also confirm. pc/cycles/full register file are not compared.
 *
 * The tamper branch is gated on a ROM checksum that PASSES for the intact image (verified: the
 * 0x20 bytes at 0x0839 sum to 1), so the branch is unreachable by poking RAM — and ROM writes
 * throw. To reach the composition we build a SECOND base from a ROM copy with one summed byte
 * bumped, so the checksum fails and BOTH sides tail-jump into climbHunterToLaunchRowThenPromoteGroup. That composes the real
 * idiomatic skip over a skip-NOT-taken state (climbHunterToLaunchRowThenPromoteGroup climbs -> true) AND a skip-taken state
 * (climbHunterToLaunchRowThenPromoteGroup reaches the top -> false). The oracle runs the registered translated climbHunterToLaunchRowThenPromoteGroup/enqueueDisplayCommand
 * via m.call; the idiomatic caller imports the idiomatic equivalents — the whole unit is composed.
 *
 * Jobs:
 *   1. EPILOGUE/CAP   — intact ROM, counter 0x09: clean check enqueues the command and caps the
 *                       counter to 0x08; oracle == idiomatic; the enqueue + cap are asserted.
 *   2. EPILOGUE/NOCAP — intact ROM, counter 0x05: below the cap, the counter is left unchanged.
 *   3. TAMPER/CLIMB   — tampered ROM, skip-NOT-taken: climbHunterToLaunchRowThenPromoteGroup climbs (true); oracle == idiomatic;
 *                       positive control — the epilogue ring write did NOT happen (branch taken).
 *   4. TAMPER/TOP     — tampered ROM, skip-taken: climbHunterToLaunchRowThenPromoteGroup sweeps (false); oracle == idiomatic;
 *                       positive control — the seeded 0x8ae0 record was transitioned by the sweep.
 *   5. BRANCH-LIVE    — the checksum genuinely selects the branch: intact sum == 1, tampered != 1,
 *                       and the idiomatic run over intact vs tampered ROM lands in DIFFERENT RAM.
 *   6. TEETH          — a wrong painted tile byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2a01.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2a01 as oracle } from "../../translated/loc_2a01.js";
import { advanceActorState2AndCapWaveArrival } from "../advanceActorState2AndCapWaveArrival.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ENEMY_ACTOR_TABLE,
  WAVE_ARRIVAL_COUNTER,
  STATE2_TILE_PAINT_VRAM,
  FIELD_ATTRIB_SRC_A,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff8);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const CKSUM_ADDR = 0x0839; // FIELD_ATTRIB_SRC_A: first byte of the summed integrity block
const CKSUM_LEN = 0x20;
function romSum(rom) {
  let s = 0;
  for (let i = 0; i < CKSUM_LEN; i++) s = (s + rom[CKSUM_ADDR + i]) & 0xff;
  return s;
}

// Intact base (checksum passes -> epilogue) and a tampered base (one summed byte bumped ->
// checksum fails -> tail-jump into climbHunterToLaunchRowThenPromoteGroup). clone() shares the rom reference, so the tamper
// propagates to every craft.
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;
let TAMPERED_ROM = null;
let BASE_TAMPER = null;
if (ROM_PRESENT) {
  TAMPERED_ROM = ROM.slice();
  TAMPERED_ROM[CKSUM_ADDR] = (TAMPERED_ROM[CKSUM_ADDR] + 1) & 0xff; // sum 1 -> 2, checksum now fails
  BASE_TAMPER = new Machine(TAMPERED_ROM).clone();
}

const REC = 0x8a80; //   the 0x8a80 actor record advanceActorState2AndCapWaveArrival operates on
const RING_PTR = 0x88a0; // DISPLAY_CMD_RING_WRITE_PTR
const RING_SLOT = 0x88c0; // first ring slot (page 0x88 + 0xc0)

/** A fresh clone off `base` with advanceActorState2AndCapWaveArrival's inputs (and climbHunterToLaunchRowThenPromoteGroup's, for the jp path) seated. */
function craftFrom(base, opts = {}) {
  const m = base.clone();
  m.regs.ix = REC;
  m.regs.sp = 0x8ff8; // in STACK_SCRATCH; the oracle's push/pop/ret stay inside it
  // epilogue plumbing (a free ring slot so enqueueDisplayCommand actually enqueues); harmless on the jp path
  m.mem.write8(RING_PTR, 0xc0);
  m.mem.write8(RING_SLOT, 0x80); // bit7 set => slot free
  m.mem.write8(WAVE_ARRIVAL_COUNTER, opts.counter ?? 0x09);
  // climbHunterToLaunchRowThenPromoteGroup record inputs (consumed only when the checksum fails and advanceActorState2AndCapWaveArrival tail-jumps)
  m.mem.write8(REC + 0x0e, 0x05); // frame-hold nonzero: advanceObjectAnimationFrame just decrements
  m.mem.write8(REC + 0x05, opts.lo ?? 0);
  m.mem.write8(REC + 0x09, opts.step ?? 0);
  m.mem.write8(REC + 0x06, opts.hi ?? 0);
  if (opts.seedTrigger) m.mem.write8(ENEMY_ACTOR_TABLE + 0x02, 0x11); // sweep transitions record 0
  return m;
}

// -- 1. EPILOGUE/CAP ----------------------------------------------------------

test("EPILOGUE/CAP: intact ROM, clean check enqueues + caps the counter; oracle == idiomatic", () => {
  const o = craftFrom(BASE, { counter: 0x09 });
  const c = craftFrom(BASE, { counter: 0x09 });
  oracle(o);
  advanceActorState2AndCapWaveArrival(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  // positive controls on the module's own clone
  assert.equal(c.mem.read8(RING_SLOT), 0x06, "enqueueDisplayCommand must enqueue the command high byte 0x06");
  assert.equal(c.mem.read8(RING_SLOT + 1), 0x15, "enqueueDisplayCommand must enqueue the command low byte 0x15");
  assert.equal(c.mem.read8(WAVE_ARRIVAL_COUNTER), 0x08, "counter 0x09 must be capped to 0x08");
  assert.equal(c.mem.read8(STATE2_TILE_PAINT_VRAM), 0xbc, "the tile paint must have run");
  console.log("  EPILOGUE/CAP: enqueue + cap identical to oracle");
});

// -- 2. EPILOGUE/NOCAP --------------------------------------------------------

test("EPILOGUE/NOCAP: intact ROM, counter below the cap is left unchanged; oracle == idiomatic", () => {
  const o = craftFrom(BASE, { counter: 0x05 });
  const c = craftFrom(BASE, { counter: 0x05 });
  oracle(o);
  advanceActorState2AndCapWaveArrival(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  assert.equal(c.mem.read8(WAVE_ARRIVAL_COUNTER), 0x05, "counter below 0x09 must be untouched");
  console.log("  EPILOGUE/NOCAP: sub-cap counter left unchanged, identical to oracle");
});

// -- 3. TAMPER/CLIMB (skip NOT taken) -----------------------------------------

test("TAMPER/CLIMB: failed check -> climbHunterToLaunchRowThenPromoteGroup climbs (true); oracle == idiomatic; epilogue skipped", () => {
  const o = craftFrom(BASE_TAMPER, { hi: 0x05 });
  const c = craftFrom(BASE_TAMPER, { hi: 0x05 });
  const ro = oracle(o);
  const rc = advanceActorState2AndCapWaveArrival(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  assert.equal(rc, ro, "advanceActorState2AndCapWaveArrival must forward climbHunterToLaunchRowThenPromoteGroup's boolean unchanged");
  assert.equal(rc, true, "climbHunterToLaunchRowThenPromoteGroup climbs -> true (skip not taken)");
  // positive control: the epilogue did NOT run (ring slot still free), so the jp was taken
  assert.equal(c.mem.read8(RING_SLOT), 0x80, "epilogue must be skipped on the tamper branch");
  console.log("  TAMPER/CLIMB: composed idiomatic climbHunterToLaunchRowThenPromoteGroup (true), epilogue skipped");
});

// -- 4. TAMPER/TOP (skip taken) -----------------------------------------------

test("TAMPER/TOP: failed check -> climbHunterToLaunchRowThenPromoteGroup sweeps (false); oracle == idiomatic; sweep ran", () => {
  const o = craftFrom(BASE_TAMPER, { hi: 0x12, seedTrigger: true });
  const c = craftFrom(BASE_TAMPER, { hi: 0x12, seedTrigger: true });
  const ro = oracle(o);
  const rc = advanceActorState2AndCapWaveArrival(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  assert.equal(rc, ro, "advanceActorState2AndCapWaveArrival must forward climbHunterToLaunchRowThenPromoteGroup's boolean unchanged");
  assert.equal(rc, false, "climbHunterToLaunchRowThenPromoteGroup reaches the top -> false (skip taken)");
  assert.equal(c.mem.read8(ENEMY_ACTOR_TABLE + 0x02), 0x12, "the sweep must transition the seeded record");
  console.log("  TAMPER/TOP: composed idiomatic climbHunterToLaunchRowThenPromoteGroup (false), sweep transitioned the record");
});

// -- 5. BRANCH-LIVE (positive control) ----------------------------------------

test("BRANCH-LIVE: the checksum truly selects the branch (intact sum==1, tampered!=1, RAM differs)", () => {
  assert.equal(romSum(ROM), 1, "intact ROM must sum to 1 (checksum passes -> epilogue)");
  assert.notEqual(romSum(TAMPERED_ROM), 1, "tampered ROM must not sum to 1 (checksum fails -> jp)");
  // Same seatings, different ROM: the idiomatic run must land in different RAM (branch is live).
  const intact = craftFrom(BASE, { hi: 0x05 });
  const tamper = craftFrom(BASE_TAMPER, { hi: 0x05 });
  advanceActorState2AndCapWaveArrival(intact);
  advanceActorState2AndCapWaveArrival(tamper);
  const d = ramDiffMinusStack(intact, tamper);
  assert.notEqual(d, null, "intact vs tampered must diverge — else the checksum branch is dead");
  console.log(`  BRANCH-LIVE: intact/tampered diverge at ${hx(d.addr ?? 0)} (epilogue vs jp)`);
});

// -- 6. TEETH -----------------------------------------------------------------

test("TEETH: a wrong painted tile byte is CAUGHT by the RAM diff", () => {
  const o = craftFrom(BASE, { counter: 0x09 });
  const c = craftFrom(BASE, { counter: 0x09 });
  oracle(o);
  advanceActorState2AndCapWaveArrival(c);
  c.mem.write8(STATE2_TILE_PAINT_VRAM + 1, 0x00); // BUG: the middle tile must be 0xbc

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong tile byte — it is worthless");
  assert.equal(d.addr, STATE2_TILE_PAINT_VRAM + 1, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong tile byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
