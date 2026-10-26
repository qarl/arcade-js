// SPDX-License-Identifier: GPL-3.0-only
//
// Memory-equivalence test for mirrorSpriteListVertically (ROM 0x0378) — flip-screen mirror of the
// 24-entry stride-4 sprite display list at 0x8840. Per entry: byte0/byte2 := -x - 0x10, byte1 keeps
// its low nibble but toggles its two flip bits, byte3 untouched. DE/B are loaded internally, so the
// routine takes NO register inputs and returns NO register (the caller tickCounterAndMirrorIfFlipped rets straight after).
//
// CYCLE-FREE / memory-equivalence gate: the routine WRITES RAM, so each case uses a FRESH clone per
// side. The go-forward contract is RAM only (dumpState minus stack scratch below the entry SP).
//
// Jobs:
//   1. CAPTURE (best-effort) — hook 0x0378 in a real run; any dispatch must agree in RAM.
//   2. CRAFTED — the load-bearing arm. Pre-dirtied list + varied byte patterns; both sides rewrite
//      the 0x60-byte list identically, and byte3 of each entry stays untouched.
//   3. TEETH — a twin that corrupts one list byte MUST be caught.
//
// Run: node --test games/pooyan/idiomatic/test/equivalence-0378.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0378 as oracle } from "../../translated/loc_0378.js";
import { mirrorSpriteListVertically } from "../mirrorSpriteListVertically.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SPRITE_DISPLAY_LIST } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x0378;
const ENTRIES = 0x18; // 24 entries
const LIST_LEN = ENTRIES * 4; // 0x60 bytes, 0x8840..0x889f
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, STACK_SCRATCH.hi - 0x10);

/** First RAM difference on the go-forward contract: whole dump minus stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/** Pre-dirty the 0x60-byte sprite list with a deterministic per-seed pattern. */
function craft(seed) {
  const m = new Machine(ROM);
  m.regs.sp = STACK_SCRATCH.hi - 0x10;
  for (let i = 0; i < LIST_LEN; i++) {
    m.mem.write8((SPRITE_DISPLAY_LIST + i) & 0xffff, (seed + i * 7) & 0xff);
  }
  return m;
}

const SEEDS = [0x00, 0x10, 0x7f, 0xc3, 0xff];

// -- 1. CAPTURE (best-effort) -------------------------------------------------

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  return caps;
}

const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0x0378 dispatches — module == oracle in RAM (−stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    mirrorSpriteListVertically(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: pre-dirtied list + varied patterns — list rewritten identically", () => {
  for (const seed of SEEDS) {
    const o = craft(seed);
    const c = craft(seed);
    oracle(o);
    mirrorSpriteListVertically(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `seed ${hx(seed)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);

    // Module matches the oracle across the whole list, and byte3 of each entry is untouched.
    for (let e = 0; e < ENTRIES; e++) {
      const base = (SPRITE_DISPLAY_LIST + e * 4) & 0xffff;
      for (let j = 0; j < 4; j++) {
        assert.equal(c.mem.read8(base + j), o.mem.read8(base + j), `seed ${hx(seed)}: entry ${e} byte ${j}`);
      }
      const b3 = (SPRITE_DISPLAY_LIST + e * 4 + 3) & 0xffff;
      assert.equal(c.mem.read8(b3), (seed + (e * 4 + 3) * 7) & 0xff, `seed ${hx(seed)}: entry ${e} byte3 must be untouched`);
    }
  }
  console.log(`  CRAFTED: ${SEEDS.length} list patterns mirrored identically`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: corrupts one written list byte — must be caught at that byte. */
function brokenMirror(m) {
  mirrorSpriteListVertically(m);
  const bad = SPRITE_DISPLAY_LIST; // entry-0 byte0, always rewritten
  m.mem.write8(bad, (m.mem.read8(bad) ^ 0x01) & 0xff); // BUG: wrong coordinate
}

test("TEETH: a corrupted list byte is CAUGHT", () => {
  let caught = null;
  for (const seed of SEEDS) {
    const o = craft(seed);
    const c = craft(seed);
    oracle(o);
    brokenMirror(c);
    const d = ramDiffMinusStack(o, c);
    if (d) { caught = d; break; }
  }
  assert.notEqual(caught, null, "the gate FAILED to catch a corrupted byte — it is worthless");
  assert.equal(caught.addr, SPRITE_DISPLAY_LIST, `teeth caught wrong address ${hx(caught.addr ?? 0)}`);
  console.log(`  TEETH: corrupted byte caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});
