// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for composeFrameDisplayList -- per-frame draw setup: aaa8 + a97f sprite passes, an optional
// checksum/table rebuild (unless $00==4), then df39/ab14/b0c6 draws. Dissolves all m.calls into direct
// idiomatic calls; the oracle m.calls the frozen callees, the idiomatic calls the idiomatic ones. All
// output is RAM, so each arm compares the RAM diff (minus the dead stack). An omitted-ret rewrite.
// Run: node --test games/tempest/idiomatic/test/equivalence-a8e7.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a8e7 } from "../../translated/loc_a8e7.js";
import { composeFrameDisplayList } from "../composeFrameDisplayList.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { GAME_MODE, STATUS_FLAGS, loc_3d, ACTIVE_SLOT_COUNT, loc_43, loc_44, loc_45, loc_102 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa8e7;
const oracle = atEntry(loc_a8e7);
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
  m.mem.write8(GAME_MODE, s.c00 ?? 0x00);
  m.mem.write8(STATUS_FLAGS, s.c05 ?? 0x00);
  m.mem.write8(ACTIVE_SLOT_COUNT, s.c3e ?? 0x00);
  m.mem.write8(loc_43, s.c43 ?? 0x00);
  m.mem.write8(loc_44, s.c44 ?? 0x00);
  m.mem.write8(loc_45, s.c45 ?? 0x00);
  m.mem.write8(loc_3d, s.c3d ?? 0x00);
  m.mem.write8((loc_102 + (s.c3d ?? 0x00)) & 0xffff, s.slot ?? 0x00);
}

test("CAPTURE: real 0xa8e7 dispatches -- composeFrameDisplayList == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); composeFrameDisplayList(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: idle ($00==4 skips checksum) and active ($00==0x18, checksum + tail pair) == oracle (RAM)", () => {
  const cases = [
    { tag: "idle: $00==4 skips rebuild, $05 clear skips second pass", c00: 0x04, c05: 0x00 },
    { tag: "second-pass via $05<0 -> $3e path", c00: 0x04, c05: 0x80, c3e: 0x7f },
    { tag: "second-pass via ora $43/44/45", c00: 0x04, c05: 0x00, c43: 0x10 },
    { tag: "active: checksum + tail b0c6 pair", c00: 0x18, c05: 0x80, c3d: 0x00, slot: 0x05 },
    { tag: "active: tail slot zero skips pair", c00: 0x18, c05: 0x80, c3d: 0x02, slot: 0x00 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM, OPTS); seat(o, s);
    const c = new Machine(ROM, OPTS); seat(c, s);
    oracle(o); composeFrameDisplayList(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("TEETH: oracle on the idle seed vs idiomatic on the active seed MUST diverge", () => {
  const o = new Machine(ROM, OPTS); seat(o, { c00: 0x04, c05: 0x00 });        // skips checksum rebuild
  const c = new Machine(ROM, OPTS); seat(c, { c00: 0x18, c05: 0x80, slot: 0x05 }); // runs it + tail draws
  oracle(o); composeFrameDisplayList(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the divergent control state");
});

test("SP-TOOTH: the omitted-ret rewrite is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  seat(m, { c00: 0x04 });
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, composeFrameDisplayList, TARGET, m);
  assert.equal(r.placeable, true, `composeFrameDisplayList must be seam-placeable; got: ${r.error}`);
});
