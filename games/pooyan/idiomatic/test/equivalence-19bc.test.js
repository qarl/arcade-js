// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for clearActorArena (ROM 0x19bc) — "zero-fill the actor arena":
 * clear the 0x200-byte block at ACTOR_TABLE (0x8a80..0x8c7f) to 0x00. The oracle seeds
 * (0x8a80)=0 then LDIRs it forward across all 0x200 bytes.
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine
 * WRITES work RAM, so every case uses a FRESH clone per side. The oracle runs on one clone,
 * clearActorArena on another, and they are compared on the go-forward contract:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * pc is deliberately NOT compared. The routine takes NO register inputs (it sets HL/DE/BC
 * internally) and leaves nothing a caller reads — memory only — so RAM (−stack) is the whole
 * contract.
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — hook 0x19bc in a real boot; any dispatch must agree in RAM.
 *   2. CRAFTED (load-bearing) — pre-dirty the arena AND its boundary bytes to 0xAA; both sides
 *      zero exactly the arena and leave the neighbours dirty.
 *   3. WRITE-SET — the oracle's only writes are the 0x200 cells ACTOR_TABLE..+0x1ff.
 *   4. TEETH — a twin that leaves one arena byte non-zero MUST be caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-19bc.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_19bc as oracle } from "../../translated/loc_19bc.js";
import { clearActorArena } from "../clearActorArena.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ACTOR_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TARGET = 0x19bc;
const ARENA_BYTES = 0x200;
const LO = ACTOR_TABLE;                 // 0x8a80
const HI = ACTOR_TABLE + ARENA_BYTES;   // 0x8c80 (exclusive)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

/** First RAM difference on the go-forward contract: whole dump minus stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

// A booted machine's frame machinery is neutralised by clone() (nextNmi/nextBoundary =
// Infinity), so an m.step in the oracle cannot trip a boundary/NMI at cycle 0.
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** Fresh clone with the whole arena + the two boundary bytes pre-dirtied to 0xAA. */
function craft() {
  const m = BASE.clone();
  for (let a = LO; a < HI; a++) m.mem.write8(a, 0xaa);
  m.mem.write8((LO - 1) & 0xffff, 0xaa); // just below the arena
  m.mem.write8(HI & 0xffff, 0xaa);       // just above the arena
  m.regs.sp = 0x8ffe; // in STACK_SCRATCH; the oracle's ret only POPs (reads), never writes
  return m;
}

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

const CAPS = ROM_PRESENT ? captureDispatches(8, 1500) : [];

test("CAPTURE: real 0x19bc dispatches — clearActorArena == oracle in RAM (−stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    clearActorArena(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: pre-dirtied arena — both zero exactly 0x8a80..0x8c7f, neighbours kept", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  clearActorArena(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);

  // The module side zeroed the whole arena.
  for (const a of [LO, LO + 0x60, LO + 0x100, HI - 1]) {
    assert.equal(c.mem.read8(a), 0x00, `arena cell ${hx(a)} should be 0`);
  }
  // Neighbours just outside the arena keep their 0xAA dirt (proves the fill is bounded).
  assert.equal(c.mem.read8((LO - 1) & 0xffff), 0xaa, "byte below the arena should be untouched");
  assert.equal(c.mem.read8(HI & 0xffff), 0xaa, "byte above the arena should be untouched");
  console.log("  CRAFTED: arena zeroed, boundaries preserved");
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle writes exactly the 0x200 cells ACTOR_TABLE..+0x1ff", () => {
  const before = craft();
  const after = before.clone();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  let changed = 0;
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = after.stateOffsetToAddr(off);
      assert.ok(addr >= LO && addr < HI, `oracle wrote outside the arena at ${hx(addr)}`);
      changed++;
    }
  }
  assert.equal(changed, ARENA_BYTES, `expected ${ARENA_BYTES} arena writes, got ${changed}`);
  console.log(`  WRITE-SET: exactly ${changed} cells in [${hx(LO)}, ${hx(HI)})`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: leaves the last arena byte non-zero. */
function brokenClearActorArena(m) {
  clearActorArena(m);
  m.mem.write8((HI - 1) & 0xffff, 0x01); // BUG: last cell must be 0
}

test("TEETH: a non-zero arena byte is CAUGHT at the last cell", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  brokenClearActorArena(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a non-zero arena byte — it is worthless");
  assert.equal(d.addr, (HI - 1) & 0xffff, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: non-zero byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
