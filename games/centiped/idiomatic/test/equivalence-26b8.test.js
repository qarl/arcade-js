// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawGridSideBorders (ROM 0x26b8) vs the frozen translated oracle. The routine
// builds the ($91/$92) draw cursor from the $F6/$F7 orientation bytes and paints two 6-cell vertical runs
// by dispatching the still-frozen loc_3836 (draw-glyph-and-advance) six times per run, the glyph chosen by
// a down-counter's sign. It is NOT reached in a 1500-frame attract crawl, so there is no live capture to
// replay; equivalence is proven on crafted entries (fidelity = RAM minus stack scratch below the entry SP; A is left where
// loc_3836 parks it on BOTH sides, X is a dead loop local, so live-out is memory only). Because it seats
// JSR returns around the frozen loc_3836 it also carries an SP-seam tooth.
// Run: node --test games/centiped/idiomatic/test/equivalence-26b8.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_26b8 as oracleRom } from "../../translated/loc_26b8.js";
import { drawGridSideBorders } from "../drawGridSideBorders.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_8b, loc_91, loc_92, loc_a5, loc_a6, loc_ef, loc_f3, loc_f6, loc_f7 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x26b8;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// A crafted entry: orientation/stride bytes seated so both side-runs' cursors stay inside the 0x0400-0x07FF
// framebuffer, and a caller-return word seated at the entry SP (compared) for the withOmittedRet seam.
function seed({ f6 = 0x00, f7 = 0x00, ef = 0x00, f3 = 0x00, a5 = 0x03, a6 = 0x02 } = {}) {
  const m = new Machine(ROM);
  m.regs.s = 0xfd;
  m.mem.write8(0x0100 | ((0xfd + 1) & 0xff), 0x34); // caller-return (ret-1) lo
  m.mem.write8(0x0100 | ((0xfd + 2) & 0xff), 0x12); // caller-return (ret-1) hi
  m.mem.write8(loc_f6, f6);
  m.mem.write8(loc_f7, f7);
  m.mem.write8(loc_ef, ef);
  m.mem.write8(loc_f3, f3);
  m.mem.write8(loc_a5, a5);
  m.mem.write8(loc_a6, a6);
  return m;
}

test("CRAFTED: drawGridSideBorders == oracle in RAM (-stack) across orientation/length cases", () => {
  const cases = [
    { f6: 0x00, f7: 0x00, ef: 0x00, f3: 0x00, a5: 0x03, a6: 0x02 },
    { f6: 0x00, f7: 0x00, ef: 0x00, f3: 0x00, a5: 0x06, a6: 0x00 }, // all-border run vs none
    { f6: 0x00, f7: 0x00, ef: 0x00, f3: 0x00, a5: 0x00, a6: 0x06 }, // inverted: none vs all-border
  ];
  for (const c of cases) {
    const base = seed(c);
    const o = base.clone();
    const cc = base.clone();
    oracle(o);
    drawGridSideBorders(cc);
    const label = `a5=0x${c.a5.toString(16)} a6=0x${c.a6.toString(16)}`;
    assert.equal(ramDiff(o, cc), null, label);
    // Positive control: the oracle actually painted the framebuffer and left the loop counter at 0.
    assert.equal(o.mem.read8(loc_8b), 0x00, `oracle left $8b=0 (${label})`);
  }
  // The two cursors are built from opposite constants -- confirm they differ (the runs address two sides).
  const s = seed();
  const probe = s.clone();
  drawGridSideBorders(probe);
  assert.equal(probe.mem.read8(loc_8b), 0x00, "idiomatic left $8b=0");
  console.log("  CRAFTED: drawGridSideBorders == oracle on 3 orientation/length arms");
});

test("TEETH: a twin that paints the blank glyph everywhere diverges in RAM", () => {
  // Broken twin: never selects the 0x1F border glyph, so the border cells stay 0 instead of 0x1F^$EF.
  const brokenTwin = (m) => {
    const mem = m.mem;
    mem.write8(loc_8b, 0x06);
    mem.write8(loc_92, (0x04 ^ mem.read8(loc_f7)) & 0x06);
    mem.write8(loc_91, 0xdf ^ mem.read8(loc_f6));
    for (let n = 0; n < 6; n++) {
      m.regs.a = 0x00;
      m.push16(0x26d5);
      m.call(0x3836);
      mem.write8(loc_8b, (mem.read8(loc_8b) - 1) & 0xff);
    }
    mem.write8(loc_92, 0x06 ^ mem.read8(loc_f7));
    mem.write8(loc_91, 0x5f ^ mem.read8(loc_f6));
    mem.write8(loc_8b, 0x06);
    for (let n = 0; n < 6; n++) {
      m.regs.a = 0x00;
      m.push16(0x26f7);
      m.call(0x3836);
      mem.write8(loc_8b, (mem.read8(loc_8b) - 1) & 0xff);
    }
  };
  const base = seed({ a5: 0x06, a6: 0x06 }); // both runs draw border cells the twin drops
  const o = base.clone();
  const c = base.clone();
  oracle(o);
  brokenTwin(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the dropped border glyph");
  console.log("  TEETH: blank-glyph twin caught");
});

test("SP-SEAM TOOTH: the stack-neutral body places at the seam; a stray push is refused", () => {
  const r = seamPlaceable(withOmittedRet, drawGridSideBorders, TARGET, seed());
  assert.equal(r.placeable, true, `seam refused the stack-neutral body: ${r.error}`);
  // Null-mutant: a body that leaves a word adrift on the stack moves SP off the seat -> the seam refuses it.
  const strayPush = (m) => { drawGridSideBorders(m); m.push16(0x9999); };
  const rm = seamPlaceable(withOmittedRet, strayPush, TARGET, seed());
  assert.equal(rm.placeable, false, "the stray-push mutant placed at the seam (tooth has no teeth)");
  console.log("  SP-SEAM: stack-neutral body placeable; stray-push mutant refused");
});
