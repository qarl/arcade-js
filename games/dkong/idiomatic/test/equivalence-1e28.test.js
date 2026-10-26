// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for awardScorePopup (ROM 0x1E28) — the score-award + popup-glyph
 * routine (post a score task, stage the number sprite at Mario, ping the sound).
 *
 * awardScorePopup WRITES memory (the task ring + tail, the four POPUP_SPRITE bytes at
 * 0x6A30, and conditionally SND_TRIGGER[5]) and CALLS two subroutines (enqueueTask
 * 0x309F, boardBitGate 0x0030), so it is gated by capture / clone / replay (docs/decompiler-pipeline),
 * NOT the exhaustive-leaf pattern. A FRESH clone is used per case because the routine
 * mutates RAM. The oracle models the Z80 stack (`push … call … rst … ret`, moving
 * SP/pc); the idiomatic version uses the JS call stack and models neither, so the only
 * tolerated residue is the pushed return-address bytes inside dead STACK_SCRATCH —
 * every game-visible byte must match.
 *
 *   1. EQUAL (real captured dispatches) — hook 0x1E28 in a real attract run and clone
 *      the machine at each true dispatch. Attract reaches it on 25m as a barrel-jump
 *      award (BOARD==1, E=1, B=0x7B: the gate-OPEN / sound arm). For each, run the
 *      ORACLE and awardScorePopup on independent clones and confirm identical RAM
 *      everywhere game-visible (diff confined to STACK_SCRATCH), and that the idiomatic
 *      version leaves SP/pc at their entry values (no stack modelling).
 *
 *   2. EQUAL (crafted arms) — attract only exercises one tier on one board, so the arms
 *      it never reaches are forced by poking a real entry IDENTICALLY on both sides
 *      (the crafted entry, docs/decompiler-pipeline): the other two score tiers (E=3/B=0x7D, E=5/B=0x7F)
 *      and every board — BOARD 2 and 4 CLOSE the `rst 0x30` gate (no sound), BOARD 3
 *      OPENS it (sound). The test asserts the gate actually branched both ways (oracle
 *      SND_TRIGGER[5] == 3 open vs 0 closed), so the conditional is proven non-vacuous.
 *
 *   3. TEETH — two deliberately-broken twins the gate MUST catch:
 *        (a) the popup Y written without the +0x14 below-Mario offset — a plausible
 *            dropped-constant bug, caught at 0x6A33 on the real captured dispatch;
 *        (b) the award sound written UNCONDITIONALLY (ignoring the board gate) — caught
 *            at SND_TRIGGER[5] on a crafted gate-closed (BOARD 2) entry.
 *      A gate a real corruption slips through is worthless.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1e28.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1e28 as oracle } from "../../translated/loc_1e28.js";
import { awardScorePopup } from "../awardScorePopup.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1e28;
const BOARD = 0x6227;
const MARIO_Y = 0x6205;
const POPUP_SPRITE = 0x6a30; // the 4-byte score-glyph sprite record
const POPUP_Y = 0x6a33; // +3, the popup Y byte
const AWARD_SOUND = 0x6085; // SND_TRIGGER[5]
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * Diff two machines' RAM. Returns the first difference OUTSIDE the stack scratch below the entry SP
 * (game-visible — a real failure) or null, plus how many bytes differed inside the
 * dead stack scratch (the tolerated push residue).
 */
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

/**
 * Replay one entry state through the oracle and a candidate on independent clones
 * (FRESH per side — the routine writes RAM), and return the diff plus both machines.
 */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/**
 * Hook 0x1E28 in a real attract run and clone the machine at up to K true dispatches.
 * The wrapper delegates to the oracle so the host run proceeds to a clean stop.
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

test("EQUAL (captured): awardScorePopup == oracle on every real attract dispatch (diff confined to stack)", () => {
  const caps = captureDispatches(8, 2000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1E28 dispatch during attract");

  let sawSoundArm = false;
  for (const entry of caps) {
    const { a, bad } = replay(entry, awardScorePopup);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) ` +
        `on board=${entry.mem.read8(BOARD)} B=${hx(entry.regs.b)}`,
    );

    // The oracle's pushes (0x1E2B for the enqueueTask call, 0x1E44 for the rst-0x30
    // gate) write into the stack; that residue must land inside STACK_SCRATCH, so
    // excluding it cannot mask a real diff.
    assert.ok(
      (entry.regs.sp - 4) >= STACK_SCRATCH.lo && entry.regs.sp <= STACK_SCRATCH.hi,
      `oracle's push targets must sit inside STACK_SCRATCH (SP=${hx(entry.regs.sp)})`,
    );

    // awardScorePopup must NOT model the stack: SP and pc unchanged from entry.
    const c = entry.clone();
    const sp0 = c.regs.sp, pc0 = c.pc;
    awardScorePopup(c);
    assert.equal(c.regs.sp, sp0, "awardScorePopup must leave SP unchanged (no stack modelling)");
    assert.equal(c.pc, pc0, "awardScorePopup must leave pc unchanged (no ret modelling)");

    // 25m attract dispatch is the gate-OPEN arm; confirm the sound really fired there,
    // so the captured run is exercising the continue arm (non-vacuous).
    if (entry.mem.read8(BOARD) === 1) {
      assert.equal(a.mem.read8(AWARD_SOUND), 0x03, "25m gate-open arm must fire SND_TRIGGER[5]");
      sawSoundArm = true;
    }
  }
  assert.ok(sawSoundArm, "expected a real 25m (gate-open) dispatch to exercise the sound arm");
  console.log(`  EQUAL/captured: ${caps.length} real dispatches — game-visible RAM identical to the oracle`);
});

// -- 2. EQUAL (crafted arms) --------------------------------------------------

test("EQUAL (crafted): the other score tiers and every board's gate arm match the oracle", () => {
  const caps = captureDispatches(1, 2000);
  assert.ok(caps.length >= 1, "need a real entry to craft from");
  const entry = caps[0];

  // Each craft pokes only score tier and/or BOARD, identically on both sides — a real
  // state with a surgical nudge (docs/decompiler-pipeline). `sound` is the EXPECTED gate outcome, which
  // we also assert on the oracle so the conditional is proven to branch both ways.
  const arms = [
    ["25m tier E=3/B=0x7D", (m) => { m.regs.e = 0x03; m.regs.b = 0x7d; }, true],
    ["25m tier E=5/B=0x7F", (m) => { m.regs.e = 0x05; m.regs.b = 0x7f; }, true],
    ["50m gate CLOSED", (m) => { m.mem.write8(BOARD, 2); }, false],
    ["75m gate OPEN", (m) => { m.mem.write8(BOARD, 3); }, true],
    ["100m gate CLOSED", (m) => { m.mem.write8(BOARD, 4); }, false],
    ["100m + tier E=5/B=0x7F", (m) => { m.mem.write8(BOARD, 4); m.regs.e = 0x05; m.regs.b = 0x7f; }, false],
  ];

  for (const [label, craft, soundExpected] of arms) {
    const a = entry.clone(); const b = entry.clone();
    craft(a); craft(b);
    // Zero the sound byte on both first, so "did the gate write it" is unambiguous.
    a.mem.write8(AWARD_SOUND, 0); b.mem.write8(AWARD_SOUND, 0);
    oracle(a);
    awardScorePopup(b);

    const { bad } = ramDiffMinusStack(a, b, entry.regs.sp);
    assert.equal(
      bad,
      null,
      bad && `${label}: game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );
    // Prove the gate branched the way this arm intends (non-vacuous conditional).
    assert.equal(
      a.mem.read8(AWARD_SOUND), soundExpected ? 0x03 : 0x00,
      `${label}: oracle gate outcome unexpected (SND_TRIGGER[5]=${hx(a.mem.read8(AWARD_SOUND))})`,
    );
    console.log(`  EQUAL/crafted ${label}: game-visible RAM identical; SND_TRIGGER[5]=${hx(a.mem.read8(AWARD_SOUND))}`);
  }
});

// -- 3. TEETH -----------------------------------------------------------------

/**
 * Broken twin (a): writes the popup Y as Mario's raw Y, dropping the +0x14
 * below-Mario offset — a plausible missing-constant bug. It diverges only at the
 * popup Y byte 0x6A33, which is exactly the subtle kind of error the gate must catch.
 */
function brokenPopupY(m) {
  const { regs, mem } = m;
  awardScorePopup(m); // do the real work…
  mem.write8(POPUP_Y, mem.read8(MARIO_Y)); // …then clobber Y back to the un-offset value
  void regs;
}

test("TEETH (captured): a popup-Y missing the +0x14 offset is CAUGHT and names 0x6A33", () => {
  const caps = captureDispatches(8, 2000);
  assert.ok(caps.length >= 1, "need a real dispatch to test the teeth against");

  let caught = null;
  for (const entry of caps) {
    const { bad } = replay(entry, brokenPopupY);
    if (bad) { caught = bad; break; }
  }
  assert.notEqual(caught, null, "the captured sweep FAILED to catch a wrong popup Y — it is worthless");
  assert.equal(caught.addr, POPUP_Y, `expected the caught diff at 0x6A33, got ${hx(caught.addr)}`);
  console.log(`  TEETH/captured: caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});

/**
 * Broken twin (b): fires the award sound UNCONDITIONALLY, ignoring the board gate — a
 * plausible "forgot the rst 0x30" bug. It agrees with the oracle on every gate-open
 * board and diverges only where the gate should have been CLOSED, so only a crafted
 * closed-gate entry catches it.
 */
function brokenIgnoresGate(m) {
  const { mem } = m;
  awardScorePopup(m);
  mem.write8(AWARD_SOUND, 0x03); // always assert the sound, even on 50m/100m
}

test("TEETH (crafted): ignoring the board gate is CAUGHT on a closed-gate board and names 0x6085", () => {
  const caps = captureDispatches(1, 2000);
  assert.ok(caps.length >= 1, "need a real entry to craft from");
  const entry = caps[0];

  // Force the gate-CLOSED arm (BOARD=2), zero the sound so a stray write is visible.
  const a = entry.clone(); const b = entry.clone();
  a.mem.write8(BOARD, 2); b.mem.write8(BOARD, 2);
  a.mem.write8(AWARD_SOUND, 0); b.mem.write8(AWARD_SOUND, 0);
  oracle(a);
  brokenIgnoresGate(b);

  const { bad } = ramDiffMinusStack(a, b, entry.regs.sp);
  assert.notEqual(bad, null, "the crafted closed-gate entry FAILED to catch an unconditional sound — it is worthless");
  assert.equal(bad.addr, AWARD_SOUND, `expected the caught diff at 0x6085, got ${hx(bad.addr)}`);
  assert.equal(bad.a, 0x00, "oracle must leave SND_TRIGGER[5] cleared on a closed-gate board");
  console.log(`  TEETH/crafted: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});
