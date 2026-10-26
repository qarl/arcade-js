// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for initActorRecord (ROM 0x619f) — "stamp the fixed opening
 * state into a fresh 0x18-byte actor record": record base in HL, 16-bit datum in DE;
 * write +0x00=0x00, +0x01=0x01, +0x02=0x08, +0x12=0xff, and DE little-endian at
 * +0x16 (E) / +0x17 (D). Every other record byte is left as found.
 *
 * This is the CYCLE-FREE / memory-equivalence gate. initActorRecord WRITES RAM, so every
 * case uses a FRESH clone per side. The oracle runs on one clone, initActorRecord on
 * another, and they are compared on the go-forward contract:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP), AND the HL live-out.
 *
 * The register inputs are HL (record base) and DE (datum); both sides read them from
 * regs.hl / regs.de (the module's sanctioned defaults). The oracle advances HL to rec+0x17,
 * and its caller's scan continuation consumes that HL WITHOUT reloading it, so the module's
 * return (the advanced pointer) is compared against the oracle clone's final regs.hl. (BC is
 * left as plumbing but no caller reads it, so it is not part of the contract.)
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — hook 0x619f in a real run; any dispatch must agree in RAM.
 *   2. CRAFTED — the load-bearing arm. Pre-dirty the whole record to 0xAA and seed varied
 *      DE values; both sides land the same six bytes and leave the rest of the dirt intact.
 *   3. WRITE-SET — the oracle writes exactly {+0x00,+0x01,+0x02,+0x12,+0x16,+0x17}.
 *   4. TEETH — a twin that writes a WRONG datum high byte MUST be caught at rec+0x17.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-619f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_619f as oracle } from "../../translated/loc_619f.js";
import { initActorRecord } from "../initActorRecord.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ACTOR_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x619f;
const REC = ACTOR_TABLE; // 0x8a80: a sane record base inside the actor arena (work RAM)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The exact byte offsets the oracle stamps (used by WRITE-SET).
const WRITTEN_OFFSETS = [0x00, 0x01, 0x02, 0x12, 0x16, 0x17];

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0); // crafted entries keep the reset SP 0, so no scratch cell lies below it

/** First RAM difference on the go-forward contract: whole dump minus stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/**
 * Build a machine with the whole 0x18-byte record at REC pre-dirtied to 0xAA, HL pointing
 * at the record base and DE carrying the datum.
 */
function craft(datum) {
  const m = new Machine(ROM);
  for (let i = 0; i < 0x18; i++) m.mem.write8((REC + i) & 0xffff, 0xaa);
  m.regs.hl = REC;
  m.regs.de = datum & 0xffff;
  return m;
}

const DATA = [0x0000, 0xffff, 0x3c7d, 0x1234, 0x0080];

// -- 1. CAPTURE (best-effort) -------------------------------------------------

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

const CAPS = ROM_PRESENT ? captureDispatches(32, 4000) : [];

test("CAPTURE: real 0x619f dispatches — initActorRecord == oracle in RAM (−stack)", () => {
  assert.ok(CAPS.length >= 1, "expected at least one real 0x619f dispatch in the run window");
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    const ret = initActorRecord(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, o.regs.hl, `HL live-out: module ${hx(ret)} != oracle ${hx(o.regs.hl)}`);
    assert.equal(c.regs.hl, o.regs.hl, `module must SET HL for the translated dispatch: ${hx(c.regs.hl)} != ${hx(o.regs.hl)}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: pre-dirtied record + varied DE — RAM identical, six bytes stamped, dirt kept", () => {
  for (const datum of DATA) {
    const o = craft(datum);
    const c = craft(datum);
    oracle(o);
    const ret = initActorRecord(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `datum ${hx(datum)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, o.regs.hl, `datum ${hx(datum)}: HL live-out module ${hx(ret)} != oracle ${hx(o.regs.hl)}`);
    assert.equal(c.regs.hl, o.regs.hl, `datum ${hx(datum)}: module must SET HL ${hx(c.regs.hl)} != oracle ${hx(o.regs.hl)}`);

    // The six stamped bytes are exactly right on the module side.
    assert.equal(c.mem.read8((REC + 0x00) & 0xffff), 0x00);
    assert.equal(c.mem.read8((REC + 0x01) & 0xffff), 0x01);
    assert.equal(c.mem.read8((REC + 0x02) & 0xffff), 0x08);
    assert.equal(c.mem.read8((REC + 0x12) & 0xffff), 0xff);
    assert.equal(c.mem.read8((REC + 0x16) & 0xffff), datum & 0xff, `datum ${hx(datum)}: low byte`);
    assert.equal(c.mem.read8((REC + 0x17) & 0xffff), (datum >> 8) & 0xff, `datum ${hx(datum)}: high byte`);

    // A record byte NOT in the write set keeps its 0xAA dirt (proves surgical writes).
    assert.equal(c.mem.read8((REC + 0x10) & 0xffff), 0xaa, `datum ${hx(datum)}: +0x10 should be untouched`);
  }
  console.log(`  CRAFTED: ${DATA.length} datum values stamped identically, dirt preserved`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle writes exactly {+0x00,+0x01,+0x02,+0x12,+0x16,+0x17}", () => {
  const written = new Set(WRITTEN_OFFSETS.map((o) => (REC + o) & 0xffff));
  for (const datum of DATA) {
    const before = craft(datum);
    const after = before.clone();
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();

    const changed = new Set();
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] !== a1[off]) changed.add(after.stateOffsetToAddr(off));
    }
    for (const addr of changed) {
      assert.ok(written.has(addr), `datum ${hx(datum)}: oracle wrote unexpected addr ${hx(addr)}`);
    }
    // Every expected write actually landed a change (0xAA -> new value; note +0x16/+0x17
    // could coincidentally equal 0xAA for some datum, so only assert membership, not count).
    for (const off of [0x00, 0x01, 0x02, 0x12]) {
      assert.ok(changed.has((REC + off) & 0xffff), `datum ${hx(datum)}: +${hx(off)} should have changed`);
    }
  }
  console.log("  WRITE-SET: every oracle write is within the declared six offsets");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: corrupts the datum HIGH byte — must be caught at rec+0x17. */
function brokenInitActorRecord(m, rec = m.regs.hl, value = m.regs.de) {
  initActorRecord(m, rec, value);
  m.mem.write8((rec + 0x17) & 0xffff, (((value >> 8) & 0xff) ^ 0x01) & 0xff); // BUG: wrong high byte
}

test("TEETH: a wrong datum high byte is CAUGHT at rec+0x17", () => {
  let caught = null;
  for (const datum of DATA) {
    const o = craft(datum);
    const c = craft(datum);
    oracle(o);
    brokenInitActorRecord(c);
    const d = ramDiffMinusStack(o, c);
    if (d) { caught = d; break; }
  }
  assert.notEqual(caught, null, "the gate FAILED to catch a wrong datum high byte — it is worthless");
  assert.equal(caught.addr, (REC + 0x17) & 0xffff, `teeth caught the wrong address ${hx(caught.addr ?? 0)}`);
  console.log(`  TEETH: wrong high byte caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});

test("TEETH: an un-advanced HL live-out is CAUGHT by the return + side-effect check", () => {
  // A twin that stamps the record but leaves HL at the base — the memory-only bug this batch fixes.
  // Both the return value and the register the bridge sets must reject it.
  const broken = (m, rec = m.regs.hl, value = m.regs.de) => {
    initActorRecord(m, rec, value);
    return (m.regs.hl = rec); // BUG: HL left un-advanced at the base
  };
  let caught = null;
  for (const datum of DATA) {
    const o = craft(datum);
    const c = craft(datum);
    oracle(o);
    const ret = broken(c);
    if (ret !== o.regs.hl || c.regs.hl !== o.regs.hl) { caught = { ret, hl: c.regs.hl, oracle: o.regs.hl }; break; }
  }
  assert.notEqual(caught, null, "the HL contract FAILED to reject an un-advanced HL live-out — it is worthless");
  assert.notEqual(caught.oracle, REC, "sanity: the oracle's HL is genuinely advanced past the record base");
  console.log(`  TEETH: un-advanced HL rejected (base ${hx(REC)} vs oracle ${hx(caught.oracle)})`);
});
