// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for aimClimberAtDeepestColumn (ROM 0xa028-0xa06e) -- pick a new segment for slot x by scanning the
// 16-column depth table $03ac,y from a random start column, keeping the column with the largest depth (an
// empty column counts as maximal), skipping the last column while $0111!=0. Writes $2d/$0140/$29 (scratch)
// and $02b9,x/$02cc,x/$028a,x. Live-out is memory (A/Y at RTS incidental), compared as RAM (-stack).
//   POKEY coupling: the start column comes from POKEY2 RANDOM ($60da), which is clock-coupled (the read
// charges cycles the idiomatic doesn't). We freeze the polys (clear SK_RESET on both chips -> _advance
// early-returns) so oracle and idiomatic read the SAME $60da -> the same start column. Fresh skctl=0 is
// already frozen ($60da=0xff -> start column 0x0f), making the crafted arm deterministic. A leaf: the module
// omits the ROM ret and the seam completes it.
// Run: node --test games/tempest/idiomatic/test/equivalence-a028.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a028 } from "../../translated/loc_a028.js";
import { aimClimberAtDeepestColumn } from "../aimClimberAtDeepestColumn.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_29, TUBE_GEOM_FLAG, ENEMY_SEGMENT, ENEMY_PHASE, ENEMY_SLOT_DIR, LANE_LIMIT } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa028;
const oracle = atEntry(loc_a028);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// Freeze the POKEY polys so both arms read the same clock-coupled RANDOM ($60da).
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xa028 dispatches -- aimClimberAtDeepestColumn == oracle in RAM (-stack, poly frozen)", () => {
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    oracle(o); aimClimberAtDeepestColumn(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: scan keeps the deepest column; winner+successor+bit7 clear == oracle", () => {
  const X = 3;
  // Fresh + frozen -> $60da=0xff -> start column 0x0f, gate $0111=0 so column 0x0f is considered.
  // Seed every column non-zero (a 0 depth would read as maximal 0xff) with the deepest at column 7.
  const seed = (m) => {
    for (let i = 0; i < 16; i++) m.mem.write8((LANE_LIMIT + i) & 0xffff, 0x02);
    m.mem.write8((LANE_LIMIT + 7) & 0xffff, 0x30); // deepest column
    m.mem.write8((ENEMY_SLOT_DIR + X) & 0xffff, 0xff); // bit7 set -> routine must clear it
  };
  const o = freezePokey(new Machine(ROM, OPTS)); o.regs.x = X; seed(o);
  const c = freezePokey(new Machine(ROM, OPTS)); c.regs.x = X; seed(c);
  oracle(o); aimClimberAtDeepestColumn(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the scan");
  assert.equal(c.mem.read8(loc_29), 0x07, "winning column recorded in $29");
  assert.equal(c.mem.read8((ENEMY_SEGMENT + X) & 0xffff), 0x07, "segment := winner");
  assert.equal(c.mem.read8((ENEMY_PHASE + X) & 0xffff), 0x08, "successor := (winner+1)&0x0f");
  assert.equal(c.mem.read8((ENEMY_SLOT_DIR + X) & 0xffff), 0x7f, "bit7 of the slot flag cleared");
});

test("TEETH: a twin that keeps the random start column instead of scanning diverges", () => {
  const X = 3;
  const seed = (m) => {
    for (let i = 0; i < 16; i++) m.mem.write8((LANE_LIMIT + i) & 0xffff, 0x02);
    m.mem.write8((LANE_LIMIT + 7) & 0xffff, 0x30);
    m.mem.write8((ENEMY_SLOT_DIR + X) & 0xffff, 0xff);
  };
  const o = freezePokey(new Machine(ROM, OPTS)); o.regs.x = X; seed(o);
  oracle(o);
  const brokenWinner = 0x0f; // BUG: hand back the random start column, skip the scan
  assert.notEqual(brokenWinner, o.mem.read8(loc_29), "the winner check FAILED to catch skipping the scan");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = freezePokey(new Machine(ROM, OPTS));
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, aimClimberAtDeepestColumn, TARGET, m);
  assert.equal(r.placeable, true, `aimClimberAtDeepestColumn must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
