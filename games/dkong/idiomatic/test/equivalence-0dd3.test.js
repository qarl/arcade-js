// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_0dd3 (ROM 0x0DD3) — convert a segment record's second
 * endpoint, compute its run deltas, and draw the segment (ladder + caps, or girder).
 *
 * loc_0dd3 WRITES memory (the segment scratch 0x63b0-0x63b3 / 0x63ad, and — through
 * its renderer tails loc_0e19 (ladder) / loc_0e4f (girder) — ladder tile 0xC0 runs,
 * endpoint caps, and girder spans in VRAM) and is NOT a leaf, so it is gated by
 * capture / clone / replay (docs/decompiler-pipeline) with a FRESH clone per case. Its callees are the
 * frozen oracles loc_2ff0 / loc_0e4f / loc_0e19 (no idiomatic yet), called directly;
 * those model the Z80 stack (push/call/ret), so the ONLY residual divergence between
 * oracle and idiomatic is confined to the dead STACK_SCRATCH region, which the diff
 * excludes. Attract's 25m board draw exercises all three arms naturally:
 *
 *   1. REALISM (real captured dispatches) — hook 0x0dd3 during attract. sub_0da7's
 *      record walk dispatches it once per segment; the captured kinds span kind 0
 *      (ladder), kind 1 (ladder + zero-run), and kind 2 (girder). For each, run the
 *      ORACLE on one clone and idiomatic on another and confirm identical game-visible
 *      RAM AND identical DE. DE matters and RAM cannot see it: loc_0dd3 preserves DE
 *      (= record+4) across loc_2ff0 exactly as the ROM's push/pop did, and the renderer
 *      tails step it to the next record — but no memory write depends on it here, so a
 *      dropped preservation is invisible to the RAM gate and must be checked directly.
 *
 *   2. CRAFTED (kind sweep) — on a real base, poke the kind byte 0x63b3 to 0/1/2/3
 *      identically on both sides. This pins each dispatch arm, including kind 3 (the
 *      strip drawer loc_0ee8, reached via loc_0e4f) that attract's 25m never produces.
 *
 *   3. TEETH — three deliberately-broken twins MUST be caught:
 *      (a) DROP-DE — omits the DE restore after loc_2ff0. RAM-identical (no write
 *          depends on DE), so ONLY the DE assertion catches it. This is what proves the
 *          DE live-out channel has teeth.
 *      (b) WRONG-CAP — stamps the first endpoint cap with +0xf1 instead of +0xf0.
 *          Caught by the RAM diff in the cap's VRAM cell.
 *      (c) INV-DISP — inverts the kind dispatch, swapping girder<->ladder. Caught by
 *          the RAM diff (the wrong renderer runs).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0dd3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0dd3 as oracle } from "../../translated/loc_0dd3.js";
import { loc_0dd3 as idiomatic } from "../loc_0dd3.js";
import { loc_2ff0 } from "../../translated/loc_2ff0.js"; // oracle callees, for the teeth twins
import { loc_0e4f } from "../../translated/loc_0e4f.js";
import { loc_0e19 } from "../../translated/loc_0e19.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0dd3;
const HEIGHT = 0x63b1;
const RUN = 0x63b2;
const SUBTILE2 = 0x63b0;
const ADDR2 = 0x63ad;
const SUBTILE1 = 0x63af;
const ADDR1 = 0x63ab;
const KIND = 0x63b3;

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

/**
 * Run oracle and a candidate on two FRESH clones of `entry` (a memory-writing routine
 * demands a fresh clone per side) and return the game-visible RAM diff plus each side's
 * final DE (the declared live-out register the RAM image cannot capture).
 */
function replay(entry, cand) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  cand(b);
  return {
    ram: firstRamDiffOutsideStack(a, b, entry.regs.sp),
    deOracle: a.regs.de & 0xffff,
    deCand: b.regs.de & 0xffff,
  };
}

/**
 * Hook 0x0dd3 in a real attract run and clone the machine at up to K real dispatches.
 * sub_0da7's `call 0x0dd3` (once per playfield-segment record) resolves to this wrapper,
 * which clones the entry state then runs the ORACLE so the host game proceeds to a clean
 * stop. The 25m board is laid down early, so a modest window captures every record.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  return caps;
}

let CACHED_CAPS = null;
function realCaptures() {
  if (!CACHED_CAPS) CACHED_CAPS = captureDispatches(64, 2500);
  return CACHED_CAPS;
}

/** A real captured entry of a given kind, to craft arms onto (or the first if unspecified). */
function baseOfKind(kind) {
  const caps = realCaptures();
  const c = kind === undefined ? caps[0] : caps.find((x) => x.mem.read8(KIND) === kind);
  assert.ok(c, `expected a real 0x0dd3 dispatch${kind === undefined ? "" : ` of kind ${kind}`}`);
  return c;
}

// -- 1. REALISM (captured dispatches) -----------------------------------------

test("REALISM: real captured 0x0dd3 dispatches — game-visible RAM + DE match the oracle", () => {
  const caps = realCaptures();
  assert.ok(caps.length >= 1, "expected at least one real 0x0dd3 dispatch during attract");

  const kinds = {};
  for (const entry of caps) {
    const kind = entry.mem.read8(KIND);
    kinds[kind] = (kinds[kind] || 0) + 1;

    // Both oracle and idiomatic confine ALL stack traffic to STACK_SCRATCH, so excluding
    // that region from the RAM diff cannot mask a game-visible divergence.
    assert.ok(
      (entry.regs.sp - 8) >= STACK_SCRATCH.lo && entry.regs.sp <= STACK_SCRATCH.hi,
      `entry SP must sit inside STACK_SCRATCH with margin (SP=${hx(entry.regs.sp)})`,
    );

    const { ram, deOracle, deCand } = replay(entry, idiomatic);
    assert.equal(
      ram,
      null,
      ram && `game-visible RAM diff at ${hx(ram.addr)} (oracle=${ram.a} idiomatic=${ram.b}) ` +
        `on kind=${kind} DE=${hx(entry.regs.de)}`,
    );
    assert.equal(deCand, deOracle, `DE live-out mismatch on kind=${kind}: oracle=${hx(deOracle)} idiomatic=${hx(deCand)}`);
  }
  // The three real arms must all be present, or the natural coverage claim is hollow.
  assert.ok(kinds[0] > 0, "expected kind-0 (ladder) captures");
  assert.ok(kinds[1] > 0, "expected kind-1 (ladder + zero-run) captures");
  assert.ok(kinds[2] > 0, "expected kind-2 (girder) captures");
  console.log(
    `  REALISM: ${caps.length} real 0x0dd3 dispatches — RAM (ex-stack) + DE identical; ` +
      `kinds seen: 0(ladder)=${kinds[0]} 1(ladder+0)=${kinds[1]} 2(girder)=${kinds[2]}`,
  );
});

// -- 2. CRAFTED (kind sweep) --------------------------------------------------

test("CRAFTED: kinds 0/1/2/3 poked on a real base — RAM + DE match the oracle", () => {
  const base = baseOfKind();
  let n = 0;
  for (const kind of [0, 1, 2, 3]) {
    const seed = base.clone();
    seed.mem.write8(KIND, kind); // craft the record kind, coherent with its real y2/x2
    const { ram, deOracle, deCand } = replay(seed, idiomatic);
    assert.equal(ram, null, ram && `kind ${kind}: RAM diff at ${hx(ram.addr)} (oracle=${ram.a} idiomatic=${ram.b})`);
    assert.equal(deCand, deOracle, `kind ${kind}: DE mismatch oracle=${hx(deOracle)} idiomatic=${hx(deCand)}`);
    n++;
  }
  console.log(`  CRAFTED: ${n} kinds (incl. kind-3 strip drawer via loc_0ee8) — RAM (ex-stack) + DE identical`);
});

// -- 3. TEETH -----------------------------------------------------------------

/**
 * Twin (a): omits the DE restore after loc_2ff0 (which clobbers D/E). No memory write
 * depends on DE, so the RAM image is untouched — only the DE live-out diverges.
 */
function brokenDropDe(m) {
  const { regs, mem } = m;
  mem.write8(HEIGHT, regs.a);
  regs.de = (regs.de + 1) & 0xffff;
  const x2 = mem.read8(regs.de);
  regs.l = x2;
  mem.write8(RUN, (x2 - regs.c) & 0xff);
  mem.write8(SUBTILE2, x2 & 0x07);
  loc_2ff0(m); // BUG: no savedDe / restore — DE left clobbered
  mem.write16(ADDR2, regs.hl);
  if ((((mem.read8(KIND) - 0x02) & 0xff) & 0x80) === 0) { loc_0e4f(m); return; }
  const step = (mem.read8(RUN) - 0x10) & 0xff;
  mem.write8(RUN, (mem.read8(SUBTILE1) + step) & 0xff);
  const cap1 = (mem.read8(SUBTILE1) + 0xf0) & 0xff;
  regs.hl = mem.read16(ADDR1);
  mem.write8(regs.hl, cap1);
  regs.l = (regs.l + 1) & 0xff;
  mem.write8(regs.hl, (cap1 - 0x30) & 0xff);
  if (mem.read8(KIND) === 0x01) mem.write8(RUN, 0x00);
  loc_0e19(m);
}

/** Twin (b): stamps the first endpoint cap with +0xf1 instead of +0xf0. */
function brokenWrongCap(m) {
  const { regs, mem } = m;
  mem.write8(HEIGHT, regs.a);
  regs.de = (regs.de + 1) & 0xffff;
  const x2 = mem.read8(regs.de);
  regs.l = x2;
  mem.write8(RUN, (x2 - regs.c) & 0xff);
  mem.write8(SUBTILE2, x2 & 0x07);
  const savedDe = regs.de;
  loc_2ff0(m);
  regs.de = savedDe;
  mem.write16(ADDR2, regs.hl);
  if ((((mem.read8(KIND) - 0x02) & 0xff) & 0x80) === 0) { loc_0e4f(m); return; }
  const step = (mem.read8(RUN) - 0x10) & 0xff;
  mem.write8(RUN, (mem.read8(SUBTILE1) + step) & 0xff);
  const cap1 = (mem.read8(SUBTILE1) + 0xf1) & 0xff; // BUG: +0xf1, should be +0xf0
  regs.hl = mem.read16(ADDR1);
  mem.write8(regs.hl, cap1);
  regs.l = (regs.l + 1) & 0xff;
  mem.write8(regs.hl, (cap1 - 0x30) & 0xff);
  if (mem.read8(KIND) === 0x01) mem.write8(RUN, 0x00);
  loc_0e19(m);
}

/** Twin (c): inverts the kind dispatch, swapping the girder and ladder renderers. */
function brokenInvDispatch(m) {
  const { regs, mem } = m;
  mem.write8(HEIGHT, regs.a);
  regs.de = (regs.de + 1) & 0xffff;
  const x2 = mem.read8(regs.de);
  regs.l = x2;
  mem.write8(RUN, (x2 - regs.c) & 0xff);
  mem.write8(SUBTILE2, x2 & 0x07);
  const savedDe = regs.de;
  loc_2ff0(m);
  regs.de = savedDe;
  mem.write16(ADDR2, regs.hl);
  if ((((mem.read8(KIND) - 0x02) & 0xff) & 0x80) !== 0) { loc_0e4f(m); return; } // BUG: inverted
  const step = (mem.read8(RUN) - 0x10) & 0xff;
  mem.write8(RUN, (mem.read8(SUBTILE1) + step) & 0xff);
  const cap1 = (mem.read8(SUBTILE1) + 0xf0) & 0xff;
  regs.hl = mem.read16(ADDR1);
  mem.write8(regs.hl, cap1);
  regs.l = (regs.l + 1) & 0xff;
  mem.write8(regs.hl, (cap1 - 0x30) & 0xff);
  if (mem.read8(KIND) === 0x01) mem.write8(RUN, 0x00);
  loc_0e19(m);
}

test("TEETH (drop-DE): the missing DE restore is RAM-invisible but CAUGHT on the DE channel", () => {
  const base = baseOfKind(0); // ladder path: DE is write-invisible, so RAM stays clean
  const { ram, deOracle, deCand } = replay(base, brokenDropDe);
  assert.equal(ram, null, "the drop-DE twin must be RAM-identical — the bug lives only in the DE live-out");
  assert.notEqual(deCand, deOracle, "the DE assertion FAILED to catch a dropped DE restore — it is worthless");
  console.log(`  TEETH/drop-DE: RAM-invisible (diff=null) but caught on DE (oracle=${hx(deOracle)} broken=${hx(deCand)})`);
});

test("TEETH (wrong-cap): the +0xf1 endpoint cap is CAUGHT by the RAM diff", () => {
  const base = baseOfKind(0);
  const { ram } = replay(base, brokenWrongCap);
  assert.notEqual(ram, null, "the RAM gate FAILED to catch a wrong endpoint-cap tile — it is worthless");
  assert.equal(ram.b, (ram.a + 1) & 0xff, `the caught cap must be one glyph high (oracle=${ram.a} broken=${ram.b})`);
  console.log(`  TEETH/wrong-cap: caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

test("TEETH (inv-dispatch): the swapped girder/ladder dispatch is CAUGHT by the RAM diff", () => {
  const base = baseOfKind(2); // real girder record -> the twin runs the ladder renderer instead
  const { ram } = replay(base, brokenInvDispatch);
  assert.notEqual(ram, null, "the RAM gate FAILED to catch an inverted dispatch — it is worthless");
  console.log(`  TEETH/inv-dispatch: caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});
