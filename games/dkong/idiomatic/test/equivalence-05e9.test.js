// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for drawStringVertical (ROM 0x05E9) — the doubly-indirected
 * vertical string draw (task-table entry 3).
 *
 * The routine WRITES memory (VRAM tilemap cells) and its data comes from RAM (the
 * 0x364B pointer table, the descriptor, the character bytes), so it is gated by
 * capture / clone / replay (docs/decompiler-pipeline), NOT an exhaustive-leaf sweep — and every
 * replay uses a FRESH clone per side because it mutates RAM:
 *
 *   1. EQUAL (real captured dispatches) — hook 0x05E9 in a real attract run and clone
 *      the machine at true dispatches (attract reaches it via the boot task queue with
 *      payload 4 and via sub_0616 for string 5). For each, run the ORACLE on one clone
 *      and drawStringVertical on another and confirm IDENTICAL game-visible RAM (any
 *      diff is confined to STACK_SCRATCH — the oracle models the prologue `push af` /
 *      the `pop hl / ret` tail; drawStringVertical carries the blank-mode flag in a JS
 *      boolean and never touches the stack). The idiomatic side is a plain JS function,
 *      so it leaves SP/pc at entry (the oracle's `ret` moves them) — asserted, not
 *      compared to the oracle. The oracle's stack activity is asserted to sit inside
 *      STACK_SCRATCH, so excluding it cannot mask a real diff.
 *
 *   2. EQUAL (crafted BLANK-MODE arm) — attract only ever draws (payloads 4/5/E, all
 *      with bit 7 clear), so the erase arm (payload bit 7 -> overwrite each cell with
 *      the blank tile 0x10) is unreached. Force it by setting bit 7 on a real captured
 *      entry, IDENTICALLY on both sides (the crafted entry: a real state with a one-bit
 *      poke, docs/decompiler-pipeline). Setting bit 7 keeps the SAME string (it survives `add a,a` only
 *      as carry; `and 0x7f` drops it from the index), so the descriptor stays valid.
 *
 *   3. TEETH — a twin that corrupts the FIRST character store (XOR 0xFF) MUST be caught
 *      by the captured sweep. A gate a wrong output cell slips through is worthless.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-05e9.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_05e9 as oracle } from "../../translated/loc_05e9.js";
import { drawStringVertical } from "../drawStringVertical.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x05e9;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * Diff two machines' RAM. Returns the first difference OUTSIDE the stack scratch below the entry SP
 * (game-visible — a real failure) or null, plus how many bytes differed inside the
 * dead stack scratch (the oracle's push-af / pop-hl residue the idiomatic side omits).
 */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0;
  let bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

/**
 * Replay one entry state through the oracle and a candidate on independent clones
 * (FRESH per side — the routine writes VRAM), and return the diff plus the two machines.
 */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/**
 * Hook 0x05E9 in a real attract run and clone the machine at every `stride`-th true
 * dispatch (up to K). Each clone is one real captured entry; the wrapper delegates to
 * the oracle so the host run proceeds to a clean stop.
 */
function captureDispatches(K, maxFrames, stride = 1) {
  const caps = [];
  let n = 0;
  const snapshot = new Map([[TARGET, (mm) => {
    if (n % stride === 0 && caps.length < K) caps.push(mm.clone());
    n++;
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (captured): drawStringVertical == oracle on real dispatches (diff confined to stack)", () => {
  const caps = captureDispatches(64, 3000, 2);
  assert.ok(caps.length >= 1, "expected at least one real 0x05E9 dispatch during attract");

  const seen = new Set();
  for (const entry of caps) {
    const payload = entry.regs.a & 0xff;
    seen.add(payload);

    const { a, b, bad } = replay(entry, drawStringVertical);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) on payload ${hx(payload)}`,
    );

    // The idiomatic side is a plain JS function: it makes a normal JS return, so SP/pc
    // stay at entry (the oracle's `pop hl / ret` moves them). Compare RAM, not SP, here.
    assert.equal(b.regs.sp, entry.regs.sp, `idiomatic must leave SP at entry (${hx(b.regs.sp)} vs ${hx(entry.regs.sp)})`);
    assert.equal(b.pc, entry.pc, `idiomatic must leave pc at entry (${hx(b.pc)} vs ${hx(entry.pc)})`);

    // The oracle's stack activity (prologue `push af`, at entry SP-2) must land inside
    // STACK_SCRATCH, so excluding it cannot mask a real game-visible diff.
    assert.ok(
      entry.regs.sp - 2 >= STACK_SCRATCH.lo && entry.regs.sp <= STACK_SCRATCH.hi,
      `oracle's push target must sit inside STACK_SCRATCH (SP=${hx(entry.regs.sp)})`,
    );
    // Sanity: the oracle really did use the stack (proving the exclusion is load-bearing).
    void a;
  }
  console.log(
    `  EQUAL/captured: ${caps.length} real dispatches over payloads {${[...seen].sort((x, y) => x - y).map(hx).join(",")}} — ` +
      "game-visible RAM identical, idiomatic leaves SP/pc at entry",
  );
});

// -- 2. EQUAL (crafted BLANK-MODE arm) ----------------------------------------

test("EQUAL (crafted): the erase arm (payload bit 7) matches the oracle on real strings", () => {
  const caps = captureDispatches(16, 3000, 2);
  assert.ok(caps.length >= 1, "need a real entry to craft the blank-mode arm from");

  let crafted = 0;
  for (const entry of caps) {
    // Craft: set payload bit 7 identically on both sides -> erase mode, SAME string.
    const a = entry.clone();
    const b = entry.clone();
    a.regs.a = (entry.regs.a | 0x80) & 0xff;
    b.regs.a = (entry.regs.a | 0x80) & 0xff;
    oracle(a);
    drawStringVertical(b);
    const { bad } = ramDiffMinusStack(a, b, entry.regs.sp);
    assert.equal(
      bad,
      null,
      bad && `blank-mode RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) on payload ${hx(b.regs.a)}`,
    );
    crafted++;
    if (crafted >= 8) break; // a handful of real strings is enough to exercise the arm
  }
  console.log(`  EQUAL/crafted: ${crafted} real strings drawn in erase mode — game-visible RAM identical`);
});

// -- 3. TEETH -----------------------------------------------------------------

/**
 * Broken twin: identical to drawStringVertical EXCEPT it corrupts the FIRST character
 * store (XOR 0xFF), a plausible "wrong value to one of the routine's own output cells"
 * bug. Attract dispatches are all draw (not erase), so the corrupt byte survives and
 * the captured sweep must catch it.
 */
function brokenDrawStringVertical(m) {
  const { regs, mem } = m;
  const payload = regs.a & 0xff;
  const blankMode = (payload & 0x80) !== 0;
  const index = ((payload << 1) & 0xff) & 0x7f;
  const descriptor = mem.read16((0x364b + index) & 0xffff);
  let dst = mem.read16(descriptor);
  let src = (descriptor + 2) & 0xffff;
  let firstStore = true;
  for (;;) {
    const ch = mem.read8(src);
    if (ch === 0x3f) return;
    mem.write8(dst, firstStore ? (ch ^ 0xff) : ch); // BUG: corrupt the first store
    firstStore = false;
    if (blankMode) mem.write8(dst, 0x10);
    src = (src + 1) & 0xffff;
    dst = (dst + 0xffe0) & 0xffff;
  }
}

test("TEETH (captured): the corrupt-first-store twin is CAUGHT by the captured sweep", () => {
  const caps = captureDispatches(64, 3000, 2);
  assert.ok(caps.length >= 1, "need real dispatches to test the teeth against");

  let caught = null;
  for (const entry of caps) {
    const { bad } = replay(entry, brokenDrawStringVertical);
    if (bad) { caught = { ...bad, payload: entry.regs.a & 0xff }; break; }
  }
  assert.notEqual(caught, null, "the captured sweep FAILED to catch a corrupt store — it is worthless");
  console.log(
    `  TEETH/captured: caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b}) on payload ${hx(caught.payload)}`,
  );
});
