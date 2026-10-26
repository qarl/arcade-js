// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for setClimbSpriteFrame (ROM 0x1d3f) — the climb-step sprite stamp
 * that toggles Mario's mirror flag, writes his climb frame code, then falls into the
 * shared climb tail (re-flag on-ladder + refresh the sprite record).
 *
 * The routine WRITES MEMORY (MARIO_SPRITE_CODE, then — via the already-idiomatic
 * markOnLadderAndCommitSprite — MARIO_ON_LADDER and the four record bytes
 * 0x694C..0x694F) and the whole chain ends in a single return (the oracle reaches it
 * by falling into loc_1d49, which tail-jumps entry_1da6, whose `ret` is the chain's
 * return). So it is gated on MEMORY-equivalence — RAM (minus the stack scratch below the entry SP) + pc + SP —
 * never on a register file (its live-out is memory-only; see the routine header), and
 * every case runs on a FRESH clone (a reused clone is only safe for a read-only leaf;
 * this writes). The idiomatic routine models the return as a JS return and touches no
 * pc/SP, so the harness performs ONE m.ret() on the candidate clone after the call to
 * line pc + SP up with the oracle (that pop reads bytes in STACK_SCRATCH, excluded by
 * the contract).
 *
 * The single live-in is the climb frame code (register B, chosen by loc_1d11): the
 * harness reads it from the captured entry and passes it as the `frame` argument, so
 * the gate replays the real value against the oracle (which reads the same B).
 *
 *   1. EQUAL (real dispatches) — hook 0x1d3f in a real attract run (the 25m demo climbs,
 *      so the climb body dispatches here). oracle vs candidate must agree on RAM + pc + SP
 *      for every capture. The log reports the distinct entry mirror states and frame codes
 *      seen, so the toggle and the frame stamp are shown to be genuinely exercised.
 *
 *   2. EQUAL (crafted) — from a real captured state, force the entry mirror bit both ways
 *      and sweep the climb frame code (and vary the record-source fields), so the toggle
 *      and the frame stamp are pinned even on states attract may not produce. Each compared
 *      identically both sides.
 *
 *   3. TEETH — three deliberately-broken twins, each MUST be caught:
 *      (a) NO-TOGGLE — keeps the entry mirror bit instead of flipping it; the stamped
 *          sprite code differs in the top bit on every entry.
 *      (b) DROPPED-FRAME — toggles the mirror but never ORs in the frame code; the low
 *          bits differ whenever the frame code is non-zero (the real codes 3/4/5 are).
 *      (c) DROPPED-TAIL — stamps the sprite code but skips markOnLadderAndCommitSprite;
 *          diverges on MARIO_ON_LADDER and/or the stale record bytes.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1d3f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1d3f as oracle } from "../../translated/loc_1d3f.js";
import { setClimbSpriteFrame } from "../setClimbSpriteFrame.js";
import { markOnLadderAndCommitSprite } from "../markOnLadderAndCommitSprite.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  MARIO_ON_LADDER,
  MARIO_X, MARIO_Y, MARIO_SPRITE_CODE, MARIO_SPRITE_ATTR,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1d3f;
const MIRROR_BIT = 0x80;
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

function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c, c.regs.b);
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
 * Hook 0x1d3f in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper snapshots the entry state, then runs the oracle so the host game proceeds
 * undisturbed. loc_1d11 reaches here by `m.call(0x1d3f)`, which resolves through the
 * routine registry the override overlays, so every real climb-step dispatch is caught.
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
 * A real captured state with the sprite code (entry mirror bit + old code), the climb
 * frame code (register B), and the record-source fields poked to chosen values, plus a
 * safe SP. The record bytes 0x694C..0x694F are left as captured so the dropped-tail twin
 * has stale bytes to diverge from when the source fields change.
 */
function craft(seed, { code, frame, x, attr, y }) {
  const e = seed.clone();
  e.mem.write8(MARIO_SPRITE_CODE, code);
  e.mem.write8(MARIO_X, x);
  e.mem.write8(MARIO_SPRITE_ATTR, attr);
  e.mem.write8(MARIO_Y, y);
  e.regs.b = frame;
  e.regs.sp = 0x6bfe; // the ret's pop lands in STACK_SCRATCH, well clear of work RAM
  return e;
}

/** Broken twin (a): NO-TOGGLE — keeps the entry mirror bit instead of flipping it, so the
 *  stamped sprite code differs in bit 7 on every entry. Still runs the tail. */
function brokenNoToggle(m, frame) {
  const kept = m.mem.read8(MARIO_SPRITE_CODE) & MIRROR_BIT; // BUG: missing `^ MIRROR_BIT`
  m.mem.write8(MARIO_SPRITE_CODE, kept | frame);
  markOnLadderAndCommitSprite(m);
}

/** Broken twin (b): DROPPED-FRAME — toggles the mirror but forgets to OR in the climb
 *  frame code, so the low bits differ whenever the frame code is non-zero. Still runs the tail. */
function brokenDropFrame(m, _frame) {
  const toggled = (m.mem.read8(MARIO_SPRITE_CODE) & MIRROR_BIT) ^ MIRROR_BIT; // BUG: missing `| frame`
  m.mem.write8(MARIO_SPRITE_CODE, toggled);
  markOnLadderAndCommitSprite(m);
}

/** Broken twin (c): DROPPED-TAIL — stamps the sprite code correctly but skips the shared
 *  tail, so it never re-flags MARIO_ON_LADDER nor refreshes the sprite record. */
function brokenDropTail(m, frame) {
  const toggledMirror = (m.mem.read8(MARIO_SPRITE_CODE) & MIRROR_BIT) ^ MIRROR_BIT;
  m.mem.write8(MARIO_SPRITE_CODE, toggledMirror | frame); // BUG: missing markOnLadderAndCommitSprite(m)
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): setClimbSpriteFrame == oracle on every captured 0x1d3f entry", () => {
  const caps = captureDispatches(256, 6000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1d3f dispatch during 25m attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, setClimbSpriteFrame); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const mirrorStates = new Set(caps.map((c) => (c.mem.read8(MARIO_SPRITE_CODE) & MIRROR_BIT) ? "R" : "L"));
  const frameCodes = new Set(caps.map((c) => hx(c.regs.b)));
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical on RAM+pc+SP ` +
      `(entry mirror: ${[...mirrorStates].join(",")}; frame codes: ${[...frameCodes].sort().join(",")})`,
  );
});

// -- 2. EQUAL (crafted) -------------------------------------------------------

test("EQUAL (crafted): forced mirror + swept frame code + varied fields match the oracle", () => {
  const caps = captureDispatches(1, 6000);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  const cases = [];
  // Both entry mirror states, swept over the real climb frame codes plus edges.
  for (const code of [0x00, 0x80]) {
    for (const frame of [0x00, 0x03, 0x04, 0x05, 0x0f, 0xff]) {
      cases.push({
        name: `code=${hx(code)} frame=${hx(frame)}`,
        e: craft(seed, { code, frame, x: (code ^ frame) & 0xff, attr: 0x02, y: (frame + 0x40) & 0xff }),
      });
    }
  }
  // An entry mirror bit riding on a non-zero old code, to prove the old code is discarded.
  cases.push({ name: "old code present under mirror", e: craft(seed, { code: 0x85, frame: 0x03, x: 0x11, attr: 0x02, y: 0x44 }) });

  for (const { name, e } of cases) {
    const diffs = contractDiffs(e, setClimbSpriteFrame);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} forced-mirror / swept-frame entries identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the no-toggle, dropped-frame, and dropped-tail twins are CAUGHT", () => {
  const caps = captureDispatches(256, 6000);
  assert.ok(caps.length >= 1, "need real captures for the teeth check");
  const seed = caps[0];

  // A bait entry: a non-zero frame code, an entry mirror bit to flip, a non-zero old
  // code to discard, an on-ladder flag not already 1, and record fields distinct from
  // whatever sits in the record — so all three twins must diverge on it.
  const bait = craft(seed, { code: 0x85, frame: 0x03, x: 0x11, attr: 0x33, y: 0x44 });
  bait.mem.write8(MARIO_ON_LADDER, 0x00);

  const noToggle = contractDiffs(bait, brokenNoToggle);
  const dropFrame = contractDiffs(bait, brokenDropFrame);
  const dropTail = contractDiffs(bait, brokenDropTail);
  assert.ok(noToggle.length > 0, "the no-toggle twin escaped — the gate is worthless");
  assert.ok(dropFrame.length > 0, "the dropped-frame twin escaped — the gate is worthless");
  assert.ok(dropTail.length > 0, "the dropped-tail twin escaped — the gate is worthless");

  // And confirm the no-toggle twin is caught on EVERY real dispatch (it flips a bit the
  // oracle always flips, so the stamped sprite code differs on every entry).
  let caughtNoToggle = 0;
  for (const c of caps) if (contractDiffs(c, brokenNoToggle).length > 0) caughtNoToggle++;
  assert.equal(caughtNoToggle, caps.length,
    `no-toggle escaped on ${caps.length - caughtNoToggle}/${caps.length} real dispatches`);

  console.log(
    `  TEETH: no-toggle caught on the bait (${noToggle[0]}) and all ${caps.length} real dispatches; ` +
      `dropped-frame (${dropFrame[0]}) and dropped-tail (${dropTail[0]}) caught on the bait`,
  );
});
