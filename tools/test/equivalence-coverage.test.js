// SPDX-License-Identifier: GPL-3.0-only
//
// Every idiomatic ROUTINES entry has games/<game>/idiomatic/test/equivalence-<addr>.test.js, a
// sibling gate that declares it (`// also gates: 0x<addr> <export>`), or a reasoned line in
// tools/equivalence-debt.txt. A declaration counts only if that gate's code (comments and strings
// stripped) calls the export and uses the oracle's imported binding (or 0x<addr> when none is
// imported). A listed entry whose gate now exists fails, so
// the ledger only shrinks. Static only: it needs no ROM, and it does not say the gate passes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

const DECL = /^\/\/ also gates: 0x([0-9a-f]{4}) (\w+)$/gm;
// One left-to-right pass, so a `//` or `/*` inside a string is not a comment and a string's text is not code.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g,
  (t) => (t[0] === "/" ? "" : '""'));
const IMPORT = /^import\b[^;]*;/gm;

// files: [{ name, text }] of one game's equivalence gates. Returns the addresses validly declared.
export function declarationProblems(game, routines, files) {
  const covered = new Set(), problems = [];
  const own = new Set(files.map((f) => /^equivalence-([0-9a-f]{4})\.test\.js$/.exec(f.name)?.[1]).filter(Boolean));
  for (const { name, text } of files) {
    const imports = (stripComments(text).match(IMPORT) ?? []).join("\n");
    const code = stripComments(text).replace(IMPORT, "");
    for (const [, a, ex] of text.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(DECL)) {
      const r = routines[Number.parseInt(a, 16)];
      const where = `${game} ${name} declares 0x${a}`;
      if (!r) { problems.push(`${where}: no ROUTINES entry`); continue; }
      if ((r.entry ?? r.name) !== ex) { problems.push(`${where} ${ex}: the entry's export is ${r.entry ?? r.name}`); continue; }
      if (own.has(a)) { problems.push(`${where}: equivalence-${a}.test.js exists, drop the declaration`); continue; }
      if (!new RegExp(`\\b${ex}\\s*\\(`).test(code)) { problems.push(`${where}: its code never calls ${ex}`); continue; }
      const alias = new RegExp(`\\bloc_${a}(?:\\s+as\\s+(\\w+))?\\b`).exec(imports);
      const oracle = alias ? new RegExp(`\\b${alias[1] ?? `loc_${a}`}\\b`) : new RegExp(`\\b0x${a}\\b`, "i");
      if (!oracle.test(code)) { problems.push(`${where}: its code never uses the oracle loc_${a}`); continue; }
      covered.add(a);
    }
  }
  return { covered, problems };
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
    const tdir = join(GAMES, g, "idiomatic", "test");
    const files = existsSync(tdir) ? readdirSync(tdir).filter((f) => /^equivalence-.*\.test\.js$/.test(f))
      .map((name) => ({ name, text: readFileSync(join(tdir, name), "utf8") })) : [];
    const { covered, problems: dp } = declarationProblems(g, ROUTINES, files);
    problems.push(...dp);
    const hasGate = (a) => covered.has(a) || existsSync(join(tdir, `equivalence-${a}.test.js`));
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

test("teeth: a declaration counts only when the gate's code names the export and its oracle", () => {
  const routines = { 0x10: { name: "m" }, 0x20: { name: "m", entry: "second" } };
  const decl = "// also gates: 0x0020 second\n";
  const check = (text, name = "equivalence-0010.test.js") => declarationProblems("g", routines, [{ name, text }]);
  assert.deepEqual([...check(decl + "import { loc_0020 as oracle20 } from 'x';\noracle20(o); second(c);").covered], ["0020"]);
  assert.match(check(decl + "// second loc_0020\nfirst(c);").problems.join(), /never calls second/);
  assert.match(check(decl + "second(c);").problems.join(), /never uses the oracle/);
  assert.match(check(decl + "import { loc_0020 as o20 } from 'x';\nimport { second } from 'y';\nfirst(c);").problems.join(), /never calls second/);
  assert.match(check(decl + "import { loc_0020 as o20 } from 'x';\nsecond(c); t(\"o20 // 0x0020\");").problems.join(), /never uses the oracle/);
  assert.equal(check("/*\n" + decl + "*/\nsecond(c); loc_0020;").covered.size, 0);
  assert.match(check("// also gates: 0x0020 wrong\nsecond(c); loc_0020;").problems.join(), /export is second/);
  assert.match(check("// also gates: 0x0030 second\n").problems.join(), /no ROUTINES entry/);
  const both = declarationProblems("g", routines, [{ name: "equivalence-0010.test.js", text: decl + "second(c); loc_0020;" }, { name: "equivalence-0020.test.js", text: "" }]);
  assert.match(both.problems.join(), /exists, drop the declaration/);
});
