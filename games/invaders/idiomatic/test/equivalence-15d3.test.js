// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for blitShiftedSprite -- seat the blit position (dissolved into seatBlitPosition), then for each
// of B source rows pre-shift the source byte through the MB14241 (OUT 4 / IN 3) into two dest bytes one
// screen-stride apart, stepping the dest 0x20 per row. Live-out: the shifted dest RAM PLUS HL (restored to
// the seated address), DE (advanced one byte per row) and B (0 at exit); C is preserved. The oracle's inner
// push/pop residue sits just below the ENTRY SP and is excluded from the RAM diff.
// Run: node --test games/invaders/idiomatic/test/equivalence-15d3.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_15d3 as oracleBody } from "../../translated/loc_15d3.js";
import { blitShiftedSprite } from "../blitShiftedSprite.js";
import { seatBlitPosition } from "../seatBlitPosition.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x15d3;
const CALLER_RET = 0xabcd;

// coordToScreenAddr replica: HL >> 3, high byte forced into the 0x2000 video window.
const screenAddr = (hl) => { const s = hl >> 3; return ((((((s >> 8) & 0x3f) | 0x20) << 8) | (s & 0xff))) & 0xffff; };
// MB14241 replica (fresh machine: shiftData starts 0): per row, [lo, hi] shifted bytes.
const expectRows = (offset, srcBytes) => {
  let sd = 0;
  return srcBytes.map((b) => {
    sd = ((b << 8) | (sd >> 8)) & 0xffff;
    const lo = ((sd << offset) >> 8) & 0xff;
    sd = (sd >> 8) & 0xffff;
    const hi = ((sd << offset) >> 8) & 0xff;
    return [lo, hi];
  });
};

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x15d3 dispatches -- blitShiftedSprite == oracle in RAM (-stack), HL, DE and B", () => {
  for (const cap of CAPS) {
    // The oracle's inner `push b`/`push h` residue sits just below the ENTRY SP (not the STACK_SCRATCH
    // window in a real dispatch); exclude relative to that SP. The module keeps the stack untouched.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); blitShiftedSprite(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL restored to the seated address like the oracle");
    assert.equal(c.regs.de, o.regs.de, "DE advanced like the oracle");
    assert.equal(c.regs.b, o.regs.b, "B (0 at exit) matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seat a fresh Machine: a caller return on the stack, a source stream at DE, the pre-transform coord in HL,
// a row count in B and a distinctive C the routine must preserve.
function seat(m, { hl, de, b, c, src }) {
  m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false);
  m.regs.hl = hl; m.regs.de = de; m.regs.b = b; m.regs.c = c;
  src.forEach((v, i) => m.mem.write8((de + i) & 0xffff, v));
}

test("CRAFTED: each row is shift-decoded into two dest bytes; HL restored, DE += rows, B = 0, C preserved", () => {
  const CASE = { hl: 0x2003, de: 0x3100, b: 6, c: 0x5a,
    src: [0xff, 0x81, 0x3c, 0x00, 0xaa, 0x55] };
  const base = screenAddr(CASE.hl);       // 0x2400
  const offset = CASE.hl & 0x07;          // 3
  const o = new Machine(ROM); seat(o, CASE);
  const c = new Machine(ROM); seat(c, CASE);
  oracle(o); blitShiftedSprite(c);

  assert.equal(ramDiff(o, c), null, "oracle and module leave identical RAM (-stack)");
  const rows = expectRows(offset, CASE.src);
  for (let i = 0; i < CASE.b; i++) {
    const dst = (base + 0x20 * i) & 0xffff;
    assert.equal(c.mem.read8(dst), rows[i][0], `row ${i} low byte`);
    assert.equal(c.mem.read8((dst + 1) & 0xffff), rows[i][1], `row ${i} high byte`);
  }
  assert.equal(c.regs.hl, base, "HL restored to the seated address");
  assert.equal(c.regs.hl, o.regs.hl, "HL matches oracle");
  assert.equal(c.regs.de, (CASE.de + CASE.b) & 0xffff, "DE advanced one byte per row");
  assert.equal(c.regs.de, o.regs.de, "DE matches oracle");
  assert.equal(c.regs.b, 0, "B zeroed at exit");
  assert.equal(c.regs.b, o.regs.b, "B matches oracle");
  assert.equal(c.regs.c, CASE.c, "C preserved");
  assert.equal(c.regs.c, o.regs.c, "C matches oracle");
});

test("TEETH: a module-mutating twin that drops the high-byte pass diverges in dest RAM", () => {
  // Real module shape, one broken step: writes only the low shifted byte, never the second (high) byte.
  function loc_15d3_broken(m, de = m.regs.de, b = m.regs.b) {
    const base = seatBlitPosition(m);
    const rows = b || 256;
    let src = de, dst = base;
    for (let i = 0; i < rows; i++) {
      m.io.portOut(0x04, m.mem8[src]);
      m.mem8[dst] = m.io.portIn(0x03);
      // BUG: dropped the OUT 4,0 / IN 3 high-byte pass and its dst+1 write
      src = (src + 1) & 0xffff;
      dst = (dst + 0x20) & 0xffff;
    }
    return [(m.regs.hl = base), (m.regs.de = src), (m.regs.b = 0)];
  }
  const CASE = { hl: 0x2003, de: 0x3100, b: 6, c: 0x5a,
    src: [0xff, 0x81, 0x3c, 0x00, 0xaa, 0x55] };
  const base = screenAddr(CASE.hl);
  const o = new Machine(ROM); seat(o, CASE);
  const c = new Machine(ROM); seat(c, CASE);
  oracle(o); loc_15d3_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a dropped high-byte pass");
  assert.equal(d.addr, (base + 1) & 0xffff, "first divergence is the un-written high byte of row 0");
});
