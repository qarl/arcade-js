# arcade-js — top-level convenience targets.
# Per-game ROM assembly lives with each game (games/<id>/Makefile).
# The disassembly/verify targets operate on one game (default: dkong).

GAME ?= dkong
ROM   = games/$(GAME)/rom/maincpu.bin
OUT   = games/$(GAME)/out
SRC   = games/$(GAME)/translated/*.js

# Where YOUR romset zip lives, for `make samples` (MAME's -rompath).
ROMPATH ?= $(HOME)/Downloads
# Extra flags forwarded to the recorder, e.g. SAMPLEFLAGS="--dry-run".
SAMPLEFLAGS ?=

.PHONY: help test serve rom-dkong samples trace verify stepcheck

help:
	@echo "arcade-js targets:"
	@echo "  make rom-dkong    assemble + sha256-verify the Donkey Kong ROM from your dkong.zip"
	@echo "  make samples      record GAME's sounds from YOUR MAME + YOUR ROM into"
	@echo "                    games/$(GAME)/audio/samples/ (gitignored, never committed)."
	@echo "                    Needs MAME on PATH and your own romset in ROMPATH=$(ROMPATH)."
	@echo "                    Optional: the game is fully playable, and silent, without it."
	@echo "  make serve        start the dev web server (COOP/COEP) — pick a game and play"
	@echo "  make test         run the unit suite (node --test)"
	@echo "  make trace        recursive-descent disassembly of GAME's ROM  -> $(OUT)/dk.asm"
	@echo "  make verify       cross-check our Z80 decoder against z80dasm (needs z80dasm)"
	@echo "  make stepcheck    audit every m.step() target against the ROM's instruction boundaries"
	@echo "  (GAME=<id> selects the game; default dkong. ROMs are copyrighted and never committed.)"

test:
	node --test "core/**/test/*.test.js" "boards/**/test/*.test.js" "games/**/test/*.test.js" "web/test/*.test.js"

serve:
	python3 web/server.py

rom-dkong:
	$(MAKE) -C games/dkong rom

# Drives YOUR MAME against YOUR romset and writes clips to a gitignored
# directory on YOUR machine. arcade-js ships no game audio, ever — same posture
# as the ROM images. See games/$(GAME)/tools/README-samples.md, and
# `SAMPLEFLAGS=--help` for every option.
samples:
	python3 games/$(GAME)/tools/record_samples.py --rompath "$(ROMPATH)" $(SAMPLEFLAGS)

trace: $(ROM)
	python3 tools/trace.py --rom $(ROM) --out $(OUT) --entrypoints games/$(GAME)/entrypoints.json

verify: $(ROM)
	python3 tools/verify_decoder.py --rom $(ROM) --blocks $(OUT)/blocks.def --entrypoints games/$(GAME)/entrypoints.json

stepcheck: $(ROM)
	python3 tools/stepcheck.py --selftest --asm $(OUT)/dk.asm --src "$(SRC)"
	python3 tools/stepcheck.py --asm $(OUT)/dk.asm --src "$(SRC)"
