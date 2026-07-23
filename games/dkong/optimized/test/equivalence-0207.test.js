// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_0207 ("decode the DIP switches", ROM
 * 0x0207-0x0265). sub_0207 is a LEAF, reached ONLY via `m.call(0x0207)` from
 * handler_01c3 / sub_01c3 (game-state-0 power-on init), which runs inside the
 * NMI dispatch with the mask cleared -- so it is ATOMIC on its only call path
 * and its per-instruction cycle charges collapse to one per straight-line
 * segment + one per branch arm, preserving each path's TOTAL.
 *
 * Jobs:
 *
 *   1. EQUAL -- the idiomatic optimized sub_0207 reads EQUAL against its
 *      translated oracle, whole-machine and unit. Because sub_0207 is only ever
 *      m.call'd (never a dispatch target), the override reaches it through the
 *      construction-time registry the harness installs.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous.
 *      sub_0207 runs EXACTLY ONCE from boot (power-on init), so a short window
 *      still reaches it; we assert invocations >= 1.
 *
 *   3. TEETH -- a deliberately-broken twin (the DIP_LIVES store lands a wrong
 *      value) must be CAUGHT: NOT-EQUAL, naming the diverging address 0x6020.
 *
 *   4. FULL BRANCH COVERAGE -- the routine's branches are driven ENTIRELY by the
 *      DSW0 byte it reads from port 0x7D80, and the natural boot run only ever
 *      sees the default DSW0=0x80 (bonus jp-z / coinage jp-z / upright jp-c). So
 *      every OTHER arm is synthesised: clone the captured entry, poke the DSW0
 *      input, run oracle vs optimized, and diff RAM + all registers + pc. Because
 *      those arms' cycle charges are COLLAPSED and are NOT exercised by the
 *      whole-machine run, each synthesised arm ALSO asserts its measured cycle
 *      total equals the oracle's -- teeth on the collapse for every branch.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_0207 as translated_0207 } from "../../translated/state0.js";
import { sub_0207 as optimized_0207 } from "../sub_0207.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, firstRegDiff } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0207;
const FRAMES = 30; // sub_0207 fires exactly once, at power-on init (game state 0)

// The routine's first output store, DIP_LIVES (0x6020) — written only by
// sub_0207 (from DSW0) and read-only afterward, so a wrong value persists in
// the state trace rather than being healed by a later writer.
const BROKEN_ADDR = 0x6020;

/**
 * Deliberately-broken twin: the optimized handler EXCEPT the first store to
 * 0x6020 lands a wrong value (correct XOR 0xFF, guaranteed to differ). The rest
 * of the routine (and its ldir) runs verbatim — the representative "wrong value
 * to one of the routine's own outputs" bug the gate must catch.
 */
function broken_0207(m) {
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
    return optimized_0207(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_0207 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_0207]]));

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

test("EQUAL (unit): idiomatic optimized sub_0207 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0207, optimized_0207);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong DIP_LIVES store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_0207]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong DIP_LIVES store is CAUGHT and names 0x6020", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0207, broken_0207);

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

// -- FULL BRANCH COVERAGE -----------------------------------------------------

/**
 * Capture the pristine machine state at the first m.call(0x0207) (the power-on
 * init), the same way unitEquivalence does — but return the entry clone so every
 * branch can be synthesised from it by poking a different DSW0 input.
 */
function captureEntry() {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0207(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(240);
  if (entry === null) throw new Error("sub_0207 never entered within 240 frames");
  return entry;
}

/** Run `fn` on a fresh clone of `entry` with DSW0 forced to `dsw0`; return the
 *  resulting state dump, register file, pc and the T-states the routine spent. */
function runWithDsw0(entry, dsw0, fn) {
  const c = entry.clone();
  c.io.inputs._dsw0 = dsw0; // the byte mem.read8(0x7D80) will return
  const before = c.cycles;
  fn(c);
  return { state: c.dumpState(), regs: c.regs, pc: c.pc, cycles: c.cycles - before, m: c };
}

// Each DSW0 selects one arm of each of the three decision points. The last
// column is the branch-arm cycle DELTA vs the default (0x80) path — the sum of
// the arm charges (bonus + coinage + upright) minus the default's 30 — which the
// oracle's own default+delta total must match (an independent check on the
// collapsed segment arithmetic, anchored on the measured default absolute).
//   bonus arms:   jp-z 10 | loop 24N+12 (N = bits 2-3)
//   coinage arms: jp-z 10 | jp-c 43 | else 42
//   upright arms: jp-c 10 | else 14
const BRANCHES = [
  { dsw0: 0x80, label: "default: bonus jp-z, coinage jp-z, upright jp-c", delta: 0 },
  { dsw0: 0x00, label: "upright ELSE arm (bit7=0)", delta: 4 }, // up else 14 vs 10
  { dsw0: 0x04, label: "bonus BCD loop x1 (bits2-3=1)", delta: 30 }, // bonus 36 vs10, up else +4
  { dsw0: 0x08, label: "bonus BCD loop x2 (bits2-3=2)", delta: 54 }, // bonus 60 vs10, up else +4
  { dsw0: 0x0c, label: "bonus BCD loop x3 (bits2-3=3)", delta: 78 }, // bonus 84 vs10, up else +4
  { dsw0: 0x10, label: "coinage jp-c arm (bit4=1)", delta: 37 }, // coin 43 vs10, up else +4
  { dsw0: 0x20, label: "coinage ELSE arm (bit5=1,bit4=0)", delta: 36 }, // coin 42 vs10, up else +4
  { dsw0: 0xff, label: "all set: loop x3 + coinage jp-c + upright jp-c", delta: 107 },
];

test("FULL BRANCH COVERAGE: every DSW0-driven arm is EQUAL (RAM + regs + pc) with matching cycle total", () => {
  const entry = captureEntry();

  // Anchor the cycle cross-check on the measured default-path total.
  const defaultTotal = runWithDsw0(entry, 0x80, translated_0207).cycles;

  for (const { dsw0, label, delta } of BRANCHES) {
    const ora = runWithDsw0(entry, dsw0, translated_0207);
    const opt = runWithDsw0(entry, dsw0, optimized_0207);

    const ram = firstStateDiff(ora.state, opt.state, (off) => ora.m.stateOffsetToAddr(off));
    assert.equal(
      ram,
      null,
      ram ? `DSW0=0x${dsw0.toString(16)} (${label}): RAM diff at 0x${(ram.addr ?? 0).toString(16)} ` +
        `(oracle ${ram.a} vs optimized ${ram.b})` : "",
    );

    const reg = firstRegDiff(ora.regs, opt.regs);
    assert.equal(
      reg,
      null,
      reg ? `DSW0=0x${dsw0.toString(16)} (${label}): reg diff at ${reg.reg} ` +
        `(oracle 0x${reg.a.toString(16)} vs optimized 0x${reg.b.toString(16)})` : "",
    );

    assert.equal(
      ora.pc,
      opt.pc,
      `DSW0=0x${dsw0.toString(16)} (${label}): pc diff (oracle 0x${ora.pc.toString(16)} vs optimized 0x${opt.pc.toString(16)})`,
    );

    // Teeth on the collapse: the optimized branch's TOTAL must equal the oracle's.
    assert.equal(
      opt.cycles,
      ora.cycles,
      `DSW0=0x${dsw0.toString(16)} (${label}): cycle total ${opt.cycles} != oracle ${ora.cycles}`,
    );

    // Cross-check the oracle's own arm total against the collapsed segment math.
    assert.equal(
      ora.cycles,
      defaultTotal + delta,
      `DSW0=0x${dsw0.toString(16)} (${label}): oracle total ${ora.cycles} != default ${defaultTotal} + arm-delta ${delta}`,
    );
  }
  console.log(
    `  BRANCHES: ${BRANCHES.length} DSW0 arms EQUAL (RAM+regs+pc) with matching cycle totals ` +
      `(default path ${defaultTotal} t)`,
  );
});

// -- TEETH on the collapse ----------------------------------------------------

test("TEETH (cycle collapse): a wrong branch-arm total is CAUGHT on a synthesised arm", () => {
  const entry = captureEntry();

  // A twin whose bonus BCD-loop arm charges the WRONG total (off by one iter's
  // worth), reached via DSW0 bits 2-3 = 3. If the synthesised-branch cycle check
  // had no teeth, this would slip through.
  function miscollapsed_0207(m) {
    const { regs, mem } = m;
    const dsw0 = mem.read8(0x7d80);
    regs.a = dsw0; regs.and(0x03); regs.add(0x03);
    mem.write8(0x6020, regs.a); m.step(0x0214, 54);
    regs.a = dsw0; regs.rrca(); regs.rrca(); regs.and(0x03);
    const bonusSel = regs.a; regs.b = bonusSel; regs.a = 0x07; m.step(0x021c, 30);
    if (bonusSel === 0) {
      m.step(0x0226, 10);
    } else {
      regs.a = 0x05;
      do { regs.add(0x05); regs.daa(); regs.djnz(); } while (regs.b !== 0);
      m.step(0x0226, 24 * bonusSel + 12 + 24); // WRONG: one extra iteration charged
    }
    mem.write8(0x6021, regs.a);
    regs.a = dsw0; regs.bc = 0x0101; regs.de = 0x0102; regs.and(0x70);
    regs.rla(); regs.rla(); regs.rla(); regs.rla(); m.step(0x0235, 60);
    if (regs.fZ) { m.step(0x0247, 10); }
    else if (regs.fC) {
      regs.add(0x02); regs.b = regs.a; regs.d = regs.a; regs.add(regs.a); regs.e = regs.a; m.step(0x0247, 43);
    } else {
      regs.a = regs.inc8(regs.a); regs.c = regs.a; regs.e = regs.d; m.step(0x0247, 42);
    }
    mem.write8(0x6022, regs.d); mem.write8(0x6023, regs.e);
    mem.write8(0x6024, regs.b); mem.write8(0x6025, regs.c); m.step(0x024f, 52);
    regs.a = mem.read8(0x7d80); regs.rlca(); regs.a = 0x01; m.step(0x0255, 24);
    if (regs.fC) { m.step(0x0259, 10); } else { regs.a = regs.dec8(regs.a); m.step(0x0259, 14); }
    mem.write8(0x6026, regs.a);
    regs.hl = 0x3565; regs.de = 0x6100; regs.bc = 0x00aa; m.step(0x0263, 37);
    m.ldirAt(0x0263, 0x0265); m.ret();
  }

  const ora = runWithDsw0(entry, 0x0c, translated_0207);
  const bad = runWithDsw0(entry, 0x0c, miscollapsed_0207);
  // Same RAM/regs (the miscollapse only mis-charges cycles), but the total diverges.
  assert.equal(firstStateDiff(ora.state, bad.state), null, "control: RAM must still match");
  assert.notEqual(
    bad.cycles,
    ora.cycles,
    "cycle-collapse teeth FAILED: a wrong branch total was not caught",
  );
  console.log(
    `  TEETH/cycles: wrong bonus-loop total caught (oracle ${ora.cycles} t vs miscollapsed ${bad.cycles} t)`,
  );
});
