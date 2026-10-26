// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for draw1UpLabel (ROM 0x0A53) — stamp player 1's "1UP" score
 * marker into three fixed video-RAM cells (0x7740 <- 0x01, 0x7720 <- 0x25,
 * 0x7700 <- 0x20).
 *
 * draw1UpLabel WRITES memory (three video-RAM cells) and is a subroutine reached
 * by `m.call` — not a pure leaf — so it is gated by capture / clone / replay
 * (docs/decompiler-pipeline), not the exhaustive-leaf pattern. It is input-independent and
 * straight-line (every value is an immediate, no data-dependent branch), so there
 * are NO unreached arms to craft; instead the crafted entries PRE-DIRTY the target
 * cells to prove the stamp is unconditional:
 *
 *   1. EQUAL (real captured dispatches) — hook 0x0A53 in a real attract run and
 *      clone the machine at each true dispatch (a FRESH clone per case, since the
 *      routine mutates video RAM). For each, run the ORACLE on one clone and
 *      draw1UpLabel on another and confirm they leave IDENTICAL RAM everywhere
 *      game-visible. The oracle's terminal `ret` only POPS (it writes no memory),
 *      so unlike a push-based routine there is not even stack-scratch residue —
 *      the two dumps are byte-identical. draw1UpLabel must also leave SP and pc
 *      unchanged (JS return replaces the modelled `ret`).
 *
 *   2. EQUAL (crafted pre-dirtied) — attract reaches this routine with the marker
 *      cells already blank/valid, so to prove the stamp is UNCONDITIONAL the
 *      crafted entries poke the three target cells (and their neighbours) to
 *      garbage, IDENTICALLY on both sides, then confirm oracle == draw1UpLabel and
 *      that the three cells end at exactly 0x01 / 0x25 / 0x20.
 *
 *   3. TEETH — a deliberately-broken twin that stamps a wrong value into one of the
 *      routine's own cells (0x7740) MUST be caught by the captured sweep, naming
 *      0x7740. A gate a real corruption slips through is worthless.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0a53.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0a53 as oracle } from "../../translated/loc_0a53.js";
import { draw1UpLabel } from "../draw1UpLabel.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0a53;
// The three cells the routine stamps, in write order, with the value each gets.
const CELL_1 = 0x7740; // '1'
const CELL_U = 0x7720; // 'U'
const CELL_P = 0x7700; // 'P'
const EXPECT = [[CELL_1, 0x01], [CELL_U, 0x25], [CELL_P, 0x20]];

const hx = (v) => "0x" + (v & 0xffff).toString(16);

function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0;
  let bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/**
 * Hook 0x0A53 in a real attract run and clone the machine at up to K true
 * dispatches. Each clone is one real captured entry; the wrapper delegates to the
 * oracle so the host run proceeds to a clean stop. sub_0a53 is `m.call`'d from
 * handler_01c3 (frame 5) and handler_0779 (frame 6), so a short run reaches it.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (captured): draw1UpLabel == oracle on every real attract dispatch", () => {
  const caps = captureDispatches(64, 60);
  assert.ok(caps.length >= 1, "expected at least one real 0x0A53 dispatch during attract");

  for (const entry of caps) {
    const { bad, stackDiffs } = replay(entry, draw1UpLabel);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );
    // The oracle only pops on `ret` (no push, no stack write), so there is no
    // tolerated stack residue at all — the dumps are byte-identical.
    assert.equal(stackDiffs, 0, `unexpected stack-scratch residue (${stackDiffs} bytes) — the oracle writes no stack`);

    // draw1UpLabel must NOT model the stack: SP and pc unchanged from entry.
    const b = entry.clone();
    const sp0 = b.regs.sp, pc0 = b.pc;
    draw1UpLabel(b);
    assert.equal(b.regs.sp, sp0, "draw1UpLabel must leave SP unchanged (no stack modelling)");
    assert.equal(b.pc, pc0, "draw1UpLabel must leave pc unchanged (no ret modelling)");
    // And it must actually have stamped the three cells (EQUAL is not vacuous).
    for (const [addr, val] of EXPECT) {
      assert.equal(b.mem.read8(addr), val, `cell ${hx(addr)} should hold ${hx(val)} after draw1UpLabel`);
    }
  }
  console.log(`  EQUAL/captured: ${caps.length} real dispatches — game-visible RAM identical to the oracle`);
});

// -- 2. EQUAL (crafted pre-dirtied) -------------------------------------------

test("EQUAL (crafted): the stamp is UNCONDITIONAL — matches the oracle over any prior cell contents", () => {
  const caps = captureDispatches(1, 60);
  assert.ok(caps.length >= 1, "need a real entry to craft from");
  const entry = caps[0];

  // Each craft pre-dirties the three target cells (and their immediate neighbours,
  // to catch an errant write to the wrong cell) IDENTICALLY on both sides.
  const dirt = [
    ["all-0xFF", [[CELL_1, 0xff], [CELL_U, 0xff], [CELL_P, 0xff]]],
    ["all-0x00", [[CELL_1, 0x00], [CELL_U, 0x00], [CELL_P, 0x00]]],
    // Swap the three values around so a copy-from-wrong-source bug would surface.
    ["shuffled", [[CELL_1, 0x20], [CELL_U, 0x01], [CELL_P, 0x25]]],
    // Dirty the neighbouring rows too (0x7720±0x20 etc.) — an off-by-a-row store
    // would then diverge against the oracle, which leaves them untouched.
    ["neighbours", [[CELL_1 + 0x20, 0x5a], [CELL_U, 0x5a], [CELL_P - 0x20, 0x5a], [0x7760, 0x5a]]],
  ];

  for (const [label, pokes] of dirt) {
    const a = entry.clone(); const b = entry.clone();
    for (const [addr, val] of pokes) { a.mem.write8(addr, val); b.mem.write8(addr, val); }
    oracle(a);
    draw1UpLabel(b);
    const { bad } = ramDiffMinusStack(a, b, entry.regs.sp);
    assert.equal(
      bad,
      null,
      bad && `${label}: game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );
    for (const [addr, val] of EXPECT) {
      assert.equal(b.mem.read8(addr), val, `${label}: cell ${hx(addr)} should be overwritten to ${hx(val)}`);
    }
    console.log(`  EQUAL/crafted ${label}: three cells stamped, game-visible RAM identical to the oracle`);
  }
});

// -- 3. TEETH -----------------------------------------------------------------

/**
 * Broken twin: stamps a wrong value into the routine's own first cell (0x7740 gets
 * 0x02 — a plausible "wrote the wrong digit"), otherwise identical. It writes the
 * other two cells correctly, so it diverges ONLY at 0x7740.
 */
function brokenDraw1UpLabel(m) {
  const { mem } = m;
  mem.write8(CELL_1, 0x02); // BUG: should be 0x01
  mem.write8(CELL_U, 0x25);
  mem.write8(CELL_P, 0x20);
}

test("TEETH (captured): a wrong tile store is CAUGHT and names 0x7740", () => {
  const caps = captureDispatches(64, 60);
  assert.ok(caps.length >= 1, "need a real dispatch to test the teeth against");

  let caught = null;
  for (const entry of caps) {
    const { bad } = replay(entry, brokenDraw1UpLabel);
    if (bad) { caught = bad; break; }
  }
  assert.notEqual(caught, null, "the captured sweep FAILED to catch a wrong tile store — it is worthless");
  assert.equal(caught.addr, CELL_1, `expected the caught diff at ${hx(CELL_1)}, got ${hx(caught.addr)}`);
  console.log(`  TEETH/captured: caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});
