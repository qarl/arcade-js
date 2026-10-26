// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for buildTextBufferDigitString (ROM 0xa9d7-0xa9fb) -- emits three source bytes (high then low nibble)
// through writeNibbleGlyphToTextBuffer, stepping the source pointer back after each byte. The idiomatic side dissolves the two
// jsr $a9fc into direct writeNibbleGlyphToTextBuffer(...) calls and threads the cursor X + the carry-in by hand. Live-outs are
// RAM (the $2f60 table region, $3b, $2a) AND X (the advanced write cursor), so both are asserted.
// Run: node --test games/tempest/idiomatic/test/equivalence-a9d7.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a9d7 } from "../../translated/loc_a9d7.js";
import { buildTextBufferDigitString } from "../buildTextBufferDigitString.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_2a, WORK_PTR_LO, WORK_PTR_HI, VEC_GLYPH_BUFFER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa9d7;
const oracle = atEntry(loc_a9d7);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xa9d7 dispatches -- buildTextBufferDigitString == oracle in RAM (-stack) and in X", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); buildTextBufferDigitString(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.x, o.regs.x, "advanced cursor X must match");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Point $3b/$3c at three nibble-rich source bytes and seat the write cursor X at 0.
function seedGlyphs(m) {
  m.regs.x = 0x00;
  m.mem.write8(WORK_PTR_LO, 0x90); m.mem.write8(WORK_PTR_HI, 0x00); // source pointer -> $0090
  m.mem.write8(0x0090, 0xab); // read on pass 1
  m.mem.write8(0x008f, 0xcd); // read on pass 2 (pointer stepped back)
  m.mem.write8(0x008e, 0xef); // read on pass 3
}

test("CRAFTED: three glyphs emitted -- RAM equal, X advanced by 12, pointer stepped by 3", () => {
  const o = new Machine(ROM, OPTS); seedGlyphs(o);
  const c = new Machine(ROM, OPTS); seedGlyphs(c);
  oracle(o); buildTextBufferDigitString(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after emit");
  assert.equal(c.regs.x, o.regs.x, "X live-out matches oracle");
  assert.equal(c.regs.x, 0x0c, "six nibble writes advance X by 12");
  assert.equal(c.mem.read8(WORK_PTR_LO), 0x8d, "source pointer stepped back by 3");
});

test("TEETH: a twin that never advances the cursor diverges (RAM and X)", () => {
  const o = new Machine(ROM, OPTS); seedGlyphs(o);
  const c = new Machine(ROM, OPTS); seedGlyphs(c);
  oracle(o);
  const brokenA9d7 = (m) => { m.mem.write8(loc_2a, 0xff); }; // BUG: no emits, no cursor advance
  brokenA9d7(c);
  const ramBroke = ramDiff(o, c) !== null;
  const xBroke = c.regs.x !== o.regs.x;
  assert.ok(ramBroke || xBroke, "the diff FAILED to catch the skipped emits / stale cursor");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  seedGlyphs(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, buildTextBufferDigitString, TARGET, m);
  assert.equal(r.placeable, true, `buildTextBufferDigitString must be seam-placeable; got: ${r.error}`);
});
