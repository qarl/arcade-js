// SPDX-License-Identifier: GPL-3.0-only
//
// Does the repo still keep the promise README makes to a stranger? Quickstart says to run
// `npm test` and that ROM-dependent tests "skip cleanly if you haven't built one" -- the only path
// an outside reader ever takes, since nobody outside owns the ROMs.
//
// EMPIRICAL by necessity: two guard idioms are live, and the shadow idiom (dkong, thepit, and
// timeplt's idiomatic.test.js) wraps `test` conditionally, so its calls read as unguarded while
// being guarded -- a `romsPresent` grep condemns every healthy dkong test file. A third idiom
// invented later would break a static check silently.
//
// ROM images are gitignored, so a `git clone` has none BY CONSTRUCTION -- a stranger's clone, not a
// simulation of one, `.git` included. An earlier version used `git checkout-index` and
// registry-coverage failed there only because an export is not a repository: a false positive
// manufactured by the apparatus.
//
// Rationale and worked examples: docs/reviewer-rules.md, R26.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Reclaim clones a previous run could not delete -- killed by a signal, or the machine went down.
// An 84 MB clone per abandoned run is what made this worth handling at all. Age-gated so a
// concurrent run's directory is never removed: a run lasts seconds, so anything an hour old is dead.
export function sweepStale(older = 3600_000, now = Date.now()) {
  let swept = 0;
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith("romguard-")) continue;
    const p = join(tmpdir(), name);
    try {
      if (now - statSync(p).mtimeMs < older) continue;
      rmSync(p, { recursive: true, force: true });
      swept += 1;
    } catch {
      // vanished, or not ours to delete -- either way the next run will try again
    }
  }
  return swept;
}

export function cloneWithoutRoms(repo = process.cwd()) {
  const base = mkdtempSync(join(tmpdir(), "romguard-"));
  const dir = join(base, "clone");
  try {
    execFileSync("git", ["clone", "--no-hardlinks", "--quiet", repo, dir]);
  } catch (e) {
    rmSync(base, { recursive: true, force: true });
    throw e;
  }
  return dir;
}

// node's default 1 MiB stdout cap is not headroom: the no-ROM suite prints ~0.9 MiB and each
// failing test adds ~2 KB, so it overflows exactly as the defect this gate exists to catch grows --
// spawnSync SIGTERMs the child, stdout truncates, and the summary vanishes. It fails closed, never
// a false PASS, but it loses its diagnosis at the moment the diagnosis matters.
const MAX_OUTPUT = 64 * 1024 * 1024;

// ⚠ hooks/pre-push's GUARD_TIMEOUT must stay strictly BELOW the 900s bound here, or a clone hang
// exits 1 rather than 124 and the hook misreports it as "RED for a stranger". Full note is there.
export function runSuite(dir) {
  const r = spawnSync("npm", ["test"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 900_000,
    maxBuffer: MAX_OUTPUT,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const num = (k) => {
    const m = out.match(new RegExp(`^ℹ ${k} (\\d+)$`, "m"));
    return m ? Number(m[1]) : null;
  };
  const files = [
    ...new Set(
      (out.split("failing tests:")[1] ?? "").match(
        /(?:core|boards|games|tools|web)\/[A-Za-z0-9_./-]*\.test\.js/g,
      ) ?? [],
    ),
  ];
  return {
    fail: num("fail"),
    pass: num("pass"),
    skipped: num("skipped"),
    files,
    out,
    error: r.error ?? null,
  };
}

// A suite that ran NOTHING also prints `fail 0` and exits 0 -- `node --test` on a glob matching no
// file does exactly that. So "no failures" is evidence only if something ran AND the ROM-dependent
// tests skipped. Both floors are facts about a no-ROM clone of THIS repo (9624 tests, 8801 skipped
// on 2026-08-08); set far below those, they guard nothing-ran without asserting the suite's size.
const MIN_TESTS = 1000;

// Skipping is the intended outcome and passing is fine; only failure is a defect. A null count means
// no summary was printed -- the suite died before reporting, which must never read as a pass.
export function verdict(r) {
  // A runner that never spoke is a different fault from a suite that died; check it FIRST, since an
  // ENOBUFS kill also leaves no summary and the death message would otherwise swallow it.
  if (r.error) return { ok: false, why: `the runner failed: ${r.error.code ?? r.error.message}` };
  if (r.fail === null) return { ok: false, why: "no test summary -- the suite died before reporting" };
  if (r.fail > 0) {
    return { ok: false, why: `${r.fail} test(s) FAIL in a clone with no ROMs`, files: r.files };
  }
  const total = (r.pass ?? 0) + (r.skipped ?? 0) + r.fail;
  if (total < MIN_TESTS) {
    return { ok: false, why: `only ${total} test(s) ran -- too few to mean anything; the run is vacuous` };
  }
  if (!r.skipped) {
    return { ok: false, why: "nothing SKIPPED in a clone with no ROMs -- the ROM-dependent tests did not run" };
  }
  return { ok: true, why: `clean: ${r.skipped} skipped, ${r.pass} passed without needing a ROM` };
}

// pathToFileURL, not `file://${path}`: import.meta.url percent-encodes, so on a checkout whose path
// contains a space the comparison fails, this block never runs, and the tool exits 0 having done
// NOTHING -- which the hook prints as "push allowed". argv[1] is undefined under `node -e`, which is
// how these exports get tested, so without that guard importing the module throws.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  sweepStale();
  const dir = cloneWithoutRoms();
  let ok = false;
  // process.exit() does NOT unwind the stack, so a `finally` around it never runs. Exiting from
  // inside the try leaked an 84 MB clone on EVERY push with the cleanup sitting right there, present
  // and dead -- which is why reading found nothing. Set the code; let the process end on its own.
  // A signal does not unwind either, and the hook runs this under `timeout` -- but a JS signal
  // handler CANNOT help: it only runs when the event loop turns, and `spawnSync` blocks the loop for
  // the entire run. Measured: with a SIGTERM handler registered, a signal sent mid-spawnSync neither
  // fires the handler nor kills the process -- registering it merely SUPPRESSES the default kill, so
  // the tool becomes unkillable for 13s. Abrupt death is therefore reclaimed by `sweepStale` at the
  // next start, which is also the only thing that can cover SIGKILL.
  const cleanup = () => rmSync(join(dir, ".."), { recursive: true, force: true });
  try {
    const v = verdict(runSuite(dir));
    ok = v.ok;
    console.log(`[rom-guard] ${v.ok ? "OK" : "FAIL"} -- ${v.why}`);
    for (const f of v.files ?? []) console.log(`  ${f}`);
    if (!v.ok) {
      console.log("\nEvery test in an equivalence gate must be skippable when the ROMs are absent.");
      console.log("Copy the idiom a sibling gate already uses; do not invent a third one.");
    }
  } finally {
    cleanup();
  }
  process.exitCode = ok ? 0 : 1;
}
