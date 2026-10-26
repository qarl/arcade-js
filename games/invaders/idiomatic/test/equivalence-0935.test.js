// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for awardExtraShip -- the reserve-ship award: bail unless the active player's flag byte is set
// and its tally has reached the port-2-selected threshold; then bump the stored count, redraw the reserve-ship
// column (RESERVE_SHIP_SPRITE) and lives digit, clear the flag, seat SFX_OFF_TIMER, and cue the award sound
// (startSound). Every m.call is DISSOLVED into a direct idiomatic call (activePlayerFlagPtr, currentPlayerRecordPtr,
// readActivePlayerPageTopByte, drawSpriteColumn, drawLivesDigit, and the tail startSound). Live-out is memory
// only -- the caller (loc_081f) reads no register or flag on return. This is a GAMEPLAY-ONLY routine: its
// caller loc_081f is not reached within the attract-mode frame budget (the engine hits a translation gap
// before real play), so CAPTURE is empty by design and the CRAFTED arm carries the proof.
// Run: node --test games/invaders/idiomatic/test/equivalence-0935.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0935 as oracleBody } from "../../translated/loc_0935.js";
import { awardExtraShip } from "../awardExtraShip.js";
import { u8 } from "../../../../core/int.js";
import { activePlayerFlagPtr } from "../activePlayerFlagPtr.js";
import { currentPlayerRecordPtr } from "../currentPlayerRecordPtr.js";
import { readActivePlayerPageTopByte } from "../readActivePlayerPageTopByte.js";
import { drawSpriteColumn } from "../drawSpriteColumn.js";
import { drawLivesDigit } from "../drawLivesDigit.js";
import { startSound } from "../startSound.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { loc_20e7, PLAYER1_OBJ_DESC, ACTIVE_PLAYER_PAGE,
  SFX_OFF_TIMER, SOUND_PORT3_SHADOW, LIVES_DIGIT_SCREEN_ADDR, RESERVE_SHIP_SPRITE } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0935;
const CALLER_RET = 0xabcd;

// Player-1 record page 0x21: bit0 set -> activePlayerFlagPtr = loc_20e7, currentPlayerRecordPtr = PLAYER1_OBJ_DESC,
// active-page base 0x2100 (top byte at 0x21ff). Flag byte the routine tests sits at loc_20e7 - 2.
const FLAG = loc_20e7 - 2;
const TALLY = PLAYER1_OBJ_DESC + 1;
const PAGE_TOP = 0x21ff;
function seedAward(m) {
  m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false);
  m.mem.write8(ACTIVE_PLAYER_PAGE, 0x21);
  m.mem.write8(FLAG, 0x01);       // flag set -> proceed
  m.mem.write8(TALLY, 0xff);      // tally well above either threshold
  m.mem.write8(PAGE_TOP, 0x03);   // stored count -> becomes 4 after the bump
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x0935 dispatches -- awardExtraShip == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x20 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); awardExtraShip(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked (gameplay-only; 0 expected in attract)`);
});

test("CRAFTED: threshold reached -> count bumped, column + digit drawn, flag cleared, sound cued", () => {
  const o = new Machine(ROM); seedAward(o);
  const c = new Machine(ROM); seedAward(c);
  oracle(o); awardExtraShip(c);
  assert.equal(ramDiff(o, c), null, "oracle and module leave identical RAM (-stack)");
  assert.equal(c.mem.read8(PAGE_TOP), 0x04, "stored count incremented (action path ran)");
  assert.equal(c.mem.read8(FLAG), 0x00, "flag cleared");
  assert.equal(c.mem.read8(SFX_OFF_TIMER), 0xff, "SFX off-timer seated");
  assert.notEqual(c.mem.read8(SOUND_PORT3_SHADOW) & 0x10, 0, "award sound bit set");
  // non-vacuous draw: the lives-digit glyph left set pixels
  let drew = 0;
  for (let i = 0; i < 8; i++) drew |= c.mem.read8((LIVES_DIGIT_SCREEN_ADDR + i * 0x20) & 0xffff);
  assert.notEqual(drew, 0, "lives digit plotted");
  assert.equal(c.mem.read8(FLAG), o.mem.read8(FLAG), "flag matches oracle");
});

test("CRAFTED: flag clear -> early return, nothing touched", () => {
  const seed = (m) => { m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false);
    m.mem.write8(ACTIVE_PLAYER_PAGE, 0x21); m.mem.write8(FLAG, 0x00); m.mem.write8(SFX_OFF_TIMER, 0xaa); };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o); awardExtraShip(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(c.mem.read8(SFX_OFF_TIMER), 0xaa, "no side effects on the bail path");
});

test("CRAFTED: tally below threshold -> early return", () => {
  const seed = (m) => { m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false);
    m.mem.write8(ACTIVE_PLAYER_PAGE, 0x21); m.mem.write8(FLAG, 0x01); m.mem.write8(TALLY, 0x00);
    m.mem.write8(PAGE_TOP, 0x03); m.mem.write8(SFX_OFF_TIMER, 0xaa); };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o); awardExtraShip(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(c.mem.read8(SFX_OFF_TIMER), 0xaa, "no award below threshold");
  assert.equal(c.mem.read8(PAGE_TOP), 0x03, "count untouched below threshold");
});

test("CRAFTED: port2-bit3 threshold-select is discriminated (tally 0x12 straddles 0x10/0x15)", () => {
  const seed = (m, in2) => { m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false);
    m.io.in2 = in2; m.mem.write8(ACTIVE_PLAYER_PAGE, 0x21); m.mem.write8(FLAG, 0x01);
    m.mem.write8(TALLY, 0x12); m.mem.write8(PAGE_TOP, 0x03); m.mem.write8(SFX_OFF_TIMER, 0xaa); };
  const run = (in2) => { const o = new Machine(ROM); seed(o, in2); const c = new Machine(ROM); seed(c, in2);
    oracle(o); awardExtraShip(c);
    assert.equal(ramDiff(o, c), null, `bit3=0x${in2.toString(16)}: module == oracle`);
    return { oTop: o.mem.read8(PAGE_TOP), cTop: c.mem.read8(PAGE_TOP) }; };
  const set = run(0x08), clr = run(0x00);
  // tally 0x12 sits between the two selected thresholds, so the award fires in exactly one case --
  // else the arm is vacuous and cannot discriminate a swap of 0x10/0x15 (or a wrong port/mask).
  assert.notEqual(set.oTop, clr.oTop, "tally 0x12 must straddle the two thresholds");
  assert.equal(set.cTop, set.oTop, "bit3 set: module tracks the oracle award decision");
  assert.equal(clr.cTop, clr.oTop, "bit3 clear: module tracks the oracle award decision");
});

test("TEETH: a module-mutating twin (lives digit off by one) diverges in RAM", () => {
  // Real module shape, one broken step: draws the digit for `count` instead of count+1.
  function loc_0935_broken(m) {
    const flagPtr = activePlayerFlagPtr(m);
    if (m.mem8[flagPtr - 2] === 0) return;
    const threshold = (m.io.portIn(0x02) & 0x08) ? 0x10 : 0x15;
    const tally = m.mem8[currentPlayerRecordPtr(m) + 1];
    if (tally < threshold) return;
    const [countPtr] = readActivePlayerPageTopByte(m);
    m.mem8[countPtr] = u8(m.mem8[countPtr] + 1);
    const count = m.mem8[countPtr];
    let hi = u8(LIVES_DIGIT_SCREEN_ADDR >> 8);
    let n = count;
    do { hi = u8(hi + 2); n = u8(n - 1); } while (n !== 0);
    drawSpriteColumn(m, (hi << 8) | (LIVES_DIGIT_SCREEN_ADDR & 0xff), RESERVE_SHIP_SPRITE, 0x10);
    drawLivesDigit(m, count); // BUG: should be count + 1
    m.mem8[activePlayerFlagPtr(m) - 2] = 0x00;
    m.mem8[SFX_OFF_TIMER] = 0xff;
    return startSound(m, 0x10);
  }
  const o = new Machine(ROM); seedAward(o);
  const c = new Machine(ROM); seedAward(c);
  oracle(o); loc_0935_broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch an off-by-one lives digit");
});
