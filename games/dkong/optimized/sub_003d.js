// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_003d — hand-optimized rewrite of the translated routine at ROM 0x003D,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. This routine calls nothing — it is a pure leaf that walks
 * caller-supplied memory — so it imports no callee (all inter-routine calls go
 * through `m.call(0xADDR)` elsewhere) and touches no fixed game address, so nothing
 * is imported from ram.js either: HL/DE/B/C are all supplied by the caller.
 */

/**
 * sub_003d -- the shared "add C to a strided run of bytes" primitive.
 * [ROM 0x003D-0x0043; also the fall-through body of the `rst 0x38` entry at 0x0038]
 *
 *   003d  79        ld   a,c        ; A = the addend
 *   003e  86        add  a,(hl)     ; A += (HL)      -- 8-bit, WRAPS
 *   003f  77        ld   (hl),a     ; (HL) = A
 *   0040  19        add  hl,de      ; HL += stride   -- writes H/N/C (S/Z/PV kept)
 *   0041  10 fa     djnz 0x003d     ; --B; loop while B != 0
 *   0043  c9        ret             ; serves BOTH entry points
 *
 * WHAT IT DOES. Adds the 8-bit value C into each of B bytes, starting at HL and
 * stepping HL by DE (the stride) between bytes: `for k in 0..B-1: (HL + k*DE) += C`.
 * A general primitive with THREE ways in, all sharing this one `ret`:
 *   - `rst 0x38` -> loc_0038, which fixes DE = 4 and B = 0x0A (ten bytes, stride 4)
 *     then FALLS THROUGH to here. This is the dominant caller: it lays out the
 *     stride-4 fields of the 0x6908 sprite-object block during board/cutscene setup
 *     (observed live from frame ~160 with B=0x0A and C in {0x30, 0x99, 0xFC, ...}).
 *   - direct `call 0x003d` with the caller's own DE/B/C (e.g. loc_1880 uses B=2,
 *     C=0x28, HL=0x6903, DE=4; sub_0da7's 100m setup uses B=0x0A with two runs).
 *
 * INPUTS  (read):  C (addend), B (count), HL (base pointer), DE (stride), and the
 *                  B bytes at HL, HL+DE, ... that it read-modify-writes.
 * OUTPUTS (written): those B bytes each += C (8-bit wrap); HL advanced by B*DE;
 *                  A = C + (last byte read, pre-write); B = 0; F = the FINAL
 *                  `add hl,de`'s flags (djnz clears no flags).
 *
 * IDIOMS worth stating:
 *   - `add a,(hl)` is 8-bit and WRAPS. C = 0xFC is -4, so that caller DECREMENTS
 *     each byte. The per-byte add's carry-out is dead — overwritten by the next
 *     `add hl,de` every pass — so only the final add-hl's flags survive.
 *   - `add hl,de` MUST be modelled as addHl (not a bare 16-bit add): it writes
 *     H/N/C, and the LAST iteration's carry-out survives `djnz` + `ret` and reaches
 *     the caller. A bare add would leave F wrong; the unit gate compares F, so a
 *     bare-add substitution is caught even on the normal HL=0x69xx run (where the
 *     carry-out is 0 but H/N still differ). Same shape as sub_11d3.
 *   - `djnz` decrements B THEN tests, so this is a do-while: the body always runs at
 *     least once, and B = 0 on entry would run 256 passes. B is never checked for
 *     zero; the rst entry hard-codes 0x0A and no direct call site passes 0, but the
 *     do-while mirrors the 256-pass semantics exactly regardless.
 *
 * ATOMICITY / CYCLES -- kept PER-INSTRUCTION (each ROM instruction's m.step charge
 *   is preserved individually). sub_003d is a foundational LEAF helper reached from
 *   30+ sites via both `rst 0x38` (loc_0038) and direct `call 0x003d`, spanning board
 *   setup, the opening cutscene's object staging, and per-frame object updates. The
 *   brief's rule ATOMICITY-IS-PER-CALL-PATH governs: a collapse is safe only if the
 *   vblank NMI can never land inside the routine on ANY call path, and proving that
 *   for every one of those 30+ sites is exactly the exhaustive per-path proof the
 *   rule says not to shortcut. A collapse experiment stayed EQUAL over a 220-frame
 *   driven run, but that is the "short run is NOT proof" case the brief names — the
 *   NMI simply never landed inside sub_003d on that trajectory. This is the same
 *   widely-reached-leaf shape as sub_0018 / sub_0020, which are kept per-instruction
 *   for this reason; per-instruction is always correct, so that is what is kept here.
 *   The per-instruction charges also reproduce the oracle's exact cycle distribution,
 *   so every branch's total is preserved trivially. No hardware (0x7Dxx) writes here
 *   -- only caller-supplied work RAM -- so there is no write-bus-cycle trace at stake.
 *
 * FLAGS -- kept verbatim. The final `add hl,de` carry-out is a live output the caller
 *   can consume (`ret`s straight through), so regs.addHl is preserved and A is left
 *   as the oracle leaves it. The unit gate compares the whole register file (F and A
 *   included), which pins both.
 */
export function sub_003d(m) {
  const { regs, mem } = m;

  // do-while, not a for-loop: djnz decrements THEN tests, so the body runs at least
  // once (and B == 0 would run 256 passes). The whole routine is this loop; the
  // `djnz` at 0x0041 targets 0x003D, this entry point.
  do {
    // A = C + (HL); write it back. 8-bit, wraps (C = 0xFC decrements).
    regs.a = regs.c;
    m.step(0x003e, 4); // ld a,c
    regs.add(mem.read8(regs.hl)); // add a,(hl) -- sets A + F; this carry is dead
    m.step(0x003f, 7);
    mem.write8(regs.hl, regs.a); // ld (hl),a
    m.step(0x0040, 7);

    // Step HL by the stride. add hl,de writes H/N/C (S/Z/PV preserved); the FINAL
    // iteration's carry-out escapes to the caller, so addHl is required.
    regs.addHl(regs.de); // add hl,de
    m.step(0x0041, 11);

    regs.djnz(); // djnz -- --B, sets no flags
    m.step(regs.b !== 0 ? 0x003d : 0x0043, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);

  m.ret(); // 0043 -- serves BOTH entry points (rst-0x38 fall-through and direct call)
}
