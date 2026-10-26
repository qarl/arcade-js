// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_0464 (ROM 0x0464) — restart the colour-cycle sweep at the top of its
 * range, then continue the frame's colour work.
 *
 * loc_0464 clears the sweep counter (0x6390) and the colour-cycle active flag (COLOUR_CYCLE_ACTIVE,
 * 0x6391) to 0, then branches on the sprite-object reload gate (0x6393):
 *
 *   - gate NONZERO -> dispatchColorCyclePaint (ROM 0x0486): the colour-cycle repaint only, no
 *                     sprite-object reload and no per-board sprite-column shift.
 *   - gate ZERO    -> reload the 40-byte sprite-object block from ROM template 0x385c
 *                     (loadSpriteObjectBlock, ROM 0x004e), then run the full colour-cascade
 *                     dispatch (loc_0450, ROM 0x0450) which also shifts the sprite-object column.
 *
 * The only caller (loc_0426) reaches here with HL == 0x6390 having just seen the counter hit 0x80,
 * so the oracle's two `ld (hl),a` writes land on 0x6390 and 0x6391; the idiomatic routine writes
 * those fixed cells directly. BOTH arms are exercised naturally in a 25m attract — the counter
 * tops out repeatedly and 0x6393 is seen both 0 (reload arm) and nonzero (repaint arm) — so real
 * captures cover both. Crafted entries then force each arm deterministically, a non-1 nonzero gate,
 * and the callee routes that are cold in a 25m attract (the rivet board on the repaint arm, an even
 * board on the reload arm).
 *
 * The oracle's net stack effect down every path is exactly ONE return: the reload arm push16s the
 * sub_004e link and sub_004e's `ret` pops it straight back (net zero; the pushed bytes land in
 * STACK_SCRATCH, excluded by the memory-equivalence contract), then the colour tail chain rets the
 * caller's address (one net pop); the repaint arm tail-jumps and the chain rets once. The idiomatic
 * routine models the Z80 stack as the JS call stack (direct calls, no push16/ret of its own), so
 * the harness performs ONE m.ret() on the candidate to line pc + SP up with the oracle. Every case
 * runs on a FRESH clone (the callees write memory).
 *
 *   1. REALISM (captured) — hook 0x0464 in a real attract run and confirm loc_0464 == oracle over
 *      every natural dispatch (both arms), with a per-dispatch check that the two counters were
 *      cleared to 0.
 *
 *   2. EQUAL (crafted) — force the reload arm (gate 0), the repaint arm (gate 1 and gate 0x40 to
 *      prove "nonzero" not "==1"), and the cold callee routes, each over the whole contract
 *      (RAM − the stack scratch below the entry SP + pc + SP) plus a path-discriminating non-vacuity check.
 *
 *   3. TEETH — four deliberately-broken twins, each reusing the real idiomatic arms so the only
 *      divergence is the injected bug, each MUST be caught:
 *      (a) dropped active-flag clear   — caught at COLOUR_CYCLE_ACTIVE (0x6391).
 *      (b) dropped sweep-counter clear — caught at the sweep counter (0x6390).
 *      (c) inverted reload gate        — takes the wrong arm; caught by the callee writes.
 *      (d) wrong template source       — reloads the block from 0x385d; caught in the block.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0464.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0464 as oracle } from "../../translated/loc_0464.js";
import { resetColorCycleSweep as loc_0464 } from "../resetColorCycleSweep.js";
import { loadSpriteObjectBlock } from "../loadSpriteObjectBlock.js";
import { dispatchColorCyclePaint } from "../dispatchColorCyclePaint.js";
import { dispatchColorCascadeByBoard as loc_0450 } from "../dispatchColorCascadeByBoard.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, COLOUR_CYCLE_ACTIVE, BOARD, SPRITE_OBJ_BLOCK } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0464;
const RET_ADDR = 0x0429;      // a plausible caller-return for the one net pop (any value works)
const SWEEP_COUNTER = 0x6390; // colour-cycle sweep counter (unnamed in names.js)
const OBJ_RELOAD_GATE = 0x6393; // 0 -> reload arm, nonzero -> repaint arm (unnamed in names.js)
const OBJ_TEMPLATE = 0x385c;  // ROM sprite-object template the reload arm copies from
const OBJ_BLOCK_LEN = 0x28;   // 40 bytes = 10 sprite records x 4 bytes

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const hb = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
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

/** Run the ORACLE on a fresh clone. Its colour tail chain performs the net `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its single net return with one m.ret() so pc + SP
 * match the oracle's (the idiomatic routine replaces the Z80 stack with the JS call stack, so it
 * does not touch pc/SP itself — the harness supplies the one return).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over the full contract: RAM − the stack scratch below the entry SP, pc, SP. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${hb(ram.a)} cand=${hb(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// A real, self-consistent machine: boot + a stretch of attract so work RAM holds realistic values.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

/**
 * Stamp a crafted 0x0464 entry onto a clone of the base: a clean stack with a plausible caller
 * return (so the net `ret` has a sane target), HL pointing at the sweep counter as the sole caller
 * always leaves it, the counter topped out at 0x80, the active flag raised, the chosen reload gate,
 * and the board being tested. The oracle writes 0x6390/0x6391 through HL and reads the gate + board
 * straight from RAM.
 */
function craft(base, { gate, board = 1, sweep = 0x80, active = 1 } = {}) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.regs.hl = SWEEP_COUNTER; // the caller (loc_0426) always reaches loc_0464 with HL == 0x6390
  m.mem.write8(SWEEP_COUNTER, sweep & 0xff);
  m.mem.write8(COLOUR_CYCLE_ACTIVE, active & 0xff);
  m.mem.write8(OBJ_RELOAD_GATE, gate & 0xff);
  m.mem.write8(BOARD, board & 0xff);
  return m;
}

// The 40 bytes of the sprite-object block, read from a machine.
const objBlock = (m) => Array.from({ length: OBJ_BLOCK_LEN }, (_, k) => m.mem.read8(SPRITE_OBJ_BLOCK + k));
// The 40 bytes of the ROM template the reload arm copies from.
const romTemplate = () => Array.from({ length: OBJ_BLOCK_LEN }, (_, k) => ROM[OBJ_TEMPLATE + k]);

// -- 1. REALISM (captured) ----------------------------------------------------

test("REALISM: real captured 0x0464 dispatches (both arms) match the oracle", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 64) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(8000);
  assert.ok(caps.length >= 1, "expected at least one real 0x0464 dispatch during attract");

  let sawReload = 0, sawRepaint = 0;
  for (const cap of caps) {
    // The sole caller always arrives with HL == 0x6390 (it just incremented that cell to 0x80).
    assert.equal(cap.regs.hl & 0xffff, SWEEP_COUNTER, "capture should arrive with HL == 0x6390");
    const diffs = contractDiffs(cap, loc_0464);
    assert.equal(diffs.length, 0, `real dispatch: ${diffs.join("; ")}`);
    // Non-vacuity: the oracle really restarted the sweep — both counters cleared to 0.
    const after = runOracle(cap);
    assert.equal(after.mem.read8(SWEEP_COUNTER), 0, "real dispatch: sweep counter not cleared");
    assert.equal(after.mem.read8(COLOUR_CYCLE_ACTIVE), 0, "real dispatch: active flag not cleared");
    if (cap.mem.read8(OBJ_RELOAD_GATE) === 0) sawReload++; else sawRepaint++;
  }
  assert.ok(sawReload >= 1, "expected at least one natural gate-zero (reload) dispatch in 8000 frames");
  assert.ok(sawRepaint >= 1, "expected at least one natural gate-nonzero (repaint) dispatch in 8000 frames");
  console.log(`  REALISM: ${caps.length} real 0x0464 dispatches identical to the oracle (${sawReload} reload, ${sawRepaint} repaint)`);
});

// -- 2. EQUAL (crafted, both arms + cold callee routes) -----------------------

test("EQUAL (crafted): the reload arm, repaint arm, non-1 gate, and cold callee routes all match", () => {
  const base = attractBase();

  const cases = [
    { name: "gate==0 (reload): block reload + full cascade on 25m", gate: 0x00, board: 1, arm: "reload" },
    { name: "gate==0 (reload) on an even board (100m -> loc_0478)", gate: 0x00, board: 4, arm: "reload" },
    { name: "gate==1 (repaint): colour cycle only on 25m", gate: 0x01, board: 1, arm: "repaint" },
    { name: "gate==0x40 (repaint): nonzero, not ==1", gate: 0x40, board: 1, arm: "repaint" },
    { name: "gate==1 (repaint) on the rivet board (100m blink)", gate: 0x01, board: 4, arm: "repaint" },
  ];

  for (const { name, gate, board, arm } of cases) {
    const entry = craft(base, { gate, board });

    const diffs = contractDiffs(entry, loc_0464);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    const after = runOracle(entry);
    // Both arms restart the sweep.
    assert.equal(after.mem.read8(SWEEP_COUNTER), 0, `${name}: sweep counter not cleared`);
    assert.equal(after.mem.read8(COLOUR_CYCLE_ACTIVE), 0, `${name}: active flag not cleared`);

    if (arm === "reload") {
      // The reload arm overwrote the sprite-object block from the ROM template, then the cascade
      // nudged ONE column (Y on 25m, X on the even board) — so the never-shifted code and attr
      // fields of all ten records survive byte-for-byte from the 0x385c template.
      const tmpl = romTemplate(), aft = objBlock(after);
      for (let r = 0; r < 10; r++) {
        assert.equal(aft[4 * r + 1], tmpl[4 * r + 1], `${name}: record ${r} code byte not reloaded from 0x385c`);
        assert.equal(aft[4 * r + 2], tmpl[4 * r + 2], `${name}: record ${r} attr byte not reloaded from 0x385c`);
      }
    } else {
      // The repaint arm left the sprite-object block untouched but the colour cascade wrote RAM.
      assert.deepEqual(objBlock(after), objBlock(entry), `${name}: repaint arm should not touch the sprite-object block`);
      assert.notEqual(firstRamDiff(entry, after, entry.regs.sp), null, `${name}: the colour cascade wrote no RAM`);
    }
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (reload 25m/even, repaint gate=1/0x40, rivet) identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** BUG (a): drops the colour-cycle active-flag clear. */
function teethNoActiveClear(m) {
  const { regs, mem } = m;
  mem.write8(SWEEP_COUNTER, 0);
  // BUG: no COLOUR_CYCLE_ACTIVE clear
  if (mem.read8(OBJ_RELOAD_GATE) !== 0) { dispatchColorCyclePaint(m); return; }
  regs.hl = OBJ_TEMPLATE;
  loadSpriteObjectBlock(m);
  loc_0450(m);
}

/** BUG (b): drops the sweep-counter clear. */
function teethNoCounterClear(m) {
  const { regs, mem } = m;
  // BUG: no SWEEP_COUNTER clear
  mem.write8(COLOUR_CYCLE_ACTIVE, 0);
  if (mem.read8(OBJ_RELOAD_GATE) !== 0) { dispatchColorCyclePaint(m); return; }
  regs.hl = OBJ_TEMPLATE;
  loadSpriteObjectBlock(m);
  loc_0450(m);
}

/** BUG (c): inverts the reload gate — takes the wrong arm. */
function teethInvertedGate(m) {
  const { regs, mem } = m;
  mem.write8(SWEEP_COUNTER, 0);
  mem.write8(COLOUR_CYCLE_ACTIVE, 0);
  if (mem.read8(OBJ_RELOAD_GATE) === 0) { dispatchColorCyclePaint(m); return; } // BUG: should be !== 0
  regs.hl = OBJ_TEMPLATE;
  loadSpriteObjectBlock(m);
  loc_0450(m);
}

/** BUG (d): reloads the block from the wrong (off-by-one) template source. */
function teethWrongTemplate(m) {
  const { regs, mem } = m;
  mem.write8(SWEEP_COUNTER, 0);
  mem.write8(COLOUR_CYCLE_ACTIVE, 0);
  if (mem.read8(OBJ_RELOAD_GATE) !== 0) { dispatchColorCyclePaint(m); return; }
  regs.hl = OBJ_TEMPLATE + 1; // BUG: should be 0x385c
  loadSpriteObjectBlock(m);
  loc_0450(m);
}

test("TEETH: dropped-active-clear, dropped-counter-clear, inverted-gate, and wrong-template twins are all CAUGHT", () => {
  const base = attractBase();

  // (a) dropped active clear: active flag starts at 1 -> the oracle clears it, the twin leaves it 1.
  const aEntry = craft(base, { gate: 0x01, active: 1 });
  const aDiffs = contractDiffs(aEntry, teethNoActiveClear);
  assert.notEqual(aDiffs.length, 0, "the dropped-active-clear twin escaped — the gate is worthless");
  assert.ok(aDiffs[0].startsWith(`RAM@${hx(COLOUR_CYCLE_ACTIVE)}`), `expected a ${hx(COLOUR_CYCLE_ACTIVE)} diff, got ${aDiffs[0]}`);

  // (b) dropped counter clear: counter starts at 0x80 -> the oracle clears it, the twin leaves 0x80.
  const bEntry = craft(base, { gate: 0x01, sweep: 0x80 });
  const bDiffs = contractDiffs(bEntry, teethNoCounterClear);
  assert.notEqual(bDiffs.length, 0, "the dropped-counter-clear twin escaped — the gate is worthless");
  assert.ok(bDiffs[0].startsWith(`RAM@${hx(SWEEP_COUNTER)}`), `expected a ${hx(SWEEP_COUNTER)} diff, got ${bDiffs[0]}`);

  // (c) inverted gate: gate==0 (reload arm) — the twin takes the repaint arm, so no block reload
  //     and no 25m sprite-column shift; caught in RAM.
  const cEntry = craft(base, { gate: 0x00, board: 1 });
  const cDiffs = contractDiffs(cEntry, teethInvertedGate);
  assert.notEqual(cDiffs.length, 0, "the inverted-gate twin escaped — the gate is worthless");
  assert.ok(cDiffs[0].startsWith("RAM@"), `expected a RAM divergence, got ${cDiffs[0]}`);

  // (d) wrong template: gate==0 (reload arm) — the block is filled from 0x385d not 0x385c; caught
  //     in the sprite-object block.
  const dEntry = craft(base, { gate: 0x00, board: 1 });
  const dDiffs = contractDiffs(dEntry, teethWrongTemplate);
  assert.notEqual(dDiffs.length, 0, "the wrong-template twin escaped — the gate is worthless");
  assert.ok(dDiffs[0].startsWith("RAM@"), `expected a RAM divergence, got ${dDiffs[0]}`);

  console.log(`  TEETH: active-clear caught (${aDiffs[0]}); counter-clear caught (${bDiffs[0]}); inverted-gate caught (${cDiffs[0]}); wrong-template caught (${dDiffs[0]})`);
});
