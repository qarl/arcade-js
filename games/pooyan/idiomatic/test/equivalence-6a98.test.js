// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchDescendingObjectState (ROM 0x6a98, Pooyan) — the per-object state dispatcher.
 * It skips an inactive record (its +1 byte zero); otherwise it reads the state byte (IX+2) and
 * rst-0x28 dispatches through the inline word table at 0x6aa4 to one of two handlers, indexed by
 * (state-1) & 3: index 0 = 0x6aa8 (descending-object step), index 1 = 0x67df (screen re-init).
 * Each is a tail hand-off, so the handler returns straight to dispatchDescendingObjectState's caller.
 *
 * The oracle reaches its handler through the rst-0x28 trampoline (push the table base, jp (hl) via
 * the 0x6aa4 words); the module calls the handler directly. `m.call` pushes no return, so the
 * handler runs at the SAME sp on both sides — the only asymmetric stack write is the transient
 * table base, inside STACK_SCRATCH and excluded. The dispatcher is memory-only: the record-scan
 * caller (runObjectsElseVerifyTilemapChecksum) brackets its loop registers with exx and reads nothing back.
 *
 * Jobs:
 *   1. ROM-TABLE — the module's case->handler map matches the real ROM 0x6aa4 word table.
 *   2. CAPTURE (best-effort) — replay any real 0x6a98 dispatch a boot happens to reach.
 *   3. CRAFTED selector 0 (shallow) — with a held anim frame and a non-zero position high byte,
 *      handler 0x6aa8 just decrements the hold and the position low: oracle == module in RAM.
 *   4. CRAFTED selector 1 (robust) — run both under try/catch; same completion path, RAM matches
 *      whenever the deep re-init handler completes.
 *   5. INACTIVE — (IX+1)==0 skips: both write nothing.
 *   6. TEETH — a twin that never dispatches, and a twin that mis-routes selector 0 to handler 1,
 *      are both CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6a98.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6a98 as oracle } from "../../translated/loc_6a98.js";
import { dispatchDescendingObjectState } from "../dispatchDescendingObjectState.js";
import { loc_67df as translatedReinit } from "../../translated/loc_67df.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TARGET = 0x6a98;
const TABLE = 0x6aa4;
const REC = 0x8ae0; // an enemy-actor arena record (the scan base runObjectsElseVerifyTilemapChecksum walks)
const HANDLERS = [0x6aa8, 0x67df]; // table[0], table[1]
const HOLD = REC + 0x0e; // anim frame-hold counter (handler 0x6aa8 -> advanceObjectAnimationFrame decrements it)
const POS_LO = REC + 0x05; // position low byte (handler subtracts the speed at +0x09)
const POS_HI = REC + 0x06; // position high byte (non-zero -> handler returns without advancing state)
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), dead);
}

/** A fresh clone with IX at the record and its state byte set. sp in dead stack. */
function craft(stateByte, active = true) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.mem.write8(REC + 0x01, active ? 0x01 : 0x00);
  m.mem.write8(REC + 0x02, stateByte);
  m.regs.sp = 0x8fe0; // dead stack: the rst trampoline's push/pop reads/writes dead RAM
  return m;
}

/** Seat handler 0x6aa8's shallow path: hold a frame, keep the position high byte non-zero. */
function seatShallow(m) {
  m.mem.write8(HOLD, 0x05); //   frame held -> advanceObjectAnimationFrame just decrements it
  m.mem.write8(POS_LO, 0x10);
  m.mem.write8(m.regs.ix + 0x09, 0x01); // speed
  m.mem.write8(POS_HI, 0x05); // non-zero -> no state advance, no latch re-arm
}

// -- 1. ROM-TABLE -------------------------------------------------------------

test("ROM-TABLE: the module's case->handler map matches the ROM 0x6aa4 word table", () => {
  for (let i = 0; i < HANDLERS.length; i++) {
    const word = ROM[TABLE + 2 * i] | (ROM[TABLE + 2 * i + 1] << 8);
    assert.equal(word, HANDLERS[i], `ROM table[${i}] = ${hx(word)}, expected ${hx(HANDLERS[i])}`);
  }
  console.log(`  ROM-TABLE: 0x6aa4 -> ${HANDLERS.map(hx).join("/")} (matches the switch)`);
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

test("CAPTURE: real 0x6a98 dispatches replay identically (if reached)", () => {
  const caps = ROM_PRESENT ? captureDispatches(16, 4000) : [];
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    let oThrew = false;
    let cThrew = false;
    try { oracle(o); } catch { oThrew = true; }
    try { dispatchDescendingObjectState(c); } catch { cThrew = true; }
    assert.equal(oThrew, cThrew, "oracle and module must take the same completion path");
    if (!oThrew) {
      const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
      assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    }
  }
  console.log(`  CAPTURE: ${caps.length} real 0x6a98 dispatch(es) replayed identically`);
});

// -- 3. CRAFTED selector 0 (shallow, safe) ------------------------------------

test("CRAFTED: selector 0 shallow path — dispatchDescendingObjectState == oracle in RAM (−stack)", () => {
  const o = craft(0x01); // (1-1)&3 = 0 -> handler 0x6aa8
  const c = craft(0x01);
  seatShallow(o);
  seatShallow(c);
  oracle(o);
  dispatchDescendingObjectState(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  // confirm the handler actually ran (a no-op twin would leave these unchanged)
  assert.equal(o.mem.read8(HOLD), 0x04, "handler must decrement the anim frame hold 5 -> 4");
  assert.equal(o.mem.read8(POS_LO), 0x0f, "handler must drop the position low 0x10 -> 0x0f");
  assert.equal(c.mem.read8(HOLD), 0x04, "module route must reach the same handler");
  assert.equal(c.mem.read8(POS_LO), 0x0f, "module route must reach the same handler");
  console.log("  CRAFTED(sel0): hold 5->4, pos-lo 0x10->0x0f on both sides");
});

// -- 4. CRAFTED selector 1 (robust) -------------------------------------------

test("CRAFTED: selector 1 takes the same path; RAM matches when it completes", () => {
  const o = craft(0x02); // (2-1)&3 = 1 -> handler 0x67df
  const c = craft(0x02);
  let oThrew = false;
  let cThrew = false;
  try { oracle(o); } catch { oThrew = true; }
  try { dispatchDescendingObjectState(c); } catch { cThrew = true; }
  assert.equal(oThrew, cThrew, "selector 1: oracle and module must take the same completion path");
  if (!oThrew) {
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `selector 1: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CRAFTED(sel1): same completion path (${oThrew ? "both threw" : "RAM identical"})`);
});

// -- 5. INACTIVE --------------------------------------------------------------

test("INACTIVE: (IX+1)==0 skips — both write nothing", () => {
  const o = craft(0x01, false);
  const c = craft(0x01, false);
  const before = o.dumpState();
  oracle(o);
  dispatchDescendingObjectState(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}`);
  let changes = 0;
  const after = o.dumpState();
  for (let off = 0; off < before.length; off++) if (before[off] !== after[off]) changes++;
  assert.equal(changes, 0, "an inactive record must not be touched");
  console.log("  INACTIVE: both no-op, RAM unchanged");
});

// -- 6. TEETH -----------------------------------------------------------------

/** Broken twin: never dispatches. */
function brokenNoDispatch() { return; }
/** Broken twin: routes selector 0 to handler 1 instead of handler 0. */
function brokenMisroute(m) { return translatedReinit(m); }

test("TEETH: a twin that never dispatches is CAUGHT (missed handler effect)", () => {
  const o = craft(0x01);
  const c = craft(0x01);
  seatShallow(o);
  seatShallow(c);
  oracle(o);
  brokenNoDispatch(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a missing dispatch — it is worthless");
  console.log(`  TEETH(no-dispatch): caught at ${hx(d.addr ?? 0)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a twin that mis-routes selector 0 to handler 1 is CAUGHT", () => {
  const o = craft(0x01);
  const c = craft(0x01);
  seatShallow(o);
  seatShallow(c);
  // Force handler 1 onto its full screen-reinit path (checksum sums to 0x5a) so mis-routing sel0 to it
  // diverges from handler 0 — otherwise handler 1's mismatch tail coincides with handler 0 in RAM.
  for (let i = 0; i < 10; i++) { o.mem.write8((0x82bc - i * 0x20) & 0xffff, 0); c.mem.write8((0x82bc - i * 0x20) & 0xffff, 0); }
  o.mem.write8(0x82bc, 0x5a); c.mem.write8(0x82bc, 0x5a);
  oracle(o);
  try { brokenMisroute(c); } catch { /* a mis-route that throws is still a detected divergence */ }
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a mis-routed selector — it is worthless");
  console.log(`  TEETH(misroute): caught at ${hx(d.addr ?? 0)} (oracle=${d.a} broken=${d.b})`);
});
