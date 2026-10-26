// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for redrawScorePanel (ROM 0x1956) -- the boot/attract score-panel repaint. It clears video RAM
// (DISSOLVED into clearScreen) then redraws six HUD limbs: the score header (drawScoreHeader), P1 score
// (drawPlayer1Score), P2 score (drawPlayer2Score), the high score (drawHighScore), the CREDIT label
// (drawCreditLabel), and the credit tally (tail drawCreditCount). All seven ROM calls are already-idiomatic
// leaves, so the tail-jmp collapses into a plain omitted-ret leaf: the module leaves SP where it found it
// and the seam completes the ret (SP-TOOTH). Live-out is RAM only -- both callers (startGameFlow, bootInit)
// overwrite/fall past HL before reading it, so no register is compared. The oracle's draw-chain call/ret
// residue sits just below the entry SP and is excluded from the RAM diff.
// Run: node --test games/invaders/idiomatic/test/equivalence-1956.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1956 as oracleBody } from "../../translated/loc_1956.js";
import { redrawScorePanel } from "../redrawScorePanel.js";
import { clearScreen } from "../clearScreen.js";
import { drawScoreHeader } from "../drawScoreHeader.js";
import { drawPlayer1Score } from "../drawPlayer1Score.js";
import { drawPlayer2Score } from "../drawPlayer2Score.js";
import { drawHighScore } from "../drawHighScore.js";
import { drawCreditLabel } from "../drawCreditLabel.js";
import { drawCreditCount } from "../drawCreditCount.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable, deadStackBelow } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { STACK_SCRATCH, CREDIT_COUNT, CREDIT_COUNT_SCREEN_ADDR,
         CREDIT_LABEL_SCREEN_ADDR, PLAYER1_OBJ_DESC, PLAYER2_OBJ_DESC, HIGH_SCORE_OBJ_DESC } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1956;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// Sum a run of screen bytes down a sprite column (stride 0x20) to prove a limb actually painted.
function drawn(m, base, cols) {
  let acc = 0;
  for (let i = 0; i < cols; i++) acc |= m.mem.read8((base + i * 0x20) & 0xffff);
  return acc;
}

// Seed the three four-byte score records the panel draws, each with a BCD value word (low,high) and a
// VRAM screen address so the glyph draws land in observable video RAM.
function seedRecord(m, base, e, d, ptr) {
  m.mem.write8(base, e);
  m.mem.write8(base + 1, d);
  m.mem.write8(base + 2, ptr & 0xff);
  m.mem.write8(base + 3, (ptr >> 8) & 0xff);
}
// Each 4-BCD-glyph score spans ~0x3e0 bytes (4 glyphs, 0x100 apart); keep the three records 0x400 apart
// so their draws stay inside VRAM (0x2400-0x3fff) and do not collide.
function seedPanel(m) {
  m.regs.sp = 0x23fe;
  m.mem.write16(0x23fe, 0x18df);           // a real caller-return word for the seam to consume
  seedRecord(m, PLAYER1_OBJ_DESC, 0x34, 0x12, 0x2800);
  seedRecord(m, PLAYER2_OBJ_DESC, 0x21, 0x00, 0x2c00);
  seedRecord(m, HIGH_SCORE_OBJ_DESC, 0x99, 0x99, 0x3000);
  m.mem.write8(CREDIT_COUNT, 0x07);
  m.io.setInte(false);
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1956 dispatches -- redrawScorePanel == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    // The oracle's draw-chain call/ret residue sits just below the ENTRY SP.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => deadStackBelow(STACK_SCRATCH, sp)(a) || (a != null && a >= sp - 0x20 && a < sp));
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); redrawScorePanel(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: clears the screen then redraws all six HUD limbs; equal across seeded panels", () => {
  const o = new Machine(ROM); seedPanel(o);
  const c = new Machine(ROM); seedPanel(c);
  oracle(o); redrawScorePanel(c);
  assert.equal(ramDiff(o, c), null);
  // Positive controls: the dissolved score/credit limbs (deterministic BCD glyphs) left their mark on
  // screen RAM. (The header/label are covered by the RAM-equivalence above, not a per-glyph control.)
  const p = new Machine(ROM); seedPanel(p); redrawScorePanel(p);
  assert.notEqual(drawn(p, 0x2800, 8), 0, "P1 score painted");
  assert.notEqual(drawn(p, 0x2c00, 8), 0, "P2 score painted");
  assert.notEqual(drawn(p, 0x3000, 8), 0, "high score painted");
  assert.notEqual(drawn(p, CREDIT_LABEL_SCREEN_ADDR, 8), 0, "credit label painted");
  assert.notEqual(drawn(p, CREDIT_COUNT_SCREEN_ADDR, 8), 0, "credit tally painted");
});

test("TEETH: a twin that drops the tail credit-count draw diverges in the credit region", () => {
  function loc_1956_noCredit(m) {
    clearScreen(m);
    drawScoreHeader(m);
    drawPlayer1Score(m);
    drawPlayer2Score(m);
    drawHighScore(m);
    return drawCreditLabel(m);
    // BUG: drops the tail credit-tally draw
  }
  const o = new Machine(ROM); seedPanel(o);
  const c = new Machine(ROM); seedPanel(c);
  oracle(o); loc_1956_noCredit(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the dropped credit-count draw");
});

test("TEETH: a twin that skips the screen clear diverges (stale VRAM survives)", () => {
  function loc_1956_noClear(m) {
    // BUG: omits clearScreen, so pre-dirtied VRAM outside the drawn glyphs survives
    drawScoreHeader(m);
    drawPlayer1Score(m);
    drawPlayer2Score(m);
    drawHighScore(m);
    drawCreditLabel(m);
    return drawCreditCount(m);
  }
  const o = new Machine(ROM); seedPanel(o);
  const c = new Machine(ROM); seedPanel(c);
  // pre-dirty a VRAM cell the clear would have zeroed but no glyph covers
  o.mem.write8(0x2600, 0xff); c.mem.write8(0x2600, 0xff);
  oracle(o); loc_1956_noClear(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the skipped screen clear");
  assert.equal(d.addr, 0x2600, `first divergence is the un-cleared VRAM cell; got ${hx(d.addr ?? 0)}`);
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM); seedPanel(m);
  const r = seamPlaceable(withOmittedRet, redrawScorePanel, TARGET, m);
  assert.equal(r.placeable, true, `redrawScorePanel must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
