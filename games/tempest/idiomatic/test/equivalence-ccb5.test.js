// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for cueRimRotationSound (ROM 0xccb5-0xccb8) -- loads sound id A=0x0f and tail-calls the sound gate
// (requestSoundIfEnabled), threading the caller's X/Y into $31/$32. The oracle runs the translated requestSoundIfEnabled via m.call;
// the idiomatic calls the idiomatic requestSoundIfEnabled directly with A=0x0f and the caller X/Y. Live-out is memory
// (the sound-slot tables + $31/$32); registers at RTS are incidental, so the contract is RAM (-stack).
// Run: node --test games/tempest/idiomatic/test/equivalence-ccb5.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_ccb5 } from "../../translated/loc_ccb5.js";
import { cueRimRotationSound } from "../cueRimRotationSound.js";
import { requestSoundIfEnabled } from "../requestSoundIfEnabled.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
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

const TARGET = 0xccb5;
const oracle = atEntry(loc_ccb5);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xccb5 dispatches -- cueRimRotationSound == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); cueRimRotationSound(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m) {
  m.mem.write8(STATUS_FLAGS, m.mem.read8(STATUS_FLAGS) | 0x80); // enable the sound gate
  m.regs.x = 0x11;
  m.regs.y = 0x22;
}

test("CRAFTED: X/Y thread into $31/$32 and RAM matches the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); cueRimRotationSound(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after sound registration");
  assert.equal(c.mem.read8(loc_31), 0x11, "$31 = X");
  assert.equal(c.mem.read8(loc_32), 0x22, "$32 = Y");
});

test("TEETH: a twin that threads the wrong X diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  requestSoundIfEnabled(c, 0x0f, 0x99, 0x22); // BUG: X=0x99 instead of the seeded 0x11
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong X thread");
});
