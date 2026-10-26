// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for settleEnemyAtTargetDepth (ROM 0x9d06-0x9d66) -- per-slot(x) step over the $02df/$0283 slot
// tables. Dissolves the jsr $9d67 into a direct idiomatic call. The oracle m.calls the frozen 9d67; the
// idiomatic calls idiomatic 9d67. All output is RAM (slot tables, $0108/$0109/$010b), so each arm
// compares the RAM diff (minus the dead stack). An omitted-ret rewrite. A/X at RTS incidental; Y is a
// live-out on the scan and 9d67 arms (the oracle leaves the scan index / $02b9,x in Y), consumed by
// steerSlotCoordinate's tail after this delegate, so it carries a standing comparison arm.
// Run: node --test games/tempest/idiomatic/test/equivalence-9d06.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9d06 } from "../../translated/loc_9d06.js";
import { settleEnemyAtTargetDepth } from "../settleEnemyAtTargetDepth.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  PLAYER_SHOT_DEPTH, ENEMY_DEPTH, ENEMY_SLOT_FLAGS, FIRE_GATE, ENEMY_SLOT_DIR, ENEMY_TOTAL_COUNT, ENEMY_TYPE_COUNT, TABLE_CURSOR, SCRIPT_CURSOR,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9d06;
const X = 3;
const oracle = atEntry(loc_9d06);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

function seat(m, s = {}) {
  m.regs.x = s.x ?? X;
  m.mem.write8(PLAYER_SHOT_DEPTH, s.shared ?? 0x55);
  const stash = s.stash ?? [0, 0, 0, 0, 0, 0, 0];
  const flags = s.flags ?? [0, 0, 0, 0, 0, 0, 0];
  const alt = s.alt ?? [0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16];
  for (let i = 0; i < 7; i++) {
    m.mem.write8((ENEMY_DEPTH + i) & 0xffff, stash[i]);
    m.mem.write8((ENEMY_SLOT_FLAGS + i) & 0xffff, flags[i]);
    m.mem.write8((ENEMY_SLOT_DIR + i) & 0xffff, alt[i]);
  }
  m.mem.write8(FIRE_GATE, s.gate ?? 0x00);
  m.mem.write8(ENEMY_TOTAL_COUNT, s.c108 ?? 0x05);
  m.mem.write8(ENEMY_TYPE_COUNT, s.c109 ?? 0x02);
  m.mem.write8(SCRIPT_CURSOR, s.c10b ?? 0x00);
  m.mem.write8(TABLE_CURSOR, s.c38 ?? 0x00);
}

test("CAPTURE: real 0x9d06 dispatches -- settleEnemyAtTargetDepth == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); settleEnemyAtTargetDepth(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: seeded states across every branch == oracle (RAM)", () => {
  const cases = [
    { tag: "kind 1 + gate set -> toggle $028a,x", flags: [0, 0, 0, 0x01, 0, 0, 0], gate: 0x01 },
    { tag: "negative slot -> inc $02df,x", flags: [0, 0, 0, 0x82, 0, 0, 0] },
    { tag: "$0109==1 scan match", c109: 1, flags: [0, 0, 0, 0x02, 0, 0, 0], shared: 0x55, stash: [0, 0, 0x55, 0, 0, 0, 0] },
    { tag: "$0109==1 scan no match -> loser index", c109: 1, flags: [0, 0, 0, 0x02, 0, 0, 0], shared: 0x55, stash: [0, 0, 0, 0, 0, 0, 0] },
    { tag: "$0109!=1 -> jsr $9d67 tail", c109: 2, flags: [0, 0, 0, 0x02, 0, 0, 0] },
  ];
  for (const s of cases) {
    const o = new Machine(ROM, OPTS); seat(o, s);
    const c = new Machine(ROM, OPTS); seat(c, s);
    oracle(o); settleEnemyAtTargetDepth(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("Y-LIVE-OUT: the scan index / 9d67 Y is reproduced (steerSlotCoordinate reads it after the delegate)", () => {
  // The Y live-out is now the RETURN value (threaded to advanceEnemyLaneDepth's tail), not m.regs.y.
  // scan-match arm: the oracle leaves Y = the matched scan slot index.
  const scan = { c109: 1, flags: [0, 0, 0, 0x02, 0, 0, 0], shared: 0x55, stash: [0, 0, 0, 0, 0, 0, 0x55] };
  let o = new Machine(ROM, OPTS); seat(o, scan);
  let c = new Machine(ROM, OPTS); seat(c, scan);
  oracle(o); const scanY = settleEnemyAtTargetDepth(c);
  assert.equal(ramDiff(o, c), null, "scan arm RAM");
  assert.equal(scanY, o.regs.y, "scan arm: Y live-out (the scan index) matches the oracle");
  // 9d67 arm: the oracle leaves Y = ENEMY_SEGMENT,x.
  const j = { c109: 2, flags: [0, 0, 0, 0x02, 0, 0, 0] };
  o = new Machine(ROM, OPTS); seat(o, j);
  c = new Machine(ROM, OPTS); seat(c, j);
  oracle(o); const jY = settleEnemyAtTargetDepth(c);
  assert.equal(ramDiff(o, c), null, "9d67 arm RAM");
  assert.equal(jY, o.regs.y, "9d67 arm: Y live-out (ENEMY_SEGMENT,x) matches the oracle");
});

test("TEETH: a twin that skips the $010b tail store diverges from the oracle", () => {
  const s = { c109: 2, flags: [0, 0, 0, 0x02, 0, 0, 0], c10b: 0x00 };
  const o = new Machine(ROM, OPTS); seat(o, s);
  const c = new Machine(ROM, OPTS); seat(c, s);
  oracle(o);
  // BUG: performs the shared stash + counter dec but never lays the $010b marker or bumps $0109.
  const broken = (m) => {
    const { mem8 } = m;
    mem8[(ENEMY_DEPTH + X) & 0xffff] = mem8[PLAYER_SHOT_DEPTH];
    mem8[ENEMY_TOTAL_COUNT] = (mem8[ENEMY_TOTAL_COUNT] - 1) & 0xff;
    // (skips $010b = 0x41 and $0109++)
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped tail stores");
});

test("SP-TOOTH: the omitted-ret rewrite is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  seat(m, { flags: [0, 0, 0, 0x82, 0, 0, 0] });
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, settleEnemyAtTargetDepth, TARGET, m);
  assert.equal(r.placeable, true, `settleEnemyAtTargetDepth must be seam-placeable; got: ${r.error}`);
});
