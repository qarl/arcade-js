// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for storeSpriteShadowEntry (0x3956) -- the tail of the per-object shadow loop. It
// stores the passed value to the object's shadow slot ($07c0,X), derives its attribute byte from bit6 of
// $34,X (a raised floor for the low slots) into $07f0,X, then decrements X and either re-enters the shadow
// builder or drops into the interrupt tail. SP is RETIRED: the interrupt fires as a direct call, so the
// idiomatic chain it drops into pulls no frame and does not RTI -- it leaves SP INERT, deliberately
// diverging from the oracle (which still RTIs). So the arms assert SP is inert, not that it matches the
// oracle. CAPTURE replays every real dispatch byte-exact; TEETH proves the RAM diff and the SP-inert bite.
//
// This dispatch keeps the loop/tail m.calls, so the oracle runs the whole shadow loop AND the interrupt
// tail (loc_396d) through the frozen fallback -- which STEPS, advancing m.cycles, so the tail's IN0 read
// (0x0c00) sees a freshly-recomputed vblank bit (bit6, machine.js tick(): cycles%FRAME >= VBLANK_START).
// The clock-free idiomatic chain never ticks, so its vblank is frozen at the captured value -- and the
// tail stores that raw IN0 byte to $bd,X, so a naive capture-replay diverges ONLY on that one clock bit,
// never on any shadow-store logic. We neutralize that single engine-level clock variable identically on
// both sides (pinVblank), exactly as equivalence-28bf pins the POKEY poly counter and the RAM diff
// skips stack scratch below the entry SP; every $07c0/$07f0 shadow cell is still compared byte-exact. Verified null under
// BOTH vblank phases, so this hides no logic divergence -- the only difference was the clock bit.
// Run: node --test games/centiped/idiomatic/test/equivalence-3956.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3956 as oracleRom } from "../../translated/loc_3956.js";
import { storeSpriteShadowEntry } from "../storeSpriteShadowEntry.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { SPRITE_SHADOW_CODE } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x3956;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// Hold IN0 bit6 (screen vblank) constant so the interrupt tail's 0x0c00 read is identical on both sides:
// the oracle path STEPS (m.cycles advances, tick() recomputes vblank), while the clock-free idiomatic
// chain never ticks. Freezing the property (no-op setter) makes the oracle's tick() assignment a no-op, so
// both read the same bit6 -- the one clock-derived variable the clock-free layer cannot reproduce. Pin the
// SAME value on both clones or the neutralization is meaningless.
function pinVblank(m, v = 0) {
  Object.defineProperty(m.io, "vblank", { get: () => v, set: () => {}, configurable: true });
  return m;
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(128, 4000) : [];

test("CAPTURE: real 0x3956 dispatches == storeSpriteShadowEntry in RAM (-stack)", () => {
  let sawTop = false, sawLow = false;
  for (const cap of CAPS) {
    const o = pinVblank(cap.clone()), c = pinVblank(cap.clone());
    if (cap.regs.x >= 12) sawTop = true; else sawLow = true; // both attribute floors exercised
    oracle(o); storeSpriteShadowEntry(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.s, cap.regs.s, "SP inert -- the rewrite never touches the stack");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked (highSlot=${sawTop} lowSlot=${sawLow})`);
});

test("TEETH: a wrong shadow slot is caught by the RAM diff", () => {
  const cap = CAPS[0].clone();
  const cell = (SPRITE_SHADOW_CODE + (cap.regs.x & 0xff)) & 0xffff;
  const o = pinVblank(cap.clone()), c = pinVblank(cap.clone());
  oracle(o); storeSpriteShadowEntry(c);
  assert.equal(ramDiff(o, c), null, "precondition: the rewrite matches");
  const broken = (m) => { storeSpriteShadowEntry(m); m.mem8[cell] = (m.mem8[cell] + 1) & 0xff; };
  const c2 = pinVblank(cap.clone()); // same vblank pin as o, so the ONLY diff is the corrupted shadow slot
  broken(c2);
  const d = ramDiff(o, c2);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a wrong shadow slot");
  assert.equal(d.addr, cell);
});

test("TEETH(SP): the rewrite is SP-inert; a stray stack touch is caught", () => {
  const cap = CAPS[0].clone();
  const entrySP = cap.regs.s;
  const c = cap.clone();
  storeSpriteShadowEntry(c);
  assert.equal(c.regs.s, entrySP, "precondition: the rewrite leaves SP inert (fired as a direct call)");
  const leaky = (m) => { m.push8(0x00); return storeSpriteShadowEntry(m); };
  const c2 = cap.clone();
  leaky(c2);
  assert.notEqual(c2.regs.s, entrySP, "the SP-inert tooth FAILED to catch a stray push");
});
