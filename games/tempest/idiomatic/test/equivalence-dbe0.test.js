// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for assemblePotStatusByte -- writes the incoming A to a POKEY register, copies the low 3 bits of
// one POKEY ALLPOT read into $0037 (and a second POKEY register), and returns those bits merged with one
// relocated bit of a second ALLPOT read. The ALLPOT reads are POKEY-timing-coupled: on a fresh (master-
// reset) POKEY they read 0, so $0037 is deterministic there -- the CRAFTED arm asserts that RAM cell and
// the return value, and leans on CAPTURE for live-POKEY states. A leaf: the module omits the ROM ret and
// the seam completes it, so the arms compare RAM (dumpState, minus stack scratch below the entry SP), NOT pc/SP.
// Run: node --test games/tempest/idiomatic/test/equivalence-dbe0.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_dbe0 } from "../../translated/loc_dbe0.js";
import { assemblePotStatusByte } from "../assemblePotStatusByte.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { SLOT_LOOP_INDEX } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xdbe0;
const oracle = atEntry(loc_dbe0);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xdbe0 dispatches -- assemblePotStatusByte == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); assemblePotStatusByte(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: $0037 = low 3 bits of the ALLPOT read (0 on a fresh POKEY), and the return matches", () => {
  const seed = (m) => { m.regs.a = 0x5a; m.mem.write8(SLOT_LOOP_INDEX, 0x99); }; // 0x99 sentinel, 0x5a incoming
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const rc = assemblePotStatusByte(c, 0x5a);
  assert.equal(ramDiff(o, c), null, "RAM equal after run");
  assert.equal(c.mem.read8(SLOT_LOOP_INDEX), 0x00, "$0037 = low 3 bits of ALLPOT (0 on a fresh POKEY)");
  assert.equal(rc, o.regs.a, "return value matches the oracle's A");
});

test("TEETH: a twin that skips the $0037 store diverges from the oracle (non-default sentinel bites)", () => {
  const seed = (m) => { m.regs.a = 0x5a; m.mem.write8(SLOT_LOOP_INDEX, 0x99); };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const brokenDbe0 = (m, a = m.regs.a) => {
    const mem = m.mem8;
    mem[0x60db & 0xffff] = a; // POKEY write only -- BUG: never writes $0037
  };
  brokenDbe0(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped $0037 store");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, assemblePotStatusByte, TARGET, m);
  assert.equal(r.placeable, true, `assemblePotStatusByte must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
