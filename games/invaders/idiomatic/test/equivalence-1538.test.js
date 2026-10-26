// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for tickAlienExplosionDespawn -- tick the prize despawn timer; while it still counts, do nothing;
// on expiry clear the prize's screen column via clearSpriteColumn (its m.call DISSOLVED) then run the shared
// deactivation tail retirePlayerShot (also DISSOLVED). Live-out: RAM (the timer cell, the cleared column, the
// tail's cells); on the expiry path also HL (column end) and A (the tail's masked value). The still-
// counting path leaves HL/A dead (no caller reads them), so only RAM is compared there. The oracle's
// per-call push residue on the expiry path sits below the entry SP and is excluded from the RAM diff.
// Run: node --test games/invaders/idiomatic/test/equivalence-1538.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1538 as oracleBody } from "../../translated/loc_1538.js";
import { tickAlienExplosionDespawn } from "../tickAlienExplosionDespawn.js";
import { retirePlayerShot } from "../retirePlayerShot.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { ALIEN_EXPLOSION_TIMER, ALIEN_EXPLOSION_ADDR, PLAYER_SHOT_STATUS, PLAYER_SHOT_HIT, SOUND_PORT3_SHADOW } from "../names.js";
import { u16 } from "../../../../core/int.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1538;

// The fold clearSpriteColumn seats the blit through (coordToScreenAddr): shift right 3, force H into the window.
const foldAddr = (hl) => {
  const s = hl >> 3;
  return (((((s >> 8) & 0x3f) | 0x20) << 8) | (s & 0xff)) & 0xffff;
};

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1538 dispatches -- tickAlienExplosionDespawn == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); tickAlienExplosionDespawn(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED still-counting: timer 0x05 -> 0x04, nothing else touched", () => {
  const seed = (m) => { m.regs.sp = 0x2400; m.mem.write8(ALIEN_EXPLOSION_TIMER, 0x05); };
  const o = new Machine(ROM); seed(o); o.io.setInte(false);
  const c = new Machine(ROM); seed(c); c.io.setInte(false);
  oracle(o); tickAlienExplosionDespawn(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(c.mem.read8(ALIEN_EXPLOSION_TIMER), 0x04, "timer decremented, still counting");
});

test("CRAFTED expiry: timer 0x01 -> 0x00, column cleared, tail runs; HL + A live-out", () => {
  const prizePos = 0x2000;          // raw coord; clearSpriteColumn folds it into video RAM (-> 0x2400)
  const base = foldAddr(prizePos);
  const seed = (m) => {
    m.regs.sp = 0x2400;
    m.mem.write8(ALIEN_EXPLOSION_TIMER, 0x01);
    m.mem.write16(ALIEN_EXPLOSION_ADDR, prizePos);
    m.mem.write8(PLAYER_SHOT_HIT, 0x01);
    m.mem.write8(SOUND_PORT3_SHADOW, 0xff);
    for (let i = 0; i < 0x10; i++) { // pre-dirty the 16-row, two-column strip so the clear is observable
      m.mem.write8(u16(base + i * 0x20), 0xff);
      m.mem.write8(u16(base + i * 0x20 + 1), 0xff);
    }
  };
  const o = new Machine(ROM); seed(o); o.io.setInte(false);
  const c = new Machine(ROM); seed(c); c.io.setInte(false);
  oracle(o); tickAlienExplosionDespawn(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(c.mem.read8(ALIEN_EXPLOSION_TIMER), 0x00, "timer expired");
  assert.equal(c.mem.read8(base), 0x00, "column col0 cleared");
  assert.equal(c.mem.read8(u16(base + 1)), 0x00, "column col1 cleared");
  assert.equal(c.mem.read8(u16(base + 0x0f * 0x20)), 0x00, "last row col0 cleared");
  assert.equal(c.mem.read8(PLAYER_SHOT_STATUS), 0x04, "shot status set by the tail");
  assert.equal(c.mem.read8(PLAYER_SHOT_HIT), 0x00, "prize deactivated by the tail");
  assert.equal(c.mem.read8(SOUND_PORT3_SHADOW), 0xff & 0xf7, "sound bit masked by the tail");
  assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches oracle");
  assert.equal(c.regs.hl, u16(base + 0x10 * 0x20), "HL at column end");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches oracle");
  assert.equal(c.regs.a, 0xff & 0xf7, "A = masked sound value");
});

test("TEETH: a module-mutating twin (skips the column clear on expiry) diverges in RAM", () => {
  // Broken twin of tickAlienExplosionDespawn: on expiry it jumps straight to the deactivation tail, never clearing the
  // prize's screen column -- the dirtied strip survives.
  const loc_1538_broken = (m) => {
    m.mem8[ALIEN_EXPLOSION_TIMER] = m.mem8[ALIEN_EXPLOSION_TIMER] - 1;
    if (m.mem8[ALIEN_EXPLOSION_TIMER] !== 0) return;
    return retirePlayerShot(m); // BUG: dropped the column clear
  };
  const prizePos = 0x2000;
  const base = foldAddr(prizePos);
  const seed = (m) => {
    m.regs.sp = 0x2400;
    m.mem.write8(ALIEN_EXPLOSION_TIMER, 0x01);
    m.mem.write16(ALIEN_EXPLOSION_ADDR, prizePos);
    m.mem.write8(PLAYER_SHOT_HIT, 0x01);
    m.mem.write8(SOUND_PORT3_SHADOW, 0xff);
    for (let i = 0; i < 0x10; i++) {
      m.mem.write8(u16(base + i * 0x20), 0xff);
      m.mem.write8(u16(base + i * 0x20 + 1), 0xff);
    }
  };
  const o = new Machine(ROM); seed(o); o.io.setInte(false);
  const c = new Machine(ROM); seed(c); c.io.setInte(false);
  oracle(o); loc_1538_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a skipped column clear");
  assert.equal(d.addr, base & 0xffff, "diverges at the uncleared column");
});
