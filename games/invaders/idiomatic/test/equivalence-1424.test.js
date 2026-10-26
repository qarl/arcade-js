// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for clearSpriteColumn (ROM 0x1424) -- seat the blit (0x1474 DISSOLVED into
// seatBlitPosition), then over B rows zero the two adjacent screen bytes [HL],[HL+1] and step HL by
// 0x20 (one screen row) each pass. Inputs B (row count; 0 => 256), HL/L (fold + shift offset). Live-out:
// the zeroed cells (RAM) plus HL (column end). Each side runs on a fresh clone; the contract is RAM
// (dumpState, minus the transient push/pop stack scratch) plus HL. clearSpriteColumn does not run in the 1500-
// frame attract window (prize-despawn only), so CRAFTED + TEETH carry the load if CAPTURE sees none.
// Run: node --test games/invaders/idiomatic/test/equivalence-1424.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1424 as oracleBody } from "../../translated/loc_1424.js";
import { clearSpriteColumn } from "../clearSpriteColumn.js";
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

const TARGET = 0x1424;

// The fold seatBlitPosition applies (coordToScreenAddr): shift right 3, force H into the 0x2000 window.
const foldAddr = (hl) => {
  const s = hl >> 3;
  return (((((s >> 8) & 0x3f) | 0x20) << 8) | (s & 0xff)) & 0xffff;
};
const endHl = (hl, rows) => u16(foldAddr(hl) + (rows === 0 ? 256 : rows) * 0x20);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1424 dispatches -- clearSpriteColumn == oracle in RAM (-stack) and HL", () => {
  for (const cap of CAPS) {
    // The oracle's per-row `push b`/`push h` residue (and the internal 0x1474 call) sits just below the
    // ENTRY SP; exclude relative to that SP. The module drops the save/restore.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); clearSpriteColumn(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: two adjacent columns zero over B rows; HL advances by 0x20 per row", () => {
  const cases = [
    { rows: 4, hl: 0x2000 }, // offset 0, fold -> 0x2400
    { rows: 3, hl: 0x2103 }, // offset 3, fold -> 0x2420
    { rows: 1, hl: 0x2200 }, // offset 0, fold -> 0x2440
    { rows: 0, hl: 0x2000 }, // B=0 -> 256 passes
  ];
  for (const { rows, hl } of cases) {
    const seed = (m) => {
      m.regs.sp = 0x2400; m.regs.hl = hl; m.regs.b = rows;
      const base = foldAddr(hl);
      const n = rows === 0 ? 256 : rows;
      for (let i = 0; i < n; i++) { // pre-seed dest nonzero so the clear is observable
        m.mem.write8(u16(base + i * 0x20), 0xff);
        m.mem.write8(u16(base + i * 0x20 + 1), 0xff);
      }
    };
    const o = new Machine(ROM); seed(o);
    const c = new Machine(ROM); seed(c);
    oracle(o); clearSpriteColumn(c);
    const tag = `rows=0x${rows.toString(16)} hl=0x${hl.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.regs.hl, o.regs.hl, `HL matches oracle: ${tag}`);
    assert.equal(c.regs.hl, endHl(hl, rows), `HL advanced: ${tag}`);
    const base = foldAddr(hl);
    assert.equal(c.mem.read8(base), 0x00, `row0 col0 zeroed: ${tag}`);
    assert.equal(c.mem.read8(u16(base + 1)), 0x00, `row0 col1 zeroed: ${tag}`);
    if (rows > 0) {
      const last = u16(base + (rows - 1) * 0x20);
      assert.equal(c.mem.read8(last), 0x00, `last row col0 zeroed: ${tag}`);
      assert.equal(c.mem.read8(u16(last + 1)), 0x00, `last row col1 zeroed: ${tag}`);
    }
  }
});

test("TEETH: a module-mutating twin (clears only one of the two columns) diverges in RAM", () => {
  // Broken twin of clearSpriteColumn: zeros only [HL], skipping [HL+1] -- the second column stays dirty.
  function clearSpriteColumn_broken(m, b = m.regs.b) {
    let dst = seatBlitPosition(m);
    const rows = b || 256;
    for (let i = 0; i < rows; i++) {
      m.mem8[dst] = 0; // BUG: dropped the `m.mem8[dst + 1] = 0` second-column clear
      dst = u16(dst + 0x20);
    }
    return (m.regs.hl = dst);
  }
  const seed = (m) => {
    m.regs.sp = 0x2400; m.regs.hl = 0x2000; m.regs.b = 2;
    for (let i = 0; i < 2; i++) { m.mem.write8(0x2400 + i * 0x20, 0xff); m.mem.write8(0x2401 + i * 0x20, 0xff); }
  };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o); clearSpriteColumn_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a half-cleared column");
  assert.equal(d.addr, u16(foldAddr(0x2000) + 1), "diverges at the uncleared second column");
});
