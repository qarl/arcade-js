// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for advanceSpreadingSpanAnimation -- rebuilds the paired cursors via emitSegmentedSpanBetweenCursors, then clamps $014e/$014d
// and (on the pin path) stores $01. Dissolves the m.call(b15a) into a direct idiomatic call. The oracle
// m.calls the frozen b15a; the idiomatic calls the idiomatic one. All output is RAM (b15a's vector fill +
// the clamp cells), so each arm compares the RAM diff (minus the dead stack). A/X/Y at RTS incidental.
// Run: node --test games/tempest/idiomatic/test/equivalence-b102.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b102 } from "../../translated/loc_b102.js";
import { advanceSpreadingSpanAnimation } from "../advanceSpreadingSpanAnimation.js";
import { emitSegmentedSpanBetweenCursors } from "../emitSegmentedSpanBetweenCursors.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_14e, loc_14d, MODE_DISPATCH_SEL } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb102;
const oracle = atEntry(loc_b102);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

function seat(m, s = {}) {
  m.mem.write8(loc_14e, s.far ?? 0x00);
  m.mem.write8(loc_14d, s.near ?? 0x00);
  m.mem.write8(MODE_DISPATCH_SEL, s.one ?? 0x00);
}

test("CAPTURE: real 0xb102 dispatches -- advanceSpreadingSpanAnimation == oracle in RAM (-stack, poly frozen)", () => {
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    oracle(o); advanceSpreadingSpanAnimation(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: wrap/early-out, near<far early-out, and the pin path == oracle (RAM)", () => {
  const cases = [
    { tag: "wrap then far<0x50 -> early rts", far: 0x30, near: 0x88, one: 0x00 },
    { tag: "far>=0xa0 (no wrap), near<far -> early rts", far: 0xb0, near: 0x10, one: 0x00 },
    { tag: "wrap, near>=far -> pin $014d=0xa0, $01=0x14", far: 0x90, near: 0xa0, one: 0x00 },
  ];
  if (!CAPS.length) { console.log("  CRAFTED: no dispatch captured -- skipped"); return; }
  for (const s of cases) {
    // Seed from a real dispatch so b15a's tail vector-drawer (drawSlotShapeWithHeader) has valid list pointers
    // ($ac/$74); a fresh Machine leaves them 0 -> ab17 reads a wild MMIO address. Then overwrite
    // $014e/$014d/$01 to drive the clamp branch under test (the drawer never touches those cells).
    const o = freezePokey(CAPS[0].clone()); seat(o, s);
    const c = freezePokey(CAPS[0].clone()); seat(c, s);
    oracle(o); advanceSpreadingSpanAnimation(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("TEETH: a twin that skips the $01 pin store diverges on the pin path", () => {
  const s = { far: 0x90, near: 0xa0, one: 0x00 };
  const o = freezePokey(new Machine(ROM, OPTS)); seat(o, s);
  const c = freezePokey(new Machine(ROM, OPTS)); seat(c, s);
  oracle(o);
  // BUG: reaches the pin but never writes $01 (drops the sta $01).
  const broken = (m) => {
    const { mem8 } = m;
    emitSegmentedSpanBetweenCursors(m, 0x34, 0xaa);
    let far = mem8[loc_14e];
    if (far < 0xa0) { far = (far + 0x14) & 0xff; mem8[loc_14e] = far; }
    if (far < 0x50) return;
    const near = (mem8[loc_14d] + 0x08) & 0xff;
    mem8[loc_14d] = near;
    if (near < far) return;
    mem8[loc_14d] = 0xa0; // forgets $01 = 0x14
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the dropped $01 store");
});

test("SP-TOOTH: the omitted-ret rewrite is seam-placeable", () => {
  const m = freezePokey(new Machine(ROM, OPTS));
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, advanceSpreadingSpanAnimation, TARGET, m);
  assert.equal(r.placeable, true, `advanceSpreadingSpanAnimation must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret rewrite placeable");
});
