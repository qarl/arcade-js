// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_00e0 (the "sound driver tick": once per vblank
 * push the queued sound state to the audio hardware -- eight ls259.6h sound-trigger
 * bits from the SND_TRIGGER shadows, the 0x7C00 tune latch from SND_PRIORITY/SND_BGM,
 * the 0x7D80 IRQ line from SND_IRQ_TRIGGER). It is a LEAF reached via m.call(0x00e0)
 * from perFrame (ROM 0x00B5), which runs INSIDE the vblank NMI -- so it is ATOMIC on
 * its one call path and its internal cycle distribution is free, but it makes TEN
 * hardware writes whose write-bus cycle the RAM+regs gate cannot see.
 *
 * Jobs:
 *   1. EQUAL (whole + unit) -- idiomatic optimized sub_00e0 reads EQUAL against its
 *      translated oracle in RAM and the full register file (+ pc). The whole-machine
 *      run drives coin+start so ATTRACT (0x6007) drops to 0 and the FULL path runs
 *      (during attract the routine takes the `ret nz` guard and does nothing).
 *   2. DISPATCH -- the override must fire, or EQUAL is vacuous. sub_00e0 is called
 *      every frame from perFrame; over 130 frames it runs the guard path (attract)
 *      AND the full path (in game) dozens of times each.
 *   3. FULL BRANCH COVERAGE -- the routine's data-dependent branches are each proven
 *      EQUAL on a synthesised entry (RAM+regs+pc) AND, because each branch is a
 *      COLLAPSED cycle total, its total is pinned to the oracle's:
 *        - loop: zero-shadow (release, bit 0) AND non-zero shadow (assert+decrement, bit 1)
 *        - tail-1: background tune (0x608B==0 -> SND_BGM) AND priority tune (0x608B!=0
 *                  -> decrement + SND_PRIORITY)
 *        - tail-2: IRQ clear (0x6088==0 -> line 0) AND IRQ set (0x6088!=0 -> decrement + line 1)
 *        - guard: ATTRACT!=0 -> early return
 *   4. WRITE-TRACE -- the ten hardware writes land at the oracle's exact write-bus
 *      cycle (the RAM gate can't see the emit.js --writes trace's cycle column), and
 *      a flat-collapsed variant that shifts them is CAUGHT. loc_0a8a is the pattern.
 *   5. TEETH (whole + unit) -- a wrong work-RAM output store (a corrupted SND_TRIGGER
 *      decrement) is CAUGHT, naming the diverging address.
 *
 * THE CYCLE FINDING this routine adds: a densely hardware-writing atomic routine
 * PARTIALLY collapses. sub_00e0 is atomic (perFrame is inside the NMI), so its
 * distribution is free -- but ten write-only-device writes (0x7D00-0x7D07 bus off 4,
 * 0x7C00 / 0x7D80 bus off 10) each carry a bus-cycle column the RAM+regs gate cannot
 * police. So the collapse keeps each hardware-write-free RUN as one m.step but brackets
 * every hardware write at its exact cumulative cycle; the write-trace test is what
 * proves that column, with a flat variant for teeth.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_00e0 as translated_00e0 } from "../../translated/nmi.js";
import { sub_00e0 as optimized_00e0 } from "../sub_00e0.js";
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

const TARGET = 0x00e0;
const FRAMES = 130; // coin at 60, start at 90; ATTRACT drops to 0 and the full path runs

// Canonical coin+start tape (same as equivalence-0a8a): pulse IN2 coin (0x80) then
// IN2 start1 (0x04) so the ROM starts a credited game and ATTRACT (0x6007) -> 0,
// which is what un-gates sub_00e0's full body.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 60, dur: 6 }, // coin
  { port: 0x7d00, bits: 0x04, frame: 90, dur: 6 }, // start1
];

const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
};

// SND_TRIGGER[3] (0x6083). The game stores 3 here (a 3-frame sound assert) during
// the intro, and sub_00e0 decrements it 3->2->1->0 over three full-path frames. It
// is a work-RAM output in the compared state dump, written on the loop's non-zero
// branch, so a corrupted decrement persists and diffs -- the whole-machine TEETH.
const BROKEN_ADDR = 0x6083;

/** Behaviourally optimized sub_00e0 EXCEPT the first store to 0x6083 lands a wrong value. */
function broken_00e0(m) {
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
    return optimized_00e0(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- pristine full-path entry capture (for the isolated branch / cycle / trace checks) --

/** Capture the machine the instant sub_00e0 is FIRST entered with ATTRACT==0 (the
 *  full path). The guard-path (attract) entries are skipped -- they run before this. */
function captureFullPathEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null && mm.mem.read8(0x6007) === 0) entry = mm.clone();
    return translated_00e0(mm);
  }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("sub_00e0 full path (ATTRACT==0) never entered within the run window");
  return entry;
}

const ENTRY = ROM_PRESENT ? captureFullPathEntry() : null;

/** Clone the full-path entry and poke the deciding RAM to select a branch. */
function cloneWith(pokes) {
  const c = ENTRY.clone();
  for (const [addr, val] of pokes) c.mem.write8(addr, val);
  return c;
}

/** Run oracle vs optimized on identical poked clones; return the RAM/reg/pc diffs + both cycle totals. */
function diffBranch(pokes = []) {
  const a = cloneWith(pokes);
  const b = cloneWith(pokes);
  const a0 = a.cycles, b0 = b.cycles;
  translated_00e0(a);
  optimized_00e0(b);
  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.regs, b.regs),
    pc: a.pc === b.pc ? null : { a: a.pc, b: b.pc },
    tcyc: a.cycles - a0,
    ocyc: b.cycles - b0,
  };
}

/** Hardware write-trace (rel to entry) for `fn` run on a fresh poked clone. */
function traceClone(fn, pokes = []) {
  const c = cloneWith(pokes);
  c.mem.writeTrace = []; // clock is () => c.cycles, wired at construction
  const c0 = c.cycles;
  fn(c);
  return c.mem.writeTrace.map((w) => ({ rel: w.cycle - c0, addr: w.addr, value: w.value }));
}

// The branch table: [name, pokes]. The natural all-zero entry already covers the
// zero-shadow loop + both tail-Z arms; the pokes reach the arms the run does not.
const ALL_TRIGGERS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [0x6080 + i, 3]);
const BRANCHES = [
  ["loop all-zero + tail BGM + IRQ clear (natural)", []],
  ["loop one non-zero shadow (0x6083)", [[0x6083, 3]]],
  ["loop all non-zero shadows", ALL_TRIGGERS],
  ["tail-1 priority tune (0x608B!=0)", [[0x608b, 3], [0x608a, 0x0f]]],
  ["tail-2 IRQ set (0x6088!=0)", [[0x6088, 3]]],
  ["all non-zero arms at once", [...ALL_TRIGGERS, [0x608b, 3], [0x608a, 0x0f], [0x6088, 3]]],
  ["guard: ATTRACT!=0 -> early return", [[0x6007, 1]]],
];

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_00e0 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_00e0]]));

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
    `  EQUAL/whole: ${r.framesCompared} frames identical, override fired ${r.invocations.get(TARGET)}x ` +
      "(guard path in attract + full path in game)",
  );
});

test("EQUAL (unit): standard unit gate matches translated in RAM + registers", () => {
  // The standard unit gate captures the FIRST invocation -- at boot, ATTRACT!=0, so
  // this proves the guard/early-return branch (SP, pc and F after the `ret nz`). The
  // full-path branches are proven by BRANCH COVERAGE below.
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_00e0, optimized_00e0, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical (guard branch)");
});

// -- FULL BRANCH COVERAGE + CYCLE TOTALS --------------------------------------

test("BRANCH COVERAGE: every data-dependent branch is EQUAL and preserves its cycle total", () => {
  for (const [name, pokes] of BRANCHES) {
    const r = diffBranch(pokes);
    assert.equal(r.ram, null, `${name}: RAM diff at 0x${r.ram?.addr?.toString(16)} (t ${r.ram?.a} vs o ${r.ram?.b})`);
    assert.equal(r.regs, null, `${name}: reg diff at ${r.regs?.reg} (t ${r.regs?.a} vs o ${r.regs?.b})`);
    assert.equal(r.pc, null, `${name}: pc diff (t ${r.pc?.a?.toString(16)} vs o ${r.pc?.b?.toString(16)})`);
    // Each branch is a COLLAPSED total; pin it to the oracle so a wrong collapsed sum has teeth.
    assert.equal(r.ocyc, r.tcyc, `${name}: cycle total drifted (optimized ${r.ocyc} vs oracle ${r.tcyc})`);
    console.log(`  BRANCH ok: ${name} -- EQUAL, total ${r.ocyc}t == oracle`);
  }
});

test("CYCLE TEETH: a wrong collapsed total is CAUGHT", () => {
  // Shave one cycle off the loop's post-write charge; the totals must then disagree,
  // proving the per-branch cycle assertions above are not vacuous.
  const a = cloneWith([]);
  const b = cloneWith([]);
  const a0 = a.cycles, b0 = b.cycles;
  translated_00e0(a);
  const realStep = b.step.bind(b);
  b.step = (addr, cyc) => realStep(addr, addr === 0x00ed ? cyc - 1 : cyc);
  try { optimized_00e0(b); } finally { b.step = realStep; }
  assert.notEqual(b.cycles - b0, a.cycles - a0, "cycle-total assertion has no teeth");
  console.log(`  CYCLE TEETH: wrong total ${b.cycles - b0}t caught vs oracle ${a.cycles - a0}t`);
});

// -- WRITE-TRACE (the hardware-write bus cycle the RAM gate cannot see) --------

test("WRITE-TRACE: the ten hardware writes land at the oracle's exact bus cycle", () => {
  // All-zero arms: eight ls259 bits = 0, tune latch = SND_BGM, IRQ line = 0.
  const zeroPokes = [...ALL_TRIGGERS.map(([a]) => [a, 0]), [0x608b, 0], [0x6088, 0]];
  const oracleZ = traceClone(translated_00e0, zeroPokes);
  const optZ = traceClone(optimized_00e0, zeroPokes);

  assert.equal(oracleZ.length, 10, "full path must make exactly ten hardware writes");
  assert.deepEqual(
    oracleZ.map((w) => w.addr),
    [0x7d00, 0x7d01, 0x7d02, 0x7d03, 0x7d04, 0x7d05, 0x7d06, 0x7d07, 0x7c00, 0x7d80],
    "hardware-write addresses/order are not the expected latch sweep + tune + IRQ",
  );
  assert.deepEqual(optZ, oracleZ, "optimized hardware-write bus cycles differ from the oracle (all-zero arms)");

  // Non-zero arms: bits driven to 1 (+ shadow decrements), priority tune, IRQ line 1.
  const nzPokes = [...ALL_TRIGGERS, [0x608b, 3], [0x608a, 0x0f], [0x6088, 3]];
  const oracleNZ = traceClone(translated_00e0, nzPokes);
  const optNZ = traceClone(optimized_00e0, nzPokes);
  assert.deepEqual(optNZ, oracleNZ, "optimized hardware-write bus cycles differ from the oracle (non-zero arms)");
  // Sanity: the non-zero arms really do drive different values than the all-zero arms.
  assert.ok(oracleNZ.some((w) => w.addr === 0x7d00 && w.value === 1), "non-zero shadow should assert its latch bit");

  // Teeth: a FULLY-collapsed prologue+loop (all charges lumped AFTER the writes) shifts
  // every write to a low cycle -- proving the partial collapse is what preserves the trace.
  const flat = traceClone((m) => {
    const { regs, mem } = m;
    regs.hl = 0x6080; regs.de = 0x7d00;
    regs.a = mem.read8(0x6007); regs.and(regs.a); // attract==0 on this clone
    regs.b = 0x08;
    do {
      const s = mem.read8(regs.hl);
      if (s !== 0) mem.write8(regs.hl, regs.dec8(s));
      regs.a = s !== 0 ? 1 : 0;
      mem.write8(regs.de, regs.a, 4); // no cycle charged before it -> lands early
      regs.e = (regs.e + 1) & 0xff; regs.l = (regs.l + 1) & 0xff;
      regs.b = (regs.b - 1) & 0xff;
    } while (regs.b !== 0);
    regs.a = mem.read8(0x6089);
    mem.write8(0x7c00, regs.a, 10);
    regs.a = 0;
    mem.write8(0x7d80, regs.a, 10);
    m.step(0x011b, 559); // whole routine cost in one lump, after the writes
    m.ret();
  }, zeroPokes);
  assert.notDeepEqual(flat, oracleZ, "write-trace check has no teeth");
  console.log(
    `  WRITE-TRACE: 10 writes @ [${oracleZ.map((w) => "+" + w.rel).join(",")}] identical to oracle; flat variant caught`,
  );
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong sound-trigger store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_00e0]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong sound-trigger store is CAUGHT and names 0x6083", () => {
  // Synthesised full-path unit teeth: on an entry whose 0x6083 is non-zero (so the
  // loop takes the decrement branch), corrupting that store must diff at 0x6083.
  const a = cloneWith([[0x6083, 3]]);
  const b = cloneWith([[0x6083, 3]]);
  translated_00e0(a);
  broken_00e0(b);
  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.ok(ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${ram.addr.toString(16)}`,
  );
  console.log(`  TEETH/unit: caught at 0x${ram.addr.toString(16)} (translated ${ram.a} vs broken ${ram.b})`);
});
