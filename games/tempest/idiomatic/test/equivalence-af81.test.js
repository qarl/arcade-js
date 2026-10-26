// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawTubeWell (ROM 0xaf81-0xb095) -- draws the playfield well: refresh gates, rim
// segments, a nudge of the window pair $7b/$7c one step toward $0200 (bounded by $0127), five depth rows
// and a four-entry trailer. Dissolves every m.call into direct idiomatic calls (marshalling the pre-jsr
// register loads explicitly; consuming nudgeBlasterRimPosition's clamped-value live-out for the trailer index). All
// output is RAM (window pair + timer + the many emitted vector words), so each arm compares the RAM diff
// (minus the dead stack). Omitted-ret. Run: node --test games/tempest/idiomatic/test/equivalence-af81.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_af81 } from "../../translated/loc_af81.js";
import { drawTubeWell } from "../drawTubeWell.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { SEG_SPREAD_A_LO_3, SEG_SPREAD_A_LO_4, DEPTH_CEILING, PLAYER_SEGMENT, SCORE_DISPLAY_TIMER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xaf81;
const oracle = atEntry(loc_af81);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 6000) : [];

// The rim loop calls ab14 with X = $b09b,($37) for $37 = 7..0, and the trailer calls ab14 with X = 0x1c.
// Each ab14 consults ($ac),X for a list pointer whose copy loop exits on a bit7-set terminator and emits
// through ($74). Seed that chain (($ac)->0x0200; every needed X pair -> the 0x0260 list; 0x0261 terminator;
// ($74)->vec RAM) so the oracle's real dispatch reaches ab14's body instead of faulting on an unmapped read.
const AB14_X = [0x14, 0x0c, 0x0e, 0x16, 0x18, 0x1e, 0x20, 0x1a, 0x1c]; // $b09b,0..7 + trailer 0x1c
function seatAb14Chain(m) {
  m.mem.write8(0x00ac, 0x00); m.mem.write8(0x00ad, 0x02); // ($ac) -> 0x0200
  for (const x of AB14_X) { m.mem.write8(0x0200 + x, 0x60); m.mem.write8(0x0200 + x + 1, 0x02); } // -> 0x0260
  m.mem.write8(0x0261, 0x80);                             // copy-loop terminator (bit7 set)
  m.mem.write8(0x0074, 0x00); m.mem.write8(0x0075, 0x20); // ($74) -> 0x2000 (vector RAM)
}

// The nudge diamond is steered by ($0200 vs $7b) and ($7c vs $0127); seed each direction so both the
// step-toward and settle paths run. $016e is the frame timer the prologue ticks.
function seat(m, s = {}) {
  m.mem.write8(SEG_SPREAD_A_LO_3, s.c7b ?? 0x40);
  m.mem.write8(SEG_SPREAD_A_LO_4, s.c7c ?? 0x40);
  m.mem.write8(DEPTH_CEILING, s.c127 ?? 0x60);
  m.mem.write8(PLAYER_SEGMENT, s.c200 ?? 0x40);
  m.mem.write8(SCORE_DISPLAY_TIMER, s.c16e ?? 0x40);
  seatAb14Chain(m);
}

test("CAPTURE: real 0xaf81 dispatches -- drawTubeWell == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); drawTubeWell(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: both nudge directions + the settle case == oracle (RAM)", () => {
  const cases = [
    { tag: "target above window -> step up", c200: 0x50, c7b: 0x40, c7c: 0x40, c127: 0x60 },
    { tag: "target below window -> step down", c200: 0x30, c7b: 0x40, c7c: 0x40, c127: 0x60 },
    { tag: "target equals $7b -> dec pair", c200: 0x40, c7b: 0x40, c7c: 0x41, c127: 0x60 },
    { tag: "$7c past ceiling -> settle", c200: 0x50, c7b: 0x40, c7c: 0x70, c127: 0x60 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM, OPTS); seat(o, s);
    const c = new Machine(ROM, OPTS); seat(c, s);
    oracle(o); drawTubeWell(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("TEETH: a twin that skips the $016e tick diverges from the oracle", () => {
  const s = { c200: 0x50, c7b: 0x40, c7c: 0x40, c127: 0x60 };
  const o = new Machine(ROM, OPTS); seat(o, s); oracle(o);
  const c = new Machine(ROM, OPTS); seat(c, s);
  // BUG: reproduces nothing -- never ticks the frame timer, never nudges the window, never draws.
  const broken = (_m) => { /* no-op */ };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped work");
});

test("SP-TOOTH: the omitted-ret draw routine is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  seat(m, {});
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, drawTubeWell, TARGET, m);
  assert.equal(r.placeable, true, `drawTubeWell must be seam-placeable; got: ${r.error}`);
});
