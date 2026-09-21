# -*- coding: utf-8 -*-
"""Move injected keys after the spread line in spread-based locale dicts."""
import re

SRC = "main.ts"
SPREAD_DICTS = ["UI_TEXT_PT", "UI_TEXT_IT", "UI_TEXT_KK", "UI_TEXT_KY", "UI_TEXT_UZ", "UI_TEXT_MS", "UI_TEXT_ID", "UI_TEXT_FA", "UI_TEXT_UR"]

src = open(SRC, encoding="utf-8").read()

for var in SPREAD_DICTS:
    marker = f"const {var} = commonUi({{"
    i = src.index(marker)
    j = src.index("\n});", i)
    body = src[i:j]
    lines = body.split("\n")
    # find spread line index
    spread_idx = None
    for idx, line in enumerate(lines):
        if re.match(r"^\s{2}\.\.\.UI_TEXT_[A-Z_]+,$", line):
            spread_idx = idx
            break
    if spread_idx is None:
        print(f"[skip] {var}: no spread line")
        continue
    head, spread_line, rest = lines[:spread_idx], lines[spread_idx], lines[spread_idx:]
    # head contains marker line + injected keys (marker is first line)
    moved = head[1:]
    new_lines = [lines[0], spread_line] + moved + rest[1:]
    new_body = "\n".join(new_lines)
    src = src[:i] + new_body + src[j:]
    print(f"[fix]  {var}: moved {len(moved)} injected keys after {spread_line.strip()}")

open(SRC, "w", encoding="utf-8", newline="\n").write(src)
print("done")
