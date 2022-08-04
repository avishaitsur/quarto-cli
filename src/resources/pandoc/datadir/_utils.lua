-- debug.lua
-- Copyright (C) 2020 by RStudio, PBC
-- improved formatting for dumping tables
local function tdump(tbl, indent)
  if not indent then
    indent = 0
  end
  if tbl.t then
    print(string.rep("  ", indent) .. tbl.t)
  end
  for k, v in pairs(tbl) do
    formatting = string.rep("  ", indent) .. k .. ": "
    if type(v) == "table" then
      print(formatting)
      tdump(v, indent + 1)
    elseif type(v) == 'boolean' then
      print(formatting .. tostring(v))
    elseif (v ~= nil) then
      print(formatting .. tostring(v))
    else
      print(formatting .. 'nil')
    end
  end
end

-- dump an object to stdout
local function dump(o)
  if type(o) == 'table' then
    tdump(o)
  else
    print(tostring(o) .. "\n")
  end
end

-- is the table a simple array?
-- see: https://web.archive.org/web/20140227143701/http://ericjmritz.name/2014/02/26/lua-is_array/
function tisarray(t)
  local i = 0
  for _ in pairs(t) do
    i = i + 1
    if t[i] == nil then
      return false
    end
  end
  return true
end

-- does the table contain a value
local function tcontains(t, value)
  if t and type(t) == "table" and value then
    for _, v in ipairs(t) do
      if v == value then
        return true
      end
    end
    return false
  end
  return false
end

return {
  dump = dump,
  table = {
    isarray = tisarray,
    contains = tcontains
  }
}
