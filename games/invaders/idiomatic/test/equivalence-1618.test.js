// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for advanceRoundState (ROM 0x1618) -- gated pre-round advance: bail unless the round is armed
// (loc_2015==0xff) and GAME_OBJECT_TABLE/loc_2011/PLAYER_SHOT_STATUS are clear, then step the march pointer (ATTRACT_DEMO_PTR ->
// DEMO_SHIP_DIR) or latch/clear the fire input. Live-out is memory only. Dissolves the 0x17c0 input read.
// Run: node --test games/invaders/idiomatic/test/equivalence-1618.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1618 as oracleBody } from "../../translated/loc_1618.js";
import { advanceRoundState } from "../advanceRoundState.js";
import { readActivePlayerInput } from "../readActivePlayerInput.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { u16 } from "../../../../core/int.js";
import {
  ACTIVE_PLAYER_PAGE,
  GAME_OBJECT_TABLE, loc_2011, loc_2015, DEMO_SHIP_DIR, PLAYER_SHOT_STATUS, FIRE_BUTTON_LATCH, ATTRACT_DEMO_PTR, GAME_IN_PROGRESS,
} from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1618;

// A module-mutating broken twin: never wrap the march pointer's low byte back into the window.
function brokenLoc_1618(m) {
  if (m.mem8[loc_2015] !== 0xff) return;
  if (m.mem8[GAME_OBJECT_TABLE] !== 0 || m.mem8[loc_2011] !== 0) return;
  if (m.mem8[PLAYER_SHOT_STATUS] !== 0) return;
  if (m.mem8[GAME_IN_PROGRESS] === 0) {
    m.mem8[PLAYER_SHOT_STATUS] = 0x01;
    const ptr = u16(m.mem16[ATTRACT_DEMO_PTR] + 1); // BUG: dropped the >=0x7e wrap
    m.mem16[ATTRACT_DEMO_PTR] = ptr;
    m.mem8[DEMO_SHIP_DIR] = m.mem8[ptr];
    return;
  }
  if (m.mem8[FIRE_BUTTON_LATCH] !== 0) {
    const fire = readActivePlayerInput(m) & 0x10;
    if (fire !== 0) return;
    m.mem8[FIRE_BUTTON_LATCH] = fire;
    return;
  }
  if ((readActivePlayerInput(m) & 0x10) === 0) return;
  m.mem8[PLAYER_SHOT_STATUS] = 0x01;
  m.mem8[FIRE_BUTTON_LATCH] = 0x01;
}

// Seed the guards to PASS, then apply per-scenario overrides. fire seeds player-1 input port bit 0x10.
function mk(over = {}) {
  const build = () => {
    const m = new Machine(ROM);
    m.regs.sp = 0x2400; // valid stack: the oracle's 0x17c0 input-read call pushes a return word (lands in STACK_SCRATCH)
    m.mem.write8(loc_2015, over.g2015 ?? 0xff);
    m.mem.write8(GAME_OBJECT_TABLE, over.g2010 ?? 0x00);
    m.mem.write8(loc_2011, over.g2011 ?? 0x00);
    m.mem.write8(PLAYER_SHOT_STATUS, over.g2025 ?? 0x00);
    m.mem.write8(GAME_IN_PROGRESS, over.ef ?? 0x00);
    m.mem.write8(FIRE_BUTTON_LATCH, over._2d ?? 0x00);
    if (over.ed != null) m.mem.write16(ATTRACT_DEMO_PTR, over.ed);
    if (over.mem) for (const [a, v] of over.mem) m.mem.write8(a, v);
    if (over.fire != null) { m.mem.write8(ACTIVE_PLAYER_PAGE, 0x01); m.io.in1 = over.fire; }
    return m;
  };
  return [build(), build()];
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1618 dispatches -- advanceRoundState == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); advanceRoundState(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: guards bail without touching state", () => {
  const scenarios = [
    { name: "not armed", over: { g2015: 0x00 } },
    { name: "field byte 0 set", over: { g2010: 0x01 } },
    { name: "field byte 1 set", over: { g2011: 0x01 } },
    { name: "already advanced", over: { g2025: 0x01 } },
  ];
  for (const { name, over } of scenarios) {
    const [o, c] = mk(over);
    oracle(o); advanceRoundState(c);
    assert.equal(ramDiff(o, c), null, name);
  }
});

test("CRAFTED: 0x20ef==0 steps the march pointer and wraps its low byte at 0x7e", () => {
  // no wrap: low byte stays below 0x7e
  {
    const [o, c] = mk({ ef: 0x00, ed: 0x2c00, mem: [[0x2c01, 0x99]] });
    oracle(o); advanceRoundState(c);
    assert.equal(ramDiff(o, c), null, "no-wrap");
    assert.equal(c.mem.read8(PLAYER_SHOT_STATUS), 0x01);
    assert.equal(c.mem.read16(ATTRACT_DEMO_PTR), 0x2c01);
    assert.equal(c.mem.read8(DEMO_SHIP_DIR), 0x99);
  }
  // wrap: low byte reaches 0x7f (>=0x7e) -> reset to 0x74
  {
    const [o, c] = mk({ ef: 0x00, ed: 0x2c7e, mem: [[0x2c74, 0x88]] });
    oracle(o); advanceRoundState(c);
    assert.equal(ramDiff(o, c), null, "wrap");
    assert.equal(c.mem.read16(ATTRACT_DEMO_PTR), 0x2c74);
    assert.equal(c.mem.read8(DEMO_SHIP_DIR), 0x88);
  }
  // boundary: low byte exactly 0x7e -> reset to 0x74
  {
    const [o, c] = mk({ ef: 0x00, ed: 0x2c7d });
    oracle(o); advanceRoundState(c);
    assert.equal(ramDiff(o, c), null, "boundary");
    assert.equal(c.mem.read16(ATTRACT_DEMO_PTR), 0x2c74);
  }
});

test("CRAFTED: 0x20ef!=0 arms/clears the fire latch by the input bit", () => {
  // 0x202d!=0, fire pressed -> no change
  {
    const [o, c] = mk({ ef: 0x01, _2d: 0x01, fire: 0x10 });
    oracle(o); advanceRoundState(c);
    assert.equal(ramDiff(o, c), null, "latched+pressed");
    assert.equal(c.mem.read8(FIRE_BUTTON_LATCH), 0x01);
    assert.equal(c.mem.read8(PLAYER_SHOT_STATUS), 0x00);
  }
  // 0x202d!=0, fire released -> clear the latch
  {
    const [o, c] = mk({ ef: 0x01, _2d: 0x01, fire: 0x00 });
    oracle(o); advanceRoundState(c);
    assert.equal(ramDiff(o, c), null, "latched+released");
    assert.equal(c.mem.read8(FIRE_BUTTON_LATCH), 0x00);
  }
  // 0x202d==0, fire released -> no change
  {
    const [o, c] = mk({ ef: 0x01, _2d: 0x00, fire: 0x00 });
    oracle(o); advanceRoundState(c);
    assert.equal(ramDiff(o, c), null, "idle+released");
    assert.equal(c.mem.read8(PLAYER_SHOT_STATUS), 0x00);
    assert.equal(c.mem.read8(FIRE_BUTTON_LATCH), 0x00);
  }
  // 0x202d==0, fresh press -> arm the round
  {
    const [o, c] = mk({ ef: 0x01, _2d: 0x00, fire: 0x10 });
    oracle(o); advanceRoundState(c);
    assert.equal(ramDiff(o, c), null, "idle+pressed");
    assert.equal(c.mem.read8(PLAYER_SHOT_STATUS), 0x01);
    assert.equal(c.mem.read8(FIRE_BUTTON_LATCH), 0x01);
  }
});

test("TEETH: a twin that skips the low-byte wrap diverges at DEMO_SHIP_DIR", () => {
  const [o, c] = mk({ ef: 0x00, ed: 0x2c7e, mem: [[0x2c74, 0x11], [0x2c7f, 0x22]] });
  oracle(o); brokenLoc_1618(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch the missing pointer wrap");
  assert.equal(d.addr, DEMO_SHIP_DIR & 0xffff);
});
