#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Recursive-descent tracer over the DK maincpu image.

WHY THIS EXISTS: DK's ROM interleaves code and
data. A linear sweep mis-decodes data as instructions and desyncs the stream
for everything after it. So we only decode bytes we can *prove* are reachable,
by following control flow from the real entry points.

The output is the coverage map, and the coverage map is the project to-do
list: UNREACHED bytes are code paths we have not exercised. Inputs are driven
into MAME to reach them; newly-discovered entry points (jump-table targets,
etc.) get added to tools/entrypoints.json and this is re-run.

Entry points:
  0x0000  Z80 reset
  0x0066  NMI -- DK's vblank interrupt (NOT IM1)

Indirect jumps (`JP (HL)`, jump tables) cannot be followed statically. We log
them as UNRESOLVED rather than guessing -- those are precisely the places
where MAME has to tell us the truth.

CALLS THAT DO NOT RETURN
------------------------
DK leans on two stack idioms that break the naive "a CALL resumes at the next
instruction" assumption. Getting this wrong silently mis-decodes the bytes
after such a call, which desyncs the instruction stream:

  1. `sub_0028` -- jump-table dispatch. It does `pop hl` to capture its own
     return address, which is the base of a table of 16-bit targets stored
     INLINE after the call, then `jp (hl)`. The bytes after the call are DATA.
  2. `pop hl / ret` -- returns to the caller's caller, skipping the caller's
     fallthrough entirely (used as a conditional-skip idiom).

Rather than hardcode a list of such routines, we compute it: the tracer
tracks stack depth relative to each routine's entry and asks whether a `ret`
is reachable at depth 0. A routine with no depth-0 `ret` never returns
normally, so its callers' fallthrough is not code. Because that answer
depends on the answers for routines it calls, we iterate to a fixpoint.

Usage:
    python3 tools/trace.py [--rom rom/maincpu.bin] [--out out]
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from z80_decode import (  # noqa: E402
    CALL,
    CALL_COND,
    HALT,
    JUMP,
    JUMP_COND,
    JUMP_INDIRECT,
    RET,
    RET_COND,
    RST,
    decode,
)

ROM_SIZE = 0x4000

UNREACHED = 0
CODE_START = 1
CODE_OPERAND = 2
TABLE_DATA = 3  # inline jump-table payload -- analyzed, NOT a to-do item

# The two real hardware entry points. Everything else must be *discovered*.
BUILTIN_ENTRIES = [
    (0x0000, "Z80 reset vector"),
    (0x0066, "NMI - vblank interrupt handler"),
]


# Depth is tracked relative to a routine's entry. These bounds are a runaway
# guard, not a real Z80 limit -- exceeding them means we are walking garbage.
# Measured in BYTES, not slots: `inc sp` moves SP by one byte while push/pop
# move it by two, and counting both as "one" made the `inc sp / inc sp` idiom
# register as two slots instead of one.
DEPTH_MIN, DEPTH_MAX = -16, 128


def _dedupe(rows: list[dict]) -> list[dict]:
    """Report rows are appended once per (pc, routine, depth) visit, so one
    site can appear several times (`jp (hl)` at 0x0306 is reached inside both
    the reset and NMI walks). Collapse on address + text."""
    seen, out = set(), []
    for r in rows:
        key = (r.get("addr"), r.get("text"))
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out


def _pushed_literal(prev, ins) -> int | None:
    """Recognise `ld rr,0xNNNN` immediately followed by `push rr`, which
    pushes NNNN as a return address for a routine dispatched afterwards.
    That address is the first byte after any inline jump table."""
    if prev is None or not ins.text.startswith("push "):
        return None
    reg = ins.text[5:].strip()
    prefix = f"ld {reg},0x"
    if not prev.text.startswith(prefix):
        return None
    try:
        return int(prev.text[len(prefix) :], 16)
    except ValueError:
        return None


class Routine:
    """What we learned about one CALL target, over the current trace pass."""

    def __init__(self, addr: int):
        self.addr = addr
        self.ret_depths: set[int] = set()
        self.consumes_return_addr = False  # popped its return address
        self.dispatches_inline_table = False  # ...and then JP (HL) on it

    @property
    def returns_normally(self) -> bool:
        """A `ret` reachable at depth 0 means control resumes at the
        instruction after the call. No such `ret` means it never does."""
        return 0 in self.ret_depths

    def to_json(self) -> dict:
        return {
            "addr": self.addr,
            "ret_depths": sorted(self.ret_depths),
            "returns_normally": self.returns_normally,
            "consumes_return_addr": self.consumes_return_addr,
            "dispatches_inline_table": self.dispatches_inline_table,
        }


class Tracer:
    def __init__(self, mem: bytes):
        self.mem = mem
        self.entries: list[tuple[int, str]] = []
        self.noreturn: set[int] = set()
        self.table_dispatchers: set[int] = set()
        self.code_bound: frozenset = frozenset()  # phase-2 table bound
        self.non_routine_entries: set[int] = set()
        self.converged = False
        self.iterations = 0
        self._reset_pass()

    def _reset_pass(self):
        self.kind = bytearray(ROM_SIZE)
        self.instrs: dict[int, object] = {}
        self.routines: dict[int, Routine] = {}
        self.call_targets: set[int] = set()
        self.jump_targets: set[int] = set()
        self.call_sites: dict[int, list[int]] = {}  # target -> [call addrs]
        self.unresolved: list[dict] = []
        self.out_of_range: list[dict] = []
        self.stack_tricks: list[dict] = []
        self.overlaps: list[dict] = []
        self.depth_escapes: list[dict] = []
        self.jump_tables: list[dict] = []
        self.pushed_continuations: list[dict] = []
        self.is_table_data = bytearray(ROM_SIZE)

    def add_entry(self, addr: int, why: str, is_routine: bool = True):
        """Register an entry point.

        `is_routine=False` for addresses that are evidence a byte is CODE but
        NOT evidence it is a routine entry -- notably execution-trace run
        starts, which are frequently mid-routine because execution fell into
        them. Such an entry seeds the walk but must NOT own `ret`
        attribution: if it does, it takes ownership of the returns belonging
        to the routine that actually contains them, leaving that routine with
        no depth-0 `ret` and misclassifying it as never-returning -- which
        then breaks its callers' fallthrough and hides whole spans.
        """
        self.entries.append((addr, why))
        if not is_routine:
            self.non_routine_entries.add(addr)

    def run(self, max_iterations: int = 16):
        """Trace to a fixpoint, in two phases.

        PHASE 1 converges the set of never-returning routines and inline-table
        dispatchers. Each pass re-traces using the previous pass's answer about
        which calls fall through; removing a bogus fallthrough removes the
        garbage code it led to.

        PHASE 2 tightens the jump tables. Phase 1 bounds a table only by the
        pushed continuation (when there is one) or by plausibility, and
        plausibility over-reads: at 0x0702 it swallowed 0x3a60, which is a
        movement curve table, and decoding that as code resurrected garbage.
        The reliable extra bound is that a table cannot extend past an address
        already proven to be an instruction start -- 0x073c is a confirmed
        handler, which pins 0x0702's table to exactly 29 entries.

        That bound is only trustworthy once tables are being parsed as data
        (in phase 1's first pass they are still decoded as code, so their
        interiors would look like instruction starts and truncate every table
        to nothing). Hence phase 2 runs separately, seeded from a pass that
        already had table handling active. Tightening can only ever SHRINK a
        table, which is the safe direction: it costs coverage, which is
        visible in the report, rather than injecting garbage, which is not."""
        for i in range(max_iterations):
            self.iterations = i + 1
            self._trace_once()
            found = {
                addr for addr, r in self.routines.items() if not r.returns_normally
            }
            tables = {
                addr
                for addr, r in self.routines.items()
                if r.dispatches_inline_table
            }
            if found == self.noreturn and tables == self.table_dispatchers:
                break
            self.noreturn = found
            self.table_dispatchers = tables
        else:
            self.converged = False
            return

        # Phase 2: re-trace, bounding tables by the code map from the pass
        # before. Iterate until the code map stops changing.
        for i in range(max_iterations):
            self.iterations += 1
            prev = self._code_starts()
            self.code_bound = prev
            self._trace_once()
            if self._code_starts() == prev:
                self.converged = True
                return
        self.converged = False

    def _code_starts(self) -> frozenset:
        """Addresses the code demonstrably transfers control to AND that we
        decoded an instruction at.

        Deliberately NOT "every instruction start". Excluding table interiors
        instead would let an over-read table veto its own correction: 0x073c
        is a confirmed handler from the exactly-bounded table at 0x00ca, but
        the over-read at 0x0702 also claims it as table data, so filtering on
        "not table data" drops the one address that proves the over-read.

        CAVEAT, because it is easy to over-trust this: parsed table entries go
        into `jump_targets` too, so some of these addresses are themselves
        table-derived rather than read off the instruction stream. Four of the
        current tables end up bounded by their own first handler. That is
        sound here -- a handler genuinely does start right after its table,
        and `kind[a] in (CODE_START, CODE_OPERAND)` in _parse_inline_table is
        an independent second guard -- but it is also why phase 2 needs an
        iteration cap: shrinking a table removes targets, which can remove the
        bound that caused the shrink, which lets it regrow. Shrinking is
        monotonic per application, not across the phase-2 fixpoint."""
        return frozenset((self.call_targets | self.jump_targets) & set(self.instrs))

    def _parse_inline_table(self, work, site_end: int, dispatcher: int, cont: int | None):
        """Read the table of 16-bit targets stored inline after a dispatch.

        BOUNDING THE TABLE is the whole difficulty -- read one entry too many
        and we inject a bogus entry point that desyncs a whole region. Two
        independent bounds, and we take the tighter:

          1. The continuation address. The caller typically does
             `ld hl,NNNN / push hl` right before dispatching, so the routine's
             `ret` lands at NNNN -- which is the first byte AFTER the table.
             This one is exact: the code names its own table end.
          2. Plausibility. Stop at the first entry that is not a populated-ROM
             address, or at the first byte already proven to be code.

        Entries are recorded with provenance and flagged provisional so a later
        pass can confirm each against MAME rather than trusting the parse."""
        limit, bound = ROM_SIZE, "plausibility"
        if cont is not None and site_end < cont < ROM_SIZE:
            limit, bound = cont, "pushed_continuation"
        # Phase 2: a proven instruction start inside the table caps it.
        for a in self.code_bound:
            if site_end < a < limit:
                limit, bound = a, "confirmed_code"

        targets = []
        a = site_end
        while a + 1 < limit:
            if self.kind[a] in (CODE_START, CODE_OPERAND):
                break
            t = self.mem[a] | (self.mem[a + 1] << 8)
            if not (0 <= t < ROM_SIZE):
                break  # not a populated-ROM address -- past the end of the table
            targets.append(t)
            for b in (a, a + 1):
                self.is_table_data[b] = 1
                if self.kind[b] == UNREACHED:
                    self.kind[b] = TABLE_DATA
            a += 2

        self.jump_tables.append(
            {
                "dispatcher": dispatcher,
                "table_addr": site_end,
                "table_end": a,
                "entry_count": len(targets),
                "bounded_by": bound,
                "continuation": cont,
                "null_slots": sum(1 for t in targets if t == 0),
                "targets": targets,
            }
        )
        for t in targets:
            # A 0x0000 entry is an unused dispatch slot, not a handler --
            # following it would just re-walk the reset vector.
            if t == 0:
                continue
            self.jump_targets.add(t)
            work.append((t, t, 0))  # each handler is its own frame

        # The continuation is where the dispatched handler's `ret` lands, so
        # it is code too -- and it is code nothing else jumps to.
        if cont is not None and 0 <= cont < ROM_SIZE:
            self.jump_targets.add(cont)
            work.append((cont, cont, 0))

    def _trace_once(self):
        self._reset_pass()
        # A work item is (pc, routine_entry, stack_depth_relative_to_entry).
        # A non-routine entry seeds the walk with rt=None, so no `ret` found
        # downstream is attributed to it.
        work = [(a, None if a in self.non_routine_entries else a, 0)
                for a, _ in self.entries]
        seen: set[tuple[int, int, int]] = set()

        while work:
            pc, rt, depth = work.pop()
            prev = None
            # Address pushed as a return target by `ld rr,NNNN / push rr` on
            # this path -- bounds an inline jump table exactly (see
            # _parse_inline_table).
            pending_cont = None
            while True:
                if not (0 <= pc < ROM_SIZE):
                    break
                if not (DEPTH_MIN <= depth <= DEPTH_MAX):
                    self.depth_escapes.append({"addr": pc, "depth": depth})
                    break
                key = (pc, rt, depth)
                if key in seen:
                    break
                seen.add(key)

                ins = decode(self.mem, pc)

                # Desync detection, BOTH directions -- checking only one makes
                # the signal depend on DFS visit order and roughly halves its
                # sensitivity, and this is the primary safety metric:
                #   a) our operand bytes were already an instruction START
                #   b) our start lands inside another instruction's OPERANDs
                if self.kind[pc] == CODE_OPERAND or any(
                    self.kind[a] == CODE_START
                    for a in range(pc + 1, min(ins.end, ROM_SIZE))
                ):
                    self.overlaps.append({"addr": pc, "text": ins.text})

                self.instrs[pc] = ins
                self.kind[pc] = CODE_START
                for a in range(pc + 1, min(ins.end, ROM_SIZE)):
                    self.kind[a] = CODE_OPERAND

                # `ld rr,NNNN` then `push rr` pushes a literal return address:
                # the handler that eventually `ret`s will land on NNNN.
                cont = _pushed_literal(prev, ins)
                if cont is not None:
                    pending_cont = cont
                    self.pushed_continuations.append(
                        {"push_addr": ins.addr, "target": cont}
                    )

                prev = ins
                depth = self._apply_depth(ins, depth)
                k = ins.kind

                if k == JUMP_INDIRECT:
                    # Below entry depth means this routine popped its own
                    # return address and is jumping through it: the bytes
                    # after each call site are an inline jump table.
                    r = self.routines.get(rt)
                    if depth < 0 and r is not None:
                        r.consumes_return_addr = True
                        r.dispatches_inline_table = True
                    self.unresolved.append(
                        {"addr": ins.addr, "text": ins.text, "routine": rt,
                         "depth": depth}
                    )
                    break

                if k in (RET, RET_COND):
                    r = self.routines.get(rt) if rt is not None else None
                    if r is not None:
                        r.ret_depths.add(depth)
                        if depth < 0:
                            # `pop hl / ret` -- returns past its caller.
                            r.consumes_return_addr = True
                    if k == RET:
                        break
                    pc = ins.end
                    continue

                if k in (CALL, CALL_COND, RST):
                    t = self._follow_call(work, ins)
                    # An unconditional call to a routine that never returns
                    # normally does not fall through -- the following bytes
                    # are data (a jump table) or another routine's code.
                    # RST counts: DK invokes the dispatcher as one-byte
                    # `rst 0x28`, with the jump table starting at site+1.
                    # Only unconditional CALL/RST: a `call cc,<dispatcher>`
                    # still falls through when the condition fails, so its
                    # following bytes are code. DK dispatches via `rst 0x28`,
                    # so the conditional form does not arise here.
                    if k in (CALL, RST) and t is not None and t in self.noreturn:
                        if t in self.table_dispatchers:
                            self._parse_inline_table(work, ins.end, t, pending_cont)
                        break
                    pc = ins.end
                    continue

                if k == JUMP_COND:
                    self._follow_jump(work, ins, rt, depth)
                    pc = ins.end
                    continue

                if k == JUMP:
                    # Tail call / intra-routine jump: stay in the same routine
                    # so a `ret` downstream is still attributed here.
                    self._follow_jump(work, ins, rt, depth)
                    break

                if k == HALT:
                    pc = ins.end
                    continue

                pc = ins.end

    def _apply_depth(self, ins, depth: int) -> int:
        t = ins.text
        if t.startswith("push "):
            return depth + 2
        if t.startswith("pop "):
            return depth - 2
        # `inc sp` twice then `ret` discards the return address and returns to
        # the caller's CALLER -- the same skip-return idiom as `pop hl / ret`,
        # but reached without a pop. DK uses it at sub_0008/0010/0018 (the
        # rst 0x08/0x10/0x18 conditional-skip helpers). Missing these would
        # let a routine whose every path skips its caller be misclassified as
        # returning normally, and the tracer would then decode the caller's
        # fallthrough -- which may be jump-table data -- as code.
        if t == "inc sp":
            return depth - 1  # one byte, half a slot
        if t == "dec sp":
            return depth + 1
        if t.startswith("ld sp,"):
            # Explicit stack reset (boot does `ld sp,0x6c00` at 0x02b2).
            # Returning 0 is a deliberate approximation, not the truth: after
            # this the frame relationship is gone, so a later `ret` at
            # "depth 0" does not really prove the routine returns to its
            # caller. Only site today is on the reset path, which never
            # returns anywhere, so it is inert. Revisit if one shows up
            # inside a called routine.
            self.stack_tricks.append({"addr": ins.addr, "text": t})
            return 0
        if t.startswith("ex (sp)"):
            self.stack_tricks.append({"addr": ins.addr, "text": t})
        return depth

    def _follow_call(self, work, ins) -> int | None:
        t = ins.target
        if t is None:
            return None
        if not self._in_rom(ins, t):
            return None
        self.call_targets.add(t)
        self.call_sites.setdefault(t, []).append(ins.addr)
        self.routines.setdefault(t, Routine(t))
        work.append((t, t, 0))  # callee starts a fresh frame at depth 0
        return t

    def _follow_jump(self, work, ins, rt: int, depth: int):
        t = ins.target
        if t is None or not self._in_rom(ins, t):
            return
        self.jump_targets.add(t)
        work.append((t, rt, depth))

    def _in_rom(self, ins, t: int) -> bool:
        if 0 <= t < ROM_SIZE:
            return True
        # A target outside the 16KB image (RAM, or a bogus decode). Do not
        # follow -- record it so "the code really does this" stays
        # distinguishable from "we desynced".
        self.out_of_range.append({"addr": ins.addr, "text": ins.text, "target": t})
        return False

    def inline_table_call_sites(self) -> list[dict]:
        """Call sites whose following bytes are an inline jump table."""
        out = []
        for addr, r in sorted(self.routines.items()):
            if not r.dispatches_inline_table:
                continue
            for site in sorted(set(self.call_sites.get(addr, []))):
                ins = self.instrs.get(site)
                out.append(
                    {
                        "dispatcher": addr,
                        "call_site": site,
                        "table_addr": (ins.end if ins else None),
                    }
                )
        return out

    # -- reporting ---------------------------------------------------------

    def runs(self, predicate):
        """Coalesce the byte-kind map into (start, end_exclusive) runs."""
        out = []
        start = None
        for a in range(ROM_SIZE):
            if predicate(self.kind[a]):
                if start is None:
                    start = a
            elif start is not None:
                out.append((start, a))
                start = None
        if start is not None:
            out.append((start, ROM_SIZE))
        return out

    def summary(self) -> dict:
        code_bytes = sum(1 for k in self.kind if k in (CODE_START, CODE_OPERAND))
        table_bytes = sum(1 for k in self.kind if k == TABLE_DATA)
        unreached = self.runs(lambda k: k == UNREACHED)
        # A byte that is both decoded as an instruction and claimed as jump
        # table payload is a contradiction. It is expected mid-fixpoint (it is
        # what drives the table bound tighter); at convergence it means a
        # table is still over-read.
        conflicts = [
            a
            for a in range(ROM_SIZE)
            if self.is_table_data[a] and self.kind[a] in (CODE_START, CODE_OPERAND)
        ]
        return {
            "rom_size": ROM_SIZE,
            "code_bytes": code_bytes,
            "table_data_bytes": table_bytes,
            "analyzed_bytes": code_bytes + table_bytes,
            "unreached_bytes": ROM_SIZE - code_bytes - table_bytes,
            "coverage_pct": round(100.0 * code_bytes / ROM_SIZE, 2),
            "analyzed_pct": round(100.0 * (code_bytes + table_bytes) / ROM_SIZE, 2),
            "table_code_conflicts": conflicts,
            "instructions": len(self.instrs),
            "entry_points": [
                {"addr": a, "why": w} for a, w in sorted(set(self.entries))
            ],
            "routine_count": len(self.call_targets),
            "fixpoint_converged": self.converged,
            "fixpoint_iterations": self.iterations,
            "noreturn_routines": [
                self.routines[a].to_json()
                for a in sorted(self.noreturn)
                if a in self.routines
            ],
            "inline_table_call_sites": self.inline_table_call_sites(),
            "jump_tables": self.jump_tables,
            "unresolved_indirect_jumps": _dedupe(self.unresolved),
            "out_of_range_targets": _dedupe(self.out_of_range),
            "stack_manipulation": _dedupe(self.stack_tricks),
            "decode_overlaps": self.overlaps,
            "depth_escapes": self.depth_escapes,
            "unreached_runs": [
                {"start": s, "end": e, "len": e - s} for s, e in unreached
            ],
        }


def write_listing(tr: Tracer, path: str):
    """Disassembly listing of everything the tracer proved reachable.

    Unreached spans are emitted as a `defb` block with an explicit marker so
    the gaps are visible rather than silently skipped."""
    labels = {}
    for a in sorted(tr.call_targets):
        labels[a] = f"sub_{a:04x}"
    for a in sorted(tr.jump_targets):
        labels.setdefault(a, f"loc_{a:04x}")
    for a, why in tr.entries:
        labels[a] = f"entry_{a:04x}"

    lines = [
        "; Donkey Kong maincpu - reachability-driven disassembly",
        "; Generated by tools/trace.py. Do not edit by hand.",
        f"; coverage: {tr.summary()['coverage_pct']}% of {ROM_SIZE} bytes reachable "
        f"from {len(tr.entries)} entry point(s)",
        ";",
        "; UNREACHED spans are the to-do list -- code paths not yet exercised.",
        "",
    ]

    a = 0
    while a < ROM_SIZE:
        if tr.kind[a] == TABLE_DATA:
            start = a
            while a < ROM_SIZE and tr.kind[a] == TABLE_DATA:
                a += 1
            lines.append("")
            lines.append(f"; ---- inline jump table 0x{start:04x}-0x{a - 1:04x} ----")
            for w in range(start, a, 2):
                lines.append(
                    f"    dw 0x{tr.mem[w] | tr.mem[w + 1] << 8:04x}"
                    f"{'':<18} ; {w:04x}"
                )
            lines.append("")
            continue

        if tr.kind[a] == UNREACHED:
            start = a
            while a < ROM_SIZE and tr.kind[a] == UNREACHED:
                a += 1
            lines.append("")
            lines.append(
                f"; ==== UNREACHED 0x{start:04x}-0x{a - 1:04x} ({a - start} bytes) ===="
            )
            for row in range(start, a, 16):
                chunk = tr.mem[row : min(row + 16, a)]
                hexes = ",".join(f"0x{b:02x}" for b in chunk)
                lines.append(f"    ; {row:04x}:  defb {hexes}")
            lines.append("")
            continue

        ins = tr.instrs.get(a)
        if ins is None:
            a += 1
            continue
        if a in labels:
            lines.append("")
            lines.append(f"{labels[a]}:")
        lines.append(f"    {ins.text:<28} ; {a:04x}  {ins.hexdump()}")
        a = ins.end

    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


def write_blocks_def(tr: Tracer, path: str):
    """z80dasm block-definition file: mark unreached spans as data so an
    independent z80dasm run decodes the same code stream we did. Used by
    tools/verify_decoder.py to cross-check our decoder against z80dasm."""
    # Syntax: `<name>: start <addr> end <addr> type <code|bytes>`
    spans = [(s, e, "code") for s, e in tr.runs(lambda k: k in (CODE_START, CODE_OPERAND))]
    spans += [(s, e, "bytedata") for s, e in tr.runs(lambda k: k in (UNREACHED, TABLE_DATA))]
    spans.sort()
    lines = [
        f"blk_{s:04x}: start 0x{s:04x} end 0x{e:04x} type {t}" for s, e, t in spans
    ]
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


def write_unreached(tr: Tracer, path: str):
    s = tr.summary()
    lines = [
        "# UNREACHED spans -- the coverage to-do list",
        "#",
        "# Each span is ROM we have not proven reachable from a known entry point.",
        "# Causes, in rough order of likelihood:",
        "#   1. data (tables, graphics layout, text) -- fine, will never be code",
        "#   2. reached only via an indirect jump we could not follow statically",
        "#   3. reached only on an input/state-gated path not yet exercised",
        "#",
        "# To resolve: find the entry point (MAME trace), add it to",
        "# tools/entrypoints.json, re-run tools/trace.py.",
        "",
        f"# coverage: {s['coverage_pct']}%  reached={s['code_bytes']}  "
        f"unreached={s['unreached_bytes']}",
        "",
    ]
    for r in sorted(s["unreached_runs"], key=lambda r: -r["len"]):
        lines.append(f"0x{r['start']:04x}-0x{r['end'] - 1:04x}  {r['len']:5d} bytes")
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", default="rom/maincpu.bin")
    ap.add_argument("--out", default="out")
    ap.add_argument("--entrypoints", default="tools/entrypoints.json")
    args = ap.parse_args()

    with open(args.rom, "rb") as f:
        mem = f.read()
    if len(mem) != ROM_SIZE:
        sys.exit(f"expected a {ROM_SIZE}-byte image, got {len(mem)}")

    tr = Tracer(mem)
    for addr, why in BUILTIN_ENTRIES:
        tr.add_entry(addr, why)

    # Discovered entry points (jump-table targets etc.) accumulate here so the
    # trace can be re-run as coverage grows.
    if os.path.exists(args.entrypoints):
        with open(args.entrypoints) as f:
            for e in json.load(f):
                # Execution-trace run starts are evidence of CODE, not of a
                # routine entry -- see add_entry().
                prov = e.get("provenance", "")
                tr.add_entry(
                    int(str(e["addr"]), 0),
                    e.get("why", "discovered"),
                    is_routine="instruction-fetch trace" not in prov,
                )

    tr.run()

    os.makedirs(args.out, exist_ok=True)
    summary = tr.summary()
    with open(os.path.join(args.out, "coverage.json"), "w") as f:
        json.dump(summary, f, indent=2)
    write_listing(tr, os.path.join(args.out, "dk.asm"))
    write_blocks_def(tr, os.path.join(args.out, "blocks.def"))
    write_unreached(tr, os.path.join(args.out, "unreached.txt"))

    print(f"entry points      : {len(tr.entries)}")
    print(f"instructions      : {summary['instructions']}")
    print(
        f"code coverage     : {summary['coverage_pct']}%  "
        f"({summary['code_bytes']}/{ROM_SIZE} bytes)"
    )
    print(
        f"analyzed (+tables): {summary['analyzed_pct']}%  "
        f"({summary['table_data_bytes']} bytes of jump table)"
    )
    print(f"routines (CALLed) : {summary['routine_count']}")
    print(f"jump tables       : {len(tr.jump_tables)}")
    print(f"unresolved JP (rr): {len(summary['unresolved_indirect_jumps'])}")
    print(f"out-of-range tgts : {len(summary['out_of_range_targets'])}")
    print(f"decode overlaps   : {len(tr.overlaps)}")
    print(f"table/code conflct: {len(summary['table_code_conflicts'])}")
    print(f"unreached runs    : {len(summary['unreached_runs'])}")

    # Non-convergence must be loud: an unconverged run is still tracing bogus
    # fallthroughs, which makes coverage go UP (81% at max_iterations=2 vs the
    # correct 34%). A silent failure here reads like a better result.
    if not tr.converged:
        print(
            f"\nERROR: fixpoint did NOT converge in {tr.iterations} iterations.\n"
            "       Coverage above is INFLATED -- bogus fallthroughs are still\n"
            "       being traced. Do not trust this output.",
            file=sys.stderr,
        )
        return 1
    if summary["table_code_conflicts"]:
        print(
            f"\nWARNING: {len(summary['table_code_conflicts'])} byte(s) are both "
            "decoded code and jump-table payload -- a table is over-read.",
            file=sys.stderr,
        )
    print(f"\nconverged in {tr.iterations} iterations")
    return 0


if __name__ == "__main__":
    sys.exit(main())
