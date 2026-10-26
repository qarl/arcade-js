// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for latchSoundPort5 (ROM 0x1770-0x1774) -- "mask caller's A to 0x30, OUT sound port 5".
// Input register A; live-out is the sound-port latch (io.soundData[1]), no RAM write. Each side runs on
// a fresh clone and the contract is RAM (minus stack scratch below the entry SP) PLUS the latched sound byte.
// Run: node --test games/invaders/idiomatic/test/equivalence-1770.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1770 as oracleBody } from "../../translated/loc_1770.js";
import { latchSoundPort5 } from "../latchSoundPort5.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1770;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1770 dispatches -- latchSoundPort5 == oracle (RAM -stack + sound latch)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); latchSoundPort5(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.io.soundData[1], o.io.soundData[1]);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: A masked to 0x30 is latched to sound port 5 for several values", () => {
  for (const a of [0x00, 0x0f, 0x10, 0x20, 0x30, 0xc0, 0xff, 0xa5]) {
    const o = new Machine(ROM); o.regs.a = a;
    const c = new Machine(ROM); c.regs.a = a;
    oracle(o); latchSoundPort5(c);
    assert.equal(ramDiff(o, c), null, `A=0x${a.toString(16)}`);
    assert.equal(c.io.soundData[1], o.io.soundData[1], `latch A=0x${a.toString(16)}`);
    assert.equal(c.io.soundData[1], a & 0x30, `masked latch A=0x${a.toString(16)}`);
  }
});

test("TEETH: a wrong latched sound byte is caught", () => {
  const o = new Machine(ROM); o.regs.a = 0x30;
  const c = new Machine(ROM); c.regs.a = 0x30;
  oracle(o);
  latchSoundPort5(c); c.io.soundData[1] = 0x00; // BUG: wrong latched value (masked byte was 0x30)
  assert.notEqual(c.io.soundData[1], o.io.soundData[1], "the check FAILED to catch a wrong sound latch");
});
