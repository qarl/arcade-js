// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for clearTilemapAndSprites (ROM 0x0852) — the full-screen wipe
 * (blank ALL 1024 tilemap cells + zero the 384-byte sprite shadow buffer).
 *
 * sub_0852 WRITES memory (video RAM 0x7400-0x77FF <- 0x10, and work RAM
 * 0x6900-0x6A7F <- 0x00) and reads NOTHING — every operand is an immediate, so it
 * is an input-free, straight-line constant memory transform. It is validated by
 * capture/clone/replay on a FRESH clone per side (a memory-writing routine demands
 * that), never on the full register file, never on cycles. The contract compared is
 * RAM (minus the stack scratch below the entry SP); there are no live-out registers (the header explains
 * both callers reload A/DE before reading, so A/BC/DE/HL/F are dead ABI). SP and PC
 * are likewise not compared — the oracle's terminal `ret` pops the stack (SP += 2)
 * and vectors PC; the idiomatic layer drops that bookkeeping (the JS call stack
 * replaces it).
 *
 * Because sub_0852 is UNREACHED in attract (its callers loc_0986 / loc_196b are
 * in-game phase arms — 0 dispatches over 3000 frames), there is no real dispatch to
 * capture; the gate is crafted-entry, which is COMPLETE here precisely because the
 * routine reads nothing:
 *
 *   1. CRAFTED (footprint) — from a realistic attract-derived base machine, paint
 *      every cell the routine could touch — all of video RAM (0x7400-0x77FF,
 *      covering the tilemap fill) and a guard-banded span around the sprite buffer
 *      (0x68F0-0x6A8F, catching an over-write past either end) — with a SENTINEL
 *      distinct from the fill bytes (0x10 / 0x00), identically on both sides. Any
 *      cell the candidate writes-but-oracle-doesn't (or misses) then holds the
 *      sentinel on one side and a fill byte on the other, so the RAM gate bites.
 *      Several sentinels x several base frames are swept.
 *
 *   2. TEETH — a deliberately-broken twin (a one-cell-short tilemap fill: skips the
 *      last cell 0x77FF) MUST be caught. On the sentinel entry the dropped cell
 *      holds the sentinel vs the oracle's 0x10, so the RAM gate bites at exactly
 *      0x77FF.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0852.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0852 as oracle } from "../../translated/loc_0852.js";
import { clearTilemapAndSprites } from "../clearTilemapAndSprites.js";
import { Machine } from "../../machine.js";
import { SPRITE_BUFFER, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

// The routine's exact write footprint (used only by the crafted-entry harness).
const TILEMAP_BASE = 0x7400;
const TILEMAP_BYTES = 0x400;
const SPRITE_BUFFER_BYTES = 0x180;
const LAST_TILEMAP_CELL = (TILEMAP_BASE + TILEMAP_BYTES - 1) & 0xffff; // 0x77FF

// A valid stack-scratch SP so the oracle's terminal `ret` pops mapped bytes (pop
// reads [SP],[SP+1] then SP += 2; 0x6BFE keeps both reads < 0x6C00). It lives in
// STACK_SCRATCH, which the RAM diff excludes, and is set identically on both sides.
const SAFE_SP = 0x6bfe;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- comparison plumbing ------------------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
function firstRamDiffOutsideStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

function diffAgainstOracle(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return firstRamDiffOutsideStack(a, b, entry.regs.sp);
}

/**
 * A realistic base machine: boot + `frames` of attract, then clone (frame machinery
 * neutralised). sub_0852 reads nothing, so the base state is irrelevant to the
 * result — using a live attract state only keeps the entry realistic.
 */
function baseMachine(frames) {
  const host = new Machine(ROM);
  host.runFrames(frames);
  const m = host.clone();
  m.regs.sp = SAFE_SP;
  return m;
}

function craftSentinelEntry(base, sentinel) {
  const w = base.clone();
  w.regs.sp = SAFE_SP;
  for (let a = TILEMAP_BASE; a <= LAST_TILEMAP_CELL; a++) w.mem.write8(a, sentinel);
  for (let a = SPRITE_BUFFER - 0x10; a < SPRITE_BUFFER + SPRITE_BUFFER_BYTES + 0x10; a++) {
    w.mem.write8(a & 0xffff, sentinel);
  }
  return w;
}

// -- 1. CRAFTED (exact write footprint) ---------------------------------------

test("CRAFTED: sentinel-painted entries pin the exact write footprint against the oracle", () => {
  // Sentinels distinct from the fill bytes (0x10 tilemap, 0x00 sprite buffer).
  const SENTINELS = [0xee, 0x55, 0xaa, 0x01, 0xff];
  let cases = 0;
  for (const frames of [400, 900, 1500]) {
    const base = baseMachine(frames);
    for (const sentinel of SENTINELS) {
      const w = craftSentinelEntry(base, sentinel);
      const ram = diffAgainstOracle(w, clearTilemapAndSprites);
      assert.equal(
        ram,
        null,
        ram && `footprint mismatch (frames=${frames} sentinel=${hx(sentinel)}) at ${hx(ram.addr)}: ` +
          `oracle=${ram.a} cand=${ram.b}`,
      );
      cases++;
    }
  }
  console.log(`  CRAFTED: ${cases} sentinel-painted entries — candidate's write footprint is identical to the oracle`);
});

// -- 2. TEETH -----------------------------------------------------------------

/** Broken twin: fills the tilemap one cell short (skips the last cell 0x77FF). */
function brokenClear(m) {
  const { mem } = m;
  for (let i = 0; i < TILEMAP_BYTES - 1; i++) { // BUG: should be TILEMAP_BYTES
    mem.write8((TILEMAP_BASE + i) & 0xffff, 0x10);
  }
  for (let i = 0; i < SPRITE_BUFFER_BYTES; i++) {
    mem.write8((SPRITE_BUFFER + i) & 0xffff, 0x00);
  }
}

test("TEETH: the one-cell-short tilemap twin is CAUGHT at 0x77FF", () => {
  const base = baseMachine(900);
  const w = craftSentinelEntry(base, 0xee);
  const ram = diffAgainstOracle(w, brokenClear);
  assert.notEqual(ram, null, "the RAM gate FAILED to catch the one-cell-short tilemap fill — it is worthless");
  assert.equal(
    ram.addr,
    LAST_TILEMAP_CELL, // 0x77FF, the dropped last cell
    "the diff must be the dropped last tilemap cell",
  );
  console.log(`  TEETH: one-cell-short twin caught by RAM at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});
