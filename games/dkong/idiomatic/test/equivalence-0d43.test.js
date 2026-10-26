// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for stampRivetBoardBands (ROM 0x0D43) — "stamp the two-band
 * tile motif into two fixed tilemap rows during 100m-rivet (board 4) setup". It runs
 * the shared filler stampTwoTileBands (ROM 0x0D4C) twice: HL=0x7687 then HL=0x7547.
 * Each pass writes 0xFD across four cells (base..base+3), skips a 28-cell gap
 * (DE=0x001C), then writes 0xFC across four cells (base+0x20..base+0x23) — sixteen
 * video-RAM writes in all (eight per row).
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline), not the retired strict
 * whole-machine one. The routine WRITES video RAM, so every case uses a FRESH clone per
 * side. The ORACLE (translated/sub_0d43, which reaches its filler through m.call) runs
 * on one clone, stampRivetBoardBands (which calls the decompiled stampTwoTileBands
 * directly) on another, and they are compared on the go-forward contract:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP) only.
 *
 * pc and SP are deliberately NOT compared. The oracle uses push16/m.step/m.ret, so it
 * advances pc and its callees pop SP; both are the modelled step/stack ABI the direct-
 * call layer replaces with a JS return. STACK_SCRATCH is masked because the oracle's
 * `push16(0x0d49)` writes a dead return address there that the direct-call candidate
 * never writes — a benign, non-propagating difference in dead scratch. Memory (the
 * sixteen video-RAM cells) is the only live-out: the caller loc_0c92 does `ld hl,0x7d86`
 * right after the call (overwriting HL before reading it), B/DE are reloaded and no flag
 * is tested, so HL/B/DE and all flags are dead.
 *
 * REACHABILITY. stampRivetBoardBands is board-4-only (100m rivet setup: loc_0c92's
 * board-4 arm at 0x0CB6 does `call 0x0d43`) and attract only plays 25m, so it NEVER
 * dispatches in a plain run. Following the sibling gates (0x0D4C / 0x0D00), the test
 * forces the real dispatch with an IDENTICAL-BOTH-SIDES board poke (Karl-sanctioned
 * "poke the board state to reach a state for validation"): at frame 100 set
 * GAME_STATE=3, GAME_SUBSTATE=10 (board setup), SUBSTATE_TIMER=1, BOARD=4 (100m rivet).
 * sub_0d43 then fires under the vblank NMI (~frame 102) — a REAL captured entry (real
 * register file, real stack, real board).
 *
 * Jobs:
 *   1. EQUAL (real forced dispatch) — oracle vs stampRivetBoardBands on fresh clones of
 *      each captured entry leave identical RAM (−STACK_SCRATCH); the candidate is read
 *      back to confirm it genuinely stamped both rows.
 *   2. WRITE-SET (captured) — the oracle's writes are EXACTLY the sixteen tilemap cells
 *      (0xFD/0xFC bands at 0x7687 and 0x7547); every other changed byte lies in the dead
 *      STACK_SCRATCH region (the push16). Documents the full footprint.
 *   3. CRAFTED (overwrite) — pre-dirty the sixteen destination cells to 0xAA identically
 *      both sides; both overwrite them and RAM stays identical.
 *   4. CRAFTED (input-independence) — garbage in HL/B/C/D/E/A and a far RAM byte,
 *      identically both sides, does not change the output — the two bases are internal
 *      ROM immediates, so HL on entry is irrelevant (the routine reloads it).
 *   5. TEETH — a twin with a WRONG second row base (0x7647 instead of 0x7547, a plausible
 *      off-by-0x100 slip) drops the second row's bands onto the wrong cells and MUST be
 *      caught; on a pre-dirtied crafted state the first divergence is named at 0x7547.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0d43.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0d43 as oracle } from "../../translated/loc_0d43.js";
import { stampRivetBoardBands } from "../stampRivetBoardBands.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0d43;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The two real tilemap row bases sub_0d43 hard-codes, in order.
const BASES = [0x7687, 0x7547];

// The eight cells one base stamps: 0xFD at base..base+3, 0xFC at base+0x20..base+0x23.
function writeSetFor(base) {
  const cells = [];
  for (let i = 0; i < 4; i++) cells.push({ addr: (base + i) & 0xffff, val: 0xfd });
  for (let i = 0; i < 4; i++) cells.push({ addr: (base + 0x20 + i) & 0xffff, val: 0xfc });
  return cells;
}
// All sixteen cells the routine stamps (both rows).
const ALL_CELLS = BASES.flatMap(writeSetFor);

/**
 * `from` ACCUMULATES the absolute cursor across masked stack diffs. (The sibling gates'
 * copy of this helper reset `from = d.offset + 1` from the subarray-relative offset,
 * which oscillates and never terminates once there are TWO dead-stack diffs — dormant
 * there because those oracles never write the stack, but this oracle's `push16` writes
 * two stack bytes, so the cursor must advance absolutely, not be reassigned.)
 */
function ramDiffMinusStack(ma, mb, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const a = ma.dumpState();
  const b = mb.dumpState();
  let from = 0;
  for (;;) {
    const d = firstStateDiff(a.subarray(from), b.subarray(from), (off) => ma.stateOffsetToAddr(off + from));
    if (!d || !dead(d.addr)) return d;
    from += d.offset + 1; // advance the absolute cursor past this masked stack byte
  }
}

// Identical-both-sides one-shot poke that forces board-4 (100m rivet) setup; loc_0c92's
// board-4 arm does `call 0x0d43`. dur 1 so the game manages state from frame 101.
const POKE_FRAME = 100;
const FORCE_0D43_POKE = [
  { addr: 0x6005, val: 0x03, frame: POKE_FRAME, dur: 1 }, // GAME_STATE = 3 (in-game dispatch)
  { addr: 0x600a, val: 0x0a, frame: POKE_FRAME, dur: 1 }, // GAME_SUBSTATE = 10 -> board setup
  { addr: 0x6009, val: 0x01, frame: POKE_FRAME, dur: 1 }, // SUBSTATE_TIMER = 1 (proceeds this frame)
  { addr: 0x6227, val: 0x04, frame: POKE_FRAME, dur: 1 }, // BOARD = 4 (100m rivet -> sub_0d43)
];
const FRAMES = 110; // the forced dispatch lands ~frame 102

function captureDispatches(K) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.pokes = FORCE_0D43_POKE.map((p) => ({ ...p }));
  host.runFrames(FRAMES);
  return caps;
}

const CAPS = ROM_PRESENT ? captureDispatches(8) : [];


test("EQUAL: real forced board-4 dispatch — stampRivetBoardBands == oracle in RAM (−stack)", () => {
  assert.ok(CAPS.length >= 1, `expected >=1 real 0x0D43 dispatch after the board-4 poke, got ${CAPS.length}`);

  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    stampRivetBoardBands(c);

    const d = ramDiffMinusStack(o, c, cap.regs.sp);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} stamp=${d.b}`);

    // ...and the candidate genuinely stamped both rows (not merely agreed with the oracle).
    for (const cell of ALL_CELLS) {
      assert.equal(
        c.mem.read8(cell.addr), cell.val,
        `stamp left ${hx(cell.addr)} = ${hx(c.mem.read8(cell.addr))} (expected ${hx(cell.val)})`,
      );
    }
  }
  console.log(`  EQUAL: ${CAPS.length} real board-4 dispatch(es) identical (RAM −stack); rows ${BASES.map(hx).join(",")}`);
});


test("WRITE-SET: the oracle writes exactly the 16 tilemap cells; every other change is dead stack", () => {
  for (const cap of CAPS) {
    const before = cap.clone();
    const after = cap.clone();
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();

    const changed = [];
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] !== a1[off]) changed.push({ addr: after.stateOffsetToAddr(off), from: b0[off], to: a1[off] });
    }
    const want = new Map(ALL_CELLS.map((c) => [c.addr, c.val]));
    const seen = new Set();
    const dead = deadStackBelow(STACK_SCRATCH, cap.regs.sp);
    for (const ch of changed) {
      if (dead(ch.addr)) continue; // the push16 return address — dead scratch, masked
      assert.ok(want.has(ch.addr), `oracle wrote unexpected addr ${hx(ch.addr)} (${ch.from}->${ch.to})`);
      assert.equal(ch.to, want.get(ch.addr), `wrong value ${hx(ch.to)} at ${hx(ch.addr)}`);
      seen.add(ch.addr);
    }
    assert.equal(seen.size, 16, `expected all 16 tilemap cells written, saw ${seen.size}`);
    console.log(`  WRITE-SET: ${seen.size} tilemap bytes (0xFD x4 + 0xFC x4 per row @ ${BASES.map(hx).join(",")}); rest dead stack`);
  }
});


test("CRAFTED: pre-dirtied destination cells are overwritten identically by both sides", () => {
  const o = CAPS[0].clone();
  const oFloor = o.regs.sp;
  const c = CAPS[0].clone();
  // Identical surgical nudge on BOTH sides: dirty every destination byte to 0xAA.
  for (const cell of ALL_CELLS) {
    o.mem.write8(cell.addr, 0xaa);
    c.mem.write8(cell.addr, 0xaa);
  }
  oracle(o);
  stampRivetBoardBands(c);

  const d = ramDiffMinusStack(o, c, oFloor);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} stamp=${d.b}`);
  for (const cell of ALL_CELLS) {
    assert.equal(c.mem.read8(cell.addr), cell.val, `stamp left ${hx(cell.addr)} = ${hx(c.mem.read8(cell.addr))} (expected ${hx(cell.val)})`);
  }
  console.log("  CRAFTED: 16 destination bytes dirtied to 0xAA -> both stamp 0xFD/0xFC, RAM identical");
});


test("CRAFTED: garbage in HL/B/C/D/E/A and far RAM (identical both sides) does not change the output", () => {
  const o = CAPS[0].clone();
  const oFloor = o.regs.sp;
  const c = CAPS[0].clone();
  // Identical unrelated nudge on both sides. The routine reloads HL from ROM immediates,
  // so even garbage in HL on entry must not move the output; ditto the rest of the file
  // and RAM it never touches.
  for (const mm of [o, c]) {
    mm.regs.hl = 0x1234;
    mm.regs.b = 0x22; mm.regs.c = 0x33;
    mm.regs.d = 0x44; mm.regs.e = 0x55; mm.regs.a = 0x11;
    mm.mem.write8(0x6300, 0x99); // a work-RAM byte outside the write set
  }
  oracle(o);
  stampRivetBoardBands(c);

  const d = ramDiffMinusStack(o, c, oFloor);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} stamp=${d.b}`);
  for (const cell of ALL_CELLS) {
    assert.equal(c.mem.read8(cell.addr), cell.val, `stamp left ${hx(cell.addr)} = ${hx(c.mem.read8(cell.addr))} (expected ${hx(cell.val)})`);
  }
  console.log("  CRAFTED: garbage HL/B/C/D/E/A + far RAM identical both sides -> output unchanged (bases are ROM immediates)");
});


/**
 * Broken twin: stamps the second row at base 0x7647 instead of 0x7547 (an off-by-0x100
 * slip), so the whole second row lands on the wrong cells. The first row agrees, so the
 * lowest-address divergence is at 0x7547 — the cell the oracle fills 0xFD that this twin
 * leaves untouched.
 */
function brokenSecondBase(m) {
  const { regs, mem } = m;
  for (const base of [0x7687, 0x7647]) { // BUG: second base must be 0x7547
    let addr = base;
    for (let i = 0; i < 4; i++) { mem.write8(addr, 0xfd); addr = (addr + 1) & 0xffff; }
    addr = (addr + 0x1c) & 0xffff;
    for (let i = 0; i < 4; i++) { mem.write8(addr, 0xfc); addr = (addr + 1) & 0xffff; }
  }
}

test("TEETH: a wrong second-row base is CAUGHT and names 0x7547", () => {
  // Captured state — a wrong second row must be caught somewhere.
  const o = CAPS[0].clone();
  const oFloor = o.regs.sp;
  const c = CAPS[0].clone();
  oracle(o);
  brokenSecondBase(c);
  const d = ramDiffMinusStack(o, c, oFloor);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong second-row base — it is worthless");

  // Crafted pre-dirtied state — both correct and broken destination cells set to 0xAA, so
  // the first divergence is deterministically 0x7547 (oracle 0xFD, broken leaves 0xAA).
  const o2 = CAPS[0].clone();
  const o2Floor = o2.regs.sp;
  const c2 = CAPS[0].clone();
  const dirty = [...ALL_CELLS, ...writeSetFor(0x7647)];
  for (const cell of dirty) {
    o2.mem.write8(cell.addr, 0xaa);
    c2.mem.write8(cell.addr, 0xaa);
  }
  oracle(o2);
  brokenSecondBase(c2);
  const d2 = ramDiffMinusStack(o2, c2, o2Floor);
  assert.notEqual(d2, null, "the gate FAILED to catch the wrong base on the crafted state");
  assert.equal(d2.addr, 0x7547, `crafted teeth caught the wrong address ${hx(d2.addr ?? 0)} (expected 0x7547)`);

  console.log(`  TEETH: wrong second-row base caught at ${hx(d2.addr)} (oracle=${hx(d2.a)} broken=${hx(d2.b)})`);
});
