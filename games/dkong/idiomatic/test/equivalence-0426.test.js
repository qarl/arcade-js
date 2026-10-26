// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_0426 (ROM 0x0426) — advance the colour-cycle sweep counter one step
 * per frame and dispatch this frame's colour work.
 *
 * loc_0426 increments the sweep counter (0x6390), then routes on the post-increment value:
 *
 *   - counter == 0x80              -> resetColorCycleSweep (ROM 0x0464): end the sweep.
 *   - reload gate (0x6393) != 0    -> dispatchColorCyclePaint (ROM 0x0486): repaint only.
 *   - (counter & 0x1f) != 0        -> dispatchColorCyclePaint: repaint only (in-between frame).
 *   - 32-frame boundary (gate == 0, counter a nonzero multiple of 32) -> reload the 40-byte
 *     sprite-object block from a ROM template (0x39cf if counter bit 5 set, else 0x39f7) via
 *     loadSpriteObjectBlock (ROM 0x004e), raise the 0x6082 request byte, then run the full
 *     colour cascade dispatchColorCascadeByBoard (ROM 0x0450).
 *
 * The sole caller (loc_0413) tail-calls loc_0426 with no register live-in; loc_0426 sets its own
 * pointer at entry. Down EVERY path the oracle nets exactly ONE return: the tail-jump routes
 * (top-of-sweep, both repaint arms) ret the caller once; the boundary arm additionally push16s
 * the sub_004e link, which sub_004e's `ret` pops straight back (net zero; the pushed bytes land
 * in STACK_SCRATCH, excluded by the memory-equivalence contract), then the colour tail chain rets
 * the caller once. The idiomatic routine models the Z80 stack as the JS call stack (direct calls,
 * no push16/ret of its own), so the harness performs ONE m.ret() on the candidate to line pc + SP
 * up with the oracle. Every case runs on a FRESH clone (the callees write memory).
 *
 *   1. REALISM (captured) — hook 0x0426 in a real attract run and confirm loc_0426 == oracle over
 *      every natural dispatch, classified by the route the entry forces.
 *
 *   2. EQUAL (crafted) — force the top-of-sweep reset, the gate-nonzero repaint (gate 1 and gate
 *      0x40 to prove "nonzero" not "==1"), the in-between repaint, and both bit-5 boundary arms
 *      across boards, each over the whole contract (RAM - the stack scratch below the entry SP + pc + SP) plus a
 *      route-discriminating non-vacuity check.
 *
 *   3. TEETH — four deliberately-broken twins, each reusing the real idiomatic arms so the only
 *      divergence is the injected bug, each MUST be caught:
 *      (a) dropped increment          — caught at the sweep counter (0x6390).
 *      (b) wrong top-of-sweep threshold (0x81) — the reset never fires; caught at 0x6390.
 *      (c) inverted reload gate        — takes the wrong arm; caught by the callee writes.
 *      (d) swapped bit-5 template      — reloads from the wrong template; caught in the block.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0426.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0426 as oracle } from "../../translated/loc_0426.js";
import { advanceColorCycleSweep as loc_0426 } from "../advanceColorCycleSweep.js";
import { resetColorCycleSweep } from "../resetColorCycleSweep.js";
import { dispatchColorCyclePaint } from "../dispatchColorCyclePaint.js";
import { loadSpriteObjectBlock } from "../loadSpriteObjectBlock.js";
import { dispatchColorCascadeByBoard } from "../dispatchColorCascadeByBoard.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, BOARD, SPRITE_OBJ_BLOCK } from "../names.js";
import { u8 } from "../../../../core/int.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0426;
const RET_ADDR = 0x0413;        // a plausible caller-return for the one net pop (any value works)
const SWEEP_COUNTER = 0x6390;   // colour-cycle sweep counter (unnamed in names.js)
const OBJ_RELOAD_GATE = 0x6393; // 0 -> boundary reload arm, nonzero -> repaint arm (unnamed in names.js)
const OBJ_RELOAD_REQUEST = 0x6082; // request byte raised to 3 on the boundary arm (unnamed in names.js)
const SWEEP_TOP = 0x80;         // the counter's top of range
const TEMPLATE_BIT5_SET = 0x39cf;   // ROM template reloaded when counter bit 5 is set
const TEMPLATE_BIT5_CLEAR = 0x39f7; // ROM template reloaded when counter bit 5 is clear
const OBJ_BLOCK_LEN = 0x28;     // 40 bytes = 10 sprite records x 4 bytes

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

/** Compare candidate vs oracle over the full contract: RAM - the stack scratch below the entry SP, pc, SP. */
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
 * Stamp a crafted 0x0426 entry onto a clone of the base: a clean stack with a plausible caller
 * return (so the net `ret` has a sane target), the sweep counter set so the post-increment lands
 * on `post`, the reload gate, and the board being tested. loc_0426 sets its own pointer at entry
 * and reads the gate + board straight from RAM.
 */
function craft(base, { post, gate = 0, board = 1 } = {}) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.mem.write8(SWEEP_COUNTER, u8(post - 1)); // pre-increment value: +1 lands on `post`
  m.mem.write8(OBJ_RELOAD_GATE, gate & 0xff);
  m.mem.write8(BOARD, board & 0xff);
  return m;
}

// Classify the route a given entry forces, from the SAME logic the routine uses.
function routeOf(entry) {
  const post = u8(entry.mem.read8(SWEEP_COUNTER) + 1);
  if (post === SWEEP_TOP) return "reset";
  if (entry.mem.read8(OBJ_RELOAD_GATE) !== 0) return "repaint";
  if ((post & 0x1f) !== 0) return "repaint";
  return "boundary";
}

// The 40 bytes of the sprite-object block, read from a machine.
const objBlock = (m) => Array.from({ length: OBJ_BLOCK_LEN }, (_, k) => m.mem.read8(SPRITE_OBJ_BLOCK + k));
// The 40 bytes of a ROM template at `base`.
const romTemplate = (base) => Array.from({ length: OBJ_BLOCK_LEN }, (_, k) => ROM[base + k]);

// -- 1. REALISM (captured) ----------------------------------------------------

test("REALISM: real captured 0x0426 dispatches match the oracle", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    // Capture enough consecutive dispatches to span several full 0..0x80 sweeps, so the
    // top-of-sweep reset (once per 128 counts) and the gated boundary arm are both reached.
    if (caps.length < 512) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(8000);
  assert.ok(caps.length >= 1, "expected at least one real 0x0426 dispatch during attract");

  const seen = { reset: 0, repaint: 0, boundary: 0 };
  for (const cap of caps) {
    const diffs = contractDiffs(cap, loc_0426);
    assert.equal(diffs.length, 0, `real dispatch: ${diffs.join("; ")}`);
    seen[routeOf(cap)]++;
  }
  // The sweep tops out every 0x80 active frames and repaints every other frame, so both are
  // heavily exercised in 8000 frames; the boundary reload arm is gated (crafted below).
  assert.ok(seen.reset >= 1, "expected at least one natural top-of-sweep reset in 8000 frames");
  assert.ok(seen.repaint >= 1, "expected at least one natural repaint dispatch in 8000 frames");
  console.log(`  REALISM: ${caps.length} real 0x0426 dispatches identical to the oracle (${seen.reset} reset, ${seen.repaint} repaint, ${seen.boundary} boundary)`);
});

// -- 2. EQUAL (crafted, all four routes) --------------------------------------

test("EQUAL (crafted): the reset, repaint, and both bit-5 boundary arms all match the oracle", () => {
  const base = attractBase();

  const cases = [
    // top of the sweep -> resetColorCycleSweep clears the counter + active flag
    { name: "top-of-sweep reset (25m)", post: 0x80, gate: 0x00, board: 1, route: "reset" },
    // gate nonzero -> repaint only (counter NOT cleared, block untouched)
    { name: "gate==1 repaint (25m)", post: 0x10, gate: 0x01, board: 1, route: "repaint" },
    { name: "gate==0x40 repaint (nonzero, not ==1)", post: 0x22, gate: 0x40, board: 1, route: "repaint" },
    // gate zero but not a 32-frame boundary -> repaint only
    { name: "in-between repaint (gate 0, counter & 0x1f != 0)", post: 0x05, gate: 0x00, board: 1, route: "repaint" },
    // 32-frame boundaries, gate 0 -> reload from the bit-5-selected template + full cascade
    { name: "boundary bit5=1 -> template 0x39cf (25m)", post: 0x20, gate: 0x00, board: 1, route: "boundary", template: TEMPLATE_BIT5_SET },
    { name: "boundary bit5=1 -> template 0x39cf (counter 0x60)", post: 0x60, gate: 0x00, board: 1, route: "boundary", template: TEMPLATE_BIT5_SET },
    { name: "boundary bit5=0 -> template 0x39f7 (25m)", post: 0x40, gate: 0x00, board: 1, route: "boundary", template: TEMPLATE_BIT5_CLEAR },
    { name: "boundary bit5=0 on an even board (100m -> shiftEvenBoardSpriteColumn)", post: 0x40, gate: 0x00, board: 4, route: "boundary", template: TEMPLATE_BIT5_CLEAR },
    { name: "boundary bit5=1 on 75m (direct repaint arm of the cascade)", post: 0x20, gate: 0x00, board: 3, route: "boundary", template: TEMPLATE_BIT5_SET },
  ];

  for (const { name, post, gate, board, route, template } of cases) {
    const entry = craft(base, { post, gate, board });
    assert.equal(routeOf(entry), route, `${name}: crafted the wrong route (${routeOf(entry)})`);

    const diffs = contractDiffs(entry, loc_0426);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    const after = runOracle(entry);
    if (route === "reset") {
      // resetColorCycleSweep cleared both colour-cycle counters back to 0.
      assert.equal(after.mem.read8(SWEEP_COUNTER), 0, `${name}: sweep counter not cleared`);
    } else if (route === "repaint") {
      // The counter advanced (never cleared) and the sprite-object block was left untouched.
      assert.equal(after.mem.read8(SWEEP_COUNTER), post, `${name}: counter not advanced to ${hb(post)}`);
      assert.deepEqual(objBlock(after), objBlock(entry), `${name}: repaint arm should not touch the sprite-object block`);
      assert.notEqual(firstRamDiff(entry, after, entry.regs.sp), null, `${name}: the colour cascade wrote no RAM`);
    } else {
      // The boundary arm reloaded the block from the ROM template and raised the request byte.
      assert.equal(after.mem.read8(OBJ_RELOAD_REQUEST), 3, `${name}: reload-request byte not raised`);
      const tmpl = romTemplate(template), aft = objBlock(after);
      // The cascade nudges ONE column (X on even boards, Y on 25m), so the never-shifted code and
      // attr fields of all ten records survive byte-for-byte from the chosen template.
      for (let r = 0; r < 10; r++) {
        assert.equal(aft[4 * r + 1], tmpl[4 * r + 1], `${name}: record ${r} code byte not reloaded from ${hx(template)}`);
        assert.equal(aft[4 * r + 2], tmpl[4 * r + 2], `${name}: record ${r} attr byte not reloaded from ${hx(template)}`);
      }
    }
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (reset, repaint gate=1/0x40/in-between, boundary bit5=0/1 on 25m/75m/100m) identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** BUG (a): drops the sweep-counter increment. */
function teethNoIncrement(m) {
  const { regs, mem } = m;
  const counter = mem.read8(SWEEP_COUNTER); // BUG: no +1, no write-back
  if (counter === SWEEP_TOP) { resetColorCycleSweep(m); return; }
  if (mem.read8(OBJ_RELOAD_GATE) !== 0) { dispatchColorCyclePaint(m); return; }
  if ((counter & 0x1f) !== 0) { dispatchColorCyclePaint(m); return; }
  regs.hl = (counter & 0x20) !== 0 ? TEMPLATE_BIT5_SET : TEMPLATE_BIT5_CLEAR;
  loadSpriteObjectBlock(m);
  mem.write8(OBJ_RELOAD_REQUEST, 3);
  dispatchColorCascadeByBoard(m);
}

/** BUG (b): wrong top-of-sweep threshold (0x81) — the reset never fires at 0x80. */
function teethWrongTop(m) {
  const { regs, mem } = m;
  const counter = u8(mem.read8(SWEEP_COUNTER) + 1);
  mem.write8(SWEEP_COUNTER, counter);
  if (counter === 0x81) { resetColorCycleSweep(m); return; } // BUG: should be 0x80
  if (mem.read8(OBJ_RELOAD_GATE) !== 0) { dispatchColorCyclePaint(m); return; }
  if ((counter & 0x1f) !== 0) { dispatchColorCyclePaint(m); return; }
  regs.hl = (counter & 0x20) !== 0 ? TEMPLATE_BIT5_SET : TEMPLATE_BIT5_CLEAR;
  loadSpriteObjectBlock(m);
  mem.write8(OBJ_RELOAD_REQUEST, 3);
  dispatchColorCascadeByBoard(m);
}

/** BUG (c): inverts the reload gate — takes the wrong arm. */
function teethInvertedGate(m) {
  const { regs, mem } = m;
  const counter = u8(mem.read8(SWEEP_COUNTER) + 1);
  mem.write8(SWEEP_COUNTER, counter);
  if (counter === SWEEP_TOP) { resetColorCycleSweep(m); return; }
  if (mem.read8(OBJ_RELOAD_GATE) === 0) { dispatchColorCyclePaint(m); return; } // BUG: should be !== 0
  if ((counter & 0x1f) !== 0) { dispatchColorCyclePaint(m); return; }
  regs.hl = (counter & 0x20) !== 0 ? TEMPLATE_BIT5_SET : TEMPLATE_BIT5_CLEAR;
  loadSpriteObjectBlock(m);
  mem.write8(OBJ_RELOAD_REQUEST, 3);
  dispatchColorCascadeByBoard(m);
}

/** BUG (d): swaps the bit-5 template selection. */
function teethSwappedTemplate(m) {
  const { regs, mem } = m;
  const counter = u8(mem.read8(SWEEP_COUNTER) + 1);
  mem.write8(SWEEP_COUNTER, counter);
  if (counter === SWEEP_TOP) { resetColorCycleSweep(m); return; }
  if (mem.read8(OBJ_RELOAD_GATE) !== 0) { dispatchColorCyclePaint(m); return; }
  if ((counter & 0x1f) !== 0) { dispatchColorCyclePaint(m); return; }
  regs.hl = (counter & 0x20) !== 0 ? TEMPLATE_BIT5_CLEAR : TEMPLATE_BIT5_SET; // BUG: swapped
  loadSpriteObjectBlock(m);
  mem.write8(OBJ_RELOAD_REQUEST, 3);
  dispatchColorCascadeByBoard(m);
}

test("TEETH: dropped-increment, wrong-top, inverted-gate, and swapped-template twins are all CAUGHT", () => {
  const base = attractBase();

  // (a) dropped increment: a repaint entry — the oracle advances 0x6390, the twin leaves it put.
  const aEntry = craft(base, { post: 0x10, gate: 0x01, board: 1 });
  const aDiffs = contractDiffs(aEntry, teethNoIncrement);
  assert.notEqual(aDiffs.length, 0, "the dropped-increment twin escaped — the gate is worthless");
  assert.ok(aDiffs[0].startsWith(`RAM@${hx(SWEEP_COUNTER)}`), `expected a ${hx(SWEEP_COUNTER)} diff, got ${aDiffs[0]}`);

  // (b) wrong top: a top-of-sweep entry (post 0x80) with the reload gate SET, so both sides take a
  //     repaint (no boundary reload, no 0x6082 write). The oracle resets first (counter -> 0), the
  //     twin does not (counter stays 0x80); the divergence lands cleanly on the counter at 0x6390.
  const bEntry = craft(base, { post: 0x80, gate: 0x01, board: 1 });
  const bDiffs = contractDiffs(bEntry, teethWrongTop);
  assert.notEqual(bDiffs.length, 0, "the wrong-top twin escaped — the gate is worthless");
  assert.ok(bDiffs[0].startsWith(`RAM@${hx(SWEEP_COUNTER)}`), `expected a ${hx(SWEEP_COUNTER)} diff, got ${bDiffs[0]}`);

  // (c) inverted gate: a boundary entry (gate 0) — the twin takes the repaint arm, so no block
  //     reload and no 0x6082 request; caught in RAM.
  const cEntry = craft(base, { post: 0x40, gate: 0x00, board: 1 });
  const cDiffs = contractDiffs(cEntry, teethInvertedGate);
  assert.notEqual(cDiffs.length, 0, "the inverted-gate twin escaped — the gate is worthless");
  assert.ok(cDiffs[0].startsWith("RAM@"), `expected a RAM divergence, got ${cDiffs[0]}`);

  // (d) swapped template: a bit5-set boundary entry (post 0x20) — the oracle reloads from 0x39cf,
  //     the twin from 0x39f7; caught in the sprite-object block.
  const dEntry = craft(base, { post: 0x20, gate: 0x00, board: 1 });
  const dDiffs = contractDiffs(dEntry, teethSwappedTemplate);
  assert.notEqual(dDiffs.length, 0, "the swapped-template twin escaped — the gate is worthless");
  assert.ok(dDiffs[0].startsWith("RAM@"), `expected a RAM divergence, got ${dDiffs[0]}`);

  console.log(`  TEETH: dropped-increment caught (${aDiffs[0]}); wrong-top caught (${bDiffs[0]}); inverted-gate caught (${cDiffs[0]}); swapped-template caught (${dDiffs[0]})`);
});
