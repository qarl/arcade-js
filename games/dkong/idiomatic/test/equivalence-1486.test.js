// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for runBonusItemValueDisplay (ROM 0x1486) — the GAME_SUBSTATE (0x600A)
 * phase-21 handler: the on-board bonus item's position walk, sprite animation, and
 * countdown value display.
 *
 * 0x1486 is entry 21 (0x15) of loc_06fe's rst-0x28 sub-state table and is NOT dispatched
 * in attract (verified below: 0 dispatches over 2000 frames — the bonus item is
 * gameplay-only). It WRITES MEMORY through its own stores and four callees
 * (drawCreditDisplay 0x0616, positionBonusItemSprite 0x15fa, renderBcdColumn 0x057c,
 * enqueueTask 0x309f), so it is validated by MEMORY-equivalence against the frozen oracle
 * over RAM (minus the stack scratch below the entry SP) + pc + SP — never the full register file, never cycles —
 * on a FRESH clone per case, using CRAFTED entries (doc-06: a real attract-base machine +
 * a surgical poke):
 *
 *   1. EQUAL (init) — SUBSTATE_TIMER == 0 drives the one-shot setup + first per-frame body.
 *      Covers the 0x611C slot search on a no-match, a row-0 match, and a 2*(0x600E)+1 key
 *      that matches row 2 (exercising the RLCA key derivation). Non-vacuous: 0x6009 -> 1 and
 *      the item-state block is seeded.
 *
 *   2. EQUAL (running) — SUBSTATE_TIMER != 0 drives the per-frame body over EVERY branch:
 *      the display timer with and without a value tick (BCD split into 0x7552/0x7572), the
 *      bit-7 video-column walk (stamp, the 0x7588-floor no-op, the pos=0x1C column advance
 *      with and without the 0x7608 wrap), the low-2-bit step (divider still counting; the
 *      up move with its 0x1E->0 wrap; the down move with its 0->0x1D wrap), the
 *      no-direction divider reset, and the sprite-animate toggle both ways (0x057c render).
 *
 *   3. EQUAL (exit) — both EXIT triggers (value reaching 0, and the column walk at pos 0x1D)
 *      run the teardown: item slot cleared, SUBSTATE_TIMER -> 0x80, GAME_SUBSTATE decremented
 *      (the phase step-back), the 12-cell column copy, and the six enqueueTask posts. The
 *      FULL oracle runs on both sides, so any wrong store, task, tile or digit surfaces as
 *      divergent RAM.
 *
 *   4. TEETH — two deliberately-broken faithful twins, each MUST be caught: (a) a wrong
 *      phase-step (GAME_SUBSTATE += 1 instead of -= 1) — caught in the exit arm; (b) a
 *      wrong digit cell (ones digit written to 0x7553 instead of 0x7552) — caught in the
 *      value-tick arm. Each also PASSES on an arm that does not exercise its bug, proving it
 *      is a targeted corruption, not a globally-broken routine.
 *
 * The idiomatic routine models the Z80 `ret` as a plain JS return (no stack modelling), so
 * runCandidate performs ONE m.ret() after the call to line pc + SP up with the oracle. The
 * oracle nets exactly one caller-return pop on every exit: each of its `call`s is an
 * SP-neutral push16 + callee-ret pair, and its terminal `ret` is that single pop. (Measured:
 * the oracle's stack low-water-mark under these entries is 0x6BF8, well inside STACK_SCRATCH
 * [0x6BE0,0x6C00), so every oracle push is excluded from the RAM contract.)
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1486.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1486 as oracle } from "../../translated/loc_1486.js";
import { runBonusItemValueDisplay } from "../runBonusItemValueDisplay.js";
import { drawCreditDisplay } from "../drawCreditDisplay.js";
import { positionBonusItemSprite } from "../positionBonusItemSprite.js";
import { renderBcdColumn } from "../renderBcdColumn.js";
import { enqueueTask } from "../enqueueTask.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1486;

// RAM landmarks (item-state block is names.js-unnamed scratch; kept hex here too).
const SUBSTATE_TIMER = 0x6009;
const GAME_SUBSTATE = 0x600a;
const SLOT_KEY_SRC = 0x600e;
const P1_INPUT = 0x6010;
const POS_RELOAD = 0x6030;
const SPRITE_TOGGLE = 0x6031;
const ANIM_TIMER = 0x6032;
const VALUE = 0x6033;
const DISPLAY_TIMER = 0x6034;
const POS_INDEX = 0x6035;
const VIDEO_PTR = 0x6036; // 16-bit
const SLOT_PTR = 0x6038; // 16-bit
const SLOT_TABLE = 0x611c;
const VALUE_ONES_CELL = 0x7552;
const VALUE_TENS_CELL = 0x7572;
const RET_ADDR = 0x0710; // a plausible caller return (after the 0x0702 dispatch)

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// (the memory-equivalence contract is RAM − the stack scratch below the entry SP). Returns {addr,a,b} or null.
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

// All non-stack RAM addresses that changed between two machines (for non-vacuity checks).
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

/** Run the ORACLE on a fresh clone. It performs its own `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its terminal `ret` with one m.ret() so pc +
 * SP match the oracle's (the idiomatic routine replaces the Z80 stack with the JS call
 * stack, so it never touches pc/SP itself — the harness supplies the single return).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Full contract diff: RAM − the stack scratch below the entry SP, pc, SP. Live-out is memory-only, so the
 *  register file is deliberately NOT compared. Returns human-readable mismatches. */
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
// values. 0x1486 is never dispatched here (see REACHABILITY) — its entry is crafted by
// poking. No overrides -> the machine runs pure translated behaviour, so the oracle's
// m.call(0x0616/0x15fa/0x057c/0x309f) resolve to the translated callees.
function attractBase(frames = 300) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

const clearRing = (m) => { for (let l = 0xc0; l <= 0xff; l++) m.mem.write8(0x6000 | l, 0xff); };

// Stamp a crafted dispatch onto a clone of `baseM`: a stack with a plausible caller return
// (so the terminal `ret` has a sane target), then the arm-forcing pokes.
function craft(baseM, poke) {
  const m = baseM.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR); // the caller-return the terminal `ret` pops (lands in STACK_SCRATCH)
  if (poke) poke(m);
  return m;
}

// A valid MID-RUN machine: run the oracle's INIT once (with a row-0 slot match so SLOT_PTR
// is a real table row), then poke a sane VRAM sprite dest (0x7641) into that row's iy+4/5,
// so the sprite-animate render (0x057c) writes real video cells rather than a wild pointer.
function runningBase() {
  const init = craft(attractBase(), (m) => {
    m.mem.write8(SUBSTATE_TIMER, 0); // force INIT
    m.mem.write8(SLOT_TABLE, 0x01); // key for 0x600E==0 is 1 -> match at row 0
  });
  const r = init.clone();
  oracle(r); // seeds the block, SLOT_PTR = 0x611C
  r.mem.write8(SLOT_TABLE + 4, 0x41); // iy+4
  r.mem.write8(SLOT_TABLE + 5, 0x76); // iy+5  -> IX = 0x7641 (valid VRAM)
  r.regs.sp = 0x6c00;
  return r.clone();
}

// -- 0. justification: not reached in attract ---------------------------------

test("REACHABILITY: 0x1486 is not dispatched in a plain attract window (justifies crafted entries)", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(2000);
  assert.equal(count, 0, "0x1486 unexpectedly dispatched in attract — capture it instead of crafting");
  console.log("  REACHABILITY: 0 natural 0x1486 dispatches in a 2000-frame attract window");
});

// -- 1. EQUAL (init) ----------------------------------------------------------

test("EQUAL (init): runBonusItemValueDisplay == oracle across the setup + slot search", () => {
  const base = attractBase();
  const cases = [
    { name: "no-match", poke: (m) => {} },
    { name: "row-0 match", poke: (m) => { m.mem.write8(SLOT_TABLE, 0x01); } }, // key(600e=0)=1
    { name: "row-2 match (RLCA key)", poke: (m) => {
        m.mem.write8(SLOT_KEY_SRC, 0x02); // key = 2*2+1 = 5
        m.mem.write8(SLOT_TABLE + 2 * 0x22, 0x05);
      } },
  ];
  for (const { name, poke } of cases) {
    const entry = craft(base, (m) => { m.mem.write8(SUBSTATE_TIMER, 0); poke(m); });
    const diffs = contractDiffs(entry, runBonusItemValueDisplay);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    // Non-vacuous: init marked running and seeded the value.
    const o = runOracle(entry);
    assert.equal(o.mem.read8(SUBSTATE_TIMER), 0x01, `${name}: SUBSTATE_TIMER should be 1 (running)`);
    assert.equal(o.mem.read8(VALUE), 0x1e, `${name}: value should be seeded to 0x1E`);
  }
  console.log("  EQUAL/init: no-match, row-0, row-2(RLCA) — identical to the oracle, pc/SP aligned");
});

// -- 2. EQUAL (running) -------------------------------------------------------

test("EQUAL (running): runBonusItemValueDisplay == oracle across every per-frame branch", () => {
  const rb = runningBase();
  const cases = [
    { name: "no value tick", poke: (m) => { m.mem.write8(DISPLAY_TIMER, 5); m.mem.write8(P1_INPUT, 0); } },
    { name: "value tick (BCD)", poke: (m) => { m.mem.write8(DISPLAY_TIMER, 1); m.mem.write8(VALUE, 25); m.mem.write8(P1_INPUT, 0); } },
    { name: "col stamp", poke: (m) => { m.mem.write8(P1_INPUT, 0x80); m.mem.write8(POS_INDEX, 3); m.mem.write16(VIDEO_PTR, 0x75e8); m.mem.write8(DISPLAY_TIMER, 5); } },
    { name: "col floor no-op (0x7588)", poke: (m) => { m.mem.write8(P1_INPUT, 0x80); m.mem.write8(POS_INDEX, 3); m.mem.write16(VIDEO_PTR, 0x7588); m.mem.write8(DISPLAY_TIMER, 5); } },
    { name: "col advance wrap (pos 0x1C -> 0x7608)", poke: (m) => { m.mem.write8(P1_INPUT, 0x80); m.mem.write8(POS_INDEX, 0x1c); m.mem.write16(VIDEO_PTR, 0x75e8); m.mem.write8(DISPLAY_TIMER, 5); } },
    { name: "col advance no-wrap", poke: (m) => { m.mem.write8(P1_INPUT, 0x80); m.mem.write8(POS_INDEX, 0x1c); m.mem.write16(VIDEO_PTR, 0x7000); m.mem.write8(DISPLAY_TIMER, 5); } },
    { name: "low-bit divider counting", poke: (m) => { m.mem.write8(P1_INPUT, 0x01); m.mem.write8(POS_RELOAD, 0x0a); m.mem.write8(DISPLAY_TIMER, 5); } },
    { name: "low-bit up move", poke: (m) => { m.mem.write8(P1_INPUT, 0x01); m.mem.write8(POS_RELOAD, 0x01); m.mem.write8(POS_INDEX, 5); m.mem.write8(DISPLAY_TIMER, 5); } },
    { name: "low-bit up wrap (0x1D -> 0)", poke: (m) => { m.mem.write8(P1_INPUT, 0x01); m.mem.write8(POS_RELOAD, 0x01); m.mem.write8(POS_INDEX, 0x1d); m.mem.write8(DISPLAY_TIMER, 5); } },
    { name: "low-bit down move", poke: (m) => { m.mem.write8(P1_INPUT, 0x03); m.mem.write8(POS_RELOAD, 0x01); m.mem.write8(POS_INDEX, 5); m.mem.write8(DISPLAY_TIMER, 5); } },
    { name: "low-bit down wrap (0 -> 0x1D)", poke: (m) => { m.mem.write8(P1_INPUT, 0x03); m.mem.write8(POS_RELOAD, 0x01); m.mem.write8(POS_INDEX, 0); m.mem.write8(DISPLAY_TIMER, 5); } },
    { name: "no direction", poke: (m) => { m.mem.write8(P1_INPUT, 0x00); m.mem.write8(POS_RELOAD, 5); m.mem.write8(DISPLAY_TIMER, 5); } },
    { name: "anim toggle 0->1", poke: (m) => { m.mem.write8(P1_INPUT, 0); m.mem.write8(DISPLAY_TIMER, 5); m.mem.write8(ANIM_TIMER, 1); m.mem.write8(SPRITE_TOGGLE, 0); } },
    { name: "anim toggle 1->0", poke: (m) => { m.mem.write8(P1_INPUT, 0); m.mem.write8(DISPLAY_TIMER, 5); m.mem.write8(ANIM_TIMER, 1); m.mem.write8(SPRITE_TOGGLE, 1); } },
  ];
  for (const { name, poke } of cases) {
    const entry = craft(rb, poke);
    const diffs = contractDiffs(entry, runBonusItemValueDisplay);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }

  // Non-vacuous: the value-tick arm really wrote the two on-screen digit cells (24 -> 2,4).
  const tickEntry = craft(rb, (m) => { m.mem.write8(DISPLAY_TIMER, 1); m.mem.write8(VALUE, 25); m.mem.write8(P1_INPUT, 0); });
  const to = runOracle(tickEntry);
  assert.equal(to.mem.read8(VALUE), 24, "value should tick 25 -> 24");
  assert.equal(to.mem.read8(VALUE_ONES_CELL), 4, "ones digit cell should be 4");
  assert.equal(to.mem.read8(VALUE_TENS_CELL), 2, "tens digit cell should be 2");
  console.log(`  EQUAL/running: ${cases.length} per-frame branch arms identical to the oracle, pc/SP aligned`);
});

// -- 3. EQUAL (exit) ----------------------------------------------------------

test("EQUAL (exit): both EXIT triggers — runBonusItemValueDisplay == oracle across teardown", () => {
  const rb = runningBase();
  const cases = [
    { name: "value -> 0", poke: (m) => { clearRing(m); m.mem.write8(DISPLAY_TIMER, 1); m.mem.write8(VALUE, 1); m.mem.write8(P1_INPUT, 0); } },
    { name: "column walk pos 0x1D", poke: (m) => { clearRing(m); m.mem.write8(P1_INPUT, 0x80); m.mem.write8(POS_INDEX, 0x1d); m.mem.write8(DISPLAY_TIMER, 5); } },
  ];
  for (const { name, poke } of cases) {
    const entry = craft(rb, poke);
    const diffs = contractDiffs(entry, runBonusItemValueDisplay);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    // Non-vacuous, and the teardown effects are exactly as claimed.
    const o = runOracle(entry);
    assert.ok(changedAddrs(entry, o, entry.regs.sp).length > 0, `${name}: exit arm wrote nothing — vacuous`);
    assert.equal(o.mem.read8(SUBSTATE_TIMER), 0x80, `${name}: SUBSTATE_TIMER should be 0x80 (done)`);
    const before = entry.mem.read8(GAME_SUBSTATE);
    assert.equal(o.mem.read8(GAME_SUBSTATE), (before - 1) & 0xff, `${name}: GAME_SUBSTATE should be stepped back by 1`);
  }
  console.log("  EQUAL/exit: value->0 + column-walk-0x1D — identical to the oracle, pc/SP aligned");
});

// -- 4. TEETH -----------------------------------------------------------------

// Faithful reimplementations of the routine that call the SAME idiomatic callees, each with
// ONE injected bug, so the diff proves it catches a real corruption. `bug` selects the flaw.
function rotl8(v) { return ((v << 1) | (v >> 7)) & 0xff; }

function faithfulTwin(m, bug) {
  const { regs, mem } = m;
  drawCreditDisplay(m);

  if (mem.read8(SUBSTATE_TIMER) === 0) {
    mem.write8(0x7d86, 0); mem.write8(0x7d87, 0);
    mem.write8(SUBSTATE_TIMER, 1);
    mem.write8(POS_RELOAD, 0x0a); mem.write8(SPRITE_TOGGLE, 0); mem.write8(ANIM_TIMER, 0x10);
    mem.write8(VALUE, 0x1e); mem.write8(DISPLAY_TIMER, 0x3e); mem.write8(POS_INDEX, 0);
    mem.write16(VIDEO_PTR, 0x75e8);
    const key = (rotl8(mem.read8(SLOT_KEY_SRC)) + 1) & 0xff;
    let slot = SLOT_TABLE;
    for (let i = 0; i < 4; i++) { if (mem.read8(slot) === key) break; slot = (slot + 0x22) & 0xffff; }
    mem.write16(SLOT_PTR, slot);
    mem.write16(0x603a, (slot - 0x0d) & 0xffff);
    regs.b = 0; regs.c = mem.read8(POS_INDEX); positionBonusItemSprite(m);
  }

  const dt = (mem.read8(DISPLAY_TIMER) - 1) & 0xff;
  mem.write8(DISPLAY_TIMER, dt);
  if (dt === 0) {
    mem.write8(DISPLAY_TIMER, 0x3e);
    const value = (mem.read8(VALUE) - 1) & 0xff;
    mem.write8(VALUE, value);
    if (value === 0) { twinExit(m, bug); return; }
    let ones = value, tens = 0;
    while (ones >= 0x0a) { ones -= 0x0a; tens = (tens + 1) & 0xff; }
    mem.write8(bug === "digit" ? 0x7553 : VALUE_ONES_CELL, ones); // BUG(digit): wrong ones cell
    mem.write8(VALUE_TENS_CELL, tens);
  }

  const savedDivider = mem.read8(POS_RELOAD);
  mem.write8(POS_RELOAD, 0x0a);
  const input = mem.read8(P1_INPUT);
  if (input & 0x80) {
    const pos = mem.read8(POS_INDEX);
    if (pos === 0x1d) { twinExit(m, bug); return; }
    if (pos === 0x1c) {
      const cur = mem.read16(VIDEO_PTR); const next = (cur + 0x20) & 0xffff;
      if (next === 0x7608) { mem.write8(0x75e8, 0x10); mem.write16(VIDEO_PTR, 0x75e8); }
      else { mem.write8(next, 0x10); mem.write16(VIDEO_PTR, next); }
    } else {
      const cur = mem.read16(VIDEO_PTR);
      if (cur !== 0x7588) { mem.write8(cur, (pos + 0x11) & 0xff); mem.write16(VIDEO_PTR, (cur - 0x20) & 0xffff); }
    }
  } else if (input & 0x03) {
    const divider = (savedDivider - 1) & 0xff;
    if (divider !== 0) { mem.write8(POS_RELOAD, divider); }
    else {
      let pos;
      if (input & 0x02) { const d = (mem.read8(POS_INDEX) - 1) & 0xff; pos = (d & 0x80) ? 0x1d : d; }
      else { const i = (mem.read8(POS_INDEX) + 1) & 0xff; pos = i === 0x1e ? 0 : i; }
      mem.write8(POS_INDEX, pos); regs.b = 0; regs.c = pos; positionBonusItemSprite(m);
    }
  } else {
    mem.write8(POS_RELOAD, 0x01);
  }

  const at = (mem.read8(ANIM_TIMER) - 1) & 0xff;
  mem.write8(ANIM_TIMER, at);
  if (at !== 0) return;
  let source;
  if (mem.read8(SPRITE_TOGGLE) !== 0) { mem.write8(SPRITE_TOGGLE, 0); source = (mem.read16(SLOT_PTR) + 3) & 0xffff; }
  else { mem.write8(SPRITE_TOGGLE, 1); source = 0x01bf; }
  const iy = mem.read16(SLOT_PTR);
  regs.de = source;
  regs.ix = mem.read8((iy + 4) & 0xffff) | (mem.read8((iy + 5) & 0xffff) << 8);
  renderBcdColumn(m);
  mem.write8(ANIM_TIMER, 0x10);
}

function twinExit(m, bug) {
  const { regs, mem } = m;
  mem.write8(mem.read16(SLOT_PTR), 0);
  mem.write8(SUBSTATE_TIMER, 0x80);
  const step = bug === "phase" ? +1 : -1; // BUG(phase): step FORWARD not back
  mem.write8(GAME_SUBSTATE, (mem.read8(GAME_SUBSTATE) + step) & 0xff);
  const dst = mem.read16(0x603a);
  for (let i = 0; i < 0x0c; i++) mem.write8((dst + i) & 0xffff, mem.read8((0x75e8 - 0x20 * i) & 0xffff));
  for (let arg = 0x14; arg <= 0x18; arg++) { regs.de = 0x0300 | arg; enqueueTask(m); }
  regs.de = 0x031a; enqueueTask(m);
}

test("TEETH: the wrong-phase-step and wrong-digit-cell twins are CAUGHT", () => {
  const rb = runningBase();

  // (a) wrong phase step: the exit arm — GAME_SUBSTATE moves the wrong way.
  const exitEntry = craft(rb, (m) => { clearRing(m); m.mem.write8(DISPLAY_TIMER, 1); m.mem.write8(VALUE, 1); m.mem.write8(P1_INPUT, 0); });
  const phaseDiffs = contractDiffs(exitEntry, (m) => faithfulTwin(m, "phase"));
  assert.ok(phaseDiffs.length > 0, "the wrong-phase-step twin escaped — the gate is worthless");
  assert.ok(
    phaseDiffs.some((d) => d.includes(hx(GAME_SUBSTATE))),
    `expected the wrong-phase-step twin caught at ${hx(GAME_SUBSTATE)}, got: ${phaseDiffs.join("; ")}`,
  );
  // …and it PASSES on a non-exit arm (no bug exercised) — proving it is a targeted flaw.
  const noExit = craft(rb, (m) => { m.mem.write8(DISPLAY_TIMER, 5); m.mem.write8(P1_INPUT, 0); });
  assert.equal(contractDiffs(noExit, (m) => faithfulTwin(m, "phase")).length, 0, "phase twin should agree off the exit arm");

  // (b) wrong digit cell: the value-tick arm — the ones digit lands in the wrong VRAM cell.
  const tickEntry = craft(rb, (m) => { m.mem.write8(DISPLAY_TIMER, 1); m.mem.write8(VALUE, 25); m.mem.write8(P1_INPUT, 0); });
  const digitDiffs = contractDiffs(tickEntry, (m) => faithfulTwin(m, "digit"));
  assert.ok(digitDiffs.length > 0, "the wrong-digit-cell twin escaped — the gate is worthless");
  // …and it PASSES when no value tick happens (bug not exercised).
  const noTick = craft(rb, (m) => { m.mem.write8(DISPLAY_TIMER, 5); m.mem.write8(P1_INPUT, 0); });
  assert.equal(contractDiffs(noTick, (m) => faithfulTwin(m, "digit")).length, 0, "digit twin should agree with no value tick");

  console.log(`  TEETH: wrong-phase-step caught (${phaseDiffs[0]}); wrong-digit-cell caught (${digitDiffs[0]})`);
});
