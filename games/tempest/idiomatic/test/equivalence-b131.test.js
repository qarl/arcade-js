// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for advancePinchingSpanAnimation -- rebuilds the paired cursors via emitSegmentedSpanBetweenCursors, then decrements $014d
// (guarded) and pulls $014e down toward it. Dissolves the m.call(b15a) into a direct idiomatic call. The
// oracle m.calls the frozen b15a; the idiomatic calls the idiomatic one. All output is RAM (b15a's vector
// fill + the clamp cells), so each arm compares the RAM diff (minus the dead stack). A/X/Y at RTS incidental.
// Run: node --test games/tempest/idiomatic/test/equivalence-b131.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b131 } from "../../translated/loc_b131.js";
import { advancePinchingSpanAnimation } from "../advancePinchingSpanAnimation.js";
import { emitSegmentedSpanBetweenCursors } from "../emitSegmentedSpanBetweenCursors.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_14d, loc_14e } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb131;
const oracle = atEntry(loc_b131);
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
  m.mem.write8(loc_14d, s.near ?? 0x00);
  m.mem.write8(loc_14e, s.far ?? 0x00);
}

test("CAPTURE: real 0xb131 dispatches -- advancePinchingSpanAnimation == oracle in RAM (-stack, poly frozen)", () => {
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    oracle(o); advancePinchingSpanAnimation(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: near<0x30 skip, dec-then-high early-out, and the far-pull cases == oracle (RAM)", () => {
  const cases = [
    { tag: "near<0x30 skip, far pulled down to near", near: 0x20, far: 0x40 },
    { tag: "dec drops near below 0 -> high -> early rts", near: 0x00, far: 0x40 },
    { tag: "far-1 >= near -> keep far-1", near: 0x40, far: 0x60 },
    { tag: "far-1 < near -> far := near", near: 0x50, far: 0x50 },
  ];
  if (!CAPS.length) { console.log("  CRAFTED: no dispatch captured -- skipped"); return; }
  for (const s of cases) {
    // Seed from a real dispatch so b15a's tail vector-drawer (drawSlotShapeWithHeader) has valid list pointers
    // ($ac/$74); a fresh Machine leaves them 0 -> ab17 reads a wild MMIO address. Then overwrite
    // $014d/$014e to drive the clamp branch under test (the drawer never touches those cells).
    const o = freezePokey(CAPS[0].clone()); seat(o, s);
    const c = freezePokey(CAPS[0].clone()); seat(c, s);
    oracle(o); advancePinchingSpanAnimation(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("TEETH: a twin that always keeps far-1 (never clamps up to near) diverges", () => {
  if (!CAPS.length) { console.log("  TEETH: no dispatch captured -- skipped"); return; }
  // near=0x50 decrements to 0x4f; far-1 = 0x3f < 0x4f -> the oracle clamps $014e up to $014d (0x4f),
  // while the broken twin keeps far-1 (0x3f). (CAPS base so b15a's drawer pointers are valid.)
  const s = { near: 0x50, far: 0x40 };
  const o = freezePokey(CAPS[0].clone()); seat(o, s);
  const c = freezePokey(CAPS[0].clone()); seat(c, s);
  oracle(o);
  // BUG: unconditionally keeps far-1, skipping the far := near clamp.
  const broken = (m) => {
    const { mem8 } = m;
    emitSegmentedSpanBetweenCursors(m, 0x3f, 0x4e);
    let near = mem8[loc_14d];
    if (near >= 0x30) { near = (near - 1) & 0xff; mem8[loc_14d] = near; }
    if (near >= 0x80) return;
    mem8[loc_14e] = (mem8[loc_14e] - 1) & 0xff;
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the missing far := near clamp");
});

test("SP-TOOTH: the omitted-ret rewrite is seam-placeable", () => {
  const m = freezePokey(new Machine(ROM, OPTS));
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, advancePinchingSpanAnimation, TARGET, m);
  assert.equal(r.placeable, true, `advancePinchingSpanAnimation must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret rewrite placeable");
});
