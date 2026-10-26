// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_12de (ROM 0x12de) — arm 2 (the hand-off) of the DEATH_ANIM_PHASE
 * (0x639D) dispatch, i.e. the last step of Mario's death animation: on sub-state-timer
 * expiry, clear the finished sub-state's sprite scratch, advance GAME_SUBSTATE (to the P1
 * life-loss handler 0x0E, or 0x0F for P2), and re-arm SUBSTATE_TIMER to fire immediately.
 *
 * loc_12de WRITES memory and gates on SUBSTATE_TIMER, so it is validated by
 * capture/clone/replay against the frozen oracle on the memory-equivalence contract:
 * RAM (minus the stack scratch below the entry SP) only. pc / SP / the register file are NOT compared — the
 * oracle's push16/rst/call/ret churn is the Z80 stack model the direct-call rewrite
 * drops; every byte of it lands in STACK_SCRATCH (SP sits at 0x6bec-0x6bf0 for every
 * real dispatch) and its residual A/HL/F are dead ABI (the rst-0x28 dispatch this
 * returns into reads none). A FRESH clone per side everywhere — the routine writes
 * memory, so a reused clone would carry a previous advance forward (docs/decompiler-pipeline: only a
 * pure read-only leaf may reuse one).
 *
 *   1. REALISM (real captured dispatches) — hook 0x12de in a real attract run and clone
 *      the machine at each true dispatch. Attract polls it every frame, so the caps span
 *      both the NON-EXPIRY arm (timer still counting -> only SUBSTATE_TIMER decremented)
 *      and the 1-player EXPIRY arm (clear + inc-by-one + re-arm); the test asserts at
 *      least one of each is really present. loc_12de reproduces the oracle's RAM on all.
 *
 *   2. CRAFTED 1P expiry (footprint pin) — a real capture with the whole 0x6900 page
 *      sentinel-filled and the timer forced to expire (0x600E = 0), so the exact
 *      seven-byte sprite-clear footprint + the GAME_SUBSTATE inc + the SUBSTATE_TIMER
 *      re-arm are all pinned. Independently asserts exactly the seven addresses zero.
 *
 *   3. CRAFTED 2P expiry (the double-inc arm THIS capture set never reaches) — 0x600E is 0
 *      for the whole attract run, so the extra `inc (hl)` is unreached by the captures used
 *      here. Forced expiry with 0x600E != 0 over several values and GAME_SUBSTATE wrap edges
 *      (0xFF -> 0x01, 0xFE -> 0x00) confirms +2 mod 256 matches the oracle's two incs.
 *      NOT a dead path in the game, though — that older claim is discharged: a natural
 *      two-player MAME run (two coins, 2P start, no pokes) took this arm on all three P2
 *      deaths, GAME_SUBSTATE stepping 0x0D -> 0x0F, with the P2 life-loss handler at ROM
 *      0x1344 entered 3× (scratchpad/pass13-grounding.md §2). Honest scope (R17): that run
 *      is NOT replayed here; this case remains crafted.
 *
 *   4. CRAFTED non-expiry — timer forced to a mid count: only SUBSTATE_TIMER is
 *      decremented, nothing else in non-stack RAM moves.
 *
 *   5. TEETH — three deliberately-broken twins the gate MUST catch:
 *      (a) wrong-timer-arm — re-arms SUBSTATE_TIMER to 0x40 (the sibling's value) not 1;
 *      (b) single-inc — always +1, ignoring the 2P double-inc; caught on a 2P entry;
 *      (c) skip-clear — omits loc_30db; caught on the sentinel page at the sprite bytes.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-12de.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_12de as oracle } from "../../translated/loc_12de.js";
import { loc_12de } from "../loc_12de.js";
import { tickSubstateTimer as tick } from "../tickSubstateTimer.js"; // reused inside the teeth twins
import { loc_30db as clear } from "../loc_30db.js"; //                    "        "        "
import { GAME_SUBSTATE, SUBSTATE_TIMER, STACK_SCRATCH } from "../names.js";
import { Machine } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x12de;
const PLAYER_INDEX = 0x600e; // 1P/2P index, unnamed in names.js
const SPRITE_CLEARS = [0x694c, 0x6958, 0x695c, 0x6960, 0x6964, 0x6968, 0x696c]; // loc_30db's footprint
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- the memory-equivalence contract: RAM minus the stack scratch below the entry SP ------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue; // the dropped Z80 stack model — not in the contract
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/**
 * Run the oracle and the candidate on two FRESH clones of `entry` and diff RAM (minus
 * STACK_SCRATCH). The oracle m.call's the rst-0x18 gate and 0x30db through the clone's
 * registry; a no-override Machine resolves those to the translated oracle table, so
 * "oracle" is the pure translated behaviour. Returns the first RAM diff or null.
 */
function runPair(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return firstRamDiff(a, b, entry.regs.sp);
}

/** Clone an entry and poke fields; returns the fresh clone. */
function craft(base, { timer, sub, player } = {}) {
  const e = base.clone();
  if (timer !== undefined) e.mem.write8(SUBSTATE_TIMER, timer);
  if (sub !== undefined) e.mem.write8(GAME_SUBSTATE, sub);
  if (player !== undefined) e.mem.write8(PLAYER_INDEX, player);
  return e;
}

/** Sentinel-fill a whole 256-byte page (page = high byte) with `val`. */
function paintPage(w, page, val) {
  for (let lo = 0; lo < 0x100; lo++) w.mem.write8(((page << 8) | lo) & 0xffff, val);
}

// -- capture ------------------------------------------------------------------

/**
 * Hook 0x12de in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper snapshots the entry state, then runs the oracle so the host game proceeds
 * undisturbed. Single runFrames() call — frame-by-frame stepping shifts NMI timing.
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

// Capture once at module load and reuse — the attract run is deterministic.
const CAPS = ROM_PRESENT ? captureDispatches(256, 3000) : [];
const isExpiryEntry = (cap) => ((cap.mem.read8(SUBSTATE_TIMER) - 1) & 0xff) === 0;

// -- 1. REALISM (captured dispatches) -----------------------------------------

test("REALISM: real captured 0x12de dispatches — loc_12de matches oracle RAM (both arms present)", () => {
  assert.ok(CAPS.length >= 1, "expected at least one real 0x12de dispatch during attract");

  let expiry = 0, nonExpiry = 0;
  for (const cap of CAPS) {
    (isExpiryEntry(cap) ? (expiry++) : (nonExpiry++));
    const ram = runPair(cap, loc_12de); // FRESH clones inside — cap untouched
    assert.equal(
      ram,
      null,
      ram &&
        `RAM diverges on real dispatch (timer=${hx(cap.mem.read8(SUBSTATE_TIMER))} ` +
        `sub=${hx(cap.mem.read8(GAME_SUBSTATE))} p=${hx(cap.mem.read8(PLAYER_INDEX))}) at ` +
        `${hx(ram.addr ?? 0)} (${ram.a}->${ram.b})`,
    );
  }
  assert.ok(nonExpiry >= 1, "expected at least one non-expiry (still-counting) real dispatch");
  assert.ok(expiry >= 1, "expected at least one real EXPIRY dispatch (the clear + advance arm)");
  console.log(`  REALISM: ${CAPS.length} real dispatches (${nonExpiry} non-expiry, ${expiry} expiry) — RAM == oracle`);
});

// -- 2. CRAFTED 1P expiry (footprint pin) -------------------------------------

test("CRAFTED 1P expiry (footprint pin): the seven-byte clear + inc + re-arm match the oracle", () => {
  assert.ok(CAPS.length >= 1, "need one real capture to craft from");
  const pin = craft(CAPS[0], { timer: 1, sub: 0x40, player: 0x00 }); // force expiry, 1-player
  paintPage(pin, 0x69, 0xee); // sentinel: only the seven cleared bytes may go to 0

  const ram = runPair(pin, loc_12de);
  assert.equal(ram, null, ram && `footprint pin diverges at ${hx(ram.addr ?? 0)} (${ram.a}->${ram.b})`);

  // Independently confirm exactly the seven sprite bytes were zeroed on the oracle side,
  // GAME_SUBSTATE advanced by one, and SUBSTATE_TIMER re-armed to 1.
  const o = pin.clone();
  oracle(o);
  const zeroed = [];
  for (let a = 0x6900; a < 0x6a00; a++) if (o.mem.read8(a) === 0x00) zeroed.push(hx(a));
  assert.deepEqual(zeroed, SPRITE_CLEARS.map(hx), `oracle sprite footprint was ${zeroed.join(",")}`);
  assert.equal(o.mem.read8(GAME_SUBSTATE), 0x41, "1-player expiry must advance GAME_SUBSTATE by ONE (0x40 -> 0x41)");
  assert.equal(o.mem.read8(SUBSTATE_TIMER), 0x01, "expiry must re-arm SUBSTATE_TIMER to 1");
  console.log(`  CRAFTED/1P: footprint ${zeroed.join(",")} zeroed; sub 0x40->0x41; timer->1 — candidate identical`);
});

// -- 3. CRAFTED 2P expiry (the double-inc arm attract never reaches) -----------

test("CRAFTED 2P expiry: the double-inc arm (0x600E != 0) matches the oracle, incl. wrap edges", () => {
  assert.ok(CAPS.length >= 1, "need one real capture to craft from");
  let count = 0;
  for (const player of [0x01, 0x02, 0x80, 0xff]) {
    for (const sub of [0x00, 0x07, 0x40, 0xfe, 0xff]) {
      const e = craft(CAPS[0], { timer: 1, sub, player });
      const ram = runPair(e, loc_12de);
      count++;
      assert.equal(
        ram,
        null,
        ram && `2P double-inc diverges (p=${hx(player)} sub=${hx(sub)}) at ${hx(ram.addr ?? 0)} (${ram.a}->${ram.b})`,
      );
      // Sanity: the oracle really advanced by TWO here (mod 256).
      const o = e.clone();
      oracle(o);
      assert.equal(o.mem.read8(GAME_SUBSTATE), (sub + 2) & 0xff, `2P must advance by two (sub=${hx(sub)})`);
    }
  }
  console.log(`  CRAFTED/2P: ${count} double-inc entries (4 players x 5 substates) — RAM == oracle, +2 mod 256`);
});

// -- 4. CRAFTED non-expiry ----------------------------------------------------

test("CRAFTED non-expiry: still-counting timer only decrements SUBSTATE_TIMER", () => {
  assert.ok(CAPS.length >= 1, "need one real capture to craft from");
  for (const timer of [0x02, 0x05, 0x80, 0xff]) {
    const e = craft(CAPS[0], { timer, sub: 0x40, player: 0x00 });
    paintPage(e, 0x69, 0xdd); // if the clear wrongly ran, the sentinel page would move
    const ram = runPair(e, loc_12de);
    assert.equal(ram, null, ram && `non-expiry diverges (timer=${hx(timer)}) at ${hx(ram.addr ?? 0)} (${ram.a}->${ram.b})`);

    const o = e.clone();
    oracle(o);
    assert.equal(o.mem.read8(SUBSTATE_TIMER), (timer - 1) & 0xff, "non-expiry must only decrement the timer");
    assert.equal(o.mem.read8(GAME_SUBSTATE), 0x40, "non-expiry must NOT touch GAME_SUBSTATE");
    assert.equal(o.mem.read8(0x694c), 0xdd, "non-expiry must NOT clear sprite scratch");
  }
  console.log("  CRAFTED/non-expiry: 4 timer values — only SUBSTATE_TIMER decremented");
});

// -- 5. TEETH -----------------------------------------------------------------

/** BUG: re-arms SUBSTATE_TIMER to 0x40 (the sibling's hold value) instead of 1. */
function teethWrongTimerArm(m) {
  const { mem } = m;
  if (!tick(m)) return;
  clear(m);
  const extra = mem.read8(PLAYER_INDEX) !== 0 ? 1 : 0;
  mem.write8(GAME_SUBSTATE, (mem.read8(GAME_SUBSTATE) + 1 + extra) & 0xff);
  mem.write8(SUBSTATE_TIMER, 0x40); // BUG: should be 1
}

/** BUG: always advances GAME_SUBSTATE by one — ignores the 2P double-inc. */
function teethSingleInc(m) {
  const { mem } = m;
  if (!tick(m)) return;
  clear(m);
  mem.write8(GAME_SUBSTATE, (mem.read8(GAME_SUBSTATE) + 1) & 0xff); // BUG: no +extra
  mem.write8(SUBSTATE_TIMER, 0x01);
}

/** BUG: skips loc_30db — never clears the sprite scratch. */
function teethSkipClear(m) {
  const { mem } = m;
  if (!tick(m)) return;
  const extra = mem.read8(PLAYER_INDEX) !== 0 ? 1 : 0;
  mem.write8(GAME_SUBSTATE, (mem.read8(GAME_SUBSTATE) + 1 + extra) & 0xff);
  mem.write8(SUBSTATE_TIMER, 0x01);
}

test("TEETH: wrong-timer-arm, single-inc, and skip-clear twins are all CAUGHT", () => {
  assert.ok(CAPS.length >= 1, "need one real capture to craft the teeth from");

  // (a) wrong-timer-arm — 1P expiry, caught at SUBSTATE_TIMER (0x40 vs 1).
  const eA = craft(CAPS[0], { timer: 1, sub: 0x40, player: 0x00 });
  const rA = runPair(eA, teethWrongTimerArm);
  assert.notEqual(rA, null, "the gate FAILED to catch the wrong-timer-arm twin — it is worthless");
  assert.equal(rA.addr, SUBSTATE_TIMER, `wrong-timer-arm must be caught at SUBSTATE_TIMER, got ${hx(rA.addr ?? 0)}`);

  // (b) single-inc — 2P expiry, caught at GAME_SUBSTATE (+1 vs +2).
  const eB = craft(CAPS[0], { timer: 1, sub: 0x40, player: 0x01 });
  const rB = runPair(eB, teethSingleInc);
  assert.notEqual(rB, null, "the gate FAILED to catch the single-inc twin — it is worthless");
  assert.equal(rB.addr, GAME_SUBSTATE, `single-inc must be caught at GAME_SUBSTATE, got ${hx(rB.addr ?? 0)}`);

  // (c) skip-clear — 1P expiry on a sentinel page, caught at the first sprite byte.
  const eC = craft(CAPS[0], { timer: 1, sub: 0x40, player: 0x00 });
  paintPage(eC, 0x69, 0xee);
  const rC = runPair(eC, teethSkipClear);
  assert.notEqual(rC, null, "the gate FAILED to catch the skip-clear twin — it is worthless");
  assert.equal(rC.addr, 0x694c, `skip-clear must be caught at 0x694c, got ${hx(rC.addr ?? 0)}`);

  console.log(`  TEETH: wrong-timer-arm@${hx(rA.addr)}, single-inc@${hx(rB.addr)}, skip-clear@${hx(rC.addr)} — all caught`);
});
