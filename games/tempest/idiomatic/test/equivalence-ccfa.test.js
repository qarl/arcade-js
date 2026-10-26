// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for requestActiveSoundCue (ROM 0xccfa-0xccfd) -- trampoline: load A=0xaf then tail-jump to loadSoundVoiceSlots
// to register that fixed sound id. The idiomatic dissolves the tail m.call(0xccc7) into a direct
// loadSoundVoiceSlots(m, 0xaf, x, y); X/Y are register inputs -> params defaulting to m.regs. Live-out is memory only.
// A leaf: the module omits the ROM ret and the seam completes it, so arms compare RAM (-stack), NOT pc/SP.
// Run: node --test games/tempest/idiomatic/test/equivalence-ccfa.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_ccfa } from "../../translated/loc_ccfa.js";
import { requestActiveSoundCue } from "../requestActiveSoundCue.js";
import { loadSoundVoiceSlots } from "../loadSoundVoiceSlots.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_31, loc_32, SOUND_VOICE_VALUE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xccfa;
const oracle = atEntry(loc_ccfa);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xccfa dispatches -- requestActiveSoundCue == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); requestActiveSoundCue(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: A=0xaf is registered regardless of caller A, caller X/Y land in $31/$32", () => {
  const seed = (m) => {
    m.regs.a = 0x11;   // caller A -- must be overridden by the fixed 0xaf
    m.regs.x = 0x5a;   // caller X -> $31
    m.regs.y = 0x3c;   // caller Y -> $32
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); requestActiveSoundCue(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after fixed-id registration");
  assert.equal(c.mem.read8(loc_31), 0x5a, "$31 = caller X");
  assert.equal(c.mem.read8(loc_32), 0x3c, "$32 = caller Y");
  assert.equal(c.mem.read8((SOUND_VOICE_VALUE + 1) & 0xffff), 0x50, "sound id 0xaf claimed slot 1");
});

test("TEETH: a twin that forwards caller A (not 0xaf) diverges from the oracle", () => {
  const seed = (m) => {
    m.regs.a = 0x11;   // scans different slots (7,6) than 0xaf (1,0)
    m.regs.x = 0x5a;
    m.regs.y = 0x3c;
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const brokenCcfa = (m, a = m.regs.a, x = m.regs.x, y = m.regs.y) => {
    loadSoundVoiceSlots(m, a, x, y); // BUG: forwards caller A instead of the fixed 0xaf
  };
  brokenCcfa(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the wrong sound id");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, requestActiveSoundCue, TARGET, m);
  assert.equal(r.placeable, true, `requestActiveSoundCue must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
