// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for alienIndexToScreenCoords (ROM 0x017a) -- resolve L over 0x0b, stepping the B,C pair read from
// loc_2009/loc_200a: B += 0x10 per whole part (into L), C += 0x10 per remainder, D counts the whole
// parts. No memory is written, so RAM stays identical on both sides; the contract is the L, C, D
// live-outs (each read by a still-translated caller).
// Run: node --test games/invaders/idiomatic/test/equivalence-017a.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_017a as oracleBody } from "../../translated/loc_017a.js";
import { alienIndexToScreenCoords } from "../alienIndexToScreenCoords.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { loc_2009, loc_200a } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x017a;
const liveOut = (m) => ({ l: m.regs.l, c: m.regs.c, d: m.regs.d });

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x017a dispatches -- alienIndexToScreenCoords == oracle in RAM and (L,C,D)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); alienIndexToScreenCoords(c);
    assert.equal(ramDiff(o, c), null);
    assert.deepEqual(liveOut(c), liveOut(o), "L,C,D live-outs match the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: (L,C,D) resolved from L and the loc_2009/loc_200a pair, several seeds", () => {
  const seeds = [
    [0x00, 0x40, 0x80], [0x05, 0x40, 0x80], [0x0b, 0x10, 0x20],
    [0x16, 0x00, 0x00], [0x27, 0x30, 0x50], [0x36, 0xf0, 0x0c],
  ];
  for (const [l, b0, c0] of seeds) {
    const o = new Machine(ROM); o.regs.l = l; o.mem.write8(loc_2009, b0); o.mem.write8(loc_200a, c0);
    const c = new Machine(ROM); c.regs.l = l; c.mem.write8(loc_2009, b0); c.mem.write8(loc_200a, c0);
    oracle(o); const ret = alienIndexToScreenCoords(c);
    const tag = `L=0x${l.toString(16)} B0=0x${b0.toString(16)} C0=0x${c0.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.deepEqual(liveOut(c), liveOut(o), tag);
    assert.deepEqual(ret, [c.regs.l, c.regs.c, c.regs.d], `tuple mirrors L,C,D for ${tag}`);
  }
});

test("TEETH: a broken twin (wrong step) is caught", () => {
  // A twin that steps B/C by 0x11 instead of 0x10 -> wrong L and C.
  function broken(m, l = m.regs.l) {
    let b = m.mem8[loc_2009], cc = m.mem8[loc_200a], d = 0, a = l;
    while (((a - 0x0b) & 0x80) === 0) { a = (a - 0x0b) & 0xff; b = (b + 0x11) & 0xff; d = (d + 1) & 0xff; }
    while (a !== 0) { cc = (cc + 0x11) & 0xff; a = (a - 1) & 0xff; }
    return [m.regs.l = b, m.regs.c = cc, m.regs.d = d];
  }
  const o = new Machine(ROM); o.regs.l = 0x27; o.mem.write8(loc_2009, 0x30); o.mem.write8(loc_200a, 0x50);
  const c = new Machine(ROM); c.regs.l = 0x27; c.mem.write8(loc_2009, 0x30); c.mem.write8(loc_200a, 0x50);
  oracle(o); broken(c);
  assert.notDeepEqual(liveOut(c), liveOut(o), "the check FAILED to catch a wrong step");
});
