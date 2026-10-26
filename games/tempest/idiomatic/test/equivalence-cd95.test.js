// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for resetBothPokeyChips -- clears two POKEY control cells + a flag, polls two POKEY RANDOM
// registers for change across five samples (latching $0720 on a change), then reloads the controls to 7
// and zeroes the paired 8-entry arrays $60c0/$60d0/$00c0/$00d0 plus $60c8/$60d8. The stability latch is
// POKEY-timing-coupled: on a fresh (or master-reset) POKEY the polys are frozen, so both arms see stable
// samples and $0720 stays 0 -- so the CRAFTED arm asserts the deterministic RAM cells and leans on CAPTURE
// for the poll. A leaf: the module omits the ROM ret and the seam completes it, so the arms compare RAM
// (dumpState, minus STACK_SCRATCH), NOT pc/SP.
// Run: node --test games/tempest/idiomatic/test/equivalence-cd95.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_cd95 as oracle } from "../../translated/loc_cd95.js";
import { resetBothPokeyChips } from "../resetBothPokeyChips.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { u8, u16 } from "../../../../core/int.js";
import { STACK_SCRATCH, SOUND_VOICE_VALUE, SOUND_VOICE_LEVEL, loc_720, POKEY1_AUDF1, POKEY2_AUDF1 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xcd95;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

const SLOTS = [];
for (let i = 0; i < 8; i++) { SLOTS.push(u8(SOUND_VOICE_VALUE + i), u8(SOUND_VOICE_LEVEL + i)); }

test("CAPTURE: real 0xcd95 dispatches -- resetBothPokeyChips == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); { c.regs.x ^= 0xff; c.regs.y ^= 0xff; // m.regs poisoned: this routine takes no entry X/Y, so its exit must not depend on them
      assert.deepEqual(resetBothPokeyChips(c), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: the $00c0/$00d0 slot arrays and $0720 flag clear to 0 (POKEY frozen on a fresh machine)", () => {
  const seed = (m) => {
    m.mem.write8(loc_720, 0x5c);
    for (let i = 0; i < 8; i++) { m.mem.write8(u8(SOUND_VOICE_VALUE + i), 0xa0 + i); m.mem.write8(u8(SOUND_VOICE_LEVEL + i), 0xb0 + i); }
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); resetBothPokeyChips(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after clear");
  for (const a of SLOTS) assert.equal(c.mem.read8(a), 0x00, `slot 0x${a.toString(16)} cleared`);
  assert.equal(c.mem.read8(loc_720), 0x00, "$0720 cleared");
});

test("TEETH: a twin that leaves the entry-0 slots untouched diverges from the oracle", () => {
  const seed = (m) => {
    m.mem.write8(loc_720, 0x5c);
    for (let i = 0; i < 8; i++) { m.mem.write8(u8(SOUND_VOICE_VALUE + i), 0xa0 + i); m.mem.write8(u8(SOUND_VOICE_LEVEL + i), 0xb0 + i); }
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const brokenCd95 = (m) => {
    const mem = m.mem8;
    mem[loc_720] = 0;
    for (let x = 7; x >= 1; x--) { // BUG: never clears the entry-0 slots ($00c0 / $00d0)
      mem[u16(POKEY1_AUDF1 + x)] = 0; mem[u16(POKEY2_AUDF1 + x)] = 0;
      mem[u8(SOUND_VOICE_VALUE + x)] = 0; mem[u8(SOUND_VOICE_LEVEL + x)] = 0;
    }
  };
  brokenCd95(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped entry-0 stores");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, resetBothPokeyChips, TARGET, m);
  assert.equal(r.placeable, true, `resetBothPokeyChips must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
