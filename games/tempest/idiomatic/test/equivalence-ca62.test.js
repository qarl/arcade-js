// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for clearChannelStagingBlock (ROM 0xca62) -- clears the 6-byte block $40..$45. Pure store leaf: live-out
// is RAM only, so every arm checks the RAM diff minus dead stack. No POKEY/clock coupling.
// Run: node --test games/tempest/idiomatic/test/equivalence-ca62.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_ca62 } from "../../translated/loc_ca62.js";
import { clearChannelStagingBlock } from "../clearChannelStagingBlock.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_40, loc_41, loc_42, loc_43, loc_44, loc_45 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : null; };
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xca62;
const oracle = atEntry(loc_ca62);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// Dirty the block with a non-default pattern so a clear that misses any cell shows up.
function seed(m, fill = 0xff) {
  for (const a of [loc_40, loc_41, loc_42, loc_43, loc_44, loc_45]) m.mem8[a] = fill;
}

test("CAPTURE: real 0xca62 dispatches -- clearChannelStagingBlock == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); clearChannelStagingBlock(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: the 6-byte clear == oracle (RAM -stack)", () => {
  for (const fill of [0xff, 0x5a, 0x01]) {
    const o = new Machine(ROM, OPTS); seed(o, fill);
    const c = new Machine(ROM, OPTS); seed(c, fill);
    oracle(o); clearChannelStagingBlock(c);
    assert.equal(ramDiff(o, c), null, `fill=0x${fill.toString(16)}`);
    for (const a of [loc_40, loc_41, loc_42, loc_43, loc_44, loc_45]) assert.equal(c.mem8[a], 0x00, `$${a.toString(16)} cleared`);
  }
});

test("TEETH: a rewrite that skips $40 (misses the last iteration) diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0xff);
  const c = new Machine(ROM, OPTS); seed(c, 0xff);
  const broken = (m) => { for (let x = 5; x >= 1; x--) m.mem8[(loc_40 + x) & 0xff] = 0x00; }; // BUG: leaves $40 = 0xff
  oracle(o); broken(c);
  assert.equal(o.mem8[loc_40], 0x00, "precondition: oracle cleared $40");
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a skipped $40 clear");
});

test("SP-TOOTH: the pure leaf omits its ROM ret (SP unmoved) and is seam-placeable", () => {
  const mk = () => {
    const m = new Machine(ROM, OPTS);
    m.regs.s = 0xfb;
    m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab); // a real caller-return word for the seam's ret
    seed(m);
    return m;
  };
  const ok = seamPlaceable(withOmittedRet, clearChannelStagingBlock, TARGET, mk());
  assert.equal(ok.placeable, true, `clearChannelStagingBlock must be seam-placeable; got: ${ok.error}`);
  const spMutant = (m) => { m.push16(0x0000); };
  assert.equal(seamPlaceable(withOmittedRet, spMutant, TARGET, mk()).placeable, false, "SP tooth failed to refuse an unbalanced mutant");
  console.log("  SP-TOOTH: pure leaf placeable; unbalanced mutant refused");
});
