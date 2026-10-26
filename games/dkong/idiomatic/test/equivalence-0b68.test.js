// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_0b68 (ROM 0x0B68) — step 6 of the opening
 * Kong-climb cutscene: even-frame gate / diagonal scroll of the ten-record sprite-object
 * block (Y += table delta, X -= 1) / on the 0x7F table wrap, stamp the next girder band via
 * loc_0da7 + a sound, count the band down, and on the last band arm SUBSTATE_TIMER and
 * advance INTRO_STEP 6 -> 7.
 *
 * loc_0b68 WRITES memory and is NOT a leaf: it calls addStrided (0x003D, via `rst 0x38`) to
 * nudge the sprite columns and loc_0da7 (0x0DA7) to draw a board-layout band (which in turn
 * calls the frozen oracle leaf sub_2ff0). So it is gated by capture / clone / replay (docs/decompiler-pipeline)
 * on MEMORY-equivalence against the frozen oracle — RAM − the stack scratch below the entry SP — never the full
 * register file and never cycles, with a FRESH clone per case. SP/pc are the dropped
 * stack/cycle model: the oracle's push/call/ret churn lands in STACK_SCRATCH, and its sentinel
 * arm's sub_2ff0 steps pc — so neither is compared against the oracle. (The idiomatic side is
 * SP-neutral — addStrided/loc_0da7 leave SP at entry and this routine never touches it — which
 * the realism pass asserts as a bonus invariant.)
 *
 * loc_0b68 dispatches ZERO times in plain attract (the intro cutscene is a credited game's
 * per-board head, GAME_SUBSTATE 7, INTRO_STEP 6), so it is validated on a DRIVEN coin+start
 * run plus crafted entries:
 *
 *   1. REALISM (captured driven dispatches) — drive coin+start into a credited game so the
 *      opening cutscene plays, hook 0x0b68, and clone the machine at every real dispatch.
 *      Replay oracle-vs-idiomatic on fresh clones and prove RAM(−stack) identical. Assert the
 *      natural distribution actually exercised the even-frame gate, the scroll arm, the
 *      sentinel arm, AND the one natural step-6 -> 7 advance (so an EQUAL result is not
 *      vacuous), and that the idiomatic side left SP untouched on every dispatch.
 *
 *   2. CRAFTED (forced scroll / more-bands / advance) — on a real captured base, poke the
 *      FRAME parity, the walk cursor (pointed at a scratch byte), and the band count
 *      identically on both sides to force each arm deterministically: a scroll step, a
 *      sentinel with bands remaining (count 3 -> 2, no advance), and the last-band advance
 *      (count 1 -> 0: INTRO_STEP+1, SUBSTATE_TIMER=0xB0). Each compared to the oracle on
 *      RAM(−stack).
 *
 *   3. TEETH — two deliberately-broken twins the cases above MUST catch: (a) a flipped
 *      X-scroll direction (+1 instead of −1), caught on a scroll case at the sprite X column
 *      0x6908; (b) a dropped INTRO_STEP advance on the last band, caught on a forced advance
 *      at INTRO_STEP 0x6385.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0b68.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0b68 as oracle } from "../../translated/loc_0b68.js";
import { loc_0b68 as idiomatic } from "../loc_0b68.js";
import { addStrided } from "../addStrided.js"; // idiomatic leaf, for the teeth twins
import { drawBoardLayout as loc_0da7 } from "../drawBoardLayout.js"; // idiomatic leaf, for the teeth twins
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, FRAME, SUBSTATE_TIMER, INTRO_STEP, SND_TRIGGER, SPRITE_OBJ_BLOCK } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0b68;
const SCROLL_CURSOR = 0x63c4; // 16-bit walk cursor into the ROM Y-delta table
const SCROLL_TABLE = 0x38cb; // ROM base the cursor loops back to on 0x7F
const BAND_COUNT = 0x638d; // girder bands left to stamp
const BAND_TABLE = 0x38dc; // ROM base of the band-record table
const OBJ_X = SPRITE_OBJ_BLOCK; // 0x6908 — record 0's X byte
const OBJ_Y = SPRITE_OBJ_BLOCK + 3; // 0x690B — record 0's Y byte
const SCRATCH = 0x6100; // scratch RAM the cutscene draw never writes — a safe home for a forced cursor target

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// A coin+start tape (as in the 0x0a76 / 0x0ae8 tests): coin on IN2 bit7 at frame 10, start1
// on IN2 bit2 at frame 30. Credits + starts a game so GAME_STATE reaches 3, the opening
// cutscene (sub-state 7) plays, and 0x0b68 dispatches while INTRO_STEP == 6.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

// First game-visible differing RAM byte between two machines, EXCLUDING the dead
// stack-scratch region (the memory-equivalence contract is RAM − the stack scratch below the entry SP).
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0, bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

/**
 * Drive a coin+start game and clone the machine at every real 0x0b68 dispatch (dispatchGameState
 * consults m.overrides for the computed target before dispatching). The wrapper clones the entry
 * state, then runs the oracle so the host game proceeds undisturbed. Capturing is gated off after
 * the host run so the isolated replays below cannot pollute it.
 */
function captureDrivenDispatches(K, maxFrames) {
  const caps = [];
  let capturing = true;
  const snap = new Map([[TARGET, (mm) => {
    if (capturing && caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  host.runFrames(maxFrames);
  capturing = false;
  return caps;
}

// A real captured mid-cutscene 0x0b68 entry, built once and reused as the base for every crafted
// case (cloned per case, never mutated).
let _base = null;
function craftedBase() {
  if (!_base) {
    const caps = captureDrivenDispatches(1, 700);
    assert.ok(caps.length >= 1, "expected a real 0x0b68 cutscene dispatch to craft from");
    _base = caps[0];
  }
  return _base;
}

// -- 1. REALISM (captured driven dispatches) ----------------------------------

test("REALISM: real captured cutscene 0x0b68 dispatches — RAM(−stack) identical; SP untouched", () => {
  const caps = captureDrivenDispatches(400, 900);
  assert.ok(caps.length >= 1, "expected at least one real 0x0b68 dispatch during the opening cutscene");

  let compared = 0, gate = 0, scroll = 0, sentinel = 0, advance = 0, spHeld = 0;
  for (const cap of caps) {
    // The oracle's per-record pushes must land inside STACK_SCRATCH for the exclusion to be sound.
    assert.ok(
      (cap.regs.sp - 8) >= STACK_SCRATCH.lo && cap.regs.sp <= STACK_SCRATCH.hi,
      `entry SP must sit inside STACK_SCRATCH with margin (SP=${hx(cap.regs.sp)})`,
    );

    const a = cap.clone(); // oracle
    const aFloor = a.regs.sp;
    const b = cap.clone(); // idiomatic

    const sp0 = b.regs.sp;
    oracle(a);
    idiomatic(b);
    if (b.regs.sp === sp0) spHeld++;

    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(
      bad,
      null,
      bad && `real-dispatch RAM diff at ${hx(bad.addr)}: oracle=${bad.a} idiomatic=${bad.b}`,
    );

    // Classify from the entry + oracle result so the coverage counts are non-vacuous.
    if (cap.mem.read8(FRAME) & 0x01) {
      gate++;
    } else {
      const byte = cap.mem.read8(cap.mem.read16(SCROLL_CURSOR));
      if (byte !== 0x7f) scroll++;
      else {
        sentinel++;
        if (a.mem.read8(INTRO_STEP) !== cap.mem.read8(INTRO_STEP)) advance++;
      }
    }
    compared++;
  }

  assert.equal(spHeld, compared, "scrollIntroClimbGirders must leave SP untouched on every dispatch");
  assert.ok(gate >= 1, "expected some even-frame-gated no-op dispatches");
  assert.ok(scroll >= 1, "expected many diagonal-scroll dispatches");
  assert.ok(sentinel >= 1, "expected the sentinel/band arm to fire at least once naturally");
  assert.ok(advance >= 1, "expected the natural step-6 -> 7 advance (last band) to be captured");
  console.log(
    `  REALISM: ${compared} real dispatches — RAM(−stack) identical; ` +
      `${gate} gate, ${scroll} scroll, ${sentinel} sentinel, ${advance} advance; SP held on all`,
  );
});

// -- 2. CRAFTED (forced scroll / more-bands / advance) ------------------------

/**
 * Clone a real base and force one arm by poking (identically on both sides) the FRAME parity,
 * the walk cursor (pointed at SCRATCH holding `cursorByte`), and the band count. Returns
 * [oracleClone, idiomaticClone] already run.
 */
function runCrafted({ cursorByte, band }) {
  const a = craftedBase().clone(), b = craftedBase().clone();
  for (const m of [a, b]) {
    m.mem.write8(FRAME, m.mem.read8(FRAME) & 0xfe); // force an even frame -> pass the gate
    m.mem.write8(SCRATCH, cursorByte);
    m.mem.write16(SCROLL_CURSOR, SCRATCH);
    if (band !== undefined) m.mem.write8(BAND_COUNT, band);
  }
  oracle(a);
  idiomatic(b);
  return [a, b];
}

test("CRAFTED: forced scroll / more-bands / last-band advance — RAM(−stack) identical", () => {
  // (a) SCROLL: cursor byte 0x02 (a non-sentinel delta) -> Y += 2, X -= 1 across the block.
  const [as, bs] = runCrafted({ cursorByte: 0x02 });
  const ds = ramDiffMinusStack(as, bs, craftedBase().regs.sp);
  assert.equal(ds.bad, null, ds.bad && `scroll RAM diff at ${hx(ds.bad.addr)} (oracle=${ds.bad.a} idiomatic=${ds.bad.b})`);
  assert.equal(as.mem.read8(OBJ_Y), (craftedBase().mem.read8(OBJ_Y) + 0x02) & 0xff, "oracle must add the delta to record 0's Y");
  assert.equal(as.mem.read8(OBJ_X), (craftedBase().mem.read8(OBJ_X) - 1) & 0xff, "oracle must decrement record 0's X");

  // (b) SENTINEL, bands remaining: cursor byte 0x7F, band 3 -> band 2, cursor reset, no advance.
  const [am, bm] = runCrafted({ cursorByte: 0x7f, band: 3 });
  const dm = ramDiffMinusStack(am, bm, craftedBase().regs.sp);
  assert.equal(dm.bad, null, dm.bad && `more-bands RAM diff at ${hx(dm.bad.addr)} (oracle=${dm.bad.a} idiomatic=${dm.bad.b})`);
  assert.equal(am.mem.read8(BAND_COUNT), 2, "oracle must count the band down 3 -> 2");
  assert.equal(am.mem.read16(SCROLL_CURSOR), SCROLL_TABLE, "oracle must loop the cursor back to 0x38cb");
  assert.equal(am.mem.read8(INTRO_STEP), craftedBase().mem.read8(INTRO_STEP), "more-bands must NOT advance INTRO_STEP");

  // (c) SENTINEL, last band: cursor byte 0x7F, band 1 -> band 0: arm timer + advance the step.
  const [aa, ba] = runCrafted({ cursorByte: 0x7f, band: 1 });
  const da = ramDiffMinusStack(aa, ba, craftedBase().regs.sp);
  assert.equal(da.bad, null, da.bad && `advance RAM diff at ${hx(da.bad.addr)} (oracle=${da.bad.a} idiomatic=${da.bad.b})`);
  assert.equal(aa.mem.read8(BAND_COUNT), 0, "oracle must count the last band down 1 -> 0");
  assert.equal(aa.mem.read8(SUBSTATE_TIMER), 0xb0, "oracle must arm SUBSTATE_TIMER=0xB0 on the last band");
  assert.equal(aa.mem.read8(INTRO_STEP), (craftedBase().mem.read8(INTRO_STEP) + 1) & 0xff, "oracle must inc INTRO_STEP on the last band");
  console.log("  CRAFTED: scroll, more-bands (3->2), and last-band advance (1->0) — RAM(−stack) identical; arms exercised");
});

// -- 3. TEETH -----------------------------------------------------------------

// Test-local mirrors of the routine's helpers (kept identical to the source) so each twin
// differs from the real routine in exactly one place.
const nibbleSwap = (v) => (((v << 4) | (v >> 4)) & 0xff);
function strideAddTen(m, hl, c) {
  const { regs } = m;
  regs.hl = hl; regs.c = c; regs.de = 0x0004; regs.b = 0x0a;
  addStrided(m);
}

/** Twin (a): flips the X-scroll direction — adds +1 to the X column instead of −1. Diverges on
 *  every scroll step at the sprite X column 0x6908. */
function brokenFlipX(m) {
  const { mem, regs } = m;
  if (mem.read8(FRAME) & 0x01) return;
  const cursor = mem.read16(SCROLL_CURSOR);
  const delta = mem.read8(cursor);
  if (delta !== 0x7f) {
    mem.write16(SCROLL_CURSOR, (cursor + 1) & 0xffff);
    strideAddTen(m, OBJ_Y, delta);
    strideAddTen(m, OBJ_X, 0x01); // BUG: should be 0xff (-1)
    return;
  }
  mem.write16(SCROLL_CURSOR, SCROLL_TABLE);
  mem.write8(SND_TRIGGER + 2, 0x03);
  const bandIdx = nibbleSwap((mem.read8(BAND_COUNT) - 1) & 0xff);
  regs.de = (BAND_TABLE + bandIdx) & 0xffff;
  loc_0da7(m);
  const left = (mem.read8(BAND_COUNT) - 1) & 0xff;
  mem.write8(BAND_COUNT, left);
  if (left !== 0) return;
  mem.write8(SUBSTATE_TIMER, 0xb0);
  mem.write8(INTRO_STEP, (mem.read8(INTRO_STEP) + 1) & 0xff);
}

/** Twin (b): drops the `inc (INTRO_STEP)` on the last band — the cutscene would hang on step 6
 *  forever. Diverges only on the last-band advance, at INTRO_STEP 0x6385. */
function brokenDropAdvance(m) {
  const { mem, regs } = m;
  if (mem.read8(FRAME) & 0x01) return;
  const cursor = mem.read16(SCROLL_CURSOR);
  const delta = mem.read8(cursor);
  if (delta !== 0x7f) {
    mem.write16(SCROLL_CURSOR, (cursor + 1) & 0xffff);
    strideAddTen(m, OBJ_Y, delta);
    strideAddTen(m, OBJ_X, 0xff);
    return;
  }
  mem.write16(SCROLL_CURSOR, SCROLL_TABLE);
  mem.write8(SND_TRIGGER + 2, 0x03);
  const bandIdx = nibbleSwap((mem.read8(BAND_COUNT) - 1) & 0xff);
  regs.de = (BAND_TABLE + bandIdx) & 0xffff;
  loc_0da7(m);
  const left = (mem.read8(BAND_COUNT) - 1) & 0xff;
  mem.write8(BAND_COUNT, left);
  if (left !== 0) return;
  mem.write8(SUBSTATE_TIMER, 0xb0);
  // BUG: no INTRO_STEP advance
}

/** Run oracle vs a twin on fresh clones of a crafted state; return the RAM(−stack) diff. */
function runTwinCrafted(twin, { cursorByte, band }) {
  const a = craftedBase().clone(), b = craftedBase().clone();
  const aFloor = a.regs.sp;
  for (const m of [a, b]) {
    m.mem.write8(FRAME, m.mem.read8(FRAME) & 0xfe);
    m.mem.write8(SCRATCH, cursorByte);
    m.mem.write16(SCROLL_CURSOR, SCRATCH);
    if (band !== undefined) m.mem.write8(BAND_COUNT, band);
  }
  oracle(a);
  twin(b);
  return ramDiffMinusStack(a, b, aFloor);
}

test("TEETH (flip-X): the wrong X-scroll direction is CAUGHT on a scroll step at 0x6908", () => {
  const { bad } = runTwinCrafted(brokenFlipX, { cursorByte: 0x02 });
  assert.notEqual(bad, null, "the scroll case FAILED to catch a flipped X direction — it is worthless");
  assert.equal(bad.addr, OBJ_X, `expected the caught diff at the sprite X column 0x6908, got ${hx(bad.addr)}`);
  console.log(`  TEETH/flip-X: caught at 0x6908 (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (drop-advance): the dropped INTRO_STEP inc is CAUGHT on the last band at 0x6385", () => {
  const { bad } = runTwinCrafted(brokenDropAdvance, { cursorByte: 0x7f, band: 1 });
  assert.notEqual(bad, null, "the last-band case FAILED to catch a dropped INTRO_STEP advance — it is worthless");
  assert.equal(bad.addr, INTRO_STEP, `expected the caught diff at INTRO_STEP 0x6385, got ${hx(bad.addr)}`);
  console.log(`  TEETH/drop-advance: caught at INTRO_STEP 0x6385 (oracle=${bad.a} broken=${bad.b})`);
});
