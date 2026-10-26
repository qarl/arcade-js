// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loadSoundVoiceSlots (ROM 0xccc7-0xcce9) -- registers sound id A: saves caller X/Y to $31/$32,
// then over 16 slots (X=0x0f..0, table cursor $cb01+id counting down with the slot) the first nonzero table
// byte claims that slot ($bf, $c0,x, $e0,x, $f0,x) and $bf is reset to 0xff. X/Y are restored from $31/$32.
// Register inputs A/X/Y become params defaulting to m.regs; live-out is memory only. A leaf: the module
// omits the ROM ret and the seam completes it, so the arms compare RAM (-stack), NOT pc/SP.
// Run: node --test games/tempest/idiomatic/test/equivalence-ccc7.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_ccc7 } from "../../translated/loc_ccc7.js";
import { loadSoundVoiceSlots } from "../loadSoundVoiceSlots.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_31, loc_32 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xccc7;
const oracle = atEntry(loc_ccc7);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xccc7 dispatches -- loadSoundVoiceSlots == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); loadSoundVoiceSlots(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: caller X/Y land in $31/$32 and the slot scan matches", () => {
  const seed = (m) => {
    m.regs.a = 0x20;   // sound id
    m.regs.x = 0x5a;   // caller X -> $31
    m.regs.y = 0x3c;   // caller Y -> $32
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); loadSoundVoiceSlots(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after registration");
  assert.equal(c.mem.read8(loc_31), 0x5a, "$31 = caller X");
  assert.equal(c.mem.read8(loc_32), 0x3c, "$32 = caller Y");
});

test("TEETH: a twin that skips the $31 save diverges from the oracle", () => {
  const seed = (m) => {
    m.regs.a = 0x20;
    m.regs.x = 0x5a;   // non-default so the missing save shows
    m.regs.y = 0x3c;
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const brokenCcc7 = (m, a = m.regs.a, x = m.regs.x, y = m.regs.y) => {
    const mem = m.mem8;
    // BUG: never writes caller X to $31
    mem[loc_32] = y & 0xff;
    void a; void x;
  };
  brokenCcc7(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the skipped $31 save");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, loadSoundVoiceSlots, TARGET, m);
  assert.equal(r.placeable, true, `loadSoundVoiceSlots must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
