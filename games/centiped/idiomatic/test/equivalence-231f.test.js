// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for rebuildSegmentSpriteTables (ROM 0x231f) -- rebuild a segment's five 12-entry
// sprite tables (loc_34/loc_44/loc_54/loc_64/loc_74) from the loc_9a/loc_9c/loc_ab counters and the
// loc_43/loc_53/loc_73 descriptor rows, mirroring values via the dissolved loc_382d negate. Live-out is
// RAM only, so each side runs on a clone and the contract is RAM (dumpState, minus stack scratch below the entry SP).
//
// POKEY NOTE -- the step-4 fill loop reads $100A (POKEY_RANDOM) twice per iteration. $100A's value tracks the
// PREVIOUS pokey access's clock, so a clock-free layer matches the oracle's SECOND read only while the
// poly counter is idle (io.pokeyC0 === null -> $100A is the constant t[0]). The real boot dispatches all
// early-exit before the fill loop (0 reads of $100A), so CAPTURE is unaffected; the CRAFTED arm exercises
// the fill loop on a fresh Machine (pokeyC0 null), where both sides read the same constant.
// Run: node --test games/centiped/idiomatic/test/equivalence-231f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_231f as oracleRom } from "../../translated/loc_231f.js";
import { rebuildSegmentSpriteTables } from "../rebuildSegmentSpriteTables.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  loc_88, loc_94, loc_9c, loc_9a, loc_ab, loc_34, loc_00,
  loc_f0, loc_8b, loc_73, loc_43, loc_53, loc_f4, loc_fe, loc_97,
} from "../names.js";
import { stampEntry, deadStackAtEntry, deadStackDeepAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x231f;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x231f dispatches -- rebuildSegmentSpriteTables == oracle in RAM (-stack)", () => {
  assert.ok(CAPS.length > 0, "boot must dispatch 0x231f at least once");
  for (const cap of CAPS) {
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), deadStackDeepAtEntry(0x40, ma, mb));
    const o = cap.clone(), c = cap.clone();
    oracle(o); rebuildSegmentSpriteTables(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// A pristine crafted machine: SP seated on a real caller-return word (nested pushes land in excluded
// scratch), the poly counter idle (pokeyC0 null -> $100A constant), and a broad deterministic pattern in
// the descriptor rows so the copies are observable. `over` places the per-slot counters for the case.
function craft(over) {
  const m = new Machine(ROM);
  m.regs.s = 0xf8;
  m.mem.write8(0x0100 | 0xf9, 0xcc);
  m.mem.write8(0x0100 | 0xfa, 0xab); // caller return = 0xabcd
  m.mem.write8(loc_f0, 0x33);
  m.mem.write8(loc_f4, 0x07);
  m.mem.write8(loc_fe, 0x88);
  m.mem.write8(loc_00, 0x00);
  for (let i = 0; i <= 0x0c; i++) {
    m.mem.write8((loc_43 + i) & 0xff, (i & 1) ? (0x80 | i) : (0x40 + i)); // mix of bit7 set/clear
    m.mem.write8((loc_53 + i) & 0xff, 0x10 + i);
    m.mem.write8((loc_73 + i) & 0xff, 0x70 + i);
  }
  over(m);
  return m;
}

test("CRAFTED: fill-loop / descriptor-loop / counter-refresh paths match the oracle in RAM (-stack)", () => {
  const cases = [
    // fill loop reached directly (length == 1); poly counter idle so $100A is constant on both sides.
    { name: "length==1 -> fill loop", over: (m) => {
        m.mem.write8(loc_88, 0); m.mem.write8((loc_94 + 0) & 0xff, 0xff);
        m.mem.write8((loc_9a + 0) & 0xff, 0x01); m.mem.write8((loc_9c + 0) & 0xff, 0x05);
      } },
    // descriptor loop (length 5) then fill loop (9a != 0x0c); loc_00 bit1 set -> no [0] negate.
    { name: "descriptor loop + fill", over: (m) => {
        m.mem.write8(loc_00, 0x02);
        m.mem.write8(loc_88, 0); m.mem.write8((loc_94 + 0) & 0xff, 0xff);
        m.mem.write8((loc_9a + 0) & 0xff, 0x05); m.mem.write8((loc_9c + 0) & 0xff, 0x03);
      } },
    // step-1 counter refresh runs (94 gate clear, 9c >= 3), then the loops.
    { name: "counter refresh", over: (m) => {
        m.mem.write8(loc_88, 0); m.mem.write8((loc_94 + 0) & 0xff, 0x00);
        m.mem.write8((loc_9c + 0) & 0xff, 0x05); m.mem.write8((loc_9a + 0) & 0xff, 0x03);
        m.mem.write8((loc_ab + 0) & 0xff, 0x02);
      } },
    // descriptor loop ends with 9a == 0x0c -> fill loop skipped (the boot early-exit shape).
    { name: "descriptor loop, fill skipped", over: (m) => {
        m.mem.write8(loc_88, 0); m.mem.write8((loc_94 + 0) & 0xff, 0xff);
        m.mem.write8((loc_9a + 0) & 0xff, 0x0c); m.mem.write8((loc_9c + 0) & 0xff, 0x02);
      } },
  ];
  for (const { name, over } of cases) {
    const o = craft(over), c = craft(over);
    oracle(o); rebuildSegmentSpriteTables(c);
    assert.equal(ramDiff(o, c), null, name);
    assert.equal(c.mem.read8(loc_34), 0x03, `loc_34 [0] entry ${name}`);
    assert.equal(c.mem.read8(loc_97), 0x88, `loc_97 stamp ${name}`);
  }
});

test("TEETH: a twin that drops the step-5 loc_97 stamp diverges in RAM", () => {
  const droppedStamp = (m) => {
    rebuildSegmentSpriteTables(m);
    m.mem8[loc_97] = 0x00; // BUG: as if the final `sta $97` never ran (loc_97 default 0)
  };
  const over = (m) => {
    m.mem.write8(loc_88, 0); m.mem.write8((loc_94 + 0) & 0xff, 0xff);
    m.mem.write8((loc_9a + 0) & 0xff, 0x01); m.mem.write8((loc_9c + 0) & 0xff, 0x05);
  };
  const o = craft(over), c = craft(over);
  oracle(o); droppedStamp(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM-diff check FAILED to catch the dropped loc_97 stamp");
  assert.equal(d.addr, loc_97 & 0xffff);
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const over = (m) => {
    m.mem.write8(loc_88, 0); m.mem.write8((loc_94 + 0) & 0xff, 0xff);
    m.mem.write8((loc_9a + 0) & 0xff, 0x01); m.mem.write8((loc_9c + 0) & 0xff, 0x05);
  };
  const r = seamPlaceable(withOmittedRet, rebuildSegmentSpriteTables, TARGET, craft(over));
  assert.equal(r.placeable, true, `rebuildSegmentSpriteTables must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
