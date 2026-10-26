// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for advanceFleetMarchSound (ROM 0x1775) -- the sound-pitch step. When the FLEET_SOUND_STEP trigger is
// set: find the fleet-rate entry for ALIEN_COUNT in the FLEET_RATE_THRESHOLDS/FLEET_RATE_TABLE tables (store the raw byte at
// FLEET_SOUND_PERIOD), step the port-5 pitch nibble in SOUND_PORT5_SHADOW, and clear the trigger. Then tick the
// SFX_OFF_TIMER step timer; on its wrap re-arm the shot channel via clearSoundPort3Bit(B=0xef). clearSoundPort3Bit is a dissolved
// direct call. Live-out: memory + A (the caller does OUT 6, A). A is 0 on the non-wrap path.
// Run: node --test games/invaders/idiomatic/test/equivalence-1775.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1775 as oracleBody } from "../../translated/loc_1775.js";
import { advanceFleetMarchSound } from "../advanceFleetMarchSound.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { FLEET_SOUND_STEP, FLEET_SOUND_PERIOD, SFX_OFF_TIMER, SOUND_PORT5_SHADOW, ALIEN_COUNT } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1775;

// Expected stepped SOUND_PORT5_SHADOW for a seed byte (independent of the ROM tables).
const steppedPitch = (s) => { const x = (s & 0x0f) << 1; return (s & 0x30) | (x === 0x10 ? 0x01 : x); };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1775 dispatches -- advanceFleetMarchSound == oracle in RAM (-stack) and A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); advanceFleetMarchSound(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: trigger-clear ticks the timer; trigger-set latches pitch and clears the trigger", () => {
  // {trig, alive, shadow, timer} across both branches and the wrap.
  const cases = [
    { trig: 0x00, alive: 0x14, shadow: 0x25, timer: 0x02 }, // clear: dec 2099 -> 1, A=0
    { trig: 0x00, alive: 0x14, shadow: 0x25, timer: 0x01 }, // clear: dec 2099 -> 0, re-arm via clearSoundPort3Bit
    { trig: 0x01, alive: 0x37, shadow: 0x00, timer: 0x02 }, // set: pitch step from 0x00
    { trig: 0x01, alive: 0x0b, shadow: 0x08, timer: 0x02 }, // set: nibble 8 -> 0x01
    { trig: 0x01, alive: 0x00, shadow: 0x3f, timer: 0x02 }, // set: nibble 0xf -> 0x1e (| 0x30)
    { trig: 0x01, alive: 0x1c, shadow: 0x25, timer: 0x01 }, // set + wrap: latch then re-arm
  ];
  for (const s of cases) {
    const seed = (m) => {
      m.regs.sp = 0x2400;
      m.mem.write8(FLEET_SOUND_STEP, s.trig); m.mem.write8(ALIEN_COUNT, s.alive);
      m.mem.write8(SOUND_PORT5_SHADOW, s.shadow); m.mem.write8(SFX_OFF_TIMER, s.timer);
    };
    const o = new Machine(ROM); seed(o);
    const c = new Machine(ROM); seed(c);
    oracle(o); advanceFleetMarchSound(c);
    const tag = `trig=0x${s.trig.toString(16)} alive=0x${s.alive.toString(16)} shadow=0x${s.shadow.toString(16)} timer=0x${s.timer.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.regs.a, o.regs.a, `A ${tag}`);
    if (s.trig !== 0) {
      assert.equal(c.mem.read8(SOUND_PORT5_SHADOW), steppedPitch(s.shadow), `pitch ${tag}`);
      assert.equal(c.mem.read8(FLEET_SOUND_STEP), 0x00, `trigger cleared ${tag}`);
      assert.equal(c.mem.read8(FLEET_SOUND_PERIOD), o.mem.read8(FLEET_SOUND_PERIOD), `table byte latched ${tag}`);
    } else {
      assert.equal(c.mem.read8(SOUND_PORT5_SHADOW), s.shadow, `shadow untouched ${tag}`);
    }
  }
});

test("TEETH: a broken twin that drops the pitch step diverges in RAM", () => {
  // Full-strength mutant: forgets to step the pitch nibble (writes the shadow back unchanged).
  function loc_1775_broken(m) {
    if (m.mem8[FLEET_SOUND_STEP] !== 0) {
      const alive = m.mem8[ALIEN_COUNT];
      let i = 0;
      while (alive < m.mem.read8(0x1a11 + i)) i++;
      m.mem8[FLEET_SOUND_PERIOD] = m.mem.read8(0x1a21 + i);
      m.mem8[SOUND_PORT5_SHADOW] = m.mem8[SOUND_PORT5_SHADOW]; // BUG: pitch not stepped
      m.mem8[FLEET_SOUND_STEP] = 0;
    }
    m.mem8[SFX_OFF_TIMER] = m.mem8[SFX_OFF_TIMER] - 1;
    if (m.mem8[SFX_OFF_TIMER] !== 0) return (m.regs.a = 0);
    return m.mem8[SFX_OFF_TIMER];
  }
  const seed = (m) => {
    m.regs.sp = 0x2400;
    m.mem.write8(FLEET_SOUND_STEP, 0x01); m.mem.write8(ALIEN_COUNT, 0x1c);
    m.mem.write8(SOUND_PORT5_SHADOW, 0x25); m.mem.write8(SFX_OFF_TIMER, 0x02);
  };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o);
  loc_1775_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a dropped pitch step");
  assert.equal(d.addr, SOUND_PORT5_SHADOW & 0xffff);
});
