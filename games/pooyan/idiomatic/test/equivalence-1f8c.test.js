// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for blitGlyphBlock4x3 (ROM 0x1f8c, Pooyan) — copy a 4-row x 3-column
 * glyph block from (DE) into (HL). Each row copies three source bytes, advancing the destination
 * LOW byte only (the row wraps within its tilemap page, no carry into the high byte), then steps
 * the full pointer +0x1d (net +0x20 per row) to the next row's column origin.
 *
 * CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM, so each case runs the oracle on a
 * FRESH clone and blitGlyphBlock4x3 on another, compared on RAM (dumpState, minus stack scratch below the entry SP)
 * AND the advanced HL/DE live-outs: refreshRoundStageHud/drawStageLabelOncePerLevel `rst 0x10` (memset at HL) right after the call,
 * so the advanced HL is live-out; DE matches the oracle for a chained caller.
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — replay any real 0x1f8c dispatch a boot happens to reach; RAM + HL/DE.
 *   2. CRAFTED (load-bearing) — pre-dirtied dest + a source of distinct bytes, including a dest whose
 *      low byte is near 0xff so the inner loop's low-byte-only wrap is exercised. RAM identical, HL/DE
 *      advanced to the oracle's values, and the twelve destination cells carry the source bytes at the
 *      LOW-byte-wrapped addresses (a full-16-bit-increment blit would miss those -> pins the inc-L step).
 *   3. WRITE-SET — the oracle writes exactly the twelve computed cells, nothing else.
 *   4. TEETH — a twin that advances the destination with a full 16-bit increment (instead of low-byte
 *      only) diverges at the page wrap and MUST be caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1f8c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1f8c as oracle } from "../../translated/loc_1f8c.js";
import { blitGlyphBlock4x3 } from "../blitGlyphBlock4x3.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x1f8c;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

const SRC = 0x8a00;          // source glyph bytes (work RAM), pre-seeded distinct
const DST_WRAP = 0x84fd;     // dest low byte near 0xff -> exercises the inner low-byte-only wrap
const DST_PLAIN = 0x8420;    // dest with room -> plain +0x20 rows

/** First RAM difference on the go-forward contract: whole dump, skipping the dead stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), dead);
}

/** Reference: the ordered list of destination addresses the blit writes, low-byte-only inner step. */
function writtenCells(dst) {
  const cells = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      cells.push(dst);
      dst = (dst & ~0xff) | ((dst + 1) & 0xff); // inc L only
    }
    dst = (dst + 0x1d) & 0xffff;
  }
  return cells;
}

/** Build a machine: source pre-seeded with 12 distinct bytes, dest region pre-dirtied to 0xAA. */
function craft(dst) {
  const m = new Machine(ROM);
  for (let i = 0; i < 12; i++) m.mem.write8((SRC + i) & 0xffff, (0xc0 + i) & 0xff);
  for (const addr of writtenCells(dst)) m.mem.write8(addr, 0xaa);
  m.regs.de = SRC;
  m.regs.hl = dst;
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH: the ret only pops (reads) the word at SP
  return m;
}

// -- 1. CAPTURE (best-effort) -------------------------------------------------

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  try {
    const host = new Machine(ROM, { overrides: snap });
    host.runFrames(maxFrames);
  } catch {
    /* boot may unwind on an unimplemented path; keep whatever we captured */
  }
  return caps;
}

test("CAPTURE: real 0x1f8c dispatches replay identically (if reached)", () => {
  const caps = ROM_PRESENT ? captureDispatches(16, 4000) : [];
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    const [retHl, retDe] = blitGlyphBlock4x3(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(c.regs.hl, o.regs.hl, `HL live-out: module ${hx(c.regs.hl)} != oracle ${hx(o.regs.hl)}`);
    assert.equal(c.regs.de, o.regs.de, `DE live-out: module ${hx(c.regs.de)} != oracle ${hx(o.regs.de)}`);
    assert.equal(retHl, o.regs.hl, `HL return ${hx(retHl)} != ${hx(o.regs.hl)}`);
    assert.equal(retDe, o.regs.de, `DE return ${hx(retDe)} != ${hx(o.regs.de)}`);
  }
  console.log(`  CAPTURE: ${caps.length} real 0x1f8c dispatch(es) replayed identically`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: pre-dirtied dest + distinct source — RAM identical, 12 cells at inc-L addresses", () => {
  for (const dst of [DST_WRAP, DST_PLAIN]) {
    const o = craft(dst);
    const c = craft(dst);
    oracle(o);
    const [retHl, retDe] = blitGlyphBlock4x3(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `dst ${hx(dst)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(retHl, o.regs.hl, `dst ${hx(dst)}: HL live-out ${hx(retHl)} != oracle ${hx(o.regs.hl)}`);
    assert.equal(retDe, o.regs.de, `dst ${hx(dst)}: DE live-out ${hx(retDe)} != oracle ${hx(o.regs.de)}`);
    assert.equal(c.regs.hl, o.regs.hl, `dst ${hx(dst)}: module must SET HL (rst 0x10 memsets through it)`);
    assert.equal(c.regs.de, o.regs.de, `dst ${hx(dst)}: module must SET DE`);

    // Positive check on the ORACLE clone: each computed cell carries its source byte. A full-16-bit
    // increment blit would land the post-wrap cells elsewhere, so this pins the low-byte-only step.
    const cells = writtenCells(dst);
    for (let i = 0; i < 12; i++) {
      assert.equal(o.mem.read8(cells[i]), (0xc0 + i) & 0xff, `dst ${hx(dst)}: cell ${i} at ${hx(cells[i])}`);
    }
  }
  console.log("  CRAFTED: wrap + plain dest blitted identically, 12 cells at low-byte-wrapped addresses");
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle writes exactly the twelve computed cells", () => {
  const dst = DST_WRAP;
  const before = craft(dst);
  const after = before.clone();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const expected = new Set(writtenCells(dst));
  const changed = new Set();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.add(after.stateOffsetToAddr(off));
  }
  for (const addr of changed) assert.ok(expected.has(addr), `oracle wrote unexpected addr ${hx(addr)}`);
  // Every computed cell is a real change (0xAA dirt -> a 0xC0.. source byte, all distinct from 0xAA).
  for (const addr of expected) assert.ok(changed.has(addr), `expected write at ${hx(addr)} did not land`);
  console.log(`  WRITE-SET: exactly ${expected.size} cells changed, all within the computed set`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: advances the destination with a FULL 16-bit increment instead of low-byte-only. */
function brokenBlit(m, src = m.regs.de, dst = m.regs.hl) {
  const { mem8 } = m;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      mem8[dst] = mem8[src];
      dst = (dst + 1) & 0xffff; // BUG: full inc, carries into the high byte at the page wrap
      src = (src + 1) & 0xffff;
    }
    dst = (dst + 0x1d) & 0xffff;
  }
}

test("TEETH: a full-16-bit destination increment (vs low-byte only) is caught at the page wrap", () => {
  const dst = DST_WRAP;
  const o = craft(dst);
  const c = craft(dst);
  oracle(o);
  brokenBlit(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a full-16-bit dest increment — it is worthless");
  console.log(`  TEETH: full-inc twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
