-- PRIZE gate fixture (75m_hat): collect the hat on board 3.
-- coin@399 start@459; board-3 pre-set held 464..1463; Mario -> (0xdd,0x60) @1600; hold P1 Right 1600..1800.
-- Mirrors tools/prize_suite.py's emit --poke/--input. Pickup = exact grid match
-- (Mario 0x6203==prizeX & 0x6205==prizeY) at prize (0xe3,0x60).
local M=manager.machine
local mem=M.devices[":maincpu"].spaces["program"]
local I2=M.ioport.ports[":IN2"];local I0=M.ioport.ports[":IN0"]
local coin=I2.fields["Coin 1"];local start=I2.fields["1 Player Start"];local inp=I0.fields["P1 Right"]
assert(coin and start and inp,"fields")
local f=0
_G.__prz=emu.add_machine_frame_notifier(function()
 f=f+1
 coin:set_value((f>=399 and f<400) and 1 or 0)
 start:set_value((f>=459 and f<460) and 1 or 0)
  if f>=464 and f<=1463 then mem:write_u8(0x604A,0x76);mem:write_u8(0x604B,0x3A);mem:write_u8(0x6049,0x03);mem:write_u8(0x622A,0x76);mem:write_u8(0x622B,0x3A);mem:write_u8(0x6227,0x03);mem:write_u8(0x6229,0x03) end
 if f>=1600 and f<=1601 then mem:write_u8(0x6203,0xdd);mem:write_u8(0x6205,0x60) end
 inp:set_value((f>=1600 and f<1800) and 1 or 0)
end)
