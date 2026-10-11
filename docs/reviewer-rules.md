# Reviewer rules — process-compliance checklist

Hand this to EVERY commit's review agent, in addition to its correctness review. The reviewer
already checks correctness; these are the PROCESS rules that drift when only the lead watches
them. Check each against the STAGED diff (`git diff --cached`), `git log`, and the repo. Any
violation → WITHHOLD the review token and report `Rxx` + the exact file/line/evidence. Each rule
names how to verify it so the check is mechanical, not a matter of opinion.

Enforcement lives HERE — in the rules an independent review agent checks — not in bespoke gate
scripts. A gate can only test a proxy; the review agent can judge the actual requirement. (The
always-on git hooks are `review_gate` / `names_consistency` / `understanding_gate` /
`comment_gate`; do not add more — express a new requirement as a rule below. The last of those
is the one exception, and it carries TWO rules that are exceptions for the same reason: its
REFERENCE test is not a proxy for R21, it IS R21; and its DENSITY test counts lines, which is
the whole of the rule rather than a stand-in for it. Neither asks whether a comment is true —
that stays here, with you.)

First, classify this commit from its subject line:
  DECOMPILE  = "decompile batch N"      UNDERSTANDING = "understanding pass N"
  INFRA/DOC/FIX = anything else
Rules tagged [D]/[U]/[ALL] apply to that class.

## Cadence — the drift this list exists to stop
- **R1 [D]** Never two decompile-batch commits in a row without an understanding pass between
  (one commit per batch, per the runbook).
  Verify: read `git log --format=%s` from newest; walking back from HEAD, an "understanding pass"
  commit must appear before you reach a second "decompile batch" (i.e. this decompile batch is not
  the second in a row with no understanding pass between them).

## Understanding passes must not be hollowed out (kept the cheap half, dropped grounding)
- **R2 [U]** Grounding is part of understanding, so the pass must DO grounding. But grounding is an
  ACTIVITY (run the real ROM under MAME, try to observe the candidate cells, record what was seen) —
  NOT an output count. An honest grounding run can lift ZERO cells to `[seen]` (a cell may not be
  observable in any reachable state). So do NOT require new `[seen]` lines; requiring them would
  reject a valid pass or pressure a fake/mislabel. Instead require EVIDENCE the grounding ran and was
  recorded honestly: a grounding report / run-log for this pass (e.g. `scratchpad/pass<N>-grounding.md`
  or a `grounding-results.md` entry) showing a real MAME run + per-cell verdicts — each candidate cell
  either LIFTED to `[seen]` (with the observed bytes) or kept `[code]`/marked debt WITH the specific
  reason it couldn't be observed. A pass that grounded and lifted nothing is VALID when the report
  documents why. FAIL only when there is no grounding activity at all — no report, no run. That, not
  a low lift-count, is the hollowing-out.
  Verify: locate this pass's grounding report; confirm it cites a real MAME command + observed bytes
  (not the JS engine, R3), covers the cells the pass touched, and gives a reason for every cell it
  says it could not ground.
- **R3 [ALL]** Every `[seen]` tag added/changed is backed by a REAL-ROM MAME observation, never the JS
  engine (that would be circular). Verify: the adjacent note cites a MAME/attract run.
  - **R3a — a NUMBER is `[seen]` only if its evidence chain TERMINATES in a MAME observation.**
    Our engine may be IN the chain: a pixel diff runs our renderer against a MAME golden and stays
    `[seen]`, because the reference side is the real machine. What is forbidden is a chain that
    terminates in our OWN output — a `Machine`/`runFrames` dispatch count, an override-map replay,
    or an idiomatic-vs-oracle equality (`idiomatic.test.js` compares the generator idiomatic layer against the translated oracle). Those are
    sound facts about the PORT, and they are `[code]`.
    Verify: for every `[seen]` whose evidence is a number, follow the chain to its far end and ask
    what produced the REFERENCE. Do not classify by which tool ran — `prize_suite.py` emits both
    kinds from one script (its pixel diff is against a MAME golden and is `[seen]`; its pickup
    assertion is read out of our own state dump and is `[code]`).
    **Burden of proof: a `[seen]` number whose MAME artifact you cannot open right now is `[code]`.**
    That is the same posture as R18 check 2, and it is what makes the check workable at review time
    given the evidence is ephemeral by design.

- **R18 [U]** An understanding/naming pass must state HOW MANY routines remain unnamed
  and WHY — and "why" must rest on a REACHABILITY MEASUREMENT, not on an impression. Before a pass
  reports any routine as blocked, held, or hard, the backlog must have been swept: a read tap at
  each unnamed entry address on the real ROM under MAME, driven across boards/levels/difficulty,
  with hit counts attributed to the live game state (see idiomatic-generation.md, "Triage the backlog FIRST").
  The pass must name at least one blocked cluster its run actually attacked.
  Verify:
  1. The pass reports an unnamed COUNT, and it matches the registry — re-derive it.
  2. A reachability sweep exists for this pass, with its script and run parameters cited, and YOU
     OPEN IT. A session scratchpad is a fine home for it — the evidence does not have to outlive
     this review, and the committed prose should carry the FINDING, not a path. An assertion that
     routines are "not reachable" or "nothing grounds them", with no sweep you could open, FAILS.
     This is the whole point of the rule.
  3. Any not-reached set is stated as "not reached by THIS sweep", with the states the sweep did
     NOT drive named (deliberate death, full prize collection, two-player, each difficulty tier
     ACTUALLY reached rather than merely nominally set). A not-reached set presented as a dead-code
     measurement FAILS.
  4. A dead-code claim about a specific routine is corroborated by a SECOND, independent method
     (typically a code derivation) — execution data alone is not sufficient, and neither is code
     alone. AND THE TWO METHODS MUST ANSWER THE SAME QUESTION.
     Two results pointing the same way are not corroboration until you have checked they are about
     the same thing.
  5. The pass names at least one blocked cluster its run actually attacked, and what it found —
     a pass that reports only a count has not shown it engaged with the backlog it is describing.

## Naming — proposer ≠ confirmer
- **R4 [ALL]** Every routine promoted loc_<addr>→English this commit appears in BOTH a scratchpad
  PROPOSER file AND a separate CONFIRMER file, written by distinct agents. **Verify by ADDRESS, not
  by name**: grep both files for `0x<addr>`. The confirmer is expected to rename — a promotion whose
  final name is absent from the proposals file is the NORMAL case and not a finding. What the rule
  requires is that the same ADDRESS was proposed by one agent and confirmed by another.

  ★ **Find the two files by asking the pass, not by pattern.** A recipe that hard-codes either
  filename goes silently unrunnable the next time a pass renames its own output.

- **R4b [ALL]** A cell that is `[code]` **or** `[seen]` must be exported by a DESCRIPTIVE identifier,
  not `loc_<addr>` — a cell earns its name at the `[guess]`→`[code]` transition, not at grounding
  (runbook: "A cell earns its DESCRIPTIVE identifier the moment it reaches `[code]`"; the sanctioned
  forms are a descriptive `export const` for an understood cell or an allowlisted `loc_<addr>` for a
  role-unknown one, never `loc_<addr>` for a `[code]`/`[seen]` cell). **Verify:** for
  each cell the commit adds/touches whose tag is `[code]` or `[seen]`, grep its `names.js` line — if the
  `export const` is still `loc_<addr>`, the naming is half-done and the unit is not finished. The rename
  is value-identical (address unchanged) and must update every importer, so also confirm
  `git grep "loc_<addr>" games/<game>/idiomatic` returns nothing for a now-renamed cell (a stale import
  would fail to load). Fire on `[code]` and `[seen]`; a `[guess]`/unknown cell takes an allowlisted
  `loc_<addr>` name (tools/names-debt.txt) — a readable placeholder, not a forced descriptive name
  before the reading is confident.
- **R5 [ALL]** Every name promoted loc_<addr>→English **in the commit under review** is corroborated
  by evidence OUTSIDE the routine itself (a named cell it touches, an idiomatic caller/callee,
  mechanisms.md, or a sibling), and **that routine's `ROUTINES` entry in `names.js` states the
  corroboration in its `why` field** (defined in names-registry.md, "Routines — the `ROUTINES` map").
  Scoped to this commit's promotions, exactly like R4: entries promoted before the field existed do
  not have one, and a missing `why` on an untouched entry is NOT a violation. Do not fail a commit
  for the backlog, and do not backfill it by re-deriving old evidence from memory.

  It is the registry entry and NOT the file header because R21 forbids an idiomatic header from
  naming a caller, a sibling, `mechanisms.md` or the oracle — which is every form of corroboration
  this rule requires. The registry is exempt precisely because cross-file facts are its job, so
  that is where a name's evidence belongs; it also puts the name and its justification in one
  place instead of two. A header may still state what the routine does and why its own body reads
  that way — it just cannot be where the outside evidence is cited.

  Verify: read the renamed routine's registry entry — then locate what CHECKED the
  prediction and confirm the entry cites it somewhere YOU can open right now: a write-set/RAM
  diff, a `reach_sweep` row, a per-cell verdict in this pass's grounding report, or a derivation
  from a DIFFERENT body of code (the caller, a sibling, mechanisms.md) that COULD HAVE COME OUT THE
  OTHER WAY. The test is falsifiability, not instrumentation — reading the caller and finding it
  uses the result as a table index would refute "this classifies", so that derivation counts, while
  a restatement of the routine's own body does not. "Read the entry" alone cannot catch this: an
  entry restating the routine's own code-reading passes it. A corroboration clause with nothing
  behind it that you can open FAILS. **The evidence itself may be ephemeral — a session scratchpad
  is a fine home for it, and we do not commit everything.** You are the one who checks it exists and
  says what it says; a later reader re-derives from the ROM, not from our session. Do not require
  the artifact to outlive the review, and do not make anything carry a path to it.

  **The corroboration must be a PREDICTION the name makes, that was then checked** — not a
  restatement of the same code-reading in other words. Ask of each promotion: what would be
  observably different if this name were wrong, and did anyone look? A header whose corroboration
  cannot fail is not corroboration. Cheapest checks, all theory-free: the routine's write-set, its
  reachability and the states it fires in, and what its caller does with the result.

  Corollary — **the header may claim only what its writer derived.** Prose beyond the name's
  justification and the cells read/written is unverifiable in bulk and propagates by imitation into
  sibling files. The budget is the fixed header template (role, what the routine does, `LIVE-OUT:`)
  PLUS the name's derivation — it never licenses trimming those. The ROM tag and the
  `Memory-equivalent`/`GATE:`/`NAMES:` blocks are NOT part of an idiomatic header since R21; they
  name things outside the file and now live in the registry, the test header (where R17 governs
  them) and the import list. Where the evidence stops, the header must say so rather than round
  up to a confident reading; a named open question is a PASS, a plausible guess stated as fact is a
  FAIL. See `idiomatic-generation.md`, "A claim budget per header".
- **R6 [ALL]** Where purpose is not corroborated, the routine STAYS loc_<addr>. A confidently-wrong
  English name is a violation. Verify: spot-check promoted names aren't guesses.

## Single source of truth (names.js)
- **R7 [ALL]** No staged prose (routine comment or mechanisms.md) calls a cell that IS named in names.js
  "unnamed / kept hex / no names.js name". Verify: `python3 tools/names_consistency.py check` (also a
  hook) + scan comments in the diff.
- **R8 [ALL]** A cell named in names.js is IMPORTED from names.js, not redefined as a local hex const.
  Verify WITHOUT a hardcoded address range: read the game's `names.js`, collect the addresses it
  names, and grep the diff for any `const [A-Z_0-9]+ = 0x…` whose value is one of them. ★ **A check
  that cannot fail is not a check.**

  Two things this rule does NOT cover, so do not read a pass as more than it is. **Naming a cell is
  retroactive**: the moment a cell enters `names.js`, every surviving local alias for it becomes a
  violation, in files the naming commit never touched — so a rewire must sweep the whole layer at
  the moment of the edit, not from an earlier count. And a bare hex CITATION in prose is not a
  redefinition: R7 forbids calling a *named* cell unnamed, but mentioning an address makes no such
  claim, so naming that cell later creates staleness rather than a violation.
- **R16 [ALL]** Every named cell in names.js carries a grounding rating. Verify by PARSING names.js: for
  each `export const NAME = 0x…`, its own comment must contain `[seen]`, `[code]`, or `[guess]`.
  **FAIL if ANY named cell is unrated** — no ratchet, no legacy-debt exception. A name is not
  understanding; the registry is complete only when every cell is labeled.
  done_gate enforces this for games in `tools/done_gate.py` `STRICT_TAG_GAMES`: its grounding subsystem
  counts every untagged `export const NAME = 0x…` cell (a `//` header tag does not count; a `<routine>_ADDR` alias of a ROUTINES address is graded by that routine's `cert:`, so R16 review of alias tags stays with the reviewer), and
  `python3 tools/done_gate.py strict-report --game <g>` measures any game. Games are enrolled one at a time
  with their grounding pass, never flipped red first.

## Translation conventions
- **R9 [ALL]** No import from `optimized/` (retired layer). Imports resolve from `./names.js` and other
  idiomatic files. Verify: `git diff --cached | grep optimized/`.
- **R10 [ALL]** No idiomatic routine calls an already-idiomatic callee via `m.call(0xADDR…)`/push16
  (stale oracle leak) — idiomatic callees are direct JS calls.
  THE DEFECT HAS TWO FORMS AND THE RECIPE MUST CHECK BOTH. The registry form is the obvious one; the
  other is a direct ES import of the frozen oracle — `import { loc_30bd } from "../translated/loc_30bd.js";
  // no idiomatic yet` — in a file where the idiomatic twin DOES exist and that address IS in
  ROUTINES. Same leak, and the comment beside it is false as well.
  Verify (both, per game touched):
  1. `git diff --cached | grep 'm\.call(0x'` — any hit whose target address is a key of that game's
     `games/<game>/idiomatic/names.js` ROUTINES map FAILS.
  2. Resolve every `from "../translated/loc_XXXX.js"` import in the staged idiomatic files against
     the same ROUTINES map; any whose address is present FAILS. Game-agnostic one-liner:
     ```sh
     GAME=<game> node --input-type=module -e '
     import { readdirSync, readFileSync } from "node:fs";
     const d = `games/${process.env.GAME}/idiomatic`;
     const { ROUTINES } = await import(`./${d}/names.js`);
     for (const f of readdirSync(d).filter((x) => x.endsWith(".js")))
       for (const m of readFileSync(`${d}/${f}`, "utf8").matchAll(/from "\.\.\/translated\/loc_([0-9a-f]{4})\.js"/g))
         if (ROUTINES[parseInt(m[1], 16)])
           console.log(`${f}: imports translated/loc_${m[1]}.js but ${ROUTINES[parseInt(m[1], 16)].name} is idiomatic`);'
     ```
     It scans the whole tree, so judge only the files THIS commit stages; pre-existing hits are a
     separate cleanup unit. Run it to see whether any stand — do not carry a count from this doc.
  WHY A RULE AND NOT A GATE, and why this rule is load-bearing: a stale oracle reference is
  invisible to the equivalence gate BY CONSTRUCTION — the oracle is correct, so calling it produces
  correct RAM and every test stays green. Nothing else in the pipeline can see it. This rule is the
  only thing standing between the codebase and silent readability rot, which is the same argument
  R17 rests on.
- **R11 [D]** Every UNNAMED idiomatic routine is named `loc_<addr>` — NEVER a cute prefix
  (`sub_`/`handler_`/`entry_`/`draw_`/`branch_`/`tail_`/`guard_`) or an English name, EVEN when the
  frozen `translated/` oracle carries such a name (DK's oracle does; do not mirror it into idiomatic).
  English names come ONLY via a confirmed understanding-pass promotion (R4). Verify: a new decompile
  batch's idiomatic files are all `loc_<addr>` —
  `ls games/dkong/idiomatic/*.js | xargs -n1 basename | grep -E '^(sub_|handler_|entry_|draw_[0-9]|branch_|tail_|guard_)'`
  must be EMPTY (earned English promotions like buildBoard/drawHighScore are exempt — those went
  through R4). Also FAIL a redundant re-decompile: if a batch adds `loc_<addr>.js` for an address
  that already has a committed idiomatic file (any name), the duplicate must be reconciled, not committed.

## Wiring — a module nothing dispatches is not in the layer
- **R22 [ALL]** Every idiomatic module added by this commit appears in `ROUTINES` under its own
  name, or in `tools/registry-coverage.config.mjs` — `UNWIRED` with a reason, or `DEBT`. And every
  `ROUTINES` entry this commit adds has its module in the same commit.
  Verify: `node --test tools/test/registry-coverage.test.js`, and read the reason for any exemption
  this commit adds — an exemption whose reason you cannot check is a failure. The test reads the
  INDEX, so it already describes the staged diff you are reviewing: an untracked module in the
  author's tree is not yet a claim, a staged one is.

  WHY THE REVIEWER AND NOT ONLY THE TEST. The dispatch map is built by walking `ROUTINES`, so a
  module no entry names is never dispatched: its address is not overridden, so every dispatch to it
  runs the frozen oracle, and the rewrite is reached only by a sibling importing it directly — for
  many, by nothing but their own gate. Nothing turns red, because a gate imports its module rather
  than dispatching to it. The test catches the absence; it cannot judge whether an `UNWIRED` reason
  is TRUE, and a false reason is how a bulk exemption gets a test back to green. Re-derive each new
  one from the code — the argument really does arrive on the stack, the loop really has no exit, no
  table really names that address — exactly as R5 asks of a `why`.

  ★ COVERAGE IS NOT EXECUTION. A green run says every module is dispatchABLE. It does not say the
  layer runs: `manifest.runtime` decides that, and a game set to `"translated"` never calls
  `resolveAllIdiomatic`. Do not accept this test as evidence that a layer is live — READ THE
  RUNTIME it prints on each game's verdict line, and if a commit wires modules into a layer the
  manifest does not run, say so in your report. That is not a violation of this rule; it is the
  thing this rule cannot see.

## Every routine gated with teeth
- **R12 [D]** Each new/changed routine has an equivalence test that (a) compares work-RAM to the
  frozen oracle, (b) asserts the routine's REAL live-out (return value too, not just RAM), and
  (c) has ≥1 broken-twin "teeth" case the test actually CATCHES. Verify: read the test; teeth
  assertions present and non-vacuous; run it if unsure.
- **R17 [ALL]** A `GATE:` header, and a test file's own header, must describe what the
  gate ACTUALLY exercises — and a coverage claim that is VACUOUS must say so explicitly, in the
  header, rather than reading as coverage. (Since R21 a `GATE:` block lives only in a test file's
  header — an idiomatic routine header may not cite a test at all — and `NAMES:` is gone entirely,
  since the import list already states which `names.js` cells a routine uses. R17 is unchanged in
  substance; only the files it applies to moved.) "Replays every captured dispatch" when zero dispatches
  were captured, "all N routines live" in a file that wires one, "runs the whole game" in a tool
  that cannot construct that game's Machine: each is a claim the reader will bank and none of them
  is true. Stating the hole ("this covers attract only; gameplay is not covered", "no dispatch was
  captured for this arm, so the real-capture case is vacuous here") is compliant — silently
  overstating is not. This is the rule that catches the gate nobody has ever seen fail.
  Verify, mechanically, for every gate/test the diff touches or relies on:
  1. RUN it, and check the header's claim against what ran — `node --test <file>` prints each test
     name; a header claiming a scenario with no corresponding assertion FAILS.
  2. For each COUNT or SET the header names ("all 379", "every captured dispatch", "0x8000-0x87FF"),
     find the line that produces it and confirm the number matches — `grep` the wiring call
     (`resolveAllIdiomatic` vs `resolveOverrides({...})`), the fixture array's length, the literal
     range. A header number with no producing line FAILS.
  3. Confirm the gate has been OBSERVED FAILING for the thing it claims to catch: either the diff
     shows a teeth case, or the author reports the exact failure message from breaking it.
  4. For a shared cross-game tool, run it for EVERY game it names, not just the one you changed —
     a tool that exits non-zero on argument parsing or a missing method has never run there.

## A commit's account of itself

- **R19 [ALL]** Every statement a commit makes ABOUT ITS OWN DIFF must be verified against the diff,
  not against the author's account of it.

  The three forms it takes, each with the check that catches it:
  1. **A number about the diff.** Counts of files, sites, roles, occurrences. DERIVE IT FROM THE
     DIFF at the moment of writing — `git diff --cached --name-only | wc -l`,
     `git diff --cached | grep -c ...`. A count carried from an earlier draft is stale the moment
     the diff changes, and it always changes.
  2. **A quotation.** Quoting text is a claim that those exact words exist in that exact file.
     GREP EACH QUOTE against the parent revision before writing it — `git show HEAD:<path> |
     grep -F "<quote>"` — and check the PROVENANCE: words
     the author wrote in an earlier *staged draft* are not in the parent and never will be.
  3. **A claim that a fix landed.** GREP THE STAGED BLOB FOR THE OLD WORDING before reporting a fix
     done — `git show :path | grep -F "<old text>"` must return nothing. Editing the commit message
     and believing the file changed is a real and repeated failure.

  Two corollaries, both earned the same way:
  * **A fix applied where a reviewer points leaves its siblings alive.** When told about an instance,
    sweep for the CLASS.
  * **Re-read the WHOLE file each round, not the delta.** A fix can convert a merely-stale
    neighbouring clause into a live contradiction. Verify: read the
    whole touched file AT THE STAGED REVISION, not the diff hunks, and confirm every clause
    adjacent to a change is still true.

  Verify: for each such statement in the message and in any touched header, run the producing
  command. A statement about the diff with no producing command is unverified.

## What a file is allowed to say about the past

- **R20 [ALL]** A source file states what is TRUE NOW. It does not narrate the drafting that got it
  there. Out of any committed comment, header, doc or commit message: "an earlier version of this
  header said X", "that citation is withdrawn", "the reason this file previously gave", "★ CORRECTION",
  and every "three candidates, not two" construction that only parses against text the same diff
  deletes. The diff records what changed; the file records the code.

  Two reasons, and the second is the sharp one:
  1. The reader has the file, not the session. Prose that only makes sense beside its own predecessor
     is unreadable the moment the predecessor is gone — which is immediately, since the same commit
     removes it.
  2. **Most of what these notes cite was never committed.** There is no revision a reader can check
     them against.

  What survives the rule: a warning against a reading a future reader could plausibly re-derive
  ("NOT A STRING RENDERER — the tables at 0x39C3 are (x,y) waypoint pairs") is a statement about the
  code, and stays. So does a PROVENANCE note separating what was measured from what was inferred.
  What goes is the before/after framing wrapped around them.

  The same rule governs the commit message: it says what the commit DOES. "Corrects X to Y" IS the
  change and belongs; the history of the author's drafts does not.

  Verify: `git diff --cached -- . ':(exclude)docs/reviewer-rules.md' | grep -Ein '^\+.*(earlier (draft|version|header|revision|round|wording)|previously (said|gave)|used to say|the old text|is withdrawn|has been removed|★ CORRECTION)'`
  returns nothing. (The exclusion is not a loophole — it keeps this rule's own quoted EXAMPLES
  from matching it.) A hit FAILS unless the cited past wording is quotable from the parent revision
  (`git show HEAD:<path> | grep -F`) AND a reader of the current code would otherwise re-introduce
  the error. Both conditions, not either.

## What a file is allowed to say about other files

- **R21 [ALL]** A comment in `games/<game>/idiomatic/` describes THAT FILE and nothing else. No ROM,
  no MAME, no frozen oracle, no sibling module, no test, no doc, no to-do. A count of what is in the
  file is fine; a count of anything outside it is not. Exempt, because their job *is* the cross-file
  map: `translated/**` (it comes from the disassembly — the address is its identity),
  `idiomatic/names.js` (the registry), and `idiomatic/**/test/**` (a test must name its subject).

  The mechanical half is a gate — `tools/comment_gate.py check`, wired into `hooks/pre-commit`
  — because unlike every other rule here it tests REFERENCE rather than truth, and that is
  decidable by a script. **What the reviewer adds is the part a script cannot do: whether the
  displaced content landed somewhere, or was simply deleted.** A header stripped of its
  `Memory-equivalent to …` line without the equivalent claim appearing in the test file's own
  header, or a grounding finding removed without reaching `mechanisms.md`, passes the gate and
  fails this rule. Deleting the evidence is not complying with the rule; relocating it is.

  Verify: `python3 tools/comment_gate.py check` exits 0 (the hook runs it, so a landed commit
  has already passed it — the reviewer's job is the second paragraph). Note it carries the DENSITY
  rule too and reports both, so a nonzero exit is not necessarily about R21; read which rule the
  message names. A "cannot lex" block is neither — it means the file could not be judged. For a commit that strips
  headers, diff what left against what arrived: `git diff --cached -- '*/idiomatic/*.js'` (note this
  pathspec also matches the exempt `idiomatic/test/**`, which you want anyway — that is where the
  gate claims land) and confirm each surviving CLAIM is present in the test header, the registry, or
  `mechanisms.md`. A removal with no destination FAILS unless the claim was false or vacuous, which
  the commit message must then say.

- **R23 [ALL]** A probe or script that reproduces a gate's subject must reuse that gate's **wiring
  path** and its **exclusion window**, or state in the file why it diverges from both. Hand-rolled
  apparatus omits what the real apparatus encodes.

  Verify: the probe resolves overrides the way the shipped code does (for arcade-js,
  `resolveOverrides`, so candidates cross the same seam as every registered entry), runs **the
  engine the GATE runs** — for the assembled-swap gate that is `runCycleFree`, which is a test seam
  and NOT what the player runs — and masks `manifest.convergence.stateExclude`. Read the gate and
  see; do not assume the gate and the player share an engine, because here they do not.

  ★ The strongest single control, and it costs one run: **wire the candidate to the FROZEN ORACLE
  and require byte-identity with baseline.** It catches wrong-engine, wrong-exclusion and
  wrong-wiring at once. A no-op control (re-apply something already in place, require nothing to
  change) is real but weaker — it is inert under any comparison window, so it cannot see a
  wrong-exclusion fault. **A control licenses exactly the inference it tests and nothing adjacent.**

  And the cheap sanity check that ends most of these in a minute: **run the probe against the code
  already shipped.** An instrument that condemns the live registry is not detecting a defect.

- **R24 [ALL]** A comment-density pass is a fact about the file AS IT WAS. The cap scales with code
  length, so **DELETING code can push an unchanged header over the cap** — a rewire that removes
  local `const` declarations, a refactor that shortens a body.

  Verify: re-run `comment_gate.py check` after any edit that REMOVES lines, not only after edits
  that add prose. **Cut the prose; never raise the cap.**

- **R25 [ALL]** Deleting a declaration ORPHANS the doc block above it, and **JSDoc attaches
  DOWNWARD** — so an orphan does not merely go stale, a reader binds it to the NEXT declaration,
  which is a different thing. That is a false statement in the file, not a tired one.

  Verify: after any rewire or deletion, check every `/** … */` immediately followed by a blank line
  for whether the next non-blank line is still a declaration. Delete the orphan; do not reword it —
  the claim it made belongs in the registry entry for the cell that now has a name. Run the check
  with a PLANTED orphan in the same pass, so a clean result is a measurement.

  ★ **The general shape: a script that removes lines must own everything ATTACHED to those
  lines**, and finding one instance means sweeping every file that script has ever touched.

- **R26 [ALL]** A test that needs a ROM must SKIP without one, and this is checked by RUNNING, not
  by reading. `README.md`'s Quickstart tells a stranger to run `npm test` and promises the
  ROM-dependent tests "skip cleanly if you haven't built one". Nobody outside the project owns the
  ROMs, so that is the only path an outside reader ever takes.

  Verify: `node tools/rom_guard_check.mjs`. It clones the committed state — ROM images are
  gitignored, so the clone has none BY CONSTRUCTION — and runs the project's own test command
  there. Anything that FAILS is the defect; skipping is the intended outcome and passing is fine.
  The pre-push hook runs it, so a landed commit has already passed it.

  ★ **It reports on the COMMITTED state, so at review time it cannot see the diff under review.**
  On a commit that REPAIRS a guard it returns FAIL, because it is still reading the parent. A
  reviewer who runs it literally will block a correct commit, or learn to ignore it. To judge a
  staged repair, commit it in a scratch clone (or `git stash` nothing and run it after committing
  locally, before pushing) — the push hook is the enforcing use; the review-time use is diagnostic.

  ★ **Do not replace this with a grep.** Two guard idioms are live: `romsPresent()` plus `{ skip }`,
  and *shadowing* `test` with a ROM-conditional wrapper — whose calls read `test(name, fn)` and look
  unguarded while being guarded. Both dkong and thepit use the shadow, and so does timeplt's
  `idiomatic.test.js`, so this is not one game's local habit. A grep for `romsPresent` condemns
  every healthy dkong test file, and an idiom invented later would break a static check silently.

- **R27 [ALL]** **Before you measure, read what the tree already says. After you measure, do not
  let the sentence outrun the log.**

  Verify: before building apparatus, grep `mechanisms.md` and the registry for the routine's FAMILY
  and its callers. After a run, grep your own log for counterexamples to every universal you are
  about to write.

- **R28 [ALL]** Derive a check from the RANGE OF LEGAL VALUES, never from the case in front of you.
  A check written from the expected value rejects compliance at the boundaries, and it passes on
  today's example BY CONSTRUCTION — so it has never been tested against anything but the thing it
  was copied from.

- **R29 [ALL]** When a commit was previously BLOCKED and is re-presented because a qualifying
  commit has since landed, audit whether the unblocking commit is SUBSTANTIVE — not a shim created
  to satisfy the rule.

  Verify: read its diff; confirm it does the work its subject claims; confirm it has its own
  grounding record where its class requires one; confirm it was itself reviewed, a recorded review
  token being the strongest single check.

  *Any rule of the form "X is allowed once Y exists" has this hole, and R1 is only the instance we
  hit.*

- **R30 [ALL]** Before presenting a unit, run the cheap pre-flight checks that have blocked units
  of its class before. Rounds are the price of unchecked work, not of rigour — when review looks
  expensive, ask how many of its rounds existed to catch something the author could have caught
  alone.

  *For a routine promotion, the pre-flight checks are: does naming it leave a stale alias anywhere,
  does its declared range swallow an already-named routine, do its comments cite anything outside
  their own file.*

## R31 [ALL] A narrow brief still has to account for the whole diff

Scoping a review to the risk is correct — re-reviewing a change the owner specified himself is
waste. But **scope the JUDGEMENT, never the ACCOUNTING.**

Every narrow brief carries this as check #1, un-narrowed:

> Diff the staged file against `HEAD` and justify **every** removed or changed line. Anything not
> explained by the change's stated intent is a blocker. Confirm nothing was silently re-ordered.

**The cause is worth knowing, because the edit pattern is common.** A script replaced everything
between a heading and the next heading — and that span held more than the section:

```python
e = src.index("\n## ", s + 10)      # swallows whatever else lives in the span
```

★ **A near-zero net delta is the signature of a swap, not evidence that little changed.** Read
insertions and deletions separately; never reason from the net.

### R32 [ALL] The brief side of it: a disclosure must be RE-STATED every round

The accounting check is only as good as the list of authorized changes it is given, and **every
round gets a fresh, blind reviewer.** Anything you disclosed in round 3 does not exist in round 5.

★ **An authorized change whose authorization is not restated is indistinguishable from collateral
damage** — and it must be, otherwise the accounting check would have to trust the author's memory,
which is the thing it exists to replace. **The reviewer was right to block; the defect was in the
brief.**

So: keep the list of authorized deviations in the *unit's* notes, not in your head, and paste it
whole into every round. Carrying it forward costs a line. Losing it costs a round.

And when it happens, the remedy is to supply the sign-off **in writing, to that reviewer, and let it
re-adjudicate** — not to wave the finding away. Offer it the option of holding the block: an
authorized-but-unrelated change may still belong in its own commit, and that is the reviewer's call
to make.

## R33 [ALL] Generating a quote fixes drift and introduces range errors

A hand-copied code block can silently lose comments while being reported as "verified verbatim".
Transcription drifts, and the drift ran in the direction of the surrounding argument —
which is the dangerous direction, because *tidying* a quote and *shading* one are the same edit and
a reader cannot tell them apart.

⇒ **So generate quotes from their source by script.** Verbatim then holds by construction rather
than by care, and the claim can be re-checked mechanically afterwards.

**But a generating script can delete unrelated things**, because it replaces everything between
one heading and the next and that span can hold more than the section.

★ **A script's blast radius is not what you aimed it at — it is what its bounds actually span, and
you cannot eyeball a span you did not compute.** Generation removes one failure mode and adds
another; it needs its own guard, not fewer.

The guard is the accounting check above, plus: prefer replacing a **named, bounded** region over
anchor-to-next-anchor, and after any scripted edit assert that every pre-existing paragraph either
survives or is explicitly accounted for.

## R34 [ALL] The pixel gate must be ON, and green, for any commit the interlock fires on

**Applies to the first decompile unit of any game, and to every commit the interlock fires on.**
`hooks/pre-commit` enforces this automatically — `tools/pixel_gate_required.py check` refuses any
commit whose staged diff touches, for some game, its `idiomatic/`, `translated/`, `routines.js`,
`machine.js`, `manifest.js`, its own `tools/render.js`, `tools/render-lib.js`, `tools/pixel_suite.py`,
`tools/distant_suite.py` or `tapes/*.poke.json`, or its `boards/<board>/` directory — unless that game's suite prints its literal `PASS` line. **So a
plain `translated/` lift fires it too**, and a reviewer on such a commit owes the verdict line
just as much as one reviewing an idiomatic batch. Your job is to check the enforcement was not
waived, and to run it yourself where it could not be:

```
make pixel GAME=<game>          # or: python3 games/<game>/tools/pixel_suite.py
```

Not every game's gate is a `pixel_suite.py` — Donkey Kong's are `move_suite.py` and
`prize_suite.py`. `make pixel` delegates to the declared suite for the game, so it is the honest
entry point; a game with no declared suite refuses loudly rather than reporting nothing to do.

**If the diff adds or changes an `EXEMPT` entry in `tools/pixel_gate_required.py`, that is a waiver
of this gate and it is yours to adjudicate.** An exemption is legitimate only when the suite
genuinely cannot run and the stated reason is one you can check. ★ **An entry waives the game until
someone removes it** — it is not scoped to the commit that added it, and it will silently waive
every later commit. Adjudicate it as permanent, because it is.

★ **Know what a PASS does not cover.** While a game's `manifest.runtime` is `"translated"`, its
suite renders the ORACLE and its idiomatic layer is dormant — a green pixel gate says nothing about
idiomatic code, because nothing renders it. Do not accept "pixel gate green" as evidence about an
idiomatic module in such a game; the honest statement is that the layer is unrendered and therefore
unmeasured. See [the pixel gate](pixel-gate.md).

**Paste the verdict line into your review, and accept only `PASS`** — for a game with distant-state
tapes (`games/<g>/tapes/*.poke.json`, see [pixel-tapes](pixel-tapes.md)) that is EVERY
`distant_suite: PASS -- <tape>` line too, one per tape per layer the interlock ran, alongside
`pixel_suite: PASS`. A tape missing from the paste is unverified. The other outcomes are not passes and do
not look like failures:

- `pixel_suite: SKIP -- no mame on PATH` / `SKIP -- romset ... not found` — you have checked
  nothing. This is the false green: a reviewer with no romset sees no failure and writes
  "confirmed green."
- `INCOMPLETE` — the render delivered fewer frames than asked. An empty comparison is inconclusive;
  `pixel_gate.py` returns this verdict precisely so it cannot be read as a pass.

**If you cannot run it** (no MAME, no romset), say so in the review as an explicit UNVERIFIED and
do not clear the unit on this rule — hand it back to the author to run and paste. An absence is
evidence only if the instrument was shown able to detect presence.

Why the memory gates cannot cover for it: the per-routine equivalence gates and the assembled swap
compare RAM outside the stack window and a declared live-out. **Neither looks at a pixel.** A layer
can be green on every gate the loop runs and wrong on the glass, because no idiomatic module spends
T-states — which moves the foreground phase, the NMI's interruption point, and what the beam has
drawn when it fires. The DMA sub-frame raster position has no owner among the memory gates at all.

**Turning it on late costs the bisect, not the run.** Many green routines and one pixel diff is a
search problem; one routine and one pixel diff is a bug report.

Beware that `make verify` is a disassembly decoder check defaulting to `GAME=dkong` — a green
`make verify` says nothing about pixels.

### R34a [D] a decompile commit names, per new routine, the tape that covers it

For each routine the commit decompiles, the message names ONE of: the base gameplay tape
(`pixel_suite.py`); a distant tape whose schedule `reaches` lists it (its `distant_suite` reach line shows
hits); or "oracle-only / pixel-invisible, <reason>". The reviewer confirms the named tape's `reaches`
really lists the routine (or the reason holds) — "gates green" alone does not say a new routine was ever
on the glass (commit `b60b1dec` is the example: its green did not include the distant tapes).

## R35 [ALL] An exclusivity claim about a cell needs a WRITE TAP, not a scan

A staged claim of the form *"nothing writes this cell"*, *"its only writer is X"*, or *"the word
occurs nowhere"* must cite an instrument that could have seen a writer it did not name. A scan of
the image — by byte pattern or by decoded operand — is not that instrument, and the reviewer's job
is to ask which one produced the claim, because the diff shows the conclusion and never the tool.

Two ways such a scan comes back confidently wrong:
- **The address is never an operand.** A store through an index register (`ld (ix+d),a`) or through
  a register pair loaded earlier (`dec (hl)`) names no address at the writing instruction.
- **The scan finds the site and stops.** Worse than blindness, because it looks like coverage: an
  operand scan can locate one write and miss a second write elsewhere in the same body.

So the failure is not "scans miss things" — it is that a scan's output is a lower bound wearing the
costume of a count. **Accept a floor stated as a floor.** Refuse a floor stated as an exclusivity.

Verify: grep the staged diff for the SHAPE. This list is a starting point and is NOT exhaustive:

```
git diff --cached | grep -niE "nothing( else)? (writes|stores)|no other (writer|program counter\
|setter)|(only|sole)[- ](writer|setter)|sole writers|exactly (one|two|three) (writer|program \
counter)|never written|occurs nowhere"
```

For each hit, that same comment or this pass's grounding report must name the tap. The trigger is
mechanical; whether the instrument named could have seen a writer it did not report is the
reviewer's judgement.

★ **A hit on this rule's own text is not a test of the trigger.** Check it against the prose in the
diff, not against the examples above. A word list rots; this one will too. What does not rot is
checking the list against the corpus rather than against itself.

## R36 [ALL] A register in an EXCLUDED set that the routine does not clobber is dead weight

Equivalence gates declare the registers allowed to diverge from the oracle. That set used to police
itself: while a gate pinned the divergence EXACTLY (`deepEqual(moved, EXCLUDED)`), a green run was
proof every listed register really did move, or the assertion would have failed. But an exact pin
also goes RED when a rewrite IMPROVES and diverges on one register fewer — a gate that refuses the
fix — so those pins are being converted to subset checks, which cannot notice a padded set.

So ask, of any ALLOWED/EXCLUDED set a diff adds or widens: **what put each name in it?** A register
the routine does not actually clobber costs nothing to add, weakens the arm silently, and no gate
will ever complain. Tightness moved from the assertion to you.

Two things this is NOT. It is not an argument for restoring exact pins — refusing the better module
is the worse failure. And a register legitimately in the set needs no removal; it needs its
liveness recorded somewhere the next reader can find, which is what a crafted arm does.

## Staging & commit hygiene
- **R13 [ALL]** The staged diff contains ONLY files of this commit's stated unit — a DECOMPILE stages
  that batch's routines+tests; an UNDERSTANDING stages renames/names.js/mechanisms/retrofits. No
  unrelated files, no cross-unit leak, no infra mixed in. Verify: `git diff --cached --stat` vs the
  stated scope.
- **R14 [ALL]** No `git mv` leaked another unit's renames into this index. Verify: every staged rename
  belongs to this unit.
- **R15 [ALL]** Commit authored by Jimmy; NO Co-Authored-By trailer; review_gate token bound to this
  exact staged diff; no `--no-verify`; no ROM/binary assets staged. Verify: author, trailer, token,
  staged file types.

  **Token handover has TWO halves. Both are load-bearing and neither substitutes for the other.**

  * **Sender**: quote the hash; NEVER assert equality. "Unchanged since you audited" is not
    checkable by the recipient. The hash is.
  * **Recipient**: compare against YOUR OWN anchor, recorded in your review file at the previous
    round — never against the hash the message supplies. A hash the sender derived from the current
    file cannot disagree with the current file.

  Therefore **a blind reviewer MUST record, in its review file, the blob hashes it anchored to.** A
  review that reports only a verdict cannot perform this check next round, and a superseded blob
  that was never staged is unrecoverable — it is not in the object database, so the review file is
  the only record that revision ever existed.

Report format: for each class-applicable rule, `Rxx PASS` or `Rxx FAIL <evidence>`; record the token
only if ALL are PASS (plus the correctness review passes).

---

*Add new requirements here, as rules — not as new gates. A gate tests a proxy (e.g. "≥1 new
`[seen]` line"); a rule the review agent reads can require the real thing (grounding actually ran
and was honestly recorded).*

- **R31 [ALL]** A confidently-read idiomatic cell owes a DESCRIPTIVE name (runbook: a cell earns its
  identifier at the `[guess]`→`[code]` transition, not at grounding). An `export const loc_<addr> = 0x...`
  in a game's idiomatic `names.js` is valid ONLY as an allowlisted placeholder for an unknown /
  `[guess]`-role cell — listed in `tools/names-debt.txt`, which the `names_consistency` gate rule B checks
  — where it clears the raw-hex cruft while the role is pending. FAIL a `loc_<addr>` cell const in either
  other case: a confident cell (`[code]` **or** `[seen]`) still named `loc_<addr>` is an unfinished job (the
  descriptive name is earned the moment it reaches `[code]`), and a NEW `loc_` cell absent from
  `names-debt.txt` is un-tracked debt. Every reader of a mis-named confident cell pays the
  `mem16[loc_83ef]`-vs-`mem16[HIGH_SCORE]` tax the idiomatic layer exists to remove. (Idiomatic ROUTINE
  modules kept `loc_<addr>` are a separate question, not this rule.)

## R35 [U] mechanisms.md is regenerated WHOLE, never patched

- **R35 [U]** An understanding pass regenerates `games/<game>/mechanisms.md` WHOLE from the current
  code every time — it is never an incremental patch. A commit that renames / adds /
  wires routines but leaves most of the map's prose byte-identical — a few-line edit that name-drops the
  new routine to green `understanding_gate` CHECK A — is the anti-pattern: the map drifts from the code
  while reading as finished. Verify: `git diff --cached --stat -- games/<game>/mechanisms.md` on a commit
  that changes routine naming / wiring should reflect a whole-document re-derivation (the sections rewritten
  from the bodies), not a handful of inserted lines. A small, surgical `mechanisms.md` diff on such a commit
  FAILs unless the message states why the map was already current (e.g. a pure grounding pass that only
  flipped tags). And per R20 the regenerated map is a CURRENT-STATE description: no development / batch
  chronicle ("batch N lifted X"), no decompile-campaign narrative — it says what the machine IS now, not
  how it was built. And it must READ AS NARRATION — flowing human-readable exposition, not a fact-listing;
  a bulleted / comma-string catalogue of cells and offsets FAILs even if every fact is present. Grounding
  rides in the `[seen]`/`[code]` TAG, never in prose — "MAME overturned/confirmed X", wave dates, golden
  names, and "grounding inverted the earlier reading" are development history and FAIL; a current-state
  warning that a reading is counterintuitive ("X is a counter, not a static base") is fine. Verify:
  `grep -niE 'wave[- ][12]|overturn|golden_|MAME (grounding|wave)|batch [0-9]|earlier reading' games/<game>/mechanisms.md`
  returns only mechanism false-positives (e.g. an "inverted" hardware port), not history prose.

## R36 [D] a dispatching rewrite carries the SP-tooth (memory-eq is blind to a missing push16)

- **R36 [D]** A new idiomatic routine that seats a return then dispatches — an `m.push16(<slot>)` before an
  `m.call(<rst-28 / tail-dispatcher>)`, or any `return m.call(<translated>)` tail whose callee `ret`s —
  carries an SP-tooth in its equivalence test: run the rewrite through the game's `withOmittedRet` seam via
  `core/equivalence.js` `seamPlaceable(withOmittedRet, fn, addr, entryClone)` from a crafted entry (SP on a
  real caller-return word) and assert `placeable === true`. The memory-equivalence diff is BLIND to a missing
  `push16` — the adrift stack word lives in dead stack scratch, excluded from the RAM diff — so the class
  passes eq-green while corrupting the live game; the seam is the authority (it completes an omitted ret at
  moved 0, accepts the legit tail-dispatch at moved +2 with pc on the caller slot, and THROWS when SP is
  adrift). The tooth must be null-mutant-proven at least once per game — drop a real `push16`, prove it goes
  RED — because a check never observed failing cannot be trusted (R17's lesson at per-routine scope; the
  whole-game version is `tape.test.js`). Verify: the routine's eq test imports `seamPlaceable`; the game has a
  `sp-seam-tooth.test.js` whose null-mutant case asserts `placeable === false`.

## R37 [D] a routine delegating via a register bridge into a FROZEN callee must RE-SEAT that register

When a decompiled routine forwards a value into a still-translated (frozen) callee — or into an idiomatic
callee whose signature reads its input from a `= m.regs.X` param default — through the REGISTER BRIDGE, the
rewrite MUST seat `m.regs.X` to that value before the delegate call. A rewrite that threads the value only as
an explicit JS param, while a deeper frozen callee still reads `m.regs.X`, silently passes a STALE register
and writes to the wrong address in the live game.

This class is invisible to memory-equivalence eq tests (their harness happens to seat the register, and the
oracle keeps it live as a real register the whole way) AND to the by-execution reviewer fan (it decodes each
routine in isolation, not the assembled cross-routine register flow into a frozen delegate). ONLY the
whole-game `tape.test.js` catches it, replaying real input through the wired layer vs the oracle.

Verify: for a routine that tail-delegates or forwards into a callee (a kept frozen `m.call`, or an idiomatic
callee with a `fn(m, x = m.regs.X)` signature), confirm the routine seats `m.regs.X` before the call — grep
the callee chain for `= m.regs.` param defaults. The established idiom is
`m.regs.ix = rec; // record base flows through IX to the deeper scan-state chain` (loc_56e8, loc_588e).

## R38 [U] a GROUNDING review confirms a [seen] from MAME EVIDENCE, never from the code diff

A `[code]`->`[seen]` promotion is a claim about the real hardware: a MAME write-tap watched the cell change,
or watched the routine's own PC write a role-defining cell. That fact is NOT in the commit diff (grounding
is carried by the tag, not narrated), so a reviewer given only the staged `names.js` + code can see the
promotion but has no way to CONFIRM it — it can only flag it as unrecorded. A grounding review done from
code alone is therefore not proposer!=confirmer; it is a second code-read, and it will over-flag sound
groundings while being unable to validate weak ones.

So a review that adjudicates any `cert: "seen"` (routine) or `[seen]` (cell) MUST be handed that cert's MAME
evidence, or re-run the game's grounding write-tap (`games/<game>/tools/lua/ground_writes.lua` under the MAME
rig) to re-derive it. The mechanism: the grounding-commit-review workflow attaches, per cert, the write-tap
from the capture that producer emits (`pc,addr,n,v0,vN,cyc0`), extracted by
`tools/grounding_evidence.mjs` (`routine <lo> <hi>` for a routine's own write-set, its stack window read
per-game from `names.js` `STACK_SCRATCH`; `cell <addr>` for a cell's value-changes). Verify: a role-defining
MAME observation grounds the cert, but it is NOT always a write. A routine that PRODUCES state is `[seen]`
on a role-defining OWN write; a DISPATCHER or driver (its role is to read a cell and vector to the matching
handler) is `[seen]` when MAME confirms that vectoring — observed reachability + correct handler selection
ACROSS THE STATES IT ROUTES (a single observed arm is not enough; watch it vector correctly to each handler
of its dispatch table) — even with no own write, OR derivatively once its dispatch cell and handlers are
themselves `[seen]`. So the
tool reporting only stack scratch for a dispatcher is the signal to check its vectoring, NEVER an automatic
`[code]`; what stays `[code]` is a role that is neither write- nor dispatch-grounded (e.g. a writer whose
only writes land in cells still `[code]`/contested — it cannot be more grounded than the cells it writes).
A cell is `[seen]` only if the capture shows it watched changing (drain/toggle/seed). A grounding review with
no MAME evidence on record is not a grounding confirmation — treat its `[seen]` verdicts as unmade.
*See docs/runbook.md §4 "The grounding CONFIRMER confirms a [seen] from EVIDENCE".*

## R39 [ALL] a grounding-debt.txt entry must be genuinely IRREDUCIBLE, verified independently

`games/<game>/grounding-debt.txt` accounts for the honestly-irreducible ungrounded tail — `done_gate`
subtracts each listed address from the grounding count, so an entry here is exactly as load-bearing as a
`[seen]` promotion: it lets the ship pass. The gate MECHANICALLY rejects a reasonless entry or one whose
address is not actually ungrounded in `names.js`; the JUDGMENT that the reason is TRUE is the reviewer's,
proposer!=confirmer. For every entry ADDED/CHANGED this commit, independently confirm from the code AND the
grounding captures that NO reachable state on a GOOD ROM produces a role-defining MAME observation:
- **anti-tamper clone / error arm** reached only when a checksum/signature guard fires — i.e. only on a
  TAMPERED ROM (its guard never fails on the real image), so no valid play reaches it; or
- **a ROM constant read only by the checksum sweep** — no role PC ever reads it in any reachable state.
A routine or cell a deep capture COULD reach — a later board, the eagle/bonus stage, a sound event, a 2P
split, a forced state-machine transition — is NOT irreducible: it must be GROUNDED (deep-capture campaign),
never allowlisted. An entry you cannot independently justify as un-groundable-on-a-good-ROM → WITHHOLD the
token and name the address + why it looks reachable. Allowlisting a groundable item is the exact abuse this
rule exists to stop.
*See docs/runbook.md §4/§5 (the grounding-debt allowlist) and `tools/done_gate.py` `check_grounding`.*

## R40 [ALL] a DONE-marker commit's review IS a fresh adversarial §5 done-audit, not a read of the file

A commit that adds or sets a game's done-record (`games/<game>/DONE.md`) is the done-claim itself, and the
standing `review_gate` already makes it un-landable without a PASS on those exact bytes. But a review that
merely reads `DONE.md` and agrees it "looks thorough" is the blind-arbiter failure the entire done-definition
exists to stop — a green subsystem gate is *exactly* what once read as "done" while blind to half the runbook
(pixel ran a 90s window not the §5 full golden; audio passed on map structure while the clips were never
recorded). So the review of a DONE-marker commit MUST be a FRESH adversarial done-audit (docs/runbook.md §5):
handed this runbook, the reviewer independently checks the GAME STATE at that commit against EVERY §5
completion criterion — the game, not the diff bytes — records a per-criterion verdict, and records PASS only
if it finds ZERO open criteria and no gate passing while validating too little. proposer≠confirmer: the
auditor that wrote `DONE.md` and the reviewer that clears the commit are DIFFERENT agents, and the verdict
rests on neither the human's word nor "the gates are green." Run the cheap mechanical pre-filter first
(`done_gate`, the per-game subsystem gates) so a red subsystem is caught in a second — but a green pre-filter
is a precondition, never the audit. Any open criterion, or any gate green-but-blind → WITHHOLD the token and
name the gap. The 10-minute pixel criterion is a named gate (`tools/long_golden.py`, RAM byte-exact + pixel band
at the measured offset); an auditor's own scratch comparator, or a nearest-frame reconverge verdict, does not
discharge it. A `DONE.md` landed WITHOUT such an audit on record is an invalid done-claim.
*See docs/runbook.md §5 "A game is NOT done until an independent adversarial agent agrees" + the DONE.md bullet.*

## R41 [ALL] a §4-end cleanup commit must RENAME grounded loc_ routines, not only comment them

The §4-end cleanup "cleans every routine" via TWO obligations — **(1) rename** a role-understood routine still
named `loc_<addr>` to a descriptive EFFECT name (leaf-first), and **(2) comment** it verbosely
(docs/runbook.md §4-end "Clean every routine"). A verifier that only proves a change is comment-only (code
byte-identical) certifies (2) while silently dropping (1) — the exact gap that once shipped a whole sweep
comment-only, leaving every grounded routine as `loc_`. So a reviewer of a §4-end cleanup commit MUST confirm
the RENAME obligation, not just the comments: any routine in the commit's scope that is `cert:"seen"` (or
`cert:"code"` with a confident mechanism) and still named `loc_<addr>`, and is not allowlisted with a reason in
`games/<game>/names-debt.txt`, is a BLOCK — even if every comment is perfect and the code is byte-identical.
The mechanical backstop is `done_gate`'s `naming` subsystem (`tools/naming_gate.py`), which refuses the ship
for the same condition; this rule catches it per-commit rather than only at done.
*See docs/runbook.md §4-end "Clean every routine" (the two obligations) + tools/naming_gate.py.*

## R42 [ALL] a gate/harness constructs through the shared factory and feeds manifest values RAW — never restated or translated

The web player builds a game's Machine ONE way: `web/machine-factory.js buildGameMachine()` (the worker's exact
`new Machine(maincpu, {inputs, ...gfx, overrides})`, non-maincpu images spread by their `manifest.rom.images`
NAME) and keys input by the manifest port VALUES. A gate/harness that RE-STATES a declared manifest value —
reads `opts.gfx` when the manifest names the image `gfx1`, or TRANSLATES a port through a private map (a `PMAP`)
— is blind to a divergence in that very value and passes green while the browser is broken. All four galaxian
browser-only defects shared this root (black screen from a gfx image key; input crash-loop from a translated
port index). So a reviewer of any gate/harness/test that constructs a Machine or feeds it input MUST confirm it
builds via `buildGameMachine` and feeds RAW manifest keys/values — not a hand-rolled `new Machine(...)` nor a
restated/translated value. The mechanical backstop is `done_gate`'s `browser` subsystem: the shared games-boot
boot, and for a game in `BROWSER_GAMES` the manifest input map checked against MAME's own ports
(`tools/input_map_gate.py`) and the page itself in headless Chrome (`tools/browser_runtime_gate.mjs`: boot,
canvas, every key binding, a coin's clip). Node cannot exercise the browser audio/canvas runtime (the synth-404
+ Safari 0-input bugs were runtime-only), so the system runs it there — no human confirm. A DONE-marker review
(R40) of a game outside `BROWSER_GAMES` runs both tools itself and records their lines.
*See docs/runbook.md §5 web-worker contract + web/machine-factory.js + tools/done_gate.py check_browser.*
