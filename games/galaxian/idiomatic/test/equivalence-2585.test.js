// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_2585 — memory-equivalent to the frozen oracle at ROM 0x2585 (dissolves its call of the tile-pair
 * writer into a direct idiomatic call).
 * Draws a 2x2 tile block: top pair (tile, tile+1) at HL, bottom pair (tile+2, tile+3) one row (+0x20)
 * below. Live-outs are the four VRAM writes (ramDiff) AND the advanced registers A (tile+4) and HL
 * (dst+0x40), which a chaining caller reads back into the next block; DE is preserved. So EQUAL asserts
 * ramDiff==null AND regDiff over A, HL, DE. Teeth: memory twins (no-op, single-row, no-tile-advance)
 * and register twins (wrong A, wrong HL, clobbered DE). The return-stack window is masked by ramDiff.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_2585 as cand } from "../loc_2585.js";
import { loc_2585 as oracle } from "../../translated/loc_2585.js";

const DEST = 0x5100; // VIDEO RAM (0x5000-0x53ff), captured by dumpState, clear of the masked stack window
const TILE = 0x2c;
const DE_SENTINEL = 0xbeef; // DE must survive the call unchanged
const SENTINEL = 0xaa;      // pre-poked into the four block cells so the writes are demonstrable
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// A crafted entry with A=tile, HL=dest, DE=sentinel, the four block cells pre-dirtied, and a ret address.
function entry(tile = TILE, dest = DEST) {
  return craft((mem8, m) => {
    m.push16(0x9999);
    m.regs.a = tile;
    m.regs.hl = dest;
    m.regs.de = DE_SENTINEL;
    for (const off of [0, 1, 0x20, 0x21]) mem8[(dest + off) & 0xffff] = SENTINEL;
  });
}

// A, HL, DE are register live-outs (blind to ramDiff); observe them directly.
function regDiff(twin, e) {
  const a = e.clone(); a.routines = STUBS; oracle(a);
  const b = e.clone(); b.routines = STUBS; twin(b);
  if (a.regs.a !== b.regs.a) return `A: 0x${a.regs.a.toString(16)} vs 0x${b.regs.a.toString(16)}`;
  if (a.regs.hl !== b.regs.hl) return `HL: 0x${a.regs.hl.toString(16)} vs 0x${b.regs.hl.toString(16)}`;
  if (a.regs.de !== b.regs.de) return `DE: 0x${a.regs.de.toString(16)} vs 0x${b.regs.de.toString(16)}`;
  return null;
}

test("EQUAL: loc_2585 == oracle stamps the 2x2 block (RAM + A + HL + DE)", { skip }, () => {
  const cases = [[0x2c, 0x5100], [0xfe, 0x5200], [0x00, 0x5040]]; // second case wraps tile 0xfe->0x00
  for (const [t, d] of cases) {
    assert.equal(ramDiff(oracle, cand, entry(t, d)), null,
      `loc_2585 RAM diverged (tile=0x${t.toString(16)} dest=0x${d.toString(16)})`);
    assert.equal(regDiff(cand, entry(t, d)), null, `loc_2585 registers diverged (tile=0x${t.toString(16)})`);
  }
  // positive control: the oracle overwrites the sentinels, advances the tile code by four, preserves DE.
  const a = entry().clone(); a.routines = STUBS; oracle(a);
  assert.equal(a.regs.a, (TILE + 4) & 0xff, "positive control: oracle advanced A by four");
  assert.equal(a.regs.de, DE_SENTINEL, "positive control: oracle preserved DE");
  assert.notEqual(a.mem8[DEST], SENTINEL, "positive control: oracle stamped the block");
  console.log("  EQUAL: loc_2585 == oracle (RAM + A + HL + DE), 2x2 block stamped");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const topOnly = (m) => { m.mem8[DEST] = TILE; m.mem8[DEST + 1] = TILE + 1; }; // bottom row missing
  const noTileAdv = (m) => {
    m.mem8[DEST] = TILE; m.mem8[DEST + 1] = TILE + 1;
    m.mem8[DEST + 0x20] = TILE; m.mem8[DEST + 0x21] = TILE + 1; // should be tile+2, tile+3
  };
  const wrongA = (m) => { cand(m); m.regs.a = (m.regs.a + 1) & 0xff; };
  const wrongHL = (m) => { cand(m); m.regs.hl = (m.regs.hl + 1) & 0xffff; };
  const clobberDE = (m) => { cand(m); m.regs.de = 0x1234; };

  assert.ok(ramDiff(oracle, noOp, entry()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, topOnly, entry()), "the single-row twin escaped");
  assert.ok(ramDiff(oracle, noTileAdv, entry()), "the no-tile-advance twin escaped");
  assert.ok(regDiff(wrongA, entry()), "the wrong-A twin escaped (register)");
  assert.ok(regDiff(wrongHL, entry()), "the wrong-HL twin escaped (register)");
  assert.ok(regDiff(clobberDE, entry()), "the clobbered-DE twin escaped (register)");
  console.log("  TEETH: no-op, single-row, no-tile-advance (RAM), wrong-A, wrong-HL, clobbered-DE (registers) all caught");
});
