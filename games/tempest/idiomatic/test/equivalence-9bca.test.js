// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for endObjectMotionScript (ROM 0x9bca-0x9bcf) -- clears the $010a cell, then returns. Live-out is
// RAM ($010a = 0), so the arms compare RAM (-stack). $010a sits in page 1 but ABOVE the dead-stack window,
// so the diff sees the write. Pure leaf: no dispatch, so no SP tooth.
// Run: node --test games/tempest/idiomatic/test/equivalence-9bca.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9bca } from "../../translated/loc_9bca.js";
import { endObjectMotionScript } from "../endObjectMotionScript.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { SCRIPT_WALK_CONTINUE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9bca;
const oracle = atEntry(loc_9bca);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps taken before any gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

function diffFrom(cap) {
  const o = cap.clone(), c = cap.clone();
  oracle(o); endObjectMotionScript(c);
  return ramDiff(o, c);
}

test("CAPTURE: real 0x9bca dispatches -- endObjectMotionScript == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) assert.equal(diffFrom(cap), null);
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, s) { for (const [a, v] of Object.entries(s)) m.mem.write8(Number(a), v); }

test("CRAFTED: $010a cleared == oracle (RAM -stack)", () => {
  // Non-default seed (0x7e) so the write-to-0 is observable and the arms must agree.
  const s = { [SCRIPT_WALK_CONTINUE]: 0x7e };
  const o = new Machine(ROM, OPTS); seed(o, s);
  const c = new Machine(ROM, OPTS); seed(c, s);
  oracle(o); endObjectMotionScript(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(o.mem.read8(SCRIPT_WALK_CONTINUE), 0x00, "precondition: oracle cleared $010a off 0x7e");
});

test("TEETH: a rewrite that skips the $010a clear diverges from the oracle", () => {
  const s = { [SCRIPT_WALK_CONTINUE]: 0x7e };
  const o = new Machine(ROM, OPTS); seed(o, s); oracle(o);
  const c = new Machine(ROM, OPTS); seed(c, s); /* mutant: never clears $010a, leaves 0x7e */
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a skipped $010a clear");
});
