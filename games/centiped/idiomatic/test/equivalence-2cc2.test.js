// SPDX-License-Identifier: GPL-3.0-only
// Memory+carry equivalence for armSlotState (ROM 0x2cc2) -- when entry carry is CLEAR it arms
// loc_87/loc_43/loc_34,X/loc_42 (+SFX_TIMER_CH1_PRIORITY unless loc_86 is negative) and zeroes loc_b2..SFX_TIMER_CH4/loc_b8,
// returning carry CLEAR; when entry carry is SET it is a no-op (the ROM's BCS bail to a bare RTS),
// leaving carry SET. The arms assert BOTH the RAM diff (-stack) AND the carry, since the entry carry is
// consumed and the clear/preserve is a LIVE-OUT the RAM diff cannot see. It is a leaf (omits the ROM
// ret; the seam completes it).
// Run: node --test games/centiped/idiomatic/test/equivalence-2cc2.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2cc2 as oracleRom } from "../../translated/loc_2cc2.js";
import { armSlotState } from "../armSlotState.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  loc_34, loc_42, loc_43, loc_86, loc_87,
  loc_b2, SFX_TIMER_CH2, SFX_TIMER_CH3, SFX_TIMER_CH4, SFX_TIMER_CH1_PRIORITY, loc_b8,
} from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2cc2;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

function make(seed) {
  const m = new Machine(ROM);
  m.push16(0x1233); // a real caller-return word (the oracle's ret pops it; compared as the entry frame)
  seed(m);
  return m;
}

test("CAPTURE: real 0x2cc2 dispatches -- armSlotState == oracle in RAM (-stack) and carry", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); armSlotState(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(o.regs.fC, c.regs.fC, "carry (arm vs bail) must match the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: each branch leaves identical RAM (-stack) and identical carry", () => {
  const cases = [
    {
      tag: "arm path (carry clear, loc_86 >= 0) -> arms every field incl SFX_TIMER_CH1_PRIORITY, carry CLEAR",
      carry: false, x: 0x03,
      seed: (m) => { m.mem.write8(loc_86, 0x00); },
      expectCarry: false,
    },
    {
      tag: "arm path (carry clear, loc_86 negative) -> arms all EXCEPT SFX_TIMER_CH1_PRIORITY, carry CLEAR",
      carry: false, x: 0x03,
      seed: (m) => { m.mem.write8(loc_86, 0x80); m.mem.write8(SFX_TIMER_CH1_PRIORITY, 0x99); }, // SFX_TIMER_CH1_PRIORITY must stay 0x99
      expectCarry: false,
    },
    {
      tag: "bail path (carry set) -> no writes, carry preserved SET",
      carry: true, x: 0x03,
      // Pre-seed the armed cells to non-zero: neither side may touch them on the bail path.
      seed: (m) => {
        m.mem.write8(loc_87, 0xaa); m.mem.write8(loc_43, 0xbb); m.mem.write8(loc_42, 0xcc);
        m.mem.write8((loc_34 + 0x03) & 0xff, 0xdd); m.mem.write8(loc_86, 0x00);
        m.mem.write8(loc_b2, 0x11); m.mem.write8(SFX_TIMER_CH1_PRIORITY, 0x22); m.mem.write8(loc_b8, 0x33);
      },
      expectCarry: true,
    },
    {
      tag: "arm path with a high slot index (loc_34,X wraps zero-page)",
      carry: false, x: 0xf0,
      seed: (m) => { m.mem.write8(loc_86, 0x00); },
      expectCarry: false,
    },
  ];
  for (const { tag, carry, x, seed, expectCarry } of cases) {
    const setup = (m) => { m.regs.fC = carry; m.regs.x = x; seed(m); };
    const o = make(setup);
    const c = make(setup);
    oracle(o); armSlotState(c);
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(o.regs.fC, c.regs.fC, `${tag}: oracle vs idiomatic carry`);
    assert.equal(c.regs.fC, expectCarry, `${tag}: expected carry`);
  }
});

test("TEETH: a twin that skips zeroing SFX_TIMER_CH3 diverges in RAM", () => {
  // Real arm path, one broken op: drops the `SFX_TIMER_CH3 = 0` clear.
  function armSlotState_droppedClear(m, x = m.regs.x, carryIn = m.regs.fC) {
    if (carryIn) return;
    const { mem8 } = m;
    mem8[loc_87] = 0x30; mem8[loc_43] = 0x20; mem8[(loc_34 + x) & 0xff] = 0xff; mem8[loc_42] = 0x28;
    if ((mem8[loc_86] & 0x80) === 0) mem8[SFX_TIMER_CH1_PRIORITY] = 0x13;
    mem8[loc_b2] = 0x00; mem8[SFX_TIMER_CH2] = 0x00; /* BUG: dropped SFX_TIMER_CH3 = 0 */ mem8[SFX_TIMER_CH4] = 0x00; mem8[loc_b8] = 0x00;
    return (m.regs.fC = false);
  }
  const setup = (m) => { m.regs.fC = false; m.regs.x = 0x03; m.mem.write8(loc_86, 0x00); m.mem.write8(SFX_TIMER_CH3, 0x77); };
  const o = make(setup); const c = make(setup);
  oracle(o); armSlotState_droppedClear(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a dropped SFX_TIMER_CH3 clear");
  assert.equal(d.addr, SFX_TIMER_CH3 & 0xffff);
});

test("TEETH: a twin that arms SFX_TIMER_CH1_PRIORITY unconditionally diverges on the loc_86-negative case", () => {
  // Broken twin: drops the `loc_86 >= 0` guard, so it arms SFX_TIMER_CH1_PRIORITY even when loc_86 is negative.
  function armSlotState_unconditionalB7(m, x = m.regs.x, carryIn = m.regs.fC) {
    if (carryIn) return;
    const { mem8 } = m;
    mem8[loc_87] = 0x30; mem8[loc_43] = 0x20; mem8[(loc_34 + x) & 0xff] = 0xff; mem8[loc_42] = 0x28;
    mem8[SFX_TIMER_CH1_PRIORITY] = 0x13; // BUG: no `if ((mem8[loc_86] & 0x80) === 0)` guard
    mem8[loc_b2] = 0x00; mem8[SFX_TIMER_CH2] = 0x00; mem8[SFX_TIMER_CH3] = 0x00; mem8[SFX_TIMER_CH4] = 0x00; mem8[loc_b8] = 0x00;
    return (m.regs.fC = false);
  }
  const setup = (m) => { m.regs.fC = false; m.regs.x = 0x03; m.mem.write8(loc_86, 0x80); m.mem.write8(SFX_TIMER_CH1_PRIORITY, 0x99); };
  const o = make(setup); const c = make(setup);
  oracle(o); armSlotState_unconditionalB7(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch an unconditional SFX_TIMER_CH1_PRIORITY arm");
  assert.equal(d.addr, SFX_TIMER_CH1_PRIORITY & 0xffff);
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  // Arm path does no stack work: the seam completes the ret (SP unmoved). No path is a +2 tail-dispatch.
  const m = make((mm) => { mm.regs.fC = false; mm.regs.x = 0x03; mm.mem.write8(loc_86, 0x00); });
  const r = seamPlaceable(withOmittedRet, armSlotState, TARGET, m);
  assert.equal(r.placeable, true, `armSlotState must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
