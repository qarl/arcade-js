// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for spawnActorOnTimer (ROM 0x2bd9) -- gated by $97/$87, tick the $a0 countdown, and
// on expiry scan $34+Y for a free (negative) slot and spawn there (seed fields, ratchet+reset the timer,
// bump $94,X). A leaf with no register/flag live-out, so the arms compare RAM (dumpState, minus
// stack scratch below the entry SP) only. CAPTURE covers real dispatches (mostly the gated/tick paths during attract), so
// the spawn body is driven by CRAFTED seeds (both POKEY-random variants, the reload ratchet, the
// gate/tick/no-slot branches); TEETH proves the RAM diff catches a twin that drops the reload ratchet.
// Run: node --test games/centiped/idiomatic/test/equivalence-2bd9.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2bd9 as oracleRom } from "../../translated/loc_2bd9.js";
import { spawnActorOnTimer } from "../spawnActorOnTimer.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  loc_87, loc_88, loc_97, SPAWN_TIMER, loc_a1,
  loc_34, loc_44, loc_54, loc_64, loc_74, loc_94, loc_f0,
} from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2bd9;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 2500) : [];

// Seat the spawner: enable/busy gates, countdown $a0, selector $88=x with reload $a1,x, orientation $f0,
// and the 12-slot scan region $34..$3f (one slot forced free/negative). rng stubs the POKEY read so both
// arms see the same value and each random variant is exercised deterministically.
function seed({ a0, slotY, x = 0, a1x = 0x30, f0 = 0x11, rng, enable = 0x01, busy = 0x00 }) {
  const m = new Machine(ROM);
  m.mem.write8(loc_97, enable);
  m.mem.write8(loc_87, busy);
  m.mem.write8(SPAWN_TIMER, a0);
  m.mem.write8(loc_88, x);
  for (let s = 0; s <= 0x0b; s++) m.mem.write8((loc_34 + s) & 0xffff, 0x00);
  if (slotY !== undefined) m.mem.write8((loc_34 + slotY) & 0xffff, 0x80);
  m.mem.write8((loc_a1 + x) & 0xff, a1x);
  m.mem.write8(loc_f0, f0);
  if (rng !== undefined) m.io.pokeyRandom = () => rng;
  return m;
}

test("CAPTURE: real 0x2bd9 dispatches -- spawnActorOnTimer == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); spawnActorOnTimer(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: gate / tick / no-slot / spawn (both POKEY-random variants + reload ratchet)", () => {
  const cases = [
    { name: "disabled", a0: 0, slotY: 0x0b, enable: 0x00 },
    { name: "busy", a0: 0, slotY: 0x0b, busy: 0x01 },
    { name: "tick", a0: 0x05, slotY: 0x0b },              // timer running -> dec only
    { name: "no-slot", a0: 0, slotY: undefined },          // expired, no free slot
    { name: "spawn A reload<0x60", a0: 0, slotY: 0x0b, x: 0, a1x: 0x30, rng: 0x02 },
    { name: "spawn B reload>=0x60", a0: 0, slotY: 0x07, x: 1, a1x: 0x68, rng: 0x00 },
    { name: "spawn A reload>=0x60", a0: 0, slotY: 0x03, x: 2, a1x: 0x60, rng: 0x02 },
  ];
  for (const cs of cases) {
    const o = seed(cs), c = seed(cs);
    oracle(o); spawnActorOnTimer(c);
    assert.equal(ramDiff(o, c), null, cs.name);
  }
});

test("CRAFTED: the spawned slot fields + timer reset match the oracle byte-for-byte", () => {
  // reload 0x68 >= 0x60 -> ratchet to 0x60; rng bit clear -> variant B ($54=0x04, $44=0xfe).
  const cs = { a0: 0, slotY: 0x07, x: 1, a1x: 0x68, f0: 0x11, rng: 0x00 };
  const c = seed(cs);
  spawnActorOnTimer(c);
  const y = 0x07, x = 1;
  assert.equal(c.mem.read8((loc_34 + y) & 0xffff), 0x00, "slot claimed");
  assert.equal(c.mem.read8((loc_64 + y) & 0xffff), 0x40 ^ 0x11, "$64+Y orientation-folded");
  assert.equal(c.mem.read8((loc_54 + y) & 0xffff), 0x04, "$54+Y variant-B override");
  assert.equal(c.mem.read8((loc_44 + y) & 0xffff), 0xfe, "$44+Y variant-B value");
  assert.equal(c.mem.read8((loc_74 + y) & 0xffff), 0x02, "$74+Y seed");
  assert.equal(c.mem.read8((loc_a1 + x) & 0xff), 0x60, "reload ratcheted down by 8");
  assert.equal(c.mem.read8(SPAWN_TIMER), 0x60, "timer reset to the ratcheted reload");
  assert.equal(c.mem.read8((loc_94 + x) & 0xff), 0x01, "$94,X spawn counter bumped");

  // rng bit set -> variant A: $54 keeps 0xfc, $44 = 0x02.
  const csA = { a0: 0, slotY: 0x05, x: 3, a1x: 0x30, f0: 0x00, rng: 0x02 };
  const cA = seed(csA);
  spawnActorOnTimer(cA);
  assert.equal(cA.mem.read8((loc_54 + 0x05) & 0xffff), 0xfc, "$54+Y variant-A keeps 0xfc");
  assert.equal(cA.mem.read8((loc_44 + 0x05) & 0xffff), 0x02, "$44+Y variant-A value");
  assert.equal(cA.mem.read8((loc_a1 + 3) & 0xff), 0x30, "reload <0x60 not ratcheted");
});

test("TEETH: a twin that drops the reload ratchet mis-sets the timer / reload", () => {
  // Broken twin: real spawn body but stores the raw reload (no `>= 0x60 -> -8` ratchet).
  const brokenNoRatchet = (mm) => {
    const { mem8 } = mm;
    if (mem8[loc_97] === 0) return;
    if (mem8[loc_87] !== 0) return;
    if (mem8[SPAWN_TIMER] !== 0) { mem8[SPAWN_TIMER] = (mem8[SPAWN_TIMER] - 1) & 0xff; return; }
    const x = mem8[loc_88];
    let y = -1;
    for (let s = 0x0b; s >= 0; s--) { if (mem8[(loc_34 + s) & 0xffff] & 0x80) { y = s; break; } }
    if (y < 0) return;
    mem8[(loc_34 + y) & 0xffff] = 0x00;
    mem8[(loc_64 + y) & 0xffff] = 0x40 ^ mem8[loc_f0];
    mem8[(loc_54 + y) & 0xffff] = 0xfc;
    mem8[(loc_74 + y) & 0xffff] = 0x02;
    const reload = mem8[(loc_a1 + x) & 0xff]; // BUG: no ratchet, no write-back
    mem8[SPAWN_TIMER] = reload;
    if (mem8[0x100a] & 0x02) mem8[(loc_44 + y) & 0xffff] = 0x02;
    else { mem8[(loc_54 + y) & 0xffff] = 0x04; mem8[(loc_44 + y) & 0xffff] = 0xfe; }
    mem8[(loc_94 + x) & 0xff] = (mem8[(loc_94 + x) & 0xff] + 1) & 0xff;
  };
  const cs = { a0: 0, slotY: 0x07, x: 1, a1x: 0x68, rng: 0x00 };
  const o = seed(cs), c = seed(cs);
  oracle(o); brokenNoRatchet(c);
  assert.notEqual(ramDiff(o, c), null, "the gate FAILED to catch the dropped reload ratchet");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.mem.write16(0x0100 | ((m.regs.s + 1) & 0xff), 0xabcd); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, spawnActorOnTimer, TARGET, m);
  assert.equal(r.placeable, true, `spawnActorOnTimer must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
