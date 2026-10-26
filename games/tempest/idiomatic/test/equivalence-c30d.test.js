// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for initAndDrawRimDepthCounters -- first-time setup seeds two counters, always emits a header, and (when
// both counters are live) clears record slots and draws each counter's record set, tail-calling the drawer.
// The idiomatic side dissolves the jsr chain (c473/c453/df6a/c3ee/df4c/c36e) into direct calls. Live-out is
// RAM plus the value carried out by the tail drawer (validated by that callee's own equivalence), so each arm
// compares dumpState minus stack scratch below the entry SP. Run: node --test games/tempest/idiomatic/test/equivalence-c30d.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c30d } from "../../translated/loc_c30d.js";
import { initAndDrawRimDepthCounters } from "../initAndDrawRimDepthCounters.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_9e, loc_110, loc_113 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xc30d;
const oracle = atEntry(loc_c30d);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xc30d dispatches -- initAndDrawRimDepthCounters == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); initAndDrawRimDepthCounters(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// First counter already live: skips the setup integrator block, emits the header, sets the mode flag,
// then returns because the first counter is nonzero -- exercising the common prologue and early exit.
function seedLive(m) {
  m.mem.write8(loc_110, 0x05); // first counter live -> skip setup, early return after header
}

test("CRAFTED: first counter live -- header + mode flag written, then early return matches oracle", () => {
  const o = new Machine(ROM, OPTS); seedLive(o);
  const c = new Machine(ROM, OPTS); seedLive(c);
  oracle(o); initAndDrawRimDepthCounters(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after early-return path");
  assert.equal(c.mem.read8(loc_9e), 0x06, "mode flag written");
});

test("TEETH: a twin that skips the mode-flag write diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedLive(o);
  const c = new Machine(ROM, OPTS); seedLive(c);
  oracle(o);
  const brokenC30d = (_m) => { /* BUG: never emits the header and never sets the mode flag */ };
  brokenC30d(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped header/flag");
});

test("TEETH-NODRAW: first counter live but no secondary -- both take the same early return", () => {
  const seed = (m) => { m.mem.write8(loc_110, 0x05); m.mem.write8(loc_113, 0x00); };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); initAndDrawRimDepthCounters(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the shared early return");
});

test("SP-TOOTH: the omitted-ret tail-caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seedLive(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, initAndDrawRimDepthCounters, TARGET, m);
  assert.equal(r.placeable, true, `initAndDrawRimDepthCounters must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret tail-caller (moved 0) placeable");
});
