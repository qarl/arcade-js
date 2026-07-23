// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_003d (ROM 0x003D) -- the shared "add C to a
 * strided run of B bytes from HL, stride DE" primitive. It is the fall-through body
 * of the `rst 0x38` entry (loc_0038, which fixes DE=4, B=0x0A) and is also entered
 * directly by `call 0x003d`. A pure leaf: it calls nothing and touches only
 * caller-supplied memory.
 *
 * Five jobs:
 *
 *   1. EQUAL -- the idiomatic optimized sub_003d (optimized/sub_003d.js) reads EQUAL
 *      against its translated oracle, whole-machine and unit. It resolves through the
 *      routine registry (m.call), so the override reaches it whether it is entered via
 *      the `rst 0x38` fall-through (loc_0038 -> m.call(0x003d)) or a direct call.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. sub_003d does
 *      NOT run in pure attract mode (0 hits over 240 boot frames); it first fires at
 *      frame ~160 of a coin+start run, laying out the 0x6908 sprite-object block during
 *      the opening-cutscene / board setup (all via `rst 0x38`, B=0x0A).
 *
 *   3. TEETH -- a deliberately-broken twin (the routine's FIRST store lands a wrong
 *      value) must be CAUGHT: NOT-EQUAL, naming the diverging address (the entry HL).
 *
 *   4/5. FULL BRANCH COVERAGE -- sub_003d's only data-dependent branch is the djnz
 *      loop count. Each is proven EQUAL (RAM + every register incl. F + pc) on a
 *      SYNTHESISED entry cloned from a real captured one, shown non-vacuously to have
 *      run the intended number of passes, AND asserting the total cycle count matches
 *      the oracle's (measured on both clones):
 *        - loop=1     (single pass; djnz exits after one)
 *        - loop=2     (the direct-call shape loc_1880 uses: B=2, C=0x28, HL=0x6903)
 *        - loop=10    (the dominant natural `rst 0x38` shape, C=0xFC -> 8-bit
 *                      negative-wrap decrement)
 *        - loop=256   (B=0 edge: djnz decrements-then-tests, so 0 -> 256 passes)
 *        - carry-out  (a final `add hl,de` that CARRIES; proves the escaping carry
 *                      flag matches -- the reason addHl is required, not a bare add)
 *
 * WHY THIS TEST DRIVES A TAPE (like loc_1880, it cannot use the fixed-factory DK
 * harness wrapper). sub_003d never runs from boot -- it needs a real in-game state-3
 * context -- so a coin+start tape is loaded onto the machine and the game-agnostic
 * CORE engine (core/equivalence.js) is driven through a custom makeMachine factory
 * (the same construction-time snapshot override the DK wrapper uses). The tape is
 * applied IDENTICALLY to the baseline and optimized sides.
 *
 * THE ATOMICITY DECISION this routine records: sub_003d is kept PER-INSTRUCTION (its
 * cycle charges are NOT collapsed). It is a foundational leaf reached from 30+ sites
 * via both `rst 0x38` and direct `call 0x003d` (board setup, cutscene object staging,
 * per-frame object updates). Per the brief's ATOMICITY-IS-PER-CALL-PATH rule, a
 * collapse is safe only if the vblank NMI can never land inside it on ANY of those
 * paths, which cannot be proven short of an exhaustive per-site trace. A collapse
 * experiment stayed EQUAL over 220 driven frames, but that is precisely the
 * "short run is NOT proof" case the brief names -- so per-instruction (always
 * correct) is kept, matching sub_0018 / sub_0020 (same widely-reached-leaf shape).
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_003d as translated_003d } from "../../translated/nmi.js";
import { sub_003d as optimized_003d } from "../sub_003d.js";
import { Machine } from "../../machine.js";
import {
  wholeMachineEquivalence as coreWholeMachineEquivalence,
  unitEquivalence as coreUnitEquivalence,
  firstStateDiff,
  firstRegDiff,
} from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x003d;
const FRAMES = 200; // sub_003d first fires at frame ~160 (rst 0x38, B=0x0A); ~5 fires by 200
const MAXF = 200; // long enough for the unit/capture host to reach the first entry

// Canonical coin+start tape: reach in-game GAME_STATE 3, whose board/cutscene setup
// runs the `rst 0x38` add-loops that flow into sub_003d.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 60, dur: 6 }, // coin
  { port: 0x7d00, bits: 0x04, frame: 90, dur: 6 }, // start1
];

// The engine's factory: a DK Machine on this ROM with the coin+start tape loaded.
// Called with no argument for the baseline and with the wrapped override map for the
// optimized side (the core engine wraps each override with its own invocation counter,
// so an EQUAL that never dispatched cannot pass vacuously).
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
};

/**
 * Capture ONE real entry to sub_003d (via a construction-time snapshot override on the
 * tape-driven host), then synthesise loop-count branches from it. Reusing a real
 * captured entry gives a valid stack (the routine's `ret` unwinds it) and a live board
 * context. The first entry is deterministic: frame ~160, B=0x0A, C=0x30, HL=0x6908,
 * DE=4 (the first stride-4 object-block add-pass).
 */
function captureEntry() {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_003d(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(MAXF);
  assert.ok(entry !== null, "failed to capture a sub_003d entry to synthesise branches from");
  return entry;
}

/**
 * Deliberately-broken twin: behaviourally the optimized routine EXCEPT its FIRST store
 * lands a wrong value (the correct byte XOR 0xFF, guaranteed to differ). The first store
 * is `ld (hl),a` at the entry HL, so the corrupted cell is the entry pointer's target.
 * Intercepting exactly that one write lets the rest of the loop run verbatim -- the
 * representative "wrong value to one of the routine's own output addresses" bug.
 */
function broken_003d(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke) {
      broke = true;
      return realWrite(addr, value ^ 0xff, busOffset);
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    return optimized_003d(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_003d matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_003d]]));

  // The override must actually have run, or EQUAL would be vacuous.
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
      `override fired ${r.invocations.get(TARGET)}x (rst 0x38 add-loop, B=0x0A)`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_003d matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_003d, optimized_003d, { maxFrames: MAXF });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong first store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_003d]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong first store is CAUGHT and names the entry HL", () => {
  // The first store is `ld (hl),a` at the captured entry's HL, so that is the address
  // the broken value must land at. Derived from a captured entry, not hardcoded.
  const entry = captureEntry();
  const expectAddr = entry.regs.hl;
  assert.equal(expectAddr, 0x6908, `expected first entry HL 0x6908 (the object-block base), got 0x${expectAddr.toString(16)}`);

  const r = coreUnitEquivalence(makeMachine, TARGET, translated_003d, broken_003d, { maxFrames: MAXF });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    expectAddr,
    `expected first diff at the entry HL 0x${expectAddr.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- FULL BRANCH COVERAGE (synthesised loop-count branches, incl. cycle totals) --

/**
 * Prove one loop-count branch EQUAL. Seeds B/C/HL/DE on a clone of a real captured
 * entry, runs oracle vs optimized on two further clones, and asserts RAM + every
 * register + pc identical, that the loop ran the intended number of passes
 * (non-vacuous: B ended 0, HL advanced by count*stride, the first byte changed by +C),
 * AND that both consumed the SAME total cycles (teeth on the per-instruction totals --
 * automatically preserved, but asserted so a wrong charge would be caught). Cycles are
 * the m.cycles delta -- a clone's frame machinery is neutralised, so only the routine
 * advances the clock.
 */
function proveBranch(entry, name, { b, c, hl, de, expectCarry }) {
  const seed = entry.clone();
  seed.regs.b = b;
  seed.regs.c = c;
  seed.regs.hl = hl;
  seed.regs.de = de;
  const count = b === 0 ? 256 : b; // djnz: 0 -> 256 passes
  const before = seed.mem.read8(hl); // first-touched byte, before

  const a = seed.clone(); // translated oracle
  const bb = seed.clone(); // optimized

  const aCyc0 = a.cycles;
  translated_003d(a);
  const oracleCycles = a.cycles - aCyc0;

  const bCyc0 = bb.cycles;
  optimized_003d(bb);
  const optCycles = bb.cycles - bCyc0;

  const ram = firstStateDiff(a.dumpState(), bb.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, bb.regs);
  assert.equal(ram, null, ram ? `${name}: RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
  assert.equal(regs, null, regs ? `${name}: reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
  assert.equal(a.pc, bb.pc, `${name}: pc must match`);

  // Teeth on the cycle total: a wrong per-instruction charge would be caught here.
  assert.equal(optCycles, oracleCycles, `${name}: cycle total ${optCycles} != oracle ${oracleCycles}`);

  // Non-vacuous: the loop actually ran `count` passes.
  assert.equal(a.regs.b, 0, `${name}: B must end 0 after ${count} passes (got ${a.regs.b})`);
  assert.equal(
    a.regs.hl,
    (hl + count * de) & 0xffff,
    `${name}: HL must advance by count*stride to 0x${((hl + count * de) & 0xffff).toString(16)} (got 0x${a.regs.hl.toString(16)})`,
  );
  assert.equal(
    a.mem.read8(hl),
    (before + c) & 0xff,
    `${name}: first byte must be (before + C) & 0xff`,
  );
  if (expectCarry !== undefined) {
    assert.equal(a.regs.fC, expectCarry, `${name}: final add hl,de carry-out must be ${expectCarry}`);
  }

  console.log(
    `  BRANCH ${name}: EQUAL (RAM+regs+pc); ${oracleCycles}t both sides; ` +
      `${count} passes, HL 0x${hl.toString(16)} -> 0x${a.regs.hl.toString(16)}` +
      (expectCarry !== undefined ? `, carry=${a.regs.fC}` : ""),
  );
}

test("BRANCH (loop=1): a single pass — EQUAL + cycle total", () => {
  const entry = captureEntry();
  proveBranch(entry, "loop=1", { b: 0x01, c: 0x30, hl: 0x6908, de: 0x0004 });
});

test("BRANCH (loop=2, direct-call shape): B=2 C=0x28 HL=0x6903 — EQUAL + cycle total", () => {
  const entry = captureEntry();
  // The exact register shape loc_1880's direct `call 0x003d` uses.
  proveBranch(entry, "loop=2", { b: 0x02, c: 0x28, hl: 0x6903, de: 0x0004 });
});

test("BRANCH (loop=10, negative-wrap): B=0x0A C=0xFC (−4) HL=0x690B — EQUAL + cycle total", () => {
  const entry = captureEntry();
  // The dominant natural rst-0x38 shape: C=0xFC decrements each byte (8-bit wrap).
  proveBranch(entry, "loop=10", { b: 0x0a, c: 0xfc, hl: 0x690b, de: 0x0004 });
});

test("BRANCH (loop=256, djnz wrap): B=0 runs 256 passes — EQUAL + cycle total", () => {
  const entry = captureEntry();
  // B=0 with stride 1 walks 0x6100..0x61FF (256 bytes, all work RAM) -- proves the
  // do-while mirrors djnz's decrement-then-test 256-pass semantics.
  proveBranch(entry, "loop=256", { b: 0x00, c: 0x01, hl: 0x6100, de: 0x0001 });
});

test("BRANCH (carry-out escapes): final add hl,de CARRIES — EQUAL + carry flag", () => {
  const entry = captureEntry();
  // One pass, DE chosen so HL(0x6100)+DE(0xA000)=0x10100 wraps -> carry set. The single
  // store lands in RAM (0x6100); HL ends 0x0100 but is never written. Proves the
  // escaping carry flag matches -- the reason addHl (not a bare 16-bit add) is required.
  proveBranch(entry, "carry-out", { b: 0x01, c: 0x05, hl: 0x6100, de: 0xa000, expectCarry: true });
});
