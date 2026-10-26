// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawTaitoCopyright -- a one-shot flag + two-code port-1 gate that, when both codes match,
// tail-jumps into the sprite-list driver (DISSOLVED into a direct drawSpriteList(m, list, count, dst)). The only
// live-out is RAM: A/flags/HL/DE/C are all dead in the single caller chain (updateFleetAndDrawCopyright -> runAttractCycle reads A
// only for the OUT-6 watchdog kick then immediately overwrites it via isArmTriggerSet), so this compares RAM only.
// Interrupts are disabled so the oracle's per-instruction ticks cannot fire a handler that writes RAM on
// only one side.
// Run: node --test games/invaders/idiomatic/test/equivalence-199a.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_199a as oracleBody } from "../../translated/loc_199a.js";
import { drawTaitoCopyright } from "../drawTaitoCopyright.js";
import { drawSpriteList } from "../drawSpriteList.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x199a;
const FLAG = 0x201e;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x199a dispatches -- drawTaitoCopyright == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    // The oracle's tail drawSpriteList push/pop residue sits just below the ENTRY SP; exclude relative to it.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); drawTaitoCopyright(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: tail draws the sprite list; the 0x72 code bumps the flag; a miss is a no-op", () => {
  // TAIL: flag already set (jnz arm) + port-1 code 0x34 -> draw the 9-sprite list.
  {
    const o = new Machine(ROM); o.io.setInte(false); o.regs.sp = 0x2400; o.mem.write8(FLAG, 0x05); o.io.in1 = 0x34;
    const c = new Machine(ROM); c.io.setInte(false); c.regs.sp = 0x2400; c.mem.write8(FLAG, 0x05); c.io.in1 = 0x34;
    oracle(o); drawTaitoCopyright(c);
    assert.equal(ramDiff(o, c), null, "tail");
    assert.equal(c.mem.read8(0x2e3b), 0x40, "sprite list drawn (first nonzero cell)");
    assert.equal(c.mem.read8(FLAG), 0x05, "flag untouched on the already-armed arm");
  }
  // BUMP: flag zero + first code 0x72 -> arm the flag to 1, then 0x72 != 0x34 -> no draw.
  {
    const o = new Machine(ROM); o.io.setInte(false); o.regs.sp = 0x2400; o.mem.write8(FLAG, 0x00); o.io.in1 = 0x72;
    const c = new Machine(ROM); c.io.setInte(false); c.regs.sp = 0x2400; c.mem.write8(FLAG, 0x00); c.io.in1 = 0x72;
    oracle(o); drawTaitoCopyright(c);
    assert.equal(ramDiff(o, c), null, "bump");
    assert.equal(c.mem.read8(FLAG), 0x01, "flag armed to 1 on the 0x72 code");
  }
  // MISS: flag zero + a code that is neither 0x72 nor 0x34 -> early return, no RAM change.
  {
    const o = new Machine(ROM); o.io.setInte(false); o.regs.sp = 0x2400; o.mem.write8(FLAG, 0x00); o.io.in1 = 0x00;
    const c = new Machine(ROM); c.io.setInte(false); c.regs.sp = 0x2400; c.mem.write8(FLAG, 0x00); c.io.in1 = 0x00;
    oracle(o); drawTaitoCopyright(c);
    assert.equal(ramDiff(o, c), null, "miss");
    assert.equal(c.mem.read8(FLAG), 0x00, "flag not armed (code did not match)");
  }
});

test("TEETH: a module-mutating twin (arms the flag to the wrong value) diverges in RAM", () => {
  // Broken twin of drawTaitoCopyright: on the 0x72 code it stores 2 into the flag instead of 1.
  function loc_199a_broken(m) {
    if (m.mem8[FLAG] === 0) {
      if ((m.io.portIn(0x01) & 0x76) !== 0x72) return;
      m.mem8[FLAG] = 2; // BUG: the ROM arms the flag to 1
    }
    if ((m.io.portIn(0x01) & 0x76) !== 0x34) return;
    return drawSpriteList(m, 0x0bf7, 0x09, 0x2e1b);
  }
  const o = new Machine(ROM); o.io.setInte(false); o.regs.sp = 0x2400; o.mem.write8(FLAG, 0x00); o.io.in1 = 0x72;
  const c = new Machine(ROM); c.io.setInte(false); c.regs.sp = 0x2400; c.mem.write8(FLAG, 0x00); c.io.in1 = 0x72;
  oracle(o); loc_199a_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the diff FAILED to catch the wrong flag value");
  assert.equal(d.addr, FLAG, "first divergence is the armed flag cell");
});
