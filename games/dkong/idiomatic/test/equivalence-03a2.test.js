// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for animateFixedHazardAndReleaseFire (ROM 0x03A2) — the three-deep-gated periodic event
 * servicer (rst 0x30 board gate, rst 0x10 alive gate, a bit gate + two down-counters,
 * two sprite arms).
 *
 * sub_03a2 is CALLED EVERY main-loop pass (mainLoop_02bd `call 0x03a2`) and it dispatches
 * loc_03f2 many times per attract, so it runs constantly — but attract only ever exercises
 * a slice of its arms. The oracle `m.call`s three routines (0x0030, 0x0010, 0x03f2) with
 * `push16` brackets and threads its own multi-way `ret`s; animateFixedHazardAndReleaseFire DIRECT-calls the three
 * idiomatic callees (each memory-equivalent to its oracle) and models no stack. Both sides
 * therefore reach identical work RAM, and the ONLY residual difference is the dead
 * STACK_SCRATCH the oracle's push16/ret churn writes — excluded by the memory-equivalence
 * contract (mirrors equivalence-0350.test.js).
 *
 * THE STACK NETS UNIFORMLY. Every exit path of the oracle nets exactly ONE caller-return
 * pop (SP -> entry+2, pc -> the popped return): the two rst gates skip via the callee's
 * double-pop, the three early `ret`s pop directly, and both arm tails `ret`. So the
 * candidate is run then given ONE m.ret() to line pc + SP up with the oracle — the same
 * shim equivalence-0350.test.js uses.
 *
 *   0. REACHABILITY — 0x03a2 is dispatched during boot/attract.
 *   1. EQUAL (captured) — hook 0x03a2 in a real attract run, clone at each dispatch, and
 *      confirm animateFixedHazardAndReleaseFire == oracle (RAM − the stack scratch below the entry SP, pc, SP) on every real state.
 *   2. EQUAL (crafted) — poke the gates/counters identically on both sides to drive every
 *      path: the three gate-closed skips (board, alive, event-bit), the prescaler ret-nz,
 *      the phase-bit0 ret-nc, arm A (bit1 clear), arm B ret-nz, and arm B full (the
 *      re-arm), each with the spin bit both ways so loc_03f2's ±1 jitter is covered, and
 *      the board gate opened on BOTH 25m and 50m.
 *   3. TEETH — two broken twins, each MUST be caught:
 *      (a) drops the prescaler reload-to-4 — caught at 0x62B8 on a body case.
 *      (b) stamps arm A's flag +0x0A as 0x02 (the arm-B value) — caught at 0x66AA.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-03a2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_03a2 as oracle } from "../../translated/loc_03a2.js";
import { animateFixedHazardAndReleaseFire } from "../animateFixedHazardAndReleaseFire.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, BOARD, MARIO_ACTIVE, SPIN_COUNT } from "../names.js";
// The teeth twins reuse the real callees (their faithfulness is proven by their own gates,
// not under test here) so only the sub_03a2-level logic error is what diverges.
import { boardBitGate as boardBitGateRef } from "../boardBitGate.js";
import { marioActiveGuard as marioActiveGuardRef } from "../marioActiveGuard.js";
import { loc_03f2 as loc_03f2Ref } from "../loc_03f2.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x03a2;
const RET_ADDR = 0x02e1; // the main-loop site right after `call 0x03a2` (02de, 3 bytes)

// Cells animateFixedHazardAndReleaseFire touches directly — all examined-and-UNNAMED in names.js, so kept hex here.
const EVENT_GATE = 0x6350;   // bit0 SET -> skip
const PRESCALER = 0x62b8;    // 4-frame prescaler
const PHASE_BITS = 0x62b9;   // bit0 continue, bit1 arm select
const ARM_COUNTER = 0x62ba;  // bit1-arm down-counter
const OBJ_FLAG9 = 0x66a9;    // 0x66A0 + 0x09
const OBJ_FLAGA = 0x66aa;    // 0x66A0 + 0x0A
const PHASE_MIRROR = 0x63a0; // written 1 with PHASE_BITS on the arm-counter underflow
const SPRITE_DEST = 0x6a29;  // loc_03f2 destination

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// (the memory-equivalence contract is RAM − the stack scratch below the entry SP). { addr, a, b } | null.
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

// All non-stack RAM addresses that changed between two machines (for the no-write /
// exact-write checks on the skip and early-out paths).
function changedAddrs(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const out = [];
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    out.push(addr);
  }
  return out;
}

/** Run the ORACLE on a fresh clone. It performs its own terminal `ret`(s). */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its terminal `ret` with one m.ret() so pc +
 * SP match the oracle's (animateFixedHazardAndReleaseFire replaces the Z80 stack with the JS call stack, so it does
 * not touch pc/SP itself). The oracle nets exactly one caller-return pop on every path.
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Full contract diff: RAM − the stack scratch below the entry SP, pc, SP. Live-out is memory-only. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// A real, self-consistent machine: boot + a stretch of attract so work RAM holds realistic
// values. The specific paths are crafted by poking on top of this.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Stamp a crafted 0x03a2 dispatch onto a clone of the base: a stack with a plausible caller
// return (so the terminal `ret` has a sane target), the three gate inputs, the two counters,
// the spin bit, and sentinels on the written cells so a missing write is visible.
function craft(base, {
  board = 1, alive = 1, gate = 0x00, prescaler = 0x01,
  phase = 0x01, armCounter = 0x10, spin = 0x00,
} = {}) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.mem.write8(BOARD, board);
  m.mem.write8(MARIO_ACTIVE, alive);
  m.mem.write8(EVENT_GATE, gate);
  m.mem.write8(PRESCALER, prescaler);
  m.mem.write8(PHASE_BITS, phase);
  m.mem.write8(ARM_COUNTER, armCounter);
  m.mem.write8(SPIN_COUNT, spin);
  // Sentinels distinct from every value the body writes, so a dropped/mis-targeted store
  // cannot hide behind a coincidentally-equal prior byte.
  m.mem.write8(OBJ_FLAG9, 0x55);
  m.mem.write8(OBJ_FLAGA, 0x55);
  m.mem.write8(SPRITE_DEST, 0xcc);
  m.mem.write8(PHASE_MIRROR, 0x99);
  return m;
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x03a2 is dispatched during boot/attract", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1200);
  assert.ok(count > 0, "0x03a2 should be dispatched — the main loop calls it every pass");
  console.log(`  REACHABILITY: ${count} natural 0x03a2 dispatches in 1200 frames`);
});

// -- 1. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): animateFixedHazardAndReleaseFire == oracle on every real dispatch", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 96) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1500);
  assert.ok(caps.length >= 1, "expected at least one real 0x03a2 dispatch during boot/attract");

  let bodyRuns = 0, skips = 0;
  for (const entry of caps) {
    // The oracle's shallowest push (a callee return) must land inside STACK_SCRATCH, so
    // excluding that region cannot mask a real diff.
    assert.ok(
      (entry.regs.sp - 2) >= STACK_SCRATCH.lo && entry.regs.sp <= STACK_SCRATCH.hi,
      `oracle's push target must sit inside STACK_SCRATCH (SP=${hx(entry.regs.sp)})`,
    );
    const diffs = contractDiffs(entry, animateFixedHazardAndReleaseFire);
    assert.equal(diffs.length, 0, `captured dispatch: ${diffs.join("; ")}`);
    // Classify for reporting: did the body run (any non-stack write) or was it a skip?
    if (changedAddrs(entry, runOracle(entry), entry.regs.sp).length > 0) bodyRuns++; else skips++;
  }
  console.log(`  EQUAL/captured: ${caps.length} real dispatches identical to the oracle (${bodyRuns} body, ${skips} skip)`);
});

// -- 2. EQUAL (crafted, all arms) ---------------------------------------------

test("EQUAL (crafted): every gate/arm path matches the oracle", () => {
  const base = attractBase();

  const cases = [
    // three gate-closed skips -> nothing written at all
    { name: "gate1 board closed (75m)", opts: { board: 3 }, writes: [] },
    { name: "gate2 mario dead", opts: { alive: 0 }, writes: [] },
    { name: "gate3 event-bit set", opts: { gate: 0x01 }, writes: [] },
    // prescaler has not underflowed yet -> only the prescaler is decremented
    { name: "prescaler ret-nz", opts: { prescaler: 0x03 }, writes: [PRESCALER] },
    // prescaler underflows, reloads to 4, but phase bit0 clear -> ret-nc after the reload
    { name: "phase bit0 clear (ret-nc)", opts: { prescaler: 0x01, phase: 0x00 }, writes: [PRESCALER] },
    // arm A (bit1 clear), spin bit clear (loc_03f2 stores byte+1) and set (stores byte)
    { name: "arm A, spin clear", opts: { phase: 0x01, spin: 0x00 }, body: "A" },
    { name: "arm A, spin set", opts: { phase: 0x01, spin: 0x01 }, body: "A" },
    { name: "arm A on 50m (gate open bit1)", opts: { board: 2, phase: 0x01, spin: 0x00 }, body: "A" },
    // arm B (bit1 set), second counter not yet underflowed -> ret-nz
    { name: "arm B ret-nz", opts: { phase: 0x03, armCounter: 0x05, spin: 0x00 }, body: "Bnz" },
    // arm B, second counter underflows -> re-arm PHASE_BITS + PHASE_MIRROR, converge
    { name: "arm B full re-arm, spin clear", opts: { phase: 0x03, armCounter: 0x01, spin: 0x00 }, body: "Bfull" },
    { name: "arm B full re-arm, spin set", opts: { phase: 0x03, armCounter: 0x01, spin: 0x01 }, body: "Bfull" },
  ];

  for (const { name, opts, writes, body } of cases) {
    const entry = craft(base, opts);
    const diffs = contractDiffs(entry, animateFixedHazardAndReleaseFire);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    const after = runOracle(entry);
    if (writes) {
      // Exact non-stack write set — proves the path was genuinely the skip/early-out one.
      assert.deepEqual(changedAddrs(entry, after, entry.regs.sp).sort(), [...writes].sort(),
        `${name}: unexpected non-stack write set`);
    } else {
      // Body ran: the prescaler reloaded to 4 and the +0x09 flag was stamped.
      assert.equal(after.mem.read8(PRESCALER), 0x04, `${name}: prescaler not reloaded to 4`);
      assert.equal(after.mem.read8(OBJ_FLAG9), 0x02, `${name}: flag +0x09 not stamped`);
      if (body === "A") {
        assert.equal(after.mem.read8(OBJ_FLAGA), 0x00, `${name}: arm A flag +0x0A should be 0x00`);
      } else {
        assert.equal(after.mem.read8(OBJ_FLAGA), 0x02, `${name}: arm B flag +0x0A should be 0x02`);
      }
      // loc_03f2 stored to the sprite dest (sentinel 0xcc gone).
      assert.notEqual(after.mem.read8(SPRITE_DEST), 0xcc, `${name}: sprite dest not written`);
      if (body === "Bfull") {
        assert.equal(after.mem.read8(PHASE_BITS), 0x01, `${name}: PHASE_BITS not re-armed`);
        assert.equal(after.mem.read8(PHASE_MIRROR), 0x01, `${name}: PHASE_MIRROR not set`);
        assert.equal(after.mem.read8(ARM_COUNTER), 0x10, `${name}: ARM_COUNTER not reloaded to 0x10`);
      } else if (body === "Bnz") {
        assert.equal(after.mem.read8(ARM_COUNTER), 0x04, `${name}: ARM_COUNTER not decremented to 4`);
      } else { // arm A converges on ARM_COUNTER = 0x10
        assert.equal(after.mem.read8(ARM_COUNTER), 0x10, `${name}: ARM_COUNTER not reloaded to 0x10`);
      }
    }
  }
  console.log(`  EQUAL/crafted: ${cases.length} paths (3 skips, 2 early-outs, arm A x3, arm B nz/full x3) identical`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Twin (a): drops the prescaler reload-to-4. On the underflow path the prescaler is left
 *  at 0 instead of 4 — everything else identical. Caught at 0x62B8. */
function brokenNoReload(m) {
  const { regs, mem } = m;
  regs.a = 0x03;
  if (!boardBitGateRef(m)) return;
  if (!marioActiveGuardRef(m)) return;
  if ((mem.read8(EVENT_GATE) & 0x01) !== 0) return;
  const dec = (mem.read8(PRESCALER) - 1) & 0xff;
  mem.write8(PRESCALER, dec);
  if (dec !== 0) return;
  // BUG: missing mem.write8(PRESCALER, 0x04);
  const phase = mem.read8(PHASE_BITS);
  if ((phase & 0x01) === 0) return;
  if ((phase & 0x02) === 0) {
    mem.write8(OBJ_FLAG9, 0x02); mem.write8(OBJ_FLAGA, 0x00);
    regs.hl = SPRITE_DEST; regs.b = 0x40; loc_03f2Ref(m);
  } else {
    mem.write8(OBJ_FLAG9, 0x02); mem.write8(OBJ_FLAGA, 0x02);
    regs.hl = SPRITE_DEST; regs.b = 0x42; loc_03f2Ref(m);
    const decB = (mem.read8(ARM_COUNTER) - 1) & 0xff;
    mem.write8(ARM_COUNTER, decB);
    if (decB !== 0) return;
    mem.write8(PHASE_BITS, 0x01); mem.write8(PHASE_MIRROR, 0x01);
  }
  mem.write8(ARM_COUNTER, 0x10);
}

/** Twin (b): stamps arm A's flag +0x0A as 0x02 (the arm-B value). Caught at 0x66AA. */
function brokenWrongFlagA(m) {
  const { regs, mem } = m;
  regs.a = 0x03;
  if (!boardBitGateRef(m)) return;
  if (!marioActiveGuardRef(m)) return;
  if ((mem.read8(EVENT_GATE) & 0x01) !== 0) return;
  const dec = (mem.read8(PRESCALER) - 1) & 0xff;
  mem.write8(PRESCALER, dec);
  if (dec !== 0) return;
  mem.write8(PRESCALER, 0x04);
  const phase = mem.read8(PHASE_BITS);
  if ((phase & 0x01) === 0) return;
  if ((phase & 0x02) === 0) {
    mem.write8(OBJ_FLAG9, 0x02);
    mem.write8(OBJ_FLAGA, 0x02); // BUG: arm A should write 0x00
    regs.hl = SPRITE_DEST; regs.b = 0x40; loc_03f2Ref(m);
  } else {
    mem.write8(OBJ_FLAG9, 0x02); mem.write8(OBJ_FLAGA, 0x02);
    regs.hl = SPRITE_DEST; regs.b = 0x42; loc_03f2Ref(m);
    const decB = (mem.read8(ARM_COUNTER) - 1) & 0xff;
    mem.write8(ARM_COUNTER, decB);
    if (decB !== 0) return;
    mem.write8(PHASE_BITS, 0x01); mem.write8(PHASE_MIRROR, 0x01);
  }
  mem.write8(ARM_COUNTER, 0x10);
}

test("TEETH: the dropped-reload twin and the wrong-flag twin are CAUGHT", () => {
  const base = attractBase();

  // (a) dropped reload-to-4 on an arm-A body case — the only divergence is 0x62B8.
  const relo = craft(base, { phase: 0x01, spin: 0x00 });
  const reloDiffs = contractDiffs(relo, brokenNoReload);
  assert.ok(reloDiffs.length > 0, "the dropped-reload twin escaped — the gate is worthless");
  assert.ok(reloDiffs[0].startsWith(`RAM@${hx(PRESCALER)}`),
    `expected the dropped-reload diff at ${hx(PRESCALER)}, got ${reloDiffs[0]}`);

  // (b) wrong arm-A flag +0x0A — the only divergence is 0x66AA.
  const flag = craft(base, { phase: 0x01, spin: 0x00 });
  const flagDiffs = contractDiffs(flag, brokenWrongFlagA);
  assert.ok(flagDiffs.length > 0, "the wrong-flag twin escaped — the gate is worthless");
  assert.ok(flagDiffs[0].startsWith(`RAM@${hx(OBJ_FLAGA)}`),
    `expected the wrong-flag diff at ${hx(OBJ_FLAGA)}, got ${flagDiffs[0]}`);

  console.log(`  TEETH: dropped-reload caught (${reloDiffs[0]}); wrong-flag caught (${flagDiffs[0]})`);
});
