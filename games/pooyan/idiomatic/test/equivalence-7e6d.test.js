// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for bumpTamperStrikeOnRomChecksumMiss (ROM 0x7e6d, Pooyan) — the periodic anti-tamper ROM check.
 * It runs only when PLAYER1_LIVES >= 4 and FRAME_COUNTER == 0, then sums the ROM downward from
 * TAMPER_CKSUM_TOP_ADDR to the 0x34 sentinel and, if (carries + sum) & 0xb0 is nonzero, bumps
 * TAMPER_STRIKES_ROM. On an intact ROM the signature is clean, so the bump is unreachable — the only
 * observable effects are the two gates (which suppress everything) and the tamper write itself.
 *
 * Contract compared: RAM (dumpState, minus stack scratch below the entry SP). No register live-out — every exit is a
 * plain ret with nothing read back — so the register file is not compared. The bump cannot fire with
 * a valid ROM (ROM is not writable in a clone), so the teeth prove the (carries + sum) & 0xb0 guard is
 * load-bearing: a twin that drops it spuriously bumps the counter where the oracle does not.
 *
 * Jobs:
 *   1. EQUAL — oracle == module in RAM (−stack) for both gate-fail arms and the body-entry arm.
 *   2. WRITE-SET — body-entry on a valid ROM writes zero cells (clean signature).
 *   3. TEETH — a guard-dropped twin bumps TAMPER_STRIKES_ROM; the RAM diff catches it.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7e6d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7e6d as oracle } from "../../translated/loc_7e6d.js";
import { bumpTamperStrikeOnRomChecksumMiss } from "../bumpTamperStrikeOnRomChecksumMiss.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, PLAYER1_LIVES, FRAME_COUNTER, TAMPER_STRIKES_ROM } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** Seat the two gate inputs and a known strike-counter baseline on a fresh clone. */
function craft({ lives, frame, strikes = 0x00 }) {
  const m = BASE.clone();
  m.mem.write8(PLAYER1_LIVES, lives & 0xff);
  m.mem.write8(FRAME_COUNTER, frame & 0xff);
  m.mem.write8(TAMPER_STRIKES_ROM, strikes & 0xff);
  m.regs.sp = 0x8fe0; // the oracle's rets only read the dead stack region
  return m;
}

// A twin identical to the module but WITHOUT the (carries + sum) & 0xb0 guard: it always bumps.
function brokenTwinAlwaysBumps(m) {
  const { mem8 } = m;
  if (mem8[PLAYER1_LIVES] < 0x04) return;
  if (mem8[FRAME_COUNTER] !== 0) return;
  mem8[TAMPER_STRIKES_ROM] = mem8[TAMPER_STRIKES_ROM] + 1; // BUG: dropped the clean-signature guard
}

const CASES = [
  { name: "gate-fail-lives<4", lives: 0x03, frame: 0x00 },
  { name: "gate-fail-frame!=0", lives: 0x05, frame: 0x07 },
  { name: "body-entry-clean-rom", lives: 0x05, frame: 0x00 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: bumpTamperStrikeOnRomChecksumMiss == oracle in RAM (−stack) across both gates and the body", () => {
  for (const cfg of CASES) {
    const o = craft(cfg);
    const c = craft(cfg);
    oracle(o);
    bumpTamperStrikeOnRomChecksumMiss(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b} (${cfg.name})`);
  }
  console.log(`  EQUAL: ${CASES.length} arms identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: body-entry on a valid ROM writes zero cells (clean signature)", () => {
  const m = craft({ name: "body", lives: 0x05, frame: 0x00 });
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();
  let changed = 0;
  for (let off = 0; off < b0.length; off++) if (b0[off] !== a1[off]) changed++;
  assert.equal(changed, 0, `expected 0 writes on a clean ROM, got ${changed}`);
  console.log("  WRITE-SET: 0 cells written (clean signature, no tamper strike)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a guard-dropped twin spuriously bumps TAMPER_STRIKES_ROM — caught by the RAM diff", () => {
  const o = craft({ name: "teeth", lives: 0x05, frame: 0x00 });
  const c = craft({ name: "teeth", lives: 0x05, frame: 0x00 });
  oracle(o);
  brokenTwinAlwaysBumps(c);

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a spurious tamper strike — it is worthless");
  assert.equal(d.addr, TAMPER_STRIKES_ROM, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);

  // Sanity: the real module agrees with the oracle (no bump) on the same input.
  const s = craft({ name: "teeth", lives: 0x05, frame: 0x00 });
  bumpTamperStrikeOnRomChecksumMiss(s);
  assert.equal(ramDiffMinusStack(o, s), null, "the real module must match the oracle (no bump on a clean ROM)");
  console.log(`  TEETH/RAM: spurious bump caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
