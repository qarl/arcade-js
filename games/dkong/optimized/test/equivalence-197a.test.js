// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_197a (THE per-frame in-game update cascade at
 * ROM 0x197A: a straight run of ~24 `call`s that tick every in-game subsystem, then
 * a `ld a,(0x6200) / and a / ret nz` gate that either returns or falls through into
 * tail_19d2). It is a task-table entry (dw 0x197a @ 0x071A) AND handler_1977's tail;
 * empirically it dispatches every frame while a credited game runs.
 *
 * Four jobs, as for loc_06fe / entry_0611, plus a per-branch coverage sweep:
 *
 *   1. EQUAL -- the idiomatic optimized loc_197a (optimized/loc_197a.js) reads EQUAL
 *      against its translated oracle, whole-machine and unit.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. loc_197a
 *      does NOT run in attract (0 dispatches over 400 plain-boot frames): it needs a
 *      credited game, so it is driven with a coin+start inputTape. It first
 *      dispatches at frame 1033 and then every frame through ~f1230 (198 dispatches
 *      in a 1300-frame window), all EQUAL.
 *
 *   3. TEETH -- a deliberately-broken twin (the first store to the sprite cell
 *      0x75C4 on loc_197a's path lands the wrong value) must be CAUGHT: NOT-EQUAL,
 *      naming 0x75C4 (whole-machine and unit).
 *
 *   4. BRANCH COVERAGE. loc_197a has four data-dependent branches:
 *        - three rst caller-skip GUARDS -- `if (!m.call(G)) return;` for G in
 *          {0x1E8C, 0x1E57, 0x1A07}. Each callee normally returns TRUE (continue);
 *          FALSE means it unwound past loc_197a to loc_197a's own caller (abort).
 *        - the final MARIO_ACTIVE (0x6200) gate: `ret nz` (return, skip the tail) vs
 *          fall-through into tail_19d2.
 *      The DRIVEN run reaches: all three guards TRUE (198x each), gate NZ/ret (197x)
 *      and gate Z/tail (once, ~f1230) -- so those five arms are proven EQUAL by the
 *      whole-machine + unit gates above. The three guard-FALSE arms are NOT reached
 *      naturally, so each is SYNTHESISED: clone the captured entry, stub the deciding
 *      callee FALSE (identically on both sides -- each guard's ONLY caller is
 *      loc_197a, so the stub cleanly exercises that guard), and diff oracle vs
 *      optimized (RAM + regs + pc). Because these arms are kept PER-INSTRUCTION (not
 *      collapsed, see below), the branch's CYCLE TOTAL is also measured on both
 *      clones and asserted equal -- belt-and-suspenders teeth against a wrong charge
 *      on an arm no whole-machine frame reaches. The gate-Z/tail arm is additionally
 *      synthesised from a captured gate-Z entry for an explicit committed assertion.
 *
 * WHY THE CORE ENGINE + A CUSTOM FACTORY (not harness.js's wrappers). Same reason as
 * loc_06fe: harness.js bakes a `makeMachine` on `{}` assets which drives NO input,
 * so it never credits a game and never dispatches loc_197a. This test calls the SAME
 * core unitEquivalence / wholeMachineEquivalence directly, with a makeMachine factory
 * that attaches an identical coin+start inputTape to BOTH sides (the factory is
 * shared, so any input/poke is applied identically to baseline and optimized).
 *
 * CYCLE FINDING this routine adds: loc_197a is NON-ATOMIC (it dispatches the longest
 * per-frame work in the game -- the movement/enemy/collision engine, entry_1ac3 and
 * friends, all NMI-interruptible; a vblank boundary routinely lands mid-cascade), so
 * it stays PER-INSTRUCTION, byte-identical to the oracle -- the same decision as
 * loc_06fe, but with TEETH loc_06fe lacked: collapsing the branch to a single front-
 * loaded total DIVERGES at frame 1035, stack 0x6BF6 (the NMI lands at a different
 * instruction inside the cascade and pushes a different PC). Verified the other way
 * too: with per-instruction charges the whole-machine gate stays EQUAL over 1300
 * frames. So loc_197a is the routine that makes "keep per-instruction for a non-
 * atomic cascade" a measured requirement rather than a conservative default.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_197a as translated_197a } from "../../translated/state0.js";
import { loc_197a as optimized_197a } from "../loc_197a.js";
import { Machine } from "../../machine.js";
import {
  unitEquivalence,
  wholeMachineEquivalence,
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

const TARGET = 0x197a;
const FRAMES = 1300; // dispatches f1033..~f1230 (198x), incl. the single gate-Z/tail frame
const MAX_FRAMES = 1080; // loc_197a first dispatches at frame 1033

// The three rst caller-skip guards, each `if (!m.call(G)) return;`. Each guard's
// ONLY caller in the ROM is loc_197a, so stubbing G on a clone exercises exactly
// that guard. `sentinel` is the callee that runs immediately AFTER guard G on the
// continue path -- it must NOT run when G aborts, which proves the early return.
const GUARDS = [
  { g: 0x1e8c, sentinel: 0x1ac3, name: "0x1E8C (@0x1980)" },
  { g: 0x1e57, sentinel: 0x1a07, name: "0x1E57 (@0x19B9)" },
  { g: 0x1a07, sentinel: 0x2fcb, name: "0x1A07 (@0x19BF)" },
];

// A coin+start tape (identical to loc_06fe's): coin on IN2 bit7 at frame 10, start1
// on IN2 bit2 at frame 30. Credits and starts a game so loc_197a begins dispatching.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

// The makeMachine factory the core engine drives, extended to attach the coin+start
// inputTape. Called with no argument for the baseline and with the wrapped override
// map for the optimized side -- both get the SAME tape (applied identically).
function makeMachine(overrides) {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
}

// The first store on loc_197a's path that lands in the compared state dump as a
// write-only sink: sprite/VRAM cell 0x75C4 (written once per dispatch). The unit
// gate captures the FIRST entry (gate-NZ path), which writes it, so both gates catch
// a corruption here -- the loc_197a analog of loc_06fe's 0x7400.
const BROKEN_ADDR = 0x75c4;

/**
 * Deliberately-broken twin: behaviourally optimized_197a EXCEPT the first store to
 * 0x75C4 lands a wrong value (the correct byte XOR 0xFF). Intercepting exactly that
 * one write lets the whole cascade and every subroutine run verbatim -- the
 * representative "wrong value to an address on the routine's path" bug the gate must
 * catch.
 */
function broken_197a(m) {
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
    return optimized_197a(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_197a matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_197a]]));

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
    `  EQUAL/whole: ${r.framesCompared} frames identical, override fired ` +
      `${r.invocations.get(TARGET)}x (per-frame cascade via coin+start, ~f1033..f1230)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_197a matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_197a, optimized_197a, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, SP) + pc identical (first entry: frame 1033, gate-NZ arm)");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong store on the cascade path is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, MAX_FRAMES, new Map([[TARGET, broken_197a]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong store on the cascade path is CAUGHT and names 0x75C4", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_197a, broken_197a, { maxFrames: MAX_FRAMES });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} (translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- BRANCH COVERAGE ----------------------------------------------------------

// Capture the pristine machine state at loc_197a's FIRST dispatch (frame 1033), via
// the same construction-time snapshot the core unit gate uses.
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_197a(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`loc_197a never dispatched within ${MAX_FRAMES} frames`);
  return entry;
}

// Capture the pristine entry state of the ONE dispatch whose cascade leaves
// MARIO_ACTIVE (0x6200) == 0 at the gate -- i.e. the gate-Z / fall-through-into-tail
// arm. Detect it by running the oracle on a scratch clone and checking whether the
// tail's sub_011c ran; keep the pre-execution clone of that entry.
function captureGateZEntry() {
  let gateZ = null;
  const snap = new Map([[TARGET, (mm) => {
    if (gateZ === null) {
      const pre = mm.clone();
      const scratch = mm.clone();
      let tailRan = false;
      const orig = scratch.routines.get(0x011c);
      scratch.routines.set(0x011c, (...a) => { tailRan = true; return orig(...a); });
      translated_197a(scratch);
      if (tailRan) gateZ = pre; // this entry falls through into the tail
    }
    return translated_197a(mm);
  }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (gateZ === null) throw new Error("loc_197a never reached its gate-Z/tail arm within the window");
  return gateZ;
}

// Run oracle vs optimized on two clones of `entry` with the given callee stubbed
// FALSE on both, and diff RAM + regs + pc + cycle total. Returns diagnostics.
function diffWithGuardFalse(entry, guardAddr, sentinelAddr) {
  const a = entry.clone(); // translated
  const b = entry.clone(); // optimized

  let firedA = 0, firedB = 0, sentinelA = 0, sentinelB = 0;
  a.routines.set(guardAddr, () => { firedA++; return false; });
  b.routines.set(guardAddr, () => { firedB++; return false; });
  const origSA = a.routines.get(sentinelAddr);
  const origSB = b.routines.get(sentinelAddr);
  a.routines.set(sentinelAddr, (...x) => { sentinelA++; return origSA(...x); });
  b.routines.set(sentinelAddr, (...x) => { sentinelB++; return origSB(...x); });

  const cA0 = a.cycles, cB0 = b.cycles;
  translated_197a(a);
  optimized_197a(b);
  const dA = a.cycles - cA0, dB = b.cycles - cB0;

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  const pcEq = a.pc === b.pc;
  return { ram, regs, pcEq, firedA, firedB, sentinelA, sentinelB, dA, dB };
}

test("BRANCH COVERAGE: each caller-skip guard's FALSE (abort) arm is EQUAL (RAM+regs+pc+cycles)", () => {
  const entry = captureEntry();
  for (const { g, sentinel, name } of GUARDS) {
    const r = diffWithGuardFalse(entry, g, sentinel);

    assert.ok(r.firedA >= 1 && r.firedB >= 1, `${name}: guard stub must fire on both sides (a=${r.firedA} b=${r.firedB})`);
    assert.equal(r.sentinelA, 0, `${name}: translated ran the post-guard sentinel — did NOT abort`);
    assert.equal(r.sentinelB, 0, `${name}: optimized ran the post-guard sentinel — did NOT abort`);
    assert.equal(r.ram, null, r.ram ? `${name}: RAM diff at 0x${r.ram.addr.toString(16)} (${r.ram.a} vs ${r.ram.b})` : "");
    assert.equal(r.regs, null, r.regs ? `${name}: reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
    assert.ok(r.pcEq, `${name}: pc mismatch`);
    assert.equal(r.dA, r.dB, `${name}: cycle-total mismatch (translated ${r.dA} vs optimized ${r.dB})`);
  }
  console.log("  BRANCH COVERAGE: guard-FALSE arms 0x1E8C / 0x1E57 / 0x1A07 all EQUAL (aborted, RAM+regs+pc+cycles match)");
});

test("BRANCH COVERAGE: the gate-Z / fall-through-into-tail arm is EQUAL (RAM+regs+pc+cycles)", () => {
  const entry = captureGateZEntry();
  const a = entry.clone();
  const b = entry.clone();

  const cA0 = a.cycles, cB0 = b.cycles;
  translated_197a(a);
  optimized_197a(b);
  const dA = a.cycles - cA0, dB = b.cycles - cB0;

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
  assert.equal(a.pc, b.pc, "pc must match");
  assert.equal(dA, dB, `cycle-total mismatch (translated ${dA} vs optimized ${dB})`);
  // Confirm this really is the tail arm: it writes 0x6082 = 3 and (via tail_19d2)
  // arms 0x6009 = 0x40 -- neither happens on the ret-nz arm.
  assert.equal(a.mem.read8(0x6082), 0x03, "gate-Z arm must write 0x6082 = 3");
  assert.equal(b.mem.read8(0x6082), 0x03, "optimized gate-Z arm must write 0x6082 = 3");
  assert.equal(a.mem.read8(0x6009), 0x40, "gate-Z arm must arm 0x6009 = 0x40 via tail_19d2");
  console.log("  BRANCH COVERAGE: gate-Z/tail arm EQUAL (0x6082=3, 0x6009=0x40 via tail_19d2, cycles match)");
});
