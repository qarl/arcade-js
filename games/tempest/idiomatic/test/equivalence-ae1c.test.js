// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for seedRngAndDrawCounterPanel (ROM 0xae1c-0xae4d) -- runs the frame setup (buildTextOverlayList), folds two POKEY
// random samples ($60ca then $60da) into the scratch byte $29 and the stored nibble $011f, draws counters
// (drawCounterPair), then tail-calls the row builder drawHighlightedGlyphRowList with A = 0xff. Dissolves every m.call; the 0xff is
// threaded as drawHighlightedGlyphRowList's A input.
//   POKEY coupling: the fold reads $60ca/$60da (RANDOM). The oracle's m.step charges cycles the idiomatic
// does not, so the arms only agree when the POKEY poly is frozen (clear SK_RESET -> _advance early-returns
// -> RANDOM constant). Freezing the clones makes CAPTURE and the fold deterministic.
//   Live-out is RAM ($29, $011f, the draws, and $63 stamped by drawHighlightedGlyphRowList from the threaded A). Omitted-ret.
// Run: node --test games/tempest/idiomatic/test/equivalence-ae1c.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_ae1c } from "../../translated/loc_ae1c.js";
import { seedRngAndDrawCounterPanel } from "../seedRngAndDrawCounterPanel.js";
import { buildTextOverlayList } from "../buildTextOverlayList.js";
import { drawCounterPair } from "../drawCounterPair.js";
import { drawHighlightedGlyphRowList } from "../drawHighlightedGlyphRowList.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_29, loc_11f, POKEY1_RANDOM, POKEY2_RANDOM } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xae1c;
const oracle = atEntry(loc_ae1c);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// Clearing SK_RESET (0x03) makes _advance early-return, so RANDOM ($60ca/$60da) reads a constant.
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 6000) : [];

// Stand up a minimal draw environment for the frame build (buildTextOverlayList). Without it the emitted vector words
// corrupt zero page ($3b/$3c) and drawSlotShapeRecord dereferences a garbage pointer into a decode hole (unmapped read
// at 0x7100). Point ($74) at vector RAM (0x2800), ($ac) at a table (0x2400) whose every even entry points to
// a one-pair, bit7-terminated list at 0x2500, and set $05 bit7 so buildTextOverlayList skips its own object-draw block
// (covered separately by equivalence-a8b4). The random fold, drawCounterPair draw, and A=0xff thread still run.
function seat(m) {
  m.mem.write8(0x05, 0x80);
  m.mem.write8(0x74, 0x00); m.mem.write8(0x75, 0x28);
  m.mem.write8(0xac, 0x00); m.mem.write8(0xad, 0x24);
  for (let k = 0; k < 0x100; k += 2) { m.mem.write8(0x2400 + k, 0x00); m.mem.write8(0x2400 + k + 1, 0x25); }
  m.mem.write8(0x2500, 0x00); m.mem.write8(0x2501, 0x82);
  return m;
}

test("CAPTURE: real 0xae1c dispatches -- seedRngAndDrawCounterPanel == oracle in RAM (-stack, poly frozen)", () => {
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    oracle(o); seedRngAndDrawCounterPanel(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: random fold -> $29 and $011f, draws, A=0xff to drawHighlightedGlyphRowList == oracle (RAM)", () => {
  const o = seat(freezePokey(new Machine(ROM, OPTS)));
  const c = seat(freezePokey(new Machine(ROM, OPTS)));
  oracle(o); seedRngAndDrawCounterPanel(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the fold + draw");
  assert.equal(c.mem.read8(loc_29), o.mem.read8(loc_29), "scratch $29 folded identically");
  assert.equal(c.mem.read8(loc_11f), o.mem.read8(loc_11f), "stored nibble $011f folded identically");
});

test("TEETH (A thread): a twin that hands drawHighlightedGlyphRowList the wrong A (0x00) diverges at $63", () => {
  const o = seat(freezePokey(new Machine(ROM, OPTS))); oracle(o);
  const c = seat(freezePokey(new Machine(ROM, OPTS)));
  // BUG: threads a zero A into the row builder instead of 0xff; drawHighlightedGlyphRowList stamps it into $63.
  const broken = (m) => {
    const { mem8 } = m;
    buildTextOverlayList(m);
    const r0 = mem8[POKEY1_RANDOM];
    mem8[loc_29] = mem8[POKEY1_RANDOM];
    mem8[loc_29] = (r0 >> 4) ^ mem8[loc_29];
    const r1 = mem8[POKEY2_RANDOM];
    const r1shift = mem8[POKEY2_RANDOM];
    mem8[loc_29] = ((r1 ^ mem8[loc_29]) & 0xf0) ^ mem8[loc_29];
    mem8[loc_11f] = ((r1shift << 4) & 0xff) ^ mem8[loc_29];
    drawCounterPair(m);
    drawHighlightedGlyphRowList(m, 0x00); // wrong A
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong threaded A");
  assert.equal(o.mem.read8(0x0063), 0xff, "oracle stamped 0xff into $63");
  assert.equal(c.mem.read8(0x0063), 0x00, "broken stamped 0x00 into $63");
});

test("SP-TOOTH: the omitted-ret caller is seam-placeable", () => {
  const m = seat(freezePokey(new Machine(ROM, OPTS)));
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, seedRngAndDrawCounterPanel, TARGET, m);
  assert.equal(r.placeable, true, `seedRngAndDrawCounterPanel must be seam-placeable; got: ${r.error}`);
});
