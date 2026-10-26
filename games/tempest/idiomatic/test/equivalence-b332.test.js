// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitFrameLink (ROM 0xb332) -- if $cec4 differs from $2000, store it and return carry
// set; else copy a two-byte record (slot chosen by the $0415 mode flag) through the $74/$75 pointer,
// reload the pointer from another record, clear $016e, and return carry clear. Carry is a real live-out
// (caller $b1b6 branches on it), so the arms assert carry as well as RAM (dumpState minus stack scratch below the entry SP).
// Pure leaf, no dispatch; the seam completes it by omitting its ROM ret. No POKEY reads -> deterministic.
// Run: node --test games/tempest/idiomatic/test/equivalence-b332.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b332 } from "../../translated/loc_b332.js";
import { emitFrameLink } from "../emitFrameLink.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { DRAW_CURSOR_LO, DRAW_CURSOR_HI, POINTER_PARITY, SCORE_DISPLAY_TIMER, VEC_LIST_HEADER_LO, VECHEAD0_PLAY } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb332;
const oracle = atEntry(loc_b332);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xb332 dispatches -- emitFrameLink == oracle in RAM (-stack) and carry", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); const cc = emitFrameLink(c);
    assert.equal(ramDiff(o, c), null);
    // Carry is a boolean live-out (module RETURNS it; oracle produces o.regs.fC). The idiomatic
    // layer models no CPU flags, so compare the returned boolean to the oracle's carry, not c.regs.fC.
    assert.equal(cc, o.regs.fC, "carry out matches oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, s) {
  // $cec4 is ROM (fixed); only the gate/flag/pointer/scratch cells are seeded.
  m.mem8[VEC_LIST_HEADER_LO] = s.gate & 0xff;
  m.mem8[POINTER_PARITY] = s.flag & 0xff;
  m.mem8[DRAW_CURSOR_LO] = s.ptr & 0xff;
  m.mem8[DRAW_CURSOR_HI] = (s.ptr >> 8) & 0xff;
  m.mem8[SCORE_DISPLAY_TIMER] = 0xee;
}

test("CRAFTED: differ->store+carry-set; equal->copy record+carry-clear == oracle (RAM -stack + carry)", () => {
  const cases = [
    // $cec4 is a fixed ROM byte; a gate != that value forces the store+carry-set branch.
    { tag: "gate 0x00 (likely != $cec4) -> store & C set", gate: 0x00, flag: 0x00, ptr: 0x0400 },
    { tag: "gate 0xff -> store & C set", gate: 0xff, flag: 0x01, ptr: 0x0410 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM, OPTS); seed(o, s);
    const c = new Machine(ROM, OPTS); seed(c, s);
    oracle(o); const cc = emitFrameLink(c);
    assert.equal(ramDiff(o, c), null, `RAM: ${s.tag}`);
    assert.equal(cc, o.regs.fC, `carry: ${s.tag}`);
    assert.equal(cc, true, `store branch returns carry set: ${s.tag}`);
  }
});

test("CRAFTED: equal path (gate := $cec4) copies the record and clears carry == oracle", () => {
  for (const flag of [0x00, 0x01]) {
    const probe = new Machine(ROM, OPTS);
    const gate = probe.mem8[VECHEAD0_PLAY];            // make $2000 equal $cec4 -> take the copy path
    const s = { gate, flag, ptr: 0x0420 };
    const o = new Machine(ROM, OPTS); seed(o, s);
    const c = new Machine(ROM, OPTS); seed(c, s);
    oracle(o); const cc = emitFrameLink(c);
    assert.equal(ramDiff(o, c), null, `RAM equal-path flag=${flag}`);
    assert.equal(cc, o.regs.fC, `carry equal-path flag=${flag}`);
    assert.equal(cc, false, `carry clear on copy path flag=${flag}`);
    assert.equal(c.mem8[SCORE_DISPLAY_TIMER], 0x00, "$016e cleared on copy path");
  }
});

test("TEETH: a twin that always takes the store branch diverges when the gate already equals $cec4", () => {
  const probe = new Machine(ROM, OPTS);
  const gate = probe.mem8[VECHEAD0_PLAY];
  const s = { gate, flag: 0x01, ptr: 0x0430 };    // equal path is the oracle's; the mutant skips it
  const o = new Machine(ROM, OPTS); seed(o, s);
  const c = new Machine(ROM, OPTS); seed(c, s);
  oracle(o);
  const broken = (m) => { m.mem8[VEC_LIST_HEADER_LO] = m.mem8[VECHEAD0_PLAY]; m.regs.fC = true; }; // BUG: never copies the record
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped record copy");
});
