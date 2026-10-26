// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchObjectStateHandler (ROM 0x40d0, Pooyan) — the IX-object state dispatcher.
 *
 * Inactive records (bit0 of (IX+0)|(IX+1) clear) and out-of-range states ((IX+2)&0x1f >= 0x11) return
 * untouched; otherwise the state selects one of 17 handlers via the inline table 0x40e1 and tail-hands
 * to it (no continuation stacked). The oracle reaches them through rst 0x28; the module calls the same
 * handler directly, so game RAM is identical (only the trampoline stack differs — excluded).
 *
 * Jobs:
 *   1. CAPTURE (load-bearing) — replay every real 0x40d0 dispatch a boot reaches; oracle == module.
 *   2. CRAFTED — inactive/oob guards + each in-range state routes identically.
 *   3. SP-TOOTH (R36) — the tail dispatch is seam-placeable.
 *   4. TEETH — a twin ignoring the active guard, and one mis-routing a state, are caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-40d0.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_40d0 as oracle } from "../../translated/loc_40d0.js";
import { dispatchObjectStateHandler } from "../dispatchObjectStateHandler.js";
import { advanceObjectPhaseThenAuditChecksum } from "../advanceObjectPhaseThenAuditChecksum.js";
import { noopHighStateHandler } from "../noopHighStateHandler.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TARGET = 0x40d0;
const REC = 0x8c30; // record base loc_40bd sweeps (IX for 0x40d0)
const SP0 = 0x8fe0; // inside STACK_SCRATCH
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);

function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), dead);
}
function runGuarded(fn, m) {
  try { fn(m); return { threw: false }; } catch (e) { return { threw: true, msg: String(e && e.message) }; }
}

/** A machine with a record at REC: active bits, state byte, and shallow-return frame fields. */
function craft(b0, b1, state) {
  const m = new Machine(ROM);
  m.mem.write8((REC + 0x00) & 0xffff, b0);
  m.mem.write8((REC + 0x01) & 0xffff, b1);
  m.mem.write8((REC + 0x02) & 0xffff, state);
  m.mem.write8((REC + 0x0e) & 0xffff, 0x40); // frame-hold counters high -> handlers decrement-and-return
  m.mem.write8((REC + 0x11) & 0xffff, 0x40);
  m.regs.ix = REC;
  m.regs.sp = SP0;
  return m;
}

// -- 1. CAPTURE ---------------------------------------------------------------

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep captured */ }
  return caps;
}

test("CAPTURE: real 0x40d0 dispatches replay identically (oracle vs module)", () => {
  const caps = ROM_PRESENT ? captureDispatches(32, 4000) : [];
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    const ro = runGuarded(oracle, o);
    const rc = runGuarded(dispatchObjectStateHandler, c);
    assert.equal(ro.threw, rc.threw, `divergent control flow (oracle threw=${ro.threw} module threw=${rc.threw})`);
    if (!ro.threw) {
      const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
      assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    }
  }
  console.log(`  CAPTURE: ${caps.length} real 0x40d0 dispatch(es) replayed identically`);
});

// -- 2. CRAFTED ---------------------------------------------------------------

test("CRAFTED: inactive/oob guards + each in-range state route identically", () => {
  const cases = [
    { name: "inactive (0,0)", b0: 0x00, b1: 0x00, state: 0x00 },
    { name: "oob state 0x11", b0: 0x01, b1: 0x00, state: 0x11 },
    ...Array.from({ length: 17 }, (_, s) => ({ name: `state ${s}`, b0: 0x01, b1: 0x00, state: s })),
    { name: "active via b1 (OR), state 2", b0: 0x00, b1: 0x01, state: 0x02 },
    { name: "high state bits masked (&0x1f)", b0: 0x01, b1: 0x00, state: 0x28 }, // &0x1f = 8
  ];
  for (const { name, b0, b1, state } of cases) {
    const o = craft(b0, b1, state);
    const c = craft(b0, b1, state);
    const ro = runGuarded(oracle, o);
    const rc = runGuarded(dispatchObjectStateHandler, c);
    assert.equal(ro.threw, rc.threw, `${name}: divergent control flow (oracle threw=${ro.threw} module threw=${rc.threw})`);
    if (!ro.threw) {
      const d = ramDiffMinusStack(o, c);
      assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    }
  }
  console.log(`  CRAFTED: ${cases.length} guard/state cases routed identically`);
});

// -- 2b. BRIDGE (rec argument) ------------------------------------------------

test("BRIDGE: dispatchObjectStateHandler routes on the rec argument, ignoring m.regs.ix", () => {
  const runRec = (m) => {
    try { dispatchObjectStateHandler(m, REC); return { threw: false }; } catch (e) { return { threw: true, msg: String(e && e.message) }; }
  };
  const POISON = 0x8d00; // a wrong record base; a handler that reads m.regs.ix acts here, not REC
  for (const state of [0, 1, 2, 8, 9, 11, 12, 13]) {
    const seated = craft(0x01, 0x00, state); //   m.regs.ix = REC
    const poisoned = craft(0x01, 0x00, state);
    poisoned.regs.ix = POISON; //                 wrong ix, but rec=REC is passed explicitly
    const rs = runRec(seated);
    const rp = runRec(poisoned);
    assert.equal(rs.threw, rp.threw, `state ${state}: control flow differs under a poisoned IX`);
    if (!rs.threw) {
      const d = ramDiffMinusStack(seated, poisoned);
      assert.equal(d, null, d && `state ${state}: dispatchObjectStateHandler read m.regs.ix, not rec (diff at ${hx(d.addr ?? 0)})`);
    }
  }
  console.log("  BRIDGE: rec-argument routing ignores a poisoned IX");
});

// -- 3. SP-TOOTH --------------------------------------------------------------

test("SP-TOOTH: the tail dispatch is seam-placeable", () => {
  const r = seamPlaceable(withOmittedRet, dispatchObjectStateHandler, TARGET, craft(0x01, 0x00, 0x00));
  assert.equal(r.placeable, true, `dispatcher must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: tail dispatch seats cleanly");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: an ignored active-guard and a mis-routed state are caught", () => {
  // guard: an inactive record dispatched (always state-0 handler) must diverge from the oracle's no-op.
  const og = craft(0x00, 0x00, 0x00);
  const cg = craft(0x00, 0x00, 0x00);
  oracle(og);
  advanceObjectPhaseThenAuditChecksum(cg); // broken: dispatch despite inactive
  assert.notEqual(ramDiffMinusStack(og, cg), null, "guard teeth worthless: inactive dispatch not caught");
  // selector: state 0 routed to the wrong handler.
  const os = craft(0x01, 0x00, 0x00);
  const cs = craft(0x01, 0x00, 0x00);
  const ro = runGuarded(oracle, os);
  const rc = runGuarded(noopHighStateHandler, cs); // broken: state 0 should be advanceObjectPhaseThenAuditChecksum
  const caught = ro.threw !== rc.threw || (!ro.threw && ramDiffMinusStack(os, cs) !== null);
  assert.equal(caught, true, "selector teeth worthless: mis-route not caught");
  console.log("  TEETH: inactive dispatch + mis-route both caught");
});
