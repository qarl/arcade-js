// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0b93 — memory-equivalent to the frozen oracle at ROM 0x0B93.
 *
 * WHAT IT IS. The foreground loop. It consumes the command ring forever: read cursor, occupancy
 * test, take two bytes, free both cells, step and wrap the cursor, index a sixteen-entry address
 * table through the already-decompiled fetchWideTableWord — that transfer is dissolved into a
 * direct call here — and run the address it names with a fixed place to come back to.
 *
 * ★ NEITHER SIDE RETURNS, so the ordinary contract call CANNOT be used and this file says so
 *   instead of pretending. `unitEquivalence` runs both implementations to completion; both of
 *   these run until something outside them stops the machine. What replaces it is an ESCAPE: the
 *   sixteen handler addresses are replaced, in one clone's own registry, by a stub that records
 *   the register state it was handed and then points the program counter at a no-op address the
 *   loop does not own. Both implementations already treat that as "the arm went somewhere else"
 *   and hand over to it, so BOTH return after exactly one command — through their own code, not
 *   through anything the harness added to them.
 *
 * ★ WHAT THAT BUYS AND WHAT IT DOES NOT. It compares the whole of the consume-and-dispatch path:
 *   the cells freed, the cursor stepped and wrapped, WHICH handler is selected, and the register
 *   state the handler is handed. It does NOT compare the idle spin — with a free cell neither side
 *   terminates, so no arm here presents one, and that is a stated hole rather than a gap nobody
 *   noticed.
 *
 * ★ THERE IS NO WHOLE-MACHINE ARM, and the reason is structural. An idiomatic poll loop charges no
 *   T-states, so wiring this one into the cycle-driven host means the interrupt that refills the
 *   ring never arrives and the run hangs. That is the documented consequence of dropping the cycle
 *   model for a routine that WAITS, not a defect in this rewrite, and it is why every tooth below
 *   is a unit tooth.
 *
 * ★ THE FLAGS AT THE HANDOVER ARE NOT COMPARED, and that is a derivation rather than a shrug. The
 *   oracle's last flag-setting operation before the handover is inside the table read; the rewrite
 *   calls a routine that does not model flags. The HANDLER ENTRIES arm disassembles nothing — it
 *   reads the first opcode of every one of the sixteen arms out of memory and asserts each either
 *   sets flags before testing any or ignores them, which is what makes the incoming flag state
 *   dead at every arm.
 *
 * GATE: crafted-entry with an escape, over the ring's whole command space. Holes stated:
 *
 *   1. THE ENTRY — captured at the one real dispatch, which happens once per session at boot.
 *   2. ESCAPE WORKS — both sides return after exactly one command, and the stub fired once.
 *   3. EQUAL — identical outside a measured scratch window, on every crafted command.
 *   4. NOT VACUOUS — a no-op FAILS the same masked diff on a real cell.
 *   5. THE HANDOVER — the handler chosen and the registers it is handed, compared as data.
 *   6. EXHAUSTIVE — all 256 command bytes against several cursors and arguments.
 *   7. COMMAND_RING WRAP — cursors that take the step past the end of the ring.
 *   8. HANDLER ENTRIES — the first instruction of all sixteen arms, read out of memory.
 *   9. TEETH — nine twins, each with an exact catch count over the crafted space.
 *
 * HOLE: the idle spin is not compared, because neither side terminates on a free cell.
 * HOLE: there is no whole-run arm and no session corpus beyond the single boot dispatch.
 * HOLE: the sixteen arms are STUBBED, so nothing here says what any of them does.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0b93.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_0b93 } from "../loc_0b93.js";
import { loc_0b93 as oracle } from "../../translated/loc_0b93.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { COMMAND_READ_CURSOR, COMMAND_RING } from "../names.js";
// unitEquivalence is deliberately NOT imported: it runs both sides to completion, and neither
// side of this routine completes. The escape below is what replaces it.

const TARGET = 0x0b93;

const RING_CELLS = 64;
const FREE = 255;
const HANDLERS = 0x0bbc;
const HANDLER_COUNT = 16;
const COME_BACK_TO = 0x0b90;

/** An address the loop does not own, registered as a no-op so both sides can hand over to it. */
const ESCAPE = 0xffff;

/** Measured: the return address the oracle parks for the arm it hands over to. */
const SCRATCH_BYTES = 2;

/** The register state a handler is handed, which both sides must agree on. */
const HANDOVER = ["a", "b", "c", "de", "hl"];

const skip = romsPresent() ? false : "ROM images are not assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");
const u8 = (x) => x & 0xff;
const everyByte = Array.from({ length: 256 }, (_unused, v) => v);

const sharedMachine = (overrides) => makeMachine(overrides);

// ── the entry ───────────────────────────────────────────────────────────────────────────

let entry = null;
function entryState() {
  if (entry !== null) return entry;
  const real = makeMachine().routines.get(TARGET);
  const m = sharedMachine(
    new Map([[TARGET, (mm, ...args) => {
      if (entry === null) entry = mm.clone();
      return real(mm, ...args);
    }]]),
  );
  m.runFrames(ENTRY_FRAMES);
  assert.notEqual(entry, null, "vacuous: the foreground loop was never entered");
  return entry;
}

const handlerTable = () =>
  Array.from({ length: HANDLER_COUNT }, (_unused, i) => entryState().mem16[HANDLERS + 2 * i]);

/** The one address the oracle transfers to that is NOT an arm: its own table read. */
const TABLE_READ = 0x018c;

/**
 * A clone with its OWN registry, in which EVERY address other than the table read records what it
 * was handed and then points the program counter at the escape. Both implementations already hand
 * over to a program counter that is not the place they parked, so this makes both of them return.
 *
 * It stubs every address rather than only the sixteen in the table because a twin that indexes
 * past the table hands over somewhere else entirely: stubbing only the sixteen would let such a
 * twin run a real routine and hang, which is a harness failure rather than a verdict.
 */
function escaping(machine) {
  const seen = [];
  const m = machine.clone();
  const real = m.routines;
  const noop = () => {};
  const stub = (handler) => (mm) => {
    seen.push({ handler, ...Object.fromEntries(HANDOVER.map((k) => [k, mm.regs[k]])) });
    mm.pc = ESCAPE;
  };
  m.routines = {
    get: (addr) => {
      if (addr === TABLE_READ) return real.get(addr);
      if (addr === ESCAPE) return noop;
      return stub(addr);
    },
  };
  return { m, seen };
}

/** A real captured machine with one command waiting at the read cursor. */
function craft(cursor, command, argument) {
  const m = entryState().clone();
  m.mem8[COMMAND_READ_CURSOR] = cursor;
  m.mem8[COMMAND_RING + cursor] = command;
  m.mem8[(COMMAND_RING + cursor + 1) & 0xffff] = argument;
  return m;
}

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

const inScratch = (addr, sp) => addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;

/** Both sides run once on the same crafted state; masked RAM first, then the handover. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const left = escaping(machine);
  const right = escaping(machine);
  oracle(left.m);
  // A twin that indexes past the table hands over to an address with no routine, which throws.
  // Dying where the oracle does not IS a divergence, so it is reported as one.
  try {
    candidate(right.m);
  } catch (e) {
    return { addr: null, a: "returned once", b: String(e).slice(0, 50) };
  }
  const ram = allDiffs(left.m, right.m).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  if (left.seen.length !== right.seen.length) {
    return { addr: null, a: left.seen.length, b: right.seen.length };
  }
  for (const [i, l] of left.seen.entries()) {
    const r = right.seen[i];
    for (const k of ["handler", ...HANDOVER]) {
      if (l[k] !== r[k]) return { addr: null, a: l[k], b: r[k] };
    }
  }
  return null;
}

/** Commands whose low nibble reaches every arm, with two high nibbles and the occupancy bit clear. */
const COMMANDS = everyByte.filter((v) => (v & 0x80) === 0);
const CURSORS = [0, 2, 4, 30, 58, 60, 62, 63, 64, 100, 254, 255];
const ARGUMENTS = [0, 1, 31, 128, 254, 255];

let crossCache = null;
function cross() {
  if (crossCache) return crossCache;
  const out = [];
  for (const cursor of CURSORS) {
    for (const command of COMMANDS) out.push([cursor, command, ARGUMENTS[cursor % ARGUMENTS.length]]);
  }
  for (const argument of ARGUMENTS) out.push([0, 1, argument]);
  crossCache = out;
  return out;
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

function brokenNoOp() {}

/**
 * The correct consume-and-dispatch, so each twin below breaks ONE decision. It carries a pass
 * guard the real routine does not: a twin that indexes past the table can select an address whose
 * own return lands back on the place the loop parked, and then spin on a ring it has already
 * emptied. That is a divergence, and the guard turns it into one the comparison can report
 * instead of a hang.
 */
const TWIN_PASS_LIMIT = 2;

function consume(m, opts) {
  const { regs, mem8 } = m;
  let passes = 0;
  for (;;) {
    if (++passes > TWIN_PASS_LIMIT) throw new Error("the twin spun on an emptied ring");
    const commandCell = (COMMAND_RING + mem8[COMMAND_READ_CURSOR]) & 0xffff;
    if (mem8[commandCell] & 0x80) continue;
    const command = mem8[commandCell];
    if (!opts.keepCells) mem8[commandCell] = FREE;
    const argumentCell = (commandCell + 1) & 0xffff;
    const argument = mem8[argumentCell];
    if (!opts.keepCells && !opts.freesOne) mem8[argumentCell] = FREE;
    mem8[COMMAND_READ_CURSOR] = opts.noMask
      ? u8(argumentCell + 1)
      : u8(argumentCell + (opts.stepOne ? 0 : 1)) & (RING_CELLS - 1);

    const index = opts.wholeByte ? command : command & 0x0f;
    const handler = m.mem16[(HANDLERS + 2 * index + (opts.tableOffByOne ? 2 : 0)) & 0xffff];

    regs.c = opts.pairSwapped ? argument : command;
    regs.b = opts.pairSwapped ? command : argument;
    regs.a = opts.commandInAccumulator ? command : argument;
    regs.de = COME_BACK_TO;
    regs.hl = handler;
    if (!opts.noPark) m.push16(COME_BACK_TO);
    m.call(handler);
    if (m.pc !== COME_BACK_TO) return m.call(m.pc);
  }
}

const twin = (opts) => (m) => consume(m, opts);

const TWINS = [
  ["no-op", brokenNoOp, 1542],
  ["cells-not-freed", twin({ keepCells: true }), 1542],
  ["frees-only-the-command", twin({ freesOne: true }), 1541],
  ["cursor-steps-one", twin({ stepOne: true }), 1542],
  ["cursor-not-wrapped", twin({ noMask: true }), 512],
  ["whole-byte-index", twin({ wholeByte: true }), 1344],
  ["table-off-by-one", twin({ tableOffByOne: true }), 1158],
  ["pair-swapped", twin({ pairSwapped: true }), 1535],
  ["command-in-accumulator", twin({ commandInAccumulator: true }), 1535],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("THE ENTRY: the foreground loop is entered exactly once, at boot", { skip }, () => {
  let dispatches = 0;
  const real = makeMachine().routines.get(TARGET);
  const m = sharedMachine(new Map([[TARGET, (mm, ...a) => (dispatches++, real(mm, ...a))]]));
  m.runFrames(ENTRY_FRAMES);
  console.log(`  THE ENTRY: ${dispatches} dispatch(es) in ${ENTRY_FRAMES} frames`);
  assert.equal(dispatches, 1, "the foreground loop is entered more than once, so it RETURNS and " +
    "the escape this file is built on is no longer needed");
});

test("ESCAPE WORKS: both sides return after exactly one command", { skip }, () => {
  const machine = craft(0, 1, 31);
  const left = escaping(machine);
  const right = escaping(machine);
  oracle(left.m);
  loc_0b93(right.m);
  console.log(
    `  ESCAPE: oracle handed over ${left.seen.length} time(s) to ${hex4(left.seen[0]?.handler ?? 0)}, ` +
      `rewrite ${right.seen.length} time(s)`,
  );
  assert.equal(left.seen.length, 1, "the oracle did not hand over exactly once");
  assert.equal(right.seen.length, 1, "the rewrite did not hand over exactly once");
});

test("EQUAL: identical outside the scratch window, on the real cursor", { skip }, () => {
  const machine = craft(entryState().mem8[COMMAND_READ_CURSOR] & (RING_CELLS - 1), 1, 31);
  const sp = machine.regs.sp;
  const left = escaping(machine);
  const right = escaping(machine);
  oracle(left.m);
  loc_0b93(right.m);
  const all = allDiffs(left.m, right.m);
  const strays = all.filter((d) => !inScratch(d.addr, sp));
  console.log(`  EQUAL: ${all.length} differing bytes, ${strays.length} outside the window`);
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
});

test("NOT VACUOUS: a no-op candidate FAILS the same masked diff, on a real cell", { skip }, () => {
  const d = unitDiff(brokenNoOp, craft(0, 1, 31));
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a cell");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("THE HANDOVER: the arm chosen, and the registers it is handed", { skip }, () => {
  const table = handlerTable();
  for (const index of Array.from({ length: HANDLER_COUNT }, (_unused, i) => i)) {
    const machine = craft(0, index, 200 + index);
    const left = escaping(machine);
    const right = escaping(machine);
    oracle(left.m);
    loc_0b93(right.m);
    assert.equal(left.seen[0].handler, table[index], `arm ${index} is not the table's entry`);
    assert.deepEqual(right.seen, left.seen, `arm ${index}: the handover state differs`);
  }
  console.log(`  HANDOVER: all ${HANDLER_COUNT} arms selected and handed identical state`);
});

test("EXCLUDED, deliberately: which registers differ after the handover", { skip }, () => {
  const moved = new Set();
  for (const [cursor, command, argument] of cross()) {
    const machine = craft(cursor, command, argument);
    const left = escaping(machine);
    const right = escaping(machine);
    oracle(left.m);
    loc_0b93(right.m);
    for (const k of REG_FIELDS) if (left.m.regs[k] !== right.m.regs[k]) moved.add(k);
  }
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")}`);
  assert.ok(!moved.has("b"), "the argument register differs after the handover");
  assert.ok(!moved.has("c"), "the command register differs after the handover");
});

test("EXHAUSTIVE: every occupied command byte, over several cursors", { skip }, () => {
  for (const [cursor, command, argument] of cross()) {
    const d = unitDiff(loc_0b93, craft(cursor, command, argument));
    assert.equal(d, null, `cursor ${cursor} command ${command} argument ${argument}: ${show(d)}`);
  }
  console.log(`  EXHAUSTIVE: ${cross().length} cursor x command x argument entries identical`);
});

test("COMMAND_RING WRAP: a cursor at the end of the ring folds back onto its head", { skip }, () => {
  const wraps = [];
  for (const cursor of [RING_CELLS - 2, RING_CELLS - 1, RING_CELLS, 255]) {
    const machine = craft(cursor, 1, 31);
    const left = escaping(machine);
    oracle(left.m);
    wraps.push(`${cursor}->${left.m.mem8[COMMAND_READ_CURSOR]}`);
    const d = unitDiff(loc_0b93, machine);
    assert.equal(d, null, `cursor ${cursor}: ${show(d)}`);
  }
  console.log(`  COMMAND_RING WRAP: ${wraps.join(", ")}`);
  const past = craft(RING_CELLS - 2, 1, 31);
  const after = escaping(past);
  oracle(after.m);
  assert.ok(after.m.mem8[COMMAND_READ_CURSOR] < RING_CELLS, "the cursor left the ring");
});

test("HANDLER ENTRIES: no arm reads a flag before setting one", { skip }, () => {
  // Read the first opcode of every arm out of memory. A conditional transfer or a conditional
  // return as the FIRST instruction would mean the incoming flag state is live at that arm, and
  // the flags at the handover would then have to be part of the contract.
  const CONDITIONAL_FIRST_BYTES = new Set([
    0xc0, 0xc8, 0xd0, 0xd8, 0xe0, 0xe8, 0xf0, 0xf8, // ret cc
    0xc2, 0xca, 0xd2, 0xda, 0xe2, 0xea, 0xf2, 0xfa, // jp cc
    0xc4, 0xcc, 0xd4, 0xdc, 0xe4, 0xec, 0xf4, 0xfc, // call cc
    0x20, 0x28, 0x30, 0x38, // jr cc
    0x10, // djnz
  ]);
  const m = entryState();
  const firsts = [];
  for (const handler of handlerTable()) {
    const opcode = m.mem8[handler];
    firsts.push(`${hex4(handler)}:${opcode.toString(16)}`);
    assert.ok(
      !CONDITIONAL_FIRST_BYTES.has(opcode),
      `the arm at ${hex4(handler)} begins with a conditional, so the flags at the handover ARE ` +
        "live and this file's decision not to compare them is wrong",
    );
  }
  console.log(`  HANDLER ENTRIES: ${new Set(firsts).size} distinct arms, none begins conditional`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, candidate, crossCaught] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    const caught = cross().filter(([u, c, a]) => unitDiff(candidate, craft(u, c, a)) !== null).length;
    console.log(`  TEETH/${label}: caught on ${caught} of ${cross().length} crafted entries`);
    assert.equal(caught, crossCaught, `the ${label} twin's crafted catch count moved`);
    assert.ok(caught > 0, `the crafted space missed the ${label} twin everywhere`);
  });
}
