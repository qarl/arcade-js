// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_13bb (ROM 0x13bb) — the player-1 half of the in-game
 * player/display context reset: CURRENT_PLAYER(0x600D)=0, JOIN_VALUE_LO(0x600E)=0,
 * GAME_SUBSTATE(0x600A)=0, and the flip-screen latch 0x7D82=1 (upright). NB the byte
 * cleared at 0x600E is the join-value low byte, NOT TWO_PLAYER_GAME (which is 0x600F,
 * the high byte, and is not written here).
 *
 * loc_13bb WRITES memory (three work-RAM bytes) and the flip-screen board latch, and
 * READS nothing — it is a CONSTANT function of no inputs. So it is validated by
 * capture/clone/replay on a FRESH clone per case (docs/decompiler-pipeline) — never reusing one machine
 * for a case that writes memory, never the full register file, never cycles. The
 * compared contract is:
 *
 *   RAM (minus the stack scratch below the entry SP)  +  io.flipScreen (the 0x7D82 latch)
 *
 * The flip-screen latch is a board io output, NOT in the RAM dump, so comparing
 * io.flipScreen is load-bearing (a skipped flip-set is invisible to the RAM gate). No
 * live-out registers/flags (the rst-0x28 sub-state dispatch consumes none; the oracle's
 * residual A=1 is dead ABI); SP/PC are not compared — the idiomatic layer drops the
 * oracle's `ret` stack/PC bookkeeping (JS call stack).
 *
 * A 6000-frame attract run dispatches 0x13bb ZERO times, and so do 1P and 2P coin+start
 * runs (its sub-state is reached only in a credited game's player-switch path). So —
 * exactly as docs/decompiler-pipeline prescribes for arms attract never reaches — the gate is CRAFTED
 * from real booted machines with a surgical nudge, and because the routine has no inputs
 * the sweep is effectively exhaustive over its behaviour:
 *
 *   1. STRUCTURE — on a crafted entry, confirm game-visible RAM (ex-stack) + flip are
 *      identical to the oracle, that the oracle's `ret` pop target sits inside
 *      STACK_SCRATCH (so excluding the stack cannot mask a real diff), and that the
 *      idiomatic side models neither SP nor pc.
 *
 *   2. CONSTANT (diverse bases) — over several diverse real attract states, with all
 *      four outputs (600D/600E/600A + io.flipScreen) PRE-DIRTIED to sentinels identically
 *      on both sides, confirm RAM (ex-stack) + flip identical to the oracle AND that the
 *      oracle produced the fixed outcome (0/0/0, flip=1). Proves the output is
 *      input-independent and both agree — a dropped write cannot hide behind a stale value.
 *
 *   3. TEETH — three deliberately-broken twins MUST be caught: (a) a wrong CURRENT_PLAYER
 *      store (RAM diff at 0x600D); (b) a SKIPPED flip-set that leaves flip OFF
 *      (io.flipScreen diff — the check the RAM gate is blind to); (c) a SKIPPED
 *      TWO_PLAYER_GAME write (RAM diff at 0x600E).
 *
 *   4. REALISM — hook 0x13bb over a long attract run; replay any real dispatch, else
 *      record that attract never reaches this sub-state (why crafted is the gate).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-13bb.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_13bb as oracle } from "../../translated/loc_13bb.js";
import { selectPlayer1Context as idiomatic } from "../selectPlayer1Context.js";
import { Machine } from "../../machine.js";
import { CURRENT_PLAYER, GAME_SUBSTATE, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

// 0x600E is the join-value low byte (NOT TWO_PLAYER_GAME, which is the high byte 0x600F).
// names.js DOES name it ACTIVE_PLAYER_INDEX; it is written here as the low half of a 16-bit
// store, so the local constant names the JOIN, not the cell's own role.
const JOIN_VALUE_LO = 0x600e;

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x13bb;
const FLIPSCREEN = 0x7d82;
const SP_CRAFT = 0x6bf8; // inside STACK_SCRATCH: the oracle's `ret` pops from the dead region
const SENTINEL = 0xee; // a value none of the four outputs settles on, so a dropped write shows

const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * First observable difference between two machines after each has run its routine:
 * a RAM byte (skipping the stack scratch below the entry SP) OR the flip-screen board latch
 * (io.flipScreen — the 0x7D82 output, which is NOT in the RAM dump). RAM first, then
 * the latch. Returns null if identical.
 */
function firstDiffOutsideStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { kind: "ram", addr, a: da[i], b: db[i] };
  }
  if (a.io.flipScreen !== b.io.flipScreen) {
    return { kind: "flip", addr: FLIPSCREEN, a: a.io.flipScreen, b: b.io.flipScreen };
  }
  return null;
}

const fmt = (d) =>
  d && (d.kind === "flip"
    ? `flip-screen(${hx(d.addr)}) oracle=${d.a} cand=${d.b}`
    : `RAM ${hx(d.addr)} oracle=${d.a} cand=${d.b}`);

/** Run the oracle and `cand` on two FRESH clones of `entry` and diff (ex-stack + flip). */
function diffAgainstOracle(entry, cand) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  cand(b);
  return firstDiffOutsideStack(a, b, entry.regs.sp);
}

// Several diverse real attract states, each booted to a different frame so the
// surrounding work RAM genuinely differs. Cloned per case, never mutated in place.
const BASE_FRAMES = [150, 300, 600, 1200];
let _bases = null;
function bases() {
  if (!_bases) {
    _bases = BASE_FRAMES.map((f) => {
      const host = new Machine(ROM);
      host.runFrames(f);
      assert.equal(host.stoppedBy, null, `attract base run to ${f} must reach the vblank spin cleanly`);
      return host.clone();
    });
  }
  return _bases;
}

/**
 * A fresh clone of `base` with all four outputs PRE-DIRTIED to sentinels: the three
 * RAM bytes to SENTINEL and the flip latch to 0 (so the oracle's write to 1 is a real
 * change), SP parked inside STACK_SCRATCH. This is the "real state + surgical nudge".
 */
function craft(base) {
  const w = base.clone();
  w.mem.write8(CURRENT_PLAYER, SENTINEL);
  w.mem.write8(JOIN_VALUE_LO, SENTINEL);
  w.mem.write8(GAME_SUBSTATE, SENTINEL);
  w.io.flipScreen = 0;
  w.regs.sp = SP_CRAFT;
  return w;
}

test("STRUCTURE: crafted entry — game-visible RAM + flip identical, SP/pc unmodelled by idiomatic", () => {
  const entry = craft(bases()[0]);

  const d = diffAgainstOracle(entry, idiomatic);
  assert.equal(d, null, d && `divergence: ${fmt(d)}`);

  // The oracle's `ret` pops [SP, SP+1]; both must sit in STACK_SCRATCH, so excluding the
  // stack region in the diff cannot hide a real difference. (loc_13bb only pops, never
  // pushes, so SP itself is dead ABI.)
  assert.ok(SP_CRAFT >= STACK_SCRATCH.lo && (SP_CRAFT + 1) < STACK_SCRATCH.hi,
    `oracle pop target must sit inside STACK_SCRATCH (SP=${hx(SP_CRAFT)})`);

  // idiomatic must model neither the stack nor the return: SP and pc unchanged from entry.
  const c = craft(bases()[0]);
  const sp0 = c.regs.sp, pc0 = c.pc;
  idiomatic(c);
  assert.equal(c.regs.sp, sp0, "loc_13bb must leave SP unchanged (no stack modelling)");
  assert.equal(c.pc, pc0, "loc_13bb must leave pc unchanged (no ret modelling)");
  console.log("  STRUCTURE: crafted entry game-visible-identical; idiomatic touches no SP/pc; pop target in stack scratch");
});

test("CONSTANT: over diverse real bases, loc_13bb == oracle (RAM ex-stack + flip) and output is fixed", () => {
  let count = 0;
  for (const base of bases()) {
    const entry = craft(base);

    // Candidate reproduces the oracle exactly (RAM ex-stack + flip).
    const d = diffAgainstOracle(entry, idiomatic);
    assert.equal(d, null, d && `base diverged: ${fmt(d)}`);

    // And the oracle produced the fixed outcome (guards against a vacuous pass — every
    // output moved off its sentinel to the constant value).
    const o = entry.clone();
    oracle(o);
    assert.equal(o.mem.read8(CURRENT_PLAYER), 0, "oracle clears CURRENT_PLAYER to 0 (player 1)");
    assert.equal(o.mem.read8(JOIN_VALUE_LO), 0, "oracle clears JOIN_VALUE_LO to 0 (1-player-start marker)");
    assert.equal(o.mem.read8(GAME_SUBSTATE), 0, "oracle clears GAME_SUBSTATE to 0");
    assert.equal(o.io.flipScreen, 1, "oracle forces flip-screen ON");
    count++;
  }
  assert.equal(count, BASE_FRAMES.length, "must have swept every diverse base");
  console.log(`  CONSTANT: ${count} diverse bases — RAM (ex-stack) + flip identical; outputs pinned to 0/0/0, flip ON`);
});

/** Twin (a): stores the WRONG CURRENT_PLAYER (1, i.e. player 2) — a RAM diff at 0x600D. */
function brokenWrongPlayer(m) {
  const { mem } = m;
  mem.write8(CURRENT_PLAYER, 1); // BUG: should clear to 0 (player 1)
  mem.write8(JOIN_VALUE_LO, 0);
  mem.write8(GAME_SUBSTATE, 0);
  mem.write8(FLIPSCREEN, 1);
}

/** Twin (b): SKIPS the flip-set (leaves flip at the pre-dirtied 0) — an io.flipScreen diff. */
function brokenNoFlip(m) {
  const { mem } = m;
  mem.write8(CURRENT_PLAYER, 0);
  mem.write8(JOIN_VALUE_LO, 0);
  mem.write8(GAME_SUBSTATE, 0);
  // BUG: dropped `mem.write8(FLIPSCREEN, 1)` — the RAM gate is blind to this.
}

/** Twin (c): SKIPS the JOIN_VALUE_LO write (leaves the sentinel) — a RAM diff at 0x600E. */
function brokenNoJoin(m) {
  const { mem } = m;
  mem.write8(CURRENT_PLAYER, 0);
  // BUG: dropped `mem.write8(JOIN_VALUE_LO, 0)`
  mem.write8(GAME_SUBSTATE, 0);
  mem.write8(FLIPSCREEN, 1);
}

test("TEETH: wrong-player, skipped-flip, and skipped-join twins are all CAUGHT", () => {
  const entry = craft(bases()[0]);

  // (a) wrong player — caught as a RAM diff at CURRENT_PLAYER.
  const dPlayer = diffAgainstOracle(entry, brokenWrongPlayer);
  assert.notEqual(dPlayer, null, "the gate FAILED to catch a wrong CURRENT_PLAYER store — it is worthless");
  assert.equal(dPlayer.kind, "ram", "wrong-player must be caught as a RAM diff");
  assert.equal(dPlayer.addr, CURRENT_PLAYER, "wrong-player must diverge at CURRENT_PLAYER (0x600D)");
  assert.equal(dPlayer.a, 0, "oracle stores 0 (player 1)");
  assert.equal(dPlayer.b, 1, "broken twin stores 1 (player 2)");

  // (b) skipped flip-set — RAM is identical (all three bytes cleared); the ONLY tell is
  //     io.flipScreen. This is the check the RAM gate cannot make.
  const dFlip = diffAgainstOracle(entry, brokenNoFlip);
  assert.notEqual(dFlip, null, "the gate FAILED to catch a skipped flip-set — it is worthless");
  assert.equal(dFlip.kind, "flip", "skipped flip-set must be caught via io.flipScreen, not RAM");
  assert.equal(dFlip.a, 1, "oracle forces flip-screen ON");
  assert.equal(dFlip.b, 0, "broken twin leaves flip-screen OFF");

  // (c) skipped JOIN_VALUE_LO write — leaves the sentinel where the oracle clears to 0.
  const dJoin = diffAgainstOracle(entry, brokenNoJoin);
  assert.notEqual(dJoin, null, "the gate FAILED to catch a skipped JOIN_VALUE_LO write — it is worthless");
  assert.equal(dJoin.kind, "ram", "skipped join write must be caught as a RAM diff");
  assert.equal(dJoin.addr, JOIN_VALUE_LO, "skipped write must diverge at JOIN_VALUE_LO (0x600E)");
  assert.equal(dJoin.a, 0, "oracle clears JOIN_VALUE_LO to 0");
  assert.equal(dJoin.b, SENTINEL, "broken twin leaves the sentinel");

  console.log(
    `  TEETH: wrong-player caught at ${hx(dPlayer.addr)} (${dPlayer.a}->${dPlayer.b}); ` +
      `skipped-flip caught via flip-screen (${dFlip.a}->${dFlip.b}); ` +
      `skipped-join caught at ${hx(dJoin.addr)} (${dJoin.a}->${dJoin.b})`,
  );
});

test("REALISM: replay any real 0x13bb dispatch; else record that attract never reaches it", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < 16) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(6000);

  for (const entry of caps) {
    const d = diffAgainstOracle(entry, idiomatic);
    assert.equal(d, null, d && `real-dispatch divergence: ${fmt(d)}`);
  }
  if (caps.length === 0) {
    console.log("  REALISM: 0 real 0x13bb dispatches in 6000 attract frames — sub-state reached only in a credited game's player switch; crafted sweeps are the gate");
  } else {
    console.log(`  REALISM: ${caps.length} real 0x13bb dispatch(es) — game-visible RAM + flip identical to the oracle`);
  }
});
