// SPDX-License-Identifier: GPL-3.0-only
//
// Donkey Kong sound-command map -- DATA ONLY. No logic, no imports, no engine
// coupling. A player (core/audio.js) reads this; this file never reads it back.
//
// WHAT THE HARDWARE IS
// --------------------
// The Z80 has exactly three sound-side write surfaces (boards/dkong/memory.js,
// mirrored in boards/dkong/hardware.json "writeRanges"):
//
//   0x7C00        ls175.3d  4-bit tune latch  -> read by the I8035 sound CPU
//   0x7D00-0x7D07 ls259.6h  addressable latch -> bit N := bit0 of the value
//   0x7D80        (write side only) -> asserts/clears the I8035's INT line
//
// The ls259.6h bits do NOT all go to the same place (dkong_a.cpp:1322-1350):
//   bit 0,1,2  -> "discrete" netlist inputs DS_SOUND0/1/2  (analog circuits)
//   bit 3      -> virtual port-2 bit 5 -> I8035 P2.5   (a CPU input pin)
//   bit 4      -> I8035 T1 (inverted, bit4_q_r)        (a CPU input pin)
//   bit 5      -> I8035 T0 (inverted, bit5_q_r)        (a CPU input pin)
//   bit 6,7    -> DS_SOUND6/7, which do not exist in dkong2b_discrete -> no-op
//
// So walk/jump/boom are ANALOG circuits with no sample data in any ROM, and
// everything else is produced by the I8035 program writing an 8-bit DAC.
// See ./README.md for the full argument and the extraction consequences.
//
// HOW THE ROM DRIVES IT
// ---------------------
// The Z80 never writes these latches from game code. It writes a scheduling
// block in RAM and one service routine (ROM 0x00E0, called from the NMI at
// 0x00BF) pushes it to the hardware once per frame:
//
//   0x6080..0x6087  per-trigger frame counters. Nonzero -> decrement and write
//                   1 to 0x7D00+n; zero -> write 0. Game code stores 3.
//   0x6088          same, for the 0x7D80 IRQ line.
//   0x6089          BACKGROUND tune -> 0x7C00 when 0x608B == 0. Held => loops.
//   0x608A/0x608B   PRIORITY tune + frame count. Overrides 0x6089 while
//                   0x608B != 0. Game code stores 3 => a 3-frame pulse.
//   ROM 0x011C      silence-everything: zeroes 0x7D00-0x7D07, 0x7D80, 0x7C00
//                   and 0x6080-0x608B.
//
// LATCH MASK: ls175.3d is configured maskout 0xF0 / xorvalue 0x0F
// (dkong_a.cpp:1318-1320), applied on READ, so ONLY THE LOW NIBBLE MATTERS and
// the I8035 sees its one's complement. Independently measured: 0x10-0x1F mirror
// 0x00-0x0F, and 0x20/0x40/0x80 behave exactly like 0x00. The keys below are the
// value the Z80 WRITES, which is what a JS player observes.
//
// TWO CLASSIFICATION FIELDS, DELIBERATELY SEPARATE
// ------------------------------------------------
//   kind      how the ROM USES the command.
//               "oneshot" -- fired as a 3-frame pulse (trigger counters
//                            0x6080-0x6088, or the priority tune slot 0x608A)
//               "loop"    -- parked in the background tune slot 0x6089 and held
//                            until the ROM changes it
//               "none"    -- not a sound
//   measured  what the HARDWARE actually does when the line is driven, from a
//             direct stimulus sweep of real MAME 0.288 (see README "Empirical
//             basis"). `behaviour: "level"` means the clip length tracks how
//             long the bit is held; `"oneshot"` means the hold length is
//             irrelevant. `audible: null` means "not measured in isolation".
//
// These two are NOT the same thing and conflating them is the mistake that
// produces a wrong player. Example: trigger 0 (walk) is LEVEL-driven hardware,
// but the ROM only ever holds it for 3 frames -- so the in-game footstep is a
// short blip, not a 3-second drone. A player that gates walk on the latch bit is
// right; one that fires a fixed 3s sample on the rising edge is wrong.
//
// CONFIDENCE IS LOAD-BEARING, AND IT IS ABOUT THE *NAME*.
// "confirmed" = a MAME-source citation AND either an observed ROM write in a
// real MAME 0.288 trace or an unambiguous ROM site. "inferred" = a located ROM
// write site whose meaning is read off surrounding code (and usually agrees with
// MAME's comment) but which no capture has ever exercised. "unknown" = exactly
// that. A `measured` block says a line makes SOME sound; it never says WHICH
// sound, so it can raise no confidence on its own. Do not upgrade a field
// without new evidence -- a wrong sound map is worse than a thin one.

/** Allowed values. `none` = the line exists but produces no sound on this board. */
export const KINDS = ["oneshot", "loop", "none"];
export const SOURCES = ["discrete", "i8035", "none"];
export const CONFIDENCE = ["confirmed", "inferred", "unknown"];
/** Measured hardware behaviour under direct stimulus. null = not measured. */
export const BEHAVIOURS = ["level", "level+decay", "oneshot", "silent", null];

/** The three write surfaces, as addresses. */
export const PORTS = {
  latch: 0x7c00, // ls175.3d, 4-bit tune select (low nibble only)
  triggerBase: 0x7d00, // ls259.6h, bit N at 0x7D00+N
  triggerCount: 8,
  irq: 0x7d80, // write side only: I8035 /INT
};

export const SOUNDS = {
  ports: PORTS,

  // ---------------------------------------------------------------------
  // ls259.6h -- 0x7D00 + index, value taken from bit 0.
  // Measured: 6 of the 8 bits make sound; bits 6 and 7 are silent, and stay
  // silent even when held across a full latch sweep (so they are not mode,
  // bank or page selects either).
  // ---------------------------------------------------------------------
  triggers: {
    0: {
      name: "walk",
      kind: "oneshot",
      source: "discrete",
      confidence: "confirmed",
      fires: "one per Mario footstep while walking or climbing",
      note:
        "4049 inverter oscillator + 555 VCO + RC trigger; dkong_a.cpp:415-436 " +
        "('Walk' block, driven by DS_SOUND0_INV). No sample data exists. The " +
        "circuit is LEVEL-gated, so the ROM's 3-frame hold is what makes it a " +
        "footstep rather than a drone -- gate a sample on the bit, do not fire a " +
        "fixed-length one.",
      rom: ["0x1D8F sets 0x6080=3", "callers 0x1CC7 (walk anim), 0x1D61"],
      measured: {
        audible: true,
        behaviour: "level",
        peak: 14222,
        clipSec: { hold0_25: 0.37, hold3_0: 3.13 },
      },
      evidence: [
        "mame dkong_a.cpp:1323 bit0 -> DS_SOUND0_INP",
        "mame dkong.cpp:194 '7d00 digital sound trigger - walk'",
        "trace coin_start TAPE_MODE=play: 7D00 rises every 12 frames only while Right is held",
        "stimulus sweep: audible, clip length tracks hold (0.37s @0.25s, 3.13s @3.0s)",
      ],
    },
    1: {
      name: "jump",
      kind: "oneshot",
      source: "discrete",
      confidence: "confirmed",
      fires: "Mario leaves the ground",
      note:
        "4049 inverter oscillator + 555 VCO, dkong_a.cpp:378-410 ('Jump' block, " +
        "DS_SOUND1_INV). No sample data exists. Measured as a true one-shot: the " +
        "hold length does not change the clip.",
      rom: ["0x1BAC sets 0x6081=3, in the jump-start routine"],
      measured: {
        audible: true,
        behaviour: "oneshot",
        peak: 4532,
        clipSec: { hold0_25: 0.514, hold3_0: 0.512 },
      },
      evidence: [
        "mame dkong_a.cpp:1324 bit1 -> DS_SOUND1_INP",
        "mame dkong.cpp:195 '7d01 digital sound trigger - jump'",
        "trace coin_start TAPE_MODE=play: 7D01 rises exactly every 48 frames, " +
          "which is the tape's JUMP_PERIOD",
        "stimulus sweep: audible, fixed 0.51s regardless of hold",
      ],
    },
    2: {
      name: "boom",
      kind: "oneshot",
      source: "discrete",
      confidence: "confirmed",
      fires:
        "Kong's stomp/chest-pound animation (every 32 frames while he pounds), " +
        "a barrel dropping into the oil drum, Kong landing after his fall",
      note:
        "LFSR noise + LS161 divider + RC envelope, dkong_a.cpp:356-376 ('Stomp' " +
        "block, DS_SOUND2_INV). No sample data exists. Measured as a true one-shot " +
        "at 1.825s -- much longer than the ROM's 3-frame hold, so it must be fired " +
        "on the rising edge and allowed to run.",
      rom: [
        "0x044D Kong stomp animation (gated `and 0x1F` -> every 32 frames)",
        "0x0B45 / 0x0B8E intro stomps",
        "0x24D6 object reaching the oil drum at the bottom-left",
        "0x18BE Kong hits the ground at the end of the rivet board",
        "0x19CD board-complete transition",
      ],
      measured: {
        audible: true,
        behaviour: "oneshot",
        peak: 12093,
        clipSec: { hold0_25: 1.825, hold3_0: 1.825 },
      },
      evidence: [
        "mame dkong_a.cpp:1325 bit2 -> DS_SOUND2_INP",
        "mame dkong.cpp:196 '7d02 digital sound trigger - boom (gorilla stomps foot)'",
        "trace coin_start: 6 rises during the intro climb, then every 32 frames on " +
          "50m/75m/100m where Kong pounds",
        "stimulus sweep: audible, fixed 1.825s regardless of hold",
      ],
    },
    3: {
      name: "coin_or_spring",
      kind: "oneshot",
      source: "i8035",
      confidence: "confirmed",
      fires: "a coin is inserted; and each spring launched on 75m",
      note:
        "NOT a discrete circuit: this bit is an INPUT PIN on the sound CPU " +
        "(latch bit 3 -> virtual port-2 bit 5 -> I8035 P2.5, dkong_a.cpp:1338). " +
        "The sound is whatever the I8035 program does when it sees that pin, and " +
        "measurement says it follows the level.",
      rom: [
        "0x019A sets 0x6083=3 in the coin/credit routine (which reads IN2 bit 7 at 0x017B)",
        "0x2EA1 sets 0x6083=3 in the spring object code",
      ],
      measured: {
        audible: true,
        behaviour: "level",
        peak: 16193,
        clipSec: { hold0_25: 0.574, hold3_0: 3.095 },
      },
      evidence: [
        "mame dkong_a.cpp:1338 dev_vp2 read_cb<5> <- dev_6h bit3",
        "mame dkong.cpp:197 '7d03 digital sound trigger - coin input/spring'",
        "trace: 7D03 rises at frame ~404 in every capture, which is the tape's coin frame",
        "trace level3_full (75m): 7D03 rises 147 times, ~25 frames apart -- the spring cadence",
        "stimulus sweep: audible, level-driven (0.574s @0.25s, 3.095s @3.0s)",
      ],
    },
    4: {
      name: "falling",
      kind: "oneshot",
      source: "i8035",
      confidence: "confirmed",
      fires:
        "Kong's fall at the end of the rivet board; Mario falling further than " +
        "0x0F from where he left the ground; a 75m spring dropping off the right edge",
      note:
        "An INPUT PIN, not a circuit: latch bit 4 -> I8035 T1, inverted " +
        "(dkong_a.cpp:1350, latch8 bit4_q_r). Measured level-driven WITH A DECAY " +
        "TAIL: the clip outlasts the hold by ~1.4-1.6s, so a player must gate on " +
        "the bit and then let the tail finish.",
      rom: [
        "0x186F Kong falls (step 3 of the 0x6388 rivet-ending state table at 0x1648)",
        "0x1C87 Mario's fatal fall",
        "0x2E69 spring transitions to its falling state",
      ],
      measured: {
        audible: true,
        behaviour: "level+decay",
        peak: 12212,
        clipSec: { hold0_25: 1.649, hold3_0: 4.587 },
      },
      evidence: [
        "mame dkong_a.cpp:1350 t1_in_cb <- dev_6h bit4",
        "mame dkong.cpp:198 '7d04 digital sound trigger - gorilla fall'",
        "mame dkong.cpp:219 'T1 Active low when gorilla is falling'",
        "trace level3_full (75m): 7D04 rises 48 times, every 80 frames, 5 frames before " +
          "a 7D03 -- the spring cycle",
        "stimulus sweep: audible, level + decay tail (1.649s @0.25s, 4.587s @3.0s)",
      ],
    },
    5: {
      name: "item_or_jump_score",
      kind: "oneshot",
      source: "i8035",
      confidence: "confirmed",
      fires:
        "picking up a hammer or a prize (hat/parasol/purse), and scoring for " +
        "jumping over a barrel/object",
      note:
        "An INPUT PIN, not a circuit: latch bit 5 -> I8035 T0, inverted " +
        "(dkong_a.cpp:1349, latch8 bit5_q_r). MAME's header calls T0 'select sound " +
        "for jump (Normal or Barrell?)', which reads as a guess; the ROM drives it " +
        "as a discrete event, and a control run showed it produces its own sound " +
        "rather than strobing the tune latch (latch 0x00 + trig5 == trig5 alone).",
      rom: [
        "0x295F sets 0x6085 in the item-pickup routine (entry_2954)",
        "0x1DE2 / 0x1E44 set 0x6085=3 on the jumped-over-an-object scoring path",
      ],
      measured: {
        audible: true,
        behaviour: "level",
        peak: 20176,
        clipSec: { hold0_25: 0.794, hold3_0: 3.252 },
      },
      evidence: [
        "mame dkong_a.cpp:1349 t0_in_cb <- dev_6h bit5",
        "mame dkong.cpp:199 '7d05 digital sound trigger - barrel jump/prize'",
        "trace test_hammer_25m_lower: 7D05 rises once at frame 1580, 29 frames before the " +
          "0x7C00 tune flips to 0x04 (hammer music)",
        "trace test_prize_50m_hat: 7D05 rises once at frame 1716, at the poked prize pickup",
        "stimulus sweep: audible, level-driven; control shows it is a sound, not a latch strobe",
      ],
    },
    6: {
      name: "unused_bit6",
      kind: "none",
      source: "none",
      confidence: "confirmed",
      fires: "never on this board",
      note:
        "Wired in the machine config to DS_SOUND6_INP, but dkong2b_discrete has no " +
        "such input node (only SOUND0/1/2 and DISCHARGE, dkong_a.cpp:349-353), so the " +
        "write is a logged no-op (discrete.cpp:1098-1115). It is a real sound only on " +
        "radarscp, whose netlist does define DS_SOUND6. Measurement agrees: silent, " +
        "and holding it high across a full latch sweep changed nothing, so it is not " +
        "a hidden mode/bank select either.",
      rom: ["0x6086 is never written by the ROM (full binary scan of all addressing modes)"],
      measured: { audible: false, behaviour: "silent", peak: null, clipSec: null },
      evidence: [
        "mame dkong_a.cpp:1326 bit6 -> DS_SOUND6_INP",
        "mame dkong_a.cpp:349-353 dkong2b_discrete inputs: SOUND2, SOUND1, SOUND0, DISCHARGE only",
        "mame dkong.cpp:200 '7d06 ?'",
        "trace: 7D06 is written exactly once, with 0, by the boot silence routine",
        "stimulus sweep: silent (peak below a floor of 1.1/32767, threshold 35 dB above it); " +
          "held high across the latch sweep -> 14/14 byte-identical clips",
      ],
    },
    7: {
      name: "unused_bit7",
      kind: "none",
      source: "none",
      confidence: "confirmed",
      fires: "never on this board",
      note: "Same as bit 6: DS_SOUND7_INP does not exist in dkong2b_discrete, and " +
        "the same measurement and control apply.",
      rom: ["0x6087 is never written by the ROM"],
      measured: { audible: false, behaviour: "silent", peak: null, clipSec: null },
      evidence: [
        "mame dkong_a.cpp:1327 bit7 -> DS_SOUND7_INP",
        "mame dkong.cpp:201 '7d07 ?'",
        "trace: 7D07 is written exactly once, with 0, by the boot silence routine",
        "stimulus sweep: silent; held high across the latch sweep -> 14/14 byte-identical clips",
      ],
    },
  },

  // ---------------------------------------------------------------------
  // 0x7D80 -- write side. READING 0x7D80 is DSW0; the two are different
  // devices at one address, exactly like 0x7C00 (IN0 read / sound latch write).
  //
  // NOT YET MEASURED IN ISOLATION. The stimulus sweep only established that
  // MUTING this line leaves the 0x7C00 tune sweep byte-identical -- i.e. tune
  // playback does not depend on it. Whether driving it alone produces the death
  // jingle is an open measurement.
  // ---------------------------------------------------------------------
  irq: {
    name: "death",
    kind: "oneshot",
    source: "i8035",
    confidence: "confirmed",
    fires: "Mario dies (hit, or fell too far)",
    note:
      "Writing nonzero asserts the I8035's interrupt line and 0 clears it " +
      "(dkong_a.cpp:1257-1263); the tune is whatever the sound program's IRQ " +
      "handler plays. It is the ONLY event on this line.",
    rom: ["0x12A8 sets 0x6088=3, in the death state (entry_128B, 0x6009=8)"],
    measured: { audible: null, behaviour: null, peak: null, clipSec: null },
    evidence: [
      "mame dkong.cpp:806 map(0x7d80) .w(dkong_audio_irq_w)",
      "mame dkong.cpp:202 '7d80 digital sound trigger - dead'",
      "trace coin_start idle: 7D80 rises 3 times in 90s -- once per life -- each ~64 frames " +
        "after the boom that killed Mario",
      "stimulus sweep control: muting this line left all 14 tune clips byte-identical, so " +
        "it is NOT what starts a tune -- it is its own event",
    ],
  },

  // ---------------------------------------------------------------------
  // ls175.3d -- 0x7C00. Value as WRITTEN by the Z80 (the I8035 sees ~n & 0x0F).
  // Every one of these is produced by the I8035, i.e. by its 2 KB program ROM
  // driving a DAC. None of them is a discrete circuit.
  //
  // Measured, by direct stimulus of real MAME 0.288: the write itself drives the
  // sound CPU (muting the 0x7D80 IRQ line changes nothing), only the low nibble
  // is significant, and 0x00 and 0x0A are SILENT while the other 14 values each
  // produce a distinct sound of 0.221s-6.818s.
  //
  // *** 0x0A IS AN OPEN CONFLICT. *** See its entry and README.md.
  // ---------------------------------------------------------------------
  latch: {
    0x00: {
      name: "silence",
      kind: "none",
      source: "i8035",
      confidence: "confirmed",
      fires: "no tune selected; written by the boot/reset silence routine and " +
        "whenever a one-shot's 3-frame window expires with no background tune set",
      note: "Not a sound. A player should treat it as 'stop the looping tune'.",
      rom: ["0x0134 (silence routine 0x011C)", "0x010B when 0x6089 and 0x608A are both 0"],
      measured: { audible: false, behaviour: "silent", durationSec: null },
      evidence: [
        "mame dkong.cpp:177 '00 - nothing'",
        "trace: written at frame 3.57 of every capture and after every one-shot",
        "stimulus sweep: silent, as are 0x20/0x40/0x80 (mask confirms low-nibble-only)",
      ],
    },
    0x01: {
      name: "intro",
      kind: "oneshot",
      source: "i8035",
      confidence: "confirmed",
      fires: "immediately after Start -- the Kong-climbs-the-girders opening",
      note: "Priority slot, 3-frame pulse; the 8035 plays the whole tune itself.",
      rom: ["0x0ADB sets 0x608A=0x01, 0x608B=3"],
      measured: { audible: true, behaviour: null, durationSec: null },
      evidence: [
        "mame dkong.cpp:178 '01 - Intro tune'",
        "trace coin_start: 0x7C00 <- 01 at frame 532, 72 frames after the Start press",
        "stimulus sweep: audible, distinct from every other value",
      ],
    },
    0x02: {
      name: "level_start",
      kind: "oneshot",
      source: "i8035",
      confidence: "confirmed",
      fires:
        "the board-start jingle -- plays on the 'How High Can You Get?' screen and " +
        "again before every board (re)start, including after each death",
      note:
        "MAME calls it the intermission tune; empirically it is the generic " +
        "start-of-board cue and fires once per life.",
      rom: ["0x0BF2 sets 0x608A=0x02, 0x608B=3 (routine 0x0BDA, which first silences via 0x011C)"],
      measured: { audible: true, behaviour: null, durationSec: null },
      evidence: [
        "mame dkong.cpp:179 '02 - How High? (intermisson) tune'",
        "trace coin_start idle 90s: 0x7C00 <- 02 at frames 1237, 1960, 2683 -- once before " +
          "each of the three lives, each ~160 frames before the board BGM starts",
        "stimulus sweep: audible",
      ],
    },
    0x03: {
      name: "out_of_time",
      kind: "loop",
      source: "i8035",
      confidence: "inferred",
      fires: "the bonus timer's high digit reaches 0 (bonus < 1000)",
      note:
        "Written into the BACKGROUND slot, so it replaces the board BGM and loops " +
        "until the board ends. Measurement says the value is audible; no capture " +
        "has ever reached the ROM site, so the NAME rests on the ROM branch + " +
        "MAME's comment.",
      rom: [
        "0x067A sets 0x6089=0x03 in the bonus-display routine, on the branch taken when " +
          "the high nibble of 0x638C is zero (it also swaps the leading digit tile at " +
          "0x7486/0x74A6)",
      ],
      measured: { audible: true, behaviour: null, durationSec: null },
      evidence: [
        "mame dkong.cpp:180 '03 - Out of time'",
        "stimulus sweep: audible (does not name it)",
      ],
    },
    0x04: {
      name: "hammer",
      kind: "loop",
      source: "i8035",
      confidence: "confirmed",
      fires: "while a hammer is active",
      note:
        "Background slot. The ROM saves the previous background tune in 0x6389 and " +
        "restores it when the hammer runs out (0x2FAE saves, 0x2F79 restores).",
      rom: ["0x2F00 sets 0x6089=0x04 when the hammer flag 0x6217 bit0 is set"],
      measured: { audible: true, behaviour: null, durationSec: null },
      evidence: [
        "mame dkong.cpp:181 '04 - Hammer'",
        "trace test_hammer_25m_lower: 0x7C00 held at 04 from frame 1609 to 2120, then back " +
          "to 08 (the 25m background) -- exactly the hammer's lifetime",
        "stimulus sweep: audible",
      ],
    },
    0x05: {
      name: "rivet_end_even",
      kind: "oneshot",
      source: "i8035",
      confidence: "inferred",
      fires:
        "rivet-board ending, on the branch taken when the completed-board counter " +
        "0x6229 is EVEN",
      note:
        "0x1913 loads 0x0C, then overwrites it with 0x05 unless bit 0 of 0x6229 is set. " +
        "MAME names 0x05/0x0C 'Rivet level 2/1 completed'. Never captured -- no tape " +
        "completes a board. SUPPORTING (not naming) evidence: 0x05 and 0x0C are the two " +
        "LONGEST sounds on the whole latch, ~6.79s and ~6.82s, which is what an end " +
        "fanfare pair should look like and what two arbitrary effects should not.",
      rom: ["0x191E sets 0x608A=0x05, 0x608B=3"],
      measured: { audible: true, behaviour: null, durationSec: 6.79 },
      evidence: [
        "mame dkong.cpp:182 '05 - Rivet level 2 completed (end tune)'",
        "stimulus sweep: audible, 6.79s -- joint-longest with 0x0C",
      ],
    },
    0x06: {
      name: "hammer_hit",
      kind: "oneshot",
      source: "i8035",
      confidence: "inferred",
      fires: "a hammer smashes a barrel or a fireball",
      note:
        "The same routine picks the score value (0x6342 = 2 or 4) and spawns the " +
        "floating score sprite at 0x6A2C, which is what a hammer kill does.",
      rom: ["0x1F00 sets 0x608A=0x06, 0x608B=3"],
      measured: { audible: true, behaviour: null, durationSec: null },
      evidence: [
        "mame dkong.cpp:183 '06 - Hammer hit'",
        "stimulus sweep: audible (does not name it)",
      ],
    },
    0x07: {
      name: "level_end",
      kind: "oneshot",
      source: "i8035",
      confidence: "inferred",
      fires: "reaching Pauline on a non-rivet board (25m/50m/75m rescue)",
      note:
        "Routine 0x1708 silences everything (0x011C), places a sprite at 0x6A20 and " +
        "clears video RAM around 0x75C4, then selects the tune. Referenced twice from " +
        "the level-end dispatch tables near 0x1650/0x16A4.",
      rom: ["0x1729 sets 0x608A=0x07, 0x608B=3"],
      measured: { audible: true, behaviour: null, durationSec: null },
      evidence: [
        "mame dkong.cpp:184 '07 - Standard level end'",
        "stimulus sweep: audible (does not name it)",
      ],
    },
    0x08: {
      name: "bgm_25m",
      kind: "loop",
      source: "i8035",
      confidence: "confirmed",
      fires: "the whole time board type 0x6227 == 1 (25m, girders/barrels) is being played",
      note: "MAME calls this 'Background 1 (barrels)'.",
      rom: ["0x0CD9 sets 0x6089=0x08 on the 0x6227==1 arm of the board-setup dispatch"],
      measured: { audible: true, behaviour: null, durationSec: null },
      evidence: [
        "mame dkong.cpp:185 '08 - Background 1 (barrels)'",
        "trace coin_start: 0x7C00 held at 08 from frame 1400 until the death at 1661",
        "stimulus sweep: audible",
      ],
    },
    0x09: {
      name: "bgm_50m",
      kind: "loop",
      source: "i8035",
      confidence: "confirmed",
      fires: "board type 0x6227 == 2 (50m, conveyors / 'pie factory')",
      note: "MAME calls this 'Background 4 (pie factory)'. MAME's Background-N numbering " +
        "is not the height order; go by 0x6227.",
      rom: ["0x0CEC sets 0x6089=0x09 on the 0x6227==2 arm"],
      measured: { audible: true, behaviour: null, durationSec: null },
      evidence: [
        "mame dkong.cpp:186 '09 - Background 4 (pie factory)'",
        "trace test_prize_50m_hat (pokes 0x6227=2): 0x7C00 held at 09 from frame 1398",
        "stimulus sweep: audible",
      ],
    },
    0x0a: {
      name: "bgm_75m",
      kind: "loop",
      source: "i8035",
      confidence: "confirmed",
      fires: "board type 0x6227 == 3 (75m, elevators/springs)",
      note:
        "*** CONFLICT, UNRESOLVED. *** The BINDING is confirmed three ways: MAME's " +
        "comment, the ROM's board-setup dispatch, and a trace in which 0x7C00 is held " +
        "at 0x0A for the entire 75m board. But a DIRECT STIMULUS SWEEP of 0x7C00 found " +
        "0x0A to be the only value besides 0x00 that produces NO audio -- measured " +
        "silent against a noise floor 35 dB below the detection threshold. So either " +
        "(a) the 75m board genuinely has no background track and this command is a " +
        "documented no-op, or (b) tune 0x0A needs I8035 state the isolated sweep did " +
        "not set up. Do not resolve this by guessing; resolve it by capturing audio " +
        "from a real 75m playthrough. Until then a player should expect silence here " +
        "and NOT ship a fabricated 75m theme.",
      rom: ["0x0CF7 sets 0x6089=0x0A on the 0x6227==3 arm"],
      measured: { audible: false, behaviour: "silent", durationSec: null },
      conflict:
        "MAME dkong.cpp:187 names 0x0A a background tune and the ROM/trace confirm the " +
        "ROM selects it on 75m, but direct stimulus of 0x7C00=0x0A produced no audio.",
      evidence: [
        "mame dkong.cpp:187 '0A - Background 3 (springs)'",
        "trace level3_full (pokes 0x6227=3): 0x7C00 held at 0A from frame 1398, with the " +
          "spring trigger 7D03 firing throughout",
        "stimulus sweep: SILENT -- contradicts the driver comment; see `conflict`",
      ],
    },
    0x0b: {
      name: "bgm_100m",
      kind: "loop",
      source: "i8035",
      confidence: "confirmed",
      fires: "board type 0x6227 == 4 (100m, rivets)",
      note: "MAME calls this 'Background 2 (rivets)'.",
      rom: ["0x0CC0 sets 0x6089=0x0B on the fall-through (0x6227==4) arm"],
      measured: { audible: true, behaviour: null, durationSec: null },
      evidence: [
        "mame dkong.cpp:188 '0B - Background 2 (rivets)'",
        "trace level4_full (pokes 0x6227=4): 0x7C00 held at 0B from frame 1397",
        "stimulus sweep: audible",
      ],
    },
    0x0c: {
      name: "rivet_end_odd",
      kind: "oneshot",
      source: "i8035",
      confidence: "inferred",
      fires:
        "rivet-board ending, on the branch taken when the completed-board counter " +
        "0x6229 is ODD",
      note: "See rivet_end_even (0x05); same site, the other side of the parity test, " +
        "and the other of the two ~6.8s sounds on the latch.",
      rom: ["0x1916 sets 0x608A=0x0C (kept when 0x6229 bit0 is set), 0x608B=3"],
      measured: { audible: true, behaviour: null, durationSec: 6.82 },
      evidence: [
        "mame dkong.cpp:189 '0C - Rivet level 1 completed (end tune)'",
        "stimulus sweep: audible, 6.82s -- the longest sound on the latch",
      ],
    },
    0x0d: {
      name: "rivet_removed",
      kind: "oneshot",
      source: "i8035",
      confidence: "inferred",
      fires: "Mario walks over a rivet and it pops out",
      note:
        "The trigger site decrements the rivet counter 0x6290, blanks three video-RAM " +
        "tiles and raises a pending flag 0x6225; the tune is emitted a few frames later " +
        "by 0x1D95, which is gated on board type != 1.",
      rom: ["0x1A80..0x1AB9 rivet removal; 0x1D9D sets 0x608A=0x0D, 0x608B=3"],
      measured: { audible: true, behaviour: null, durationSec: null },
      evidence: [
        "mame dkong.cpp:190 '0D - Rivet removed'",
        "stimulus sweep: audible (does not name it)",
      ],
    },
    0x0e: {
      name: "rivet_stage_cleared",
      kind: "oneshot",
      source: "i8035",
      confidence: "inferred",
      fires:
        "the last rivet is gone -- the first step of the Kong-falls ending sequence",
      note:
        "Step 0 of the 0x6388-indexed state table at ROM 0x1648, whose later steps are " +
        "Kong shaking (0x1839), Kong falling (0x186F, trigger 4), his landing thud " +
        "(0x18BE, trigger 2) and then the rivet end tune (0x1913).",
      rom: ["0x17B7 silences via 0x011C, then 0x17BD sets 0x608A=0x0E, 0x608B=3"],
      measured: { audible: true, behaviour: null, durationSec: null },
      evidence: [
        "mame dkong.cpp:191 '0E - Rivet level completed'",
        "stimulus sweep: audible (does not name it)",
      ],
    },
    0x0f: {
      name: "roar",
      kind: "oneshot",
      source: "i8035",
      confidence: "confirmed",
      fires: "Kong's roar at the end of the opening climb (intro state 0x6009 == 0x90)",
      note:
        "The ONE Donkey Kong sound MAME documents as coming from real sample bytes: " +
        "the second 2 KB sound ROM (s_3j_b.bin) banked in through I8035 port 2 bit 6. " +
        "See README.md -- those bytes are not currently part of this project's romset. " +
        "Measured at 2.010s; writing 0xFF gives 2.007s, which is the low-nibble mask " +
        "(0xFF and 0x0F select the same tune) showing up in the data.",
      rom: ["0x0BBD sets 0x608A=0x0F, 0x608B=3"],
      measured: { audible: true, behaviour: null, durationSec: 2.01 },
      evidence: [
        "mame dkong.cpp:192 '0F - Gorilla roar'",
        "mame dkong.cpp:213 '0800-0fff Compressed sound sample (Gorilla roar in DKong)'",
        "trace coin_start: 0x7C00 <- 0F at frame 1093, immediately after the six intro stomps",
        "stimulus sweep: audible, 2.010s (0xFF -> 2.007s, same tune via the low-nibble mask)",
      ],
    },
  },
};

export default SOUNDS;
