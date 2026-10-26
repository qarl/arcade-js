// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for stepFleetMarchSound (ROM 0x1740) -- the per-frame shot-sound step. Ticks the FLEET_SOUND_OFF_TIMER
// burst timer (calling the sound-off helper silenceFleetMarchNote at zero), bails unless FLEET_MARCH_ENABLE is set, ticks
// FLEET_SOUND_TIMER, emits SOUND_PORT5_SHADOW to port 5, and when ALIEN_COUNT is set re-seeds FLEET_SOUND_TIMER from
// FLEET_SOUND_PERIOD and reloads FLEET_SOUND_OFF_TIMER=4. A and flags are dead (serviceVblankObjects reloads A on fall-through), so the
// live-out is memory + the port-5 writes. silenceFleetMarchNote is a dissolved direct call. The oracle's `cz` pushes
// a return word into stack scratch; that residue is excluded (below the entry SP, in STACK_SCRATCH or entry-SP relative).
// Run: node --test games/invaders/idiomatic/test/equivalence-1740.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1740 as oracleBody } from "../../translated/loc_1740.js";
import { stepFleetMarchSound } from "../stepFleetMarchSound.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { FLEET_SOUND_OFF_TIMER, FLEET_MARCH_ENABLE, FLEET_SOUND_TIMER, FLEET_SOUND_PERIOD, FLEET_SOUND_STEP, SOUND_PORT5_SHADOW, ALIEN_COUNT } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1740;

// The port writes a routine performs (stepFleetMarchSound's real sound live-out).
function portWritesOf(mm, fn) {
  const writes = [];
  const io = mm.io;
  const orig = io.portOut.bind(io);
  io.portOut = (port, val) => { writes.push([port & 0x07, val & 0xff]); return orig(port, val); };
  try { fn(mm); } finally { io.portOut = orig; }
  return writes;
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1740 dispatches -- stepFleetMarchSound == oracle in RAM (-stack) and port writes", () => {
  for (const cap of CAPS) {
    // The oracle's `cz` push residue sits just below the ENTRY SP; exclude relative to that SP.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    const wo = portWritesOf(o, oracle);
    const wc = portWritesOf(c, stepFleetMarchSound);
    assert.deepEqual(wc, wo, "port writes match the oracle");
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: each arm matches the oracle in RAM and port writes", () => {
  // {b209b, b2068, b2096, b2082, b2097, b2098} exercising every branch.
  const cases = [
    { b209b: 0x01, b2068: 0x00, b2096: 0x05, b2082: 0x00, b2097: 0x11, b2098: 0x33 }, // dcr->0 (cz), then bail via silenceFleetMarchNote (2068==0)
    { b209b: 0x02, b2068: 0x00, b2096: 0x05, b2082: 0x00, b2097: 0x11, b2098: 0x33 }, // no cz, bail via silenceFleetMarchNote (2068==0)
    { b209b: 0x02, b2068: 0x01, b2096: 0x02, b2082: 0x00, b2097: 0x11, b2098: 0x33 }, // 2096 dcr->1: early return, no port
    { b209b: 0x02, b2068: 0x01, b2096: 0x01, b2082: 0x00, b2097: 0x11, b2098: 0x33 }, // 2096 dcr->0, out5, then silenceFleetMarchNote (2082==0)
    { b209b: 0x02, b2068: 0x01, b2096: 0x01, b2082: 0x01, b2097: 0x55, b2098: 0x33 }, // full path: reseed + reload
  ];
  for (const s of cases) {
    const seed = (m) => {
      m.regs.sp = 0x2400;
      m.mem.write8(FLEET_SOUND_OFF_TIMER, s.b209b); m.mem.write8(FLEET_MARCH_ENABLE, s.b2068); m.mem.write8(FLEET_SOUND_TIMER, s.b2096);
      m.mem.write8(ALIEN_COUNT, s.b2082); m.mem.write8(FLEET_SOUND_PERIOD, s.b2097); m.mem.write8(SOUND_PORT5_SHADOW, s.b2098);
    };
    const o = new Machine(ROM); seed(o);
    const c = new Machine(ROM); seed(c);
    const wo = portWritesOf(o, oracle);
    const wc = portWritesOf(c, stepFleetMarchSound);
    const tag = `209b=0x${s.b209b.toString(16)} 2068=0x${s.b2068.toString(16)} 2096=0x${s.b2096.toString(16)} 2082=0x${s.b2082.toString(16)}`;
    assert.deepEqual(wc, wo, `port writes ${tag}`);
    assert.equal(ramDiff(o, c), null, tag);
  }
  // The full-path arm must have reseeded FLEET_SOUND_TIMER from FLEET_SOUND_PERIOD and reloaded FLEET_SOUND_OFF_TIMER.
  const seed = (m) => {
    m.regs.sp = 0x2400;
    m.mem.write8(FLEET_SOUND_OFF_TIMER, 0x02); m.mem.write8(FLEET_MARCH_ENABLE, 0x01); m.mem.write8(FLEET_SOUND_TIMER, 0x01);
    m.mem.write8(ALIEN_COUNT, 0x01); m.mem.write8(FLEET_SOUND_PERIOD, 0x55); m.mem.write8(SOUND_PORT5_SHADOW, 0x33);
  };
  const c = new Machine(ROM); seed(c);
  stepFleetMarchSound(c);
  assert.equal(c.mem.read8(FLEET_SOUND_TIMER), 0x55, "FLEET_SOUND_TIMER reseeded from FLEET_SOUND_PERIOD");
  assert.equal(c.mem.read8(FLEET_SOUND_STEP), 0x01, "FLEET_SOUND_STEP armed");
  assert.equal(c.mem.read8(FLEET_SOUND_OFF_TIMER), 0x04, "FLEET_SOUND_OFF_TIMER reloaded");
});

test("TEETH: a broken twin that reloads the wrong burst count diverges in RAM", () => {
  // Full-strength mutant: reloads FLEET_SOUND_OFF_TIMER with 0x05 instead of 0x04 on the reseed path.
  function loc_1740_broken(m) {
    m.mem8[FLEET_SOUND_OFF_TIMER] = m.mem8[FLEET_SOUND_OFF_TIMER] - 1;
    if (m.mem8[FLEET_SOUND_OFF_TIMER] === 0) { /* cz elided by construction is fine; the full-path seed skips it */ }
    if (m.mem8[FLEET_MARCH_ENABLE] === 0) return;
    m.mem8[FLEET_SOUND_TIMER] = m.mem8[FLEET_SOUND_TIMER] - 1;
    if (m.mem8[FLEET_SOUND_TIMER] !== 0) return;
    m.io.portOut(0x05, m.mem8[SOUND_PORT5_SHADOW]);
    if (m.mem8[ALIEN_COUNT] === 0) return;
    m.mem8[FLEET_SOUND_TIMER] = m.mem8[FLEET_SOUND_PERIOD];
    m.mem8[FLEET_SOUND_STEP] = 0x01;
    m.mem8[FLEET_SOUND_OFF_TIMER] = 0x05; // BUG: should reload 0x04
  }
  const seed = (m) => {
    m.regs.sp = 0x2400;
    m.mem.write8(FLEET_SOUND_OFF_TIMER, 0x02); m.mem.write8(FLEET_MARCH_ENABLE, 0x01); m.mem.write8(FLEET_SOUND_TIMER, 0x01);
    m.mem.write8(ALIEN_COUNT, 0x01); m.mem.write8(FLEET_SOUND_PERIOD, 0x55); m.mem.write8(SOUND_PORT5_SHADOW, 0x33);
  };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o);
  loc_1740_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong burst reload");
  assert.equal(d.addr, FLEET_SOUND_OFF_TIMER & 0xffff);
});
