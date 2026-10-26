// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for serviceTimerBank (ROM 0x26fd) -- scans the 14 countdown-timer bytes 0x34..0x41
// (X 13..0): a byte == 0xF9 re-arms the master timer (0x41 <- 0xD7 EOR 0xEF, only at the master slot and
// while 0x43 & 0xAF is clear); a byte >= 0xFA is decremented in place. After the scan, when 0x43 & 0xAF is
// nonzero, every 4th frame (0x00 & 0x03 == 0) and while 0x43 < 0x28, it advances 0x43 and, on the 0x27->
// 0x28 step, arms 0xDA=0x00 / 0xDB=0x04. All effects are in work RAM (in dumpState); the RAM diff is the
// primary check. Clean omitted-ret leaf, seam-placeable.
// Run: node --test games/centiped/idiomatic/test/equivalence-26fd.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_26fd as oracleRom } from "../../translated/loc_26fd.js";
import { serviceTimerBank } from "../serviceTimerBank.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_34, loc_41, loc_43, loc_d7, loc_ef, FIELD_SCAN_PTR_LO, FIELD_SCAN_PTR_HI, loc_00 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x26fd;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

// A pristine crafted machine: a real 6502 caller-return seated in dead scratch, the timer bank + control
// cells zeroed, and 0xDA/0xDB pre-loaded with a sentinel so a wrap-arm actually changes them.
function craftBase() {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.push16(0x2000);
  for (let a = loc_34; a <= loc_41; a++) m.mem.write8(a, 0x00);
  m.mem.write8(loc_43, 0x00);
  m.mem.write8(loc_00, 0x00);
  m.mem.write8(loc_d7, 0x00);
  m.mem.write8(loc_ef, 0x00);
  m.mem.write8(FIELD_SCAN_PTR_LO, 0xaa);
  m.mem.write8(FIELD_SCAN_PTR_HI, 0xaa);
  return m;
}

test("CAPTURE: real 0x26fd dispatches -- serviceTimerBank == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); serviceTimerBank(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED reload: master slot re-arms 0x41 and a live timer is decremented", () => {
  const set = (m) => {
    m.mem.write8(loc_41, 0xf9);          // master slot (X==0x0D): 0xF9 -> re-arm, no decrement
    m.mem.write8((loc_34 + 4) & 0xff, 0xfc); // live timer -> 0xfb
    m.mem.write8((loc_34 + 6) & 0xff, 0xfa); // live timer -> 0xf9
    m.mem.write8(loc_43, 0x00);          // 0x43 & 0xAF == 0 -> reload allowed; post-scan returns
    m.mem.write8(loc_d7, 0x12);
    m.mem.write8(loc_ef, 0x34);          // reload value = 0x12 ^ 0x34 = 0x26
  };
  const o = craftBase(), c = craftBase();
  set(o); set(c);
  oracle(o); serviceTimerBank(c);
  assert.equal(ramDiff(o, c), null, "reload path RAM (-stack) mismatch");
  assert.equal(c.mem.read8(loc_41), 0x26, "master timer reloaded to D7^EF");
  assert.equal(c.mem.read8((loc_34 + 4) & 0xff), 0xfb, "live timer decremented");
  assert.equal(c.mem.read8((loc_34 + 6) & 0xff), 0xf9, "live timer decremented to marker");
});

test("CRAFTED wrap: 0x43 advances 0x27->0x28 and arms 0xDA/0xDB", () => {
  const set = (m) => {
    m.mem.write8(loc_43, 0x27); // & 0xAF != 0 -> active; < 0x28; old == 0x27 -> wrap fires
    m.mem.write8(loc_00, 0x00); // & 0x03 == 0 -> this frame advances
  };
  const o = craftBase(), c = craftBase();
  set(o); set(c);
  oracle(o); serviceTimerBank(c);
  assert.equal(ramDiff(o, c), null, "wrap path RAM (-stack) mismatch");
  assert.equal(c.mem.read8(loc_43), 0x28, "counter advanced to 0x28");
  assert.equal(c.mem.read8(FIELD_SCAN_PTR_LO), 0x00, "0xDA armed");
  assert.equal(c.mem.read8(FIELD_SCAN_PTR_HI), 0x04, "0xDB armed");
});

// A broken twin that reproduces the scan but DROPS the master re-arm reload of 0x41.
function serviceTimerBank_droppedReload(m) {
  const mem = m.mem;
  for (let x = 0x0d; x >= 0; x--) {
    const cell = (0x34 + x) & 0xff;
    const y = mem.read8(cell);
    if (y < 0xf9) continue;
    if (y >= 0xfa) mem.write8(cell, (y - 1) & 0xff);
    // BUG: dropped `if (armMaster && x==0x0d && (mem[0x43]&0xaf)==0) mem[0x41] = mem[0xd7]^mem[0xef];`
  }
  if ((mem.read8(0x43) & 0xaf) === 0) return;
  if ((mem.read8(0x00) & 0x03) !== 0) return;
  const counter = mem.read8(0x43);
  if (counter >= 0x28) return;
  mem.write8(0x43, (counter + 1) & 0xff);
  if (counter !== 0x27) return;
  mem.write8(0xda, 0x00); mem.write8(0xdb, 0x04);
}

test("TEETH: a twin that skips the master re-arm diverges in RAM", () => {
  const set = (m) => {
    m.mem.write8(loc_41, 0xf9);
    m.mem.write8(loc_43, 0x00);
    m.mem.write8(loc_d7, 0x12);
    m.mem.write8(loc_ef, 0x34);
  };
  const o = craftBase(), c = craftBase();
  set(o); set(c);
  oracle(o); serviceTimerBank_droppedReload(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a dropped master re-arm");
  assert.equal(d.addr, loc_41 & 0xffff);
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const r = seamPlaceable(withOmittedRet, serviceTimerBank, TARGET, craftBase());
  assert.equal(r.placeable, true, `serviceTimerBank must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
