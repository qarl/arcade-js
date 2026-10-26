// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for guardObjectFreezeIntegrity (Pooyan) — the object-freeze tamper gate that fronts the
 * phase-4 tilemap checksum guard (guardTilemapIntegrity).
 *
 * On a good ROM the freeze flag (0x89fb) is 0, so the routine delegates to guardTilemapIntegrity. The original
 * also folds a strided sum of the guard's own bytes, compares it, and DISCARDS the result before
 * tail-jumping into the guard — a decoy with no memory effect and no live-out the guard reads. The
 * module drops that dead fold; this test proves it changes nothing: with the freeze flag clear and
 * the guard's own gates declining (wave != 2, or the once-latch already set), guardObjectFreezeIntegrity must leave
 * RAM byte-identical to the oracle and write ZERO cells of its own.
 *
 * When the freeze flag is set the oracle diverts to an unreachable anti-tamper handler (0x5119);
 * the module traps. That arm is checked by a throw, not an eq (the alternate handler is off the
 * validated frontier).
 *
 * Compared on RAM (dumpState) minus stack scratch below the entry SP; SP is parked in STACK_SCRATCH so the oracle's
 * tail-call frame churn falls out of the diff.
 *
 * Jobs: 1. EQUAL across the no-op delegation states; 2. WRITE-SET (guardObjectFreezeIntegrity writes nothing itself —
 * all effects are the delegate's); 3. DELEGATION IS REAL (the checksum arm is actually entered);
 * 4. TEETH (the freeze arm traps; a spurious own-write would be caught).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-50f1.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_50f1 as oracle } from "../../translated/loc_50f1.js";
import { guardObjectFreezeIntegrity } from "../guardObjectFreezeIntegrity.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, TAMPER_OBJECT_FREEZE_FLAG, WAVE_NUMBER, TILE_SUM_ONCE_LATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8ff0; // inside STACK_SCRATCH
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the freeze flag clear and the guard's gates so guardTilemapIntegrity declines without walking/writing. */
function seat({ freeze = 0x00, wave = 0x00, latch = 0x01 } = {}) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write8(TAMPER_OBJECT_FREEZE_FLAG, freeze);
  m.mem.write8(WAVE_NUMBER, wave);
  m.mem.write8(TILE_SUM_ONCE_LATCH, latch);
  return m;
}

// no-op delegation states: freeze clear, guard declines (wrong wave, or already-run latch)
const CASES = [
  { name: "wave != 2 -> guard rets immediately", cfg: { wave: 0x00, latch: 0x00 } },
  { name: "wave != 2 (other) -> guard rets", cfg: { wave: 0x05, latch: 0x00 } },
  { name: "wave == 2 but once-latch set -> guard rets", cfg: { wave: 0x02, latch: 0x01 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: guardObjectFreezeIntegrity == oracle in RAM (−stack) across no-op delegation states", () => {
  for (const { name, cfg } of CASES) {
    const o = seat(cfg);
    const c = seat(cfg);
    oracle(o);
    guardObjectFreezeIntegrity(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} no-op delegation states identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: guardObjectFreezeIntegrity writes nothing itself; the discarded checksum fold is a no-op", () => {
  const before = seat({ wave: 0x00, latch: 0x00 });
  const after = seat({ wave: 0x00, latch: 0x00 });
  const b0 = before.dumpState();
  guardObjectFreezeIntegrity(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = after.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) changed.push(hx(addr ?? 0));
    }
  }
  assert.deepEqual(changed, [], `guardObjectFreezeIntegrity wrote unexpected cells: ${changed.join(",")}`);
  console.log("  WRITE-SET: 0 own writes (all memory effects belong to the delegate guardTilemapIntegrity)");
});

// -- 3. DELEGATION IS REAL ----------------------------------------------------

test("DELEGATION: the guard is actually entered (its checksum arm fires on a blank tilemap)", () => {
  // freeze clear, wave==2, latch==0, blank video RAM -> the guard walks and its checksum mismatches.
  // On a blank (all-zero) tilemap the low byte mismatches first, so guardTilemapIntegrity diverts into loc_0929
  // (the ROM's screen-setup arm), which faults on the crafted state; a high-byte-only mismatch would
  // instead throw guardTilemapIntegrity's checksum-mismatch guard. Either arm throws, which proves delegation
  // reached guardTilemapIntegrity -- with the freeze flag clear there is no other throw path, so a non-delegating
  // impl would simply return.
  const c = seat({ freeze: 0x00, wave: 0x02, latch: 0x00 });
  const msg = (() => { try { guardObjectFreezeIntegrity(c); return null; } catch (e) { return String(e && e.message); } })();
  assert.notEqual(msg, null, "guardObjectFreezeIntegrity did not delegate into the checksum guard (it returned instead of entering guardTilemapIntegrity)");
  assert.doesNotMatch(msg, /object-freeze/, "guardObjectFreezeIntegrity threw via its own freeze arm, not the delegated checksum guard");
  console.log("  DELEGATION: guard entered (checksum arm reached via guardTilemapIntegrity)");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: the object-freeze arm traps; a spurious own-write would be caught", () => {
  // freeze set -> the unreachable anti-tamper arm must trap.
  const t = seat({ freeze: 0x01, wave: 0x00, latch: 0x00 });
  assert.throws(() => guardObjectFreezeIntegrity(t), /0x5119|tamper/i, "the freeze arm failed to trap");

  // guard for the WRITE-SET: a routine that wrote a stray byte would diverge from the oracle.
  const o = seat({ wave: 0x00, latch: 0x00 });
  const c = seat({ wave: 0x00, latch: 0x00 });
  oracle(o);
  guardObjectFreezeIntegrity(c);
  c.mem.write8(WAVE_NUMBER, 0x77); // BUG: a stray own-write
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a stray write");
  assert.equal(d.addr, WAVE_NUMBER, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: freeze arm traps; stray write caught at ${hx(d.addr)}`);
});
