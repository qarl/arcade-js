// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for gateSound5f (ROM 0xccb0-0xccb4) -- trampoline: load the fixed sound id 0x5f then tail
// into requestSoundIfEnabled (the $05 bit7 gate). The idiomatic dissolves the JMP into a direct requestSoundIfEnabled(m, 0x5f, x, y).
// X/Y are register inputs -> params defaulting to m.regs, stamped to $31/$32 by the downstream registration;
// live-out is memory only. A leaf: the module omits the ROM ret and the seam completes it, so arms compare
// RAM (-stack), NOT pc/SP.
// Run: node --test games/tempest/idiomatic/test/equivalence-ccb0.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_ccb0 } from "../../translated/loc_ccb0.js";
import { gateSound5f } from "../gateSound5f.js";
import { requestSoundIfEnabled } from "../requestSoundIfEnabled.js";
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

const TARGET = 0xccb0;
const oracle = atEntry(loc_ccb0);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xccb0 dispatches -- gateSound5f == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); gateSound5f(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED gate-open: bit7 of $05 set -> sound 0x5f registers, carrying caller X/Y", () => {
  const seed = (m) => {
    m.mem.write8(STATUS_FLAGS, 0x80);   // enable flag high bit set
    m.regs.x = 0x5a;             // caller X -> $31
    m.regs.y = 0x3c;             // caller Y -> $32
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); gateSound5f(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after gated registration");
  assert.equal(c.mem.read8(loc_31), 0x5a, "$31 = caller X (call fired)");
  assert.equal(c.mem.read8(loc_32), 0x3c, "$32 = caller Y (call fired)");
  assert.equal(c.mem.read8((SOUND_VOICE_VALUE + 1) & 0xffff), 0x1a, "sound id 0x5f claimed slot 1");
});

test("CRAFTED gate-closed: bit7 of $05 clear -> nothing registers", () => {
  const seed = (m) => {
    m.mem.write8(STATUS_FLAGS, 0x00);   // gate closed
    m.regs.x = 0x5a;
    m.regs.y = 0x3c;
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); gateSound5f(c);
  assert.equal(ramDiff(o, c), null, "RAM equal when gate blocks");
  assert.equal(c.mem.read8(loc_31), 0x00, "$31 untouched (gate blocked the tail-call)");
});

test("TEETH id: a twin that registers the wrong id diverges from the oracle", () => {
  const seed = (m) => {
    m.mem.write8(STATUS_FLAGS, 0x80);
    m.regs.x = 0x5a;
    m.regs.y = 0x3c;
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const brokenCcb0 = (m, x = m.regs.x, y = m.regs.y) => requestSoundIfEnabled(m, 0x1f, x, y); // BUG: 0x1f not 0x5f
  brokenCcb0(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong sound id");
});

test("TEETH X/Y: a twin that drops the caller X/Y bridge diverges (non-default seed)", () => {
  const seed = (m) => {
    m.mem.write8(STATUS_FLAGS, 0x80);
    m.regs.x = 0x5a;
    m.regs.y = 0x3c;
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const brokenCcb0 = (m) => requestSoundIfEnabled(m, 0x5f, 0x00, 0x00); // BUG: stale X/Y (0,0) not caller's
  brokenCcb0(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the dropped X/Y bridge");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, gateSound5f, TARGET, m);
  assert.equal(r.placeable, true, `gateSound5f must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
