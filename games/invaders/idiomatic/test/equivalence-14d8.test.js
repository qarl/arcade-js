// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for resolvePlayerShotHit -- the state-2 prize-landing handler: bail unless PLAYER_SHOT_STATUS == 2
// (a 5 also rets); bounds-check the descent (loc_2029), stand the prize down (state 3 + clearShotHitAndSilence) or
// retire it (markSaucerHitAndRetireShot) at the edges; else scale the descriptor coords to grid blocks (stashed at
// ALIEN_EXPLOSION_ADDR), enter state 5, and if the target cell is set blank it, award (queueInvaderKillScore), load the sprite
// descriptor and blit the prize (blitShiftedSprite), and arm the despawn timer (ALIEN_EXPLOSION_TIMER). Every m.call is
// DISSOLVED into a direct idiomatic call (clearShotHitAndSilence, markSaucerHitAndRetireShot, scaleXToBlock, scaleYToBlock,
// alienGridCellPtr, queueInvaderKillScore, loadSpriteDescriptor, blitShiftedSprite). Live-out is memory only -- no caller reads a
// register or flag on return (resolveShotAndFleetEdge tail-jumps into reverseFleetAtEdge, which reloads A first; loc_16e6 overwrites B).
// Run: node --test games/invaders/idiomatic/test/equivalence-14d8.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_14d8 as oracleBody } from "../../translated/loc_14d8.js";
import { resolvePlayerShotHit } from "../resolvePlayerShotHit.js";
import { u8 } from "../../../../core/int.js";
import { clearShotHitAndSilence } from "../clearShotHitAndSilence.js";
import { markSaucerHitAndRetireShot } from "../markSaucerHitAndRetireShot.js";
import { scaleXToBlock } from "../scaleXToBlock.js";
import { scaleYToBlock } from "../scaleYToBlock.js";
import { alienGridCellPtr } from "../alienGridCellPtr.js";
import { queueInvaderKillScore } from "../queueInvaderKillScore.js";
import { loadSpriteDescriptor } from "../loadSpriteDescriptor.js";
import { blitShiftedSprite } from "../blitShiftedSprite.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { PLAYER_SHOT_STATUS, PLAYER_SHOT_HIT, SAUCER_HIT, ACTIVE_PLAYER_PAGE,
  GAME_IN_PROGRESS, loc_2009, loc_200a, loc_2029, loc_202a, ALIEN_EXPLOSION_ADDR, ALIEN_EXPLOSION_TIMER } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x14d8;
const CALLER_RET = 0xabcd;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 1500) : [];

test("CAPTURE: real 0x14d8 dispatches -- resolvePlayerShotHit == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x20 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); resolvePlayerShotHit(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seatCaller(m) { m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false); }

test("CRAFTED: state != 2 (and the 5 early-out) -> return, nothing touched", () => {
  for (const st of [0x00, 0x01, 0x05, 0x07]) {
    const seed = (m) => { seatCaller(m); m.mem.write8(PLAYER_SHOT_STATUS, st); m.mem.write8(PLAYER_SHOT_HIT, 0xaa); };
    const o = new Machine(ROM); seed(o);
    const c = new Machine(ROM); seed(c);
    oracle(o); resolvePlayerShotHit(c);
    assert.equal(ramDiff(o, c), null, `state=0x${st.toString(16)}`);
    assert.equal(c.mem.read8(PLAYER_SHOT_HIT), 0xaa, `no side effects: state=0x${st.toString(16)}`);
  }
});

test("CRAFTED: state 2, descent past 0xd8 -> stand down (state 3, prize deactivated)", () => {
  const seed = (m) => { seatCaller(m); m.mem.write8(PLAYER_SHOT_STATUS, 0x02);
    m.mem.write8(loc_2029, 0xe0); m.mem.write8(PLAYER_SHOT_HIT, 0x01); };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o); resolvePlayerShotHit(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(c.mem.read8(PLAYER_SHOT_STATUS), 0x03, "state forced to 3");
  assert.equal(c.mem.read8(PLAYER_SHOT_HIT), 0x00, "prize deactivated");
});

test("CRAFTED: state 2, prize inactive -> return", () => {
  const seed = (m) => { seatCaller(m); m.mem.write8(PLAYER_SHOT_STATUS, 0x02);
    m.mem.write8(loc_2029, 0x40); m.mem.write8(PLAYER_SHOT_HIT, 0x00); };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o); resolvePlayerShotHit(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(c.mem.read8(PLAYER_SHOT_STATUS), 0x02, "state untouched");
});

test("CRAFTED: state 2, descent in [0xce,0xd8) -> mark exiting and retire", () => {
  const seed = (m) => { seatCaller(m); m.mem.write8(PLAYER_SHOT_STATUS, 0x02);
    m.mem.write8(loc_2029, 0xd0); m.mem.write8(PLAYER_SHOT_HIT, 0x01); };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o); resolvePlayerShotHit(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(c.mem.read8(SAUCER_HIT), 0x01, "exit flag raised");
  assert.equal(c.mem.read8(PLAYER_SHOT_HIT), 0x00, "prize deactivated by retire");
});

function seedCommit(m) {
  seatCaller(m);
  m.mem.write8(PLAYER_SHOT_STATUS, 0x02);
  m.mem.write8(loc_2029, 0x40);   // descent well below 0xce
  m.mem.write8(PLAYER_SHOT_HIT, 0x01);
  m.mem.write8(loc_2009, 0xff);   // gate >= 0x90 (skip the cmp bail); also scaleX threshold
  m.mem.write8(loc_200a, 0xff);   // scaleY threshold
  m.mem.write8(loc_202a, 0x30);   // Y coord source
  m.mem.write8(ACTIVE_PLAYER_PAGE, 0x21);
  m.mem.write8(GAME_IN_PROGRESS, 0x00); // keep queueInvaderKillScore on its no-op branch
  for (let a = 0x2100; a < 0x2200; a++) m.mem.write8(a, 0x7f); // record cells nonzero -> commit path
}

test("CRAFTED: state 2, full commit -> block stashed, state 5, sprite blitted, despawn armed", () => {
  const o = new Machine(ROM); seedCommit(o);
  const c = new Machine(ROM); seedCommit(c);
  oracle(o); resolvePlayerShotHit(c);
  assert.equal(ramDiff(o, c), null, "oracle and module leave identical RAM (-stack)");
  assert.equal(c.mem.read8(PLAYER_SHOT_STATUS), 0x05, "state advanced to 5");
  assert.equal(c.mem.read8(ALIEN_EXPLOSION_TIMER), 0x10, "despawn timer armed");
  assert.equal(c.mem.read16(ALIEN_EXPLOSION_ADDR), o.mem.read16(ALIEN_EXPLOSION_ADDR), "grid-block word matches oracle");
});

test("CRAFTED: state 2, gate in [key,0x90) -> gate-compare stand down (before state 5)", () => {
  // coord 0x40 -> key 0x46; gate 0x50 is < 0x90 AND >= key, so the gate-compare stand-down fires.
  const seed = (m) => { seatCaller(m); m.mem.write8(PLAYER_SHOT_STATUS, 0x02);
    m.mem.write8(loc_2029, 0x40); m.mem.write8(PLAYER_SHOT_HIT, 0x01);
    m.mem.write8(loc_2009, 0x50); m.mem.write8(loc_200a, 0xff); m.mem.write8(loc_202a, 0x30);
    m.mem.write8(ACTIVE_PLAYER_PAGE, 0x21); };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o); resolvePlayerShotHit(c);
  assert.equal(ramDiff(o, c), null, "module tracks oracle on the gate-compare stand-down path");
  assert.equal(c.mem.read8(PLAYER_SHOT_STATUS), o.mem.read8(PLAYER_SHOT_STATUS), "state matches oracle");
  assert.equal(o.mem.read8(PLAYER_SHOT_STATUS), 0x03, "gate-compare stand down forces state 3 (not the 0xff-gate commit)");
});

test("CRAFTED: state 2, commit path with a zero record cell -> stand down after entering state 5", () => {
  // Same commit seed as seedCommit but record cells ZERO: after state->5 the recPtr==0 bail must fire.
  const seed = (m) => { seedCommit(m); for (let a = 0x2100; a < 0x2200; a++) m.mem.write8(a, 0x00); };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o); resolvePlayerShotHit(c);
  assert.equal(ramDiff(o, c), null, "module tracks oracle on the post-state-5 zero-record bail");
  assert.equal(c.mem.read8(PLAYER_SHOT_STATUS), o.mem.read8(PLAYER_SHOT_STATUS), "state matches oracle");
  assert.notEqual(o.mem.read8(ALIEN_EXPLOSION_TIMER), 0x10, "the zero-record bail skips the despawn-arm the full commit does");
});

test("TEETH: a module-mutating twin (grid-block bytes swapped) diverges at ALIEN_EXPLOSION_ADDR", () => {
  // Real module shape, one broken step: writes the block word with X/Y residuals swapped.
  function loc_14d8_broken(m) {
    const standDown = () => { m.mem8[PLAYER_SHOT_STATUS] = 0x03; return clearShotHitAndSilence(m); };
    const state = m.mem8[PLAYER_SHOT_STATUS];
    if (state === 0x05) return;
    if (state !== 0x02) return;
    const coord = m.mem8[loc_2029];
    if (coord >= 0xd8) return standDown();
    if (m.mem8[PLAYER_SHOT_HIT] === 0) return;
    if (coord >= 0xce) return markSaucerHitAndRetireShot(m);
    const key = u8(coord + 0x06);
    const gate = m.mem8[loc_2009];
    if (gate < 0x90 && gate >= key) return standDown();
    const [, residualX, xBlock] = scaleXToBlock(m, key);
    const [, residualY] = scaleYToBlock(m, m.mem8[loc_202a]);
    m.mem16[ALIEN_EXPLOSION_ADDR] = (residualX << 8) | residualY; // BUG: residuals swapped (should be Y<<8 | X)
    m.mem8[PLAYER_SHOT_STATUS] = 0x05;
    const recPtr = alienGridCellPtr(m, xBlock);
    if (m.mem8[recPtr] === 0) return standDown();
    m.mem8[recPtr] = 0x00;
    loadSpriteDescriptor(m, queueInvaderKillScore(m, xBlock));
    blitShiftedSprite(m);
    m.mem8[ALIEN_EXPLOSION_TIMER] = 0x10;
  }
  const o = new Machine(ROM); seedCommit(o);
  const c = new Machine(ROM); seedCommit(c);
  oracle(o); loc_14d8_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a swapped grid-block word");
  assert.equal(d.addr, ALIEN_EXPLOSION_ADDR & 0xffff, "first divergence is the low byte of the grid-block word");
});
