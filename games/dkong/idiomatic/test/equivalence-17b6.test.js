// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for loc_17b6 (ROM 0x17b6) — idx 0 of the 0x6388 render
 * sequence: silence the sound (call 0x011c) and set the priority tune, paint two chained
 * descending colour columns (call 0x0514 x2), render four girder/ladder items (call
 * 0x1826 + 0x0da7 x4), load + X-shift a sprite-object block (call 0x004e + rst 0x38),
 * seed the blink code / sub-state gate / animation stepper, then inc the step counter
 * 0x6388 and repoint SEQ_ADVANCE_PTR (0x63C0) at it.
 *
 * This is the cycle-free / memory-equivalence gate (docs/decompiler-pipeline), not the retired strict
 * whole-machine one. loc_17b6 WRITES RAM (and, via loc_0da7, walks the stack), so every
 * case uses a FRESH clone per side. The oracle runs on one clone, loc_17b6 on the other,
 * and they are compared on the go-forward contract:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP)     [live-out is memory-only]
 *
 * SP/PC are deliberately NOT compared: the oracle threads its calls through push16/step/
 * ret stack + PC bookkeeping, the modelled ABI the direct-call layer replaces with the JS
 * call stack. Nothing downstream consumes a register/flag this arm leaves (the whole
 * 0x6388 sequence is dispatched per-frame for effect and reloads its own registers).
 *
 * STACK SEATING: the idiomatic callee loc_0da7 calls the frozen leaf sub_2ff0, whose
 * `ret` pops without a matching push on the direct-call path — so SP DRIFTS UPWARD
 * (toward 0x6C00) during the four render items, while the oracle's balanced push16/ret
 * drifts it DOWNWARD. Both must stay inside dead STACK_SCRATCH [0x6BE0,0x6C00) so the
 * excluded region masks every stack byte. SP is seated at 0x6BF0: measured, the oracle
 * pushes down only to 0x6BEA and the candidate pops up only to 0x6BF3 — both bounded well
 * inside STACK_SCRATCH, so no stack byte ever escapes the mask (and no pop faults on the
 * 0x6C00 boundary).
 *
 * REACHABILITY: loc_17b6 is NOT dispatched by a 6000-frame attract run (measured — 0
 * dispatches); its only entry is the 0x6388 rst-0x28 sequence (0x1648 table) reached
 * during a credited game's between-boards interlude. The gate compares candidate vs
 * oracle on the SAME clone, so ANY entry state is a valid input — a real captured attract
 * state and a pre-dirtied variant both exercise the exact same code with identical inputs.
 * The routine's ONE input-dependent output is 0x6388 (an `inc (hl)` read-modify-write); a
 * wrap-edge entry (0x6388 = 0xFF -> 0x00) pins it explicitly.
 *
 * Jobs:
 *   1. EQUAL (real attract states) — clone real attract machine states at several frames;
 *      oracle vs loc_17b6 leave identical RAM (−STACK_SCRATCH).
 *   2. CRAFTED (pre-dirtied, both sides) — dirty broad work + video RAM identically on both
 *      sides (a real state with a surgical, identical nudge); oracle and loc_17b6 still
 *      leave identical RAM. Exercises the code on garbage-filled inputs.
 *   3. INC-EDGE (0x6388 wrap) — with 0x6388 = 0xFF on both sides, both wrap it to 0x00 and
 *      stay RAM-equal: the sole input-dependent byte is reproduced at its 8-bit edge.
 *   4. SCALAR WRITES — pre-dirty the routine's OWN direct writes to 0xAA; confirm the
 *      oracle lands each documented constant, inc(0x6388) = entry+1, and the 0x63C0 repoint
 *      writes 0x88/0x63 (little-endian 0x6388). Pins the arm's non-callee footprint.
 *   5. TEETH — two broken twins MUST be caught: (a) a wrong sub-state gate value at 0x6009,
 *      (b) a DROPPED render item (the fourth loc_0da7 girder is never drawn).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-17b6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_17b6 as oracle } from "../../translated/loc_17b6.js";
import { loc_17b6 as candidate } from "../loc_17b6.js";
// Teeth twins reuse the real idiomatic callees so only the injected defect differs.
import { silenceSound } from "../silenceSound.js";
import { fillDescendingColumn } from "../fillDescendingColumn.js";
import { fillTileBlock } from "../fillTileBlock.js";
import { drawBoardLayout as loc_0da7 } from "../drawBoardLayout.js";
import { loadSpriteObjectBlock } from "../loadSpriteObjectBlock.js";
import { addToSpriteObjectColumn } from "../addToSpriteObjectColumn.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  SND_PRIORITY,
  SND_PRIORITY_FRAMES,
  SUBSTATE_TIMER,
  SPRITE_OBJ_BLOCK,
  SEQ_ADVANCE_PTR,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// SP is seated here for every entry: inside STACK_SCRATCH with headroom BOTH ways (the
// oracle drifts SP down, the idiomatic loc_0da7 drifts it up — see the header).
const SP_SEAT = 0x6bf0;

// The arm's OWN direct scalar writes (not the callee footprint): address -> constant.
// 0x6388 is input-dependent (inc) and 0x63C0/0x63C1 are the little-endian repoint = 0x6388.
const SCALAR_WRITES = new Map([
  [SND_PRIORITY, 0x0e], //        0x608A
  [SND_PRIORITY_FRAMES, 0x03], // 0x608B
  [0x6905, 0x13], //              blink-sprite code
  [SUBSTATE_TIMER, 0x20], //      0x6009 sub-state gate (32 frames)
  [0x6390, 0x80], //              how-high animation stepper
  [SEQ_ADVANCE_PTR, 0x88], //     0x63C0 = low byte of 0x6388
  [SEQ_ADVANCE_PTR + 1, 0x63], // 0x63C1 = high byte of 0x6388
]);
const SEQ_STEP = 0x6388;

/**
 * First RAM difference between two machines on the go-forward contract: the whole state
 * dump minus the stack scratch below the entry SP (dead scratch). Masking IS load-bearing — the oracle's calls
 * push16 into STACK_SCRATCH while the direct-call candidate's loc_0da7 pops it, so those
 * bytes legitimately differ and must be masked. Single forward pass. Returns {addr,a,b} or
 * null.
 */
function ramDiffMinusStack(ma, mb, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const a = ma.dumpState();
  const b = mb.dumpState();
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    const addr = ma.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: a[i], b: b[i] };
  }
  return null;
}

/** Run the oracle and `cand` on two FRESH clones of `entry` and diff (RAM − stack). */
function diffAgainstOracle(entry, cand) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  cand(b);
  return ramDiffMinusStack(a, b, entry.regs.sp);
}

/**
 * A real attract-mode machine state at frame ~N, SP seated into dead STACK_SCRATCH.
 * loc_17b6 is never dispatched in attract, but the gate compares candidate vs oracle on
 * the SAME clone, so any genuine state is a valid entry. Cloning neutralises the frame
 * machinery so running one routine in isolation cannot trip a boundary/NMI.
 */
function attractState(nFrames) {
  const m = new Machine(ROM);
  m.runFrames(nFrames);
  const c = m.clone();
  c.regs.sp = SP_SEAT;
  return c;
}

const ENTRIES = ROM_PRESENT ? [350, 2000, 4500].map(attractState) : [];

test("EQUAL: real attract states as entries — loc_17b6 == oracle in RAM (−stack)", () => {
  assert.ok(ENTRIES.length >= 1, "expected at least one attract entry state");
  for (const entry of ENTRIES) {
    const d = diffAgainstOracle(entry, candidate);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} cand=${d.b}`);
  }
  console.log(`  EQUAL: ${ENTRIES.length} real attract states — RAM (−stack) identical to the oracle`);
});

test("CRAFTED: broad work + video RAM dirtied identically on both sides — still RAM-equal", () => {
  for (const [tag, fill] of [["0x5a", 0x5a], ["0xa5", 0xa5]]) {
    const base = ENTRIES[1];
    const entry = base.clone();
    for (let a = 0x6000; a < STACK_SCRATCH.lo; a++) entry.mem.write8(a, fill); // work RAM (below stack)
    for (let a = 0x7000; a < 0x7800; a++) entry.mem.write8(a, fill); //           video/colour RAM
    const d = diffAgainstOracle(entry, candidate);
    assert.equal(d, null, d && `[${tag}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} cand=${d.b}`);
  }
  console.log("  CRAFTED: 0x5a- and 0xa5-dirtied entries — RAM (−stack) identical to the oracle");
});

test("INC-EDGE: 0x6388 = 0xFF wraps to 0x00 identically (the sole input-dependent byte)", () => {
  const base = ENTRIES[1];
  const entry = base.clone();
  entry.mem.write8(SEQ_STEP, 0xff); // the read-modify-write's 8-bit edge

  const o = entry.clone();
  const c = entry.clone();
  oracle(o);
  candidate(c);

  assert.equal(o.mem.read8(SEQ_STEP), 0x00, "oracle must wrap 0x6388 0xFF -> 0x00");
  assert.equal(c.mem.read8(SEQ_STEP), 0x00, "loc_17b6 must wrap 0x6388 0xFF -> 0x00");
  const d = ramDiffMinusStack(o, c, entry.regs.sp);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} cand=${d.b}`);
  console.log("  INC-EDGE: 0x6388 0xFF -> 0x00 on both sides, RAM (−stack) identical");
});

test("SCALAR WRITES: the arm's own direct writes land their constants + inc(0x6388)", () => {
  const entry = ENTRIES[1].clone();
  entry.mem.write8(SEQ_STEP, 0x40); // a known step value to check the inc
  for (const addr of SCALAR_WRITES.keys()) entry.mem.write8(addr, 0xaa); // dirty so each write shows

  const o = entry.clone();
  const c = entry.clone();
  oracle(o);
  candidate(c);

  for (const [addr, val] of SCALAR_WRITES) {
    assert.equal(o.mem.read8(addr), val, `oracle wrote wrong value at ${hx(addr)}`);
    assert.equal(c.mem.read8(addr), val, `loc_17b6 wrote wrong value at ${hx(addr)}`);
  }
  assert.equal(o.mem.read8(SEQ_STEP), 0x41, "oracle inc(0x6388): 0x40 -> 0x41");
  assert.equal(c.mem.read8(SEQ_STEP), 0x41, "loc_17b6 inc(0x6388): 0x40 -> 0x41");
  console.log(`  SCALAR WRITES: ${SCALAR_WRITES.size} direct constants + inc(0x6388) 0x40->0x41 land identically`);
});

/** Twin (a): wrong sub-state gate value at 0x6009 (0x21 instead of 0x20). */
function brokenGateValue(m) {
  const { regs, mem } = m;
  silenceSound(m);
  mem.write8(SND_PRIORITY, 0x0e);
  mem.write8(SND_PRIORITY_FRAMES, 0x03);
  regs.a = 0x10; regs.de = 0x0020; regs.hl = 0x7623; fillDescendingColumn(m);
  regs.hl = 0x7583; fillDescendingColumn(m);
  for (const [tileDest, segTable] of [[0x76da, 0x3a47], [0x76d5, 0x3a4d], [0x76d0, 0x3a53], [0x76cb, 0x3a59]]) {
    regs.hl = tileDest; fillTileBlock(m);
    regs.de = segTable; loc_0da7(m);
  }
  regs.hl = 0x385c; loadSpriteObjectBlock(m);
  regs.hl = SPRITE_OBJ_BLOCK; regs.c = 0x44; addToSpriteObjectColumn(m);
  mem.write8(0x6905, 0x13);
  mem.write8(SUBSTATE_TIMER, 0x21); // BUG: should be 0x20
  mem.write8(0x6390, 0x80);
  mem.write8(SEQ_STEP, (mem.read8(SEQ_STEP) + 1) & 0xff);
  mem.write16(SEQ_ADVANCE_PTR, SEQ_STEP);
}

/** Twin (b): DROPS the fourth render item — the 0x3A59 girder is never drawn. */
function brokenDroppedRenderItem(m) {
  const { regs, mem } = m;
  silenceSound(m);
  mem.write8(SND_PRIORITY, 0x0e);
  mem.write8(SND_PRIORITY_FRAMES, 0x03);
  regs.a = 0x10; regs.de = 0x0020; regs.hl = 0x7623; fillDescendingColumn(m);
  regs.hl = 0x7583; fillDescendingColumn(m);
  for (const [tileDest, segTable] of [[0x76da, 0x3a47], [0x76d5, 0x3a4d], [0x76d0, 0x3a53] /* BUG: 4th item dropped */]) {
    regs.hl = tileDest; fillTileBlock(m);
    regs.de = segTable; loc_0da7(m);
  }
  regs.hl = 0x385c; loadSpriteObjectBlock(m);
  regs.hl = SPRITE_OBJ_BLOCK; regs.c = 0x44; addToSpriteObjectColumn(m);
  mem.write8(0x6905, 0x13);
  mem.write8(SUBSTATE_TIMER, 0x20);
  mem.write8(0x6390, 0x80);
  mem.write8(SEQ_STEP, (mem.read8(SEQ_STEP) + 1) & 0xff);
  mem.write16(SEQ_ADVANCE_PTR, SEQ_STEP);
}

test("TEETH: wrong-gate and dropped-render twins are both CAUGHT", () => {
  // Run on a dirtied entry so a skipped render leaves an unmistakable 0xAA vs drawn tile.
  const base = ENTRIES[1].clone();
  for (let a = 0x7000; a < 0x7800; a++) base.mem.write8(a, 0xaa);

  const dGate = diffAgainstOracle(base, brokenGateValue);
  assert.notEqual(dGate, null, "the gate FAILED to catch a wrong sub-state gate value — it is worthless");
  assert.equal(dGate.addr, SUBSTATE_TIMER, `wrong-gate twin must diverge at 0x6009, got ${hx(dGate.addr ?? 0)}`);
  assert.equal(dGate.a, 0x20, "oracle stores 0x20 at 0x6009");
  assert.equal(dGate.b, 0x21, "broken twin stores 0x21 at 0x6009");

  const dRender = diffAgainstOracle(base, brokenDroppedRenderItem);
  assert.notEqual(dRender, null, "the gate FAILED to catch a dropped render item — it is worthless");
  // The 4th loc_0da7 both draws VRAM tiles (0x7000-0x77FF) AND stamps the per-item segment
  // scratch (0x63AB-0x63B4); dropping it leaves either stale, and the first divergence is
  // the scratch. Accept anywhere in that render footprint.
  const inRenderFootprint =
    (dRender.addr >= 0x63ab && dRender.addr <= 0x63b4) || (dRender.addr >= 0x7000 && dRender.addr < 0x7800);
  assert.ok(
    inRenderFootprint,
    `dropped-render twin must diverge in the loc_0da7 render footprint, got ${hx(dRender.addr ?? 0)}`,
  );

  console.log(
    `  TEETH: wrong gate caught at ${hx(dGate.addr)} (${dGate.a}->${dGate.b}); ` +
      `dropped render caught at ${hx(dRender.addr)} (${dRender.a}->${dRender.b})`,
  );
});
