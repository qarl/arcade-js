// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for retirePlayerShot -- set PLAYER_SHOT_STATUS to 0x04, then fall through into
// clearShotHitAndSilence (the dissolved 0x154a tail): clear PLAYER_SHOT_HIT and mask bit 3 off
// SOUND_PORT3_SHADOW (mirrored to sound port 3). Live-out: memory (the three cells) + A = masked result.
// Run: node --test games/invaders/idiomatic/test/equivalence-1545.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1545 as oracleBody } from "../../translated/loc_1545.js";
import { retirePlayerShot } from "../retirePlayerShot.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { PLAYER_SHOT_STATUS, PLAYER_SHOT_HIT, SOUND_PORT3_SHADOW } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1545;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1545 dispatches -- retirePlayerShot == oracle in RAM (-stack) and A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); retirePlayerShot(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: 0x2025 := 0x04, PLAYER_SHOT_HIT cleared, SOUND_PORT3_SHADOW &= 0xf7, A = result", () => {
  for (const shadow of [0xff, 0x08, 0x0f, 0xaa, 0x55, 0x00]) {
    const seed = (m) => {
      m.regs.sp = 0x2400;
      m.mem.write8(PLAYER_SHOT_STATUS, 0x01); // pre-dirty so the 0x04 write is proven
      m.mem.write8(PLAYER_SHOT_HIT, 0x01);
      m.mem.write8(SOUND_PORT3_SHADOW, shadow);
    };
    const o = new Machine(ROM); seed(o);
    const c = new Machine(ROM); seed(c);
    oracle(o); const ret = retirePlayerShot(c);
    const tag = `shadow=0x${shadow.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.mem.read8(PLAYER_SHOT_STATUS), 0x04, `shot status := 0x04: ${tag}`);
    assert.equal(c.mem.read8(PLAYER_SHOT_HIT), 0x00, `prize flag cleared: ${tag}`);
    assert.equal(c.mem.read8(SOUND_PORT3_SHADOW), shadow & 0xf7, `shadow masked: ${tag}`);
    assert.equal(c.regs.a, shadow & 0xf7, `A = masked result: ${tag}`);
    assert.equal(ret, shadow & 0xf7, `return value = A: ${tag}`);
    assert.equal(c.regs.a, o.regs.a, `A matches oracle: ${tag}`);
  }
});

test("TEETH: a module-mutating twin (writes the wrong status code) diverges at PLAYER_SHOT_STATUS", () => {
  // Broken twin of retirePlayerShot that stamps 0x02 instead of 0x04 into the shot-status cell, then
  // deactivates the prize. Mutates the real logic, not a post-hoc overwrite.
  function loc_1545_broken(m) {
    m.mem8[PLAYER_SHOT_STATUS] = 0x02; // BUG: wrong status code
    m.mem8[PLAYER_SHOT_HIT] = 0;
    const v = m.mem8[SOUND_PORT3_SHADOW] & 0xf7;
    m.mem8[SOUND_PORT3_SHADOW] = v;
    m.io.portOut(0x03, v);
    return (m.regs.a = v);
  }
  const seed = (m) => {
    m.regs.sp = 0x2400;
    m.mem.write8(PLAYER_SHOT_STATUS, 0x01);
    m.mem.write8(PLAYER_SHOT_HIT, 0x01);
    m.mem.write8(SOUND_PORT3_SHADOW, 0x0f);
  };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o); loc_1545_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong status code");
  assert.equal(d.addr, PLAYER_SHOT_STATUS & 0xffff, "divergence is the shot-status cell");
});
