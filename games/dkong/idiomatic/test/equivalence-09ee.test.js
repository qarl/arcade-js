// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for draw2UpLabel (ROM 0x09EE) — stamp player 2's "2UP" score
 * marker into three fixed video-RAM cells (0x74E0 <- 0x02, 0x74C0 <- 0x25,
 * 0x74A0 <- 0x20).
 *
 * draw2UpLabel WRITES memory (three video-RAM cells) and is a subroutine reached
 * by `m.call` — not a pure leaf — so it is gated by capture / clone / replay
 * (docs/decompiler-pipeline), not the exhaustive-leaf pattern. It is input-independent and
 * straight-line (every value is an immediate, no data-dependent branch), so there
 * are NO unreached arms to craft; instead the crafted entries PRE-DIRTY the target
 * cells to prove the stamp is unconditional.
 *
 * REACHABILITY NOTE. 0x09EE is the P2 marker, so it fires only in a two-player
 * game. loc_0779 (attract setup) guards it with
 * `ld a,(0x600F) / cp 0x01 / call z,0x09EE`, and plain attract is ONE-player
 * (0x600F == 0), so a stock attract run never dispatches it. The capture therefore
 * forces the REAL two-player condition — it wraps loc_0779 to set
 * TWO_PLAYER_GAME (0x600F) = 1 before delegating to the oracle handler, so the
 * ROM's OWN conditional `call z,0x09EE` then fires and dispatches 0x09EE for real
 * (frame 6). The only craft is the guard byte the routine genuinely requires; the
 * captured state is otherwise a byte-for-byte real attract-setup machine.
 *
 *   1. EQUAL (real captured dispatches) — hook 0x09EE in that forced-2P run and
 *      clone the machine at each true dispatch (a FRESH clone per case, since the
 *      routine mutates video RAM). For each, run the ORACLE on one clone and
 *      draw2UpLabel on another and confirm they leave IDENTICAL RAM everywhere
 *      game-visible. The oracle's terminal `ret` only POPS (it writes no memory),
 *      so there is no stack-scratch residue — the two dumps are byte-identical.
 *      draw2UpLabel must also leave SP and pc unchanged (JS return replaces the
 *      modelled `ret`).
 *
 *   2. EQUAL (crafted pre-dirtied) — to prove the stamp is UNCONDITIONAL the
 *      crafted entries poke the three target cells (and their neighbours) to
 *      garbage, IDENTICALLY on both sides, then confirm oracle == draw2UpLabel and
 *      that the three cells end at exactly 0x02 / 0x25 / 0x20.
 *
 *   3. TEETH — a deliberately-broken twin that stamps a wrong value into the
 *      routine's own first cell (0x74E0) MUST be caught by the captured sweep,
 *      naming 0x74E0. A gate a real corruption slips through is worthless.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-09ee.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_09ee as oracle } from "../../translated/loc_09ee.js";
import { loc_0779 } from "../../translated/loc_0779.js";
import { draw2UpLabel } from "../draw2UpLabel.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, TWO_PLAYER_GAME } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x09ee;
const HANDLER_0779 = 0x0779;
// The three cells the routine stamps, in write order, with the value each gets.
const CELL_2 = 0x74e0; // '2'
const CELL_U = 0x74c0; // 'U'
const CELL_P = 0x74a0; // 'P'
const EXPECT = [[CELL_2, 0x02], [CELL_U, 0x25], [CELL_P, 0x20]];

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

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([
    [HANDLER_0779, (mm) => {
      mm.mem.write8(TWO_PLAYER_GAME, 1); // the real two-player guard byte
      return loc_0779(mm);
    }],
    [TARGET, (mm) => {
      if (caps.length < K) caps.push(mm.clone());
      return oracle(mm);
    }],
  ]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (captured): draw2UpLabel == oracle on every real forced-2P dispatch", () => {
  const caps = captureDispatches(64, 1200);
  assert.ok(caps.length >= 1, "expected at least one real 0x09EE dispatch during forced-2P attract");

  for (const entry of caps) {
    const { bad, stackDiffs } = replay(entry, draw2UpLabel);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );
    // The oracle only pops on `ret` (no push, no stack write), so there is no
    // tolerated stack residue at all — the dumps are byte-identical.
    assert.equal(stackDiffs, 0, `unexpected stack-scratch residue (${stackDiffs} bytes) — the oracle writes no stack`);

    // draw2UpLabel must NOT model the stack: SP and pc unchanged from entry.
    const b = entry.clone();
    const sp0 = b.regs.sp, pc0 = b.pc;
    draw2UpLabel(b);
    assert.equal(b.regs.sp, sp0, "draw2UpLabel must leave SP unchanged (no stack modelling)");
    assert.equal(b.pc, pc0, "draw2UpLabel must leave pc unchanged (no ret modelling)");
    // And it must actually have stamped the three cells (EQUAL is not vacuous).
    for (const [addr, val] of EXPECT) {
      assert.equal(b.mem.read8(addr), val, `cell ${hx(addr)} should hold ${hx(val)} after draw2UpLabel`);
    }
  }
  console.log(`  EQUAL/captured: ${caps.length} real dispatches — game-visible RAM identical to the oracle`);
});

// -- 2. EQUAL (crafted pre-dirtied) -------------------------------------------

test("EQUAL (crafted): the stamp is UNCONDITIONAL — matches the oracle over any prior cell contents", () => {
  const caps = captureDispatches(1, 1200);
  assert.ok(caps.length >= 1, "need a real entry to craft from");
  const entry = caps[0];

  // Each craft pre-dirties the three target cells (and their immediate neighbours,
  // to catch an errant write to the wrong cell) IDENTICALLY on both sides.
  const dirt = [
    ["all-0xFF", [[CELL_2, 0xff], [CELL_U, 0xff], [CELL_P, 0xff]]],
    ["all-0x00", [[CELL_2, 0x00], [CELL_U, 0x00], [CELL_P, 0x00]]],
    // Swap the three values around so a copy-from-wrong-source bug would surface.
    ["shuffled", [[CELL_2, 0x20], [CELL_U, 0x02], [CELL_P, 0x25]]],
    // Dirty the neighbouring rows too (0x74C0±0x20 etc.) — an off-by-a-row store
    // would then diverge against the oracle, which leaves them untouched.
    ["neighbours", [[CELL_2 + 0x20, 0x5a], [CELL_U, 0x5a], [CELL_P - 0x20, 0x5a], [0x7500, 0x5a]]],
  ];

  for (const [label, pokes] of dirt) {
    const a = entry.clone(); const b = entry.clone();
    for (const [addr, val] of pokes) { a.mem.write8(addr, val); b.mem.write8(addr, val); }
    oracle(a);
    draw2UpLabel(b);
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
 * Broken twin: stamps a wrong value into the routine's own first cell (0x74E0 gets
 * 0x01 — a plausible "wrote the P1 digit into the P2 marker"), otherwise identical.
 * It writes the other two cells correctly, so it diverges ONLY at 0x74E0.
 */
function brokenDraw2UpLabel(m) {
  const { mem } = m;
  mem.write8(CELL_2, 0x01); // BUG: should be 0x02
  mem.write8(CELL_U, 0x25);
  mem.write8(CELL_P, 0x20);
}

test("TEETH (captured): a wrong tile store is CAUGHT and names 0x74E0", () => {
  const caps = captureDispatches(64, 1200);
  assert.ok(caps.length >= 1, "need a real dispatch to test the teeth against");

  let caught = null;
  for (const entry of caps) {
    const { bad } = replay(entry, brokenDraw2UpLabel);
    if (bad) { caught = bad; break; }
  }
  assert.notEqual(caught, null, "the captured sweep FAILED to catch a wrong tile store — it is worthless");
  assert.equal(caught.addr, CELL_2, `expected the caught diff at ${hx(CELL_2)}, got ${hx(caught.addr)}`);
  console.log(`  TEETH/captured: caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});
