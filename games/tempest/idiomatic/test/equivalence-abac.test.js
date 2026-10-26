// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for rebuildControlBlocksFromTemplate (ROM 0xabac-0xac07) -- refreshes edge state via requestRebuildIfSwitchesChanged, arms $0100,
// requests both rebuild flags via raiseRebuildRequestBits when the three sources are idle, then per request bit copies a
// template block into $0606 or fills $0706 with ones, optionally latches the control snapshot into
// $071e/$071f, and clears the low two request bits of $01c9. The idiomatic side dissolves jsr $ac20 and
// jsr $ac36 into direct calls. Live-out is RAM plus the exit [X, Y] it returns, so each arm compares RAM
// (dumpState minus stack scratch below the entry SP) and the CAPTURE arm also the returned pair. Run: node --test games/tempest/idiomatic/test/equivalence-abac.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_abac } from "../../translated/loc_abac.js";
import { rebuildControlBlocksFromTemplate } from "../rebuildControlBlocksFromTemplate.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_100, PENDING_WORK_FLAGS, SLOT_VALUE, GLYPH_PARAM_X, loc_71b, loc_71c, loc_71d } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xabac;
const oracle = atEntry(loc_abac);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xabac dispatches -- rebuildControlBlocksFromTemplate == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); { c.regs.x ^= 0xff; c.regs.y ^= 0xff; // m.regs poisoned: this routine takes no entry X/Y, so its exit must not depend on them
      assert.deepEqual(rebuildControlBlocksFromTemplate(c), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// All three sources idle -> raiseRebuildRequestBits sets both request bits -> both loops run to top 0x17 and the snapshot
// latches. Dirty sentinels in the copy/fill targets prove the writes actually cover them.
function seedIdle(m) {
  m.mem.write8(loc_71b, 0x00); m.mem.write8(loc_71c, 0x00); m.mem.write8(loc_71d, 0x00);
  m.mem.write8(PENDING_WORK_FLAGS, 0x00);
  for (let i = 0; i <= 0x17; i++) { m.mem.write8((SLOT_VALUE + i) & 0xffff, 0x99); m.mem.write8((GLYPH_PARAM_X + i) & 0xffff, 0x99); }
}

test("CRAFTED: idle sources -> both blocks written, snapshot latched -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedIdle(o);
  const c = new Machine(ROM, OPTS); seedIdle(c);
  oracle(o); rebuildControlBlocksFromTemplate(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after refresh + copy + fill + latch");
  assert.equal(c.mem.read8(loc_100), 0x08, "$0100 armed");
  assert.equal((c.mem.read8(PENDING_WORK_FLAGS) & 0x03), 0x00, "low two request bits cleared");
});

// bit0 set, bit1 clear, sources busy so raiseRebuildRequestBits does NOT run: the copy loop tops at 0x17 while the fill
// loop tops at 0x0e -- a marshalling check on the two distinct request bits.
function seedBit0(m) {
  m.mem.write8(loc_71b, 0x01); m.mem.write8(loc_71c, 0x00); m.mem.write8(loc_71d, 0x00);
  m.mem.write8(PENDING_WORK_FLAGS, 0x01);
  for (let i = 0; i <= 0x17; i++) { m.mem.write8((SLOT_VALUE + i) & 0xffff, 0x99); m.mem.write8((GLYPH_PARAM_X + i) & 0xffff, 0x99); }
}

test("CRAFTED (marshalling): bit0-only -> copy tops 0x17, fill tops 0x0e -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedBit0(o);
  const c = new Machine(ROM, OPTS); seedBit0(c);
  oracle(o); rebuildControlBlocksFromTemplate(c);
  assert.equal(ramDiff(o, c), null, "RAM equal for distinct copy/fill loop tops");
});

test("TEETH: a no-op twin diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedIdle(o); oracle(o);
  const c = new Machine(ROM, OPTS); seedIdle(c);
  const brokenAbac = (_m) => { /* BUG: never refreshes, arms, copies, fills or latches */ };
  brokenAbac(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped work");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, rebuildControlBlocksFromTemplate, TARGET, m);
  assert.equal(r.placeable, true, `rebuildControlBlocksFromTemplate must be seam-placeable; got: ${r.error}`);
});
