// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for armEaromReadback (ROM 0xde11) -- sets the mode byte $01c7=7 and clears its target
// $01c8=0, then falls through into the EAROM/vector state machine (dissolved: idiomatic calls stepEaromTransfer
// directly). No register inputs; live-out is memory only, so the arms compare RAM (dumpState -stack).
// The state machine touches the $6040/$6050 EAROM port block (deterministic within a clone), so CAPTURE
// replays real dispatches on clones and CRAFTED seeds the fresh-row entry ($01ca=0, $01c7!=0).
// Run: node --test games/tempest/idiomatic/test/equivalence-de11.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_de11 } from "../../translated/loc_de11.js";
import { armEaromReadback } from "../armEaromReadback.js";
import { stepEaromTransfer as brokenTail } from "../stepEaromTransfer.js"; // shared tail, for the TEETH twin

import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { EAROM_REGION_PENDING, EAROM_REGION_DIR, EAROM_MODE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xde11;
const oracle = atEntry(loc_de11);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xde11 dispatches -- armEaromReadback == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); armEaromReadback(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: seeds the mode byte and runs the fresh-row walk == oracle (RAM -stack)", () => {
  const seed = (m) => {
    m.mem.write8(EAROM_MODE, 0x00); // idle -> fresh-row block will run and read $01c8
    m.mem.write8(EAROM_REGION_PENDING, 0x33); // garbage; armEaromReadback overwrites with 7
    m.mem.write8(EAROM_REGION_DIR, 0x77); // garbage; armEaromReadback clears to 0
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); armEaromReadback(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the walk");
  assert.equal(c.mem.read8(EAROM_REGION_DIR), 0x00, "$01c8 cleared");
});

test("TEETH: a twin that skips clearing $01c8 diverges (the mask select flips y 0x20->0x80)", () => {
  const seed = (m) => {
    m.mem.write8(EAROM_MODE, 0x00);
    m.mem.write8(EAROM_REGION_PENDING, 0x33);
    m.mem.write8(EAROM_REGION_DIR, 0xff); // all bits set: AND with the walking mask is nonzero -> y=0x80
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (m) => {
    m.mem.write8(EAROM_REGION_PENDING, 0x07); // BUG: sets the mode byte but never clears $01c8
    // run the shared state machine on the un-cleared target
    // (import kept local to the twin to mirror armEaromReadback's tail)
    return brokenTail(m);
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the un-cleared $01c8");
});
