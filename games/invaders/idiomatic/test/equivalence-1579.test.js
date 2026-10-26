// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for markSaucerHitAndRetireShot -- raise the prize-landed flag to 1, then run the shared prize-
// deactivation tail retirePlayerShot (its m.call DISSOLVED): set the shot status, clear the prize-active flag,
// and mask a bit off the sound shadow. Live-out: those cells (RAM) plus A (the masked sound value the
// tail returns). Neither side pushes, so the RAM diff needs no stack allowance (kept for symmetry).
// Each side runs on a fresh clone with interrupts disabled.
// Run: node --test games/invaders/idiomatic/test/equivalence-1579.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1579 as oracleBody } from "../../translated/loc_1579.js";
import { markSaucerHitAndRetireShot } from "../markSaucerHitAndRetireShot.js";
import { retirePlayerShot } from "../retirePlayerShot.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { SAUCER_HIT, PLAYER_SHOT_STATUS, PLAYER_SHOT_HIT, SOUND_PORT3_SHADOW } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1579;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1579 dispatches -- markSaucerHitAndRetireShot == oracle in RAM (-stack) and A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); markSaucerHitAndRetireShot(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: flag:=1, shot status:=4, prize cleared, sound bit masked; A = masked value", () => {
  for (const shadow of [0xff, 0x3c, 0x08, 0xaa]) {
    const seed = (m) => {
      m.regs.sp = 0x2400;
      m.mem.write8(SAUCER_HIT, 0x00);
      m.mem.write8(PLAYER_SHOT_STATUS, 0x00);
      m.mem.write8(PLAYER_SHOT_HIT, 0x01);
      m.mem.write8(SOUND_PORT3_SHADOW, shadow);
    };
    const o = new Machine(ROM); seed(o); o.io.setInte(false);
    const c = new Machine(ROM); seed(c); c.io.setInte(false);
    oracle(o); markSaucerHitAndRetireShot(c);
    const tag = `shadow=0x${shadow.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.mem.read8(SAUCER_HIT), 0x01, `flag set: ${tag}`);
    assert.equal(c.mem.read8(PLAYER_SHOT_STATUS), 0x04, `shot status set: ${tag}`);
    assert.equal(c.mem.read8(PLAYER_SHOT_HIT), 0x00, `prize deactivated: ${tag}`);
    assert.equal(c.mem.read8(SOUND_PORT3_SHADOW), shadow & 0xf7, `sound bit masked: ${tag}`);
    assert.equal(c.regs.a, shadow & 0xf7, `A = masked result: ${tag}`);
    assert.equal(c.regs.a, o.regs.a, `A matches oracle: ${tag}`);
  }
});

test("TEETH: a module-mutating twin (leaves the flag at 0) diverges in RAM", () => {
  // Broken twin of markSaucerHitAndRetireShot: writes 0 to the prize-landed flag instead of 1, then runs the same tail.
  const loc_1579_broken = (m) => { m.mem8[SAUCER_HIT] = 0x00; return retirePlayerShot(m); };
  const seed = (m) => {
    m.regs.sp = 0x2400;
    m.mem.write8(SAUCER_HIT, 0x00);
    m.mem.write8(PLAYER_SHOT_HIT, 0x01);
    m.mem.write8(SOUND_PORT3_SHADOW, 0xff);
  };
  const o = new Machine(ROM); seed(o); o.io.setInte(false);
  const c = new Machine(ROM); seed(c); c.io.setInte(false);
  oracle(o); loc_1579_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a wrong flag value");
  assert.equal(d.addr, SAUCER_HIT & 0xffff, "diverges at the prize-landed flag");
});
