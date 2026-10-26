// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for resetVectorTailCursor (ROM 0xb888-0xb895) -- dissolves jsr $c196 into a direct idiomatic call,
// then seats $0139=0x7f and $013a=0x04. The oracle runs the TRANSLATED unpackLevelNibbleTables via m.call; the idiomatic
// calls the idiomatic unpackLevelNibbleTables directly. Live-out is memory only (A=0x04 at RTS is incidental), so each
// side runs on a clone and the contract is RAM (dumpState, minus stack scratch below the entry SP). A caller: the module omits
// the ROM ret and the seam completes it, so the arms compare RAM (-stack), NOT pc/SP.
// Run: node --test games/tempest/idiomatic/test/equivalence-b888.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b888 } from "../../translated/loc_b888.js";
import { resetVectorTailCursor } from "../resetVectorTailCursor.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { VECRAM_TAIL_CURSOR_LO, VECRAM_TAIL_CURSOR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb888;
const oracle = atEntry(loc_b888);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xb888 dispatches -- resetVectorTailCursor == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); resetVectorTailCursor(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: $0139/$013a seated and the $c196 fold matches the oracle", () => {
  const seed = (m) => { m.mem.write8(0x9f, 0x30); m.mem.write8(VECRAM_TAIL_CURSOR_LO, 0xaa); m.mem.write8(VECRAM_TAIL_CURSOR_HI, 0xbb); };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); resetVectorTailCursor(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after run");
  assert.equal(c.mem.read8(VECRAM_TAIL_CURSOR_LO), 0x7f, "$0139 = 0x7f");
  assert.equal(c.mem.read8(VECRAM_TAIL_CURSOR_HI), 0x04, "$013a = 0x04");
});

test("TEETH: a twin that leaves $013a untouched diverges from the oracle", () => {
  const seed = (m) => { m.mem.write8(0x9f, 0x30); m.mem.write8(VECRAM_TAIL_CURSOR_LO, 0xaa); m.mem.write8(VECRAM_TAIL_CURSOR_HI, 0xbb); };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); resetVectorTailCursor(c);
  c.mem.write8(VECRAM_TAIL_CURSOR_HI, (c.mem.read8(VECRAM_TAIL_CURSOR_HI) ^ 0xff) & 0xff); // BUG: $013a corrupted
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the corrupted store");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.mem.write8(0x9f, 0x30);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, resetVectorTailCursor, TARGET, m);
  assert.equal(r.placeable, true, `resetVectorTailCursor must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret caller (moved 0) placeable");
});
