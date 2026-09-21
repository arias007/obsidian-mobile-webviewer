# -*- coding: utf-8 -*-
"""Dump the English UI string base as JSON for translation work."""
import json
import re

src = open("main.ts", encoding="utf-8").read()
i = src.index("const UI_TEXT_EN: Record<UiTextKey, string> = {")
j = src.index("\n};", i)
body = src[i:j]
pattern = re.compile(r'^\s{2}([A-Za-z0-9]+): "((?:[^"\\]|\\.)*)",?$', re.M)
d = dict(pattern.findall(body))
with open("scripts/en-base.json", "w", encoding="utf-8") as f:
    json.dump(d, f, ensure_ascii=False, indent=1)
print("dumped", len(d))
