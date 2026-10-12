![Time Pilot](timeplt.jpg)

>>> deploy:<br>
>>>   +timeplt.jpg<br>
>>>   Hardware.md<br>
>>>   RAMUse.md<br>
>>>   %Code.md<br>

# Time Pilot

**Disassembled by Karl Stiefvater**

**Time Pilot** (Konami, 1982) is a free-roaming multi-directional aerial shooter. Your
fighter stays fixed in the centre of the screen and turns to face the direction you steer
with the **8-way joystick**; the whole sky scrolls and banks around it, and you **fire in
the direction the ship is facing**. The parallax reads as forward flight, but mechanically
it is the world that moves past a centred plane.

The game runs through **five time eras** — **1910, 1940, 1970, 1982 and 2001** — in strict
order. In each era you shoot down enough enemy craft to make that era's **Mother-Ship**
appear, destroy it, and warp forward to the next era. Along the way, **parachuting pilots**
drift down across the field and are worth bonus points if you collect them.

There is no ending: clearing the final era wraps back to the first, and on seven of the
eight difficulty settings each round from the sixth on opens on a higher difficulty rung
than the same era did on the first pass (the eighth setting opens every round on rung 15). Run out of fighters and the game is over, with a chance to enter your
initials on the high-score table.

## Navigation

  * [Hardware](Hardware.md) — CPU, memory map, I/O ports, LS259 control latch, sprite format
  * [Work RAM](RAMUse.md) — the named work-RAM cells (0xA800–0xAFFF)
  * [Main CPU code](Code.md) — the annotated Z80 disassembly

## About this disassembly

This disassembly, RAM map, and game description were **produced by AI** and are
**verified against the original ROM and against MAME**. The recovered code was checked
to reproduce the ROM's own execution frame-for-frame, and the game model was confirmed
by observing the real game running under MAME. It is offered here transparently, as AI
work, precisely because it is machine-checked rather than hand-asserted — so verify it
against that evidence. Project: [https://github.com/qarl/arcade-js](https://github.com/qarl/arcade-js).

The disassembly covers the code reached from the reset vector (`0x0000`, which jumps
straight to `0x07B1`) and the vblank NMI (`0x0066`), together with code the static trace
could not follow from them — the restart vectors, handlers entered through jump tables and
the command ring, and a few other runs that MAME was seen to execute — added as extra
entry points. ROM data tables (tilemaps, lookup tables, text) and spans never reached
are shown as data blocks: a `; ---- $start-$end: ... ----` line over rows of raw bytes. Some
tables are also the landing of an anti-tamper jump that runs their bytes as code on a modified
image; those are shown as data with a note naming the jump, except a few kept as the code they
run, each with a note at the landing saying what the bytes are. The split between data and code
follows the traced control flow, so a data table reached only by such a jump can still read as
code where it has not been spotted.
