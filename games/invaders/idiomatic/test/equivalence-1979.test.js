// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawCreditReadout -- the boot credit-readout sequence. It clears the game-active flag
// (DISSOLVED into clearGameActive), repaints the BCD credit tally (DISSOLVED into drawCreditCount), then
// tail-draws the credit label (DISSOLVED into drawCreditLabel). Straight-line, no own branches; live-out
// is RAM only -- its single caller (loc_0765) reseats every register before reading, so nothing is
// compared register-wise. All three m.calls are already-idiomatic leaves, so the tail-jmp collapses into a
// plain omitted-ret leaf: the module leaves SP where it found it and the seam completes the ret (SP-TOOTH).
// The oracle's push16 residue sits in the return-stack scratch and is excluded from the RAM diff. Its only
// caller seats SP=0x2400 then pushes one word, so every dispatch enters at SP=0x23fe and all of its stack
// scratch lives inside STACK_SCRATCH. Each side runs on a fresh clone, interrupts off.
// Run: node --test games/invaders/idiomatic/test/equivalence-1979.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1979 as oracleBody } from "../../translated/loc_1979.js";
import { drawCreditReadout } from "../drawCreditReadout.js";
import { clearGameActive } from "../clearGameActive.js";
import { setGameActive } from "../setGameActive.js";
import { drawCreditCount } from "../drawCreditCount.js";
import { drawCreditLabel } from "../drawCreditLabel.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { seamPlaceable } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { GAME_ACTIVE, CREDIT_COUNT, CREDIT_COUNT_SCREEN_ADDR, CREDIT_LABEL_SCREEN_ADDR } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1979;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// Sum a run of screen bytes down a sprite column (stride 0x20) to prove a limb actually painted.
function drawn(m, base, cols) {
  let acc = 0;
  for (let i = 0; i < cols; i++) acc |= m.mem.read8((base + i * 0x20) & 0xffff);
  return acc;
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1979 dispatches -- drawCreditReadout == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); drawCreditReadout(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: clears game-active, repaints the credit tally + label; equal across credit values", () => {
  for (const credit of [0x00, 0x12, 0x99]) {
    const seed = (m) => {
      m.regs.sp = 0x2400;
      m.mem.write8(GAME_ACTIVE, 0xff);      // start active so the clear is observable
      m.mem.write8(CREDIT_COUNT, credit);
    };
    const o = new Machine(ROM); seed(o); o.io.setInte(false);
    const c = new Machine(ROM); seed(c); c.io.setInte(false);
    oracle(o); drawCreditReadout(c);
    const tag = `credit=${hx(credit)}`;
    assert.equal(ramDiff(o, c), null, tag);
  }
  // Positive controls: each dissolved limb left its mark.
  const c = new Machine(ROM); c.regs.sp = 0x2400; c.io.setInte(false);
  c.mem.write8(GAME_ACTIVE, 0xff); c.mem.write8(CREDIT_COUNT, 0x12);
  drawCreditReadout(c);
  assert.equal(c.mem.read8(GAME_ACTIVE), 0, "game-active flag cleared");
  assert.notEqual(drawn(c, CREDIT_COUNT_SCREEN_ADDR, 8), 0, "credit tally painted");
  assert.notEqual(drawn(c, CREDIT_LABEL_SCREEN_ADDR, 8), 0, "credit label painted");
});

test("TEETH-A: a twin that marks active (not clear) diverges at GAME_ACTIVE", () => {
  function loc_1979_setActive(m) {
    setGameActive(m);                 // BUG: should clear, not set, the game-active flag
    drawCreditCount(m);
    return drawCreditLabel(m);
  }
  const seed = (m) => { m.regs.sp = 0x2400; m.mem.write8(GAME_ACTIVE, 0xff); m.mem.write8(CREDIT_COUNT, 0x12); };
  const o = new Machine(ROM); seed(o); o.io.setInte(false);
  const c = new Machine(ROM); seed(c); c.io.setInte(false);
  oracle(o); loc_1979_setActive(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a set-instead-of-clear game-active flag");
  assert.equal(d.addr, GAME_ACTIVE & 0xffff, `first divergence is the game-active flag; got ${hx(d.addr ?? 0)}`);
});

test("TEETH-B: a twin that drops the credit-label draw diverges in the label region", () => {
  function loc_1979_noLabel(m) {
    clearGameActive(m);
    drawCreditCount(m);
    // BUG: drops the tail credit-label draw
  }
  const seed = (m) => { m.regs.sp = 0x2400; m.mem.write8(GAME_ACTIVE, 0xff); m.mem.write8(CREDIT_COUNT, 0x12); };
  const o = new Machine(ROM); seed(o); o.io.setInte(false);
  const c = new Machine(ROM); seed(c); c.io.setInte(false);
  oracle(o); loc_1979_noLabel(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the dropped credit-label draw");
  assert.ok(d.addr >= (CREDIT_LABEL_SCREEN_ADDR & 0xffff) && d.addr < (CREDIT_COUNT_SCREEN_ADDR & 0xffff),
    `divergence must be in the credit-label region; got ${hx(d.addr ?? 0)}`);
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.sp = 0x2400;
  m.mem.write16(0x2400, 0x0771);        // a real caller-return word for the seam to consume
  m.mem.write8(CREDIT_COUNT, 0x12);
  m.io.setInte(false);
  const r = seamPlaceable(withOmittedRet, drawCreditReadout, TARGET, m);
  assert.equal(r.placeable, true, `drawCreditReadout must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
