// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for orBlitBitmap (ROM 0x1a69) -- OR-merge blit. Live-outs: the ORed destination RAM,
// PLUS the advanced pointers HL (dest base + 0x20*rows) and DE (source run straight through). The
// caller (drawOrSaveShields) restores A/B/C but reads HL and DE back, so those two registers are asserted
// alongside the RAM diff. Interrupts are disabled on each clone so the oracle's per-instruction tick
// cannot fire a handler that writes RAM only on its side.
// Run: node --test games/invaders/idiomatic/test/equivalence-1a69.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1a69 as oracleBody } from "../../translated/loc_1a69.js";
import { orBlitBitmap } from "../orBlitBitmap.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1a69;
const CALLER_RET = 0xabcd;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1a69 dispatches -- orBlitBitmap == oracle in RAM (-stack), HL and DE", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); orBlitBitmap(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out");
    assert.equal(c.regs.de, o.regs.de, "DE live-out");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seed a fresh Machine: B rows of C bytes, DE a contiguous source, HL a dest with rows 0x20 apart.
function seat(m, { b, c, de, hl, src, dst }) {
  m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false);
  m.regs.b = b; m.regs.c = c; m.regs.de = de; m.regs.hl = hl;
  src.forEach((v, i) => m.mem.write8(de + i, v));
  dst.forEach(({ a, v }) => m.mem.write8(a, v));
}

test("CRAFTED: each dest byte becomes (src | dest); HL and DE advance", () => {
  const CASE = {
    b: 0x02, c: 0x03, de: 0x3000, hl: 0x2100,
    src: [0x01, 0x02, 0x04, 0x08, 0x10, 0x20],
    dst: [
      { a: 0x2100, v: 0x80 }, { a: 0x2101, v: 0x40 }, { a: 0x2102, v: 0x00 }, // row 0
      { a: 0x2120, v: 0x00 }, { a: 0x2121, v: 0x01 }, { a: 0x2122, v: 0x02 }, // row 1 (HL += 0x20)
    ],
  };
  const o = new Machine(ROM); seat(o, CASE);
  const c = new Machine(ROM); seat(c, CASE);
  oracle(o); orBlitBitmap(c);

  assert.equal(ramDiff(o, c), null, "oracle and module leave identical RAM (-stack)");
  assert.equal(c.mem.read8(0x2100), 0x81, "0x2100 = 0x01|0x80");
  assert.equal(c.mem.read8(0x2101), 0x42, "0x2101 = 0x02|0x40");
  assert.equal(c.mem.read8(0x2102), 0x04, "0x2102 = 0x04|0x00");
  assert.equal(c.mem.read8(0x2120), 0x08, "0x2120 = 0x08|0x00 (row 1)");
  assert.equal(c.mem.read8(0x2121), 0x11, "0x2121 = 0x10|0x01");
  assert.equal(c.mem.read8(0x2122), 0x22, "0x2122 = 0x20|0x02");
  assert.equal(c.regs.hl, 0x2140, "HL := base + 2*0x20");
  assert.equal(c.regs.de, 0x3006, "DE ran straight through all 6 source bytes");
  assert.equal(c.regs.hl, o.regs.hl, "HL matches the oracle");
  assert.equal(c.regs.de, o.regs.de, "DE matches the oracle");
});

test("CRAFTED: a single row of one byte (B=1, C=1) advances HL by 0x20 and DE by 1", () => {
  const CASE = { b: 0x01, c: 0x01, de: 0x3400, hl: 0x2200, src: [0x0f], dst: [{ a: 0x2200, v: 0xf0 }] };
  const o = new Machine(ROM); seat(o, CASE);
  const c = new Machine(ROM); seat(c, CASE);
  oracle(o); orBlitBitmap(c);

  assert.equal(ramDiff(o, c), null);
  assert.equal(c.mem.read8(0x2200), 0xff, "0x2200 = 0x0f|0xf0");
  assert.equal(c.regs.hl, 0x2220, "HL := 0x2200 + 0x20");
  assert.equal(c.regs.de, 0x3401, "DE := 0x3400 + 1");
});

test("TEETH: a blit that ANDs instead of ORs is caught by the RAM diff", () => {
  const brokenBlit = (m, hl = m.regs.hl, de = m.regs.de, b = m.regs.b, c = m.regs.c) => {
    let dst = hl, src = de, rows = b;
    do {
      const rowStart = dst;
      let n = c;
      do { m.mem8[dst] = m.mem8[src] & m.mem8[dst]; src = src + 1; dst = dst + 1; n = (n - 1) & 0xff; } while (n !== 0); // BUG: AND, not OR
      dst = rowStart + 0x20;
      rows = (rows - 1) & 0xff;
    } while (rows !== 0);
    return [(m.regs.hl = dst), (m.regs.de = src)];
  };
  const CASE = {
    b: 0x02, c: 0x03, de: 0x3000, hl: 0x2100,
    src: [0x01, 0x02, 0x04, 0x08, 0x10, 0x20],
    dst: [
      { a: 0x2100, v: 0x80 }, { a: 0x2101, v: 0x40 }, { a: 0x2102, v: 0x00 },
      { a: 0x2120, v: 0x00 }, { a: 0x2121, v: 0x01 }, { a: 0x2122, v: 0x02 },
    ],
  };
  const o = new Machine(ROM); seat(o, CASE);
  const c = new Machine(ROM); seat(c, CASE);
  oracle(o); brokenBlit(c);

  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch an AND-instead-of-OR blit -- it is worthless");
  assert.equal(d.addr, 0x2100, "teeth caught the first mis-merged byte");
});
