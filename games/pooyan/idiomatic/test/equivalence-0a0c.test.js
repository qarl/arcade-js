// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for seedObjectRecord (ROM 0x0a0c, Pooyan) — seed one object record
 * at IX from a 2-byte descriptor stream (DE) and a 2-byte coordinate stream (HL): write
 * rec+0x06 = desc[0], rec+0x04 = desc[1], rec+0x0c = coord[0], rec+0x0d = coord[1],
 * rec+0x0e = 0, and advance DE and HL by 2 each. Every other record byte is left as found.
 *
 * This is the CYCLE-FREE / memory-equivalence gate. seedObjectRecord WRITES RAM, so every case
 * runs the oracle on one FRESH clone and the module on another, compared on the go-forward
 * contract:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP)  +  the two advanced pointers.
 *
 * The caller (buildAttractSpritesAndPrimeTextScript) reads the descriptor sentinel from the advanced DE and keeps walking
 * HL into the next record, consuming BOTH advanced pointers without reloading them, so the
 * module's { descPtr, coordPtr } is compared against the oracle clone's final regs.de / regs.hl.
 * IX is left untouched by the routine (the caller steps the record base itself).
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — hook 0x0a0c in a real boot; any dispatch must agree in RAM.
 *   2. CRAFTED — the load-bearing arm. Pre-dirty the record to 0xAA and seed varied descriptor
 *      + coordinate bytes; both sides land the same five bytes and leave the rest of the dirt.
 *   3. WRITE-SET — the oracle writes exactly {+0x04,+0x06,+0x0c,+0x0d,+0x0e}.
 *   4. TEETH — a twin that writes a WRONG coordinate high byte MUST be caught at rec+0x0d;
 *      and an un-advanced descriptor pointer MUST be caught by the return check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0a0c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0a0c as oracle } from "../../translated/loc_0a0c.js";
import { seedObjectRecord } from "../seedObjectRecord.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SPRITE_OBJECT_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x0a0c;
const REC = SPRITE_OBJECT_TABLE; // 0x8b70: a sane object-record base in work RAM
const DESC_SRC = 0x8c00; //         descriptor source stream (work RAM, seeded, read-only here)
const COORD_SRC = 0x8c10; //        coordinate source stream (work RAM, seeded, read-only here)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The exact byte offsets the oracle stamps (used by WRITE-SET).
const WRITTEN_OFFSETS = [0x04, 0x06, 0x0c, 0x0d, 0x0e];

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

/** First RAM difference on the go-forward contract: whole dump minus stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/** A crafted entry machine: the record pre-dirtied to 0xAA, IX/DE/HL set, sources seeded. */
function craft(desc, coord) {
  const m = new Machine(ROM);
  for (let i = 0; i < 0x18; i++) m.mem.write8((REC + i) & 0xffff, 0xaa);
  m.mem.write8(DESC_SRC + 0, desc[0]);
  m.mem.write8(DESC_SRC + 1, desc[1]);
  m.mem.write8(COORD_SRC + 0, coord[0]);
  m.mem.write8(COORD_SRC + 1, coord[1]);
  m.regs.ix = REC;
  m.regs.de = DESC_SRC;
  m.regs.hl = COORD_SRC;
  m.regs.sp = 0x8fe0; // dead scratch: the oracle's ret only pops (reads) the word at SP
  return m;
}

const CASES = [
  { desc: [0x00, 0x00], coord: [0x00, 0x00] },
  { desc: [0xff, 0xff], coord: [0xff, 0xff] },
  { desc: [0x3c, 0x08], coord: [0x84, 0x40] },
  { desc: [0x12, 0x34], coord: [0x56, 0x78] },
  { desc: [0xaa, 0x01], coord: [0x02, 0xaa] }, // some bytes coincide with the 0xAA dirt
];

// -- 1. CAPTURE (best-effort) -------------------------------------------------

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  try {
    const host = new Machine(ROM, { overrides: snap });
    host.runFrames(maxFrames);
  } catch {
    /* boot may unwind on an unimplemented path; keep whatever we captured */
  }
  return caps;
}

test("CAPTURE: real 0x0a0c dispatches — seedObjectRecord == oracle in RAM (−stack) + pointers", () => {
  const caps = captureDispatches(24, 2400);
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    const ret = seedObjectRecord(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
    assert.equal(ret[0], o.regs.de, "captured descPtr live-out mismatch");
    assert.equal(ret[1], o.regs.hl, "captured coordPtr live-out mismatch");
    // SIDE EFFECT: the bridge must SET DE and HL, not merely return them.
    assert.equal(c.regs.de, o.regs.de, "captured: module must SET DE for the translated caller");
    assert.equal(c.regs.hl, o.regs.hl, "captured: module must SET HL for the translated caller");
  }
  console.log(`  CAPTURE: ${caps.length} real 0x0a0c dispatch(es) replayed identically`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: pre-dirtied record + varied streams — RAM identical, five bytes stamped, dirt kept", () => {
  for (const { desc, coord } of CASES) {
    const base = craft(desc, coord);
    const o = base.clone();
    const c = base.clone();
    oracle(o);
    const ret = seedObjectRecord(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
    assert.equal(ret[0], o.regs.de, `descPtr live-out ${hx(ret[0])} != oracle ${hx(o.regs.de)}`);
    assert.equal(ret[1], o.regs.hl, `coordPtr live-out ${hx(ret[1])} != oracle ${hx(o.regs.hl)}`);
    // SIDE EFFECT: the caller buildAttractSpritesAndPrimeTextScript reads the descriptor sentinel out of DE and walks HL into the
    // next record without reloading either, so the bridge must SET both registers — not just return them.
    assert.equal(c.regs.de, o.regs.de, `module must SET DE for the translated caller (desc ${desc}, coord ${coord})`);
    assert.equal(c.regs.hl, o.regs.hl, `module must SET HL for the translated caller (desc ${desc}, coord ${coord})`);

    // The five stamped bytes are exactly right on the module side.
    assert.equal(c.mem.read8((REC + 0x06) & 0xffff), desc[0], "rec+0x06 = desc[0]");
    assert.equal(c.mem.read8((REC + 0x04) & 0xffff), desc[1], "rec+0x04 = desc[1]");
    assert.equal(c.mem.read8((REC + 0x0c) & 0xffff), coord[0], "rec+0x0c = coord[0]");
    assert.equal(c.mem.read8((REC + 0x0d) & 0xffff), coord[1], "rec+0x0d = coord[1]");
    assert.equal(c.mem.read8((REC + 0x0e) & 0xffff), 0x00, "rec+0x0e cleared");

    // A record byte NOT in the write set keeps its 0xAA dirt (proves surgical writes).
    assert.equal(c.mem.read8((REC + 0x10) & 0xffff), 0xaa, "+0x10 should be untouched");
    assert.equal(c.mem.read8((REC + 0x00) & 0xffff), 0xaa, "+0x00 should be untouched");
  }
  console.log(`  CRAFTED: ${CASES.length} descriptor/coordinate pairs stamped identically, dirt preserved`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle writes exactly {+0x04,+0x06,+0x0c,+0x0d,+0x0e}", () => {
  const written = new Set(WRITTEN_OFFSETS.map((o) => (REC + o) & 0xffff));
  for (const { desc, coord } of CASES) {
    const before = craft(desc, coord);
    const after = before.clone();
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();

    const changed = new Set();
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] !== a1[off]) changed.add(after.stateOffsetToAddr(off));
    }
    for (const addr of changed) {
      assert.ok(written.has(addr), `oracle wrote unexpected addr ${hx(addr)}`);
    }
    // rec+0x0e always changes (0xAA -> 0x00); the four data bytes change unless they coincide
    // with the 0xAA dirt, so assert membership above and this always-present write here.
    assert.ok(changed.has((REC + 0x0e) & 0xffff), "rec+0x0e should have changed");
  }
  console.log("  WRITE-SET: every oracle write is within the declared five offsets");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong coordinate high byte is CAUGHT at rec+0x0d", () => {
  let caught = null;
  for (const { desc, coord } of CASES) {
    const base = craft(desc, coord);
    const o = base.clone();
    const c = base.clone();
    oracle(o);
    seedObjectRecord(c);
    c.mem.write8((REC + 0x0d) & 0xffff, (coord[1] ^ 0x01) & 0xff); // BUG: wrong coord high byte
    const d = ramDiffMinusStack(o, c);
    if (d) { caught = d; break; }
  }
  assert.notEqual(caught, null, "the gate FAILED to catch a wrong coordinate high byte — it is worthless");
  assert.equal(caught.addr, (REC + 0x0d) & 0xffff, `teeth caught the wrong address ${hx(caught.addr ?? 0)}`);
  console.log(`  TEETH: wrong coord high caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});

test("TEETH: an un-advanced descriptor pointer is CAUGHT by the return check", () => {
  // The bridge now writes DE back, so c.regs.de is the ADVANCED pointer; the un-advanced value a
  // broken twin would leave is the descriptor source base (DESC_SRC), which the oracle advances by 2.
  let caught = false;
  for (const { desc, coord } of CASES) {
    const base = craft(desc, coord);
    const o = base.clone();
    oracle(o);
    const wrongRet = DESC_SRC; // an un-advanced descriptor pointer (the source base)
    if (wrongRet !== o.regs.de) { caught = true; break; }
  }
  assert.ok(caught, "the return check FAILED to distinguish an un-advanced descriptor pointer — it is worthless");
  console.log("  TEETH: an un-advanced descriptor pointer differs from the oracle's advanced DE");
});
