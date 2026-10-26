// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for seedWriteAnimWorkBlock (ROM 0x7eb2, Pooyan) — entry 0 of the 0x7e94 write-anim
 * dispatch table. It seeds the animation work-block 0x8e1f..0x8e2b: a record pointer
 * 0x8e1f = 0x8dfd + 3*count, a source pointer 0x8e21 (0x8811, or 0x8812 when the cabinet flag is
 * clear AND the active-player flag is set), a stamp write pointer 0x8e27 walked from base 0x8565 by
 * two bytes per pass (with 0x11 stamped at the landing address), and the fixed fields 0x8e25=0x03,
 * 0x8e2b=0x03a0, 0x8e23=0x11, 0x8e26=0x01, 0x8e24=0x0c. `count` is the seed at 0x89fc; a 0 seed runs
 * 256 djnz passes.
 *
 * Cycle-free memory-equivalence gate: a fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP). No register live-out — the shared epilogue this ret's into reloads A/HL from
 * memory, so only the work-block writes survive.
 *
 * Inputs poked identically on both sides: the pass seed (0x89fc), the cabinet flag (0x880f), the
 * active-player flag (0x880d), plus the whole work-block and the stamp-landing byte pre-dirtied so a
 * dropped or mis-valued write is observable.
 *
 * Jobs:
 *   1. EQUAL — both source-pointer arms and three pass counts (1, 5, 0->256): module == oracle
 *      in RAM (−stack).
 *   2. WRITE-SET — the seeded work-block matches the spec's exact values (run against the oracle).
 *   3. BRANCH — the cabinet/active gate actually selects 0x8811 vs 0x8812 (oracle, both arms).
 *   4. TEETH — a wrong record pointer, source pointer, and stamp-landing byte are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7eb2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7eb2 as oracle } from "../../translated/loc_7eb2.js";
import { seedWriteAnimWorkBlock } from "../seedWriteAnimWorkBlock.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const PASS_SEED = 0x89fc; // (0x89fc) count for both record walks
const CABINET_FLAG = 0x880f;
const ACTIVE_PLAYER = 0x880d;

const RECORD_PTR = 0x8e1f; // = 0x8dfd + 3*passes (16-bit)
const SRC_PTR = 0x8e21; //    0x8811 / 0x8812 (16-bit)
const STRIDE3 = 0x8e25; //    = 0x03
const STAMP = 0x8e23; //      = 0x11
const FLAG1 = 0x8e26; //      = 0x01
const COLOR = 0x8e24; //      = 0x0c
const WRITE_PTR = 0x8e27; //  = 0x8565 + 2*passes (16-bit)
const EXTENT = 0x8e2b; //     = 0x03a0 (16-bit)

const RECORD_BASE = 0x8dfd;
const WRITE_BASE = 0x8565;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

const passesFor = (seed) => ((seed & 0xff) === 0 ? 256 : seed & 0xff);
const landingFor = (seed) => (WRITE_BASE + 2 * passesFor(seed)) & 0xffff;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the seed + gate flags and the whole work-block (+ stamp landing) pre-dirtied. */
function craft(seed, cabinet, active) {
  const m = BASE.clone();
  m.mem.write8(PASS_SEED, seed & 0xff);
  m.mem.write8(CABINET_FLAG, cabinet & 0xff);
  m.mem.write8(ACTIVE_PLAYER, active & 0xff);
  for (let a = 0x8e1f; a <= 0x8e2c; a++) m.mem.write8(a, 0xaa); // pre-dirty the work-block
  m.mem.write8(landingFor(seed), 0xaa); // pre-dirty the stamp-landing byte
  m.regs.sp = 0x8ff0; // dead-stack scratch; the oracle's ret pop stays in STACK_SCRATCH
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: both source arms x three pass counts — seedWriteAnimWorkBlock == oracle in RAM (−stack)", () => {
  const cases = [
    { name: "cabinet set -> 0x8811, 1 pass", seed: 0x01, cab: 0x01, act: 0x01 },
    { name: "cabinet clear + active set -> 0x8812, 5 passes", seed: 0x05, cab: 0x00, act: 0x01 },
    { name: "cabinet clear + active clear -> 0x8811, 5 passes", seed: 0x05, cab: 0x00, act: 0x00 },
    { name: "cabinet set + active clear -> 0x8811, 1 pass", seed: 0x01, cab: 0x01, act: 0x00 },
    { name: "seed 0 -> 256 passes (djnz wrap)", seed: 0x00, cab: 0x00, act: 0x01 },
  ];
  for (const { name, seed, cab, act } of cases) {
    const o = craft(seed, cab, act);
    const c = craft(seed, cab, act);
    oracle(o);
    seedWriteAnimWorkBlock(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: both source arms + 1/5/256 pass counts identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the seeded work-block matches the spec's exact values (oracle)", () => {
  const seed = 0x05;
  const m = craft(seed, 0x00, 0x01); // cabinet clear + active set -> 0x8812
  oracle(m);

  const recordPtr = (RECORD_BASE + 3 * passesFor(seed)) & 0xffff;
  const landing = landingFor(seed);
  assert.equal(m.mem.read16(RECORD_PTR), recordPtr, "record pointer = 0x8dfd + 3*passes");
  assert.equal(m.mem.read16(SRC_PTR), 0x8812, "source pointer = 0x8812 (cabinet clear + active set)");
  assert.equal(m.mem.read8(STRIDE3), 0x03, "stride field = 0x03");
  assert.equal(m.mem.read16(EXTENT), 0x03a0, "extent field = 0x03a0");
  assert.equal(m.mem.read16(WRITE_PTR), landing, "stamp write pointer = 0x8565 + 2*passes");
  assert.equal(m.mem.read8(landing), 0x11, "0x11 stamped at the landing address");
  assert.equal(m.mem.read8(STAMP), 0x11, "stamp field = 0x11");
  assert.equal(m.mem.read8(FLAG1), 0x01, "flag field = 0x01");
  assert.equal(m.mem.read8(COLOR), 0x0c, "color field = 0x0c");
  console.log("  WRITE-SET: record/source/write pointers + fixed fields match spec");
});

// -- 3. BRANCH ----------------------------------------------------------------

test("BRANCH: the cabinet/active gate selects 0x8811 vs 0x8812 (oracle, both arms)", () => {
  const alt = craft(0x03, 0x00, 0x01); // cabinet clear + active set
  const def1 = craft(0x03, 0x01, 0x01); // cabinet set (active irrelevant)
  const def2 = craft(0x03, 0x00, 0x00); // cabinet clear + active clear
  oracle(alt);
  oracle(def1);
  oracle(def2);
  assert.equal(alt.mem.read16(SRC_PTR), 0x8812, "only cabinet-clear + active-set selects 0x8812");
  assert.equal(def1.mem.read16(SRC_PTR), 0x8811, "cabinet set -> 0x8811");
  assert.equal(def2.mem.read16(SRC_PTR), 0x8811, "active clear -> 0x8811");
  console.log("  BRANCH: 0x8812 is reached only on cabinet-clear + active-set");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong record pointer is CAUGHT by the RAM diff", () => {
  const o = craft(0x05, 0x00, 0x01);
  const c = craft(0x05, 0x00, 0x01);
  oracle(o);
  seedWriteAnimWorkBlock(c);
  c.mem.write16(RECORD_PTR, (c.mem.read16(RECORD_PTR) ^ 0x0003) & 0xffff); // BUG: off-by-one stride
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong record pointer — it is worthless");
  assert.equal(d.addr, RECORD_PTR, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(record): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong source pointer (branch) is CAUGHT by the RAM diff", () => {
  const o = craft(0x05, 0x00, 0x01); // oracle -> 0x8812
  const c = craft(0x05, 0x00, 0x01);
  oracle(o);
  seedWriteAnimWorkBlock(c);
  c.mem.write16(SRC_PTR, 0x8811); // BUG: took the wrong branch (default instead of alt)
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong source pointer — it is worthless");
  assert.equal(d.addr, SRC_PTR, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(source): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong stamp-landing byte is CAUGHT by the RAM diff", () => {
  const seed = 0x05;
  const o = craft(seed, 0x00, 0x01);
  const c = craft(seed, 0x00, 0x01);
  oracle(o);
  seedWriteAnimWorkBlock(c);
  const landing = landingFor(seed);
  c.mem.write8(landing, 0x00); // BUG: stamp not written at the landing address
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a missing stamp — it is worthless");
  assert.equal(d.addr, landing, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(stamp): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
