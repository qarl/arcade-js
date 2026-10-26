// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for markOnLadderAndCommitSprite (ROM 0x1d49) — the climb-step tail
 * that re-asserts MARIO_ON_LADDER and then refreshes Mario's hardware sprite record.
 *
 * The routine WRITES MEMORY (0x6215, then the 4 record bytes 0x694C..0x694F via the
 * already-idiomatic writeMarioSpriteRecord) and ends in a `ret` (the oracle reaches it
 * by tail-jumping entry_1da6, whose `ret` is this routine's return). So it is gated on
 * MEMORY-equivalence — RAM (minus the stack scratch below the entry SP) + pc + SP — never on a register file
 * (its live-out is memory-only; see the routine header), and every case runs on a FRESH
 * clone (a reused clone is only safe for a read-only leaf; this writes). The idiomatic
 * routine models the Z80 `ret` as a JS return and touches no pc/SP, so the harness
 * performs ONE m.ret() on the candidate clone after the call to line pc + SP up with the
 * oracle (the oracle's `ret` at 0x1dbc pops the caller's return; that pop reads bytes in
 * STACK_SCRATCH, excluded by the contract).
 *
 *   1. EQUAL (real dispatches) — hook 0x1d49 in a real attract run (the 25m demo climbs,
 *      so the climb tail dispatches here). Attract feeds it MARIO_ON_LADDER == 0 on the
 *      first step of a climb and == 1 on later steps, so the real captures exercise the
 *      flag write on both a changing and an already-set byte. oracle vs candidate must
 *      agree on RAM + pc + SP for every capture.
 *
 *   2. EQUAL (crafted) — from a real captured state, force MARIO_ON_LADDER to values it
 *      may not take in attract (0, 0x77) and vary the four sprite-source fields, so the
 *      0x6215 write and the record copy are each pinned even on states attract never
 *      produces. Each compared identically both sides.
 *
 *   3. TEETH — two deliberately-broken twins, each MUST be caught:
 *      (a) a dropped-flag twin — skips the 0x6215 := 1 write (forgets step 1); diverges
 *          whenever the entry's MARIO_ON_LADDER != 1.
 *      (b) a dropped-commit twin — writes the flag but skips writeMarioSpriteRecord
 *          (forgets step 2); diverges whenever Mario's live fields differ from the record.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1d49.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1d49 as oracle } from "../../translated/loc_1d49.js";
import { markOnLadderAndCommitSprite } from "../markOnLadderAndCommitSprite.js";
import { writeMarioSpriteRecord } from "../writeMarioSpriteRecord.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  MARIO_ON_LADDER,
  MARIO_X, MARIO_Y, MARIO_SPRITE_CODE, MARIO_SPRITE_ATTR, MARIO_SPRITE_RECORD,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1d49;
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP. */
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

/** Run the ORACLE on a fresh clone. It tail-jumps entry_1da6, whose `ret` advances pc/SP. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

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

/**
 * Hook 0x1d49 in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper snapshots the entry state, then runs the oracle so the host game proceeds
 * undisturbed. loc_1d3f / loc_1d51 reach here by `m.call(0x1d49)`, which resolves through
 * the routine registry the override overlays, so every real climb-step dispatch is caught.
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

/**
 * A real captured state with MARIO_ON_LADDER + the four sprite-source fields poked to
 * sentinels and a safe SP. The record bytes 0x694C..0x694F are left as captured so the
 * dropped-commit twin has stale bytes to diverge from when the source fields change.
 */
function craft(seed, { onLadder, x, code, attr, y }) {
  const e = seed.clone();
  e.mem.write8(MARIO_ON_LADDER, onLadder);
  e.mem.write8(MARIO_X, x);
  e.mem.write8(MARIO_SPRITE_CODE, code);
  e.mem.write8(MARIO_SPRITE_ATTR, attr);
  e.mem.write8(MARIO_Y, y);
  e.regs.sp = 0x6bfe; // the ret's pop lands in STACK_SCRATCH, well clear of work RAM
  return e;
}

/** Broken twin (a): DROPPED-FLAG — forgets step 1, never writing MARIO_ON_LADDER. It
 *  still commits the sprite record, so it agrees on every entry whose 0x6215 is already
 *  1, and only diverges where the flag would actually change. */
function brokenDropFlag(m) {
  writeMarioSpriteRecord(m); // BUG: missing `m.mem.write8(MARIO_ON_LADDER, 1)`
}

/** Broken twin (b): DROPPED-COMMIT — forgets step 2, writing the flag but never
 *  refreshing the sprite record. Diverges whenever Mario's live fields differ from the
 *  bytes already sitting in 0x694C..0x694F. */
function brokenDropCommit(m) {
  m.mem.write8(MARIO_ON_LADDER, 1); // BUG: missing writeMarioSpriteRecord(m)
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): markOnLadderAndCommitSprite == oracle on every captured 0x1d49 entry", () => {
  const caps = captureDispatches(256, 4000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1d49 dispatch during 25m attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, markOnLadderAndCommitSprite); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const flags = new Set(caps.map((c) => hx(c.mem.read8(MARIO_ON_LADDER))));
  const changed = caps.filter((c) => c.mem.read8(MARIO_ON_LADDER) !== 1).length;
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical on RAM+pc+SP ` +
      `(MARIO_ON_LADDER at entry: ${[...flags].join(",")}; ${changed} where the flag write actually changes it)`,
  );
});

// -- 2. EQUAL (crafted) -------------------------------------------------------

test("EQUAL (crafted): forced MARIO_ON_LADDER + varied sprite fields match the oracle", () => {
  const caps = captureDispatches(1, 4000);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  const cases = [
    { name: "flag=0, all sprite fields distinct", e: craft(seed, { onLadder: 0x00, x: 0x11, code: 0x22, attr: 0x33, y: 0x44 }) },
    { name: "flag already 1 (write is a no-op)", e: craft(seed, { onLadder: 0x01, x: 0x55, code: 0x66, attr: 0x02, y: 0x77 }) },
    { name: "flag=0x77 (arbitrary non-1 -> forced to 1)", e: craft(seed, { onLadder: 0x77, x: 0x00, code: 0xff, attr: 0x00, y: 0xff }) },
    { name: "flag=0, X == Y extremes", e: craft(seed, { onLadder: 0x00, x: 0xff, code: 0x00, attr: 0x00, y: 0xff }) },
  ];

  for (const { name, e } of cases) {
    const diffs = contractDiffs(e, markOnLadderAndCommitSprite);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} forced-flag / varied-field entries identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the dropped-flag and dropped-commit twins are CAUGHT", () => {
  const caps = captureDispatches(256, 4000);
  assert.ok(caps.length >= 1, "need real captures for the teeth check");
  const seed = caps[0];

  // An entry where the flag is NOT 1 and the sprite fields differ from the current
  // record, so BOTH twins must diverge on it.
  const bait = craft(seed, { onLadder: 0x00, x: 0x11, code: 0x22, attr: 0x33, y: 0x44 });

  const dropFlag = contractDiffs(bait, brokenDropFlag);
  const dropCommit = contractDiffs(bait, brokenDropCommit);
  assert.ok(dropFlag.length > 0, "the dropped-flag twin escaped on flag=0 — the gate is worthless");
  assert.ok(dropCommit.length > 0, "the dropped-commit twin escaped on distinct sprite fields — the gate is worthless");

  // And confirm the dropped-flag twin is caught on every REAL dispatch where the flag is
  // not already 1 (i.e. where step 1 actually changes memory), not only on the crafted bait.
  const flagChangesReal = caps.filter((c) => c.mem.read8(MARIO_ON_LADDER) !== 1);
  let caughtDropFlag = 0;
  for (const c of flagChangesReal) if (contractDiffs(c, brokenDropFlag).length > 0) caughtDropFlag++;
  assert.equal(caughtDropFlag, flagChangesReal.length,
    `dropped-flag escaped on ${flagChangesReal.length - caughtDropFlag}/${flagChangesReal.length} real dispatches where the flag changes`);

  console.log(
    `  TEETH: dropped-flag caught on the bait (${dropFlag[0]}) and all ${flagChangesReal.length} real flag-changing dispatches; ` +
      `dropped-commit caught on the bait (${dropCommit[0]})`,
  );
});
