// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchActiveObjectState (ROM 0x7707, Pooyan) — the per-object
 * state dispatcher. Inactive records (bit0 of (IX+0)|(IX+1) clear) return untouched; active ones
 * select handler (IX+2)&3 of four (0=771d 1=7740 2=7790 3=7881) and tail-hand-off to it.
 *
 * The oracle reaches its handlers through `rst 0x28` (push the inline table base, jp (hl) via the
 * 0x7715 word table). The dispatcher itself touches only the stack + registers (no game RAM) and the
 * ROM table, and the handlers reload their working state from IX — so skipping the trampoline and
 * calling the handler directly leaves identical game RAM. This test proves that: oracle-vs-module on
 * fresh clones, compared on RAM (dumpState, minus stack scratch below the entry SP). It also validates the module's
 * hardwired selector->handler mapping against the real ROM 0x7715 table (the oracle reads it live).
 *
 * The record fields are set so every handler takes its shallow early-return: (IX+0x0e) and (IX+0x11)
 * are high frame counters (the 0x4006 refresh and the state guards just decrement and return), and
 * (IX+0x04)&0x1f>=9 so the state-1 mover returns before crossing a cell. Equivalence would hold at
 * any depth, but shallow returns keep the run fast and side-effect-light.
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — replay any real 0x7707 dispatch a boot happens to reach.
 *   2. CRAFTED (load-bearing) — inactive guard (both (IX+0)/(IX+1) even, and the OR of the two bit0s),
 *      plus each active selector 0..3 (and a high-bits selector proving the &3 mask): RAM identical.
 *   3. TEETH — a twin that ignores the active guard dispatches an inactive record; a twin that routes
 *      selector 1 to the wrong handler. Both MUST be caught in RAM.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7707.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7707 as oracle } from "../../translated/loc_7707.js";
import { dispatchActiveObjectState } from "../dispatchActiveObjectState.js";
import { loc_771d } from "../../translated/loc_771d.js";
import { loc_7881 } from "../../translated/loc_7881.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x7707;
const REC = 0x8ba0; // a record base inside the object arena dispatchAllObjectStates scans (work RAM)
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

// Record offsets used to force shallow handler returns.
const OFF_STATE = 0x02;   // (IX+2) state byte -> &3 selects the handler
const OFF_SUBPOS = 0x04;  // (IX+4) sub-position; &0x1f>=9 keeps the state-1 mover from crossing a cell
const OFF_ANIM = 0x0e;    // (IX+0x0e) 0x4006 frame-hold; nonzero => 0x4006 just decrements and returns
const OFF_FRAME = 0x11;   // (IX+0x11) state frame timer; nonzero => the state guards return early

/** First RAM difference on the go-forward contract: whole dump, skipping the dead stack scratch below the entry SP.
 *  (The oracle reaches its handler through the rst-0x28 trampoline, which pushes onto the stack;
 *  the module calls the handler directly, so the two leave different stack bytes — all excluded.) */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), dead);
}

/** A machine with a record at REC: byte0/byte1 set the active bits, byte2 the selector. */
function craft(b0, b1, state) {
  const m = new Machine(ROM);
  m.mem.write8((REC + 0x00) & 0xffff, b0);
  m.mem.write8((REC + 0x01) & 0xffff, b1);
  m.mem.write8((REC + OFF_STATE) & 0xffff, state);
  m.mem.write8((REC + OFF_SUBPOS) & 0xffff, 0x10); // &0x1f = 0x10 >= 9 -> mover returns early
  m.mem.write8((REC + OFF_ANIM) & 0xffff, 0x40);   // 0x4006 decrements-and-returns
  m.mem.write8((REC + OFF_FRAME) & 0xffff, 0x40);  // state guards decrement-and-return
  m.regs.ix = REC;
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH: the trampoline's push/pop + handler ret read dead RAM
  return m;
}

// -- 1. CAPTURE (best-effort) -------------------------------------------------

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

test("CAPTURE: real 0x7707 dispatches replay identically (if reached)", () => {
  const caps = ROM_PRESENT ? captureDispatches(24, 4000) : [];
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    dispatchActiveObjectState(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CAPTURE: ${caps.length} real 0x7707 dispatch(es) replayed identically`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: inactive guard + each active selector — RAM identical (oracle vs module)", () => {
  const cases = [
    { name: "inactive (0,0)", b0: 0x00, b1: 0x00, state: 0x00 },
    { name: "inactive even (2,0)", b0: 0x02, b1: 0x00, state: 0x01 },
    { name: "active via b0, selector 0", b0: 0x01, b1: 0x00, state: 0x00 },
    { name: "active via b0, selector 1", b0: 0x01, b1: 0x00, state: 0x01 },
    { name: "active via b0, selector 2", b0: 0x01, b1: 0x00, state: 0x02 },
    { name: "active via b0, selector 3", b0: 0x01, b1: 0x00, state: 0x03 },
    { name: "active via b1 (OR), selector 2", b0: 0x00, b1: 0x01, state: 0x02 },
    { name: "high selector bits masked (&3=2)", b0: 0x01, b1: 0x00, state: 0x06 },
  ];
  for (const { name, b0, b1, state } of cases) {
    const o = craft(b0, b1, state);
    const c = craft(b0, b1, state);
    oracle(o);
    dispatchActiveObjectState(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CRAFTED: ${cases.length} guard/selector cases identical (RAM −stack)`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: ignores the active guard, always dispatches selector-0's handler. */
function brokenSkipGuard(m) {
  return loc_771d(m);
}

/** Broken twin: routes an active selector-1 record to the wrong handler (state 3). */
function brokenWrongSelector(m, rec = m.regs.ix) {
  const { mem8 } = m;
  if (((mem8[rec + 0x00] | mem8[rec + 0x01]) & 1) === 0) return;
  return loc_7881(m); // BUG: selector 1 should be loc_7740
}

test("TEETH: a twin ignoring the active guard is caught (inactive record dispatched)", () => {
  const o = craft(0x00, 0x00, 0x00); // inactive -> oracle writes nothing
  const c = craft(0x00, 0x00, 0x00);
  oracle(o);
  brokenSkipGuard(c); // dispatches loc_771d -> decrements (IX+0x11)
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a dispatched inactive record — it is worthless");
  assert.equal(d.addr, (REC + OFF_FRAME) & 0xffff, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(guard): inactive dispatch caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a twin routing selector 1 to the wrong handler is caught", () => {
  const o = craft(0x01, 0x00, 0x01); // active, selector 1 -> moveObject
  const c = craft(0x01, 0x00, 0x01);
  oracle(o);
  brokenWrongSelector(c); // routes to loc_7881 instead
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a mis-routed selector — it is worthless");
  console.log(`  TEETH(selector): mis-route caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
