// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for requestLevelIntroSound (ROM 0xccfe-) -- loads sound id 0xbf and requests it through the
// sound gate requestSoundIfEnabled (which, when $0005 bit7 is set, registers via loadSoundVoiceSlots using the live X/Y bridge
// into $0031/$0032). Effect is memory-only, so each side runs on a fresh Machine and the contract is RAM
// (dumpState, minus stack scratch below the entry SP). Leaf-omits the ROM ret; arms compare RAM (-stack), not pc/SP.
// Run: node --test games/tempest/idiomatic/test/equivalence-ccfe.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_ccfe } from "../../translated/loc_ccfe.js";
import { requestLevelIntroSound } from "../requestLevelIntroSound.js";
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

const TARGET = 0xccfe;
const oracle = atEntry(loc_ccfe);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xccfe dispatches -- requestLevelIntroSound == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); requestLevelIntroSound(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: gate enabled -- registers 0xbf, threading live X/Y into $0031/$0032", () => {
  const seed = (m) => { m.mem.write8(STATUS_FLAGS, 0x80); m.regs.x = 0x12; m.regs.y = 0x34; };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); requestLevelIntroSound(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after sound request");
  assert.equal(c.mem.read8(loc_31), 0x12, "X threaded into $0031");
  assert.equal(c.mem.read8(loc_32), 0x34, "Y threaded into $0032");
});

test("TEETH: a twin that drops the live X/Y bridge diverges from the oracle", () => {
  const seed = (m) => { m.mem.write8(STATUS_FLAGS, 0x80); m.regs.x = 0x12; m.regs.y = 0x34; };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (m) => { m.mem8[loc_31] = 0x00; m.mem8[loc_32] = 0x00; }; // BUG: ignores live X/Y
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the dropped bridge");
});
