// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for selectActivePlayerScoreBuffer (ROM 0x04f2) — "pick the
 * active player's 3-byte BCD score buffer": DE <- P1_SCORE_BCD (0x88a2) when bit 0 of
 * ACTIVE_PLAYER is clear, else P2_SCORE_BCD (0x88a5). The oracle preserves A and flags
 * (push af / pop af) and touches no RAM outside the dead stack.
 *
 * This is the CYCLE-FREE / memory-equivalence gate. The routine is a pure probe, so the
 * contract is:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP) + the declared register live-out (DE).
 *
 * DE is the only live-out; it is derived from the ORACLE clone, never the module. pc is not
 * compared (the oracle drives it through m.step/m.ret, machinery the direct-call layer drops).
 *
 * Jobs:
 *   1. EQUAL (crafted sweep) — over even and odd ACTIVE_PLAYER values, oracle == module in
 *      RAM (−stack) and in the returned DE, and the oracle leaves A/flags untouched.
 *   2. TEETH — a twin returning the WRONG bank MUST be caught by the live-out check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-04f2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_04f2 as oracle } from "../../translated/loc_04f2.js";
import { selectActivePlayerScoreBuffer } from "../selectActivePlayerScoreBuffer.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ACTIVE_PLAYER, P1_SCORE_BCD, P2_SCORE_BCD } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

/** First RAM difference minus the stack scratch below the entry SP (the oracle's push/pop af writes it).
 * firstStateDiff's own excludeAddr skips dead-stack cells in a single pass. */
function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

// A booted machine's frame machinery is neutralised by clone() (nextNmi/nextBoundary = Infinity),
// so an m.step in the oracle cannot trip a boundary/NMI at cycle 0.
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with ACTIVE_PLAYER seated and sentinels in A / DE to prove the contract. */
function craft(sel) {
  const m = BASE.clone();
  m.mem.write8(ACTIVE_PLAYER, sel & 0xff);
  m.regs.a = 0x5a;       // sentinel: the oracle must restore it (push af / pop af)
  m.regs.de = 0x1234;    // garbage pointer the routine overwrites
  m.regs.sp = 0x8ffe;    // in work RAM; the oracle's push/pop af rides the dead stack
  return m;
}

// Only bit 0 matters; span even (-> P1) and odd (-> P2) with assorted high bits.
const SELECTORS = [0x00, 0x01, 0x02, 0x03, 0xfe, 0xff, 0x80, 0x7f];

// -- 1. EQUAL (crafted sweep) -------------------------------------------------

test("EQUAL: crafted ACTIVE_PLAYER — module == oracle in RAM (−stack) + DE, A preserved", () => {
  for (const sel of SELECTORS) {
    const o = craft(sel);
    const c = craft(sel);
    oracle(o);
    const ret = selectActivePlayerScoreBuffer(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `sel ${hx(sel)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret & 0xffff, o.regs.de & 0xffff, `sel ${hx(sel)}: DE live-out module ${hx(ret)} != oracle ${hx(o.regs.de)}`);
    // SIDE EFFECT: the bridge must SET DE (accrueScoreAndUpdateHighScore reads mem[DE] right after the call), not
    // merely return the value — a return-only rewrite passes the check above but leaves DE stale.
    assert.equal(c.regs.de & 0xffff, o.regs.de & 0xffff, `sel ${hx(sel)}: module must SET DE for the translated dispatch, got ${hx(c.regs.de)} != oracle ${hx(o.regs.de)}`);

    const expected = (sel & 0x01) ? P2_SCORE_BCD : P1_SCORE_BCD;
    assert.equal(ret & 0xffff, expected, `sel ${hx(sel)}: expected bank ${hx(expected)}`);
    assert.equal(o.regs.a & 0xff, 0x5a, `sel ${hx(sel)}: oracle must preserve A (push/pop af)`);
  }
  console.log(`  EQUAL: ${SELECTORS.length} crafted selectors identical (RAM −stack + DE); A preserved`);
});

// -- 2. TEETH -----------------------------------------------------------------

test("TEETH: a wrong bank return is CAUGHT by the live-out check", () => {
  assert.notEqual(P1_SCORE_BCD, P2_SCORE_BCD, "the two banks must differ or the test is worthless");
  let caught = false;
  for (const sel of SELECTORS) {
    const o = craft(sel);
    const c = craft(sel);
    oracle(o);
    const modRet = selectActivePlayerScoreBuffer(c) & 0xffff; // module runs...
    const brokenRet = modRet === P1_SCORE_BCD ? P2_SCORE_BCD : P1_SCORE_BCD; // ...its bank return flipped
    if (brokenRet !== (o.regs.de & 0xffff)) { caught = true; break; }
  }
  assert.ok(caught, "the live-out check FAILED to distinguish the wrong bank — it is worthless");
  console.log("  TEETH: a flipped bank return differs from the oracle's DE at every selector");
});
