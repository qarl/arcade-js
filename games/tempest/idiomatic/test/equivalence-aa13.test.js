// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for stageTextLineWithCount (ROM 0xaa13-0xaa59) -- chooses a length from flags, points the copy
// target at page $2f60, copies that many source bytes down into it, on the negative-flag path emits a
// packed counter via emitByteAsBcdDigits, then restores the low target byte and tail-jmps emitRecordBodyC0. The idiomatic
// side dissolves jsr $af77 (into emitByteAsBcdDigits(m, $9f+1)) and the jmp $df09 tail (into emitRecordBodyC0(m)). Live-out
// is memory only (pure tail-caller into the header emitter, reads no register after), so each arm compares
// RAM (dumpState minus stack scratch below the entry SP). ROM source/count tables live at $ce66/$cde6.
// Run: node --test games/tempest/idiomatic/test/equivalence-aa13.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_aa13 } from "../../translated/loc_aa13.js";
import { stageTextLineWithCount } from "../stageTextLineWithCount.js";
import { emitRecordBodyC0 } from "../emitRecordBodyC0.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u16 } from "../../../../core/int.js";
import { ACTIVE_SLOT_COUNT, STATUS_FLAGS, loc_43, loc_44, loc_45, DRAW_CURSOR_LO, DRAW_CURSOR_HI, loc_9f, TEMPLATE_COPY_LEN, VECTOR_TEMPLATE_BLOCK, VEC_GLYPH_BUFFER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xaa13;
const oracle = atEntry(loc_aa13);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// Find an index whose ROM count byte keeps the copy inside diffed vector RAM.
function pickSmallIndex(m) {
  for (let i = 0; i < 128; i++) if (m.mem.read8(u16(TEMPLATE_COPY_LEN + i)) < 0x60) return i;
  return 0;
}

test("CAPTURE: real 0xaa13 dispatches -- stageTextLineWithCount == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); stageTextLineWithCount(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED (positive path, no af77): copy down into $2f60 -- RAM equal", () => {
  const probe = new Machine(ROM, OPTS);
  const idx = pickSmallIndex(probe);
  const seed = (m) => {
    m.mem.write8(STATUS_FLAGS, 0x00);           // positive -> bmi not taken, bpl taken (skip af77)
    m.mem.write8(loc_43, 0x00); m.mem.write8(loc_44, 0x00); m.mem.write8(loc_45, 0x00); // X stays $3e
    m.mem.write8(ACTIVE_SLOT_COUNT, idx);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); stageTextLineWithCount(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after copy (no af77)");
});

test("CRAFTED (negative path, af77): counter emit + copy -- RAM equal", () => {
  const probe = new Machine(ROM, OPTS);
  const idx = pickSmallIndex(probe);
  const seed = (m) => {
    m.mem.write8(STATUS_FLAGS, 0x80);   // negative -> bmi taken (X stays $3e), bpl not taken (call af77)
    m.mem.write8(ACTIVE_SLOT_COUNT, idx);
    m.mem.write8(loc_9f, 0x2a);  // af77 input basis
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); stageTextLineWithCount(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after copy + af77 emit");
});

test("TEETH: a twin skipping the final y=0 copy diverges from the oracle", () => {
  const probe = new Machine(ROM, OPTS);
  const idx = pickSmallIndex(probe);
  const seed = (m) => {
    m.mem.write8(STATUS_FLAGS, 0x00);
    m.mem.write8(loc_43, 0x00); m.mem.write8(loc_44, 0x00); m.mem.write8(loc_45, 0x00);
    m.mem.write8(ACTIVE_SLOT_COUNT, idx);
    // The final y=0 source byte ($cde6[0]) is 0x00 and the dest ($2f60) starts at 0x00, so
    // skipping that copy is invisible on a bare seed. Pre-load the y=0 dest with a sentinel
    // that differs from $cde6[0]: the oracle overwrites it to 0x00, the twin leaves it.
    m.mem.write8(VEC_GLYPH_BUFFER, 0x5a);
  };
  const o = new Machine(ROM, OPTS); seed(o); oracle(o);
  const c = new Machine(ROM, OPTS); seed(c);
  const brokenAa13 = (m) => {
    const { mem8, mem16 } = m;
    let x = mem8[ACTIVE_SLOT_COUNT];
    if (!(mem8[STATUS_FLAGS] & 0x80)) {
      if ((mem8[loc_43] | mem8[loc_44] | mem8[loc_45]) !== 0) x = 0x01;
    }
    mem8[DRAW_CURSOR_LO] = 0x60;
    mem8[DRAW_CURSOR_HI] = 0x2f;
    let y = mem8[u16(TEMPLATE_COPY_LEN + x)];
    const savedSum = (y + mem8[DRAW_CURSOR_LO] + 1) & 0xff;
    do {
      mem8[u16(mem16[DRAW_CURSOR_LO] + y)] = mem8[u16(VECTOR_TEMPLATE_BLOCK + y)];
      y = (y - 1) & 0xff;
    } while (y !== 0);
    // BUG: skips the final y=0 copy
    mem8[DRAW_CURSOR_LO] = savedSum;
    return emitRecordBodyC0(m);
  };
  brokenAa13(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped final copy");
});

test("SP-TOOTH: the omitted-ret tail-caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, stageTextLineWithCount, TARGET, m);
  assert.equal(r.placeable, true, `stageTextLineWithCount must be seam-placeable; got: ${r.error}`);
});
