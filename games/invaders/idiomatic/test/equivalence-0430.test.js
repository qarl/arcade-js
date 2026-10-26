// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for loadPlayerShotDescriptor (ROM 0x0430) -- seat the object move-record base and read its 5-byte
// sprite descriptor. Writes NO memory, so RAM is a vacuous contract; the live-out is REGISTERS
// (HL/DE/A/C/B, consumed by playerShotHandler's arms). The oracle tail-dispatches through the seam, which
// perturbs SP/PC, so we compare only the data-register outputs, not firstRegDiff.
// Run: node --test games/invaders/idiomatic/test/equivalence-0430.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0430 as oracleBody } from "../../translated/loc_0430.js";
import { loadPlayerShotDescriptor } from "../loadPlayerShotDescriptor.js";
import { loadSpriteDescriptor } from "../loadSpriteDescriptor.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { PLAYER_SHOT_DESC } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0430;

// The live-out registers this routine produces (data only -- SP/PC excluded).
const OUT = ["hl", "de", "a", "b", "c"];
const regOutDiff = (o, c) => {
  for (const k of OUT) if (o.regs[k] !== c.regs[k]) return { reg: k, o: o.regs[k], c: c.regs[k] };
  return null;
};

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x0430 dispatches -- loadPlayerShotDescriptor == oracle in RAM + live-out registers", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); loadPlayerShotDescriptor(c);
    assert.equal(ramDiff(o, c), null);          // neither side touches RAM
    assert.equal(regOutDiff(o, c), null);       // the real contract: HL/DE/A/C/B
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Write the 5-byte descriptor at the FIXED base loadPlayerShotDescriptor seats (0x2027), run oracle vs module.
function seedDescriptor(m, bytes) {
  m.io.setInte(false);
  for (let i = 0; i < bytes.length; i++) m.mem.write8(PLAYER_SHOT_DESC + i, bytes[i]);
}

test("CRAFTED: descriptor at PLAYER_SHOT_DESC -> DE/A/C/B and HL=C:A for several inputs", () => {
  for (const bytes of [
    [0x00, 0x00, 0x00, 0x00, 0x00],
    [0x11, 0x22, 0x33, 0x44, 0x55],
    [0xff, 0x7f, 0x80, 0x01, 0xfe],
    [0xa5, 0x5a, 0xc3, 0x3c, 0x99],
  ]) {
    const o = new Machine(ROM); const c = new Machine(ROM);
    seedDescriptor(o, bytes); seedDescriptor(c, bytes);
    oracle(o); loadPlayerShotDescriptor(c);
    assert.equal(ramDiff(o, c), null, `bytes=${bytes}`);
    assert.equal(regOutDiff(o, c), null, `bytes=${bytes}`);
    // The expected register image, computed from the descriptor bytes [e,d,a,c,b].
    const [e, d, a, cc, b] = bytes;
    assert.equal(c.regs.e, e, "E"); assert.equal(c.regs.d, d, "D");
    assert.equal(c.regs.a, a, "A"); assert.equal(c.regs.c, cc, "C");
    assert.equal(c.regs.b, b, "B");
    assert.equal(c.regs.hl, ((cc << 8) | a) & 0xffff, "HL=C:A");
  }
});

test("TEETH: a broken twin that reads the descriptor one byte off is caught", () => {
  // Mutate loadPlayerShotDescriptor's OWN logic -- the base it seats -- so the descriptor is misaligned.
  function loc_0430_broken(m) {
    return loadSpriteDescriptor(m, (PLAYER_SHOT_DESC + 1) & 0xffff); // BUG: wrong base
  }
  const bytes = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66]; // one extra byte so the shifted read differs
  const o = new Machine(ROM); const c = new Machine(ROM);
  seedDescriptor(o, bytes); seedDescriptor(c, bytes);
  oracle(o); loc_0430_broken(c);
  const d = regOutDiff(o, c);
  assert.notEqual(d, null, "the register contract FAILED to catch a misaligned descriptor read");
});
