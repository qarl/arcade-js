// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for runActorGroupStateHandler (ROM 0x64fb, Pooyan) — the 0x8c78 fountain-record
 * state dispatcher. It reads the state byte (IX+2) and rst-0x28 dispatches through the
 * inline word table at 0x64ff to one of three handlers (0=6505 1=6566 2=6666); each is a
 * tail hand-off, so the handler returns straight to runActorGroupStateHandler's caller.
 *
 * The oracle reaches its handler through the rst-0x28 trampoline (push the inline table
 * base, jp (hl) via the 0x64ff table); the module calls the handler directly. Because
 * `m.call` pushes no return, the handler runs at the SAME sp on both sides — the only
 * asymmetric stack write is the transient table base, which lands inside STACK_SCRATCH and
 * is excluded. So dispatching the correct handler leaves identical game RAM. The
 * dispatcher is memory-only: the caller (runObjectAndSpawnUpdatePass) reloads IX/IY after the call.
 *
 * Jobs:
 *   1. ROM-TABLE — the module's hardwired case->handler map matches the real ROM 0x64ff
 *      word table (the oracle reads it live).
 *   2. CAPTURE (best-effort) — replay any real 0x64fb dispatch a boot happens to reach.
 *   3. CRAFTED selector 1 (shallow, safe) — with (0x892f)!=0 handler 6566 just decrements
 *      it and returns: oracle == module in RAM.
 *   4. CRAFTED selectors 0 and 2 (robust) — run both under try/catch; they must take the
 *      same completion path, and RAM matches whenever the deep handler completes.
 *   5. TEETH — a twin that never dispatches, and a twin that mis-routes selector 1 to
 *      handler 2, are both CAUGHT (the (0x892f) decrement only the correct route makes).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-64fb.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_64fb as oracle } from "../../translated/loc_64fb.js";
import { runActorGroupStateHandler } from "../runActorGroupStateHandler.js";
import { loc_6666 } from "../../translated/loc_6666.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TARGET = 0x64fb;
const TABLE = 0x64ff;
const FOUNTAIN_REC = 0x8c78;
const SEL = 0x02; // (IX+2) state byte selects the handler
const PHASE_892F = 0x892f; // handler 6566 decrements this on its shallow path
const HANDLERS = [0x6505, 0x6566, 0x6666];

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), dead);
}

/** A fresh clone with IX at the fountain record and its state byte set. sp in dead stack. */
function craft(sel) {
  const m = BASE.clone();
  m.regs.ix = FOUNTAIN_REC;
  m.mem.write8(FOUNTAIN_REC + SEL, sel);
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH: the rst trampoline's push/pop reads/writes dead RAM
  return m;
}

// -- 1. ROM-TABLE -------------------------------------------------------------

test("ROM-TABLE: the module's case->handler map matches the ROM 0x64ff word table", () => {
  for (let i = 0; i < HANDLERS.length; i++) {
    const word = ROM[TABLE + 2 * i] | (ROM[TABLE + 2 * i + 1] << 8);
    assert.equal(word, HANDLERS[i], `ROM table[${i}] = ${hx(word)}, expected ${hx(HANDLERS[i])}`);
  }
  console.log(`  ROM-TABLE: 0x64ff -> ${HANDLERS.map(hx).join("/")} (matches the switch)`);
});

// -- 2. CAPTURE (best-effort) -------------------------------------------------

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  try {
    const host = new Machine(ROM, { overrides: snap });
    host.runFrames(maxFrames);
  } catch {
    /* boot may unwind on an unimplemented path; keep whatever we captured */
  }
  return caps;
}

test("CAPTURE: real 0x64fb dispatches replay identically (if reached)", () => {
  const caps = ROM_PRESENT ? captureDispatches(16, 4000) : [];
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    let oThrew = false;
    let cThrew = false;
    try { oracle(o); } catch { oThrew = true; }
    try { runActorGroupStateHandler(c); } catch { cThrew = true; }
    assert.equal(oThrew, cThrew, "oracle and module must take the same completion path");
    if (!oThrew) {
      const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
      assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    }
  }
  console.log(`  CAPTURE: ${caps.length} real 0x64fb dispatch(es) replayed identically`);
});

// -- 3. CRAFTED selector 1 (shallow, safe) ------------------------------------

test("CRAFTED: selector 1 shallow path — runActorGroupStateHandler == oracle in RAM (−stack)", () => {
  const o = craft(1);
  const c = craft(1);
  o.mem.write8(PHASE_892F, 0x05);
  c.mem.write8(PHASE_892F, 0x05);
  oracle(o);
  runActorGroupStateHandler(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assert.equal(o.mem.read8(PHASE_892F), 0x04, "handler 6566 should decrement (0x892f) 5 -> 4");
  assert.equal(c.mem.read8(PHASE_892F), 0x04, "module route must reach the same handler");
  console.log("  CRAFTED(sel1): (0x892f) 5 -> 4 on both sides");
});

// -- 4. CRAFTED selectors 0 and 2 (robust) ------------------------------------

test("CRAFTED: selectors 0 and 2 take the same path; RAM matches when they complete", () => {
  for (const sel of [0, 2]) {
    const o = craft(sel);
    const c = craft(sel);
    let oThrew = false;
    let cThrew = false;
    try { oracle(o); } catch { oThrew = true; }
    try { runActorGroupStateHandler(c); } catch { cThrew = true; }
    assert.equal(oThrew, cThrew, `selector ${sel}: oracle and module must take the same completion path`);
    if (!oThrew) {
      const d = ramDiffMinusStack(o, c);
      assert.equal(d, null, d && `selector ${sel}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    }
  }
  console.log("  CRAFTED(sel0/sel2): same completion path (RAM identical when completing)");
});

// -- 5. TEETH -----------------------------------------------------------------

/** Broken twin: never dispatches. */
function brokenNoDispatch() {
  return;
}

/** Broken twin: routes selector 1 to handler 2 instead of handler 1. */
function brokenMisroute(m) {
  return loc_6666(m); // BUG: selector 1 must reach animateActorGroupGrowShrink
}

test("TEETH: a twin that never dispatches is CAUGHT (missed 0x892f decrement)", () => {
  const o = craft(1);
  const c = craft(1);
  o.mem.write8(PHASE_892F, 0x05);
  c.mem.write8(PHASE_892F, 0x05);
  oracle(o);
  brokenNoDispatch(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a missing dispatch — it is worthless");
  assert.equal(d.addr, PHASE_892F, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(no-dispatch): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a twin that mis-routes selector 1 to handler 2 is CAUGHT", () => {
  const o = craft(1);
  const c = craft(1);
  o.mem.write8(PHASE_892F, 0x05);
  c.mem.write8(PHASE_892F, 0x05);
  oracle(o);
  try { brokenMisroute(c); } catch { /* a mis-route that throws is still a detected divergence */ }
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a mis-routed selector — it is worthless");
  console.log(`  TEETH(misroute): caught at ${hx(d.addr ?? 0)} (oracle=${d.a} broken=${d.b})`);
});
