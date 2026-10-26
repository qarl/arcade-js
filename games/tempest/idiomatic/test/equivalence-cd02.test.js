// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for requestMotionFlipSound (ROM 0xcd02-0xcd05) -- seeds the fixed sound id 0x3f then BNE-delegates
// (always taken) into the sound gate. The idiomatic dissolves the m.call(0xccc3) into requestSoundIfEnabled(m, 0x3f);
// caller X/Y pass through as register inputs. Live-out is memory only (A at RTS is incidental), so arms
// compare RAM (dumpState minus stack scratch below the entry SP). A leaf: the module omits the ROM ret, the seam completes it.
// Run: node --test games/tempest/idiomatic/test/equivalence-cd02.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_cd02 } from "../../translated/loc_cd02.js";
import { requestMotionFlipSound } from "../requestMotionFlipSound.js";
import { loadSoundVoiceSlots } from "../loadSoundVoiceSlots.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { STATUS_FLAGS, loc_31, loc_32 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xcd02;
const oracle = atEntry(loc_cd02);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xcd02 dispatches -- requestMotionFlipSound == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); requestMotionFlipSound(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED gate-open: bit7 of $05 set -> sound 0x3f registers via the dissolved call", () => {
  const seed = (m) => {
    m.mem.write8(STATUS_FLAGS, 0x80);   // enable flag high bit set
    m.regs.x = 0x5a;             // caller X -> $31
    m.regs.y = 0x3c;             // caller Y -> $32
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); requestMotionFlipSound(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after gated registration");
  assert.equal(c.mem.read8(loc_31), 0x5a, "$31 = caller X (call fired)");
  assert.equal(c.mem.read8(loc_32), 0x3c, "$32 = caller Y (call fired)");
});

test("CRAFTED gate-closed: bit7 of $05 clear -> nothing registers", () => {
  const seed = (m) => {
    m.mem.write8(STATUS_FLAGS, 0x00);   // gate closed
    m.regs.x = 0x5a;
    m.regs.y = 0x3c;
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); requestMotionFlipSound(c);
  assert.equal(ramDiff(o, c), null, "RAM equal when gate blocks");
  assert.equal(c.mem.read8(loc_31), 0x00, "$31 untouched (gate blocked the call)");
});

test("TEETH: a twin that seeds the WRONG sound id diverges from the oracle (gate open)", () => {
  const seed = (m) => {
    m.mem.write8(STATUS_FLAGS, 0x80);   // gate open: oracle registers 0x3f
    m.regs.x = 0x5a;
    m.regs.y = 0x3c;
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const brokenCd02 = (m, x = m.regs.x, y = m.regs.y) => {
    loadSoundVoiceSlots(m, 0x00, x, y); // BUG: wrong sound id (0x00 instead of 0x3f)
  };
  brokenCd02(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the wrong sound id");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, requestMotionFlipSound, TARGET, m);
  assert.equal(r.placeable, true, `requestMotionFlipSound must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
