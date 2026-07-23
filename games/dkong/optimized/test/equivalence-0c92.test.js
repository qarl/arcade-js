// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_0c92 (BOARD BUILDER: clear the playfield, arm
 * the palette bank + opening task, then a `dec a / jp z` cascade on BOARD into the
 * four per-board setup arms). ROM 0x0C92-0x0CC5 + the inline 100m-rivet fall-through.
 * Reached ONLY from inside the vblank NMI (dispatchGameState): handler_0763 tail-
 * jumps here in attract (always BOARD=1), and loc_0c91 falls through here in-game
 * (BOARD = the real 1..4). So loc_0c92 is ATOMIC on every call path.
 *
 * Jobs:
 *   1. EQUAL (whole + unit) -- the idiomatic optimized loc_0c92 reads EQUAL against
 *      its translated oracle in RAM and the full register file (+ pc). In plain
 *      attract handler_0763 tail-jumps here at frame 518 (BOARD=1), so the natural
 *      run exercises the 25m arm end-to-end (through the deep board build).
 *   2. FULL BRANCH COVERAGE + CYCLE TOTAL + ROUTING -- all four BOARD arms
 *      (1=25m/2=50m/3=75m/4=100m) are proven EQUAL by SYNTHESIS: clone the captured
 *      entry, poke BOARD, run oracle vs optimized, and diff RAM+regs+pc at the shared
 *      tail loc_0cc6 (each arm converges there). Because the cascade cycles are
 *      COLLAPSED per branch, each arm ALSO asserts its cycle TOTAL equals the oracle's,
 *      and the arm's live-out (DE layout ptr + SND_BGM tune) is the expected one --
 *      so a mis-routed cascade is caught. (The 25m arm's DEEP build is additionally
 *      proven by the natural whole/unit EQUAL above.)
 *   3. WRITE-TRACE -- loc_0c92 makes its OWN hardware writes (palette-bank latches
 *      0x7D86/0x7D87, + 0x7D86 again on the rivet arm). The RAM+regs gate can't see
 *      the emit.js --writes trace's bus-cycle column, so this proves each latch write
 *      lands at the oracle's exact write-bus cycle -- and that a fully-collapsed
 *      prologue would shift them (teeth).
 *   4. TEETH (whole + unit) -- a deliberately-wrong output store (0x638C) is CAUGHT,
 *      naming the diverging address.
 *
 * CYCLE FINDING (see optimized/loc_0c92.js for the full decision): loc_0c92 runs
 * INSIDE the vblank NMI on BOTH its call paths (handler_0763, loc_0c91 -- the only
 * two m.call(0x0c92) sites, both dispatchGameState), so no NMI can fire inside it or
 * its callees -- it is ATOMIC. Its per-instruction charges COLLAPSE to one total per
 * branch (25m 27t / 50m 41t / 75m 55t cascade; rivet 72t to the call), PARTIAL across
 * the palette-bank hardware writes so their bus cycles are preserved (WRITE-TRACE).
 * The total stays load-bearing (it feeds the spin count, README §2), which the
 * whole-machine EQUAL over 560 frames + the per-branch cycle-total teeth confirm.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0c92 as translated_0c92 } from "../../translated/nmi.js";
import { loc_0c92 as optimized_0c92 } from "../loc_0c92.js";
import { Machine } from "../../machine.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";
import { firstStateDiff, firstRegDiff } from "../../../../core/equivalence.js";
import { BOARD, SND_BGM } from "../ram.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0c92;
const FRAMES = 560; // handler_0763 tail-jumps loc_0c92 at frame 518 (BOARD=1); + margin

// loc_0c92's own dump-visible output store the teeth corrupt: 0x638C (engine
// scratch, loc_0c92 sets it 0 at ROM 0x0C96). It is the representative "wrong value
// to one of the routine's own output addresses" bug the gate must catch. (The
// palette writes are IO latches, not in the RAM dump; SND_BGM lives on the rivet
// arm only.) CAVEAT: the DEEP board build BELOW loc_0cc6 rewrites 0x638C once more
// (ROM 0x0F68), so a corruption HEALS if the full chain runs to completion in
// isolation. So the whole-machine teeth catches it via the live run (the corruption
// perturbs the divergent trace, caught at frame 518), and the unit teeth isolates
// loc_0c92's OWN store by short-circuiting at loc_0cc6 -- BEFORE that deep rewrite --
// which is the honest "unit" boundary for this routine (the deep build is a
// SEPARATE oracle routine, loc_0cc6, reached identically on both sides).
const BROKEN_ADDR = 0x638c;

// The shared tail every per-board arm converges on. Short-circuiting it isolates
// loc_0c92 + the taken arm (all HW writes, DE/SND_BGM live-out) from the deep board
// build below it -- the deep build is oracle-identical on both sides anyway.
const SHARED_TAIL = 0x0cc6;

// Per-board arm expectations at the loc_0cc6 boundary: DE = layout-table ptr, SND_BGM
// = tune index. A mis-routed cascade would land the wrong pair here.
const ARMS = [
  { board: 1, name: "25m girders", de: 0x3ae4, bgm: 0x08 },
  { board: 2, name: "50m conveyor", de: 0x3b5d, bgm: 0x09 },
  { board: 3, name: "75m elevator", de: 0x3be5, bgm: 0x0a },
  { board: 4, name: "100m rivet", de: 0x3c8b, bgm: 0x0b },
];

/** Deliberately-broken twin: optimized_0c92 EXCEPT the first store to 0x638C lands
 *  a wrong value (correct XOR 0xFF, guaranteed to differ). */
function broken_0c92(m) {
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
    return optimized_0c92(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- pristine-entry capture (for the isolated branch / cycle / trace checks) --

/** Capture the machine the instant loc_0c92 is FIRST entered (attract frame 518). */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0c92(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("loc_0c92 never entered within the run window");
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/**
 * Run `fn` on a fresh clone of the entry with BOARD poked to `board`, short-
 * circuiting the shared tail loc_0cc6 so the deep board build is not run. Records
 * the cycle total, the hardware write-trace (relative to entry), and the arm's
 * live-out (DE + SND_BGM) captured at the loc_0cc6 boundary.
 */
function runArm(fn, board) {
  const c = ENTRY.clone();
  c.mem.write8(BOARD, board);
  c.mem.writeTrace = []; // clock is () => c.cycles from the constructor
  const c0 = c.cycles;
  const realCall = c.call.bind(c);
  let live = null;
  c.call = (addr, ...args) => {
    if (live === null && addr === SHARED_TAIL) {
      live = { cycles: c.cycles - c0, de: c.regs.de, bgm: c.mem.read8(SND_BGM) };
      return; // stop before the deep build; the arm has fully run
    }
    return realCall(addr, ...args);
  };
  fn(c);
  const trace = c.mem.writeTrace.map((w) => ({ rel: w.cycle - c0, addr: w.addr, value: w.value }));
  return { m: c, total: c.cycles - c0, trace, live };
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_0c92 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_0c92]]));

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
      `override fired ${r.invocations.get(TARGET)}x (25m board build at frame 518)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_0c92 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0c92, optimized_0c92, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical (25m arm, full build)");
});

// -- FULL BRANCH COVERAGE + CYCLE TOTAL + ROUTING -----------------------------

test("BRANCH COVERAGE: all four BOARD arms are EQUAL, correctly routed, cycle-total preserved", () => {
  for (const arm of ARMS) {
    const a = runArm(translated_0c92, arm.board);
    const b = runArm(optimized_0c92, arm.board);

    // Optimized == oracle at the shared-tail boundary: RAM + registers + pc.
    const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
    assert.equal(ram, null, ram ? `board ${arm.board}: RAM diff at 0x${ram.addr.toString(16)} (t ${ram.a} vs o ${ram.b})` : "");
    const regs = firstRegDiff(a.m.regs, b.m.regs);
    assert.equal(regs, null, regs ? `board ${arm.board}: reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
    assert.equal(a.m.pc, b.m.pc, `board ${arm.board}: pc must match`);

    // Collapsed cascade -> assert the branch cycle TOTAL equals the oracle's.
    assert.equal(b.total, a.total, `board ${arm.board}: cycle total drifted (optimized ${b.total} vs oracle ${a.total})`);

    // Routing: the optimized side reached loc_0cc6 with the EXPECTED arm live-out.
    assert.ok(a.live && b.live, `board ${arm.board}: shared tail loc_0cc6 was not reached`);
    assert.equal(b.live.de, arm.de, `board ${arm.board}: DE (layout ptr) mis-routed`);
    assert.equal(b.live.bgm, arm.bgm, `board ${arm.board}: SND_BGM (tune) mis-routed`);

    // Hardware write-trace equal per arm (palette latches at the oracle's bus cycles).
    assert.deepEqual(b.trace, a.trace, `board ${arm.board}: hardware write-trace differs from oracle`);
    console.log(
      `  BRANCH board ${arm.board} (${arm.name}): EQUAL, total ${b.total}t == oracle, ` +
        `DE=0x${arm.de.toString(16)} SND_BGM=0x${arm.bgm.toString(16)}, ${b.trace.length} HW writes`,
    );
  }

  // Cycle-total teeth (not vacuous): a 1-cycle error in the 25m cascade collapse
  // makes the totals disagree.
  const good = runArm(optimized_0c92, 1).total;
  const wrongRun = (() => {
    const c = ENTRY.clone();
    c.mem.write8(BOARD, 1);
    const c0 = c.cycles;
    const realCall = c.call.bind(c);
    c.call = (addr, ...a) => (addr === SHARED_TAIL ? undefined : realCall(addr, ...a));
    const realStep = c.step.bind(c);
    c.step = (addr, cyc) => realStep(addr, addr === 0x0cd4 ? cyc - 1 : cyc);
    optimized_0c92(c);
    return c.cycles - c0;
  })();
  assert.notEqual(wrongRun, good, "cycle-total assertion has no teeth");
  console.log(`  CYCLE teeth: a wrong 25m cascade total (${wrongRun}t) is caught vs the correct ${good}t`);
});

// -- WRITE-TRACE (the hardware-write bus cycle the RAM gate cannot see) --------

test("WRITE-TRACE: the palette-bank writes land at the oracle's exact bus cycle", () => {
  const oracleTrace = runArm(translated_0c92, 1).trace;
  const optTrace = runArm(optimized_0c92, 1).trace;

  // The 25m arm's own hardware writes: the two prologue palette latches (LO<-0,
  // HI<-1). (0x0874/0x309f/loc_0cd4 write only work/sprite/video RAM.)
  const palette = oracleTrace.filter((w) => w.addr === 0x7d86 || w.addr === 0x7d87);
  assert.deepEqual(
    palette.map((w) => ({ addr: w.addr, value: w.value })),
    [{ addr: 0x7d86, value: 0 }, { addr: 0x7d87, value: 1 }],
    "oracle palette-write trace is not the expected LO<-0, HI<-1",
  );
  assert.deepEqual(optTrace, oracleTrace, "optimized palette-write bus cycles differ from the oracle");

  // Teeth: a FULLY-collapsed prologue (both palette writes emitted BEFORE the lump
  // charge) shifts both writes' bus cycle -- proving the partial collapse is load-bearing.
  const flatTrace = (() => {
    const c = ENTRY.clone();
    c.mem.write8(BOARD, 1);
    c.mem.writeTrace = [];
    const c0 = c.cycles;
    const realCall = c.call.bind(c);
    c.call = (addr, ...a) => (addr === SHARED_TAIL ? undefined : realCall(addr, ...a));
    const { regs, mem } = c;
    c.push16(0x0c95); c.step(0x0874, 17); c.call(0x0874);
    regs.xor(regs.a); mem.write8(0x638c, regs.a); regs.de = 0x0501; c.step(0x0c9c, 27);
    c.push16(0x0c9f); c.step(0x309f, 17); c.call(0x309f);
    regs.hl = 0x7d86; mem.write8(regs.hl, 0x00, 7); // both writes emitted up front...
    regs.hl = 0x7d87; mem.write8(regs.hl, 0x01, 7);
    c.step(0x0ca7, 36); // ...then one lump (10+16+10) -- shifts both bus cycles
    regs.a = mem.read8(BOARD); regs.a = regs.dec8(regs.a);
    c.step(0x0cd4, 27); c.call(0x0cd4);
    return c.mem.writeTrace.map((w) => ({ rel: w.cycle - c0, addr: w.addr, value: w.value }));
  })();
  assert.notDeepEqual(flatTrace, oracleTrace, "write-trace check has no teeth");
  const rels = optTrace.filter((w) => w.addr === 0x7d86 || w.addr === 0x7d87).map((w) => w.rel);
  console.log(`  WRITE-TRACE: palette writes @ +${rels.join("t/+")}t identical to oracle; flat-prologue variant caught`);
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong 0x638C store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_0c92]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong 0x638C store is CAUGHT and names 0x638C", () => {
  // Isolate loc_0c92's OWN store: short-circuit the shared tail loc_0cc6 (BEFORE the
  // deep build's second 0x638C write at ROM 0x0F68 could heal it), then diff the
  // oracle run against the broken twin. Both are run identically to the point the
  // corrupted store is loc_0c92's last word on 0x638C.
  const a = runArm(translated_0c92, 1);
  const b = runArm(broken_0c92, 1);
  const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));

  assert.ok(ram != null, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(
    ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${ram.addr.toString(16)} ` +
      `(translated ${ram.a} vs broken ${ram.b}) [isolated at loc_0cc6]`,
  );
});
