// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for switchesUnchangedReturn (ROM 0xac3e) -- a lone RTS (shared return tail). It touches no memory
// and no register live-out, so the arms must be RAM-identical (-stack) on every seed. Pure leaf: no
// dispatch, so no SP tooth.
// Run: node --test games/tempest/idiomatic/test/equivalence-ac3e.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_ac3e } from "../../translated/loc_ac3e.js";
import { switchesUnchangedReturn } from "../switchesUnchangedReturn.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xac3e;
const oracle = atEntry(loc_ac3e);
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
  oracle(o); switchesUnchangedReturn(c);
  return ramDiff(o, c);
}

test("CAPTURE: real 0xac3e dispatches -- switchesUnchangedReturn == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) assert.equal(diffFrom(cap), null);
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: switchesUnchangedReturn is a pure return -- RAM unchanged == oracle", () => {
  const o = new Machine(ROM, OPTS), c = new Machine(ROM, OPTS);
  for (const [a, v] of [[0x50, 0x7e], [0x6a, 0x33], [0x0120, 0x11]]) { o.mem.write8(a, v); c.mem.write8(a, v); }
  oracle(o); switchesUnchangedReturn(c);
  assert.equal(ramDiff(o, c), null);
});

test("TEETH: a twin that writes a cell diverges from the pure-return oracle", () => {
  const o = new Machine(ROM, OPTS), c = new Machine(ROM, OPTS);
  oracle(o);                  // pure return, no RAM write
  c.mem.write8(0x50, 0x7e);   // BUG: a twin that mutates $50 instead of doing nothing
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a bogus write");
});
