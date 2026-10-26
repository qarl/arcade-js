// SPDX-License-Identifier: GPL-3.0-only
//
// idiomatic — the WHOLE-GAME gate for the coroutine runtime: the wired idiomatic layer under
// runIdiomaticGame must reproduce the translated oracle byte for byte over game state, through
// boot, attract, coin, start and play. This is what retired the assembled-swap gate.
//
// ⛔ THE ORACLE IS THE CYCLE-DRIVEN RUN. Under runCycleFree the drain takes one command per
// interrupt and the ring backs up (26 of 64 cells against 0 here), so that comparand goes red for
// the very behaviour the coroutine generator fixes. ★ Align by NMI ORDINAL, never frame index: boot burns no
// frames on a yield clock, and the tape must ride that same ordinal.
//
// COVERAGE THIS DOES NOT GIVE, and it is cited to retire another gate. MEMORY ONLY: dumpState is
// colour, video, work and sprite RAM, so the interrupt-enable latch and the watchdog are NOT
// compared -- deleting either store from the spine root leaves this green, measured, and
// equivalence-00a8 watches them. REACH: the tape dispatches 74 of 268 wired modules, five more are
// UNWIRED in registry-coverage.config.mjs, and ring command 0 has no translated routine.

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { Machine, CYCLES_PER_FRAME, resolveAllIdiomatic } from "../../machine.js";
import manifest from "../../manifest.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { COIN_COUNTER_PULSES_OWED, PLAY_ACTIVE } from "../names.js";
import { runIdiomaticGame } from "../../../../core/frame-stepped.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "ROM absent at games/timeplt/rom/maincpu.bin (BYO)" }, fn);

const [STACK_LO, STACK_HI] = manifest.convergence.stateExclude.stack;
const { nmiReturnPC } = manifest.convergence.idiomatic;
const { actions } = manifest.inputs;

const NMIS = 600;

// The tape in NMI ordinals, the only thing both engines agree on; directions rotate on a period
// coprime with the fire period so the two never phase-lock (tapes/coin_play.lua explains).
// ⚠ Ordinals are CHOSEN -- the engines share no frame origin -- and the second test MEASURES that
// the coin banks.
const COIN_AT = 100, START_AT = 160, PLAY_FROM = 220, HOLD = 8, TURN = 97, FIRE_EVERY = 23, FIRE_FOR = 7;
const DIRECTIONS = [actions.up, actions.right, actions.down, actions.left];

function inputAt(n, live) {
  if (!live) return null;
  const a = {};
  const press = (act) => { a[act.port] = (a[act.port] || 0) | act.bit; };
  if (n >= COIN_AT && n < COIN_AT + HOLD) press(actions.coin);
  if (n >= START_AT && n < START_AT + HOLD) press(actions.start1);
  if (n >= PLAY_FROM) {
    press(DIRECTIONS[Math.floor((n - PLAY_FROM) / TURN) % 4]);
    if ((n - PLAY_FROM) % FIRE_EVERY < FIRE_FOR) press(actions.fire);
  }
  return a;
}

/** dumpState minus the stack scratch below `sp` (the oracle's SP at that interrupt), built from the
 *  memory's OWN offset-to-address map so it cannot drift if the layout is reordered. ⚠ Do NOT widen
 *  past the measured floor -- the bytes below are written by nothing, so a leaking SP walks into them
 *  FIRST and a wider window hides it. */
function buildMask(mem, sp) {
  const size = mem.dumpState().length;
  const keep = new Uint8Array(size);
  const dead = deadStackBelow({ lo: STACK_LO, hi: STACK_HI }, sp);
  for (let off = 0; off < size; off++) keep[off] = dead(mem.stateOffsetToAddr(off)) ? 0 : 1;
  return keep;
}

function firstDifference(a, b, keep, mem) {
  for (let off = 0; off < a.length; off++) {
    if (keep[off] && a[off] !== b[off]) return { addr: mem.stateOffsetToAddr(off), a: a[off], b: b[off] };
  }
  return null;
}

async function runOracle(live) {
  const m = await Machine.create(ROM, {});
  m.maxCycles = (NMIS + 500) * CYCLES_PER_FRAME;
  const states = new Map();
  const sps = new Map();
  const realFire = m.fireNmi.bind(m);
  m.fireNmi = function () {
    if (m.nmiCount <= NMIS) {
      m.io.inputAssert = inputAt(m.nmiCount, live);
      states.set(m.nmiCount, Buffer.from(m.mem.dumpState()));
      sps.set(m.nmiCount, m.regs.sp);
    }
    return realFire();
  };
  let stop = null;
  try { m.reset(); } catch (e) { stop = e; }
  return { m, states, sps, stop };
}

async function runIdiomatic(live) {
  const overrides = await resolveAllIdiomatic(new URL("../../machine.js", import.meta.url));
  const m = await Machine.create(ROM, { overrides });
  const states = new Map();
  // ⚠ WATCHED DURING THE RUN: both are transient, and read at the end they said zero on a run that
  // had demonstrably taken the coin.
  const everSet = { coin: false, play: false };
  const r = runIdiomaticGame(m, {
    nmiReturnPC,
    maxFrames: NMIS,
    onFrame: (mm, f) => {
      if (f < 1) return;
      mm.io.inputAssert = inputAt(f - 1, live);
      if (mm.mem.read8(COIN_COUNTER_PULSES_OWED)) everSet.coin = true;
      if (mm.mem.read8(PLAY_ACTIVE)) everSet.play = true;
      states.set(f - 1, Buffer.from(mm.dumpState()));
    },
  });
  return { m, states, run: r, everSet };
}

test("the idiomatic game reproduces the oracle byte for byte, through coin, start and play", async () => {
  const oracle = await runOracle(true);
  const cand = await runIdiomatic(true);

  assert.equal(cand.run.stopError, null, `the coroutine run failed: ${cand.run.stop}`);
  assert.equal(cand.run.frames, NMIS, `the coroutine run stopped early: ${cand.run.stop}`);
  assert.ok(
    oracle.states.size > NMIS - 2,
    `the oracle produced only ${oracle.states.size} interrupts; it stopped on ${oracle.stop}`,
  );

  for (let n = 0; n < NMIS; n++) {
    const a = oracle.states.get(n), b = cand.states.get(n);
    assert.ok(a && b, `missing a sample at interrupt ${n}`);
    const d = firstDifference(a, b, buildMask(cand.m.mem, oracle.sps.get(n)), cand.m.mem);
    assert.equal(
      d, null,
      d && `interrupt ${n}: 0x${d.addr.toString(16)} oracle=${d.a} idiomatic=${d.b} -- the idiomatic ` +
        "game diverged from the translated oracle. Compare against the CYCLE-DRIVEN oracle only; " +
        "runCycleFree drains one ring command per interrupt and disagrees here by design.",
    );
  }
});

test("the tape is not inert: the input reaches the game and changes where it goes", async () => {
  const played = await runIdiomatic(true);
  const idle = await runIdiomatic(false);

  const last = NMIS - 1;
  assert.notDeepEqual(
    played.states.get(last), idle.states.get(last),
    "the played and unplayed runs end identical, so the tape pressed nothing the game acted on",
  );
  assert.ok(played.everSet.coin, "the coin never registered, so coin, start and play were never exercised");
  assert.ok(played.everSet.play, "the game never entered play, so the gate above only compared attract");
  assert.equal(idle.everSet.coin, false, "the unplayed run banked a credit; the flag is not input-driven");
  assert.equal(idle.everSet.play, false, "the unplayed run entered play; the flag is not input-driven");
});
