// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for clearScreenAndAdvanceSubstate (ROM 0x07c3) — the attract
 * state-1 sub-state step that CLEARS the screen (call 0x0874) then INCREMENTS the
 * sub-state index at GAME_SUBSTATE (0x600A).
 *
 * loc_07c3 WRITES memory (the clear regions of 0x0874 — video RAM 0x7404.. + the
 * 0x7522/0x7523 columns + sprite buffer 0x6900-0x6A7F — plus a `+1` RMW on 0x600A)
 * and reads NOTHING register-wise: every operand is an immediate or the fixed
 * 0x600A byte. So it is validated by capture/clone/replay on a FRESH clone per case
 * — never by reusing one machine, never on the full register file, never on cycles.
 * The contract compared is RAM (minus the stack scratch below the entry SP); there are no live-out
 * registers (the `inc (hl)` leaves Z/S/A dead — the rst-0x28 sub-state dispatch
 * returns up the NMI path, which consumes none of them). SP/PC are not compared —
 * the idiomatic layer drops the `ret`'s stack/PC bookkeeping (JS call stack).
 *
 *   1. REALISM — hook 0x07c3 in a real attract run; it dispatches once (state-1
 *      sub-state 5) inside a ~3000-frame window. For each real dispatch, run oracle
 *      vs clearScreenAndAdvanceSubstate on two fresh clones and confirm identical
 *      RAM (ex-stack) — this exercises both the clear and the real 0x600A inc.
 *
 *   2. CRAFTED (footprint + inc-wrap) — because the routine reads nothing, one start
 *      state per case with the clear regions painted to a SENTINEL (distinct from
 *      the fill bytes 0x10 / 0x00) and 0x600A poked across a value sweep INCLUDING
 *      the 8-bit wrap edge 0xFF->0x00, identically on both sides, pins BOTH the exact
 *      clear footprint AND that the inc lands on 0x600A with byte wrap. Any stray or
 *      missing write shows sentinel-vs-fill (regions) or a lone 0x600A diff (inc), so
 *      the RAM gate bites.
 *
 *   3. TEETH — two deliberately-broken twins MUST be caught: (a) a DOUBLE-INCREMENT
 *      of 0x600A (wrong sub-state advance) — caught by the 0x600A byte on every
 *      entry; and (b) a SKIP-CLEAR (advance only, screen not blanked) — caught on the
 *      sentinel entry, where the un-cleared regions hold the sentinel vs the oracle's
 *      fill bytes.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-07c3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_07c3 as oracle } from "../../translated/loc_07c3.js";
import { loc_0874 as oracle0874 } from "../../translated/loc_0874.js";
import { clearScreenAndAdvanceSubstate } from "../clearScreenAndAdvanceSubstate.js";
import { clearPlayfieldAndSprites } from "../clearPlayfieldAndSprites.js";
import { Machine } from "../../machine.js";
import { SPRITE_BUFFER, GAME_SUBSTATE, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x07c3;
const SPRITE_BUFFER_BYTES = 0x180;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- comparison plumbing ------------------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
function firstRamDiffOutsideStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

function diffAgainstOracle(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return firstRamDiffOutsideStack(a, b, entry.regs.sp);
}

/**
 * Hook `addr` in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper clones the entry state, then runs the ORACLE so the host game proceeds
 * undisturbed to a clean stop. (loc_07c3 is rare in attract, so the caller passes a
 * ~3000-frame window for it; 0x0874 fires early and is used as a cheap crafted base.)
 */
function captureDispatches(addr, runFn, K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[addr, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return runFn(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

/**
 * A cheap valid mid-attract machine to derive crafted entries from. The routine
 * reads no register input, so any legal machine state is a fine base; 0x0874 (the
 * clear) fires early (~frame 518), so hooking it yields a base without a 3000-frame
 * run. We snapshot and let the oracle 0x0874 proceed.
 */
function craftedBase() {
  const [base] = captureDispatches(0x0874, oracle0874, 1, 700);
  assert.ok(base, "need one real 0x0874 dispatch to derive crafted entries from");
  return base;
}

/**
 * Paint every cell the clear could touch — all of video RAM (0x7400-0x77FF) and a
 * guard-banded span around the sprite buffer — with `sentinel`, identically on both
 * sides, and poke GAME_SUBSTATE to `substate`. Leaves 0x600A itself at `substate`
 * (outside the painted regions) so the inc is measured cleanly.
 */
function craftSentinelEntry(base, sentinel, substate) {
  const w = base.clone();
  for (let a = 0x7400; a <= 0x77ff; a++) w.mem.write8(a, sentinel);
  for (let a = SPRITE_BUFFER - 0x10; a < SPRITE_BUFFER + SPRITE_BUFFER_BYTES + 0x10; a++) {
    w.mem.write8(a & 0xffff, sentinel);
  }
  w.mem.write8(GAME_SUBSTATE, substate & 0xff);
  return w;
}

// -- 1. REALISM (captured dispatches) -----------------------------------------

test("REALISM: real captured 0x07c3 dispatches — RAM (ex-stack) matches the oracle", () => {
  const caps = captureDispatches(TARGET, oracle, 8, 3100);
  assert.ok(caps.length >= 1, "expected at least one real 0x07c3 dispatch during attract");

  for (const cap of caps) {
    assert.equal(cap.mem.read8(GAME_SUBSTATE), 5, "0x07c3 is table index 5 → GAME_SUBSTATE==5 at entry");
    const ram = diffAgainstOracle(cap, clearScreenAndAdvanceSubstate);
    assert.equal(ram, null, ram && `RAM diff at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`);
  }
  console.log(`  REALISM: ${caps.length} real 0x07c3 dispatch(es) — identical RAM (ex-stack)`);
});

// -- 2. CRAFTED (footprint + inc-wrap) ----------------------------------------

test("CRAFTED: sentinel + 0x600A sweep pin the clear footprint AND the wrapping inc", () => {
  const base = craftedBase();

  const SUBSTATES = [0x00, 0x01, 0x04, 0x05, 0x7f, 0x80, 0xfe, 0xff];
  // Sentinels distinct from the fill bytes (0x10 playfield/columns, 0x00 sprite buf).
  const SENTINELS = [0xee, 0x55, 0xaa, 0x01, 0xff];

  let count = 0;
  for (const substate of SUBSTATES) {
    for (const sentinel of SENTINELS) {
      const w = craftSentinelEntry(base, sentinel, substate);
      const ram = diffAgainstOracle(w, clearScreenAndAdvanceSubstate);
      assert.equal(
        ram,
        null,
        ram &&
          `mismatch (substate ${hx(substate)}, sentinel ${hx(sentinel)}) at ${hx(ram.addr)}: ` +
            `oracle=${ram.a} cand=${ram.b}`,
      );
      count++;
    }
  }
  console.log(`  CRAFTED: ${count} sentinel/substate entries — clear footprint + wrapping inc identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin A: advances GAME_SUBSTATE by TWO (wrong sub-state) after the clear. */
function brokenDoubleInc(m) {
  clearPlayfieldAndSprites(m);
  const v = m.mem.read8(GAME_SUBSTATE);
  m.mem.write8(GAME_SUBSTATE, (v + 2) & 0xff); // BUG: should be +1
}

/** Broken twin B: advances the sub-state but SKIPS the clear (screen not blanked). */
function brokenSkipClear(m) {
  const v = m.mem.read8(GAME_SUBSTATE);
  m.mem.write8(GAME_SUBSTATE, (v + 1) & 0xff); // BUG: dropped the clearPlayfieldAndSprites call
}

test("TEETH: double-increment and skip-clear twins are both CAUGHT", () => {
  const base = craftedBase();

  const eDouble = craftSentinelEntry(base, 0xee, 0x05);
  const dDouble = diffAgainstOracle(eDouble, brokenDoubleInc);
  assert.notEqual(dDouble, null, "the RAM gate FAILED to catch a double-increment of GAME_SUBSTATE — it is worthless");
  assert.equal(dDouble.addr, GAME_SUBSTATE, "the double-increment must diverge exactly at GAME_SUBSTATE (0x600A)");
  assert.equal(dDouble.a, 0x06, "oracle advances 5 -> 6");
  assert.equal(dDouble.b, 0x07, "broken twin advances 5 -> 7");

  // (b) Skip-clear: caught on the sentinel entry, where a clear region the oracle
  //     filled still holds the sentinel. The FIRST diff by dump order is the sprite
  //     buffer at 0x6900 (work RAM dumps before VRAM); assert the meaning
  //     order-agnostically — oracle wrote a fill byte, the broken twin left 0xEE.
  const eSkip = craftSentinelEntry(base, 0xee, 0x05);
  const dSkip = diffAgainstOracle(eSkip, brokenSkipClear);
  assert.notEqual(dSkip, null, "the RAM gate FAILED to catch a skipped screen-clear — it is worthless");
  assert.ok(
    dSkip.addr === 0x6900 || (dSkip.addr >= 0x7400 && dSkip.addr <= 0x77ff),
    `skip-clear diff must land in a clear region (sprite buffer or VRAM), got ${hx(dSkip.addr)}`,
  );
  assert.ok(dSkip.a === 0x00 || dSkip.a === 0x10, "oracle fills the clear region with a blank byte (0x00 / 0x10)");
  assert.equal(dSkip.b, 0xee, "broken twin leaves the sentinel (never cleared)");

  console.log(
    `  TEETH: double-inc caught at ${hx(dDouble.addr)} (oracle=${dDouble.a} broken=${dDouble.b}); ` +
      `skip-clear caught at ${hx(dSkip.addr)} (oracle=${dSkip.a} broken=${dSkip.b})`,
  );
});
