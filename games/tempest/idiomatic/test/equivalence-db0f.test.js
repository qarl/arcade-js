// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for dispatchDrawHandler (ROM 0xdb0f-0xdb21) -- an RTS-trick COMPUTED-JUMP dispatcher: it reads a byte
// offset from GAME_MODE, clamps it to 0x02 (persisting the clamp to GAME_MODE) when >= 0x0e, then pushes
// word($db01+offset) and rts, jumping to (word+1). The seven targets (word+1) are 0xdb5a/0xdbf7/0xdb84/
// 0xdb9a/0xdb7e/0xdb6f/0xdb22 -- the per-frame draw handlers -- and each RTS returns to dispatchDrawHandler's own
// caller. The idiomatic form dissolves the push/pull16/rts-jump into TABLE[offset>>1](m). All seven
// targets take only (m); the register work is the dead rts-trick, so the contract is RAM (dumpState,
// minus stack scratch below the entry SP). Not reached in a 3000-frame boot, so the proof rests on CRAFTED + CLAMP + TEETH + SP.
// Run: node --test games/tempest/idiomatic/test/equivalence-db0f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_db0f } from "../../translated/loc_db0f.js";
import { dispatchDrawHandler } from "../dispatchDrawHandler.js";
import { beginEaromSequenceIfIdle } from "../beginEaromSequenceIfIdle.js";
import { emitReadoutVectorList } from "../emitReadoutVectorList.js";
import { emitFixedHeaderAndClearVectorSlots } from "../emitFixedHeaderAndClearVectorSlots.js";
import { stepVectorPhaseAnimation } from "../stepVectorPhaseAnimation.js";
import { emitPrimedHeaderAndClearVectorSlots } from "../emitPrimedHeaderAndClearVectorSlots.js";
import { emitHalvedCountHeaderAndClearVectorSlots } from "../emitHalvedCountHeaderAndClearVectorSlots.js";
import { initVectorDisplayRegisters } from "../initVectorDisplayRegisters.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u16 } from "../../../../core/int.js";
import {
  GAME_MODE, loc_2e, loc_2f, INPUT_EDGE_FLAGS, SPINNER_ACCUM, SPINNER_POT_PREV, DRAW_CURSOR_LO, DRAW_CURSOR_HI, SEG_SPREAD_A_LO, SEG_SPREAD_A_LO_5,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xdb0f;
const TABLE = [beginEaromSequenceIfIdle, emitReadoutVectorList, emitFixedHeaderAndClearVectorSlots, stepVectorPhaseAnimation, emitPrimedHeaderAndClearVectorSlots, emitHalvedCountHeaderAndClearVectorSlots, initVectorDisplayRegisters];
const oracle = atEntry(loc_db0f);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// Aim the dispatcher at table offset `off` (GAME_MODE) and provision the draw pipeline so at least one
// handler runs: the display cursor into vector RAM, the frame counter + both emit tables (entry 1's
// vector-list emit needs), and a generic object-pointer table for the chasing handlers.
function seed(m, off) {
  m.mem.write8(GAME_MODE, off);
  m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_HI, 0x20); // cursor -> vector RAM 0x2000
  m.mem.write8(loc_2e, 0x37); m.mem.write8(loc_2f, 0x12); // frame counter nonzero
  m.mem.write8(INPUT_EDGE_FLAGS, 0x05);
  m.mem.write8(SPINNER_POT_PREV, 0x10);
  m.mem.write8(SPINNER_ACCUM, 0x02);
  m.mem.write8(SEG_SPREAD_A_LO + 0x01, 0x01);
  m.mem.write8(SEG_SPREAD_A_LO + 0x02, 0x03);
  m.mem.write8(SEG_SPREAD_A_LO_5 + 0x01, 0x20);
  m.mem.write8(SEG_SPREAD_A_LO_5 + 0x03, 0x40);
  for (let i = 0; i < 0x20; i++) m.mem.write8(u16(0x0400 + i), 0x20); // object slots -> a list at 0x0420
  m.mem.write8(0x0420, 0x80); // one bit7-terminated list entry
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xdb0f dispatches -- dispatchDrawHandler == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    dispatchDrawHandler(c);
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

test("CRAFTED: each table entry off=0,2,4,6,8,10,12 -- dispatchDrawHandler == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const off of [0, 2, 4, 6, 8, 10, 12]) {
    const o = new Machine(ROM, OPTS); seed(o, off);
    const c = new Machine(ROM, OPTS); seed(c, off);
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue; // an entry the generic seed cannot fully provision -- CAPTURE + others carry it
    dispatchDrawHandler(c);
    assert.equal(ramDiff(o, c), null, `RAM equal after dispatching offset ${off}`);
    checked++;
  }
  console.log(`  CRAFTED: ${checked}/7 entries provisioned and checked`);
  assert.ok(checked >= 1, "no entry could be provisioned -- seed is inert");
});

test("CLAMP: an out-of-range offset (0x20) clamps to entry 1 -- dispatchDrawHandler == oracle, GAME_MODE rewritten to 2", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x20);
  const c = new Machine(ROM, OPTS); seed(c, 0x20);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CLAMP: entry-1 seed threw -- skipped"); return; }
  dispatchDrawHandler(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the clamp path");
  assert.equal(c.mem.read8(GAME_MODE), 0x02, "GAME_MODE was clamped to 0x02 and persisted");
});

test("TEETH: a twin that dispatches the WRONG entry (off>>1)^1 diverges in RAM", () => {
  let caught = false, tried = 0;
  for (const off of [0, 2, 4, 6, 8, 10, 12]) {
    const o = new Machine(ROM, OPTS); seed(o, off);
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    const c = new Machine(ROM, OPTS); seed(c, off);
    const idx = off >> 1, flipped = idx ^ 1;
    if (flipped >= TABLE.length) continue;
    let brokeThrew = false;
    try { TABLE[flipped](c); } catch { brokeThrew = true; }
    if (brokeThrew) continue;
    tried++;
    if (ramDiff(o, c) !== null) { caught = true; break; }
  }
  assert.ok(tried > 0, "no entry pair could be exercised for the teeth arm");
  assert.ok(caught, "the RAM diff FAILED to catch a wrong-entry dispatch on every exercised pair");
});

test("SP-TOOTH: the omitted-ret dispatcher (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seed(m, 0x02); // entry 1 provisions cleanly
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, dispatchDrawHandler, TARGET, m);
  assert.equal(r.placeable, true, `dispatchDrawHandler must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret dispatcher (moved 0) placeable");
});
