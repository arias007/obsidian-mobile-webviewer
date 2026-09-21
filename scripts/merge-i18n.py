# -*- coding: utf-8 -*-
"""Merge authored locale JSON files into main.ts dictionaries.

Each scripts/i18n/<code>.json contains { "key": "value", ... } with a full or
partial translation. Keys already present in main.ts are preserved; missing
keys are inserted right after the dictionary opening line.
"""
import json
import os
import re
import sys

SRC = "main.ts"
LOCALE_DIR = "scripts/i18n"

DICT_MARKERS = {
    "zh-Hant": "const UI_TEXT_ZH_HANT: UiDictionary = {",
    "ug": "const UI_TEXT_UG: UiDictionary = {",
    "ar": "const UI_TEXT_AR = commonUi({",
    "ru": "const UI_TEXT_RU = commonUi({",
    "tr": "const UI_TEXT_TR = commonUi({",
    "ja": "const UI_TEXT_JA = commonUi({",
    "ko": "const UI_TEXT_KO = commonUi({",
    "fr": "const UI_TEXT_FR = commonUi({",
    "de": "const UI_TEXT_DE = commonUi({",
    "es": "const UI_TEXT_ES = commonUi({",
    "hi": "const UI_TEXT_HI = commonUi({",
    "th": "const UI_TEXT_TH = commonUi({",
    "vi": "const UI_TEXT_VI = commonUi({",
    "id": "const UI_TEXT_ID = commonUi({",
    "fa": "const UI_TEXT_FA = commonUi({",
}

KEY_RE = re.compile(r'^\s{2}([A-Za-z0-9]+):', re.M)


def dict_end(src: str, start: int, full_type: bool) -> int:
    return src.index("\n};" if full_type else "\n});", start)


def main() -> None:
    with open(SRC, encoding="utf-8") as f:
        src = f.read()

    total_added = 0
    for code, marker in DICT_MARKERS.items():
        path = os.path.join(LOCALE_DIR, f"{code}.json")
        if not os.path.exists(path):
            print(f"[skip] {code}: no {path}")
            continue
        with open(path, encoding="utf-8") as f:
            translations = json.load(f)

        start = src.index(marker)
        end = dict_end(src, start, "UiDictionary = {" in marker)
        body = src[start:end]
        existing = set(KEY_RE.findall(body))
        missing = {k: v for k, v in translations.items() if k not in existing}
        if not missing:
            print(f"[ok]   {code}: already complete ({len(existing)} keys)")
            continue

        # Map first-level keys only; spread lines (...UI_TEXT_X) stay untouched.
        def esc(v: str) -> str:
            return json.dumps(v, ensure_ascii=False)

        lines = [f'  {k}: {esc(v)},' for k, v in missing.items()]
        insertion = "\n" + "\n".join(lines)
        open_pos = start + len(marker)
        src = src[:open_pos] + insertion + src[open_pos:]
        total_added += len(missing)
        print(f"[add]  {code}: +{len(missing)} keys (had {len(existing)})")

    with open(SRC, "w", encoding="utf-8", newline="\n") as f:
        f.write(src)
    print(f"done, added {total_added} keys total")


if __name__ == "__main__":
    sys.exit(main())
