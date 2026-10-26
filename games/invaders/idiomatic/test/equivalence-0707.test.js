// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for stopSaucerSound (ROM 0x0707) -- load B=0xfe then tail-jump into clearSoundPort3Bit: AND the
// port-3 sound shadow with 0xfe (clear the low latch bit), write it back and mirror to port 3.
// Live-out: memory (SOUND_PORT3_SHADOW) + A (clearSoundPort3Bit's classification; both callers tail-delegate).
// Run: node --test games/invaders/idiomatic/test/equivalence-0707.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0707 as oracleBody } from "../../translated/loc_0707.js";
import { stopSaucerSound } from "../stopSaucerSound.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { SOUND_PORT3_SHADOW } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0707;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x0707 dispatches -- stopSaucerSound == oracle in RAM (-stack) and A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); stopSaucerSound(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: SOUND_PORT3_SHADOW &= 0xfe, A = result, for several shadows", () => {
  for (const shadow of [0xff, 0x01, 0x3d, 0x00, 0xaa]) {
    const o = new Machine(ROM); o.mem.write8(SOUND_PORT3_SHADOW, shadow);
    const c = new Machine(ROM); c.mem.write8(SOUND_PORT3_SHADOW, shadow);
    oracle(o); stopSaucerSound(c);
    assert.equal(ramDiff(o, c), null, `shadow=0x${shadow.toString(16)}`);
    assert.equal(c.mem.read8(SOUND_PORT3_SHADOW), shadow & 0xfe, "shadow masked in place");
    assert.equal(c.regs.a, shadow & 0xfe, "A = masked result");
  }
});

test("TEETH: a broken twin (wrong mask keeps the low bit) is caught", () => {
  function loc_0707_broken(m) {
    const v = m.mem8[SOUND_PORT3_SHADOW] & 0xff; // BUG: mask should be 0xfe (clear bit 0)
    m.mem8[SOUND_PORT3_SHADOW] = v;
    m.io.portOut(0x03, v);
    return (m.regs.a = v);
  }
  const o = new Machine(ROM); o.mem.write8(SOUND_PORT3_SHADOW, 0x01);
  const c = new Machine(ROM); c.mem.write8(SOUND_PORT3_SHADOW, 0x01);
  oracle(o); loc_0707_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong masked byte");
  assert.equal(d.addr, SOUND_PORT3_SHADOW & 0xffff);
});
