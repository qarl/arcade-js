// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for rotateTripleArray (ROM 0xb875-0xb887) -- rotates the three-entry array $22..$24 down by
// one and mirrors each new entry into $0809..$080b. Live-out is memory only (registers at RTS incidental),
// so each side runs on a clone and the contract is RAM (dumpState, minus stack scratch below the entry SP). A leaf: the module
// omits the ROM ret and the seam completes it. No POKEY/clock read, so the crafted seed is deterministic.
// Run: node --test games/tempest/idiomatic/test/equivalence-b875.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b875 } from "../../translated/loc_b875.js";
import { rotateTripleArray } from "../rotateTripleArray.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { COLOR_CYCLE_0, COLOR_CYCLE_1, COLOR_CYCLE_2, COLOR_RAM_9, COLOR_RAM_A, COLOR_RAM_B } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb875;
const oracle = atEntry(loc_b875);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));
// color RAM (0x0800-0x080F) is CPU write-only (read8 throws) -- read those back via io.colorram
const readCell = (m, a) => (a >= 0x0800 && a <= 0x080f ? m.io.colorram[a & 0x0f] : m.mem.read8(a & 0xffff));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xb875 dispatches -- rotateTripleArray == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); rotateTripleArray(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: $22..$24 rotate down by one and $0809..$080b mirror the result", () => {
  const seed = (m) => {
    m.mem.write8(COLOR_CYCLE_0, 0x11); m.mem.write8(COLOR_CYCLE_1, 0x22); m.mem.write8(COLOR_CYCLE_2, 0x33);
    m.mem.write8(COLOR_RAM_9, 0xa0); m.mem.write8(COLOR_RAM_A, 0xa1); m.mem.write8(COLOR_RAM_B, 0xa2); // dirty sentinels
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); rotateTripleArray(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after rotate");
  // rotate: new $22=old $23, new $23=old $24, new $24=old $22; the pair mirrors the new values.
  assert.equal(readCell(c, COLOR_CYCLE_0), 0x22, "$22 <- old $23");
  assert.equal(readCell(c, COLOR_CYCLE_1), 0x33, "$23 <- old $24");
  assert.equal(readCell(c, COLOR_CYCLE_2), 0x11, "$24 <- old $22");
  assert.equal(readCell(c, COLOR_RAM_9), 0x22, "$0809 mirrors $22");
  assert.equal(readCell(c, COLOR_RAM_A), 0x33, "$080a mirrors $23");
  assert.equal(readCell(c, COLOR_RAM_B), 0x11, "$080b mirrors $24");
});

test("TEETH: a twin that copies instead of rotating diverges from the oracle", () => {
  const seed = (m) => {
    m.mem.write8(COLOR_CYCLE_0, 0x11); m.mem.write8(COLOR_CYCLE_1, 0x22); m.mem.write8(COLOR_CYCLE_2, 0x33);
    m.mem.write8(COLOR_RAM_9, 0xa0); m.mem.write8(COLOR_RAM_A, 0xa1); m.mem.write8(COLOR_RAM_B, 0xa2);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const brokenB875 = (m) => {
    const mem = m.mem8;
    // BUG: mirrors the unrotated array (no down-shift)
    mem[COLOR_RAM_9] = mem[COLOR_CYCLE_0]; mem[COLOR_RAM_A] = mem[COLOR_CYCLE_1]; mem[COLOR_RAM_B] = mem[COLOR_CYCLE_2];
  };
  brokenB875(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the missing rotation");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, rotateTripleArray, TARGET, m);
  assert.equal(r.placeable, true, `rotateTripleArray must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
