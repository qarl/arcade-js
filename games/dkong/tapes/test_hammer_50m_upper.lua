local M=manager.machine
local mem=M.devices[":maincpu"].spaces["program"]
local I2=M.ioport.ports[":IN2"];local I0=M.ioport.ports[":IN0"]
local coin=I2.fields["Coin 1"];local start=I2.fields["1 Player Start"];local jump=I0.fields["P1 Button 1"]
local f=0
_G.__h=emu.add_machine_frame_notifier(function()
 f=f+1
 coin:set_value((f>=399 and f<400) and 1 or 0)
 start:set_value((f>=459 and f<460) and 1 or 0)
  if f>=464 and f<=1463 then mem:write_u8(0x604A,0x74);mem:write_u8(0x604B,0x3A);mem:write_u8(0x6049,0x02);mem:write_u8(0x622A,0x74);mem:write_u8(0x622B,0x3A);mem:write_u8(0x6227,0x02);mem:write_u8(0x6229,0x02) end
 if f>=1549 and f<=1560 then mem:write_u8(0x6203,0x7c);mem:write_u8(0x6205,0xc8) end
 jump:set_value((f>=1559 and f<1579) and 1 or 0)
end)