// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_0028 -- the `rst 0x28` inline-jump-table
 * trampoline, the ROM's single computed-dispatch primitive (game-state table,
 * sub-state tables, cutscene/how-high sequence tables, object-collision table...).
 *
 * Five jobs:
 *
 *   1. EQUAL (whole + unit) -- the idiomatic optimized sub_0028
 *      (optimized/sub_0028.js) reads EQUAL against its translated oracle. sub_0028
 *      dispatches every NMI from boot (the game-state table at 0x00CA), so it fires
 *      dozens of times in a 30-frame window with no input.
 *
 *   2. BRANCH COVERAGE (synthesised) -- sub_0028 is straight-line (one 74-T-state
 *      path, no data-dependent guard/loop/compare), so its only data dependence is
 *      the DISPATCH INDEX -> target. This test drives all four game-state indices
 *      (0..3 of the 0x00CA table) with a spy installed at each target that captures
 *      the register handoff without running the heavy handler, and proves oracle and
 *      optimized agree bit-for-bit on the isolated trampoline: A = index*2, HL = the
 *      target, DE = &table[index]+1, F, the propagated skip-boolean, AND the 74-T
 *      cycle total. (Spy dispatch works because dispatchGameState consults
 *      m.overrides FIRST, so the real handler never runs -- the trampoline is tested
 *      in isolation.)
 *
 *   3. TEETH (whole + unit) -- a deliberately-broken twin whose first store to VRAM
 *      0x7404 (written by the state-0 power-on dispatch this trampoline routes to)
 *      lands the wrong value must be CAUGHT: NOT-EQUAL, naming 0x7404.
 *
 * CYCLE DECISION this routine records: sub_0028 stays PER-INSTRUCTION (not
 * collapsed), like the rest of the rst family (sub_0008/0010/0018). It is a LEAF
 * reached via m.call from many callers, and atomicity is per-call-path: it is also
 * dispatched from IN-GAME dispatchers (loc_06fe & friends) whose downstream handlers
 * are interruptible, so a cycle collapse of the trampoline is not provably safe on
 * every path -- "when unsure, per-instruction is always correct." Structurally, the
 * routine also ends every path in m.tick (never m.step), leaving m.pcKnown false
 * across it by design; keeping per-instruction ticks preserves that boundary
 * structure and the exact 74-T total. The BRANCH-COVERAGE test measures the total on
 * both sides so a wrong total would fail.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_0028 as translated_0028 } from "../../translated/nmi.js";
import { sub_0028 as optimized_0028 } from "../sub_0028.js";
import { Machine } from "../../machine.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0028;
const FRAMES = 30; // sub_0028 fires every NMI; dozens of dispatches in this window

// First store on the routine's path is a playfield-clear cell written by the state-0
// power-on handler (handler_01c3 -> sub_0874) that this trampoline routes to at boot.
// VRAM 0x7404 is inside the compared state dump; corrupting it is the representative
// "wrong value to one of the dispatched routine's own outputs" bug the gate must catch.
const BROKEN_ADDR = 0x7404;

/**
 * Deliberately-broken twin: behaviourally the optimized trampoline EXCEPT the first
 * store to 0x7404 lands a wrong value (the correct byte XOR 0xFF, guaranteed to
 * differ). Intercepting exactly that one write lets the rest of the trampoline and
 * every routine it dispatches run verbatim.
 */
function broken_0028(m, site) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr === BROKEN_ADDR) {
      broke = true;
      return realWrite(addr, value ^ 0xff, busOffset);
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    return optimized_0028(m, site);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_0028 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_0028]]));

  assert.ok(
    r.invocations.get(TARGET) >= 1,
    `override at 0x${TARGET.toString(16)} never dispatched (invocations=${r.invocations.get(TARGET)})`,
  );
  assert.equal(
    r.equal,
    true,
    r.equal ? "" : `diverged at frame ${r.frame}, addr 0x${(r.addr ?? 0).toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
  assert.equal(r.framesCompared, FRAMES);
  console.log(
    `  EQUAL/whole: ${r.framesCompared} frames identical, ` +
      `override fired ${r.invocations.get(TARGET)}x`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_0028 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0028, optimized_0028);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- BRANCH COVERAGE (synthesised: every dispatch index) ----------------------

// The four entries of the 0x00CA game-state table (little-endian words in ROM),
// index -> target address. sub_0028's data dependence is entirely on the index.
const GAME_STATE_TABLE = { 0: 0x01c3, 1: 0x073c, 2: 0x08b2, 3: 0x06fe };

/**
 * Run `fn` (oracle or optimized) as the pure trampoline for a given dispatch
 * `index`: build a fresh machine, seat a stack holding the 0x00CA table base,
 * set A = index, and install a spy at EVERY table target that captures the register
 * handoff and returns a fixed skip-boolean without running the real handler. Returns
 * the captured handoff + the cycles sub_0028 charged.
 */
function trampoline(fn, index) {
  const captured = { handoff: null };
  const spy = (mm) => {
    captured.handoff = { a: mm.regs.a, hl: mm.regs.hl, de: mm.regs.de, f: mm.regs.f };
    return false; // the skip-capable dispatch families return a boolean; sub_0028 propagates it
  };
  const overrides = new Map(Object.values(GAME_STATE_TABLE).map((t) => [t, spy]));
  const m = new Machine(ROM, { overrides });
  m.regs.sp = 0x6c00; // a sane work-RAM stack top
  m.push16(0x00ca); // rst 0x28's "return address" = the inline table base
  m.regs.a = index;
  const before = m.cycles;
  const ret = fn(m, "0x00CA (NMI game state)");
  return { handoff: captured.handoff, cycles: m.cycles - before, ret };
}

test("BRANCH (synthesised): the trampoline dispatches every game-state index identically", () => {
  for (const index of [0, 1, 2, 3]) {
    const target = GAME_STATE_TABLE[index];
    const o = trampoline(translated_0028, index);
    const p = trampoline(optimized_0028, index);

    // The trampoline computed the correct target on both sides.
    assert.equal(o.handoff.hl, target, `oracle idx ${index} target`);
    assert.equal(p.handoff.hl, target, `optimized idx ${index} target`);
    // Full register handoff (A = index*2, HL = target, DE = &table[index]+1, F) equal.
    assert.deepEqual(p.handoff, o.handoff, `handoff mismatch at index ${index}`);
    assert.equal(p.handoff.a, (index * 2) & 0xff, `A must be index*2 at index ${index}`);
    // Skip-boolean propagated identically.
    assert.equal(p.ret, o.ret, `return value mismatch at index ${index}`);
    // Per-instruction cycle TOTAL preserved (74 T-states), so the no-collapse
    // decision has teeth even on indices the whole-machine run may not reach.
    assert.equal(o.cycles, 74, `oracle cycle total at index ${index}`);
    assert.equal(p.cycles, 74, `optimized cycle total at index ${index}`);
  }
  console.log(
    "  BRANCH/synth: indices 0..3 -> 0x1c3/0x73c/0x8b2/0x6fe, " +
      "A/HL/DE/F + skip-bool + 74t identical oracle vs optimized",
  );
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong dispatched store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_0028]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong dispatched store is CAUGHT and names 0x7404", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0028, broken_0028);

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});
