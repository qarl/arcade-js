// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for centerMarioAndCommitClimbStep (ROM 0x1d51) — the ladder-centering
 * phase of a climb step. The routine WRITES memory and is not a leaf: it snaps MARIO_X
 * (0x6203) onto the ladder column, toggles MARIO_CLIMB_SOUND_TOGGLE (0x6224) and — on the
 * frame the toggle flips to 0 — requests the footstep sound via triggerWalkSound (which
 * writes SND_TRIGGER[0], 0x6080), then tails into markOnLadderAndCommitSprite (0x6215 := 1
 * and the 4 record bytes 0x694C..0x694F). It is gated on MEMORY-equivalence — RAM (minus
 * STACK_SCRATCH) + pc + SP — never a register file (live-out is memory-only; see the
 * routine header), on a FRESH clone per case (it writes RAM).
 *
 * The Z80 reaches its return by a `call z` to the sound trigger (which rets) and then a
 * tail-jump chain 0x1d49 -> 0x1da6 whose final `ret` is this routine's single net return.
 * The idiomatic routine models that `ret` as a JS return (no stack modelling), so the
 * harness performs ONE m.ret() on the candidate clone after the call to line pc + SP up
 * with the oracle. The oracle's transient `call z` push/pop lands in STACK_SCRATCH.
 *
 *   1. EQUAL (real dispatches) — hook 0x1d51 in a real attract run (the 25m demo climbs,
 *      so the centering phase dispatches here). oracle vs candidate must agree on RAM +
 *      pc + SP for every capture.
 *
 *   2. EQUAL (crafted) — from a real captured state, force MARIO_X's low nibble across all
 *      16 values (pinning the (X & ~7) | 3 snap) and force BOTH toggle phases
 *      (MARIO_CLIMB_SOUND_TOGGLE 0 -> 1 no-fire, 1 -> 0 fire), each compared identically
 *      both sides. Confirms the footstep fires on exactly the flip-to-0 phase.
 *
 *   3. TEETH — two deliberately-broken twins, each MUST be caught:
 *      (a) a dropped-center twin — skips the MARIO_X snap; diverges whenever X's low 3
 *          bits are not already 3 (on X and on the copied record byte 0x694C).
 *      (b) a dropped-footstep twin — skips the toggle + sound entirely; diverges on
 *          MARIO_CLIMB_SOUND_TOGGLE always and on SND_TRIGGER[0] on the fire phase.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1d51.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1d51 as oracle } from "../../translated/loc_1d51.js";
import { centerMarioAndCommitClimbStep } from "../centerMarioAndCommitClimbStep.js";
import { triggerWalkSound } from "../triggerWalkSound.js";
import { markOnLadderAndCommitSprite } from "../markOnLadderAndCommitSprite.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH, MARIO_X, MARIO_CLIMB_SOUND_TOGGLE, MARIO_SPRITE_RECORD, SND_TRIGGER,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1d51;
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP (the dead
 *  stack region the standard gate excludes — the oracle's `ret`/`call` pops read it). */
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Run the ORACLE on a fresh clone. Its tail chain ends in a `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/** Run a candidate on a fresh clone, then model its single net return with one m.ret()
 *  so pc + SP match the oracle's (the idiomatic routine uses the JS call stack and never
 *  touches pc/SP itself — the harness supplies the one net return). */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over the contract: RAM − the stack scratch below the entry SP, pc, SP. NO
 *  registers — live-out is memory-only. Returns human-readable mismatches. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

// -- capture ------------------------------------------------------------------

/** Hook 0x1d51 in a real attract run and clone the machine at up to K real dispatches.
 *  The wrapper snapshots the entry state, then runs the oracle so the host game proceeds
 *  undisturbed. loc_1d11 reaches here by `m.call(0x1d51)`, resolved through the registry
 *  the override overlays, so every real centering-phase dispatch is caught. */
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

/** A real captured state with MARIO_X and the climb-sound toggle poked. The real SP is
 *  kept (a valid return stack the game itself produced), so the ret modeling is honest. */
function craft(seed, { x, toggle }) {
  const e = seed.clone();
  e.mem.write8(MARIO_X, x);
  e.mem.write8(MARIO_CLIMB_SOUND_TOGGLE, toggle);
  e.mem.write8(SND_TRIGGER, 0x00); // clear residual so a footstep write to 3 is observable
  return e;
}

// -- teeth twins --------------------------------------------------------------

/** Broken twin (a): DROPPED-CENTER — skips the MARIO_X snap, so it agrees only where X's
 *  low 3 bits were already 3, and diverges on MARIO_X + the copied record byte otherwise. */
function brokenDropCenter(m) {
  const { mem } = m;
  // BUG: missing the MARIO_X snap.
  const climbSoundPhase = mem.read8(MARIO_CLIMB_SOUND_TOGGLE) ^ 1;
  mem.write8(MARIO_CLIMB_SOUND_TOGGLE, climbSoundPhase);
  if (climbSoundPhase === 0) triggerWalkSound(m);
  markOnLadderAndCommitSprite(m);
}

/** Broken twin (b): DROPPED-FOOTSTEP — skips the toggle + sound entirely, so it diverges
 *  on MARIO_CLIMB_SOUND_TOGGLE on every entry and on SND_TRIGGER[0] on the fire phase. */
function brokenDropFootstep(m) {
  const { mem } = m;
  mem.write8(MARIO_X, (mem.read8(MARIO_X) & ~7) | 3);
  // BUG: missing the toggle + triggerWalkSound.
  markOnLadderAndCommitSprite(m);
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): centerMarioAndCommitClimbStep == oracle on every captured 0x1d51 entry", () => {
  const caps = captureDispatches(64, 8000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1d51 dispatch during 25m attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, centerMarioAndCommitClimbStep); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const toggles = new Set(caps.map((c) => hx(c.mem.read8(MARIO_CLIMB_SOUND_TOGGLE))));
  const xs = new Set(caps.map((c) => c.mem.read8(MARIO_X) & 7));
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical on RAM+pc+SP ` +
      `(toggle at entry: ${[...toggles].join(",")}; MARIO_X low-3-bits seen: ${[...xs].join(",")})`,
  );
});

// -- 2. EQUAL (crafted) -------------------------------------------------------

test("EQUAL (crafted): all 16 MARIO_X low-nibbles and both toggle phases match the oracle", () => {
  const caps = captureDispatches(1, 8000);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  let count = 0, fires = 0, noFires = 0, mismatch = null;
  for (let lo = 0; lo < 16 && !mismatch; lo++) {
    for (const toggle of [0x00, 0x01]) {
      const x = 0x80 | lo; // a mid-screen X with the low nibble swept
      const e = craft(seed, { x, toggle });
      const diffs = contractDiffs(e, centerMarioAndCommitClimbStep);
      count++;
      // Cross-check the fire decision against the oracle's SND_TRIGGER[0] result.
      const o = runOracle(e);
      const fired = o.mem.read8(SND_TRIGGER) === 0x03;
      if (toggle === 0x01) { fires++; } else { noFires++; }
      assert.equal(fired, toggle === 0x01,
        `footstep must fire iff toggle flips to 0 (x=${hx(x)}, toggle=${hx(toggle)})`);
      // And the oracle must have snapped X's low 3 bits to 3.
      assert.equal(o.mem.read8(MARIO_X) & 7, 3, `oracle must snap MARIO_X low 3 bits to 3 (x=${hx(x)})`);
      assert.equal(o.mem.read8(MARIO_SPRITE_RECORD), o.mem.read8(MARIO_X),
        "the sprite record must copy the centered MARIO_X");
      if (diffs.length) mismatch = { x, toggle, diffs };
    }
  }
  assert.equal(mismatch, null,
    mismatch && `mismatch at x=${hx(mismatch.x)} toggle=${hx(mismatch.toggle)}: ${mismatch.diffs.join("; ")}`);
  assert.equal(count, 32, "must have swept 16 low-nibbles x 2 toggle phases");
  assert.equal(fires, 16, "the flip-to-0 phase must fire the footstep on all 16");
  assert.equal(noFires, 16, "the flip-to-1 phase must not fire on any");
  console.log(`  EQUAL/crafted: ${count} entries identical (16 fire, 16 no-fire; MARIO_X snapped to *&~7|3 each)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the dropped-center and dropped-footstep twins are CAUGHT", () => {
  const caps = captureDispatches(1, 8000);
  assert.ok(caps.length >= 1, "need a real capture to seed the teeth baits");
  const seed = caps[0];

  // Bait: X low nibble NOT already 3 (so the center snap is observable) and toggle on the
  // FIRE phase (so dropping the footstep loses both the toggle and the SND_TRIGGER write).
  const bait = craft(seed, { x: 0x84, toggle: 0x01 });

  const dropCenter = contractDiffs(bait, brokenDropCenter);
  const dropFootstep = contractDiffs(bait, brokenDropFootstep);
  assert.ok(dropCenter.length > 0, "the dropped-center twin escaped — the gate is worthless");
  assert.ok(dropFootstep.length > 0, "the dropped-footstep twin escaped — the gate is worthless");

  // The dropped-center twin must be caught on every real dispatch where X's low 3 bits
  // are not already 3 (i.e. where the snap actually changes memory).
  const notCentered = caps.filter((c) => (c.mem.read8(MARIO_X) & 7) !== 3);
  let caughtCenter = 0;
  for (const c of notCentered) if (contractDiffs(c, brokenDropCenter).length > 0) caughtCenter++;
  assert.equal(caughtCenter, notCentered.length,
    `dropped-center escaped on ${notCentered.length - caughtCenter}/${notCentered.length} real off-column dispatches`);

  console.log(
    `  TEETH: dropped-center caught on the bait (${dropCenter[0]}); ` +
      `dropped-footstep caught on the bait (${dropFootstep[0]})`,
  );
});
