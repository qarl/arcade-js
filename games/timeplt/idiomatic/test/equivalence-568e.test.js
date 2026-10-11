// SPDX-License-Identifier: GPL-3.0-only
/**
 * requestOneShotCountdownSound — memory-equivalent to the frozen oracle at ROM 0x568E.
 *
 * WHAT IT IS. Two instructions: load one byte of the program image, then transfer to the shared
 * request body, WHICH IS ALREADY DECOMPILED — so the rewrite calls it directly with the byte as
 * an argument, and dissolving that transfer belongs to this caller's unit. The whole content of
 * the entry is therefore WHICH code it asks for and under WHICH permission.
 *
 * ★ THE TAPE HAD TO BE DRIVEN FURTHER. The shared coin-then-start tape never reaches this entry
 *   inside the harness budget, so this file drives its own longer tape that also fires and steers.
 *   The first arm asserts BOTH facts, so "we used a different tape" cannot quietly become "we
 *   never reached it".
 *
 * ★ THE TWIN A GENUINE IMAGE CANNOT DISCRIMINATE. A rewrite that hard-codes the code instead of
 *   reading it is byte-for-byte identical on an unmodified image, so one arm POKES the source byte
 *   and re-runs both sides: the routine must follow the poke and the baked-constant twin must not.
 *   That twin's blindness without the poke is asserted, so its agreement is never read as
 *   reassurance.
 *
 * GATE, holes stated:
 *   1. REACHED, and only by the longer tape — both asserted.
 *   2. EQUAL at the real dispatch, outside a four-byte dead scratch window below the entry stack
 *      pointer where the frozen body parks values the stack-free rewrite does not. Pinned.
 *   3. THE CODE IT REQUESTS, read back out of the queue rather than asserted about the source.
 *   4. IT READS THE IMAGE — the poked arm above.
 *   5. GATE CROSS — the permission cell swept, which is the only coverage of the dropping arm.
 *   6. EXHAUSTIVE over the queue length, 0..255.
 *   7. TEETH — four twins plus the baked-constant one, each on its own exact count.
 *
 * HOLE: WHAT the sound is. Nothing on this processor can say; the code is a byte handed to a
 * second one. This gate fixes which byte and under what permission, and claims nothing more.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-568e.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { allDiffs, hex4, oracleAt, realDiff, show, withPokedImage } from "./_soundQueue.js";
import { requestOneShotCountdownSound } from "../requestOneShotCountdownSound.js";
import { enqueueSoundIfGameInProgress } from "../enqueueSoundIfGameInProgress.js";
import { PLAY_ACTIVE } from "../names.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x568e;
const SOUND_CODE_CELL = 0x2d87;
const WRONG_SOURCE = SOUND_CODE_CELL + 1;
const POKED_CODE = 0x58;
const QUEUE_LENGTH = 0xac43;
const SCRATCH_BYTES = 4;

/** The longer tape, and the frame this entry is first reached on it. Measured. */
const TAPE_FRAMES = 2500;
const FIRST_DISPATCH = 1899;
const DISPATCHES = 1;

const skip = romsPresent() ? false : "ROM images are absent from this checkout";
const oracle = oracleAt(TARGET);

const IN0 = 0xc300;
const IN1 = 0xc320;
const HOLD = 8;
const TURN_HOLD = 60;
const TURN_FIRST_FRAME = 640;

/** Coin, start, then the trigger held while the stick walks round the compass. */
function drivenTape() {
  const tape = [
    { frame: COIN_FRAME, port: IN0, bits: 0x01, dur: HOLD },
    { frame: START_FRAME, port: IN0, bits: 0x08, dur: HOLD },
    { frame: TURN_FIRST_FRAME - HOLD, port: IN1, bits: 0x10, dur: TAPE_FRAMES },
  ];
  const compass = [0x01, 0x05, 0x04, 0x06, 0x02, 0x0a, 0x08, 0x09, 0x01, 0x04, 0x02, 0x08];
  let frame = TURN_FIRST_FRAME;
  for (let step = 0; step < 40; step++) {
    tape.push({ frame, port: IN1, bits: compass[step % compass.length], dur: TURN_HOLD });
    frame += TURN_HOLD;
  }
  return tape;
}

let captured = null;
let firstFrame = null;
let dispatchCount = 0;

function capture() {
  if (captured !== null) return captured;
  const m = makeMachine(
    new Map([[TARGET, (mm) => {
      dispatchCount++;
      if (captured === null) {
        captured = mm.clone();
        firstFrame = mm.frames.length;
      }
      return oracle(mm);
    }]]),
    { tape: drivenTape() },
  );
  m.runFrames(TAPE_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  return captured;
}

function entryState() {
  const e = capture();
  assert.notEqual(e, null, "vacuous: even the longer tape never reached the routine");
  return e;
}

function craftedDiff(candidate, play, length) {
  const entry = entryState();
  const arms = [entry.clone(), entry.clone()];
  for (const s of arms) {
    s.mem8[PLAY_ACTIVE] = play;
    s.mem8[QUEUE_LENGTH] = length;
  }
  oracle(arms[0]);
  candidate(arms[1]);
  return realDiff(arms[0], arms[1], entry.regs.sp, SCRATCH_BYTES);
}

const PLAY_VALUES = [0x00, 0x01, 0xff];
const LENGTHS = [0, 3, 255];
const CROSS_SIZE = PLAY_VALUES.length * LENGTHS.length;

function crossCaught(candidate) {
  let caught = 0;
  for (const play of PLAY_VALUES) {
    for (const length of LENGTHS) if (craftedDiff(candidate, play, length)) caught++;
  }
  return caught;
}

/** The code the frozen entry actually appended, from a state where the request is admitted. */
function codeAppendedByOracle() {
  const s = entryState().clone();
  s.mem8[PLAY_ACTIVE] = 0xff;
  s.mem8[QUEUE_LENGTH] = 2;
  oracle(s);
  assert.equal(s.mem8[QUEUE_LENGTH], 3, "the admitted request did not append at all");
  return s.mem8[QUEUE_LENGTH + 3];
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("REACHED, and only by the longer tape", { skip }, () => {
  const entry = entryState();
  assert.equal(dispatchCount, DISPATCHES, "the dispatch count on the longer tape moved");
  assert.equal(firstFrame, FIRST_DISPATCH, "the frame it is first reached on moved");
  let onShared = 0;
  const shared = makeMachine(new Map([[TARGET, (mm) => (onShared++, oracle(mm))]]));
  shared.runFrames(ENTRY_FRAMES);
  assert.equal(onShared, 0, "the shared tape now reaches it, so this gate should use that instead");
  console.log(
    `  REACHED: ${dispatchCount} dispatch at frame ${firstFrame} on the longer tape, ` +
      `${onShared} on the shared one; entry sp=${hex4(entry.regs.sp)}`,
  );
});

test("EQUAL at the real dispatch: identical outside the scratch window", { skip }, () => {
  const entry = entryState();
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  requestOneShotCountdownSound(b);
  const d = realDiff(a, b, entry.regs.sp, SCRATCH_BYTES);
  assert.equal(d, null, `a divergence escaped the scratch window — ${show(d)}`);
  assert.ok(allDiffs(a, b).length > 0, "nothing differs at all — the parked values vanished");
  assert.deepEqual(
    REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
    ["a", "sp"],
    "the excluded set changed shape",
  );
  console.log(
    `  EQUAL: play=${entry.mem8[PLAY_ACTIVE]} length=${entry.mem8[QUEUE_LENGTH]}; identical ` +
      `outside [SP-${SCRATCH_BYTES}, SP)`,
  );
});

test("THE CODE IT REQUESTS: the byte the frozen entry appends", { skip }, () => {
  const code = codeAppendedByOracle();
  const b = entryState().clone();
  b.mem8[PLAY_ACTIVE] = 0xff;
  b.mem8[QUEUE_LENGTH] = 2;
  requestOneShotCountdownSound(b);
  assert.equal(b.mem8[QUEUE_LENGTH + 3], code, "the rewrite appended a different code");
  console.log(`  CODE: both sides append ${code}`);
});

test("IT READS THE IMAGE: the requested code follows a poked source byte", { skip }, () => {
  const entry = entryState();
  const genuine = codeAppendedByOracle();
  assert.notEqual(POKED_CODE, genuine, "the poke must actually change the byte");
  withPokedImage(entry, SOUND_CODE_CELL, POKED_CODE, () => {
    assert.equal(codeAppendedByOracle(), POKED_CODE, "the frozen entry ignored the poked byte");
    const d = craftedDiff(requestOneShotCountdownSound, 0xff, 3);
    assert.equal(d, null, `the rewrite diverged under the poke — ${show(d)}`);
  });
  assert.equal(codeAppendedByOracle(), genuine, "the poke leaked past its own scope");
  console.log("  READS THE IMAGE: the appended code tracks the source byte, and the poke is undone");
});

test("GATE CROSS: the permission cell swept, including the dropping arm", { skip }, () => {
  for (const play of PLAY_VALUES) {
    for (const length of LENGTHS) {
      const d = craftedDiff(requestOneShotCountdownSound, play, length);
      assert.equal(d, null, `play=${play} length=${length}: ${show(d)}`);
    }
  }
  const dropped = entryState().clone();
  dropped.mem8[PLAY_ACTIVE] = 0;
  dropped.mem8[QUEUE_LENGTH] = 2;
  oracle(dropped);
  assert.equal(dropped.mem8[QUEUE_LENGTH], 2, "the cleared permission no longer drops the request");
  console.log(`  GATE CROSS: ${CROSS_SIZE} permission x length combinations identical`);
});

test("EXHAUSTIVE over the queue length", { skip }, () => {
  for (let length = 0; length < 256; length++) {
    const d = craftedDiff(requestOneShotCountdownSound, 0xff, length);
    assert.equal(d, null, `length=${length}: ${show(d)}`);
  }
  console.log("  EXHAUSTIVE: 256 queue lengths identical");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

const TWINS = [
  ["no-op", () => {}, 6],
  ["wrong-source", (m) => enqueueSoundIfGameInProgress(m, m.mem8[WRONG_SOURCE]), 6],
  ["ungated", (m) => {
    const was = m.mem8[PLAY_ACTIVE];
    m.mem8[PLAY_ACTIVE] = 0xff;
    requestOneShotCountdownSound(m);
    m.mem8[PLAY_ACTIVE] = was;
  }, 3],
  ["code-off-by-one", (m) => enqueueSoundIfGameInProgress(m, m.mem8[SOUND_CODE_CELL] + 1), 6],
];

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of the cross`, { skip }, () => {
    assert.equal(crossCaught(twin), expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${expected} of ${CROSS_SIZE} cross entries`);
  });
}

test("TEETH: the baked-constant twin is BLIND on a genuine image and caught under the poke", { skip }, () => {
  const genuine = codeAppendedByOracle();
  const baked = (m) => enqueueSoundIfGameInProgress(m, genuine);
  assert.equal(
    crossCaught(baked),
    0,
    "a genuine image was expected to be blind to it; if it is not, this arm proves nothing",
  );
  const caught = withPokedImage(entryState(), SOUND_CODE_CELL, POKED_CODE, () => crossCaught(baked));
  assert.ok(caught > 0, "the poked cross ALSO passed it — nothing here tests that the read is live");
  console.log(`  TEETH/baked-constant: blind on a genuine image, caught on ${caught} poked`);
});
