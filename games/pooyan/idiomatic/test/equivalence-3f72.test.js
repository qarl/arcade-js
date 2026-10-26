// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceObjectStateOnFrameTimerExpiry (ROM 0x3f72, Pooyan) — an object state handler. It ticks
 * the record's animation, counts down the frame timer and returns while it is still running, and
 * on expiry advances the state byte and falls through into the next state handler.
 *
 * SEATING: a plain `ret nz` early exit (net SP 0) plus a fall-through into the next handler whose
 * ret returns to this routine's own caller — WIRE. The module returns the fall-through delegate's
 * result on expiry and returns void while the timer runs. Entry register IX is the record pointer,
 * seated as the param-default bridge. advanceObjectStateOnFrameTimerExpiry is void — no register the caller reads — so
 * equivalence is RAM (dumpState) minus stack scratch below the entry SP; SP is parked so the nested pushes drop out.
 *
 * The record is CRAFTED. The animation frame-hold (+0x0e) is left running so the animation tick
 * only decrements it (its stream walk is covered by its own gate). The HOLD case keeps the frame
 * timer running (early return, no fall-through); the EXPIRE case lets it lapse into the next
 * handler — both sides start from an identical clone, so the whole fall-through subtree matches
 * when each of its routines is itself equivalent (covered by their own gates).
 *
 * Jobs:
 *   1. EQUAL — timer running (early return) and timer expiring (state advance + fall-through):
 *      oracle == module in RAM.
 *   2. WRITE-SET — the running case ticks the frame-hold and the timer only; the expiring case
 *      advances the state byte.
 *   3. TEETH — a wrong byte is caught by the RAM diff; a twin that omits the animation tick
 *      diverges at the frame-hold field, and a twin that omits the timer decrement diverges at the
 *      timer field; the running vs expiring outcomes diverge at the state byte.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3f72.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3f72 as oracle } from "../../translated/loc_3f72.js";
import { advanceObjectStateOnFrameTimerExpiry } from "../advanceObjectStateOnFrameTimerExpiry.js";
import { advanceObjectAnimationFrame } from "../advanceObjectAnimationFrame.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8ba0; //  a spare object record base
const HOLD = 0x0e; //   record: animation frame-hold counter
const TIMER = 0x11; //  record: frame timer gating the state advance
const STATE = 0x02; //  record: state byte advanced on expiry
const SP0 = 0x8ff0; //  inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the record: frame-hold running (tick just decrements), timer set to `timer`, state 0x08.
 *  The fall fields keep the next handler airborne (its own early ret) so the expire case stays in
 *  the shortest fall-through branch. */
function seat(m, { timer = 0x02 } = {}) {
  m.regs.sp = SP0;
  m.regs.ix = REC;
  m.mem.write8(REC + HOLD, 0x05); // frame-hold running -> tick decrements, no stream walk
  m.mem.write8(REC + TIMER, timer);
  m.mem.write8(REC + STATE, 0x08); // this handler's state index
  m.mem.write8(REC + 0x03, 0x00); // fall position low
  m.mem.write8(REC + 0x04, 0x00); // fall row -- below the landing row -> stays airborne
  m.mem.write8(REC + 0x09, 0x01); // small fall velocity -> no row crossing this step
  return m;
}

const craftHold = () => seat(BASE.clone(), { timer: 0x02 }); // timer runs -> early return
const craftExpire = () => seat(BASE.clone(), { timer: 0x01 }); // timer lapses -> fall-through

// -- 1. EQUAL -----------------------------------------------------------------

for (const [label, craft] of [["hold (timer running)", craftHold], ["expire (fall-through)", craftExpire]]) {
  test(`EQUAL: ${label} — module == oracle in RAM (−stack)`, () => {
    const o = craft();
    const c = craft();
    oracle(o);
    advanceObjectStateOnFrameTimerExpiry(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${label}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    console.log(`  EQUAL ${label}: RAM identical`);
  });
}

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: hold ticks hold+timer only; expire advances the state byte", () => {
  const hold = craftHold();
  oracle(hold);
  assert.equal(hold.mem.read8(REC + HOLD), 0x04, "frame-hold decremented by the tick");
  assert.equal(hold.mem.read8(REC + TIMER), 0x01, "timer decremented, still running");
  assert.equal(hold.mem.read8(REC + STATE), 0x08, "state unchanged while the timer runs");

  const exp = craftExpire();
  oracle(exp);
  assert.equal(exp.mem.read8(REC + STATE), 0x09, "state advanced on expiry");
  console.log("  WRITE-SET: hold ticks; expire advances state");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const o = craftHold();
  const c = craftHold();
  oracle(o);
  advanceObjectStateOnFrameTimerExpiry(c);
  c.mem.write8(REC + TIMER, (o.mem.read8(REC + TIMER) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted timer byte");
  assert.equal(d.addr, REC + TIMER, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a handler that drops the tick or the timer diverges at that field", () => {
  // drop the animation tick: only decrement the timer
  const o1 = craftHold();
  const t1 = craftHold();
  oracle(o1);
  t1.mem.write8(REC + TIMER, (t1.mem.read8(REC + TIMER) - 1) & 0xff); // timer only, no tick
  const d1 = ramDiffMinusStack(o1, t1);
  assert.notEqual(d1, null, "a dropped animation tick must be caught");
  assert.equal(d1.addr, REC + HOLD, `dropped-tick teeth caught wrong address ${hx(d1.addr ?? 0)}`);

  // drop the timer decrement: only tick the animation
  const o2 = craftHold();
  const t2 = craftHold();
  oracle(o2);
  advanceObjectAnimationFrame(t2, REC); // tick only, no timer decrement
  const d2 = ramDiffMinusStack(o2, t2);
  assert.notEqual(d2, null, "a dropped timer decrement must be caught");
  assert.equal(d2.addr, REC + TIMER, `dropped-timer teeth caught wrong address ${hx(d2.addr ?? 0)}`);
  console.log(`  TEETH(drop): tick at ${hx(d1.addr)}, timer at ${hx(d2.addr)}`);
});

test("TEETH: running vs expiring outcomes diverge at the state byte", () => {
  const run = craftHold();
  const exp = craftExpire();
  oracle(run);
  oracle(exp);
  const d = ramDiffMinusStack(run, exp);
  assert.notEqual(d, null, "the timer gate must branch — running and expiring gave identical RAM");
  assert.equal(d.addr, REC + STATE, `gate teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(gate): running vs expiring diverge at ${hx(d.addr)}`);
});
