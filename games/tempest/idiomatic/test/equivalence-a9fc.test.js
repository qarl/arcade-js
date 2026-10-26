// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for writeNibbleGlyphToTextBuffer (ROM 0xa9fc-0xaa12) -- maps A's low nibble to a byte from the vector-ROM
// word table $31e4 (index 2*Y, where Y = nibble+1, except a zero nibble with carry-in set indexes entry 0)
// and stores it at $2f60,x, then advances X by two. Live-out is the $2f60,x store plus the advanced X
// cursor; carry-in is a semantic input. It is a pure leaf (php/plp only preserve carry across the shift, no
// dispatch); the seam completes it by omitting the ROM ret. Table lives in vector ROM (deterministic).
// Run: node --test games/tempest/idiomatic/test/equivalence-a9fc.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a9fc } from "../../translated/loc_a9fc.js";
import { writeNibbleGlyphToTextBuffer } from "../writeNibbleGlyphToTextBuffer.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { VEC_GLYPH_BUFFER, NIBBLE_GLYPH_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa9fc;
const oracle = atEntry(loc_a9fc);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xa9fc dispatches -- writeNibbleGlyphToTextBuffer == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); writeNibbleGlyphToTextBuffer(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.x, o.regs.x, "advanced X cursor (live-out) diverged");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, s) {
  m.regs.a = s.a;
  m.regs.x = s.x;
  m.regs.fC = !!s.carry;
}

test("CRAFTED: nibble->table byte at $2f60,x for various nibble/carry/cursor == oracle (RAM -stack)", () => {
  const cases = [
    { tag: "nibble 3, carry 0, x 0", a: 0x53, x: 0x00, carry: false },
    { tag: "nibble 0, carry 0 -> entry 1", a: 0xa0, x: 0x04, carry: false },
    { tag: "nibble 0, carry 1 -> entry 0", a: 0xa0, x: 0x06, carry: true },
    { tag: "nibble 0xf, carry 1", a: 0x0f, x: 0x08, carry: true },
    { tag: "nibble 7, carry 0, x 0x0a", a: 0x77, x: 0x0a, carry: false },
  ];
  for (const s of cases) {
    const o = new Machine(ROM, OPTS); seed(o, s);
    const c = new Machine(ROM, OPTS); seed(c, s);
    oracle(o); writeNibbleGlyphToTextBuffer(c);
    assert.equal(ramDiff(o, c), null, `RAM: ${s.tag}`);
    assert.equal(c.regs.x, o.regs.x, `X cursor: ${s.tag}`);
  }
});

test("TEETH (X): a twin that advances the cursor by one instead of two diverges on regs.x", () => {
  // X+=2 is a live-out consumed by the caller across successive calls; it is NOT in the RAM dump,
  // so only a direct regs.x compare gives this teeth. A wrong advance leaves RAM identical.
  const s = { a: 0x53, x: 0x04, carry: false };
  const o = new Machine(ROM, OPTS); seed(o, s);
  const c = new Machine(ROM, OPTS); seed(c, s);
  oracle(o);
  const brokenA9fc = (m) => {
    const mem = m.mem8;
    const nibble = m.regs.a & 0x0f;
    const y = nibble === 0 && m.regs.fC ? 0 : nibble + 1;
    mem[(VEC_GLYPH_BUFFER + m.regs.x) & 0xffff] = mem[(NIBBLE_GLYPH_TABLE + ((y << 1) & 0xff)) & 0xffff];
    m.regs.x = (m.regs.x + 1) & 0xff; // BUG: advances the cursor by one, not two
  };
  brokenA9fc(c);
  assert.equal(ramDiff(o, c), null, "the store itself must still match (only X advance mutated)");
  assert.notEqual(c.regs.x, o.regs.x, "the X-cursor check FAILED to catch the wrong advance");
});

test("TEETH: a twin that ignores carry-in (zero nibble always -> entry 1) diverges from the oracle", () => {
  // Non-default seed so the mutation bites: nibble 0 with carry set makes the oracle pick entry 0, whose
  // byte differs from entry 1. Verified against the vector-ROM table at run time so the arm truly bites.
  const s = { a: 0xb0, x: 0x02, carry: true };
  const probe = new Machine(ROM, OPTS);
  const entry0 = probe.mem8[(NIBBLE_GLYPH_TABLE + 0) & 0xffff];
  const entry1 = probe.mem8[(NIBBLE_GLYPH_TABLE + 2) & 0xffff];
  assert.notEqual(entry0, entry1, "vector-ROM entries 0 and 1 must differ for the teeth to bite");
  const o = new Machine(ROM, OPTS); seed(o, s);
  const c = new Machine(ROM, OPTS); seed(c, s);
  oracle(o);
  const brokenA9fc = (m) => {
    const mem = m.mem8;
    const y = (m.regs.a & 0x0f) + 1; // BUG: never honors carry-in for the zero nibble
    mem[(VEC_GLYPH_BUFFER + m.regs.x) & 0xffff] = mem[(NIBBLE_GLYPH_TABLE + ((y << 1) & 0xff)) & 0xffff];
  };
  brokenA9fc(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the ignored carry-in");
});

test("SP-TOOTH: the omitted-ret leaf is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, writeNibbleGlyphToTextBuffer, TARGET, m);
  assert.equal(r.placeable, true, `writeNibbleGlyphToTextBuffer must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf placeable");
});
