# -*- coding: utf-8 -*-
"""Append the 0.3.96 keys to every base-language translation file."""
import json
import os

HERE = os.path.join(os.path.dirname(__file__), "i18n")

NEW_KEYS = [
    "drawOnPage",
    "drawPen",
    "drawEraser",
    "drawUndo",
    "drawClear",
    "drawDone",
    "clearCookies",
    "cookiesCleared",
]

TRANSLATIONS = {
    "zh-Hant": {
        "clearCookies": "清除網站 Cookie",
        "cookiesCleared": "已清除網站 Cookie",
    },
    "ug": {
        "clearCookies": "تور بەت Cookie لىرىنى تازىلاش",
        "cookiesCleared": "تور بەت Cookie لىرى تازىلاندى",
    },
    "ar": {
        "clearCookies": "مسح كوكيز الموقع",
        "cookiesCleared": "تم مسح كوكيز الموقع",
    },
    "ru": {
        "clearCookies": "Очистить cookie сайта",
        "cookiesCleared": "Cookie сайта очищены",
    },
    "tr": {
        "clearCookies": "Site çerezlerini temizle",
        "cookiesCleared": "Site çerezleri temizlendi",
    },
    "ja": {
        "clearCookies": "サイトのCookieを消去",
        "cookiesCleared": "サイトのCookieを消去しました",
    },
    "ko": {
        "clearCookies": "사이트 쿠키 지우기",
        "cookiesCleared": "사이트 쿠키를 지웠습니다",
    },
    "fr": {
        "clearCookies": "Effacer les cookies du site",
        "cookiesCleared": "Cookies du site effacés",
    },
    "de": {
        "clearCookies": "Website-Cookies löschen",
        "cookiesCleared": "Website-Cookies gelöscht",
    },
    "es": {
        "clearCookies": "Borrar cookies del sitio",
        "cookiesCleared": "Cookies del sitio borradas",
    },
    "hi": {
        "clearCookies": "साइट कुकीज़ मिटाएँ",
        "cookiesCleared": "साइट कुकीज़ मिटा दी गईं",
    },
    "th": {
        "clearCookies": "ล้างคุกกี้ของเว็บ",
        "cookiesCleared": "ล้างคุกกี้ของเว็บแล้ว",
    },
    "vi": {
        "clearCookies": "Xóa cookie của trang",
        "cookiesCleared": "Đã xóa cookie của trang",
    },
    "id": {
        "clearCookies": "Hapus cookie situs",
        "cookiesCleared": "Cookie situs dihapus",
    },
    "fa": {
        "clearCookies": "پاک کردن کوکی‌های سایت",
        "cookiesCleared": "کوکی‌های سایت پاک شدند",
    },
}


def main() -> None:
    for lang, values in TRANSLATIONS.items():
        path = os.path.join(HERE, f"{lang}.json")
        if not os.path.exists(path):
            print(f"skip (no file): {lang}")
            continue
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        for key in NEW_KEYS:
            data[key] = values[key]
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        print(f"updated: {lang}")


if __name__ == "__main__":
    main()
