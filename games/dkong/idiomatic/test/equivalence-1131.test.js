// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for seed100mBoardObjects (ROM 0x1131) — the BOARD == 4 (100m /
 * rivet) arm of the per-board setup dispatch. It seeds the board's sprite-object records
 * from ROM templates over the shared fill helpers and builds their hardware sprite records:
 * a strided broadcast into 0x6407 (replicateGroupStrided), a sprite-object pair at
 * 0x6680/0x6690 → 0x6A18 (seedSpriteObjectPair, HL=0x3E14), a 0x0C-byte ldir into 0x6A0C,
 * a byte-pair scatter into +3/+5 of two records at 0x64A3 (copyBytePairsStrided), a
 * broadcast into +7..+a of the same records at 0x64A7 (replicateGroupStrided), then two
 * activation marks + a permuting gather (+3,+7,+8,+5) into two sprite records at 0x6950
 * (gatherSpriteRecords).
 *
 * This is the cycle-free / memory-equivalence gate (docs/decompiler-pipeline), not the retired strict
 * whole-machine one. The routine WRITES memory and reads only ROM (never pre-existing work
 * RAM), so every case runs on a FRESH clone per side and is compared on:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP) + pc + SP + the main registers a/b/c/d/e/h/l/ix.
 *
 * The idiomatic routine models its four internal Z80 calls as direct JS calls (the callees
 * touch no stack) and drops its own terminal `ret`'s stack/PC bookkeeping, so the harness
 * performs ONE m.ret() on the candidate clone after the call to line pc + SP up with the
 * oracle (which rets internally). The oracle's transient push16/push land inside
 * STACK_SCRATCH (measured: entry SP = 0x6bec, deepest push ≈ 0x6be4 ≥ 0x6be0), so the dead
 * stack scratch the candidate never writes is excluded by the contract. Cycles and flags are
 * never compared (docs/decompiler-pipeline): the routine returns into a fresh `call 0x2441` (0x0D62) that
 * reloads every register, so the whole register file and all flags are DEAD — live-out is
 * memory only; the a/b/c/d/e/h/l/ix check is a free safety margin (the callees + the step-5/6
 * immediates leave them byte-faithful to the oracle anyway).
 *
 * REACHABILITY. The BOARD == 4 setup is NEVER dispatched in a plain run — attract only plays
 * 25m (BOARD == 1), verified 0 dispatches / plain attract. Following the sibling gate (0x1186),
 * the test forces the real dispatch with an IDENTICAL-BOTH-SIDES board poke (Karl-sanctioned
 * "poke the board state to reach a state for validation"): at frame 100 set GAME_STATE=3,
 * GAME_SUBSTATE=10 (board setup), SUBSTATE_TIMER=1, BOARD=4 — sub_0f56 then dispatches through
 * its 0x0FCD table (index C = BOARD) to 0x1131 with a REAL register file, stack and cleared RAM.
 *
 * Jobs:
 *   1. EQUAL (real forced dispatch) — oracle vs seed100mBoardObjects on fresh clones of the
 *      captured entry leave identical RAM (-STACK_SCRATCH) + pc + SP + a/b/c/d/e/h/l/ix, and
 *      the produced sprite records are read back to prove the permuting gather really wrote
 *      [X=+3, code=+7, attr=+8, Y=+5] for both records.
 *   2. CRAFTED (footprint pin) — poison the whole write-target span 0x6400–0x6AFF with a
 *      distinctive pattern IDENTICALLY on both sides; oracle == candidate proves they touch
 *      exactly the same bytes (a missing/extra write would leave poison mismatched).
 *   3. TEETH — two deliberately-broken twins, each MUST be caught:
 *      (a) SKIP-POSITION: omits step 4 (copyBytePairsStrided), so the gather's X/Y fields
 *          (+3/+5) go stale (0 on the cleared capture) instead of the ROM position bytes —
 *          the coordination bug this routine exists to prevent;
 *      (b) WRONG-DEST: gathers to 0x6900 instead of 0x6950, so the sprite records land in the
 *          wrong part of the sprite buffer.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1131.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1131 as oracle } from "../../translated/loc_1131.js";
import { seed100mBoardObjects } from "../seed100mBoardObjects.js";
import { replicateGroupStrided } from "../replicateGroupStrided.js";
import { seedSpriteObjectPair } from "../seedSpriteObjectPair.js";
import { copyBytePairsStrided } from "../copyBytePairsStrided.js";
import { gatherSpriteRecords } from "../gatherSpriteRecords.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1131;
const LIVE_REGS = ["a", "b", "c", "d", "e", "h", "l", "ix"]; // dead at the call site; verified as a free margin
const hx = (v) => "0x" + (v & 0xffff).toString(16);


function ramDiffMinusStack(ma, mb, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const a = ma.dumpState();
  const b = mb.dumpState();
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    const addr = ma.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: a[i], b: b[i] };
  }
  return null;
}

function contractDiffs(entry, fn) {
  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  fn(c);
  c.ret(); // model seed100mBoardObjects's own terminal `ret` so pc + SP line up
  const diffs = [];
  const ram = ramDiffMinusStack(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr ?? 0)} oracle=${ram.a} cand=${ram.b}`);
  for (const r of LIVE_REGS) {
    if (o.regs[r] !== c.regs[r]) diffs.push(`${r.toUpperCase()} oracle=${hx(o.regs[r])} cand=${hx(c.regs[r])}`);
  }
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}


const POKE_FRAME = 100;
const FRAMES = 120; // the forced dispatch lands ~frame 102
const BOARD_POKE = [
  { addr: 0x6005, val: 0x03, frame: POKE_FRAME, dur: 1 }, // GAME_STATE = 3 (in-game dispatch)
  { addr: 0x600a, val: 0x0a, frame: POKE_FRAME, dur: 1 }, // GAME_SUBSTATE = 10 -> board setup
  { addr: 0x6009, val: 0x01, frame: POKE_FRAME, dur: 1 }, // SUBSTATE_TIMER = 1 (proceeds this frame)
  { addr: 0x6227, val: 0x04, frame: POKE_FRAME, dur: 1 }, // BOARD = 4 (rivets) -> 0x0FCD table entry 4
];

function captureDispatches(K) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.pokes = BOARD_POKE.map((p) => ({ ...p }));
  host.runFrames(FRAMES);
  return caps;
}

const CAPS = ROM_PRESENT ? captureDispatches(4) : [];

/** Poison the whole write-target span 0x6400–0x6AFF with a distinctive pattern (below the
 *  stack at 0x6bxx). Returns a fresh clone so the caller's entry is untouched. */
function craftPoison(entry) {
  const w = entry.clone();
  for (let a = 0x6400; a <= 0x6aff; a++) w.mem.write8(a, (0xa5 ^ (a & 0xff)) & 0xff);
  return w;
}


test("EQUAL: real forced BOARD=4 dispatch matches the oracle, and the gather is permuting", () => {
  assert.ok(CAPS.length >= 1, `expected >=1 real 0x1131 dispatch after BOARD=4 poke, got ${CAPS.length}`);

  for (const cap of CAPS) {
    const diffs = contractDiffs(cap, seed100mBoardObjects); // fresh clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }

  // Read the candidate back: prove the permuting gather produced [X=+3, code=+7, attr=+8,
  // Y=+5] for BOTH records (base 0x64A0, stride 0x20; sprites at 0x6950/0x6954).
  const c = CAPS[0].clone();
  seed100mBoardObjects(c);
  for (let r = 0; r < 2; r++) {
    const srcBase = (0x64a0 + r * 0x20) & 0xffff;
    const dst = (0x6950 + r * 4) & 0xffff;
    assert.equal(c.mem.read8(dst), c.mem.read8((srcBase + 3) & 0xffff), `rec${r} X (dst+0) != src+3`);
    assert.equal(c.mem.read8((dst + 1) & 0xffff), c.mem.read8((srcBase + 7) & 0xffff), `rec${r} code (dst+1) != src+7`);
    assert.equal(c.mem.read8((dst + 2) & 0xffff), c.mem.read8((srcBase + 8) & 0xffff), `rec${r} attr (dst+2) != src+8`);
    assert.equal(c.mem.read8((dst + 3) & 0xffff), c.mem.read8((srcBase + 5) & 0xffff), `rec${r} Y (dst+3) != src+5`);
    assert.equal(c.mem.read8(srcBase), 0x01, `rec${r} was not marked active (+0 != 1)`);
  }
  console.log(
    `  EQUAL: ${CAPS.length} real BOARD=4 dispatch(es) identical (RAM -stack + pc + SP + ` +
      `a/b/c/d/e/h/l/ix); entry SP=${hx(CAPS[0].regs.sp)}; gather verified X<-+3,code<-+7,attr<-+8,Y<-+5`,
  );
});


test("CRAFTED: distinctive-poison footprint pin (identical both sides) matches the oracle", () => {
  const diffs = contractDiffs(craftPoison(CAPS[0]), seed100mBoardObjects);
  assert.equal(diffs.length, 0, diffs.join("; "));
  console.log("  CRAFTED: 0x6400–0x6AFF poison pin — oracle and candidate touch exactly the same bytes");
});


/**
 * Broken twin (a): SKIP-POSITION — omits step 4 (copyBytePairsStrided), so offsets +3/+5 of
 * the two 0x64A0 records keep whatever they held (0 on the cleared capture) instead of the
 * ROM position bytes; the gather then writes X=Y=0. Everything else is faithful.
 */
function skipPositionTwin(m) {
  const { regs, mem } = m;
  regs.hl = 0x3df0; regs.de = 0x6407; regs.bc = 0x051c; replicateGroupStrided(m);
  regs.hl = 0x3e14; seedSpriteObjectPair(m);
  let src = 0x3e54, dst = 0x6a0c;
  for (let i = 0; i < 0x0c; i++) { mem.write8(dst, mem.read8(src)); src = (src + 1) & 0xffff; dst = (dst + 1) & 0xffff; }
  // BUG: step 4 (copyBytePairsStrided into +3/+5) is omitted entirely.
  regs.hl = 0x117e; regs.de = 0x64a7; regs.bc = 0x021c; replicateGroupStrided(m);
  regs.ix = 0x64a0;
  mem.write8(0x64a0, 0x01); mem.write8(0x64c0, 0x01);
  regs.hl = 0x6950; regs.b = 0x02; regs.de = 0x0020; gatherSpriteRecords(m);
}

function wrongDestTwin(m) {
  const { regs, mem } = m;
  regs.hl = 0x3df0; regs.de = 0x6407; regs.bc = 0x051c; replicateGroupStrided(m);
  regs.hl = 0x3e14; seedSpriteObjectPair(m);
  let src = 0x3e54, dst = 0x6a0c;
  for (let i = 0; i < 0x0c; i++) { mem.write8(dst, mem.read8(src)); src = (src + 1) & 0xffff; dst = (dst + 1) & 0xffff; }
  regs.hl = 0x1182; regs.de = 0x64a3; regs.bc = 0x021e; copyBytePairsStrided(m);
  regs.hl = 0x117e; regs.de = 0x64a7; regs.bc = 0x021c; replicateGroupStrided(m);
  regs.ix = 0x64a0;
  mem.write8(0x64a0, 0x01); mem.write8(0x64c0, 0x01);
  regs.hl = 0x6900; regs.b = 0x02; regs.de = 0x0020; gatherSpriteRecords(m); // BUG: 0x6900 should be 0x6950
}

test("TEETH: the skip-position twin and the wrong-destination twin are CAUGHT", () => {
  const skip = contractDiffs(CAPS[0], skipPositionTwin);
  assert.ok(skip.length > 0, "the skip-position twin escaped — the gate is worthless");
  const wrong = contractDiffs(CAPS[0], wrongDestTwin);
  assert.ok(wrong.length > 0, "the wrong-destination twin escaped — the gate is worthless");
  console.log(`  TEETH: skip-position caught (${skip[0]}); wrong-dest caught (${wrong[0]})`);
});
