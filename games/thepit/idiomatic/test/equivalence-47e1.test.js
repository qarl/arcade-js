// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for drawPlayerLabel (ROM 0x47e1) — the fixed vertical HUD/status panel
 * painter: seed the shared tile-plotter params and drive its five plot helpers to stamp
 * one tile column + colour column at screen column 1, row 12.
 *
 * drawPlayerLabel is only invoked while a game is running (round setup calls it for the 1-/2-
 * player modes; the in-play HUD loops call it), so it is NEVER dispatched during a plain
 * attract run — the natural-capture harness (unitEquivalence) would find no entry. This
 * is therefore a CRAFTED-ENTRY gate, the accepted fallback for an unreached arm:
 *
 *   - Capture a real mid-attract machine state (by hooking loc_3dae, which IS reached
 *     early in attract) so the one input the routine actually reads, the secondary
 *     game-state byte at 0x8002, and the ROM tables are all realistic.
 *   - Craft the drawPlayerLabel entry from it: give it a clean cold-boot stack (sp = 0x83ff)
 *     with one caller return address pushed, so the oracle's tail hand-off has somewhere
 *     to return.
 *   - Run the ORACLE on one clone and the idiomatic drawPlayerLabel on another and diff the
 *     OBSERVABLE contract.
 *
 * OBSERVABLE CONTRACT (why not the whole machine anymore). The dissolve replaced three
 * `m.call` helpers (0x3dae rowColToTileOffset, 0x3dc9 deriveTileWriteCursors, 0x3e01
 * fillColourColumn) with direct idiomatic calls. Those calls drop the Z80 return-address
 * pushes and — for the tail — the helper's `ret`, so the idiomatic routine leaves pc at
 * its entry value and SP two below the oracle's (the oracle's tail ret pops the crafted
 * caller return; the idiomatic plain-return does not). The leftover value registers are
 * likewise the routine's dead ABI now that the register-marshalling helpers no longer run
 * inline. So the gate compares the painted work/colour/video/sprite RAM — the routine's
 * only live-out — EXCLUDING pc, SP, the value registers, and the dead stack-scratch window
 * just below the entry SP (modelled the way equivalence-4c5f.test.js excludes its dead
 * saved-register bytes). The two remaining oracle helpers (0x3dea, 0x3ddb) are called
 * identically on both sides, so their stack effects cancel; the painted RAM is byte-for-
 * byte identical.
 *
 * TEETH (a green gate must be able to fail):
 *   - a broken twin of drawPlayerLabel that paints with the wrong fill byte MUST be caught;
 *   - corrupting one painted colour cell after the oracle runs MUST be caught.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-47e1.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_47e1 as oracle } from "../../translated/loc_47e1.js";
import { loc_3dae as real3dae } from "../../translated/loc_3dae.js";
import { drawPlayerLabel as idiomatic } from "../drawPlayerLabel.js";
import { rowColToTileOffset } from "../rowColToTileOffset.js";
import { deriveTileWriteCursors } from "../deriveTileWriteCursors.js";
import { fillColourColumn } from "../fillColourColumn.js";
import { makeMachineFactory } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const SEED_HOOK = 0x3dae; // a routine reached early in attract, used to grab a real state
const ACTIVE_PLAYER = 0x8002; // the one input drawPlayerLabel reads (its top-cell copy source)
const CALLER_RETURN = 0x032c; // a real caller return address (round setup's call site)
const PANEL_COLOUR_CELL = 0x8981; // colour-RAM cell for column 1, row 12 (a painted output)
const STACK_SCRATCH_BYTES = 8; // dead return-address / helper-scratch window below the entry SP
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async,
// so build the factory once up front (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/** Hook a reached routine and clone the machine at its first real dispatch. */
function captureAttractSeed(maxFrames) {
  let seed = null;
  const snapshot = new Map([[SEED_HOOK, (mm) => {
    if (seed === null) seed = mm.clone();
    return real3dae(mm); // let the host game proceed undisturbed
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(maxFrames);
  return seed;
}

/** Craft the drawPlayerLabel entry from a real seed: a clean cold-boot stack with one caller return address staged
 *  (so the oracle's tail ret has somewhere to land), and optionally the secondary game-state byte poked so the
 *  top-cell copy is exercised with different values. */
function craftEntry(seed, state2) {
  const e = seed.clone();
  if (state2 !== undefined) e.mem.write8(ACTIVE_PLAYER, state2);
  e.regs.sp = 0x83ff;
  e.push16(CALLER_RETURN);
  return e;
}

/** Run one implementation on a fresh clone of the entry. */
function runOn(entry, fn) {
  const c = entry.clone();
  fn(c);
  return c;
}

/** First differing RAM byte between the oracle run and a candidate run, EXCLUDING the dead stack-scratch window just
 *  below the entry SP (the dropped return-address pushes and the un-popped caller return live there and legitimately
 *  differ). Null when otherwise equal. */
function ramDiffOutsideStack(o, c, entrySP) {
  const da = o.dumpState();
  const db = c.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = o.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - STACK_SCRATCH_BYTES, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Compare a candidate against the oracle over the painted RAM (work + colour + video + sprite) outside the dead
 *  stack-scratch window. Returns { diffs, ram } (diffs empty == EQUAL). */
function contractDiffs(entry, fn) {
  const entrySP = entry.regs.sp;
  const o = runOn(entry, oracle);
  const c = runOn(entry, fn);
  const diffs = [];
  const ram = ramDiffOutsideStack(o, c, entrySP);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  return { diffs, ram };
}

test("EQUAL: idiomatic drawPlayerLabel == oracle on painted RAM from a real crafted entry, across secondary-state values", () => {
  const seed = captureAttractSeed(240);
  assert.ok(seed, "no attract seed captured — loc_3dae was not reached in 240 frames");

  const state2Values = [undefined, 0x00, 0x01, 0x02, 0x2b, 0xff];
  for (const s2 of state2Values) {
    const entry = craftEntry(seed, s2);
    const { diffs } = contractDiffs(entry, idiomatic);
    assert.equal(diffs.length, 0, `0x8002=${s2 === undefined ? "(real)" : hx(s2)}: ${diffs.join("; ")}`);
  }

  // Confirm the routine really paints (guards against a vacuously-equal no-op entry).
  const painted = runOn(craftEntry(seed, 0x01), idiomatic);
  assert.equal(painted.mem.read8(PANEL_COLOUR_CELL), 7, "panel colour cell was not painted");
  console.log(
    `  EQUAL: ${state2Values.length} crafted entries identical on painted RAM; ` +
      `panel colour cell ${hx(PANEL_COLOUR_CELL)} = 7`,
  );
});

/** Broken twin of the DISSOLVED drawPlayerLabel: paints the panel with the wrong fill byte (6, not 7). Same
 *  structure and the same two oracle helpers, so only the fill-driven cells differ. */
function brokenLoc47e1(m) {
  const { regs, mem } = m;
  mem.write8(0x8058, 1);
  mem.write8(0x8059, 12);
  rowColToTileOffset(m);
  deriveTileWriteCursors(m);
  mem.write8(0x8057, 6); // BUG: fill byte should be 7
  mem.write8(0x8055, 1); regs.ix = 0x8002; m.push16(0x4802); m.call(0x3dea);
  mem.write8(0x8055, 7); regs.ix = 0x49b1; m.push16(0x480e); m.call(0x3ddb);
  mem.write8(0x8055, 9); return fillColourColumn(m);
}

/** After the real routine, corrupt one painted colour cell — a pure output diff. */
function corruptedOutput(m) {
  idiomatic(m);
  m.mem.write8(PANEL_COLOUR_CELL, m.mem.read8(PANEL_COLOUR_CELL) ^ 0xff);
}

test("TEETH: a wrong-fill-byte twin and a corrupted output cell are both CAUGHT", () => {
  const seed = captureAttractSeed(240);
  assert.ok(seed, "no attract seed captured");
  const entry = craftEntry(seed, 0x01);

  const twin = contractDiffs(entry, brokenLoc47e1);
  assert.ok(twin.diffs.length > 0, "the wrong-fill-byte twin escaped detection — the gate is worthless");

  const out = contractDiffs(entry, corruptedOutput);
  assert.ok(out.diffs.length > 0, "a corrupted painted colour cell escaped detection — the gate is worthless");
  assert.equal(
    out.ram && out.ram.addr,
    PANEL_COLOUR_CELL,
    `output corruption caught at the wrong address ${out.ram ? hx(out.ram.addr) : "(none)"}`,
  );

  console.log(`  TEETH: wrong-fill twin caught (${twin.diffs[0]}); output corruption caught (${out.diffs[0]})`);
});
