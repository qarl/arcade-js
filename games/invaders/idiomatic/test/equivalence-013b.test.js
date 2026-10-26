// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for selectAlternateSpriteFrame (ROM 0x013b) -- "DE += 0x30" (sprite pointer to the second bank).
// Input register DE, live-out DE (the caller reads it back; HL and carry are clobbered before any
// read). No memory is written, so RAM stays identical on both sides and the contract is the DE value.
// Run: node --test games/invaders/idiomatic/test/equivalence-013b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_013b as oracleBody } from "../../translated/loc_013b.js";
import { selectAlternateSpriteFrame } from "../selectAlternateSpriteFrame.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x013b;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x013b dispatches -- selectAlternateSpriteFrame == oracle in RAM and DE", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); selectAlternateSpriteFrame(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.de, o.regs.de, "DE live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: DE is advanced by 0x30 (16-bit wrap) for several values", () => {
  for (const de of [0x0000, 0x1c00, 0x1c30, 0x8040, 0xffff, 0xffe0]) {
    const o = new Machine(ROM); o.regs.de = de;
    const c = new Machine(ROM); c.regs.de = de;
    oracle(o); const ret = selectAlternateSpriteFrame(c);
    assert.equal(ramDiff(o, c), null, `DE=0x${de.toString(16)}`);
    const want = (de + 0x30) & 0xffff;
    assert.equal(c.regs.de, want, `DE advanced from 0x${de.toString(16)}`);
    assert.equal(c.regs.de, o.regs.de, `DE matches oracle from 0x${de.toString(16)}`);
    assert.equal(ret, want, "return value carries the new DE for idiomatic callers");
  }
});

test("TEETH: a wrong DE live-out is caught", () => {
  const o = new Machine(ROM); o.regs.de = 0x1c00;
  const c = new Machine(ROM); c.regs.de = 0x1c00;
  oracle(o);
  selectAlternateSpriteFrame(c); c.regs.de = (c.regs.de + 1) & 0xffff; // BUG: wrong advance
  assert.notEqual(c.regs.de, o.regs.de, "the check FAILED to catch a wrong DE");
});
