// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for queueInvaderKillScore (ROM 0x0a5f) -- when the trigger cell (GAME_IN_PROGRESS) is nonzero: sound the
// cue (startSound with bit 0x08), index the 3-entry table via invaderScoreEntryPtr using the passed count, and stamp
// the looked-up byte at SCORE_ADD_VALUE with markers 0x01 at SCORE_ADD_PENDING / 0x00 at SCORE_ADD_VALUE_HI; always return HL=ALIEN_EXPLOSION_SPRITE_DESC.
// Both m.call(0x18fa) and m.call(0x097c) are DISSOLVED into direct idiomatic calls. Input register B (the
// table index); live-out is memory PLUS the returned record pointer HL (the caller feeds it to loadSpriteDescriptor).
// Run: node --test games/invaders/idiomatic/test/equivalence-0a5f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0a5f as oracleBody } from "../../translated/loc_0a5f.js";
import { queueInvaderKillScore } from "../queueInvaderKillScore.js";
import { startSound } from "../startSound.js";
import { invaderScoreEntryPtr } from "../invaderScoreEntryPtr.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { STACK_SCRATCH, GAME_IN_PROGRESS, SCORE_ADD_PENDING, SCORE_ADD_VALUE, SCORE_ADD_VALUE_HI, ALIEN_EXPLOSION_SPRITE_DESC } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0a5f;
const CALLER_RET = 0xabcd;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x0a5f dispatches -- queueInvaderKillScore == oracle in RAM (-stack) and HL live-out", () => {
  for (const cap of CAPS) {
    // The oracle push16s each nested m.call's return word below the entry SP, then tail-rets through the
    // seam; the module never touches the stack. Exclude relative to the entry SP as well as fixed scratch.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off),
      (a) => deadStackBelow(STACK_SCRATCH, sp)(a) || (a != null && a >= sp - 0x10 && a < sp));
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); queueInvaderKillScore(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "returned HL");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: trigger set -> sound + table byte + markers stamped; HL=ALIEN_EXPLOSION_SPRITE_DESC", () => {
  for (const b of [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x7f, 0xff]) {
    const o = new Machine(ROM); const c = new Machine(ROM);
    o.regs.sp = 0x2400; o.push16(CALLER_RET); o.io.setInte(false);
    c.regs.sp = 0x2400; c.push16(CALLER_RET); c.io.setInte(false);
    o.mem.write8(GAME_IN_PROGRESS, 0x01); c.mem.write8(GAME_IN_PROGRESS, 0x01); // trigger set
    o.regs.b = b; c.regs.b = b;
    oracle(o); queueInvaderKillScore(c);
    const label = `B=0x${b.toString(16)}`;
    assert.equal(ramDiff(o, c), null, label);
    assert.equal(c.regs.hl, o.regs.hl, `HL vs oracle ${label}`);
    assert.equal(c.regs.hl, ALIEN_EXPLOSION_SPRITE_DESC & 0xffff, `HL value ${label}`);
    assert.equal(c.mem.read8(SCORE_ADD_PENDING), 0x01, `active marker ${label}`);
    assert.equal(c.mem.read8(SCORE_ADD_VALUE_HI), 0x00, `clear marker ${label}`);
    // the looked-up byte matches the oracle (it reads the table via invaderScoreEntryPtr's clamp of B)
    assert.equal(c.mem.read8(SCORE_ADD_VALUE), o.mem.read8(SCORE_ADD_VALUE), `table byte ${label}`);
    // cross-check: the stamped byte is exactly mem[invaderScoreEntryPtr(B)]
    const probe = new Machine(ROM); probe.regs.a = b;
    assert.equal(c.mem.read8(SCORE_ADD_VALUE), probe.mem.read8(invaderScoreEntryPtr(probe, b)), `table byte value ${label}`);
  }
});

test("CRAFTED: trigger clear -> no markers, no sound; HL=ALIEN_EXPLOSION_SPRITE_DESC", () => {
  const o = new Machine(ROM); const c = new Machine(ROM);
  o.regs.sp = 0x2400; o.push16(CALLER_RET); o.io.setInte(false);
  c.regs.sp = 0x2400; c.push16(CALLER_RET); c.io.setInte(false);
  o.mem.write8(GAME_IN_PROGRESS, 0x00); c.mem.write8(GAME_IN_PROGRESS, 0x00); // trigger clear
  // pre-dirty the markers on both so an accidental write would show up
  for (const a of [SCORE_ADD_PENDING, SCORE_ADD_VALUE, SCORE_ADD_VALUE_HI]) { o.mem.write8(a, 0xaa); c.mem.write8(a, 0xaa); }
  o.regs.b = 0x03; c.regs.b = 0x03;
  oracle(o); queueInvaderKillScore(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(c.regs.hl, ALIEN_EXPLOSION_SPRITE_DESC & 0xffff, "HL still seated");
  assert.equal(c.mem.read8(SCORE_ADD_PENDING), 0xaa, "marker untouched");
});

test("TEETH: a module-mutating twin (drops the 0x01 active marker) is caught", () => {
  // Broken twin of queueInvaderKillScore: omits the SCORE_ADD_PENDING = 0x01 store.
  function queueInvaderKillScore_broken(m, b = m.regs.b) {
    if (m.mem8[GAME_IN_PROGRESS]) {
      startSound(m, 0x08);
      m.mem8[SCORE_ADD_VALUE] = m.mem8[invaderScoreEntryPtr(m, b)];
      // BUG: dropped the active marker at SCORE_ADD_PENDING
      m.mem8[SCORE_ADD_VALUE_HI] = 0x00;
    }
    return (m.regs.hl = ALIEN_EXPLOSION_SPRITE_DESC);
  }
  const o = new Machine(ROM); const c = new Machine(ROM);
  o.regs.sp = 0x2400; o.push16(CALLER_RET); o.io.setInte(false);
  c.regs.sp = 0x2400; c.push16(CALLER_RET); c.io.setInte(false);
  o.mem.write8(GAME_IN_PROGRESS, 0x01); c.mem.write8(GAME_IN_PROGRESS, 0x01);
  o.mem.write8(SCORE_ADD_PENDING, 0xaa); c.mem.write8(SCORE_ADD_PENDING, 0xaa); // pre-dirty so the dropped store shows
  o.regs.b = 0x03; c.regs.b = 0x03;
  oracle(o); queueInvaderKillScore_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a dropped marker store");
  assert.equal(d.addr, SCORE_ADD_PENDING & 0xffff);
});
