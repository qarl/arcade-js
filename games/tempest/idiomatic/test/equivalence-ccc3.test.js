// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for requestSoundIfEnabled (ROM 0xccc3-0xccc6) -- sound gate: BIT $05, and only when bit7 is set does
// it fall into loadSoundVoiceSlots to register the sound in A (else an inlined RTS). The idiomatic dissolves the tail
// m.call(0xccc7) into a direct loadSoundVoiceSlots(m, a, x, y). A/X/Y are register inputs -> params defaulting to m.regs;
// live-out is memory only. A leaf: the module omits the ROM ret and the seam completes it, so arms compare
// RAM (-stack), NOT pc/SP.
// Run: node --test games/tempest/idiomatic/test/equivalence-ccc3.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_ccc3 } from "../../translated/loc_ccc3.js";
import { requestSoundIfEnabled } from "../requestSoundIfEnabled.js";
import { loadSoundVoiceSlots } from "../loadSoundVoiceSlots.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { STATUS_FLAGS, loc_31, loc_32, SOUND_VOICE_VALUE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xccc3;
const oracle = atEntry(loc_ccc3);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xccc3 dispatches -- requestSoundIfEnabled == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); requestSoundIfEnabled(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED gate-open: bit7 of $05 set -> the sound in A registers via the dissolved call", () => {
  const seed = (m) => {
    m.mem.write8(STATUS_FLAGS, 0x80);   // enable flag high bit set
    m.regs.a = 0x20;             // sound id
    m.regs.x = 0x5a;             // caller X -> $31
    m.regs.y = 0x3c;             // caller Y -> $32
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); requestSoundIfEnabled(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after gated registration");
  assert.equal(c.mem.read8(loc_31), 0x5a, "$31 = caller X (call fired)");
  assert.equal(c.mem.read8(loc_32), 0x3c, "$32 = caller Y (call fired)");
  assert.equal(c.mem.read8((SOUND_VOICE_VALUE + 2) & 0xffff), 0x4a, "sound id 0x20 claimed slot 2");
});

test("CRAFTED gate-closed: bit7 of $05 clear -> nothing registers", () => {
  const seed = (m) => {
    m.mem.write8(STATUS_FLAGS, 0x00);   // gate closed
    m.regs.a = 0x20;
    m.regs.x = 0x5a;
    m.regs.y = 0x3c;
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); requestSoundIfEnabled(c);
  assert.equal(ramDiff(o, c), null, "RAM equal when gate blocks");
  assert.equal(c.mem.read8(loc_31), 0x00, "$31 untouched (gate blocked the call)");
});

test("TEETH: a twin that ignores the gate diverges from the oracle when gate is closed", () => {
  const seed = (m) => {
    m.mem.write8(STATUS_FLAGS, 0x00);   // gate closed: oracle does nothing
    m.regs.a = 0x20;
    m.regs.x = 0x5a;
    m.regs.y = 0x3c;
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const brokenCcc3 = (m, a = m.regs.a, x = m.regs.x, y = m.regs.y) => {
    loadSoundVoiceSlots(m, a, x, y); // BUG: registers unconditionally, ignoring the $05 gate
  };
  brokenCcc3(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the ignored gate");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, requestSoundIfEnabled, TARGET, m);
  assert.equal(r.placeable, true, `requestSoundIfEnabled must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
