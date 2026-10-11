// SPDX-License-Identifier: GPL-3.0-only
/**
 * runCommandRingDrainLoop — memory-equivalent to the frozen oracle at ROM 0x0B93.
 *
 * WHAT IT IS. The foreground loop. It consumes the command ring forever: read cursor, occupancy
 * test, take two bytes, free both cells, step and wrap the cursor, and run the handler the low
 * nibble selects out of a sixteen-entry address table fixed in the image. The frozen side reads the
 * table and jumps through it with a return slot parked on the stack; the rewrite switches on the
 * nibble and calls each slot's handler directly, handing it the argument byte.
 *
 * ★ NEITHER SIDE RETURNS, so each is stopped after exactly ONE command, each by its own hand:
 *   - the frozen side's jump through the table lands on a recorder, in one clone's own registry,
 *     that runs the REAL frozen handler and then points the program counter at a no-op address the
 *     loop does not own; the loop treats that as "the arm went somewhere else", hands over to it and
 *     returns — through its own code;
 *   - the rewrite runs the REAL rewritten handler (a direct import the registry cannot see) and loops;
 *     _spineSever.js stops it at its SECOND look at the read cursor, from inside the loop's own frame,
 *     before that look reads anything — i.e. after exactly one pass.
 *   Both sides therefore run the whole consume-and-dispatch path AND the handler, and are compared on
 *   everything that leaves behind. That is a stronger comparison than a stubbed handover: which
 *   handler ran, and with what, shows as the handler's own writes.
 *
 * ★ NO REGISTER IS HANDED TO A HANDLER. The frozen side seats the command, the argument (twice) and
 *   the table words in registers before its jump; the rewrite passes the argument as a parameter and
 *   seats nothing. What the handlers really read is measured, not assumed: EXHAUSTIVE runs every
 *   handler on both sides and compares what they write, and the pair-swapped twin (command and
 *   argument exchanged in the two registers only the frozen side seats, the accumulator left right)
 *   is caught NOWHERE — the recorded proof that no handler reads either register.
 *
 * ★ THE SWITCH IS THE TABLE. The table never changes while the game runs, so each case is the handler
 *   its slot names. SLOTS reads all sixteen words out of the image and checks the cases against them
 *   by behaviour: every slot the registry transcribes gives identical results on both sides, and
 *   every slot it does not is refused by both.
 *
 * ★ THE STACK WINDOW IS EXCLUDED — the manifest's measured window, not a number typed here. The
 *   frozen side parks return slots there that the rewrite never pushes, and its handlers push their
 *   own scratch.
 *
 * GATE: crafted-entry, one command per run, over the ring's whole command space. Holes stated:
 *
 *   1. THE ENTRY — captured at the one real dispatch, which happens once per session at boot.
 *   2. ONE COMMAND — both sides stop after exactly one command.
 *   3. EQUAL — identical outside the stack window on the real cursor.
 *   4. NOT VACUOUS — a no-op FAILS the same masked diff on a real cell.
 *   5. SLOTS — all sixteen table words against the switch.
 *   6. EXHAUSTIVE — all 128 occupied command bytes against several cursors and arguments.
 *   7. COMMAND_RING WRAP — cursors that take the step past the end of the ring.
 *   8. IDLE — an empty ring: the rewrite yields having written nothing.
 *   9. TEETH — nine twins, each with an exact catch count over the crafted space.
 *
 * HOLE: the frozen idle spin cannot be run to a stop, so the IDLE arm is one-sided.
 * HOLE: there is no whole-run arm and no session corpus beyond the single boot dispatch; the handlers
 *   run from that one boot state, so a handler's play-state paths are its own gate's business.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0b93.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { runCommandRingDrainLoop } from "../runCommandRingDrainLoop.js";
import { loc_0b93 as oracle } from "../../translated/loc_0b93.js";
import { buildRoutines } from "../../routines.js";
import manifest from "../../manifest.js";
import { NotImplemented } from "../../../../boards/timeplt/io.js";
import { COMMAND_READ_CURSOR, COMMAND_RING, ROUTINES } from "../names.js";
import { Severed, severAtDirectCall } from "./_spineSever.js";

const TARGET = 0x0b93;
const LOOP_NAME = "runCommandRingDrainLoop";

const RING_CELLS = 64;
const FREE = 255;
const HANDLERS = 0x0bbc;
const HANDLER_COUNT = 16;
const COME_BACK_TO = 0x0b90;
const TABLE_READ = 0x018c;

const ESCAPE = 0xffff;

const [STACK_LO, STACK_HI] = manifest.convergence.stateExclude.stack;

const skip = romsPresent() ? false : "ROM images are not assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${d.addr === null ? "-" : hex4(d.addr)}: oracle=${d.a} candidate=${d.b}` : "identical");
const u8 = (x) => x & 0xff;
const everyByte = Array.from({ length: 256 }, (_unused, v) => v);
const inStack = (addr) => addr >= STACK_LO && addr < STACK_HI;

// ── the entry ───────────────────────────────────────────────────────────────────────────

let entry = null;
function entryState() {
  if (entry !== null) return entry;
  const real = makeMachine().routines.get(TARGET);
  const m = makeMachine(
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

// ── one command per run ─────────────────────────────────────────────────────────────────

/**
 * A clone prepared so that EITHER side stops after one command. The frozen side: the first jump
 * through the table runs the real frozen handler and then escapes (a handler calling another table
 * word from inside itself reaches the real one). The rewrite: severed at its second look at the cursor.
 */
function oneCommand(machine) {
  const m = machine.clone();
  const real = buildRoutines();
  const table = new Set(handlerTable());
  const ran = [];
  let inHandler = false;
  const noop = () => {};
  m.routines = {
    get: (addr) => {
      if (addr === ESCAPE) return noop;
      if (inHandler || !table.has(addr)) return real.get(addr);
      return (mm) => {
        ran.push(addr);
        const body = real.get(addr);
        if (body === undefined) {
          throw new NotImplemented(`no routine registered at ${hex4(addr)}`);
        }
        inHandler = true;
        try {
          body(mm);
        } finally {
          inHandler = false;
        }
        mm.pc = ESCAPE;
      };
    },
  };
  const cut = { passes: 0 };
  severAtDirectCall(m, LOOP_NAME, { reads: [COMMAND_READ_CURSOR], after: 1 }, () => {
    cut.passes++;
  });
  return { m, ran, cut };
}

function drive(fn, m) {
  const r = fn(m);
  if (!r || typeof r.next !== "function") return r;
  for (let i = 0; i < 4; i++) if (r.next().done) return undefined;
  throw new Error("the rewrite yielded again and again without looking at its cursor twice");
}

/**
 * Run one side; returns the machine and how it ended: "stopped" after its one command, "refused" on
 * a slot that names no transcribed handler, or the fault a handler raised. A crafted argument can
 * send a handler's pointers into the image, where the board faults the write; the fault is compared
 * by kind and address (the frozen side's message also carries its program counter, which the rewrite
 * does not keep), and the memory written up to it is compared as for any other run.
 */
function runSide(fn, machine) {
  const side = oneCommand(machine);
  let outcome = "stopped";
  try {
    drive(fn, side.m);
  } catch (e) {
    if (e instanceof Severed) outcome = "stopped";
    else if (e instanceof NotImplemented) outcome = "refused";
    else outcome = `${e.name}: ${String(e.message).replace(/ \(pc=0x[0-9a-f]+\)$/, "")}`.slice(0, 80);
  }
  delete side.m.mem.read8;
  delete side.m.mem.write8;
  return { ...side, outcome };
}

/** A real captured machine with one command waiting at the read cursor. */
function craft(cursor, command, argument) {
  const m = entryState().clone();
  m.mem8[COMMAND_READ_CURSOR] = cursor;
  m.mem8[COMMAND_RING + cursor] = command;
  m.mem8[(COMMAND_RING + cursor + 1) & 0xffff] = argument;
  return m;
}

function strayDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (!inStack(addr)) out.push({ addr, a: da[i], b: db[i] });
  }
  return out;
}

const deviceSignature = (c) =>
  `${[...c.io.latch].join(",")}|wd=${c.io.watchdogKicks}|snd=${c.io.soundData}` +
  `|ur=${c.mem.unmappedReads}|uw=${c.mem.unmappedWrites}`;

/** Both sides once on the same crafted state: how they ended, RAM outside the stack, the devices. */
function unitDiff(candidate, machine) {
  const left = runSide(oracle, machine);
  const right = runSide(candidate, machine);
  if (left.outcome !== right.outcome) return { addr: null, a: left.outcome, b: right.outcome };
  const ram = strayDiffs(left.m, right.m)[0];
  if (ram) return ram;
  if (deviceSignature(left.m) !== deviceSignature(right.m)) {
    return { addr: null, a: deviceSignature(left.m), b: deviceSignature(right.m) };
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

const TWIN_PASS_LIMIT = 2;

/** A frozen-shaped consumer with one field flipped, dispatching through the table like the oracle. */
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
    m.push16(COME_BACK_TO);
    m.call(handler);
    if (m.pc !== COME_BACK_TO) return m.call(m.pc);
  }
}

const twin = (opts) => (m) => consume(m, opts);

/**
 * Exact catch counts, measured on effects: a twin is caught where it leaves different memory, devices
 * or ending — so a slip that lands on a refused slot on both sides with the same consumed cells, or a
 * handler that ignores its argument, is (rightly) not a catch.
 */
const TWINS = [
  ["no-op", brokenNoOp, 1542],
  ["cells-not-freed", twin({ keepCells: true }), 1542],
  ["frees-only-the-command", twin({ freesOne: true }), 1541],
  ["cursor-steps-one", twin({ stepOne: true }), 1542],
  ["cursor-not-wrapped", twin({ noMask: true }), 512],
  ["whole-byte-index", twin({ wholeByte: true }), 1344],
  ["table-off-by-one", twin({ tableOffByOne: true }), 972],
  ["pair-swapped", twin({ pairSwapped: true }), 0],
  ["command-in-accumulator", twin({ commandInAccumulator: true }), 655],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("THE ENTRY: the foreground loop is entered exactly once, at boot", { skip }, () => {
  let dispatches = 0;
  const real = makeMachine().routines.get(TARGET);
  const m = makeMachine(new Map([[TARGET, (mm, ...a) => (dispatches++, real(mm, ...a))]]));
  m.runFrames(ENTRY_FRAMES);
  console.log(`  THE ENTRY: ${dispatches} dispatch(es) in ${ENTRY_FRAMES} frames`);
  assert.equal(dispatches, 1, "the foreground loop is entered more than once, so it RETURNS and " +
    "the one-command stop this file is built on is no longer needed");
});

test("ONE COMMAND: both sides stop after exactly one command", { skip }, () => {
  const machine = craft(0, 1, 31);
  const left = runSide(oracle, machine);
  const right = runSide(runCommandRingDrainLoop, machine);
  console.log(`  ONE COMMAND: oracle ran ${left.ran.map(hex4).join(",")} and ${left.outcome}; ` +
    `rewrite ${right.outcome} after ${right.cut.passes} cut`);
  assert.deepEqual(left.ran, [handlerTable()[1]], "the oracle did not run exactly the slot-1 handler");
  assert.equal(left.outcome, "stopped", "the oracle did not escape after its handler");
  assert.equal(right.cut.passes, 1, "the rewrite was not stopped at its second look at the cursor");
  assert.equal(right.ran.length, 0, "the rewrite went through the registry, which it must not need");
  assert.equal(right.m.mem8[COMMAND_RING], FREE, "the rewrite did not consume the command");
});

test("EQUAL: identical outside the stack window, on the real cursor", { skip }, () => {
  const machine = craft(entryState().mem8[COMMAND_READ_CURSOR] & (RING_CELLS - 1), 1, 31);
  const left = runSide(oracle, machine);
  const right = runSide(runCommandRingDrainLoop, machine);
  const strays = strayDiffs(left.m, right.m);
  const moved = strayDiffs(machine, right.m).length;
  console.log(`  EQUAL: the command moved ${moved} bytes, ${strays.length} of them differ outside the window`);
  assert.ok(moved > 2, "the command wrote nothing beyond its two cells, so the handler never ran");
  assert.deepEqual(strays, [], `a divergence escaped the stack window: ${show(strays[0])}`);
  assert.equal(deviceSignature(right.m), deviceSignature(left.m), "the devices differ");
});

test("NOT VACUOUS: a no-op candidate FAILS the same masked diff, on a real cell", { skip }, () => {
  const d = unitDiff(brokenNoOp, craft(0, 1, 31));
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a cell");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("SLOTS: the switch runs exactly the handler each table word names, and refuses the rest", { skip }, () => {
  const table = handlerTable();
  const transcribed = [];
  for (let slot = 0; slot < HANDLER_COUNT; slot++) {
    const word = table[slot];
    const named = ROUTINES[word] !== undefined;
    for (const argument of ARGUMENTS) {
      const machine = craft(0, slot, argument);
      const left = runSide(oracle, machine);
      const right = runSide(runCommandRingDrainLoop, machine);
      if (named) {
        assert.notEqual(right.outcome, "refused", `slot ${slot} (${hex4(word)}) is transcribed and must run`);
      } else {
        assert.equal(right.outcome, "refused", `slot ${slot} (${hex4(word)}) is not transcribed and must be refused`);
      }
      assert.equal(left.outcome, right.outcome, `slot ${slot}: the two sides ended differently`);
      assert.equal(show(unitDiff(runCommandRingDrainLoop, machine)), "identical", `slot ${slot} argument ${argument}`);
    }
    if (named) transcribed.push(`${slot}:${ROUTINES[word].name}`);
  }
  console.log(`  SLOTS: ${transcribed.length} transcribed — ${transcribed.join(", ")}`);
  assert.ok(transcribed.length > 0, "no slot names a transcribed handler, so the arm compared refusals only");
});

test("EXHAUSTIVE: every occupied command byte, over several cursors", { skip }, () => {
  const endings = new Map();
  for (const [cursor, command, argument] of cross()) {
    const machine = craft(cursor, command, argument);
    const d = unitDiff(runCommandRingDrainLoop, machine);
    assert.equal(d, null, `cursor ${cursor} command ${command} argument ${argument}: ${show(d)}`);
    const how = runSide(oracle, machine).outcome;
    const kind = how === "stopped" || how === "refused" ? how : "faulted";
    endings.set(kind, (endings.get(kind) ?? 0) + 1);
  }
  console.log(`  EXHAUSTIVE: ${cross().length} cursor x command x argument entries identical — ` +
    [...endings].map(([k, n]) => `${n} ${k}`).join(", "));
  assert.ok((endings.get("stopped") ?? 0) > 0, "no crafted command ran a handler to the end");
});

test("COMMAND_RING WRAP: a cursor at the end of the ring folds back onto its head", { skip }, () => {
  const wraps = [];
  for (const cursor of [RING_CELLS - 2, RING_CELLS - 1, RING_CELLS, 255]) {
    const machine = craft(cursor, 1, 31);
    const left = runSide(oracle, machine);
    wraps.push(`${cursor}->${left.m.mem8[COMMAND_READ_CURSOR]}`);
    const d = unitDiff(runCommandRingDrainLoop, machine);
    assert.equal(d, null, `cursor ${cursor}: ${show(d)}`);
  }
  console.log(`  COMMAND_RING WRAP: ${wraps.join(", ")}`);
  const after = runSide(runCommandRingDrainLoop, craft(RING_CELLS - 2, 1, 31));
  assert.ok(after.m.mem8[COMMAND_READ_CURSOR] < RING_CELLS, "the cursor left the ring");
});

test("IDLE: on an empty ring the rewrite yields having written nothing", { skip }, () => {
  const machine = entryState().clone();
  const cell = (COMMAND_RING + machine.mem8[COMMAND_READ_CURSOR]) & 0xffff;
  assert.ok(machine.mem8[cell] & 0x80, "the captured ring is not empty at its cursor");
  const before = machine.dumpState();
  const it = runCommandRingDrainLoop(machine);
  const first = it.next();
  assert.equal(first.done, false, "the rewrite did not yield on an empty ring");
  const after = machine.dumpState();
  let moved = 0;
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) moved++;
  assert.equal(moved, 0, "the idle pass wrote memory");
  // Control: a waiting command does move memory before the next yield.
  const busy = craft(machine.mem8[COMMAND_READ_CURSOR], 1, 31);
  const b0 = busy.dumpState();
  runCommandRingDrainLoop(busy).next();
  const b1 = busy.dumpState();
  let busyMoved = 0;
  for (let i = 0; i < b0.length; i++) if (b0[i] !== b1[i]) busyMoved++;
  assert.ok(busyMoved > 0, "a waiting command moved nothing either, so the idle reading is blind");
  console.log(`  IDLE: nothing written on the empty ring; a waiting command moved ${busyMoved} bytes`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, candidate, crossCaught] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    const caught = cross().filter(([u, c, a]) => unitDiff(candidate, craft(u, c, a)) !== null).length;
    console.log(`  TEETH/${label}: caught on ${caught} of ${cross().length} crafted entries`);
    assert.equal(caught, crossCaught, `the ${label} twin's crafted catch count moved`);
    if (label === "pair-swapped") return; // the recorded proof that no handler reads B or C
    assert.ok(caught > 0, `the crafted space missed the ${label} twin everywhere`);
  });
}
