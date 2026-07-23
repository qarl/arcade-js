// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_08ba (game state 2 / credited, sub-state 0:
 * build the board and step the sub-state selector, then fall through into
 * loc_08d5). Unlike entry_0611 it is an NMI GAME-STATE routine, reached via
 * dispatchGameState off GAME_STATE==2 -> loc_08b2's rst-0x28 table[0] (0x600A==0).
 *
 * DRIVING IT. loc_08ba never runs from an idle boot (it needs a credited game),
 * so every gate here drives a COIN: IN2 bit7 (IN2_COIN1) is pulsed low->high
 * during attract, which the ROM's own credit logic turns into GAME_STATE 1->2, and
 * loc_08ba then dispatches EXACTLY ONCE at frame 16. The coin is delivered through
 * the standard harness's `assets.inputs` seam so it is applied identically to the
 * baseline and optimized sides; `COIN_ASSETS.inputs` is a GETTER so each machine the
 * harness builds gets its OWN fresh read counter (the whole-machine gate builds two,
 * baseline then optimized; a shared counter would desync them). A held-from-boot coin
 * does NOT work -- the coin-edge latch (0x6003) needs a low read first -- so the pulse
 * starts after a few idle reads.
 *
 * Four jobs:
 *
 *   1. EQUAL -- the idiomatic optimized loc_08ba reads EQUAL against its translated
 *      oracle, whole-machine and unit. The override reaches it however it is entered:
 *      the whole-machine gate through dispatchGameState's override consult, the unit
 *      gate through the construction-time snapshot the standard harness installs
 *      (loc_08ba is also m.call'd via loc_08b2's rst-0x28 dispatcher).
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. loc_08ba
 *      dispatches once, at frame 16; a 30-frame window covers it.
 *
 *   3. TEETH -- a deliberately-broken twin (loc_08ba's own ATTRACT store lands the
 *      wrong value at 0x6007) must be CAUGHT: NOT-EQUAL, naming 0x6007. 0x6007 is a
 *      work-RAM byte loc_08ba writes and nothing rewrites within the window, so the
 *      corruption persists into the compared state dump.
 *
 *   4. BRANCH COVERAGE -- loc_08ba is STRAIGHT-LINE: it has no data-dependent branch
 *      of its own (every call is unconditional; there is no `if`), so the single
 *      natural path is full coverage of loc_08ba itself. Its observable behavior does
 *      include the fall-through into loc_08d5, whose two decisions (CREDITS `cp 1`,
 *      FRAME `and 7`) ARE data-dependent -- so a synthesized-entry sweep proves all
 *      four combinations EQUAL (including the FRAME&7==0 arm that calls the
 *      interruptible 0x05e9/0x0616), locking the fall-through's correctness.
 *
 *   5. WRITE-TRACE -- loc_08ba makes its OWN hardware writes (the two palette-bank
 *      latch clears 0x7D86/0x7D87). The RAM+regs gate cannot see the emit.js --writes
 *      trace's cycle column, so this proves the two writes land at the oracle's exact
 *      write-bus cycle (11 t apart, not collapsed onto one) -- and that a flat-collapse
 *      prologue would shift them onto the same cycle (teeth).
 *
 * THE CYCLE FINDING this routine adds: loc_08ba is ATOMIC (it runs inside the vblank
 * NMI, whose handler clears the NMI mask, so no NMI can re-fire inside it). Its cycle
 * charges are therefore collapsed to one m.step total per call-boundary (17 / 44 / 38
 * / 32), and that stays EQUAL. But the TOTAL is load-bearing: STRIPPING the charges
 * entirely diverges at STACK 0x6bfd (frame 16, 44 vs 46) -- a cheaper NMI shifts the
 * cumulative cycle count, moving where a downstream NMI lands and changing the pushed
 * PC. Preserving each run's total keeps the cumulative count entering every callee
 * identical. (Same universal lesson as handler_01c3 / entry_0611, README §2.)
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_08ba as translated_08ba } from "../../translated/state0.js";
import { loc_08ba as optimized_08ba } from "../loc_08ba.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, firstRegDiff } from "../../../../core/equivalence.js";
import { IN2_COIN1 } from "../../../../boards/dkong/io.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x08ba;
const FRAMES = 30; // loc_08ba fires exactly once, at frame 16
const MAX_FRAMES = 60; // unit gate: run this long to reach the first entry

// Coin pulse on IN2 bit7 (IN2_COIN1): low for the first idle reads (so the coin-edge
// latch 0x6003 is armed), then high for reads [20,40) — one clean low->high edge the
// ROM credits, taking GAME_STATE 1->2. Stateless apart from its own read counter.
function makeCoinInputs() {
  let reads = 0;
  return {
    service1: false,
    _in0: 0, _in1: 0, _in2: 0, _dsw0: 0x80,
    in0() { return 0; },
    in1() { return 0; },
    in2() {
      const coin = reads >= 20 && reads < 40 ? IN2_COIN1 : 0;
      reads += 1;
      return coin;
    },
    dsw0() { return this._dsw0; },
  };
}

// `inputs` is a GETTER so every machine the harness constructs gets a fresh counter,
// applied identically to both sides. The coin is the only assets we need (the state
// dump the gate compares needs no gfx/proms).
const COIN_ASSETS = { get inputs() { return makeCoinInputs(); } };

// loc_08ba's own first store to work RAM in the diff: ATTRACT (0x6007) = 0. sub_0874
// (called first) clears VRAM/sprite RAM but never touches 0x6007, so the first write
// there is loc_08ba's, and nothing rewrites it within the window.
const BROKEN_ADDR = 0x6007;

/**
 * Deliberately-broken twin: the optimized handler EXCEPT its first store to 0x6007
 * lands a wrong value (correct XOR 0xFF, guaranteed to differ). Intercepting exactly
 * that one write lets the rest of the routine and every subroutine it calls run
 * verbatim — the representative "wrong value to one of the routine's own output
 * addresses" bug the gate must catch.
 */
function broken_08ba(m) {
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
    return optimized_08ba(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

/**
 * The PRE-FIX FLAT COLLAPSE of loc_08ba's palette segment: byte-identical to the
 * shipped optimized routine in RAM + regs + cycle TOTAL, EXCEPT the two palette-bank
 * stores are emitted before one 32t lump, so both hardware writes land at the SAME
 * bus cycle. This is exactly the divergence the RAM+regs gate cannot see, so it is
 * the teeth for the WRITE-TRACE test -- a re-collapse must fail that check.
 */
function flat_08ba(m) {
  const { regs, mem } = m;
  m.push16(0x08bd);
  m.step(0x0874, 17);
  m.call(0x0874);
  regs.xor(regs.a);
  mem.write8(0x6007, regs.a);
  regs.de = 0x030c;
  m.push16(0x08c7);
  m.step(0x309f, 44);
  m.call(0x309f);
  regs.hl = 0x600a;
  regs.incMem8(mem, regs.hl);
  m.push16(0x08ce);
  m.step(0x0965, 38);
  m.call(0x0965);
  // FLAT: both palette writes emitted before the single 32t charge (the bug).
  regs.xor(regs.a);
  regs.hl = 0x7d86;
  mem.write8(regs.hl, regs.a, 7);
  regs.l = regs.inc8(regs.l);
  mem.write8(regs.hl, regs.a, 7);
  m.step(0x08d5, 32);
  return m.call(0x08d5);
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_08ba matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, COIN_ASSETS, FRAMES, new Map([[TARGET, optimized_08ba]]));

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
      `override fired ${r.invocations.get(TARGET)}x`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_08ba matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, COIN_ASSETS, TARGET, translated_08ba, optimized_08ba, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong ATTRACT store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, COIN_ASSETS, FRAMES, new Map([[TARGET, broken_08ba]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong ATTRACT store is CAUGHT and names 0x6007", () => {
  const r = unitEquivalence(ROM, COIN_ASSETS, TARGET, translated_08ba, broken_08ba, { maxFrames: MAX_FRAMES });

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

// -- BRANCH COVERAGE ----------------------------------------------------------
//
// loc_08ba itself is straight-line, so #1/#2 cover its single path. Its fall-through
// into loc_08d5 exposes two data-dependent decisions; synthesise entries that pin each
// combination and prove EQUAL. Building a machine to capture a pristine entry is the
// sanctioned way to synthesise a branch state (README/brief); the coin drives it there.

/** Capture a pristine machine clone at the instant loc_08ba is first entered. */
function captureEntry() {
  let entry = null;
  const overrides = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_08ba(mm);
  }]]);
  const host = new Machine(ROM, { inputs: makeCoinInputs(), overrides });
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error("loc_08ba never entered while capturing branch entry");
  return entry;
}

/** Diff translated vs optimized loc_08ba on the captured entry with 0x6001/0x601A set. */
function branchEqual(entry, credits, frameByte) {
  const a = entry.clone();
  const b = entry.clone();
  for (const mm of [a, b]) {
    mm.mem.write8(0x6001, credits); // CREDITS -> loc_08d5 `cp 0x01`
    mm.mem.write8(0x601a, frameByte); // FRAME   -> loc_08d5 `and 0x07`
  }
  translated_08ba(a);
  optimized_08ba(b);
  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o));
  const regs = firstRegDiff(a.regs, b.regs);
  const pc = a.pc === b.pc ? null : { a: a.pc, b: b.pc };
  return { equal: !ram && !regs && !pc, ram, regs, pc };
}

test("BRANCH (synthesised): every fall-through arm of loc_08d5 reads EQUAL", () => {
  const entry = captureEntry();
  // CREDITS: 1 => `cp 0x01` Z (B=4,E=9); 2 => NZ (B=0xC,E=0xA).
  // FRAME&7: 0x08 => and 7 == 0 (calls 0x05e9 + 0x0616); 0x05 => != 0 (skips them).
  const cases = [
    ["cp Z  / skip-calls", 1, 0x05],
    ["cp Z  / make-calls", 1, 0x08],
    ["cp NZ / skip-calls", 2, 0x05],
    ["cp NZ / make-calls", 2, 0x08],
  ];
  for (const [label, credits, frameByte] of cases) {
    const r = branchEqual(entry, credits, frameByte);
    assert.equal(
      r.equal,
      true,
      r.equal ? "" : `[${label}] diverged: ram=${r.ram ? "0x" + r.ram.addr.toString(16) : null} ` +
        `regs=${r.regs ? r.regs.reg : null} pc=${r.pc ? JSON.stringify(r.pc) : null}`,
    );
    console.log(`  BRANCH ${label}: EQUAL (RAM + regs + pc)`);
  }
});

// -- WRITE-TRACE (the hardware-write bus cycle the RAM gate cannot see) --------

/** Run `fn` on a fresh clone of `entry` with the hardware write-trace recording.
 *  Report each write's cycle RELATIVE to entry so it is base-independent. */
function traceClone(entry, fn) {
  const c = entry.clone();
  c.mem.writeTrace = []; // clock is () => c.cycles (installed by the constructor)
  const c0 = c.cycles;
  fn(c);
  return c.mem.writeTrace.map((w) => ({ rel: w.cycle - c0, addr: w.addr, value: w.value }));
}

test("WRITE-TRACE: the two palette-bank writes land at the oracle's exact bus cycle", () => {
  const entry = captureEntry();
  const oracleTrace = traceClone(entry, translated_08ba);
  const optTrace = traceClone(entry, optimized_08ba);

  // loc_08ba's ONLY hardware writes are the two palette-bank latch clears (0x7D86<-0
  // then 0x7D87<-0); its four callees write only work/sprite/video RAM, so they add
  // no hardware-write trace entries.
  assert.equal(oracleTrace.length, 2, "expected exactly two hardware writes (the palette latches)");
  assert.deepEqual(
    oracleTrace.map((w) => [w.addr, w.value]),
    [[0x7d86, 0], [0x7d87, 0]],
    "oracle hardware-write trace is not the two palette-bank clears",
  );
  // The load-bearing spacing a flat collapse would erase: 0x7D87 is written 11 t after
  // 0x7D86 (the `ld (hl),a` that wrote 0x7D86 = 7, then `inc l` = 4).
  assert.equal(
    oracleTrace[1].rel - oracleTrace[0].rel,
    11,
    "oracle palette-write spacing is not the expected 11 t",
  );

  assert.deepEqual(optTrace, oracleTrace, "optimized palette-write bus cycles differ from the oracle");

  // Teeth: the PRE-FIX flat collapse puts both writes on the SAME cycle -- invisible
  // to the RAM+regs gate (its total is preserved) but a real write-trace divergence.
  // It must fail the deepEqual, or this check has no teeth.
  const flat = traceClone(entry, flat_08ba);
  assert.equal(flat[0].rel, flat[1].rel, "flat variant should collapse both writes onto one cycle");
  assert.notDeepEqual(flat, oracleTrace, "write-trace check has no teeth");
  console.log(
    `  WRITE-TRACE: palette writes @ +${oracleTrace[0].rel}/+${oracleTrace[1].rel}t identical to oracle ` +
      `(11t apart); flat-collapse variant (both @ +${flat[0].rel}t) caught`,
  );
});
