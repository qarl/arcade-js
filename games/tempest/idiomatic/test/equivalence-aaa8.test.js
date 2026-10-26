// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawOverlayFrame (ROM 0xaaa8-0xaaf2) -- per-frame draw driver: draws the phase slot via
// drawSlotShapeRecord, ticks $016e, chooses computeDisplayListChecksum or the alternate drawSlotShapeRecord(0x32) draw by the $0a/$03 gates,
// redraws slots 0x2c/0x2e, clamps $06 to <=0x28, draws its count via emitByteAsBcdDigits, then posts an optional
// word via emitCoordinateVectorWord when $17 is live. Dissolves every m.call. All output is RAM (draw setup + timer +
// clamp + emitted words), so each arm compares the RAM diff (minus the dead stack). Omitted-ret.
// Run: node --test games/tempest/idiomatic/test/equivalence-aaa8.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_aaa8 } from "../../translated/loc_aaa8.js";
import { drawOverlayFrame } from "../drawOverlayFrame.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { FRAME_COUNTER, PHASE_COUNTER, DSW1_SNAPSHOT, DSW2_SNAPSHOT, HEARTBEAT_ACCUM_HI, SCORE_DISPLAY_TIMER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xaaa8;
const oracle = atEntry(loc_aaa8);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

// The aeca/alternate choice is steered by $0a bit0 and $03 bit5; $06 exercises the clamp; $17 gates the
// trailing df39 post. Seed each to walk both sides of every branch.
function seat(m, s = {}) {
  m.mem.write8(DSW1_SNAPSHOT, s.c9 ?? 0x00);
  m.mem.write8(DSW2_SNAPSHOT, s.ca ?? 0x00);
  m.mem.write8(FRAME_COUNTER, s.c3 ?? 0x00);
  m.mem.write8(PHASE_COUNTER, s.c6 ?? 0x00);
  m.mem.write8(HEARTBEAT_ACCUM_HI, s.c17 ?? 0x00);
  m.mem.write8(SCORE_DISPLAY_TIMER, s.c16e ?? 0x40);
}

test("CAPTURE: real 0xaaa8 dispatches -- drawOverlayFrame == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); drawOverlayFrame(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: every branch path == oracle (RAM)", () => {
  const cases = [
    { tag: "gate clear -> aeca; $06 under clamp; $17 off", ca: 0x00, c3: 0x00, c6: 0x10, c17: 0x00 },
    { tag: "phase set, mode clear -> alternate draw", ca: 0x01, c3: 0x00, c6: 0x30, c17: 0x00 },
    { tag: "phase set, mode set -> aeca; $06 over clamp", ca: 0x01, c3: 0x20, c6: 0x77, c17: 0x00 },
    { tag: "$17 live -> trailing df39 post", ca: 0x00, c3: 0x00, c6: 0x00, c17: 0x05 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM, OPTS); seat(o, s);
    const c = new Machine(ROM, OPTS); seat(c, s);
    oracle(o); drawOverlayFrame(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("TEETH: a twin that skips the $016e tick and the $06 clamp diverges from the oracle", () => {
  const s = { ca: 0x01, c3: 0x20, c6: 0x77, c17: 0x00 };
  const o = new Machine(ROM, OPTS); seat(o, s); oracle(o);
  const c = new Machine(ROM, OPTS); seat(c, s);
  // BUG: never ticks $016e and never clamps $06 (leaves 0x77 unclamped).
  const broken = (_m) => { /* no-op */ };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped tick+clamp");
});

test("SP-TOOTH: the omitted-ret driver is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  seat(m, {});
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, drawOverlayFrame, TARGET, m);
  assert.equal(r.placeable, true, `drawOverlayFrame must be seam-placeable; got: ${r.error}`);
});
