// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for updateSaucerSound -- gate the saucer sound on the 0x2084/0x2085 flag pair. When 0x2084
// is clear it silences the saucer (0x0707 -> clearSoundPort3Bit, mask 0xfe); else if 0x2085 is nonzero it returns
// untouched; else it arms the sound with request bit 0 (0x18fa/startSound, OR bit 0). Both tail m.calls
// are DISSOLVED into direct idiomatic calls (stopSaucerSound / startSound). The caller (0x084e) discards
// every register updateSaucerSound leaves, so the contract is RAM only -- the SOUND_PORT3_SHADOW cell (0x2094) and
// its mirror. RAM diff excludes the dead stack scratch (the oracle's dissolved callees only ret, no push).
// Run: node --test games/invaders/idiomatic/test/equivalence-1804.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1804 as oracleBody } from "../../translated/loc_1804.js";
import { updateSaucerSound } from "../updateSaucerSound.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { SOUND_PORT3_SHADOW } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1804;
const FLAG0 = 0x2084; // the primary gate flag (0 => silence the saucer)
const FLAG1 = 0x2085; // the secondary gate flag (nonzero => leave the sound alone)

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1804 dispatches -- updateSaucerSound == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); updateSaucerSound(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seed the two gate flags + the sound shadow on both machines, run oracle vs module, diff RAM.
function seedGate(m, f0, f1, shadow) {
  m.mem.write8(FLAG0, f0);
  m.mem.write8(FLAG1, f1);
  m.mem.write8(SOUND_PORT3_SHADOW, shadow);
  m.regs.sp = 0x2400; // the oracle's dissolved sound routine rets; keep [sp] mapped
}

test("CRAFTED: flag0 clear -> saucer silenced (shadow &= 0xfe)", () => {
  const o = new Machine(ROM); const c = new Machine(ROM);
  seedGate(o, 0x00, 0x00, 0x01); seedGate(c, 0x00, 0x00, 0x01);
  oracle(o); updateSaucerSound(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(c.mem.read8(SOUND_PORT3_SHADOW), 0x00, "saucer bit cleared");
});

test("CRAFTED: flag0 set, flag1 nonzero -> untouched (no RAM change)", () => {
  const o = new Machine(ROM); const c = new Machine(ROM);
  seedGate(o, 0x01, 0x01, 0xa5); seedGate(c, 0x01, 0x01, 0xa5);
  oracle(o); updateSaucerSound(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(c.mem.read8(SOUND_PORT3_SHADOW), 0xa5, "shadow left as-is");
});

test("CRAFTED: flag0 set, flag1 clear -> sound armed (shadow |= 0x01)", () => {
  const o = new Machine(ROM); const c = new Machine(ROM);
  seedGate(o, 0x01, 0x00, 0x00); seedGate(c, 0x01, 0x00, 0x00);
  oracle(o); updateSaucerSound(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(c.mem.read8(SOUND_PORT3_SHADOW), 0x01, "sound bit 0 set");
});

test("TEETH: a broken twin (arms the wrong bit) diverges in RAM", () => {
  // Broken twin of updateSaucerSound: arms bit 1 instead of bit 0 on the startSound path.
  function loc_1804_broken(m) {
    if (m.mem8[FLAG0] === 0) { const v = m.mem8[SOUND_PORT3_SHADOW] & 0xfe; m.mem8[SOUND_PORT3_SHADOW] = v; m.io.portOut(0x03, v); return; }
    if (m.mem8[FLAG1] !== 0) return;
    const v = m.mem8[SOUND_PORT3_SHADOW] | 0x02; // BUG: bit 1, should be bit 0
    m.mem8[SOUND_PORT3_SHADOW] = v; m.io.portOut(0x03, v);
  }
  const o = new Machine(ROM); const c = new Machine(ROM);
  seedGate(o, 0x01, 0x00, 0x00); seedGate(c, 0x01, 0x00, 0x00);
  oracle(o); loc_1804_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch the wrong sound bit");
  assert.equal(d.addr, SOUND_PORT3_SHADOW);
});
