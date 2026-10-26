// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for seedObjectBlockSprites (ROM 0x1186) — the board-setup
 * coordinator that seeds a 10-record object block's shared sprite field from the 4-byte
 * ROM template at 0x11A2 (into 0x6507, stride 0x10, via replicateGroupStrided) and then
 * builds the block's 10 hardware sprite records at 0x6980 (permuting gather +3/+7/+8/+5
 * from IX=0x6500, stride 0x10, via gatherSpriteRecords).
 *
 * This is the cycle-free / memory-equivalence gate (docs/decompiler-pipeline), not the retired strict
 * whole-machine one. The routine WRITES memory (the 40 template-seed bytes at 0x6507..
 * and the 40 sprite bytes at 0x6980..) and reads implicit inputs (the 0x6500 record
 * contents), so every case runs on a FRESH clone per side and is compared on:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP) + pc + SP + the main registers a/b/c/d/e/h/l/ix.
 *
 * The idiomatic routine models the two internal Z80 calls as direct JS calls (the callees
 * touch no stack) and drops its own terminal `ret`'s stack/PC bookkeeping, so the harness
 * performs ONE m.ret() on the candidate clone after the call to line pc + SP up with the
 * oracle (which rets internally). The oracle's transient push16/push land inside
 * STACK_SCRATCH (measured: entry SP = 0x6bea, deepest push reaches 0x6be4 >= 0x6be0), so
 * the dead stack scratch the candidate never writes is excluded by the contract, exactly
 * as intended. Cycles and flags are never compared (docs/decompiler-pipeline): both call sites reload HL
 * on return and read no register/flag, so the whole register file and flags are DEAD —
 * live-out is memory only; the a/b/c/d/e/h/l/ix check is a free safety margin (the two
 * callees leave them byte-faithful to the oracle anyway).
 *
 * REACHABILITY. seedObjectBlockSprites is called only from the 50m (loc_101f, ROM 0x101F)
 * and 75m (loc_1087, ROM 0x1087) board setups; attract only plays 25m, so it NEVER
 * dispatches in a plain run (verified: 0 dispatches / 1500 attract frames). Following the
 * sibling gate (0x0D4C), the test forces the real dispatches with an IDENTICAL-BOTH-SIDES
 * board poke (Karl-sanctioned "poke the board state to reach a state for validation"): at
 * frame 100 set GAME_STATE=3, GAME_SUBSTATE=10 (board setup), SUBSTATE_TIMER=1, and BOARD
 * to 2 then 3 — exercising BOTH call sites with REAL captured entries (real register file,
 * real stack, real board).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1186.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1186 as oracle } from "../../translated/loc_1186.js";
import { seedObjectBlockSprites } from "../seedObjectBlockSprites.js";
import { replicateGroupStrided } from "../replicateGroupStrided.js";
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

const TARGET = 0x1186;
const LIVE_REGS = ["a", "b", "c", "d", "e", "h", "l", "ix"]; // dead at both call sites; verified as a free margin
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. A
 * single O(n) inline-skip pass (as in the 0x122a/0x11d3 gates): the oracle transiently
 * pushes into STACK_SCRATCH for its two internal calls, and those dead bytes — which the
 * candidate never writes — must be excluded, not chased.
 */
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

/**
 * Run the oracle (rets internally) on one fresh clone and a candidate (+ one modelled
 * m.ret) on another, and diff the full contract. Returns a list of human-readable
 * mismatches (empty when equal).
 */
function contractDiffs(entry, fn) {
  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  fn(c);
  c.ret(); // model seedObjectBlockSprites's own terminal `ret` so pc + SP line up
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
function boardPoke(board) {
  return [
    { addr: 0x6005, val: 0x03, frame: POKE_FRAME, dur: 1 }, // GAME_STATE = 3 (in-game dispatch)
    { addr: 0x600a, val: 0x0a, frame: POKE_FRAME, dur: 1 }, // GAME_SUBSTATE = 10 -> board setup
    { addr: 0x6009, val: 0x01, frame: POKE_FRAME, dur: 1 }, // SUBSTATE_TIMER = 1 (proceeds this frame)
    { addr: 0x6227, val: board, frame: POKE_FRAME, dur: 1 }, // BOARD = 2 (loc_101f) or 3 (loc_1087)
  ];
}

/**
 * Force the real dispatches of 0x1186 via the board poke and clone the machine at up to K
 * true entries. The wrapper snapshots the entry state, then runs the oracle so the host
 * proceeds. A fresh copy of the poke per machine keeps runs independent.
 */
function captureDispatches(board, K) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.pokes = boardPoke(board).map((p) => ({ ...p }));
  host.runFrames(FRAMES);
  return caps;
}

const CAPS2 = ROM_PRESENT ? captureDispatches(2, 4) : [];
const CAPS3 = ROM_PRESENT ? captureDispatches(3, 4) : [];

/**
 * Seed distinctive bytes into every field (+0..+8) of the ten 0x6500 records, identically
 * on `entry`. The template fill overwrites +7..+10 on both sides, so what survives to the
 * gather is the distinctive +3 (X) and +5 (Y); every record's fields are distinct.
 */
function craftDistinctive(entry) {
  const w = entry.clone();
  for (let r = 0; r < 10; r++) {
    const base = (0x6500 + r * 0x10) & 0xffff;
    for (let d = 0; d <= 8; d++) w.mem.write8((base + d) & 0xffff, (0x21 + r * 0x11 + d) & 0xff);
  }
  return w;
}

test("EQUAL: real forced board-2 (loc_101f) AND board-3 (loc_1087) dispatches match the oracle", () => {
  assert.ok(CAPS2.length >= 1, `expected >=1 real 0x1186 dispatch after BOARD=2 poke, got ${CAPS2.length}`);
  assert.ok(CAPS3.length >= 1, `expected >=1 real 0x1186 dispatch after BOARD=3 poke, got ${CAPS3.length}`);

  for (const [label, caps] of [["board-2", CAPS2], ["board-3", CAPS3]]) {
    for (const cap of caps) {
      const diffs = contractDiffs(cap, seedObjectBlockSprites); // fresh clones inside — cap untouched
      assert.equal(diffs.length, 0, `[${label}] ${diffs.join("; ")}`);
    }
  }
  console.log(
    `  EQUAL: ${CAPS2.length} board-2 + ${CAPS3.length} board-3 real dispatch(es) identical ` +
      `(RAM -stack + pc + SP + a/b/c/d/e/h/l/ix); entry SP=${hx(CAPS2[0].regs.sp)}`,
  );
});

test("CRAFTED: distinctive 0x6500 record content (identical both sides) matches, and the gather is permuting", () => {
  for (const [label, caps] of [["board-2", CAPS2], ["board-3", CAPS3]]) {
    const w = craftDistinctive(caps[0]);
    const diffs = contractDiffs(w, seedObjectBlockSprites);
    assert.equal(diffs.length, 0, `[${label}] ${diffs.join("; ")}`);

    // Read the candidate back: prove the permuting gather really produced
    // [X=+3, code=template[0]=0x3b, attr=template[1]=0x00, Y=+5] for each record.
    const c = w.clone();
    seedObjectBlockSprites(c);
    for (let r = 0; r < 10; r++) {
      const src = (0x6500 + r * 0x10) & 0xffff;
      const dst = (0x6980 + r * 4) & 0xffff;
      const wantX = c.mem.read8((src + 3) & 0xffff);
      const wantY = c.mem.read8((src + 5) & 0xffff);
      assert.equal(c.mem.read8(dst), wantX, `[${label}] rec${r} X (dst+0) != src+3`);
      assert.equal(c.mem.read8((dst + 1) & 0xffff), 0x3b, `[${label}] rec${r} code (dst+1) != template[0] 0x3b`);
      assert.equal(c.mem.read8((dst + 2) & 0xffff), 0x00, `[${label}] rec${r} attr (dst+2) != template[1] 0x00`);
      assert.equal(c.mem.read8((dst + 3) & 0xffff), wantY, `[${label}] rec${r} Y (dst+3) != src+5`);
    }
  }
  console.log("  CRAFTED: distinctive content on both boards identical to the oracle; gather verified as X<-+3,code<-+7,attr<-+8,Y<-+5");
});

/**
 * Broken twin (a): SKIP-FILL — omits the template seed (replicateGroupStrided), so the
 * gather reads whatever +7/+8 already held (0 on the real zero-filled block) instead of
 * the template's 0x3b/0x00. This is the coordination bug the routine exists to prevent.
 */
function skipFillTwin(m) {
  const { regs } = m;
  regs.ix = 0x6500;
  regs.hl = 0x6980;
  regs.b = 0x0a;
  regs.de = 0x0010;
  gatherSpriteRecords(m);
}

/**
 * Broken twin (b): WRONG-DEST — fills correctly, but gathers to 0x6900 instead of 0x6980,
 * so the 40 sprite bytes land in the wrong part of the sprite buffer.
 */
function wrongDestTwin(m) {
  const { regs } = m;
  regs.hl = 0x11a2;
  regs.de = 0x6507;
  regs.bc = 0x0a0c;
  replicateGroupStrided(m);
  regs.ix = 0x6500;
  regs.hl = 0x6900; // BUG: should be 0x6980
  regs.b = 0x0a;
  regs.de = 0x0010;
  gatherSpriteRecords(m);
}

test("TEETH: the skip-fill twin and the wrong-destination twin are CAUGHT", () => {
  // (a) skip-fill: caught on the real zero-filled capture (code 0 vs template 0x3b) AND
  //     on the distinctive-content craft (stale +7 vs 0x3b).
  const skipReal = contractDiffs(CAPS2[0], skipFillTwin);
  assert.ok(skipReal.length > 0, "the skip-fill twin escaped on the real capture — the gate is worthless");
  const skipCraft = contractDiffs(craftDistinctive(CAPS2[0]), skipFillTwin);
  assert.ok(skipCraft.length > 0, "the skip-fill twin escaped on the distinctive-content craft");

  // (b) wrong-dest: caught on the distinctive-content craft (guaranteed distinct sprite
  //     bytes) and on the real capture.
  const wrongCraft = contractDiffs(craftDistinctive(CAPS2[0]), wrongDestTwin);
  assert.ok(wrongCraft.length > 0, "the wrong-destination twin escaped on the distinctive-content craft");
  const wrongReal = contractDiffs(CAPS2[0], wrongDestTwin);
  assert.ok(wrongReal.length > 0, "the wrong-destination twin escaped on the real capture");

  console.log(
    `  TEETH: skip-fill caught (real: ${skipReal[0]}); wrong-dest caught (craft: ${wrongCraft[0]})`,
  );
});
