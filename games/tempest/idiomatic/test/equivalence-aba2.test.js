// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for rebuildControlBlocksIfRequested (ROM 0xaba2-0xabab) -- refreshes the control state via requestRebuildIfSwitchesChanged, then
// branches on ($01c9 & 3): zero -> the noRebuildRequestReturn no-op tail, else the rebuildControlBlocksFromTemplate rebuild/copy path. The
// idiomatic side dissolves all three jsr into direct calls. Live-out is memory only, so each arm compares
// RAM (dumpState minus stack scratch below the entry SP). A caller: the module omits the ROM ret and the seam completes it.
// Run: node --test games/tempest/idiomatic/test/equivalence-aba2.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_aba2 } from "../../translated/loc_aba2.js";
import { rebuildControlBlocksIfRequested } from "../rebuildControlBlocksIfRequested.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { requestRebuildIfSwitchesChanged } from "../requestRebuildIfSwitchesChanged.js";
import { noRebuildRequestReturn } from "../noRebuildRequestReturn.js";
import { loc_100, PENDING_WORK_FLAGS, INPUT_SNAPSHOT_HI, INPUT_SNAPSHOT_LO } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xaba2;
const oracle = atEntry(loc_aba2);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xaba2 dispatches -- rebuildControlBlocksIfRequested == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); rebuildControlBlocksIfRequested(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Force the rebuildControlBlocksFromTemplate branch: mismatched cached target bytes make requestRebuildIfSwitchesChanged request a rebuild, which sets
// ($01c9 | 3) so the low two bits are non-zero. Vector RAM dirtied so the copy/fill lands in the diffed region.
function seedRebuild(m) {
  m.mem.write8(INPUT_SNAPSHOT_HI, 0xff);
  m.mem.write8(INPUT_SNAPSHOT_LO, 0xff);
  m.mem.write8(PENDING_WORK_FLAGS, 0x00);
  for (let i = 0; i < 0x40; i++) m.mem.write8((0x2100 + i) & 0xffff, 0x5a);
}

test("CRAFTED: forced rebuild -> rebuildControlBlocksFromTemplate path -- rebuildControlBlocksIfRequested == oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seedRebuild(o);
  const c = new Machine(ROM, OPTS); seedRebuild(c);
  oracle(o); rebuildControlBlocksIfRequested(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the rebuild/copy path");
  // rebuildControlBlocksFromTemplate consumes (clears) the PENDING_WORK_FLAGS request bits; its durable $0100=0x08 write marks that the
  // rebuild branch ran (the no-op noRebuildRequestReturn path never writes $0100).
  assert.equal(c.mem.read8(loc_100), 0x08, "rebuildControlBlocksFromTemplate branch ran (its $0100 write is present)");
});

test("TEETH: a twin that skips the rebuildControlBlocksFromTemplate path diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedRebuild(o); oracle(o);
  const c = new Machine(ROM, OPTS); seedRebuild(c);
  const broken = (m) => {
    requestRebuildIfSwitchesChanged(m);
    // BUG: takes the no-op tail regardless of the request bits
    return noRebuildRequestReturn();
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped rebuildControlBlocksFromTemplate path");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, rebuildControlBlocksIfRequested, TARGET, m);
  assert.equal(r.placeable, true, `rebuildControlBlocksIfRequested must be seam-placeable; got: ${r.error}`);
});
