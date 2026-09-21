# -*- coding: utf-8 -*-
"""Verify effective i18n coverage including spread inheritance."""
import re

src = open("main.ts", encoding="utf-8").read()
m = re.search(r"type UiTextKey =((?:.|\n)*?);", src)
keys = set(re.findall(r'\| "([^"]+)"', m.group(1)))

VAR_TO_LANG = {
    "UI_TEXT_EN": "en", "UI_TEXT_ZH_HANS": "zh-Hans", "UI_TEXT_ZH_HANT": "zh-Hant",
    "UI_TEXT_UG": "ug", "UI_TEXT_AR": "ar", "UI_TEXT_RU": "ru", "UI_TEXT_TR": "tr",
    "UI_TEXT_JA": "ja", "UI_TEXT_KO": "ko", "UI_TEXT_FR": "fr", "UI_TEXT_DE": "de",
    "UI_TEXT_ES": "es", "UI_TEXT_PT": "pt", "UI_TEXT_IT": "it", "UI_TEXT_HI": "hi",
    "UI_TEXT_FA": "fa", "UI_TEXT_UR": "ur", "UI_TEXT_KK": "kk", "UI_TEXT_KY": "ky",
    "UI_TEXT_UZ": "uz", "UI_TEXT_ID": "id", "UI_TEXT_MS": "ms", "UI_TEXT_TH": "th",
    "UI_TEXT_VI": "vi",
}
LANG_TO_VAR = {v: k for k, v in VAR_TO_LANG.items()}
FULL_TYPES = {"UI_TEXT_EN", "UI_TEXT_ZH_HANS", "UI_TEXT_ZH_HANT", "UI_TEXT_UG"}

eff = {}

def resolve(lang):
    if lang in eff:
        return eff[lang]
    var = LANG_TO_VAR[lang]
    if var in FULL_TYPES:
        marker = f"const {var}: "
    else:
        marker = f"const {var} = commonUi({{"
    i = src.index(marker)
    if var in FULL_TYPES:
        j = src.index("\n};", i)
    else:
        j = src.index("\n});", i)
    body = src[i:j]
    s = set(re.findall(r"^\s{2}([A-Za-z0-9]+):", body, re.M))
    for sp in re.findall(r"\.\.\.(UI_TEXT_[A-Z_]+)", body):
        s |= resolve(VAR_TO_LANG[sp])
    eff[lang] = s
    return s

for lang in ["en", "zh-Hans", "zh-Hant", "ug", "ar", "ru", "tr", "ja", "ko", "fr",
             "de", "es", "pt", "it", "hi", "fa", "ur", "kk", "ky", "uz", "id",
             "ms", "th", "vi"]:
    s = resolve(lang)
    miss = keys - s
    status = "OK  " if not miss else f"MISS {len(miss)}"
    extra = sorted(miss)[:6] if miss else ""
    print(f"{lang:8s} {len(s)}/{len(keys)} {status} {extra}")
