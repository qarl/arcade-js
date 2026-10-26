// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceTileAnimForwardOnOdd (ROM 0x2405, Pooyan) — the odd-frame
 * tile-animation stepper. It bumps the parity tick (0x8f37) every call; on an EVEN result it returns
 * having touched only the tick. On an ODD result it dereferences the tile cursor (0x88be): if the tile
 * code under it has reached the wrap code (0x37) it steps the cursor forward one cell and reseeds it
 * (0x34); otherwise it animates the current cell's tile code up by one. The advanced cursor is stored
 * back. (The even-frame twin at 0x23ec walks the same cursor the other way.)
 *
 * CYCLE-FREE / memory-equivalence gate. Each case runs the oracle on a FRESH clone and the module on
 * another, compared on RAM (dumpState, minus stack scratch below the entry SP). The routine is memory-only (a plain-ret
 * "pattern A" callee — movePlayerDownAndTickStatusRender falls straight through, reading no register back), so no return.
 *
 * NOTE FOR THE LEAD: 0x8f37 is not yet in names.js. This module and test import TILE_ANIM_PARITY from
 * names.js; the flagged cell (proposed TILE_ANIM_PARITY = 0x8f37, the odd/even parity tick shared with
 * loc_23ec) must be added there for these files to resolve. See the leaf's unnamed_addrs report.
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — replay any real 0x2405 dispatch a boot happens to reach.
 *   2. CRAFTED (load-bearing) — even frame (tick only), odd + tile below wrap (animate in place),
 *      odd + tile at/above wrap (step + reseed), and an odd + wrap at a page boundary (cursor +1 is a
 *      full 16-bit increment). RAM identical each time.
 *   3. WRITE-SET — the oracle's writes stay within {tick, cursor word, the one tile cell(s)}.
 *   4. TEETH — a twin that reseeds the wrong tile code MUST be caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2405.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2405 as oracle } from "../../translated/loc_2405.js";
import { advanceTileAnimForwardOnOdd } from "../advanceTileAnimForwardOnOdd.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, TILE_ANIM_CURSOR, TILE_ANIM_PARITY } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x2405;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

const WRAP = 0x37; // tile code at/above which the cursor steps + reseeds
const SEED = 0x34; // reseed code stamped into the freshly-entered cell

/** First RAM difference on the go-forward contract: whole dump, skipping the dead stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), dead);
}

/** Machine with parity tick = `tick`, cursor -> `cursor`, and the tile at the cursor = `tile`. */
function craft(tick, cursor, tile) {
  const m = new Machine(ROM);
  m.mem.write8(TILE_ANIM_PARITY, tick);
  m.mem.write16(TILE_ANIM_CURSOR, cursor);
  m.mem.write8(cursor, tile);
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH: the ret only pops (reads) the word at SP
  return m;
}

// -- 1. CAPTURE (best-effort) -------------------------------------------------

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  try {
    const host = new Machine(ROM, { overrides: snap });
    host.runFrames(maxFrames);
  } catch {
    /* boot may unwind on an unimplemented path; keep whatever we captured */
  }
  return caps;
}

test("CAPTURE: real 0x2405 dispatches replay identically (if reached)", () => {
  const caps = ROM_PRESENT ? captureDispatches(24, 4000) : [];
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    advanceTileAnimForwardOnOdd(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CAPTURE: ${caps.length} real 0x2405 dispatch(es) replayed identically`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: even/odd + below/at/above wrap + page-boundary step — RAM identical", () => {
  const cases = [
    { name: "even frame (tick only)", tick: 0x01, cursor: 0x8420, tile: 0x10 }, // 0x01->0x02 even
    { name: "odd, tile below wrap (animate)", tick: 0x00, cursor: 0x8420, tile: 0x10 },
    { name: "odd, tile at wrap (step+reseed)", tick: 0x00, cursor: 0x8420, tile: WRAP },
    { name: "odd, tile above wrap (step+reseed)", tick: 0x00, cursor: 0x8420, tile: 0x38 },
    { name: "odd, wrap at page boundary", tick: 0x00, cursor: 0x84ff, tile: WRAP }, // +1 -> 0x8500
    { name: "odd, tile 0xff wraps in place", tick: 0x00, cursor: 0x8420, tile: 0xff }, // <wrap? 0xff>=0x37 -> step
  ];
  for (const { name, tick, cursor, tile } of cases) {
    const o = craft(tick, cursor, tile);
    const c = craft(tick, cursor, tile);
    oracle(o);
    advanceTileAnimForwardOnOdd(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CRAFTED: ${cases.length} parity/wrap cases identical (RAM −stack)`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle writes only the tick, the cursor word, and the tile cell(s)", () => {
  // Odd + at-wrap: touches tick, both cursor bytes (advanced), and the reseeded new cell.
  const cursor = 0x8420;
  const allowed = new Set([TILE_ANIM_PARITY, TILE_ANIM_CURSOR, (TILE_ANIM_CURSOR + 1) & 0xffff,
    cursor, (cursor + 1) & 0xffff]);
  const before = craft(0x00, cursor, WRAP);
  const after = before.clone();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = after.stateOffsetToAddr(off);
      assert.ok(allowed.has(addr), `oracle wrote unexpected addr ${hx(addr)}`);
    }
  }
  // The step+reseed landed: cursor advanced by 1 and the new cell holds SEED.
  assert.equal(after.mem.read16(TILE_ANIM_CURSOR), (cursor + 1) & 0xffff, "cursor should advance by 1");
  assert.equal(after.mem.read8((cursor + 1) & 0xffff), SEED, "new cell should hold the reseed code");
  console.log("  WRITE-SET: writes confined to tick + cursor word + tile cell(s)");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: reseeds the WRONG tile code on the step branch. */
function brokenStep(m) {
  const { mem8, mem16 } = m;
  mem8[TILE_ANIM_PARITY] = mem8[TILE_ANIM_PARITY] + 1;
  if ((mem8[TILE_ANIM_PARITY] & 1) === 0) return;
  let cursor = mem16[TILE_ANIM_CURSOR];
  if (mem8[cursor] >= WRAP) {
    cursor = (cursor + 1) & 0xffff;
    mem8[cursor] = (SEED ^ 0x01) & 0xff; // BUG: wrong reseed code
  } else {
    mem8[cursor] = mem8[cursor] + 1;
  }
  mem16[TILE_ANIM_CURSOR] = cursor;
}

test("TEETH: a wrong reseed code is caught at the new cursor cell", () => {
  const cursor = 0x8420;
  const o = craft(0x00, cursor, WRAP);
  const c = craft(0x00, cursor, WRAP);
  oracle(o);
  brokenStep(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong reseed code — it is worthless");
  assert.equal(d.addr, (cursor + 1) & 0xffff, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong reseed caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
