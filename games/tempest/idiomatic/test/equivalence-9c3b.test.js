// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for setFlagFromPhaseAccumulatorSign (ROM 0x9c3b-0x9c4e) -- derives $010c from the $0147/$0148 pair:
// $010c = (((($0147 << 2) + $0148) & $0148) & $80) ^ $80. Live-out is memory only (A/flags at RTS are
// incidental), so each side runs on a clone and the contract is RAM (dumpState, minus stack scratch below the entry SP). A
// leaf: the module omits the ROM ret and the seam completes it, so the arms compare RAM (-stack), NOT pc/SP.
// Run: node --test games/tempest/idiomatic/test/equivalence-9c3b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9c3b } from "../../translated/loc_9c3b.js";
import { setFlagFromPhaseAccumulatorSign } from "../setFlagFromPhaseAccumulatorSign.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { ENEMY_ANIM_DELTA, ENEMY_ANIM_ACCUM, SCRIPT_BRANCH_FLAG } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9c3b;
const oracle = atEntry(loc_9c3b);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// Reference for the crafted expectation: the exact byte the ROM lands at $010c.
const expect = (v147, v148) => ((((((v147 << 2) & 0xff) + v148) & 0xff) & v148 & 0x80) ^ 0x80) & 0xff;

test("CAPTURE: real 0x9c3b dispatches -- setFlagFromPhaseAccumulatorSign == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); setFlagFromPhaseAccumulatorSign(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: $010c = high bit of ((($0147<<2)+$0148)&$0148), inverted", () => {
  const cases = [
    { c147: 0x00, c148: 0x00 }, // product 0 -> bit7 clear -> 0x80
    { c147: 0x20, c148: 0xa0 }, // (0x80 + 0xa0)=0x120->0x20 & 0xa0 = 0x20; &0x80=0 -> 0x80
    { c147: 0x30, c148: 0xc0 }, // (0xc0 + 0xc0)=0x180->0x80 & 0xc0 = 0x80; &0x80=0x80 -> 0x00
    { c147: 0xff, c148: 0xff }, // ((0xfc)+0xff)=0x1fb->0xfb & 0xff = 0xfb; &0x80=0x80 -> 0x00
    { c147: 0x11, c148: 0x50 }, // (0x44 + 0x50)=0x94 & 0x50 = 0x10; &0x80=0 -> 0x80
  ];
  for (const { c147, c148 } of cases) {
    const seed = (m) => { m.mem.write8(ENEMY_ANIM_DELTA, c147); m.mem.write8(ENEMY_ANIM_ACCUM, c148); m.mem.write8(SCRIPT_BRANCH_FLAG, 0x99); };
    const o = new Machine(ROM, OPTS); seed(o);
    const c = new Machine(ROM, OPTS); seed(c);
    oracle(o); setFlagFromPhaseAccumulatorSign(c);
    const tag = `147=0x${c147.toString(16)} 148=0x${c148.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.mem.read8(SCRIPT_BRANCH_FLAG), expect(c147, c148), `$010c ${tag}`);
  }
});

test("TEETH: a twin that drops the final EOR #$80 diverges from the oracle", () => {
  const c147 = 0x30, c148 = 0xc0; // oracle -> 0x00; a dropped EOR would leave 0x80
  const seed = (m) => { m.mem.write8(ENEMY_ANIM_DELTA, c147); m.mem.write8(ENEMY_ANIM_ACCUM, c148); m.mem.write8(SCRIPT_BRANCH_FLAG, 0x99); };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken9c3b = (m) => {
    const mem = m.mem8;
    let a = (mem[ENEMY_ANIM_DELTA] << 2) & 0xff;
    a = (a + mem[ENEMY_ANIM_ACCUM]) & 0xff;
    a = a & mem[ENEMY_ANIM_ACCUM] & 0x80; // BUG: no final ^ 0x80
    mem[SCRIPT_BRANCH_FLAG] = a;
  };
  broken9c3b(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the dropped EOR");
  assert.equal(d.addr, SCRIPT_BRANCH_FLAG & 0xffff);
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, setFlagFromPhaseAccumulatorSign, TARGET, m);
  assert.equal(r.placeable, true, `setFlagFromPhaseAccumulatorSign must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
