// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for clearSoundPort3Bit (ROM 0x19dc) -- AND the sound shadow SOUND_PORT3_SHADOW with B, write it back
// and mirror to sound port 3. Live-out: memory (SOUND_PORT3_SHADOW) + A.
// Run: node --test games/invaders/idiomatic/test/equivalence-19dc.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_19dc as oracleBody } from "../../translated/loc_19dc.js";
import { clearSoundPort3Bit } from "../clearSoundPort3Bit.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { SOUND_PORT3_SHADOW } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x19dc;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x19dc dispatches -- clearSoundPort3Bit == oracle in RAM (-stack) and A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); clearSoundPort3Bit(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: SOUND_PORT3_SHADOW &= B, A = result, for several (shadow,B)", () => {
  for (const [shadow, b] of [[0xff, 0x30], [0x3c, 0x0f], [0x00, 0xff], [0xaa, 0x55], [0xf0, 0xf0]]) {
    const o = new Machine(ROM); o.mem.write8(SOUND_PORT3_SHADOW, shadow); o.regs.b = b;
    const c = new Machine(ROM); c.mem.write8(SOUND_PORT3_SHADOW, shadow); c.regs.b = b;
    oracle(o); clearSoundPort3Bit(c);
    assert.equal(ramDiff(o, c), null, `shadow=0x${shadow.toString(16)} b=0x${b.toString(16)}`);
    assert.equal(c.mem.read8(SOUND_PORT3_SHADOW), shadow & b, "shadow masked in place");
    assert.equal(c.regs.a, shadow & b, "A = masked result");
  }
});

test("TEETH: a wrong masked value is caught", () => {
  const o = new Machine(ROM); o.mem.write8(SOUND_PORT3_SHADOW, 0xaa); o.regs.b = 0x55;
  const c = new Machine(ROM); c.mem.write8(SOUND_PORT3_SHADOW, 0xaa); c.regs.b = 0x55;
  oracle(o);
  clearSoundPort3Bit(c); c.mem.write8(SOUND_PORT3_SHADOW, (c.mem.read8(SOUND_PORT3_SHADOW) ^ 0x01)); // BUG: corrupt the stored byte
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong masked byte");
  assert.equal(d.addr, SOUND_PORT3_SHADOW & 0xffff);
});
