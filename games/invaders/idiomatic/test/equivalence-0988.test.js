// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for applyPendingScoreAdd -- on a pending score add, fold the two-byte BCD delta into the active
// player's running total (with the 8080 DAA decimal carry) and redraw it at the record's screen address;
// on a clear pending flag do nothing. The active record pointer is DISSOLVED into currentPlayerRecordPtr
// and the redraw into drawBcdWord. Live-out is RAM only -- the sole non-tail caller (the in-game frame
// loop) reloads A immediately after the call, so no register is compared; the score cells and rendered
// glyphs carry the check. applyPendingScoreAdd is reached only from that in-game loop, which a headless attract run
// does not enter, so CAPTURE finds no natural dispatch and CRAFTED carries the branch coverage. The
// oracle's call/ret residue sits below the entry SP and is excluded from the RAM diff.
// Run: node --test games/invaders/idiomatic/test/equivalence-0988.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0988 as oracleBody } from "../../translated/loc_0988.js";
import { applyPendingScoreAdd } from "../applyPendingScoreAdd.js";
import { currentPlayerRecordPtr } from "../currentPlayerRecordPtr.js";
import { drawBcdWord } from "../drawBcdWord.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { SCORE_ADD_PENDING, SCORE_ADD_VALUE, ACTIVE_PLAYER_PAGE,
  PLAYER1_OBJ_DESC, PLAYER2_OBJ_DESC } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0988;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x0988 dispatches -- applyPendingScoreAdd == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); applyPendingScoreAdd(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked (in-game only; CRAFTED carries coverage)`);
});

const PTR = 0x3800; // record's screen address (in VRAM)
function seed(m, page, accLo, accHi, deltaLo, deltaHi, pending) {
  m.regs.sp = 0x2400;
  m.mem.write8(ACTIVE_PLAYER_PAGE, page);
  const rec = (page & 1) ? PLAYER1_OBJ_DESC : PLAYER2_OBJ_DESC;
  m.mem.write8(rec, accLo);
  m.mem.write8(rec + 1, accHi);
  m.mem.write8(rec + 2, PTR & 0xff);
  m.mem.write8(rec + 3, (PTR >> 8) & 0xff);
  m.mem.write8(SCORE_ADD_PENDING, pending);
  m.mem.write16(SCORE_ADD_VALUE, (deltaHi << 8) | deltaLo);
  return rec;
}

test("CRAFTED: pending clear bails; pending set BCD-adds the delta (with decimal carry) and redraws", () => {
  // [page, accLo, accHi, deltaLo, deltaHi, pending, expLo, expHi, tag]
  const cases = [
    [0x21, 0x25, 0x00, 0x25, 0x00, 0x00, 0x25, 0x00, "pending clear -> untouched"],
    [0x21, 0x25, 0x00, 0x25, 0x00, 0x01, 0x50, 0x00, "BCD 25+25 -> 50, no carry"],
    [0x21, 0x99, 0x00, 0x01, 0x00, 0x01, 0x00, 0x01, "BCD 99+01 -> 00 carry into hi -> 01"],
    [0x20, 0x00, 0x00, 0x50, 0x00, 0x01, 0x50, 0x00, "player 2 record (page bit0 clear) -> 0x20fc"],
  ];
  for (const [page, accLo, accHi, dLo, dHi, pend, expLo, expHi, tag] of cases) {
    const o = new Machine(ROM); const rec = seed(o, page, accLo, accHi, dLo, dHi, pend); o.io.setInte(false);
    const c = new Machine(ROM); seed(c, page, accLo, accHi, dLo, dHi, pend); c.io.setInte(false);
    oracle(o); applyPendingScoreAdd(c);
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.mem.read8(rec), expLo, `acc low: ${tag}`);
    assert.equal(c.mem.read8(rec + 1), expHi, `acc high: ${tag}`);
    assert.equal(c.mem.read8(SCORE_ADD_PENDING), 0, `pending flag clear after: ${tag}`);
  }
  // Positive control that the redraw ran for a pending add: a glyph is plotted at the screen address.
  const c = new Machine(ROM); seed(c, 0x21, 0x25, 0x00, 0x25, 0x00, 0x01); c.io.setInte(false);
  applyPendingScoreAdd(c);
  let drew = 0;
  for (let i = 0; i < 8; i++) drew |= c.mem.read8(PTR + i * 0x20);
  assert.notEqual(drew, 0, "the updated total was drawn at the record's screen address");
});

test("TEETH: a module-mutating twin (binary add, no DAA) diverges at the score cell", () => {
  // Broken twin: adds the delta in plain binary with no decimal adjust and no BCD carry, so 25+25 stores
  // 0x4a instead of 0x50 -- the first RAM divergence is the accumulator low byte.
  function loc_0988_broken(m) {
    const rec = currentPlayerRecordPtr(m);
    if (m.mem8[SCORE_ADD_PENDING] === 0) return;
    m.mem8[SCORE_ADD_PENDING] = 0;
    const delta = m.mem16[SCORE_ADD_VALUE];
    m.mem8[rec] = (m.mem8[rec] + (delta & 0xff)) & 0xff;           // BUG: no DAA
    m.mem8[rec + 1] = (m.mem8[rec + 1] + (delta >> 8)) & 0xff;     // BUG: no DAA, drops the low-byte carry
    const screen = (m.mem8[rec + 3] << 8) | m.mem8[rec + 2];
    return (m.regs.hl = screen, drawBcdWord(m, m.mem8[rec + 1], m.mem8[rec]));
  }
  const o = new Machine(ROM); const rec = seed(o, 0x21, 0x25, 0x00, 0x25, 0x00, 0x01); o.io.setInte(false);
  const c = new Machine(ROM); seed(c, 0x21, 0x25, 0x00, 0x25, 0x00, 0x01); c.io.setInte(false);
  oracle(o); loc_0988_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the missing DAA");
  assert.equal(d.addr, rec & 0xffff, "first divergence is the accumulator low byte");
});
