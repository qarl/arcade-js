// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for dispatchDisplayModeHandler (ROM 0xb20d-0xb217) -- an RTS-trampoline computed-jump dispatcher: it reads the
// pre-doubled selector in MODE_DISPATCH_SEL, pushes word(0xb218+sel)(target-1), and rts-dispatches to target. The word
// table at 0xb218 holds twelve entries; the idiomatic form dissolves the trick into TABLE[MODE_DISPATCH_SEL>>1](m).
// Contract: RAM (dumpState minus stack scratch below the entry SP). A dispatching rewrite -> SP-tooth (seamPlaceable). Some
// targets reach the clock-coupled POKEY RANDOM, so CAPTURE freezes it on both clones.
// Run: node --test games/tempest/idiomatic/test/equivalence-b20d.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b20d } from "../../translated/loc_b20d.js";
import { dispatchDisplayModeHandler } from "../dispatchDisplayModeHandler.js";
import { drawFrame } from "../drawFrame.js";
import { buildVectorItemList } from "../buildVectorItemList.js";
import { drawMovingObjectSlots } from "../drawMovingObjectSlots.js";
import { drawScoreDeltaPanel } from "../drawScoreDeltaPanel.js";
import { drawTubeWell } from "../drawTubeWell.js";
import { seedRngAndDrawCounterPanel } from "../seedRngAndDrawCounterPanel.js";
import { drawFrameWithSlot00 } from "../drawFrameWithSlot00.js";
import { drawFrameWithSlot08 } from "../drawFrameWithSlot08.js";
import { composeFrameThenDrawSlot06 } from "../composeFrameThenDrawSlot06.js";
import { advanceSpreadingSpanAnimation } from "../advanceSpreadingSpanAnimation.js";
import { advancePinchingSpanAnimation } from "../advancePinchingSpanAnimation.js";
import { drawFrameWithSlot32 } from "../drawFrameWithSlot32.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { MODE_DISPATCH_SEL } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb20d;
const TABLE = [drawFrame, buildVectorItemList, drawMovingObjectSlots, drawScoreDeltaPanel, drawTubeWell, seedRngAndDrawCounterPanel, drawFrameWithSlot00, drawFrameWithSlot08, composeFrameThenDrawSlot06, advanceSpreadingSpanAnimation, advancePinchingSpanAnimation, drawFrameWithSlot32];
const oracle = atEntry(loc_b20d);
const ramDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xb20d dispatches -- dispatchDisplayModeHandler == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    dispatchDisplayModeHandler(c);
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} compared`);
});

test("CRAFTED: each of the twelve entries -> dispatchDisplayModeHandler == oracle in RAM; skip on oracle throw", () => {
  let checked = 0;
  for (let i = 0; i < TABLE.length; i++) {
    const o = freezePokey(new Machine(ROM, OPTS)); o.mem.write8(MODE_DISPATCH_SEL, i * 2);
    const c = freezePokey(new Machine(ROM, OPTS)); c.mem.write8(MODE_DISPATCH_SEL, i * 2);
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    dispatchDisplayModeHandler(c);
    assert.equal(ramDiff(o, c), null, `RAM equal dispatching entry ${i}`);
    checked++;
  }
  console.log(`  CRAFTED: ${checked}/${TABLE.length} entries provisioned and checked`);
  assert.ok(checked >= 1, "no entry could be provisioned -- seed is inert");
});

test("TEETH: a twin that dispatches the WRONG entry (idx^1) diverges in RAM", () => {
  // Driven from real captured states (provisioned) -- the correct target runs cleanly; the flipped one
  // must reach a different RAM outcome on at least one state.
  let caught = false, tried = 0;
  for (const cap of CAPS) {
    const idx = cap.mem.read8(MODE_DISPATCH_SEL) >> 1;
    const flipped = idx ^ 1;
    if (idx >= TABLE.length || flipped >= TABLE.length) continue;
    const o = freezePokey(cap.clone());
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    const c = freezePokey(cap.clone());
    let brokeThrew = false;
    try { TABLE[flipped](c); } catch { brokeThrew = true; }
    if (brokeThrew) continue;
    tried++;
    if (ramDiff(o, c) !== null) { caught = true; break; }
  }
  assert.ok(tried > 0, "no captured state could be exercised for the teeth arm");
  assert.ok(caught, "the RAM diff FAILED to catch a wrong-entry dispatch on every exercised state");
});

test("SP-TOOTH: the omitted-ret dispatcher is seam-placeable", () => {
  let placed = false, lastErr = "no provisioned capture";
  for (const cap of CAPS) {
    const m = freezePokey(cap.clone());
    m.regs.s = 0xfb;
    m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
    const r = seamPlaceable(withOmittedRet, dispatchDisplayModeHandler, TARGET, m);
    if (r.placeable) { placed = true; break; }
    lastErr = r.error;
  }
  assert.equal(placed, true, `dispatchDisplayModeHandler must be seam-placeable on some captured state; last: ${lastErr}`);
});
