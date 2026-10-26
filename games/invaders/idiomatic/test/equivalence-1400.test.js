// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for orBlitShiftedSprite (ROM 0x1400) -- seat the blit (0x1474 DISSOLVED into
// seatBlitPosition), then over B rows push one source byte through the MB14241 shifter (OUT 0x04 / IN
// 0x03) and OR-merge its two overlapping halves into [HL] and [HL+1], stepping HL by 0x20 (one screen
// row) and DE by 1 each pass. Inputs DE (source), B (row count; 0 => 256), HL/L (fold + shift offset).
// Live-out: the OR-blitted cells (RAM) plus HL (column end) and DE (source end). Each side runs on a
// fresh clone; the contract is RAM (dumpState, minus the transient push/pop stack scratch) plus HL, DE.
// Run: node --test games/invaders/idiomatic/test/equivalence-1400.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1400 as oracleBody } from "../../translated/loc_1400.js";
import { orBlitShiftedSprite } from "../orBlitShiftedSprite.js";
import { seatBlitPosition } from "../seatBlitPosition.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { u16 } from "../../../../core/int.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1400;

// The fold seatBlitPosition applies (coordToScreenAddr): shift right 3, force H into the 0x2000 window.
const foldAddr = (hl) => {
  const s = hl >> 3;
  return (((((s >> 8) & 0x3f) | 0x20) << 8) | (s & 0xff)) & 0xffff;
};
const endHl = (hl, rows) => u16(foldAddr(hl) + (rows === 0 ? 256 : rows) * 0x20);
const endDe = (de, rows) => u16(de + (rows === 0 ? 256 : rows));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1400 dispatches -- orBlitShiftedSprite == oracle in RAM (-stack), HL, DE", () => {
  for (const cap of CAPS) {
    // The oracle's per-row `push b`/`push h` residue (and the internal 0x1474 call) sits just below the
    // ENTRY SP; exclude relative to that SP. The module drops the save/restore.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); orBlitShiftedSprite(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
    assert.equal(c.regs.de, o.regs.de, "DE live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: the shifted column OR-blits across two columns; HL and DE advance", () => {
  const cases = [
    { rows: 2, hl: 0x2000, de: 0x2010 }, // offset 0, fold -> 0x2400
    { rows: 3, hl: 0x2103, de: 0x2030 }, // offset 3, fold -> 0x2420
    { rows: 1, hl: 0x2200, de: 0x2050 }, // offset 0, fold -> 0x2440
    { rows: 0, hl: 0x2000, de: 0x2010 }, // B=0 -> 256 passes
  ];
  for (const { rows, hl, de } of cases) {
    const seed = (m) => {
      m.regs.sp = 0x2400; m.regs.hl = hl; m.regs.de = de; m.regs.b = rows;
      const n = rows === 0 ? 256 : rows;
      for (let i = 0; i < n; i++) m.mem.write8(u16(de + i), 0xa5 ^ i); // source stream
      const base = foldAddr(hl);
      for (let i = 0; i < n; i++) { // pre-seed dest nonzero so the OR (not overwrite) is observable
        m.mem.write8(u16(base + i * 0x20), 0x81);
        m.mem.write8(u16(base + i * 0x20 + 1), 0x18);
      }
    };
    const o = new Machine(ROM); seed(o);
    const c = new Machine(ROM); seed(c);
    oracle(o); orBlitShiftedSprite(c);
    const tag = `rows=0x${rows.toString(16)} hl=0x${hl.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.regs.hl, o.regs.hl, `HL matches oracle: ${tag}`);
    assert.equal(c.regs.de, o.regs.de, `DE matches oracle: ${tag}`);
    assert.equal(c.regs.hl, endHl(hl, rows), `HL advanced: ${tag}`);
    assert.equal(c.regs.de, endDe(de, rows), `DE advanced: ${tag}`);
    // The OR keeps the pre-seeded bits: [base] retains its 0x81 low bits.
    assert.equal(c.mem.read8(foldAddr(hl)) & 0x81, 0x81, `OR preserved dest bits: ${tag}`);
  }
});

test("TEETH: a module-mutating twin (overwrite instead of OR) diverges in RAM", () => {
  // Broken twin of orBlitShiftedSprite: STORES the shifted byte instead of OR-ing it into the dest --
  // dropping the merge that is the whole point. With source 0x00 (shift result 0) and dest 0xff, OR
  // leaves 0xff while overwrite writes 0x00.
  function orBlitShiftedColumn_broken(m, de = m.regs.de, b = m.regs.b) {
    let dst = seatBlitPosition(m);
    let src = de;
    const rows = b || 256;
    for (let i = 0; i < rows; i++) {
      m.io.portOut(0x04, m.mem8[src]);
      m.mem8[dst] = m.io.portIn(0x03); // BUG: overwrite, not `| m.mem8[dst]`
      src = u16(src + 1);
      const hi = u16(dst + 1);
      m.io.portOut(0x04, 0x00);
      m.mem8[hi] = m.io.portIn(0x03); // BUG: overwrite, not `| m.mem8[hi]`
      dst = u16(dst + 0x20);
    }
    return [(m.regs.hl = dst), (m.regs.de = src)];
  }
  const seed = (m) => {
    m.regs.sp = 0x2400; m.regs.hl = 0x2000; m.regs.de = 0x2010; m.regs.b = 2;
    m.mem.write8(0x2010, 0x00); m.mem.write8(0x2011, 0x00); // source zero
    for (let i = 0; i < 2; i++) { m.mem.write8(0x2400 + i * 0x20, 0xff); m.mem.write8(0x2401 + i * 0x20, 0xff); }
  };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o); orBlitShiftedColumn_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch an overwrite-instead-of-OR blit");
  assert.equal(d.addr, foldAddr(0x2000), "diverges at the first blitted cell");
});
