// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for decodeDipSwitches (ROM 0x0207) — the DSW0 dip-switch decode.
 *
 * sub_0207 is a LEAF whose entire memory-observable behaviour is a total function
 * of ONE byte: the DSW0 hardware bank at port 0x7D80 (a side-effect-free read). It
 * fans that byte out into the seven settings bytes 0x6020-0x6026 and then copies a
 * fixed 170-byte ROM table (0x3565) into 0x6100-0x61A9 — the copy is constant, and
 * nothing else in RAM is read. Every other input the oracle touches (SP, the return
 * address it pops via `ret`, the A/B/C/D/E/HL/F it leaves) is Z80 caller-ABL plumbing
 * the direct-call model drops; none of it reaches RAM, and the caller (handler_01c3)
 * overwrites A with `ld a,0x01` before reading anything. So the contract is RAM only,
 * and the strongest possible gate is available:
 *
 *   1. EQUAL (exhaustive) — decodeDipSwitches == oracle over all 256 DSW0 values,
 *      compared on the RAM dump minus the stack scratch below the entry SP (the routine writes no stack; the
 *      exclusion is the documented contract, not a workaround). A FRESH clone per side
 *      because the routine WRITES memory (docs/decompiler-pipeline: only a pure read-only leaf may reuse
 *      a clone). 256 values is the complete input space, so this is a proof, not a
 *      sample — it also proves the BCD bonus-life lookup equals the oracle's DAA chain
 *      and that the derived coinage rotate matches, for every input.
 *
 *   2. TEETH (exhaustive) — two deliberately-broken twins the sweep MUST catch:
 *        (a) wrong DIP_LIVES store (value XOR 0xFF) — caught by the RAM diff naming
 *            0x6020, on the very first DSW0 value.
 *        (b) wrong bonus-life table (index 3 -> 0x25 instead of 0x20) — a plausible
 *            BCD off-by-one that only shows for DSW0 bits 2-3 == 3, so only a real
 *            sweep over the whole space catches it, at 0x6021.
 *
 *   3. REALISM — hook 0x0207 in a real boot run, clone the machine at the actual
 *      power-on dispatch, and confirm (a) the oracle writes ONLY the expected regions
 *      and (b) decodeDipSwitches reproduces the oracle's RAM on the real DSW0 state.
 *      sub_0207 fires exactly once (game-state-0 init), so one dispatch is the whole
 *      real distribution; the exhaustive sweep covers every DSW0 the hardware allows.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0207.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0207 as oracle } from "../../translated/loc_0207.js";
import { decodeDipSwitches } from "../decodeDipSwitches.js";
import { STACK_SCRATCH } from "../names.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0207;
const DIP_LIVES = 0x6020;
const DIP_BONUS_LIFE = 0x6021;

const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

/**
 * First RAM difference (minus the stack scratch below the entry SP) between two machines. firstStateDiff
 * returns the first differing byte anywhere; we re-scan skipping the stack window so
 * the contract is exactly RAM − the stack scratch below the entry SP.
 */
function ramDiffExStack(a, b, liveFloor) {
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

/**
 * Capture the pristine machine state at the first entry of 0x0207 (the power-on
 * init). The wrapper clones the entry state, then runs the oracle so the host boot
 * proceeds undisturbed. sub_0207 is m.call'd (never a dispatch target), so the
 * construction-time override registry is what reaches it.
 */
function captureEntry(maxFrames = 240) {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  if (entry === null) throw new Error("sub_0207 never entered within " + maxFrames + " frames");
  return entry;
}

/**
 * Run the oracle and `candidate` on two FRESH clones of `entry`, both with DSW0
 * forced to `dsw0` (undefined = leave the entry's real DSW0), and return the first
 * RAM difference (minus the stack scratch below the entry SP) or null.
 */
function runPair(entry, dsw0, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  if (dsw0 !== undefined) {
    a.io.inputs._dsw0 = dsw0;
    b.io.inputs._dsw0 = dsw0;
  }
  oracle(a);
  candidate(b);
  return ramDiffExStack(a, b, entry.regs.sp);
}

/**
 * Sweep a candidate against the oracle over all 256 DSW0 values. Returns the first
 * mismatch (or null) and the count compared.
 */
function sweep(entry, candidate) {
  let count = 0;
  for (let dsw0 = 0; dsw0 < 256; dsw0++) {
    const ram = runPair(entry, dsw0, candidate);
    count++;
    if (ram) return { mismatch: { dsw0, ram }, count };
  }
  return { mismatch: null, count };
}

// -- 1. EQUAL (exhaustive) ----------------------------------------------------

test("EQUAL (exhaustive): decodeDipSwitches == oracle over all 256 DSW0 values", () => {
  const entry = captureEntry();
  const { mismatch, count } = sweep(entry, decodeDipSwitches);
  assert.equal(
    mismatch,
    null,
    mismatch &&
      `mismatch at DSW0=${hx(mismatch.dsw0)}: RAM diverges at 0x${(mismatch.ram.addr ?? 0).toString(16)} ` +
        `(oracle ${mismatch.ram.a} -> idiomatic ${mismatch.ram.b})`,
  );
  assert.equal(count, 256, "must have compared all 256 DSW0 values");
  console.log(`  EQUAL/exhaustive: ${count} DSW0 values — RAM (minus the stack scratch below the entry SP) identical to the oracle`);
});

// -- 2. TEETH (exhaustive) ----------------------------------------------------

/** BUG: the DIP_LIVES store lands a wrong value. Caught by the RAM diff at 0x6020. */
function brokenLivesStore(m) {
  const real = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, bus) => {
    if (!broke && addr === DIP_LIVES) {
      broke = true;
      return real(addr, value ^ 0xff, bus);
    }
    return real(addr, value, bus);
  };
  try {
    return decodeDipSwitches(m);
  } finally {
    m.mem.write8 = real;
  }
}

/** BUG: bonus-life index 3 -> 0x25 instead of 0x20 — a plausible BCD off-by-one that
 *  ONLY shows for DSW0 bits 2-3 == 3, so a single-value gate would miss it. */
function brokenBonusTable(m) {
  const real = m.mem.write8.bind(m.mem);
  let seen = false;
  m.mem.write8 = (addr, value, bus) => {
    if (!seen && addr === DIP_BONUS_LIFE) {
      seen = true;
      return real(addr, value === 0x20 ? 0x25 : value, bus);
    }
    return real(addr, value, bus);
  };
  try {
    return decodeDipSwitches(m);
  } finally {
    m.mem.write8 = real;
  }
}

test("TEETH (exhaustive): a wrong DIP_LIVES store is CAUGHT and names 0x6020", () => {
  const entry = captureEntry();
  const { mismatch, count } = sweep(entry, brokenLivesStore);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a wrong DIP_LIVES store — the RAM check is worthless");
  assert.equal(
    mismatch.ram.addr,
    DIP_LIVES,
    `expected first diff at 0x${DIP_LIVES.toString(16)}, got 0x${(mismatch.ram.addr ?? 0).toString(16)}`,
  );
  console.log(`  TEETH/lives: caught after ${count} value(s) at 0x${mismatch.ram.addr.toString(16)}`);
});

test("TEETH (exhaustive): a wrong bonus-life BCD entry is CAUGHT only by the full sweep", () => {
  const entry = captureEntry();
  const { mismatch } = sweep(entry, brokenBonusTable);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a wrong bonus-life BCD value — the sweep is worthless");
  assert.equal(
    mismatch.ram.addr,
    DIP_BONUS_LIFE,
    `expected the bonus-life twin to be caught at 0x${DIP_BONUS_LIFE.toString(16)}, got 0x${(mismatch.ram.addr ?? 0).toString(16)}`,
  );
  // Proves it hides at every DSW0 whose bits 2-3 != 3, so only a real sweep finds it.
  assert.equal(((mismatch.dsw0 >> 2) & 0x03), 3, "the bonus-life twin must first diverge on a bits-2-3 == 3 DSW0");
  console.log(`  TEETH/bonus: caught at DSW0=${hx(mismatch.dsw0)} (bits 2-3 == 3), addr 0x${mismatch.ram.addr.toString(16)}`);
});

// -- 3. REALISM (captured dispatch) -------------------------------------------

test("REALISM: the real power-on dispatch — oracle writes only 0x6020-0x6026 + 0x6100-0x61A9, idiomatic matches", () => {
  const entry = captureEntry();

  // (a) The oracle writes ONLY the settings block and the copied table (justifying the
  //     memory-only contract). Diff the entry against itself-after-oracle.
  const before = entry.clone();
  const after = entry.clone();
  oracle(after);
  const db = before.dumpState();
  const da = after.dumpState();
  const dead = deadStackBelow(STACK_SCRATCH, entry.regs.sp);
  for (let i = 0; i < Math.min(db.length, da.length); i++) {
    if (db[i] === da[i]) continue;
    const addr = after.stateOffsetToAddr(i);
    const inSettings = addr >= 0x6020 && addr <= 0x6026;
    const inTable = addr >= 0x6100 && addr <= 0x61a9;
    assert.ok(
      inSettings || inTable || dead(addr),
      `oracle wrote outside the expected regions at 0x${(addr ?? 0).toString(16)} (${db[i]} -> ${da[i]})`,
    );
  }

  // (b) On the real DSW0 (no poke), idiomatic reproduces the oracle's RAM exactly.
  const ram = runPair(entry, undefined, decodeDipSwitches);
  assert.equal(
    ram,
    null,
    ram && `RAM diverges on the real dispatch at 0x${(ram.addr ?? 0).toString(16)} (oracle ${ram.a} -> idiomatic ${ram.b})`,
  );
  console.log(`  REALISM: real power-on dispatch (DSW0=${hx(entry.io.inputs._dsw0)}) — oracle region-bounded, idiomatic == oracle`);
});
