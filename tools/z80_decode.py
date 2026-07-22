# SPDX-License-Identifier: GPL-3.0-only
"""Z80 instruction decoder.

Built from the structural x/y/z/p/q decomposition of the opcode byte rather
than a hand-typed 256-entry table, so coverage of the instruction set is
complete by construction instead of by proofreading.

    opcode = 0b xx yyy zzz     p = y >> 1     q = y & 1

Used by trace.py (the recursive-descent tracer) and by the translation
tooling, which needs exact mnemonics for the ROM-address header comments on
every translated routine.

Cross-validated against z80dasm 1.2.0 by tools/verify_decoder.py.
"""

from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# Control-flow classification.
#
# The tracer only cares about how an instruction moves PC. Everything else is
# NORMAL. `target` is filled in when it is statically known.
# ---------------------------------------------------------------------------

NORMAL = "normal"  # falls through
JUMP = "jump"  # unconditional, target known -> follow target only
JUMP_COND = "jump_cond"  # follow target AND fallthrough
CALL = "call"  # follow target AND fallthrough (assumes the RET returns)
CALL_COND = "call_cond"
RST = "rst"  # call to a fixed page-zero address
RET = "ret"  # terminates this flow
RET_COND = "ret_cond"  # falls through
JUMP_INDIRECT = "jump_indirect"  # JP (HL)/(IX)/(IY) -- UNRESOLVED, terminates
HALT = "halt"

# Flows that stop the tracer walking forward from this instruction.
TERMINAL = {JUMP, RET, JUMP_INDIRECT}


@dataclass
class Instr:
    addr: int
    length: int
    text: str
    kind: str = NORMAL
    target: int | None = None
    raw: bytes = field(default=b"", repr=False)

    @property
    def end(self) -> int:
        return self.addr + self.length

    def hexdump(self) -> str:
        return " ".join(f"{b:02x}" for b in self.raw)


R = ["b", "c", "d", "e", "h", "l", "(hl)", "a"]
RP = ["bc", "de", "hl", "sp"]
RP2 = ["bc", "de", "hl", "af"]
CC = ["nz", "z", "nc", "c", "po", "pe", "p", "m"]
ALU = ["add a,", "adc a,", "sub ", "sbc a,", "and ", "xor ", "or ", "cp "]
ROT = ["rlc", "rrc", "rl", "rr", "sla", "sra", "sll", "srl"]
IM = ["0", "0", "1", "2", "0", "0", "1", "2"]
BLI = {
    (4, 0): "ldi", (4, 1): "cpi", (4, 2): "ini", (4, 3): "outi",
    (5, 0): "ldd", (5, 1): "cpd", (5, 2): "ind", (5, 3): "outd",
    (6, 0): "ldir", (6, 1): "cpir", (6, 2): "inir", (6, 3): "otir",
    (7, 0): "lddr", (7, 1): "cpdr", (7, 2): "indr", (7, 3): "otdr",
}
AF_ALT = ["rlca", "rrca", "rla", "rra", "daa", "cpl", "scf", "ccf"]


def _u8(mem: bytes, a: int) -> int:
    # Past the end of the supplied image reads as 0x00, matching MAME: dkong's
    # ROM_REGION is 64KB but only 0x0000-0x3FFF is populated, and MAME
    # zero-fills the rest. Without this, decoding a multi-byte opcode in the
    # last bytes of the image raises IndexError, breaking this module's
    # promise that any byte sequence decodes to something.
    a &= 0xFFFF
    return mem[a] if a < len(mem) else 0x00


def _u16(mem: bytes, a: int) -> int:
    return _u8(mem, a) | (_u8(mem, a + 1) << 8)


def _s8(mem: bytes, a: int) -> int:
    v = _u8(mem, a)
    return v - 256 if v & 0x80 else v


def _nn(v: int) -> str:
    return f"0x{v:04x}"


def _n(v: int) -> str:
    return f"0x{v:02x}"


def _disp(d: int) -> str:
    return f"+0x{d:02x}" if d >= 0 else f"-0x{-d:02x}"


def decode(mem: bytes, addr: int) -> Instr:
    """Decode one instruction at `addr`. Never raises on bad bytes -- every
    256-value opcode maps to something, which is what makes a data region
    decode as garbage instructions rather than blowing up the tracer."""
    op = _u8(mem, addr)
    if op == 0xCB:
        return _decode_cb(mem, addr)
    if op == 0xED:
        return _decode_ed(mem, addr)
    if op in (0xDD, 0xFD):
        return _decode_indexed(mem, addr, "ix" if op == 0xDD else "iy")
    return _decode_base(mem, addr)


def _mk(mem: bytes, addr: int, length: int, text: str, kind=NORMAL, target=None) -> Instr:
    raw = bytes(_u8(mem, addr + i) for i in range(length))
    return Instr(addr=addr, length=length, text=text, kind=kind, target=target, raw=raw)


def _decode_base(mem: bytes, addr: int) -> Instr:
    op = _u8(mem, addr)
    x, y, z = op >> 6, (op >> 3) & 7, op & 7
    p, q = y >> 1, y & 1
    mk = lambda *a, **kw: _mk(mem, addr, *a, **kw)  # noqa: E731

    if x == 0:
        if z == 0:
            if y == 0:
                return mk(1, "nop")
            if y == 1:
                return mk(1, "ex af,af'")
            if y == 2:
                t = (addr + 2 + _s8(mem, addr + 1)) & 0xFFFF
                # DJNZ is a conditional branch: taken while B != 0, falls
                # through on the final iteration.
                return mk(2, f"djnz {_nn(t)}", JUMP_COND, t)
            if y == 3:
                t = (addr + 2 + _s8(mem, addr + 1)) & 0xFFFF
                return mk(2, f"jr {_nn(t)}", JUMP, t)
            t = (addr + 2 + _s8(mem, addr + 1)) & 0xFFFF
            return mk(2, f"jr {CC[y - 4]},{_nn(t)}", JUMP_COND, t)
        if z == 1:
            if q == 0:
                return mk(3, f"ld {RP[p]},{_nn(_u16(mem, addr + 1))}")
            return mk(1, f"add hl,{RP[p]}")
        if z == 2:
            if q == 0:
                if p == 0:
                    return mk(1, "ld (bc),a")
                if p == 1:
                    return mk(1, "ld (de),a")
                if p == 2:
                    return mk(3, f"ld ({_nn(_u16(mem, addr + 1))}),hl")
                return mk(3, f"ld ({_nn(_u16(mem, addr + 1))}),a")
            if p == 0:
                return mk(1, "ld a,(bc)")
            if p == 1:
                return mk(1, "ld a,(de)")
            if p == 2:
                return mk(3, f"ld hl,({_nn(_u16(mem, addr + 1))})")
            return mk(3, f"ld a,({_nn(_u16(mem, addr + 1))})")
        if z == 3:
            return mk(1, f"{'inc' if q == 0 else 'dec'} {RP[p]}")
        if z == 4:
            return mk(1, f"inc {R[y]}")
        if z == 5:
            return mk(1, f"dec {R[y]}")
        if z == 6:
            return mk(2, f"ld {R[y]},{_n(_u8(mem, addr + 1))}")
        return mk(1, AF_ALT[y])

    if x == 1:
        if y == 6 and z == 6:
            return mk(1, "halt", HALT)
        return mk(1, f"ld {R[y]},{R[z]}")

    if x == 2:
        return mk(1, f"{ALU[y]}{R[z]}")

    # x == 3
    if z == 0:
        return mk(1, f"ret {CC[y]}", RET_COND)
    if z == 1:
        if q == 0:
            return mk(1, f"pop {RP2[p]}")
        if p == 0:
            return mk(1, "ret", RET)
        if p == 1:
            return mk(1, "exx")
        if p == 2:
            return mk(1, "jp (hl)", JUMP_INDIRECT)
        return mk(1, "ld sp,hl")
    if z == 2:
        t = _u16(mem, addr + 1)
        return mk(3, f"jp {CC[y]},{_nn(t)}", JUMP_COND, t)
    if z == 3:
        if y == 0:
            t = _u16(mem, addr + 1)
            return mk(3, f"jp {_nn(t)}", JUMP, t)
        if y == 2:
            return mk(2, f"out ({_n(_u8(mem, addr + 1))}),a")
        if y == 3:
            return mk(2, f"in a,({_n(_u8(mem, addr + 1))})")
        if y == 4:
            return mk(1, "ex (sp),hl")
        if y == 5:
            return mk(1, "ex de,hl")
        if y == 6:
            return mk(1, "di")
        return mk(1, "ei")
    if z == 4:
        t = _u16(mem, addr + 1)
        return mk(3, f"call {CC[y]},{_nn(t)}", CALL_COND, t)
    if z == 5:
        if q == 0:
            return mk(1, f"push {RP2[p]}")
        t = _u16(mem, addr + 1)
        return mk(3, f"call {_nn(t)}", CALL, t)
    if z == 6:
        return mk(2, f"{ALU[y]}{_n(_u8(mem, addr + 1))}")
    return mk(1, f"rst {_n(y * 8)}", RST, y * 8)


def _decode_cb(mem: bytes, addr: int) -> Instr:
    op = _u8(mem, addr + 1)
    x, y, z = op >> 6, (op >> 3) & 7, op & 7
    if x == 0:
        text = f"{ROT[y]} {R[z]}"
    elif x == 1:
        text = f"bit {y},{R[z]}"
    elif x == 2:
        text = f"res {y},{R[z]}"
    else:
        text = f"set {y},{R[z]}"
    return _mk(mem, addr, 2, text)


def _decode_ed(mem: bytes, addr: int) -> Instr:
    op = _u8(mem, addr + 1)
    x, y, z = op >> 6, (op >> 3) & 7, op & 7
    p, q = y >> 1, y & 1
    mk = lambda *a, **kw: _mk(mem, addr, *a, **kw)  # noqa: E731

    if x == 1:
        if z == 0:
            return mk(2, "in f,(c)" if y == 6 else f"in {R[y]},(c)")
        if z == 1:
            return mk(2, "out (c),0" if y == 6 else f"out (c),{R[y]}")
        if z == 2:
            return mk(2, f"{'sbc' if q == 0 else 'adc'} hl,{RP[p]}")
        if z == 3:
            nn = _nn(_u16(mem, addr + 2))
            if q == 0:
                return mk(4, f"ld ({nn}),{RP[p]}")
            return mk(4, f"ld {RP[p]},({nn})")
        if z == 4:
            return mk(2, "neg")
        if z == 5:
            # RETN restores IFF1 from IFF2 -- it is the NMI return. DK's vblank
            # handler at 0x0066 ends with one.
            return mk(2, "reti" if y == 1 else "retn", RET)
        if z == 6:
            return mk(2, f"im {IM[y]}")
        return mk(2, ["ld i,a", "ld r,a", "ld a,i", "ld a,r", "rrd", "rld", "nop", "nop"][y])

    if x == 2 and z <= 3 and y >= 4:
        return mk(2, BLI[(y, z)])

    # Everything else in the ED page is an unofficial 2-byte no-op.
    return mk(2, f"defb 0xed,{_n(op)}")


# Base opcodes where (hl) is a real memory operand, and therefore becomes
# (IX+d)/(IY+d) under a DD/FD prefix -- costing one extra displacement byte.
def _uses_hl_mem(x: int, y: int, z: int) -> bool:
    if x == 0:
        return z in (4, 5, 6) and y == 6
    if x == 1:
        return y == 6 or z == 6
    if x == 2:
        return z == 6
    return False


def _decode_indexed(mem: bytes, addr: int, ix: str) -> Instr:
    op = _u8(mem, addr + 1)
    mk = lambda *a, **kw: _mk(mem, addr, *a, **kw)  # noqa: E731

    # A prefix followed by another prefix: the first one is discarded and the
    # second takes over. Falling through to _decode_base here would decode
    # 0xDD/0xED/0xFD as `call nn` (they all land in the x=3,z=5,q=1 branch),
    # inventing a CALL whose target is read from the wrong bytes -- which the
    # tracer would then follow as a bogus routine entry point.
    if op in (0xDD, 0xED, 0xFD):
        return mk(1, f"defb 0x{_u8(mem, addr):02x} ; discarded prefix")

    if op == 0xCB:
        # DD CB d op -- always 4 bytes. The operand is always (IX+d); the r
        # field selects an undocumented copy-to-register variant.
        d = _s8(mem, addr + 2)
        sub = _u8(mem, addr + 3)
        x, y, z = sub >> 6, (sub >> 3) & 7, sub & 7
        operand = f"({ix}{_disp(d)})"
        if x == 0:
            text = f"{ROT[y]} {operand}"
        elif x == 1:
            text = f"bit {y},{operand}"
        elif x == 2:
            text = f"res {y},{operand}"
        else:
            text = f"set {y},{operand}"
        if x != 1 and z != 6:
            text += f",{R[z]}"  # undocumented store-to-register form
        return mk(4, text)

    x, y, z = op >> 6, (op >> 3) & 7, op & 7
    p, q = y >> 1, y & 1

    # JP (IX) / JP (IY)
    if op == 0xE9:
        return mk(2, f"jp ({ix})", JUMP_INDIRECT)
    if op == 0xF9:
        return mk(2, f"ld sp,{ix}")
    if op == 0xE3:
        return mk(2, f"ex (sp),{ix}")
    if op == 0xE5:
        return mk(2, f"push {ix}")
    if op == 0xE1:
        return mk(2, f"pop {ix}")
    if op == 0x21:
        return mk(4, f"ld {ix},{_nn(_u16(mem, addr + 2))}")
    if op == 0x22:
        return mk(4, f"ld ({_nn(_u16(mem, addr + 2))}),{ix}")
    if op == 0x2A:
        return mk(4, f"ld {ix},({_nn(_u16(mem, addr + 2))})")
    if op == 0x23:
        return mk(2, f"inc {ix}")
    if op == 0x2B:
        return mk(2, f"dec {ix}")
    if x == 0 and z == 1 and q == 1:  # ADD IX,rp -- rp[2] reads as IX
        rp = ix if p == 2 else RP[p]
        return mk(2, f"add {ix},{rp}")

    if op == 0x76:
        # HALT, not `ld (ix+d),(hl)` -- that instruction does not exist, and
        # _uses_hl_mem(1,6,6) would otherwise claim a displacement byte.
        return mk(2, "halt", HALT)

    if _uses_hl_mem(x, y, z):
        d = _s8(mem, addr + 2)
        operand = f"({ix}{_disp(d)})"
        if x == 0 and z == 6:  # LD (IX+d),n -- 4 bytes
            return mk(4, f"ld {operand},{_n(_u8(mem, addr + 3))}")
        if x == 0 and z == 4:
            return mk(3, f"inc {operand}")
        if x == 0 and z == 5:
            return mk(3, f"dec {operand}")
        if x == 1:
            if y == 6:
                return mk(3, f"ld {operand},{R[z]}")
            return mk(3, f"ld {R[y]},{operand}")
        if x == 2:
            return mk(3, f"{ALU[y]}{operand}")

    # No (HL) operand: h/l become the undocumented ixh/ixl halves, and the
    # instruction is just the base one plus the prefix byte.
    base = _decode_base(mem, addr + 1)
    text = base.text
    for reg, half in (("h", f"{ix}h"), ("l", f"{ix}l")):
        text = _sub_reg(text, reg, half)
    target = base.target
    return _mk(mem, addr, base.length + 1, text, base.kind, target)


def _sub_reg(text: str, reg: str, repl: str) -> str:
    """Replace a bare register name, not a substring of a hex literal or of
    another mnemonic (`hl`, `call`, `0x0l`...)."""
    out = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == reg and (i == 0 or not text[i - 1].isalnum()) and (
            i + 1 >= len(text) or not text[i + 1].isalnum()
        ):
            out.append(repl)
        else:
            out.append(ch)
        i += 1
    return "".join(out)
