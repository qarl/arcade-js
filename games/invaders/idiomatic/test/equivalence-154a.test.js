// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for clearShotHitAndSilence (ROM 0x154a) -- clear the prize-active flag PLAYER_SHOT_HIT, then mask bit 3
// off SOUND_PORT3_SHADOW (the dissolved 0x19dc tail) and mirror to sound port 3. Live-out: memory
// (PLAYER_SHOT_HIT cleared, SOUND_PORT3_SHADOW masked) + A = masked result.
// Run: node --test games/invaders/idiomatic/test/equivalence-154a.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_154a as oracleBody } from "../../translated/loc_154a.js";
import { clearShotHitAndSilence } from "../clearShotHitAndSilence.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { SOUND_PORT3_SHADOW, PLAYER_SHOT_HIT } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x154a;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x154a dispatches -- clearShotHitAndSilence == oracle in RAM (-stack) and A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); clearShotHitAndSilence(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: PLAYER_SHOT_HIT cleared, SOUND_PORT3_SHADOW &= 0xf7, A = result, for several shadows", () => {
  for (const shadow of [0xff, 0x08, 0x0f, 0xaa, 0x55, 0x00]) {
    const o = new Machine(ROM); o.mem.write8(SOUND_PORT3_SHADOW, shadow); o.mem.write8(PLAYER_SHOT_HIT, 0x01); o.regs.sp = 0x2400;
    const c = new Machine(ROM); c.mem.write8(SOUND_PORT3_SHADOW, shadow); c.mem.write8(PLAYER_SHOT_HIT, 0x01); c.regs.sp = 0x2400;
    oracle(o); const ret = clearShotHitAndSilence(c);
    const tag = `shadow=0x${shadow.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.mem.read8(PLAYER_SHOT_HIT), 0x00, `prize flag cleared: ${tag}`);
    assert.equal(c.mem.read8(SOUND_PORT3_SHADOW), shadow & 0xf7, `shadow masked: ${tag}`);
    assert.equal(c.regs.a, shadow & 0xf7, `A = masked result: ${tag}`);
    assert.equal(ret, shadow & 0xf7, `return value = A: ${tag}`);
    assert.equal(c.regs.a, o.regs.a, `A matches oracle: ${tag}`);
  }
});

test("TEETH: a broken twin (masks bit 0 too, via 0xf6) diverges in the stored shadow", () => {
  const shadow = 0x0f; // bit 0 set, so 0xf7 vs 0xf6 differ
  const o = new Machine(ROM); o.mem.write8(SOUND_PORT3_SHADOW, shadow); o.mem.write8(PLAYER_SHOT_HIT, 0x01); o.regs.sp = 0x2400;
  const c = new Machine(ROM); c.mem.write8(SOUND_PORT3_SHADOW, shadow); c.mem.write8(PLAYER_SHOT_HIT, 0x01); c.regs.sp = 0x2400;
  oracle(o);
  // broken twin of clearShotHitAndSilence: clears the flag but masks with the wrong constant
  c.mem.write8(PLAYER_SHOT_HIT, 0x00);
  c.mem.write8(SOUND_PORT3_SHADOW, shadow & 0xf6);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong sound mask");
  assert.equal(d.addr, SOUND_PORT3_SHADOW & 0xffff);
});
