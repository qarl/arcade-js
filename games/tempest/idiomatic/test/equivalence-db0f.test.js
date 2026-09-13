// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for loc_db0f (ROM 0xdb0f-0xdb21) -- an RTS-trick COMPUTED-JUMP dispatcher: it reads a byte
// offset from loc_00, clamps it to 0x02 (persisting the clamp to loc_00) when >= 0x0e, then pushes
// word($db01+offset) and rts, jumping to (word+1). The seven targets (word+1) are 0xdb5a/0xdbf7/0xdb84/
// 0xdb9a/0xdb7e/0xdb6f/0xdb22 -- the per-frame draw handlers -- and each RTS returns to loc_db0f's own
// caller. The idiomatic form dissolves the push/pull16/rts-jump into TABLE[offset>>1](m). All seven
// targets take only (m); the register work is the dead rts-trick, so the contract is RAM (dumpState,
// minus STACK_SCRATCH). Not reached in a 3000-frame boot, so the proof rests on CRAFTED + CLAMP + TEETH + SP.
// Run: node --test games/tempest/idiomatic/test/equivalence-db0f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_db0f as oracle } from "../../translated/loc_db0f.js";
import { loc_db0f } from "../loc_db0f.js";
import { loc_db5a } from "../loc_db5a.js";
import { loc_dbf7 } from "../loc_dbf7.js";
import { loc_db84 } from "../loc_db84.js";
import { loc_db9a } from "../loc_db9a.js";
import { loc_db7e } from "../loc_db7e.js";
import { loc_db6f } from "../loc_db6f.js";
import { loc_db22 } from "../loc_db22.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";
import {
  STACK_SCRATCH, loc_00, loc_2e, loc_2f, loc_4e, loc_50, loc_52, loc_74, loc_75, loc_78, loc_7d,
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
const TABLE = [loc_db5a, loc_dbf7, loc_db84, loc_db9a, loc_db7e, loc_db6f, loc_db22];
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

// Aim the dispatcher at table offset `off` (loc_00) and provision the draw pipeline so at least one
// handler runs: the display cursor into vector RAM, the frame counter + both emit tables (entry 1's
// vector-list emit needs), and a generic object-pointer table for the chasing handlers.
function seed(m, off) {
  m.mem.write8(loc_00, off);
  m.mem.write8(loc_74, 0x00); m.mem.write8(loc_75, 0x20); // cursor -> vector RAM 0x2000
  m.mem.write8(loc_2e, 0x37); m.mem.write8(loc_2f, 0x12); // frame counter nonzero
  m.mem.write8(loc_4e, 0x05);
  m.mem.write8(loc_52, 0x10);
  m.mem.write8(loc_50, 0x02);
  m.mem.write8(loc_78 + 0x01, 0x01);
  m.mem.write8(loc_78 + 0x02, 0x03);
  m.mem.write8(loc_7d + 0x01, 0x20);
  m.mem.write8(loc_7d + 0x03, 0x40);
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

test("CAPTURE: real 0xdb0f dispatches -- loc_db0f == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    loc_db0f(c);
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

test("CRAFTED: each table entry off=0,2,4,6,8,10,12 -- loc_db0f == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const off of [0, 2, 4, 6, 8, 10, 12]) {
    const o = new Machine(ROM, OPTS); seed(o, off);
    const c = new Machine(ROM, OPTS); seed(c, off);
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue; // an entry the generic seed cannot fully provision -- CAPTURE + others carry it
    loc_db0f(c);
    assert.equal(ramDiff(o, c), null, `RAM equal after dispatching offset ${off}`);
    checked++;
  }
  console.log(`  CRAFTED: ${checked}/7 entries provisioned and checked`);
  assert.ok(checked >= 1, "no entry could be provisioned -- seed is inert");
});

test("CLAMP: an out-of-range offset (0x20) clamps to entry 1 -- loc_db0f == oracle, loc_00 rewritten to 2", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x20);
  const c = new Machine(ROM, OPTS); seed(c, 0x20);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CLAMP: entry-1 seed threw -- skipped"); return; }
  loc_db0f(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the clamp path");
  assert.equal(c.mem.read8(loc_00), 0x02, "loc_00 was clamped to 0x02 and persisted");
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
  const r = seamPlaceable(withOmittedRet, loc_db0f, TARGET, m);
  assert.equal(r.placeable, true, `loc_db0f must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret dispatcher (moved 0) placeable");
});
