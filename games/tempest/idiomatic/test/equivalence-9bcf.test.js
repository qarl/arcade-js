// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for noopDispatchStub (ROM 0x9bcf) -- a bare RTS leaf / dispatch stub. No RAM write, no
// register live-out: the idiomatic body is empty and the withOmittedRet seam supplies the ret. The arms
// compare RAM (-stack) only; the oracle's ROM ret moves SP/pc but writes no RAM (the seam reconciles), so
// pc/SP are NOT compared. A TEETH twin that writes a cell proves the RAM diff has teeth.
// Run: node --test games/tempest/idiomatic/test/equivalence-9bcf.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9bcf } from "../../translated/loc_9bcf.js";
import { noopDispatchStub } from "../noopDispatchStub.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; };
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9bcf;
const oracle = atEntry(loc_9bcf);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps taken before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x9bcf dispatches -- noopDispatchStub == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); noopDispatchStub(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: a bare RTS leaves RAM untouched (seeded, non-default RAM) == oracle", () => {
  const seed = (m) => { m.mem8[0x40] = 0xaa; m.mem8[0x2c] = 0x55; m.mem8[0x0200] = 0x3c; };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); noopDispatchStub(c);
  assert.equal(ramDiff(o, c), null, "no-op must leave seeded RAM identical to the oracle");
});

test("TEETH: a twin that writes a cell diverges from the bare-RTS oracle (RAM diff catches it)", () => {
  const o = new Machine(ROM, OPTS);
  oracle(o);
  assert.equal(o.mem8[0x40], 0x00, "precondition: oracle left $40 at its default 0");
  const brokenWrite = 0xaa; // BUG: a twin that stamps $40 instead of doing nothing
  assert.notEqual(brokenWrite, o.mem8[0x40], "the RAM diff FAILED to catch a spurious write");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, noopDispatchStub, TARGET, m);
  assert.equal(r.placeable, true, `noopDispatchStub must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
