// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for clearDisplayMsgBufOnRoundInitMatch (ROM 0x1694, Pooyan) — pattern compare of the display buffer.
 *
 * SEATING: BALANCED (plain ret / tail-branch) -> WIRE. Void handler: no caller reads a register back,
 * so LIVE-OUT is memory only and the comparison is RAM (dumpState) minus stack scratch below the entry SP.
 *
 * Paths crafted here: the first-byte mismatch (tail into selectRoundDisplayListAndAdvancePhase, held to its timer-not-expired
 * early return so the diff stays local) and the full-match clear of the seven-cell buffer.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1694.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1694 as oracle } from "../../translated/loc_1694.js";
import { clearDisplayMsgBufOnRoundInitMatch } from "../clearDisplayMsgBufOnRoundInitMatch.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, DISPLAY_MSG_BUF } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const PATTERN_ROM = 0x16ae;
const PHASE_TIMER = 0x8808;
const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function base(m) {
  m.regs.sp = SP0;
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  return m;
}

/** Copy the 0xff-terminated ROM pattern into the display buffer so clearDisplayMsgBufOnRoundInitMatch takes the full-match path. */
function copyPattern(m) {
  for (let i = 0; ; i++) {
    const b = m.mem.read8(PATTERN_ROM + i);
    m.mem.write8(DISPLAY_MSG_BUF + i, b);
    if (b === 0xff) break;
  }
}

const CASES = {
  "mismatch -> tail selectRoundDisplayListAndAdvancePhase (timer not expired)": (m) => {
    base(m);
    for (let i = 0; i < 0x08; i++) m.mem.write8(DISPLAY_MSG_BUF + i, 0x55); // != pattern[0]=0x0a
    m.mem.write8(PHASE_TIMER, 0x02); // selectRoundDisplayListAndAdvancePhase dec -> 1, returns immediately
    return m;
  },
  "full match -> clear 7 cells": (m) => {
    base(m);
    for (let i = 0; i < 0x08; i++) m.mem.write8(DISPLAY_MSG_BUF + i, 0x55); // pre-dirty
    copyPattern(m);
    return m;
  },
};

test("EQUAL: clearDisplayMsgBufOnRoundInitMatch == oracle in RAM (−stack)", () => {
  for (const [name, craft] of Object.entries(CASES)) {
    const o = craft(BASE.clone());
    const c = craft(BASE.clone());
    oracle(o);
    clearDisplayMsgBufOnRoundInitMatch(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} paths identical (RAM −stack)`);
});

test("WRITE-SET: a full match clears the seven-cell buffer to zero", () => {
  const m = CASES["full match -> clear 7 cells"](BASE.clone());
  oracle(m);
  for (let i = 0; i < 0x07; i++) {
    assert.equal(m.mem.read8(DISPLAY_MSG_BUF + i), 0x00, `cell ${i} not cleared`);
  }
  console.log("  WRITE-SET: 7 cells cleared");
});

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const o = CASES["full match -> clear 7 cells"](BASE.clone());
  const c = CASES["full match -> clear 7 cells"](BASE.clone());
  oracle(o);
  clearDisplayMsgBufOnRoundInitMatch(c);
  c.mem.write8(DISPLAY_MSG_BUF, (o.mem.read8(DISPLAY_MSG_BUF) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  console.log(`  TEETH(RAM): caught at ${hx(d.addr ?? 0)}`);
});

test("TEETH: a twin that skips the clear diverges from the oracle", () => {
  const o = CASES["full match -> clear 7 cells"](BASE.clone());
  const c = CASES["full match -> clear 7 cells"](BASE.clone());
  oracle(o); // clears the buffer
  // twin: do nothing -> the pre-dirty 0x55/pattern bytes survive
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped clear must be caught by the RAM diff");
  console.log(`  TEETH(clear): caught at ${hx(d.addr ?? 0)}`);
});
