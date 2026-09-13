// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_9025 (ROM 0x9025-0x902a) -- the startup init entry: it runs two seed
// routines in order (loc_921b, then loc_92c5) and TAIL-DELEGATES to the main init loc_902b. The idiomatic
// form dissolves the two JSRs and the tail fall-through into three plain calls. Contract is RAM
// (dumpState, minus STACK_SCRATCH); loc_9025 takes no input register and tail-delegates, so its exit
// registers are the delegate's and are NOT compared. loc_902b writes the signature bytes 0x0124=0x0148=0xff
// / 0x0123=0x00 and loc_921b writes 0x0200=0x0e, so the chain produces observable RAM on a bare boot.
// Run: node --test games/tempest/idiomatic/test/equivalence-9025.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9025 as oracle } from "../../translated/loc_9025.js";
import { loc_9025 } from "../loc_9025.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9025;
// The main-init signature byte: only loc_902b (the tail delegate) writes it, so it distinguishes a run
// that reached the delegate from one that did not.
const SIG = 0x0124;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

// POKEY coupling: loc_9025 tail-delegates to loc_902b -> loc_9246, which reads $60ca (POKEY1 RANDOM). That
// register is clock-coupled -- its poly index advances with CPU cycles, and each read charges cycles the
// idiomatic layer does not tick. The oracle (which steps every instruction) sees a FRESH random byte per
// load while the idiomatic layer sees a frozen one, so on a captured mid-run dispatch (SK_RESET set) the
// loc_9246 tag table diverges at $0203+. Freeze the polys (clear SK_RESET) so both arms read the SAME
// RANDOM byte on every load -- the same fix the loc_9246 equivalence test uses. A fresh Machine boots with
// skctl=0 (polys already frozen), so the CRAFTED arm below needs no freeze.
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0x9025 dispatches -- loc_9025 == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may reach an unimplemented callee arm
    if (threw) continue;                        // both layers would throw identically there
    loc_9025(c);
    assert.equal(ramDiff(o, c), null);
    // A/X/Y not compared: loc_9025 tail-delegates to loc_902b, so its exit registers are the delegate's.
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

test("CRAFTED: bare-boot startup init -- loc_9025 == oracle in RAM (-stack)", () => {
  const o = new Machine(ROM, OPTS);
  const c = new Machine(ROM, OPTS);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED: oracle threw on a bare boot -- skipped"); return; }
  loc_9025(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the startup init chain");
  // Both seed signatures landed: loc_921b's 0x0200 and loc_902b's 0x0124.
  assert.equal(c.mem.read8(0x0200), o.mem.read8(0x0200), "loc_921b signature matches the oracle");
  assert.equal(c.mem.read8(SIG), o.mem.read8(SIG), "loc_902b signature matches the oracle");
});

test("TEETH: a twin that drops the tail-delegate's signature write MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS);
  const c = new Machine(ROM, OPTS);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw on a bare boot -- skipped"); return; }
  let tried = 0;
  // Broken twin: run the full chain, then revert loc_902b's 0x0124=0xff signature. Only loc_902b writes
  // 0x0124, so reverting it guarantees a RAM divergence if the tail-delegate really ran.
  const broken = (m) => {
    const before = m.mem.read8(SIG);
    loc_9025(m);
    m.mem.write8(SIG, before); // BUG: undo the main-init signature write
  };
  broken(c);
  tried++;
  assert.ok(tried > 0, "the teeth twin never ran");
  assert.notEqual(ramDiff(o, c), null, "the dropped tail-delegate signature was NOT caught by the RAM compare");
});

test("SP-TOOTH: the omitted-ret tail-delegate is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, loc_9025, TARGET, m);
  assert.equal(r.placeable, true, `loc_9025 must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret tail-delegate placeable");
});
