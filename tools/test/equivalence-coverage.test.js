// SPDX-License-Identifier: GPL-3.0-only
//
// Every idiomatic ROUTINES entry has games/<game>/idiomatic/test/equivalence-<addr>.test.js, or a
// reasoned line in tools/equivalence-debt.txt. A listed entry whose gate now exists fails too, so
// the ledger only shrinks. File presence only: it needs no ROM, and it does not say the gate passes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { gamesWithIdiomaticLayer } from "../no-stale-mcall.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GAMES = join(ROOT, "games");
const LEDGER = join(ROOT, "tools", "equivalence-debt.txt");

const hex = (k) => Number(k).toString(16).padStart(4, "0");

function readLedger(text) {
  const debt = new Map();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(\S+)\s+0x([0-9a-f]{4})\s+(\S.*)$/.exec(line);
    assert.ok(m, `malformed ledger line (want "<game> 0x<addr>  <reason>"): ${line}`);
    const key = `${m[1]} ${m[2]}`;
    assert.ok(!debt.has(key), `duplicate ledger line: ${key}`);
    debt.set(key, m[3]);
  }
  return debt;
}

export function coverageProblems(game, routines, hasGate, debt) {
  const problems = [];
  const keys = new Set(Object.keys(routines).map(hex));
  for (const a of keys) {
    const listed = debt.has(`${game} ${a}`);
    if (!hasGate(a) && !listed) problems.push(`${game} 0x${a} ${routines[Number.parseInt(a, 16)].name}: no equivalence-${a}.test.js and no debt line`);
    if (hasGate(a) && listed) problems.push(`${game} 0x${a}: gate exists, delete its debt line`);
  }
  for (const key of debt.keys()) {
    const [g, a] = key.split(" ");
    if (g === game && !keys.has(a)) problems.push(`${key}: debt line names no ROUTINES entry`);
  }
  return problems;
}

test("every ROUTINES entry has an equivalence gate or a debt line", async () => {
  const debt = readLedger(readFileSync(LEDGER, "utf8"));
  const games = gamesWithIdiomaticLayer(GAMES);
  assert.ok(games.length > 0, "no game has an idiomatic layer, so this measured nothing");
  const problems = [];
  let entries = 0;
  for (const g of games) {
    const names = join(GAMES, g, "idiomatic", "names.js");
    if (!existsSync(names)) continue;
    const { ROUTINES = {} } = await import(pathToFileURL(names));
    entries += Object.keys(ROUTINES).length;
    const hasGate = (a) => existsSync(join(GAMES, g, "idiomatic", "test", `equivalence-${a}.test.js`));
    problems.push(...coverageProblems(g, ROUTINES, hasGate, debt));
  }
  for (const key of debt.keys()) {
    if (!games.includes(key.split(" ")[0])) problems.push(`${key}: debt line names no game`);
  }
  assert.ok(entries > 0, "no ROUTINES entries were read");
  assert.deepEqual(problems, []);
});

test("teeth: an ungated entry, a stale line and an orphan line are each caught", () => {
  const routines = { 0x10: { name: "a" }, 0x20: { name: "b" } };
  const gated = new Set(["0010"]);
  const hasGate = (a) => gated.has(a);
  assert.match(coverageProblems("g", routines, hasGate, new Map()).join(), /0x0020 b: no equivalence/);
  assert.deepEqual(coverageProblems("g", routines, hasGate, new Map([["g 0020", "r"]])), []);
  assert.match(coverageProblems("g", routines, hasGate, new Map([["g 0020", "r"], ["g 0010", "r"]])).join(), /0x0010: gate exists/);
  assert.match(coverageProblems("g", routines, hasGate, new Map([["g 0020", "r"], ["g 0030", "r"]])).join(), /g 0030: debt line names no ROUTINES/);
  assert.throws(() => readLedger("g 0x0020\n"), /malformed/);
});
