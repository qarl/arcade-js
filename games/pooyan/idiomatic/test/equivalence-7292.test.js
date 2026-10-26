// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceEaglePhaseAndClearAim (ROM 0x7292) — the eagle-phase reset
 * epilogue: clear PLAYER_AIM_FLAGS and LATCHED_ENEMY_X, advance the eagle-wave outer phase
 * (WAVE_RECORDS_ARRIVED - 1) one step, and clear WAVE_RECORDS_ARRIVED.
 *
 * The routine reads NO registers and returns nothing a caller consumes (memory-only), so the whole
 * contract is RAM: dumpState minus stack scratch below the entry SP. Oracle runs on one clone, the module on another.
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — hook 0x7292 in a real run; any dispatch must agree in RAM.
 *   2. CRAFTED — the load-bearing arm. Pre-dirty the four cells (varied phase incl. 0xff wrap) and a
 *      neighbour; both sides land the same four bytes and leave the neighbour dirt intact.
 *   3. WRITE-SET — the oracle writes exactly the four cells.
 *   4. TEETH — a twin that forgets to clear WAVE_RECORDS_ARRIVED MUST be caught there.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7292.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7292 as oracle } from "../../translated/loc_7292.js";
import { advanceEaglePhaseAndClearAim } from "../advanceEaglePhaseAndClearAim.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, PLAYER_AIM_FLAGS, LATCHED_ENEMY_X, WAVE_RECORDS_ARRIVED } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x7292;
const EAGLE_WAVE_PHASE = WAVE_RECORDS_ARRIVED - 1; // the outer-phase cell one below the sub-count
const NEIGHBOUR = WAVE_RECORDS_ARRIVED - 2; // a nearby cell the routine must NOT touch
const WRITTEN = [PLAYER_AIM_FLAGS, LATCHED_ENEMY_X, EAGLE_WAVE_PHASE, WAVE_RECORDS_ARRIVED];
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0); // crafted entries keep the reset SP 0, so no scratch cell lies below it

/** First RAM difference on the go-forward contract: whole dump minus stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/** A machine with the four cells + a neighbour pre-dirtied; `phase` seeds the outer-phase cell. */
function craft(phase) {
  const m = new Machine(ROM);
  m.mem.write8(PLAYER_AIM_FLAGS, 0x99);
  m.mem.write8(LATCHED_ENEMY_X, 0x99);
  m.mem.write8(EAGLE_WAVE_PHASE, phase);
  m.mem.write8(WAVE_RECORDS_ARRIVED, 0x99);
  m.mem.write8(NEIGHBOUR, 0xaa);
  return m;
}

const PHASES = [0x00, 0x01, 0x05, 0x7f, 0xff];

// -- 1. CAPTURE (best-effort) -------------------------------------------------

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  return caps;
}

const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0x7292 dispatches — module == oracle in RAM (−stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    advanceEaglePhaseAndClearAim(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: pre-dirtied cells + varied phase — RAM identical, four cells landed, neighbour kept", () => {
  for (const phase of PHASES) {
    const o = craft(phase);
    const c = craft(phase);
    oracle(o);
    advanceEaglePhaseAndClearAim(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `phase ${hx(phase)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);

    assert.equal(c.mem.read8(PLAYER_AIM_FLAGS), 0x00, `phase ${hx(phase)}: aim flags cleared`);
    assert.equal(c.mem.read8(LATCHED_ENEMY_X), 0x00, `phase ${hx(phase)}: latched X cleared`);
    assert.equal(c.mem.read8(EAGLE_WAVE_PHASE), (phase + 1) & 0xff, `phase ${hx(phase)}: phase advanced (wraps)`);
    assert.equal(c.mem.read8(WAVE_RECORDS_ARRIVED), 0x00, `phase ${hx(phase)}: sub-count cleared`);
    assert.equal(c.mem.read8(NEIGHBOUR), 0xaa, `phase ${hx(phase)}: neighbour untouched`);
  }
  console.log(`  CRAFTED: ${PHASES.length} phase values landed identically, neighbour preserved`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle writes exactly the four eagle-phase cells", () => {
  const written = new Set(WRITTEN);
  for (const phase of PHASES) {
    const before = craft(phase);
    const after = before.clone();
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();
    const changed = new Set();
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] !== a1[off]) changed.add(after.stateOffsetToAddr(off));
    }
    for (const addr of changed) {
      assert.ok(written.has(addr), `phase ${hx(phase)}: oracle wrote unexpected addr ${hx(addr)}`);
    }
    // The three always-cleared cells were dirty (0x99) so they must show a change.
    for (const addr of [PLAYER_AIM_FLAGS, LATCHED_ENEMY_X, WAVE_RECORDS_ARRIVED]) {
      assert.ok(changed.has(addr), `phase ${hx(phase)}: ${hx(addr)} should have changed`);
    }
  }
  console.log("  WRITE-SET: every oracle write is one of the four declared cells");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: forgets to clear the records-arrived sub-count. */
function brokenModule(m) {
  advanceEaglePhaseAndClearAim(m);
  m.mem.write8(WAVE_RECORDS_ARRIVED, 0x99); // BUG: leave the sub-count dirty
}

test("TEETH: a stale WAVE_RECORDS_ARRIVED is CAUGHT", () => {
  let caught = null;
  for (const phase of PHASES) {
    const o = craft(phase);
    const c = craft(phase);
    oracle(o);
    brokenModule(c);
    const d = ramDiffMinusStack(o, c);
    if (d) { caught = d; break; }
  }
  assert.notEqual(caught, null, "the gate FAILED to catch a stale sub-count — it is worthless");
  assert.equal(caught.addr, WAVE_RECORDS_ARRIVED, `teeth caught the wrong address ${hx(caught.addr ?? 0)}`);
  console.log(`  TEETH: stale sub-count caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});
