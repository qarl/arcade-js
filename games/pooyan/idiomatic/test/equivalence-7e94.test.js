// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchWriteAnimStateAndPollStart (ROM 0x7e94, Pooyan) — the write-anim dispatch redirect, a
 * per-frame pre-pass. A run-once latch (RESET_SCAN_LATCH 0x8e2a) and HIGH_SCORE_INSERT_RANK (0x89fc)
 * gate it; otherwise selector WRITE_ANIM_HANDLER_SELECT picks handler 0/1/2 (seedWriteAnimWorkBlock/7f0e/7f5d). Every path then
 * tail-returns into the per-frame start-button poll startGameOnStartButtonPress (0x7fd6) — the ROM
 * seats it as the shared return every handler ret's into.
 *
 * The oracle reaches its handlers through `rst 0x28` (push the inline table base 0x7eac, jp (hl)) and
 * its epilogue through a pushed 0x7fd6 the handler ret pops; the module calls the idiomatic handler and
 * the idiomatic epilogue directly. Both leave identical game RAM (the trampoline touches only the
 * stack + the ROM table, and the idiomatic handlers/epilogue are memory-equivalent to their oracles by
 * their own gates). This test proves that on RAM (dumpState, minus stack scratch below the entry SP). The epilogue is kept
 * shallow by parking CREDIT_COUNT (0x8802)=0 so startGameOnStartButtonPress bails at its first gate.
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — replay any real 0x7e94 pass a boot reaches.
 *   2. CRAFTED (load-bearing) — the two gate paths (latch set; rank zero -> arm latch) and each
 *      selector 0/1/2: RAM identical, oracle vs module.
 *   3. TEETH — a twin that skips the latch gate (dispatches when it must not); a twin that mis-routes
 *      selector 0 to handler 2. Both MUST be caught in RAM.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7e94.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7e94 as oracle } from "../../translated/loc_7e94.js";
import { dispatchWriteAnimStateAndPollStart } from "../dispatchWriteAnimStateAndPollStart.js";
import { loc_7eb2 as oracle7eb2 } from "../../translated/loc_7eb2.js";
import { loc_7f5d as oracle7f5d } from "../../translated/loc_7f5d.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, RESET_SCAN_LATCH, HIGH_SCORE_INSERT_RANK, WRITE_ANIM_HANDLER_SELECT } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x7e94;
const CREDIT_COUNT = 0x8802; // startGameOnStartButtonPress bails while this is 0 -> shallow epilogue
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), dead);
}

/** A machine at a chosen gate/selector, with the epilogue parked shallow (credits 0) and a small pass
 *  count so the handlers terminate quickly. Selector cases run whichever handler WRITE_ANIM_HANDLER_SELECT picks. */
function craft({ latch = 0, rank = 1, selector = 0 } = {}) {
  const m = new Machine(ROM);
  m.mem.write8(RESET_SCAN_LATCH, latch);
  m.mem.write8(HIGH_SCORE_INSERT_RANK, rank); // pass count for the handlers; 1 => one loop pass
  m.mem.write8(WRITE_ANIM_HANDLER_SELECT, selector);
  m.mem.write8(CREDIT_COUNT, 0x00); // epilogue bails immediately
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH: trampoline push/pop + handler/epilogue ret read dead RAM
  return m;
}

// -- 1. CAPTURE (best-effort) -------------------------------------------------

test("CAPTURE: real 0x7e94 passes replay identically (if reached)", () => {
  const caps = [];
  if (ROM_PRESENT) {
    const snap = new Map([[TARGET, (mm) => { if (caps.length < 24) caps.push(mm.clone()); return oracle(mm); }]]);
    try { new Machine(ROM, { overrides: snap }).runFrames(4000); } catch { /* keep captures */ }
  }
  for (const cap of caps) {
    const o = cap.clone(); const c = cap.clone();
    oracle(o); dispatchWriteAnimStateAndPollStart(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CAPTURE: ${caps.length} real 0x7e94 pass(es) replayed identically`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: both gate paths + each selector — RAM identical (oracle vs module)", () => {
  const cases = [
    { name: "latch set -> skip, epilogue", opts: { latch: 1 } },
    { name: "rank zero -> arm latch, epilogue", opts: { latch: 0, rank: 0 } },
    { name: "selector 0 -> seedWriteAnimWorkBlock", opts: { selector: 0 } },
    { name: "selector 1 -> advanceWriteAnimTileIndexOnCountdown", opts: { selector: 1 } },
    { name: "selector 2 -> appendWriteAnimBlockRowOnPhase", opts: { selector: 2 } },
  ];
  for (const { name, opts } of cases) {
    const o = craft(opts); const c = craft(opts);
    oracle(o); dispatchWriteAnimStateAndPollStart(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CRAFTED: ${cases.length} gate/selector cases identical (RAM −stack)`);
});

test("CRAFTED: the rank-zero path actually ARMS the latch (both sides set 0x8e2a=1)", () => {
  const m = craft({ latch: 0, rank: 0 });
  dispatchWriteAnimStateAndPollStart(m);
  assert.equal(m.mem.read8(RESET_SCAN_LATCH), 1, "rank-zero path must arm RESET_SCAN_LATCH");
  console.log("  ARM: rank-zero path set RESET_SCAN_LATCH=1");
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: ignores BOTH gates and always dispatches selector 0 -> writes when it must not. */
function brokenSkipGates(m) {
  return oracle7eb2(m);
}

/** Broken twin: routes selector 0 to handler 2 (appendWriteAnimBlockRowOnPhase) instead of seedWriteAnimWorkBlock. */
function brokenWrongSelector(m) {
  const { mem8 } = m;
  if (mem8[RESET_SCAN_LATCH] !== 0) return; // (skip epilogue for a clean RAM comparison of the routing)
  if (mem8[HIGH_SCORE_INSERT_RANK] === 0) { mem8[RESET_SCAN_LATCH] = 1; return; }
  return oracle7f5d(m); // BUG: selector 0 should be seedWriteAnimWorkBlock
}

test("TEETH: a twin skipping the latch gate is caught (dispatches a latched frame)", () => {
  const o = craft({ latch: 1 }); // latch set -> oracle skips the dispatch (epilogue bails, credits 0)
  const c = craft({ latch: 1 });
  oracle(o);
  brokenSkipGates(c); // dispatches seedWriteAnimWorkBlock anyway -> writes the work block
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a dispatch past the latch — it is worthless");
  console.log(`  TEETH(latch): skipped-gate dispatch caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a twin mis-routing selector 0 to the wrong handler is caught", () => {
  const o = craft({ selector: 0 }); // selector 0 -> seedWriteAnimWorkBlock
  const c = craft({ selector: 0 });
  oracle(o);
  brokenWrongSelector(c); // routes to appendWriteAnimBlockRowOnPhase instead
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a mis-routed selector — it is worthless");
  console.log(`  TEETH(selector): mis-route caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
