# -*- coding: utf-8 -*-
"""Remove leftover draw* i18n lines from main.ts dictionaries."""
import re

path = "main.ts"
src = open(path, encoding="utf-8").read()
pat = re.compile(r'^  draw(?:OnPage|Pen|Eraser|Undo|Clear|Done): "(?:[^"\\]|\\.)*",?\n', re.M)
src2, n = pat.subn("", src)
open(path, "w", encoding="utf-8", newline="\n").write(src2)
print("removed lines:", n)
