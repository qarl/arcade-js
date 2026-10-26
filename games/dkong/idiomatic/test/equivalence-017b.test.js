// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for serviceCoinInput (ROM 0x017B) — the coin-input handler.
 *
 * serviceCoinInput WRITES memory (COIN_EDGE, COINS_PARTIAL, CREDITS, the coin-sound
 * trigger and — via enqueueTask — the task ring) and calls two subroutines, so it is
 * gated by capture / clone / replay (docs/decompiler-pipeline), with a FRESH clone per case since it
 * mutates RAM. The routine's exit stack (push/pop HL, two calls, ret) plus the two
 * callees' own stack traffic is the ONLY oracle-vs-idiomatic residue, and it is
 * confined to STACK_SCRATCH; the idiomatic uses the JS call stack instead:
 *
 *   1. EQUAL (real captured dispatches) — hook 0x017B in a real attract run. Attract
 *      inserts no coin, so every real dispatch hits the no-coin RE-ARM arm (write
 *      COIN_EDGE := 1). Confirm serviceCoinInput leaves game-visible RAM identical
 *      to the oracle (diff confined to STACK_SCRATCH), and that it moves neither
 *      SP nor pc (no stack modelling).
 *
 *   2. EQUAL (crafted arms) — the coin-ACCEPTED arms attract never reaches, forced by
 *      poking IN2 bit 7 (io.inputAssert[0x7D00]) plus the latch/state/DIP/credit bytes
 *      IDENTICALLY on both sides (the crafted entry — a real state, surgically nudged):
 *        · latch-not-armed  (COIN_EDGE 0 → ret z, no writes)
 *        · state3 skip-sound + not-enough pulses
 *        · sound + not-enough pulses (exercises silenceSound + coin chime)
 *        · full group → award a credit (+ enqueueTask)
 *        · credits at the 0x90 cap → award nothing
 *        · BCD-carry credit sums (0x09+1 → 0x10; 0x89+1 → 0x90) — the DAA path
 *
 *   3. TEETH — a twin that drops the DAA (plain 8-bit add instead of BCD) MUST be
 *      caught by the crafted sweep, naming CREDITS (0x6001). The oracle header calls
 *      this the score-critical DAA path; a gate that misses it is worthless.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-017b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_017b as oracle } from "../../translated/loc_017b.js";
import { serviceCoinInput } from "../serviceCoinInput.js";
import { silenceSound } from "../silenceSound.js";
import { enqueueTask } from "../enqueueTask.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  COIN_EDGE,
  COINS_PARTIAL,
  CREDITS,
  GAME_STATE,
  DIP_COINS_PER_CREDIT,
  DIP_CREDITS_PER_COIN,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x017b;
const IN2_PORT = 0x7d00;
const COIN1_BIT = 0x80;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/** Force IN2 bit 7 (COIN1) high for this machine's port reads. */
function assertCoin(m) {
  m.io.inputAssert = { [IN2_PORT]: COIN1_BIT };
}

/**
 * Diff two machines' RAM. Returns the first difference OUTSIDE the stack scratch below the entry SP
 * (game-visible — a real failure) or null, plus how many bytes differed inside the
 * dead stack scratch (the tolerated push/call/ret residue).
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
 * (FRESH per side — the routine writes RAM), and return the diff.
 */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/**
 * Hook 0x017B in a real attract run and clone the machine at up to K true dispatches
 * (once per frame from the NMI handler). Each clone is one real captured entry; the
 * wrapper delegates to the oracle so the host run proceeds to a clean stop.
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

test("EQUAL (captured): serviceCoinInput == oracle on every real attract dispatch (diff confined to stack)", () => {
  const caps = captureDispatches(64, 1200);
  assert.ok(caps.length >= 1, "expected at least one real 0x017B dispatch during attract");

  let sawRearm = false;
  for (const entry of caps) {
    const { bad } = replay(entry, serviceCoinInput);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );

    // Attract never inserts a coin: every dispatch must re-arm the latch (COIN_EDGE := 1).
    const after = entry.clone();
    serviceCoinInput(after);
    if (after.mem.read8(COIN_EDGE) === 1) sawRearm = true;

    // The idiomatic must NOT model the stack: SP and pc unchanged from entry.
    const b = entry.clone();
    const sp0 = b.regs.sp, pc0 = b.pc;
    serviceCoinInput(b);
    assert.equal(b.regs.sp, sp0, "serviceCoinInput must leave SP unchanged (no stack modelling)");
    assert.equal(b.pc, pc0, "serviceCoinInput must leave pc unchanged (no ret modelling)");
  }
  assert.ok(sawRearm, "attract dispatches should exercise the no-coin re-arm arm");
  console.log(`  EQUAL/captured: ${caps.length} real dispatches — game-visible RAM identical to the oracle`);
});

// -- 2. EQUAL (crafted arms) --------------------------------------------------

// Each craft pokes ONE arm's variables identically on both sides. `assertCoin`
// raises IN2 bit 7 (a real state with a surgical nudge, docs/decompiler-pipeline). These arms are
// unreachable in attract, which inserts no coin.
const ARMS = [
  // Coin present but latch already consumed -> ret z, no writes at all.
  ["latch-not-armed", (m) => { assertCoin(m); m.mem.write8(COIN_EDGE, 0x00); }],
  // In-game (state 3): skip the coin chime; not a full group -> inc tally, return.
  ["state3-skip-sound", (m) => {
    assertCoin(m);
    m.mem.write8(COIN_EDGE, 0x01);
    m.mem.write8(GAME_STATE, 0x03);
    m.mem.write8(DIP_COINS_PER_CREDIT, 0x03);
    m.mem.write8(COINS_PARTIAL, 0x00);
  }],
  // Attract (state != 3): silence + coin chime; not a full group -> inc tally, return.
  ["sound-not-enough", (m) => {
    assertCoin(m);
    m.mem.write8(COIN_EDGE, 0x01);
    m.mem.write8(GAME_STATE, 0x01);
    m.mem.write8(DIP_COINS_PER_CREDIT, 0x03);
    m.mem.write8(COINS_PARTIAL, 0x00);
  }],
  // Full group (1 coin / credit): reset tally, award 1 credit, post the task.
  ["full-group-award", (m) => {
    assertCoin(m);
    m.mem.write8(COIN_EDGE, 0x01);
    m.mem.write8(GAME_STATE, 0x01);
    m.mem.write8(DIP_COINS_PER_CREDIT, 0x01);
    m.mem.write8(COINS_PARTIAL, 0x00);
    m.mem.write8(DIP_CREDITS_PER_COIN, 0x01);
    m.mem.write8(CREDITS, 0x05);
  }],
  // Credits already at the 0x90 BCD cap: full group, but award nothing (ret nc).
  ["max-cap", (m) => {
    assertCoin(m);
    m.mem.write8(COIN_EDGE, 0x01);
    m.mem.write8(GAME_STATE, 0x01);
    m.mem.write8(DIP_COINS_PER_CREDIT, 0x01);
    m.mem.write8(COINS_PARTIAL, 0x00);
    m.mem.write8(DIP_CREDITS_PER_COIN, 0x01);
    m.mem.write8(CREDITS, 0x90);
  }],
  // BCD low-nibble carry: 0x09 + 0x01 -> 0x10 (not 0x0A) — the DAA path.
  ["bcd-carry-units", (m) => {
    assertCoin(m);
    m.mem.write8(COIN_EDGE, 0x01);
    m.mem.write8(GAME_STATE, 0x01);
    m.mem.write8(DIP_COINS_PER_CREDIT, 0x01);
    m.mem.write8(COINS_PARTIAL, 0x00);
    m.mem.write8(DIP_CREDITS_PER_COIN, 0x01);
    m.mem.write8(CREDITS, 0x09);
  }],
  // BCD tens carry: 0x89 + 0x01 -> 0x90 (still under the cap on entry).
  ["bcd-carry-tens", (m) => {
    assertCoin(m);
    m.mem.write8(COIN_EDGE, 0x01);
    m.mem.write8(GAME_STATE, 0x01);
    m.mem.write8(DIP_COINS_PER_CREDIT, 0x01);
    m.mem.write8(COINS_PARTIAL, 0x00);
    m.mem.write8(DIP_CREDITS_PER_COIN, 0x01);
    m.mem.write8(CREDITS, 0x89);
  }],
];

test("EQUAL (crafted): coin-accepted / sound / credit / cap / BCD arms match the oracle", () => {
  const caps = captureDispatches(1, 400);
  assert.ok(caps.length >= 1, "need a real entry to craft from");
  const entry = caps[0];

  for (const [label, craft] of ARMS) {
    const a = entry.clone(); const b = entry.clone();
    craft(a); craft(b);
    oracle(a);
    serviceCoinInput(b);
    const { bad } = ramDiffMinusStack(a, b, entry.regs.sp);
    assert.equal(
      bad,
      null,
      bad && `${label}: game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );
    console.log(
      `  EQUAL/crafted ${label}: COIN_EDGE=${hx(b.mem.read8(COIN_EDGE))} ` +
        `COINS_PARTIAL=${hx(b.mem.read8(COINS_PARTIAL))} CREDITS=${hx(b.mem.read8(CREDITS))} — game-visible RAM identical`,
    );
  }
});

// -- 3. TEETH -----------------------------------------------------------------

/**
 * Broken twin: faithful to serviceCoinInput in every arm EXCEPT it awards the credit
 * with a plain 8-bit add and NO DAA (drops the BCD correction the oracle header flags
 * as score-critical). Everything else — latch, tally, sound, cap, and the enqueued
 * task — is identical, so the ONLY byte that can diverge is CREDITS, and only when a
 * BCD carry fires. A gate that misses this misses the score-critical bug.
 */
function brokenServiceCoinInput(m) {
  const { regs, mem } = m;
  const coinPresent = (mem.read8(IN2_PORT) & COIN1_BIT) !== 0;
  if (!coinPresent) { mem.write8(COIN_EDGE, 0x01); return; }
  if (mem.read8(COIN_EDGE) === 0) return;
  if (mem.read8(GAME_STATE) !== 0x03) {
    silenceSound(m);
    mem.write8(0x6083, 0x03);
  }
  mem.write8(COIN_EDGE, 0x00);
  const partial = (mem.read8(COINS_PARTIAL) + 1) & 0xff;
  mem.write8(COINS_PARTIAL, partial);
  if (mem.read8(DIP_COINS_PER_CREDIT) !== partial) return;
  mem.write8(COINS_PARTIAL, 0x00);
  const credits = mem.read8(CREDITS);
  if (credits >= 0x90) return;
  mem.write8(CREDITS, (credits + mem.read8(DIP_CREDITS_PER_COIN)) & 0xff); // BUG: no DAA
  regs.de = 0x0400;
  enqueueTask(m);
}

test("TEETH (crafted): the dropped-DAA twin is CAUGHT and names 0x6001", () => {
  const caps = captureDispatches(1, 400);
  assert.ok(caps.length >= 1, "need a real entry to craft from");
  const entry = caps[0];

  let caught = null;
  for (const [, craft] of ARMS) {
    const a = entry.clone(); const b = entry.clone();
    craft(a); craft(b);
    oracle(a);
    brokenServiceCoinInput(b);
    const { bad } = ramDiffMinusStack(a, b, entry.regs.sp);
    if (bad) { caught = bad; break; }
  }
  assert.notEqual(caught, null, "the crafted sweep FAILED to catch a dropped DAA — it is worthless");
  assert.equal(caught.addr, CREDITS, `expected the caught diff at 0x6001, got ${hx(caught.addr)}`);
  console.log(`  TEETH/crafted: caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});
