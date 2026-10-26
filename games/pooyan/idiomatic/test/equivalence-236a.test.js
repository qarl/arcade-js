// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for movePlayerDownAndTickStatusRender (ROM 0x236a, Pooyan) — the descent half of the
 * direction-split actor handler at IX. While aim bit 3 is set it steps the actor's vertical
 * position down (inc), clamps it at the floor 0xc0, refreshes the three stacked sprite Ys, and
 * then — once the animation cursor's low byte reaches its end marker 0xf6 — runs the shared
 * phase-advance + render tail only while a tamper strike is recorded or the colour-parity sum
 * is nonzero; otherwise it holds.
 *
 * movePlayerDownAndTickStatusRender is a void handler (no register live-out): the module calls the idiomatic siblings
 * directly, the oracle drives the translated siblings through the routines map, so equivalence
 * is RAM (dumpState) minus stack scratch below the entry SP. SP is parked in STACK_SCRATCH so nested pushes drop
 * out of the diff. The render ring is seeded so the render tail returns before the blit.
 *
 * Jobs:
 *   1. EQUAL — inactive (early hold), active with the cursor mid-script (tail), cursor at the end
 *      marker armed by a strike / by nonzero parity (tail), the same disarmed (hold), and the
 *      floor-clamp path: oracle == module in RAM (−stack).
 *   2. EFFECTS — the module lands the inc/clamp + derived sprite Ys, and the hold and tail paths
 *      leave the render ring observably different (positive control the branch is real).
 *   3. TEETH — a wrong POS byte is caught by the RAM diff; a gate-ignoring twin (inc while
 *      inactive) and a clamp-skipping twin are caught at POS.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-236a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_236a as oracle } from "../../translated/loc_236a.js";
import { movePlayerDownAndTickStatusRender } from "../movePlayerDownAndTickStatusRender.js";
import { Machine } from "../../machine.js";
import { u8 } from "../../../../core/int.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ACTOR_TABLE,
  TILE_ANIM_CURSOR,
  TAMPER_STRIKES_SIG,
  TILE_ANIM_PARITY,
  STATUS_RENDER_RING,
  loc_8083,
  loc_8343,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const POS = (ACTOR_TABLE + 0x04) & 0xffff; //  actor vertical position (== PLAYER_Y)
const AIM = (ACTOR_TABLE + 0x07) & 0xffff; //  aim/direction flags
const SLOT3 = (ACTOR_TABLE + 0x4c) & 0xffff;
const SLOT2 = (ACTOR_TABLE + 0x34) & 0xffff;
const SLOT1 = (ACTOR_TABLE + 0x1c) & 0xffff;
const ACTIVE = 0x08; //   aim bit 3
const SP0 = 0x8ff0; //    inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat IX at the player actor and lay down every cell movePlayerDownAndTickStatusRender and its tail read. */
function seat(m, { aim = ACTIVE, pos = 0x50, cursor = 0x8500, tamper = 0x00, p83 = 0x00, p43 = 0x00 } = {}) {
  m.regs.ix = ACTOR_TABLE;
  m.regs.sp = SP0;
  m.mem.write8(AIM, aim);
  m.mem.write8(POS, pos);
  m.mem.write16(TILE_ANIM_CURSOR, cursor); // low byte gates movePlayerDownAndTickStatusRender; the word is the tail's script ptr
  m.mem.write8(TAMPER_STRIKES_SIG + 0, tamper & 0xff);
  m.mem.write8(TAMPER_STRIKES_SIG + 1, 0x00);
  m.mem.write8(TAMPER_STRIKES_SIG + 2, 0x00);
  m.mem.write8(loc_8083, p83);
  m.mem.write8(loc_8343, p43);
  m.mem.write8(STATUS_RENDER_RING, 0x03); // dec -> 2, nonzero: render tail returns before the blit
  m.mem.write8(TILE_ANIM_PARITY, 0x00);
  for (const s of [SLOT1, SLOT2, SLOT3]) m.mem.write8(s, 0xaa); // dirt to prove the derive runs
  return m;
}

const END = 0x85f6; //  cursor word whose low byte is the end marker 0xf6
const MID = 0x8500; //  cursor word whose low byte (0x00) is mid-script

const CASES = [
  { name: "inactive -> hold", opts: { aim: 0x00 } },
  { name: "active, cursor mid-script -> tail", opts: { cursor: MID } },
  { name: "active, cursor at end + strike -> tail", opts: { cursor: END, tamper: 0x01 } },
  { name: "active, cursor at end + parity -> tail", opts: { cursor: END, p83: 0x03, p43: 0x05 } },
  { name: "active, cursor at end, disarmed -> hold", opts: { cursor: END } },
  { name: "active, floor clamp -> tail", opts: { cursor: MID, pos: 0xd0 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: every path — module == oracle in RAM (−stack)", () => {
  for (const { name, opts } of CASES) {
    const o = seat(BASE.clone(), opts);
    const c = seat(BASE.clone(), opts);
    oracle(o);
    movePlayerDownAndTickStatusRender(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} paths identical (RAM −stack)`);
});

// -- 2. EFFECTS (positive control) --------------------------------------------

test("EFFECTS: inc/clamp + derived sprite Ys land; hold and tail differ at the render ring", () => {
  // inactive: nothing moves.
  let m = seat(BASE.clone(), { aim: 0x00 });
  movePlayerDownAndTickStatusRender(m);
  assert.equal(m.mem.read8(POS), 0x50, "inactive: POS untouched");
  assert.equal(m.mem.read8(SLOT3), 0xaa, "inactive: derive did not run");

  // active: POS steps down, the three sprite Ys derive off it.
  m = seat(BASE.clone(), { cursor: MID, pos: 0x50 });
  movePlayerDownAndTickStatusRender(m);
  assert.equal(m.mem.read8(POS), 0x51, "active: POS incremented");
  assert.equal(m.mem.read8(SLOT3), 0x51, "slot3 = base Y");
  assert.equal(m.mem.read8(SLOT2), 0x41, "slot2 = base Y - 0x10");
  assert.equal(m.mem.read8(SLOT1), 0x4b, "slot1 = base Y - 0x06");

  // clamp: inc past the floor lands exactly at the floor.
  m = seat(BASE.clone(), { cursor: MID, pos: 0xd0 });
  movePlayerDownAndTickStatusRender(m);
  assert.equal(m.mem.read8(POS), 0xc0, "clamp: POS pinned to the floor");

  // the hold path leaves the render ring; the tail path decrements it.
  const held = seat(BASE.clone(), { cursor: END });
  const tailed = seat(BASE.clone(), { cursor: MID });
  movePlayerDownAndTickStatusRender(held);
  movePlayerDownAndTickStatusRender(tailed);
  assert.equal(held.mem.read8(STATUS_RENDER_RING), 0x03, "hold: render ring untouched");
  assert.notEqual(tailed.mem.read8(STATUS_RENDER_RING), 0x03, "tail: render ring advanced");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong POS byte is CAUGHT by the RAM diff", () => {
  const o = seat(BASE.clone(), { cursor: MID });
  const c = seat(BASE.clone(), { cursor: MID });
  oracle(o);
  movePlayerDownAndTickStatusRender(c);
  c.mem.write8(POS, (c.mem.read8(POS) ^ 0x01) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong POS — it is worthless");
  assert.equal(d.addr, POS, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a gate-ignoring twin and a clamp-skipping twin are CAUGHT at POS", () => {
  const incNoGate = (m) => { m.mem.write8(POS, u8(m.mem.read8(POS) + 1)); }; // wrong: ignores the active gate / clamp

  // gate: oracle holds (inactive), the twin steps POS anyway.
  let o = seat(BASE.clone(), { aim: 0x00 });
  let c = seat(BASE.clone(), { aim: 0x00 });
  oracle(o);
  incNoGate(c);
  let d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "gate twin not caught");
  assert.equal(d.addr, POS, `gate twin caught wrong address ${hx(d.addr ?? 0)}`);

  // clamp: oracle pins POS to the floor (disarmed hold, so no tail cells confuse the diff), the twin overshoots.
  o = seat(BASE.clone(), { cursor: END, pos: 0xd0 });
  c = seat(BASE.clone(), { cursor: END, pos: 0xd0 });
  oracle(o);
  incNoGate(c);
  d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "clamp twin not caught");
  assert.equal(d.addr, POS, `clamp twin caught wrong address ${hx(d.addr ?? 0)}`);
  console.log("  TEETH(branch): gate-ignoring and clamp-skipping twins caught at POS");
});
