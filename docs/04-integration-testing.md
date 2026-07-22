# 4. Integration testing — the MAME ground-truth harness

Unit tests prove a routine matches the disassembly. Integration testing proves the *whole machine*
matches reality, where reality is **MAME** running the same ROM. The comparison is only meaningful
if both sides are deterministic and produce the same artifacts, so most of the harness is about
pinning determinism.

## Capturing a golden (the reference side)

`tools/mame_golden.py` drives MAME with a pinned, determinism-controlled command line: video/sound
off, no throttle, no frameskip, a **fresh empty nvram and cfg directory per run**, no autosave. Two
runs produce byte-identical output. It installs a Lua instrument (`games/dkong/tools/lua/`) that,
each frame, dumps the work/sprite/video RAM and optionally a hardware-write trace; an input tape
(`games/<id>/tapes/*.lua`) can press buttons and poke state to reach a chosen scenario.

It then extracts three artifacts:

- **frames.rgb** — the raw video, one 256×224 RGB frame after another (via ffmpeg).
- **state.bin** — a fixed-size RAM snapshot per frame.
- **writes.txt** — the hardware writes in execution order.

Every capture is **self-checked and fails closed**: the frame and state counts must equal the
frame-rate formula, the power-on state must be all-zero, the AVI and the state dump must agree, a
watchdog-reset signature must be absent, and the machine configuration is *certified* — the dip
switches and the CPU reset state must match pinned constants (`tools/scope.py`), or the golden is
rejected. A golden captured against a subtly different machine is worse than no golden.

## Emitting the same artifacts (our side)

`games/dkong/tools/emit.js` runs the JavaScript machine and writes the **same three formats** — `state.bin`,
`writes.txt`, `frames.rgb` — from the same inputs/pokes as the tape. It is honest about scope: if it
can only produce a short run, it says so and exits non-zero, so a partial artifact never reads as
complete.

## Diffing in an order that localizes the fault

The diff tools are shared across every board, so none of them hardcode a game's addresses: each
takes `--hardware boards/<driver>/hardware.json`, the board's machine-readable declaration of its
state-dump regions, MMIO write ranges, screen size, driver name, and frame timing. The JS engine
keeps its own numeric constants in `boards/<driver>/{memory,io}.js`, unrefactored; a drift test
(`boards/dkong/test/board.test.js`) asserts the JSON matches them so the two can never diverge.

`tools/verdict.sh` runs the diffs in a deliberate order — **state → writes → pixels** — so a failure
is interpretable:

- **state** differs ⇒ the CPU/logic is wrong; the renderer is irrelevant until it's fixed.
- state matches but **pixels** differ ⇒ the bug is in the video model, not the CPU.
- **writes** (in execution order) catch timing/ordering errors that state snapshots miss.

Each stage names whether it actually ran (a missing reference reports "gate unavailable", never
"pass"), and unexpected exit codes fail closed as harness errors. The result is `PASS` / `FAIL` /
`PARTIAL` / `NOTHING-COMPARED`, with exactly which gates ran.
