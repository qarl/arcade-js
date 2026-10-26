// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for resolveOddRoundCollisionAndAward (ROM 0x61b4, Pooyan) — the collision handler. It finds the
 * target slot whose tag matches the record; a busy slot or no match falls back to the proximity
 * gate. A matched slot dispatches on the high nibble of its state byte; one nibble (and the
 * default) runs the award path, which latches the actor onto the record, steps the round-indexed
 * delta into both the record and the re-found slot, arms the slot, wipes the parity target buffer,
 * plays the sound, then unwinds the caller's frame.
 *
 * SEATING: CALLER-SKIP (DISSOLVE). The oracle's award tail is `pop af; ret` (net +4 SP: it drops
 * the caller's return and lands one frame above). Its other tails `jp` to siblings with SP
 * balanced. The +4 award tail cannot be seated by the withOmittedRet seam, so the routine dissolves
 * to a boolean the caller early-returns on: true = the scan continues, false = a caller-skip must
 * unwind the caller's frame. Compared on RAM (dumpState) minus stack scratch below the entry SP; the register file is
 * not compared. HL/IX/B/IY/I are the param-default bridge.
 *
 * Cases are CRAFTED: a plain boot does not seat this scan/dispatch geometry.
 *
 * Jobs:
 *   1. EQUAL — no match falling through to the proximity hit (finder main, true) and a matched slot
 *      whose nibble runs the award path (false): oracle == module in RAM (−stack) + boolean.
 *   2. WRITE-SET — the award path installs the record animation, arms the re-found slot (state bit4),
 *      and wipes the parity target buffer.
 *   3. TEETH — a wrong animation byte is caught by the RAM diff; a pathA-returns-false twin and an
 *      award-returns-true twin are caught by the boolean check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-61b4.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_61b4 as oracle } from "../../translated/loc_61b4.js";
import { resolveOddRoundCollisionAndAward } from "../resolveOddRoundCollisionAndAward.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const FLIP = 0x881f;
const ROUND = 0x8907;
const EAT = 0x8ae0;
const STRIDE = 0x18;
const TYPE = 0x8d44;
const FLAG_I0 = 0x8d1b;
const REC0 = 0x8c90; //  parity target buffer (I == 0), wiped by the award path
const SOUND_RING_PTR = 0x8a40;
const OBJ = 0x8c50;
const IXA = 0x8840;
const IYA = 0x8848;
const KEY = 0x42;
const MATCH_SLOT = 1; // EAT index carrying the matching tag
const SEED_FIELDS = [0x00, 0x01, 0x02, 0x12, 0x16, 0x17];
const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function seat(m) {
  m.regs.hl = OBJ;
  m.regs.ix = IXA;
  m.regs.iy = IYA;
  m.regs.b = 0x01;
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  m.regs.sp = SP0;
  m.mem.write8(FLIP, 0x01); //   +6 bias
  m.mem.write8(ROUND, 0x00); //  delta index 0
  m.mem.write8(TYPE, 0x02);
  m.mem.write8(IXA + 0, 0);
  m.mem.write8(IXA + 2, 0);
  m.mem.write8(IYA + 0, 6); //   in-range x
  m.mem.write8(IYA + 2, 0);
  for (const off of SEED_FIELDS) m.mem.write8(OBJ + off, 0xee);
  m.mem.write8(OBJ + 0x0a, 0x10); //  delta seed
  m.mem.write8(OBJ + 0x14, KEY); //   the record tag / scan key
  m.mem.write8(SOUND_RING_PTR, 0x43);
  for (let i = 0; i < 6; i++) {
    m.mem.write8(EAT + i * STRIDE + 0x14, (KEY ^ 0x5a) & 0xff);
    m.mem.write8(EAT + i * STRIDE + 0x0b, 0x00);
    m.mem.write8(EAT + i * STRIDE + 0x16, 0x00);
  }
  for (let k = 0; k < 0x18; k++) m.mem.write8(REC0 + k, 0xaa); // pre-fill so the wipe is observable
  return m;
}

function craftPathAHit() {
  // no matching slot -> pathA -> proximity gate -> finder main (no enemy match -> true)
  return seat(BASE.clone());
}
function craftAward() {
  const m = seat(BASE.clone());
  m.mem.write8(EAT + MATCH_SLOT * STRIDE + 0x14, KEY); // matching, non-busy slot...
  m.mem.write8(EAT + MATCH_SLOT * STRIDE + 0x16, 0x40); // ...nibble 0x40 -> award path
  return m;
}

const CASES = [
  { name: "no match -> pathA proximity/main", craft: craftPathAHit, ret: true },
  { name: "matched nibble 0x40 -> award (abort)", craft: craftAward, ret: false },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: resolveOddRoundCollisionAndAward == oracle in RAM (−stack) + boolean", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    const ret = resolveOddRoundCollisionAndAward(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, cfg.ret, `${cfg.name}: boolean must be ${cfg.ret}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack + boolean)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the award path installs the anim, arms the slot (bit4), and wipes the target buffer", () => {
  const m = craftAward();
  oracle(m);
  assert.equal(m.mem.read8(OBJ + 0x0e), 0x00, "award resets the record's frame index");
  assert.equal(m.mem.read8(EAT + MATCH_SLOT * STRIDE + 0x16) & 0x10, 0x10, "award arms the re-found slot (bit4)");
  assert.equal(m.mem.read8(REC0 + 0x05), 0x00, "award wipes the parity target buffer");
  console.log("  WRITE-SET: anim installed, slot armed, target wiped");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong animation byte is CAUGHT by the RAM diff", () => {
  const o = craftAward();
  const c = craftAward();
  oracle(o);
  resolveOddRoundCollisionAndAward(c);
  c.mem.write8(OBJ + 0x0c, (o.mem.read8(OBJ + 0x0c) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted animation byte");
  assert.equal(d.addr, OBJ + 0x0c, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a pathA-returns-false twin and an award-returns-true twin are CAUGHT by the boolean", () => {
  assert.throws(
    () => assert.equal(((m) => (resolveOddRoundCollisionAndAward(m), false))(craftPathAHit()), true),
    "the pathA finder-main must continue -> true",
  );
  assert.throws(
    () => assert.equal(((m) => (resolveOddRoundCollisionAndAward(m), true))(craftAward()), false),
    "the award path must abort -> false",
  );
  console.log("  TEETH(boolean): pathA-false and award-true twins caught");
});
