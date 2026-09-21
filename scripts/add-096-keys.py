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
        "drawOnPage": "頁面塗鴉",
        "drawPen": "畫筆",
        "drawEraser": "橡皮擦",
        "drawUndo": "復原筆畫",
        "drawClear": "清空塗鴉",
        "drawDone": "完成",
        "clearCookies": "清除網站 Cookie",
        "cookiesCleared": "已清除網站 Cookie",
    },
    "ug": {
        "drawOnPage": "بەت ئۈستىگە سىزىش",
        "drawPen": "قەلەم",
        "drawEraser": "ئۆچۈرگۈچ",
        "drawUndo": "سىزىقنى ئەكىس كەلتۈرۈش",
        "drawClear": "سىزىلغاننى تازىلاش",
        "drawDone": "تامام",
        "clearCookies": "تور بەت Cookie لىرىنى تازىلاش",
        "cookiesCleared": "تور بەت Cookie لىرى تازىلاندى",
    },
    "ar": {
        "drawOnPage": "الرسم على الصفحة",
        "drawPen": "القلم",
        "drawEraser": "الممحاة",
        "drawUndo": "التراجع عن الخط",
        "drawClear": "مسح الرسم",
        "drawDone": "تم",
        "clearCookies": "مسح كوكيز الموقع",
        "cookiesCleared": "تم مسح كوكيز الموقع",
    },
    "ru": {
        "drawOnPage": "Рисовать на странице",
        "drawPen": "Перо",
        "drawEraser": "Ластик",
        "drawUndo": "Отменить штрих",
        "drawClear": "Очистить рисунок",
        "drawDone": "Готово",
        "clearCookies": "Очистить cookie сайта",
        "cookiesCleared": "Cookie сайта очищены",
    },
    "tr": {
        "drawOnPage": "Sayfaya çiz",
        "drawPen": "Kalem",
        "drawEraser": "Silgi",
        "drawUndo": "Çizgiyi geri al",
        "drawClear": "Çizimi temizle",
        "drawDone": "Bitti",
        "clearCookies": "Site çerezlerini temizle",
        "cookiesCleared": "Site çerezleri temizlendi",
    },
    "ja": {
        "drawOnPage": "ページに描画",
        "drawPen": "ペン",
        "drawEraser": "消しゴム",
        "drawUndo": "ストロークを元に戻す",
        "drawClear": "描画を消去",
        "drawDone": "完了",
        "clearCookies": "サイトのCookieを消去",
        "cookiesCleared": "サイトのCookieを消去しました",
    },
    "ko": {
        "drawOnPage": "페이지에 그리기",
        "drawPen": "펜",
        "drawEraser": "지우개",
        "drawUndo": "획 되돌리기",
        "drawClear": "그림 지우기",
        "drawDone": "완료",
        "clearCookies": "사이트 쿠키 지우기",
        "cookiesCleared": "사이트 쿠키를 지웠습니다",
    },
    "fr": {
        "drawOnPage": "Dessiner sur la page",
        "drawPen": "Stylo",
        "drawEraser": "Gomme",
        "drawUndo": "Annuler le trait",
        "drawClear": "Effacer le dessin",
        "drawDone": "Terminé",
        "clearCookies": "Effacer les cookies du site",
        "cookiesCleared": "Cookies du site effacés",
    },
    "de": {
        "drawOnPage": "Auf der Seite zeichnen",
        "drawPen": "Stift",
        "drawEraser": "Radierer",
        "drawUndo": "Strich rückgängig",
        "drawClear": "Zeichnung löschen",
        "drawDone": "Fertig",
        "clearCookies": "Website-Cookies löschen",
        "cookiesCleared": "Website-Cookies gelöscht",
    },
    "es": {
        "drawOnPage": "Dibujar en la página",
        "drawPen": "Lápiz",
        "drawEraser": "Borrador",
        "drawUndo": "Deshacer trazo",
        "drawClear": "Borrar dibujo",
        "drawDone": "Hecho",
        "clearCookies": "Borrar cookies del sitio",
        "cookiesCleared": "Cookies del sitio borradas",
    },
    "hi": {
        "drawOnPage": "पेज पर चित्र बनाएँ",
        "drawPen": "पेंसिल",
        "drawEraser": "इरेज़र",
        "drawUndo": "स्ट्रोक पूर्ववत करें",
        "drawClear": "चित्र मिटाएँ",
        "drawDone": "पूर्ण",
        "clearCookies": "साइट कुकीज़ मिटाएँ",
        "cookiesCleared": "साइट कुकीज़ मिटा दी गईं",
    },
    "th": {
        "drawOnPage": "วาดบนหน้าเว็บ",
        "drawPen": "ปากกา",
        "drawEraser": "ยางลบ",
        "drawUndo": "ย้อนเส้น",
        "drawClear": "ล้างภาพวาด",
        "drawDone": "เสร็จ",
        "clearCookies": "ล้างคุกกี้ของเว็บ",
        "cookiesCleared": "ล้างคุกกี้ของเว็บแล้ว",
    },
    "vi": {
        "drawOnPage": "Vẽ trên trang",
        "drawPen": "Bút vẽ",
        "drawEraser": "Tẩy",
        "drawUndo": "Hoàn tác nét vẽ",
        "drawClear": "Xóa bản vẽ",
        "drawDone": "Xong",
        "clearCookies": "Xóa cookie của trang",
        "cookiesCleared": "Đã xóa cookie của trang",
    },
    "id": {
        "drawOnPage": "Menggambar di halaman",
        "drawPen": "Pena",
        "drawEraser": "Penghapus",
        "drawUndo": "Batalkan goresan",
        "drawClear": "Hapus gambar",
        "drawDone": "Selesai",
        "clearCookies": "Hapus cookie situs",
        "cookiesCleared": "Cookie situs dihapus",
    },
    "fa": {
        "drawOnPage": "رسم روی صفحه",
        "drawPen": "قلم",
        "drawEraser": "پاک‌کن",
        "drawUndo": "واگردانی خط",
        "drawClear": "پاک کردن نقاشی",
        "drawDone": "انجام شد",
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
