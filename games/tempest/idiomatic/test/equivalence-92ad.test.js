// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for clearByte50 (ROM 0x92ad-0x92b1) -- zeroes the $50 cell, then returns. Live-out is
// RAM ($50 = 0), so the arms compare RAM (-stack). Pure leaf: no dispatch, so no SP tooth.
// Run: node --test games/tempest/idiomatic/test/equivalence-92ad.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_92ad } from "../../translated/loc_92ad.js";
import { clearByte50 } from "../clearByte50.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { SPINNER_ACCUM } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x92ad;
const oracle = atEntry(loc_92ad);
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
  oracle(o); clearByte50(c);
  return ramDiff(o, c);
}

test("CAPTURE: real 0x92ad dispatches -- clearByte50 == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) assert.equal(diffFrom(cap), null);
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, s) { for (const [a, v] of Object.entries(s)) m.mem.write8(Number(a), v); }

test("CRAFTED: $50 zeroed == oracle (RAM -stack)", () => {
  // Non-default seed (0x7e, not the 0 default) so the write-to-0 is observable and the arms must agree.
  const s = { [SPINNER_ACCUM]: 0x7e };
  const o = new Machine(ROM, OPTS); seed(o, s);
  const c = new Machine(ROM, OPTS); seed(c, s);
  oracle(o); clearByte50(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(o.mem.read8(SPINNER_ACCUM), 0x00, "precondition: oracle zeroed $50 off 0x7e");
});

test("TEETH: a rewrite that skips the $50 write diverges from the oracle", () => {
  // Non-default seed so a skipped write actually differs from the oracle's 0.
  const s = { [SPINNER_ACCUM]: 0x7e };
  const o = new Machine(ROM, OPTS); seed(o, s); oracle(o);
  const c = new Machine(ROM, OPTS); seed(c, s); /* mutant: never writes $50, leaves 0x7e */
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a skipped $50 write");
});
