// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_1880 (ROM 0x1880) — step 4 of the even-board board-advance /
 * "how high" interlude render sequence (GAME_SUBSTATE 0x600A == 0x16, dispatched through
 * the 0x6388 step selector by dispatchRivetBoardInterludeStep's table at 0x1648).
 *
 * loc_1880 WRITES memory and is NOT a leaf — every frame it nudges the ten-record
 * sprite-object block down one pixel (rst 0x38, addToSpriteObjectColumn), then FORKS on
 * record 4's Y (0x691b):
 *   - DESCEND (0x691b != 0xD0 after the +1): return, having only slid the block.
 *   - LANDED  (0x691b == 0xD0): build the next scene — set record 4's code (0x6919),
 *     stage a 4-byte object record at 0x6a24, fill 70 VRAM tiles from 0x76c6 (loc_1826),
 *     draw the board segment layout from ROM 0x3a5f (loc_0da7), shift sprite-buffer
 *     records 0/1 down 0x28 (addStrided), reset the 0x62af pace counter, pulse sound
 *     latch 0x6082, and advance the 0x6388 step.
 * So it is gated by capture / clone / replay (docs/decompiler-pipeline) with a FRESH clone per case. Its
 * only input-dependent WRITEs on the LANDED arm are the 0x6388 `inc` (the rest of the
 * scene build is a deterministic fill/draw/shift off ROM + fixed constants); the gate
 * input is the single byte 0x691b.
 *
 * A long attract run dispatches 0x1880 ZERO times (attract never completes a board, so it
 * never reaches GAME_SUBSTATE 0x16), so — exactly as docs/decompiler-pipeline prescribes for arms attract
 * never reaches — the gate is CRAFTED: a real booted attract machine, cloned, with the
 * input bytes surgically poked, then oracle-vs-idiomatic on independent fresh clones. The
 * inputs are small, so the crafted sweeps are EXHAUSTIVE:
 *
 *   1. STRUCTURE — a crafted LANDED entry (full scene build): game-visible RAM identical,
 *      the oracle's salient outputs asserted (so EQUAL is not vacuous), the oracle's
 *      pushes land in STACK_SCRATCH (so excluding stack cannot mask a real diff). A
 *      DESCEND entry confirms the block is nudged but no scene is built (step not
 *      advanced), and that the idiomatic descend arm touches no SP/pc (a pure JS path).
 *
 *   2. GATE (exhaustive) — sweep the 0x691b gate byte 0..255. After the +1 descend nudge
 *      only 0xCF -> 0xD0 fires the payload; the other 255 merely slide the block. Both
 *      arms asserted, game-visible RAM identical over all 256.
 *
 *   3. STEP (exhaustive) — at LANDED (gate 0xCF) sweep the 0x6388 step byte 0..255. Pins
 *      the `inc` (result = (step+1)&0xFF, incl. the 0xFF->0x00 wrap), full work footprint
 *      identical each time.
 *
 *   4. TEETH — three twins the sweeps MUST catch: (a) a dropped 0x6388 `inc`, caught by
 *      the step sweep naming 0x6388; (b) a dropped 0x6082 sound latch, caught at LANDED
 *      naming 0x6082; (c) a WRONG gate constant (fires on 0xCF-post-nudge, i.e. never on
 *      the real landing) that skips the whole scene build, caught at LANDED.
 *
 *   5. REALISM — hook 0x1880 over a long attract run; replay any real dispatch, else
 *      record that attract never reaches this interlude (why crafted is the gate).
 *
 * HOLE — the 0x1826 tile fill is BLIND on both sides. The idiomatic routine deliberately
 * calls the frozen oracle at 0x1826 and not its idiomatic twin (fillTileBlock, which exists
 * and is in ROUTINES): the oracle is a pure leaf ending in `ret`, so it consumes one
 * guest-stack word the twin's JS return does not. This gate cannot adjudicate that choice,
 * because BOTH sides call the same oracle for the fill — an injected 2-byte delta at that
 * call site was caught by neither this test nor the full-flip gate, and no run reaches the
 * call site (attract never builds this screen and there is no tape-driven convergence gate
 * for the interlude). So "the tile fill is equivalent" is NOT a claim this test supports;
 * what it checks is that the fill was invoked with the same HL on both sides.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1880.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1880 as oracle } from "../../translated/loc_1880.js";
import { loc_1880 as idiomatic } from "../loc_1880.js";
import { addToSpriteObjectColumn } from "../addToSpriteObjectColumn.js";
import { addStrided } from "../addStrided.js";
import { drawBoardLayout as loc_0da7 } from "../drawBoardLayout.js";
import { loc_1826 } from "../../translated/loc_1826.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, SPRITE_OBJ_BLOCK, SPRITE_BUFFER, SND_TRIGGER } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1880;
const GATE_Y = SPRITE_OBJ_BLOCK + 0x13; // 0x691b — record 4's Y (the descent gate)
const Y_COLUMN = SPRITE_OBJ_BLOCK + 3; // 0x690b — record 0's Y (nudged +1 every frame)
const REC4_CODE = SPRITE_OBJ_BLOCK + 0x11; // 0x6919
const OBJ_RECORD = 0x6a24; // staged 4-byte object record 7F 39 01 D8
const SPRITE_BUF_Y = SPRITE_BUFFER + 3; // 0x6903 — sprite-buffer record 0's Y
const TILE_FILL_DST = 0x76c6; // VRAM fill start
const PACE_COUNTER = 0x62af;
const SND_LATCH = SND_TRIGGER + 2; // 0x6082
const STEP_SELECTOR = 0x6388;
const LANDED_Y = 0xd0;
const GATE_FIRE = 0xcf; // pre-nudge gate value that becomes 0xD0 after the +1 (fires payload)
const SP_CRAFT = 0x6bf8; // inside STACK_SCRATCH; headroom for the oracle's nested rst/call pushes

const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * First game-visible differing RAM byte between two machines, EXCLUDING the dead
 * stack-scratch region (the memory-equivalence contract is RAM − the stack scratch below the entry SP).
 */
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

// A real booted attract machine, built once and reused as the base for every crafted
// entry (cloned per case, never mutated). Genuine work RAM; only the inputs move.
let _base = null;
function base() {
  if (!_base) {
    const host = new Machine(ROM);
    host.runFrames(200);
    assert.equal(host.stoppedBy, null, "attract base run must reach the vblank spin cleanly");
    _base = host.clone();
  }
  return _base;
}

/** Two independent FRESH clones of the base with identical input pokes (docs/decompiler-pipeline fresh
 *  clone per case — this routine writes RAM). Returns [oracleClone, candidateClone]. */
function craftPair(gate, step) {
  const a = base().clone(), b = base().clone();
  for (const m of [a, b]) {
    m.mem.write8(GATE_Y, gate);
    if (step !== undefined) m.mem.write8(STEP_SELECTOR, step);
    m.regs.sp = SP_CRAFT;
  }
  return [a, b];
}

// -- 1. STRUCTURE -------------------------------------------------------------

test("STRUCTURE: LANDED scene build — work RAM identical, salient outputs asserted; DESCEND builds nothing", () => {
  const baseStepY = base().mem.read8(SPRITE_BUF_Y); // 0x6903 before the +0x28 shift
  const baseColY = base().mem.read8(Y_COLUMN); // 0x690b before the +1 nudge

  // LANDED: gate 0xCF -> 0xD0 after the nudge, step poked to 0x40 so its advance is visible.
  const [a, b] = craftPair(GATE_FIRE, 0x40);
  const aFloor = a.regs.sp;
  oracle(a);
  idiomatic(b);
  const { bad, stackDiffs } = ramDiffMinusStack(a, b, aFloor);
  assert.equal(bad, null, bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);

  // The oracle actually built the scene — confirm the salient outputs so EQUAL is not vacuous.
  assert.equal(a.mem.read8(GATE_Y), LANDED_Y, "gate byte 0x691b must read 0xD0 after the +1 nudge");
  assert.equal(a.mem.read8(REC4_CODE), 0x20, "record 4's code (0x6919) must be set to 0x20");
  assert.deepEqual(
    [0, 1, 2, 3].map((i) => a.mem.read8(OBJ_RECORD + i)),
    [0x7f, 0x39, 0x01, 0xd8],
    "the 4-byte object record 7F 39 01 D8 must be staged at 0x6a24",
  );
  assert.equal(a.mem.read8(TILE_FILL_DST), 0x10, "loc_1826 must fill VRAM 0x76c6 with tile 0x10");
  assert.equal(a.mem.read8(SPRITE_BUF_Y), (baseStepY + 0x28) & 0xff,
    "sprite-buffer record 0's Y (0x6903) must be shifted down 0x28");
  assert.equal(a.mem.read8(PACE_COUNTER), 0x00, "the 0x62af pace counter must be reset to 0");
  assert.equal(a.mem.read8(SND_LATCH), 0x03, "sound latch 0x6082 must be armed to 3");
  assert.equal(a.mem.read8(STEP_SELECTOR), 0x41, "the 0x6388 step must advance 0x40 -> 0x41 at LANDED");
  assert.ok(stackDiffs > 0, "the oracle's pushes must land in STACK_SCRATCH (so the exclusion is load-bearing)");
  assert.ok((SP_CRAFT - 8) >= STACK_SCRATCH.lo && (SP_CRAFT + 2) <= STACK_SCRATCH.hi,
    `oracle push / pop targets must stay inside STACK_SCRATCH (SP=${hx(SP_CRAFT)})`);

  // DESCEND: gate 0x00 -> 0x01 after the nudge (never 0xD0) — only slides the block.
  const [c, d] = craftPair(0x00, 0x40);
  const cFloor = c.regs.sp;
  const dsp = d.regs.sp, dpc = d.pc;
  oracle(c);
  idiomatic(d);
  const descend = ramDiffMinusStack(c, d, cFloor);
  assert.equal(descend.bad, null, descend.bad && `DESCEND RAM diff at ${hx(descend.bad.addr)}`);
  assert.equal(c.mem.read8(STEP_SELECTOR), 0x40, "DESCEND must NOT advance the step (no scene built)");
  assert.equal(c.mem.read8(PACE_COUNTER) === 0x00 && c.mem.read8(SND_LATCH) === 0x03, false,
    "DESCEND must not run the scene-build writes");
  assert.equal(c.mem.read8(Y_COLUMN), (baseColY + 1) & 0xff, "DESCEND must still nudge the Y column +1");
  // The DESCEND arm is pure JS (only addToSpriteObjectColumn, no oracle callee) — no SP/pc drift.
  assert.equal(d.regs.sp, dsp, "idiomatic DESCEND arm must leave SP unchanged (direct call, no stack model)");
  assert.equal(d.pc, dpc, "idiomatic DESCEND arm must leave pc unchanged");
  console.log("  STRUCTURE: LANDED scene RAM identical (stackDiffs>0); DESCEND slides only, touches no SP/pc");
});

// -- 2. GATE (exhaustive) -----------------------------------------------------

test("GATE (exhaustive): loc_1880 == oracle over all 256 gate-byte values (0x691b)", () => {
  const baseStep = base().mem.read8(STEP_SELECTOR);
  let count = 0, fired = 0, slid = 0, mismatch = null;
  for (let v = 0; v < 256 && !mismatch; v++) {
    const [a, b] = craftPair(v); // do NOT poke step — detect payload via the step advance
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    count++;
    if (a.mem.read8(STEP_SELECTOR) !== baseStep) fired++; else slid++;
    if (bad) mismatch = { v, bad };
  }
  assert.equal(mismatch, null,
    mismatch && `mismatch at 0x691b=${hx(mismatch.v)}: RAM diff at ` +
      `${hx(mismatch.bad.addr)} (oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`);
  assert.equal(count, 256, "must have swept all 256 gate values");
  assert.equal(fired, 1, "exactly one gate value (0xCF -> 0xD0) must fire the payload");
  assert.equal(slid, 255, "the other 255 values must merely slide the block");
  console.log("  GATE/exhaustive: 256 values — game-visible RAM identical (1 payload at 0xCF, 255 sliding)");
});

// -- 3. STEP (exhaustive) -----------------------------------------------------

test("STEP (exhaustive): at LANDED, loc_1880 == oracle over all 256 step bytes", () => {
  let count = 0, wraps = 0, mismatch = null;
  for (let s = 0; s < 256 && !mismatch; s++) {
    const [a, b] = craftPair(GATE_FIRE, s); // gate 0xCF forces the payload
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    count++;
    assert.equal(a.mem.read8(STEP_SELECTOR), (s + 1) & 0xff,
      `oracle must set 0x6388 to (step+1)&0xFF at step=${hx(s)}`);
    if (s === 0xff && a.mem.read8(STEP_SELECTOR) === 0x00) wraps++;
    if (bad) mismatch = { s, bad };
  }
  assert.equal(mismatch, null,
    mismatch && `mismatch at step=${hx(mismatch.s)}: RAM diff at ${hx(mismatch.bad.addr)} ` +
      `(oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`);
  assert.equal(count, 256, "must have swept all 256 step values");
  assert.equal(wraps, 1, "the 0xFF -> 0x00 wrap must have been exercised");
  console.log("  STEP/exhaustive: 256 values — full work footprint identical (incl. 0xFF->0x00 wrap)");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Full scene build, faithful EXCEPT it DROPS the `inc (0x6388)` — so at LANDED the step
 *  stays at its input where the oracle advances it. */
function brokenNoAdvance(m) {
  const { regs, mem } = m;
  regs.hl = Y_COLUMN; regs.c = 0x01; addToSpriteObjectColumn(m);
  if (mem.read8(GATE_Y) !== LANDED_Y) return;
  mem.write8(REC4_CODE, 0x20);
  mem.write8(OBJ_RECORD + 0, 0x7f); mem.write8(OBJ_RECORD + 1, 0x39);
  mem.write8(OBJ_RECORD + 2, 0x01); mem.write8(OBJ_RECORD + 3, 0xd8);
  regs.hl = TILE_FILL_DST; loc_1826(m);
  regs.de = 0x3a5f; loc_0da7(m);
  regs.hl = SPRITE_BUF_Y; regs.de = 0x04; regs.b = 0x02; regs.c = 0x28; addStrided(m);
  mem.write8(PACE_COUNTER, 0x00);
  mem.write8(SND_LATCH, 0x03);
  // BUG: no 0x6388 advance.
}

/** Full scene build, faithful EXCEPT it DROPS the 0x6082 sound-latch pulse. */
function brokenNoSound(m) {
  const { regs, mem } = m;
  regs.hl = Y_COLUMN; regs.c = 0x01; addToSpriteObjectColumn(m);
  if (mem.read8(GATE_Y) !== LANDED_Y) return;
  mem.write8(REC4_CODE, 0x20);
  mem.write8(OBJ_RECORD + 0, 0x7f); mem.write8(OBJ_RECORD + 1, 0x39);
  mem.write8(OBJ_RECORD + 2, 0x01); mem.write8(OBJ_RECORD + 3, 0xd8);
  regs.hl = TILE_FILL_DST; loc_1826(m);
  regs.de = 0x3a5f; loc_0da7(m);
  regs.hl = SPRITE_BUF_Y; regs.de = 0x04; regs.b = 0x02; regs.c = 0x28; addStrided(m);
  mem.write8(PACE_COUNTER, 0x00);
  // BUG: no 0x6082 sound latch.
  mem.write8(STEP_SELECTOR, (mem.read8(STEP_SELECTOR) + 1) & 0xff);
}

/** Compares the gate byte to the WRONG constant (0xCF instead of 0xD0), so the real
 *  landing (0x691b == 0xD0 after the nudge) never fires — the whole scene build is skipped. */
function brokenWrongGate(m) {
  const { regs, mem } = m;
  regs.hl = Y_COLUMN; regs.c = 0x01; addToSpriteObjectColumn(m);
  if (mem.read8(GATE_Y) !== GATE_FIRE) return; // BUG: 0xCF, should be 0xD0
  mem.write8(REC4_CODE, 0x20);
  mem.write8(STEP_SELECTOR, (mem.read8(STEP_SELECTOR) + 1) & 0xff);
}

test("TEETH (drop-advance): the dropped 0x6388 inc is CAUGHT by the step sweep and names 0x6388", () => {
  let caught = null;
  for (let s = 0; s < 256 && !caught; s++) {
    const [a, b] = craftPair(GATE_FIRE, s);
    const aFloor = a.regs.sp;
    oracle(a);
    brokenNoAdvance(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    if (bad) caught = { s, bad };
  }
  assert.notEqual(caught, null, "the step sweep FAILED to catch a dropped advance — it is worthless");
  assert.equal(caught.bad.addr, STEP_SELECTOR, `expected the caught diff at 0x6388, got ${hx(caught.bad.addr)}`);
  console.log(`  TEETH/drop-advance: caught at step=${hx(caught.s)} (0x6388 oracle=${caught.bad.a} broken=${caught.bad.b})`);
});

test("TEETH (drop-sound): the dropped 0x6082 sound latch is CAUGHT at LANDED and names 0x6082", () => {
  const [a, b] = craftPair(GATE_FIRE, 0x40);
  const aFloor = a.regs.sp;
  oracle(a);
  brokenNoSound(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the LANDED entry FAILED to catch a dropped sound latch — it is worthless");
  assert.equal(bad.addr, SND_LATCH, `expected the caught diff at 0x6082, got ${hx(bad.addr)}`);
  console.log(`  TEETH/drop-sound: caught at 0x6082 (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (wrong-gate): a wrong gate constant that skips the whole scene build is CAUGHT at LANDED", () => {
  const [a, b] = craftPair(GATE_FIRE, 0x40);
  const aFloor = a.regs.sp;
  oracle(a);
  brokenWrongGate(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the LANDED entry FAILED to catch a wrong gate constant — it is worthless");
  console.log(`  TEETH/wrong-gate: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});

// -- 5. REALISM (attract capture, if any) -------------------------------------

test("REALISM: replay any real 0x1880 dispatch; else record that attract never reaches it", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < 16) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(8000);

  for (const entry of caps) {
    const a = entry.clone(), b = entry.clone();
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(bad, null, bad && `real-dispatch RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
  }
  if (caps.length === 0) {
    console.log("  REALISM: 0 real 0x1880 dispatches in 8000 attract frames — attract never completes a board (GAME_SUBSTATE 0x16); crafted sweeps are the gate");
  } else {
    console.log(`  REALISM: ${caps.length} real 0x1880 dispatch(es) — game-visible RAM identical to the oracle`);
  }
});
