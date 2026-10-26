// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for stepAnimationFrame -- bump the animation counter and fold it into the record totals
// (advanceRecordTotals, DISSOLVED). When the frame index reaches its target ([ANIM_END_COORD] == the second
// total) latch the done flag [ANIM_DONE_FLAG]=1 (value-out A=1); otherwise compute the frame's screen pointer,
// stash it to [ANIM_SPRITE_SRC], read the sprite descriptor (loadSpriteDescriptor, DISSOLVED), XCHG, and
// shift-blit the sprite onto the screen (blitShiftedSprite, DISSOLVED). The register/flag live-out is DEAD -- the
// sole caller tail-jumps on without reading it -- so CAPTURE compares RAM only; CRAFTED asserts the
// documented per-path live-outs it controls. The oracle push/pops through the stack scratch below the
// entry SP; the module keeps its walk in locals.
// Run: node --test games/invaders/idiomatic/test/equivalence-1868.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1868 as oracleBody } from "../../translated/loc_1868.js";
import { stepAnimationFrame } from "../stepAnimationFrame.js";
import { advanceRecordTotals } from "../advanceRecordTotals.js";
import { loadSpriteDescriptor } from "../loadSpriteDescriptor.js";
import { blitShiftedSprite } from "../blitShiftedSprite.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { u8, u16 } from "../../../../core/int.js";
import {
  ANIM_FRAME_COUNTER, ANIM_COORD_STEP_LO, ANIM_SPRITE_COORD, ANIM_SPRITE_SRC, ANIM_END_COORD, ANIM_DONE_FLAG, ANIM_BASE_SPRITE_SRC,
} from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1868;
const CALLER_RET = 0xabcd;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1868 dispatches -- stepAnimationFrame == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const sp = cap.regs.sp; // the oracle's nested call push residue sits just below the entry SP
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); stepAnimationFrame(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seat a fresh Machine: a caller return on the stack, plus the record/descriptor cell block.
function seat(m, cells) {
  m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false);
  for (const [addr, v] of Object.entries(cells)) m.mem.write8(Number(addr) & 0xffff, v);
}

test("CRAFTED (done path): frame index hits the target -> [ANIM_DONE_FLAG]=1, A=1, counter bumped", () => {
  // [loc_20c4]=0 and [loc_20c6]=0 => second total 0; [ANIM_END_COORD]=0 => equal => the done branch.
  const cells = {
    [ANIM_FRAME_COUNTER]: 0x22, [ANIM_COORD_STEP_LO]: 0x05,
    [ANIM_SPRITE_COORD - 1]: 0x00 /* 0x20c4 */, [ANIM_SPRITE_COORD]: 0x11, [ANIM_SPRITE_COORD + 1]: 0x00 /* 0x20c6 */,
    [ANIM_END_COORD]: 0x00,
  };
  const o = new Machine(ROM); seat(o, cells);
  const c = new Machine(ROM); seat(c, cells);
  oracle(o); stepAnimationFrame(c);

  assert.equal(ramDiff(o, c), null, "oracle and module leave identical RAM (-stack)");
  assert.equal(c.mem.read8(ANIM_DONE_FLAG), 1, "done flag latched");
  assert.equal(c.mem.read8(ANIM_FRAME_COUNTER), 0x23, "animation counter bumped");
  assert.equal(c.regs.a, 1, "value-out A=1");
  assert.equal(c.regs.a, o.regs.a, "A matches the oracle");
});

const drawCfgs = [
  { name: "bit2 clear -> +0x30", c2: 0x10 }, // inr -> 0x11, bit2 clear -> screen ptr += 0x30
  { name: "bit2 set -> no add", c2: 0x13 },  // inr -> 0x14, bit2 set  -> screen ptr unchanged
];

for (const cfg of drawCfgs) {
  test(`CRAFTED (draw path, ${cfg.name}): descriptor resolved, XCHG, shift-blit; HL/DE/B live-out`, () => {
    // [loc_20c4]=1,[loc_20c6]=1 => second total 2; [ANIM_END_COORD]=0x99 => not equal => the draw branch.
    // [loc_20c9]=4 rows; [ANIM_BASE_SPRITE_SRC]=0x1c00 source-pointer word (ROM, readable).
    const cells = {
      [ANIM_FRAME_COUNTER]: cfg.c2, [ANIM_COORD_STEP_LO]: 0x05,
      [ANIM_SPRITE_COORD - 1]: 0x01 /* 0x20c4 */, [ANIM_SPRITE_COORD]: 0x00, [ANIM_SPRITE_COORD + 1]: 0x01 /* 0x20c6 */,
      [ANIM_SPRITE_COORD + 4]: 0x04 /* 0x20c9 rows */,
      [ANIM_END_COORD]: 0x99,
      [ANIM_BASE_SPRITE_SRC]: 0x00, [ANIM_BASE_SPRITE_SRC + 1]: 0x1c,
    };
    const o = new Machine(ROM); seat(o, cells);
    const c = new Machine(ROM); seat(c, cells);
    oracle(o); stepAnimationFrame(c);

    assert.equal(ramDiff(o, c), null, "oracle and module leave identical RAM (-stack)");
    assert.equal(c.mem.read8(ANIM_DONE_FLAG), 0x00, "done flag NOT latched on the draw path");
    assert.equal(c.regs.hl, o.regs.hl, "HL (seated blit address) matches the oracle");
    assert.equal(c.regs.de, o.regs.de, "DE (advanced source) matches the oracle");
    assert.equal(c.regs.b, o.regs.b, "B (0 at exit) matches the oracle");
    assert.equal(c.regs.b, 0, "B drained to 0");
  });
}

test("TEETH: a twin that drops the XCHG swaps the blit position and source, diverging in screen RAM", () => {
  // Real module shape, one broken step: omit the HL<->DE swap before the shift-blit -- the seat and the
  // source pointer are exchanged, so the sprite lands at the wrong screen address from the wrong bytes.
  function loc_1868_broken(m) {
    m.mem8[ANIM_FRAME_COUNTER] = u8(m.mem8[ANIM_FRAME_COUNTER] + 1);
    const total = advanceRecordTotals(m, ANIM_COORD_STEP_LO, m.mem8[ANIM_COORD_STEP_LO]);
    if (m.mem8[ANIM_END_COORD] === total) { m.mem8[ANIM_DONE_FLAG] = 1; return (m.regs.a = 1); }
    let dst = m.mem16[ANIM_BASE_SPRITE_SRC];
    if ((m.mem8[ANIM_FRAME_COUNTER] & 0x04) === 0) dst = u16(dst + 0x30);
    m.mem16[ANIM_SPRITE_SRC] = dst;
    const [, descDe] = loadSpriteDescriptor(m, ANIM_SPRITE_COORD); // BUG: dropped `m.regs.hl = descDe`
    return blitShiftedSprite(m, descDe);
  }
  const cells = {
    [ANIM_FRAME_COUNTER]: 0x10, [ANIM_COORD_STEP_LO]: 0x05,
    [ANIM_SPRITE_COORD - 1]: 0x01, [ANIM_SPRITE_COORD]: 0x00, [ANIM_SPRITE_COORD + 1]: 0x01,
    [ANIM_SPRITE_COORD + 4]: 0x04,
    [ANIM_END_COORD]: 0x99,
    [ANIM_BASE_SPRITE_SRC]: 0x00, [ANIM_BASE_SPRITE_SRC + 1]: 0x1c,
  };
  const o = new Machine(ROM); seat(o, cells);
  const c = new Machine(ROM); seat(c, cells);
  oracle(o); loc_1868_broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a dropped XCHG");
});
