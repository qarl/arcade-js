// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for buildTextOverlayList -- the per-frame overlay build. Dissolves its nine m.calls (df6a, b0d1,
// ab14, ab0d, aaa8, a97f, a9d7, df39, b0c6) into direct idiomatic calls. The oracle m.calls the frozen
// routines; the idiomatic calls the idiomatic ones, so equivalence is transitive through each pair. All
// output is RAM (vector fill + the checksum/mirror cells), so each arm compares the RAM diff (minus the
// dead stack), polys frozen. A/X/Y at RTS incidental (every caller reloads immediately after).
// Run: node --test games/tempest/idiomatic/test/equivalence-a8b4.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a8b4 } from "../../translated/loc_a8b4.js";
import { buildTextOverlayList } from "../buildTextOverlayList.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  STATUS_FLAGS, FRAME_COUNTER, PHASE_COUNTER, loc_a2, GAME_MODE, ACTIVE_SLOT_COUNT, loc_43, loc_44, loc_45,
  SPIKED_SEGMENT_COUNT, loc_3d, NIBBLE_GLYPH_TABLE, GLYPH_LIST_BUF_OFS, MIRROR_COPY_BUF_OFS, DECIMAL_MODE_FLAG, loc_102,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa8b4;
const oracle = atEntry(loc_a8b4);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

// buildTextOverlayList fans out into drawSlotShapeRecord (directly and via drawOverlayFrame), which chases the ($ac) object-table
// pointer to a bit7-terminated vector list and appends into the ($74) cursor. A bare Machine leaves
// those pointers zero, so ab14 dereferences into unmapped MMIO. Provision one shared, valid list for
// every slot X that a8b4's branches can draw, and aim the cursor at vector RAM. (ROM is TRUTH; this
// only supplies the live-in memory the routine reads -- both the oracle and the idiomatic side see it.)
function seedRender(m) {
  const B = 0x0400, LIST = 0x0480; // object table in work RAM, list just past it
  m.mem.write8(0xac, B & 0xff); m.mem.write8(0xad, (B >> 8) & 0xff);
  for (const x of [0x22, 0x24, 0x2c, 0x2e, 0x30, 0x32, 0x36, 0x38, 0x3a]) {
    m.mem.write8((B + x) & 0xffff, LIST & 0xff);
    m.mem.write8((B + x + 1) & 0xffff, (LIST >> 8) & 0xff);
  }
  m.mem.write8(LIST + 0, 0x06); m.mem.write8(LIST + 1, 0x03); m.mem.write8(LIST + 2, 0x82); // bit7 terminator
  m.mem.write8(0x74, 0x00); m.mem.write8(0x75, 0x28); // cursor -> vector RAM (0x2800)
}

function seat(m, s = {}) {
  seedRender(m);
  m.mem.write8(STATUS_FLAGS, s.m5 ?? 0x00);
  m.mem.write8(FRAME_COUNTER, s.m3 ?? 0x00);
  m.mem.write8(PHASE_COUNTER, s.m6 ?? 0x00);
  m.mem.write8(loc_a2, s.ma2 ?? 0x00);
  m.mem.write8(GAME_MODE, s.m0 ?? 0x00);
  m.mem.write8(ACTIVE_SLOT_COUNT, s.m3e ?? 0x00);
  m.mem.write8(loc_43, s.m43 ?? 0x00);
  m.mem.write8(loc_44, s.m44 ?? 0x00);
  m.mem.write8(loc_45, s.m45 ?? 0x00);
  m.mem.write8(SPIKED_SEGMENT_COUNT, s.m123 ?? 0x00);
  m.mem.write8(loc_3d, s.m3d ?? 0x00);
  m.mem.write8(NIBBLE_GLYPH_TABLE, s.snap ?? 0x00);
  m.mem.write8(GLYPH_LIST_BUF_OFS, s.cde4 ?? 0x00);
  m.mem.write8(MIRROR_COPY_BUF_OFS, s.cde5 ?? 0x00);
  m.mem.write8((loc_102 + (s.m3d ?? 0x00)) & 0xffff, s.slot ?? 0x00);
}

test("CAPTURE: real 0xa8b4 dispatches -- buildTextOverlayList == oracle in RAM (-stack, poly frozen)", () => {
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    oracle(o); buildTextOverlayList(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: skip-block/early-out, run-block+checksum, and the active-phase tail == oracle (RAM)", () => {
  const cases = [
    { tag: "$05 neg -> skip block1; $00=4 -> skip checksum; early rts",
      m5: 0x80, m0: 0x04, m3e: 0x00, m123: 0x00 },
    { tag: "$05 clear -> block1+aaa8; $00=0 -> checksum; $0123 neg -> extra draw",
      m5: 0x00, m3: 0x00, m6: 0x00, ma2: 0x00, m0: 0x00, m43: 0x00, m44: 0x00, m45: 0x00,
      m123: 0x80, snap: 0x5a, cde4: 0x00, cde5: 0x00 },
    { tag: "$05 neg + $00=0x18 -> active-phase tail with a live slot",
      m5: 0x80, m0: 0x18, m3e: 0x00, m3d: 0x00, slot: 0x07, m123: 0x00 },
  ];
  for (const s of cases) {
    const o = freezePokey(new Machine(ROM, OPTS)); seat(o, s);
    const c = freezePokey(new Machine(ROM, OPTS)); seat(c, s);
    oracle(o); buildTextOverlayList(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("TEETH: a twin that perturbs the checksum output byte diverges (the RAM diff covers $016c)", () => {
  const s = { m5: 0x80, m0: 0x00, m3e: 0x00, m123: 0x00, cde4: 0x00, cde5: 0x00 }; // $00!=4 -> $016c written
  const o = freezePokey(new Machine(ROM, OPTS)); seat(o, s);
  const c = freezePokey(new Machine(ROM, OPTS)); seat(c, s);
  oracle(o);
  // BUG: builds the frame correctly but leaves the checksum cell one off.
  const broken = (m) => { buildTextOverlayList(m); m.mem8[DECIMAL_MODE_FLAG] = (m.mem8[DECIMAL_MODE_FLAG] + 1) & 0xff; };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the perturbed $016c checksum");
});

test("SP-TOOTH: the omitted-ret rewrite is seam-placeable", () => {
  const m = freezePokey(new Machine(ROM, OPTS));
  seedRender(m); // the default (all-zero) path still draws ab14, so provision its pointer chain
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, buildTextOverlayList, TARGET, m);
  assert.equal(r.placeable, true, `buildTextOverlayList must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret rewrite placeable");
});
