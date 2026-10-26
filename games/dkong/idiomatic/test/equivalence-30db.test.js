// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_30db (ROM 0x30db) — the seven-byte sprite-shadow clear that
 * falls through into sub_30e4.
 *
 * entry_30db WRITES memory (0x00 to 0x694C, then — via its fall-through into sub_30e4 —
 * to 0x6958/5C/60/64/68/6C) and READS nothing; it has no branches, so every dispatch
 * clears the same seven fixed addresses. Its declared LIVE-OUT is memory-only (the sole
 * caller loc_12de reloads HL and A right after the fall-through), though A / HL / B do
 * equal the oracle (0x70 / 0x6970 / 0) and are checked as a free extra pin. So it is
 * validated on RAM (minus the stack scratch below the entry SP) + pc + SP + A/HL/B via capture/clone/replay —
 * NEVER the full register file, NEVER cycles.
 *
 * The idiomatic routine models the Z80 `ret` (sub_30e4's, which returns to entry_30db's
 * caller since the fall-through pushes nothing) as a JS return, so the harness performs
 * ONE m.ret() on the idiomatic clone AFTER the call to line pc + SP up with the oracle.
 * The oracle only READS the stack (the ret pop of loc_12de's pushed 0x12E2, no write),
 * and every clear target is in the 0x6900 sprite buffer, far from the 0x6bxx stack, so
 * the stack region is byte-equal on both sides and is excluded by the contract anyway.
 * Every case runs on a FRESH clone (a reused clone is only safe for a read-only leaf;
 * this routine writes memory).
 *
 *   1. EQUAL (real captured dispatches) — hook 0x30db in a real attract run and clone the machine at each true
 *      dispatch (loc_12de reaches it ~frame 2851). Oracle vs candidate on fresh clones over the full contract.
 *   2. EQUAL (footprint pin) — a real capture with the whole 0x6900 page sentinel-filled, so the exact seven-byte
 *      footprint is pinned: any missed / extra / misplaced write shows as a RAM diff. This is the definitive gate —
 *      the routine reads nothing and never branches, so there are no input-dependent arms to craft.
 *   3. TEETH — two deliberately-broken twins, each MUST be caught on the sentinel page:
 *      (a) omit-Mario: skips the lone 0x694C write (does only the strided run) — 0x694C
 *          stays the sentinel while the oracle zeros it.
 *      (b) short-count: clears five records instead of six (B = 5) — 0x696C stays the
 *          sentinel while the oracle zeros it.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-30db.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_30db as oracle } from "../../translated/loc_30db.js";
import { loc_30db } from "../loc_30db.js";
import { clearStridedBytes } from "../clearStridedBytes.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, MARIO_SPRITE_RECORD } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x30db;
const CAP_FRAMES = 4000; // first 0x30db dispatch lands ~frame 2851
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
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

/** Run the ORACLE on a fresh clone. entry_30db m.call's translated sub_30e4 (resolved through the clone's oracle
 *  routine table — the constructor consumes no manifest, so 0x30e4 is the faithful lift), which performs the `ret`. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/** Run a candidate on a fresh clone, then model its return with one m.ret() so pc + SP match the oracle's. */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over the full contract: RAM − the stack scratch below the entry SP, pc, SP, and
 *  A / HL / B. The rest of the register file and the flags are deliberately NOT compared. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  if ((o.regs.a & 0xff) !== (c.regs.a & 0xff)) diffs.push(`A oracle=${hx(o.regs.a & 0xff)} cand=${hx(c.regs.a & 0xff)}`);
  if ((o.regs.hl & 0xffff) !== (c.regs.hl & 0xffff)) diffs.push(`HL oracle=${hx(o.regs.hl)} cand=${hx(c.regs.hl)}`);
  if ((o.regs.b & 0xff) !== (c.regs.b & 0xff)) diffs.push(`B oracle=${hx(o.regs.b & 0xff)} cand=${hx(c.regs.b & 0xff)}`);
  return diffs;
}

/** Clone the machine at up to K real 0x30db dispatches; the oracle then runs so the host proceeds undisturbed.
 *  Single runFrames() call — frame-by-frame stepping shifts NMI timing and takes a different attract branch. */
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

// Capture ONCE at module load and reuse — the attract run is deterministic and the
// routine is constant, so one set of real dispatches serves every case.
const CAPS = ROM_PRESENT ? captureDispatches(8, CAP_FRAMES) : [];

/** Sentinel-fill a whole 256-byte page (page = high byte, e.g. 0x69) with `val`. */
function paintPage(w, page, val) {
  for (let lo = 0; lo < 0x100; lo++) w.mem.write8(((page << 8) | lo) & 0xffff, val);
}

/** BUG: skips the lone 0x694C (Mario) write — does only the strided run. */
function teethOmitMario(m) {
  const { regs } = m;
  regs.hl = (MARIO_SPRITE_RECORD & 0xff00) | 0x58; // 0x6958
  regs.b = 0x06;
  clearStridedBytes(m);
}

/** BUG: clears five records instead of six (B = 5) — 0x696C is left untouched. */
function teethShortCount(m) {
  const { regs, mem } = m;
  mem.write8(MARIO_SPRITE_RECORD, 0x00);
  regs.hl = (MARIO_SPRITE_RECORD & 0xff00) | 0x58; // 0x6958
  regs.b = 0x05; // BUG: should be 6
  clearStridedBytes(m);
}

test("EQUAL (real dispatches): loc_30db == oracle on every captured 0x30db entry", () => {
  assert.ok(CAPS.length >= 1, "expected at least one real 0x30db dispatch during attract");
  for (const cap of CAPS) {
    const diffs = contractDiffs(cap, loc_30db);
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const shapes = [...new Set(CAPS.map((c) => `pc=${hx(c.pc)} sp=${hx(c.regs.sp)} [sp]=${hx(c.mem.read8(c.regs.sp) | (c.mem.read8((c.regs.sp + 1) & 0xffff) << 8))}`))];
  console.log(`  EQUAL/real: ${CAPS.length} captured dispatches identical over RAM + pc + SP + A/HL/B; entry states:\n    ` + shapes.join("\n    "));
});

test("EQUAL (footprint pin): the exact seven-byte footprint matches the oracle", () => {
  assert.ok(CAPS.length >= 1, "need one real capture to derive the footprint pin from");
  const pin = CAPS[0].clone();
  paintPage(pin, 0x69, 0xee); // sentinel: only the seven cleared bytes may go to 0
  const diffs = contractDiffs(pin, loc_30db);
  assert.equal(diffs.length, 0, `footprint pin: ${diffs.join("; ")}`);

  // Independently confirm exactly the expected seven addresses were zeroed (nothing else).
  const o = runOracle(pin);
  const zeroed = [];
  for (let a = 0x6900; a < 0x6a00; a++) if (o.mem.read8(a) === 0x00) zeroed.push(hx(a));
  assert.deepEqual(
    zeroed,
    ["0x694c", "0x6958", "0x695c", "0x6960", "0x6964", "0x6968", "0x696c"],
    `oracle footprint on the sentinel page was ${zeroed.join(",")}`,
  );
  console.log(`  EQUAL/footprint: exactly ${zeroed.length} bytes zeroed (${zeroed.join(",")}) — candidate identical`);
});

test("TEETH: the omit-Mario twin and the short-count twin are CAUGHT", () => {
  assert.ok(CAPS.length >= 1, "need one real capture to derive the teeth entries from");

  const pinA = CAPS[0].clone();
  paintPage(pinA, 0x69, 0xee);
  const dOmit = contractDiffs(pinA, teethOmitMario);
  assert.notEqual(dOmit.length, 0, "the gate FAILED to catch the omit-Mario twin — it is worthless");

  const pinB = CAPS[0].clone();
  paintPage(pinB, 0x69, 0xee);
  const dShort = contractDiffs(pinB, teethShortCount);
  assert.notEqual(dShort.length, 0, "the gate FAILED to catch the short-count twin — it is worthless");

  console.log(`  TEETH: omit-Mario caught (${dOmit[0]}); short-count caught (${dShort[0]})`);
});
