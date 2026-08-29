import argparse
import ctypes
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import tkinter as tk
import urllib.request
import winreg
import zipfile
from pathlib import Path
from tkinter import font as tkfont

from PIL import Image, ImageDraw, ImageTk

GITHUB_OWNER = "studioberry-hub"
GITHUB_REPO = "client"
APP_NAME = "Undefined Client"
CLIENT_EXE = "uclient.exe"
ASSET_NAME = "latest-windows-amd64.zip"
# База сайта лаунчера: отсюда инсталлер/updater берут zip (зеркало GitHub).
SITE_API_BASE = os.environ.get(
    "UC_API_BASE", "https://uprojects.site/client"
).rstrip("/")
INSTALL_DIR = os.path.join(
    os.environ.get("APPDATA", os.path.expanduser("~")),
    "UndefinedClientApp",
)

# Установка идёт per-user: каталог лежит в %APPDATA%, права администратора не
# нужны. Поэтому все ключи — и Uninstall, и App Paths, и схема uclient:// —
# пишутся в HKEY_CURRENT_USER. Смешивать кусты нельзя: запись схемы в HKLM
# при per-user установке либо упадёт по правам, либо будет перекрыта
# пользовательской записью из HKCU.
REG_HIVE = winreg.HKEY_CURRENT_USER

UNINSTALL_KEY = (
    r"Software\Microsoft\Windows\CurrentVersion\Uninstall\UndefinedClient"
)
APP_PATHS_KEY = (
    r"Software\Microsoft\Windows\CurrentVersion\App Paths"
    + "\\" + CLIENT_EXE
)
VERSION_FILE = "version.txt"

# ===== Схема uclient:// =====
PROTOCOL_SCHEME = "uclient"
PROTOCOL_KEY = r"Software\Classes" + "\\" + PROTOCOL_SCHEME
PROTOCOL_TITLE = "URL:" + APP_NAME + " Protocol"

CSIDL_PROGRAMS = 0x0002
CSIDL_DESKTOPDIRECTORY = 0x0010
SHORTCUT_NAME = APP_NAME + ".lnk"

WINDOW_W = 480
WINDOW_H = 112
SUMMARY_BOTTOM_PAD = 16
TITLEBAR_H = 32

# ===== Геометрия элементов титлбара и прогрессбара =====
LOGO_SIZE = 16
LOGO_X = 8
LOGO_Y = (TITLEBAR_H - LOGO_SIZE) // 2
TITLE_X = LOGO_X + LOGO_SIZE + 8
CLOSE_X = WINDOW_W - TITLEBAR_H
PROGRESS_X = 16
PROGRESS_Y = 16
PROGRESS_W = 448
PROGRESS_H = 16
PROGRESS_PAD = 4

BG = "#191919"
BORDER = "#303030"
CONTENT_BG = "#0F0F0F"
TRACK_BG = "#252525"
TEXT_DIM = "#8A8A8A"
TEXT_WHITE = "#FFFFFF"
BTN_BG = "#303030"
BTN_BG_HOVER = "#3F3F3F"
DIVIDER = "#1E1E1E"
TEXT_LABEL = "#6E6E6E"
BTN_ACCENT_TEXT = "#08240F"

# ===== Итоговая карточка =====
ICON_SIZE = 40
ICON_X = 16
ICON_Y = 14
CARD_TEXT_X = ICON_X + ICON_SIZE + 16
ROW_LABEL_W = 104
ROW_Y_FIRST = 76
ROW_STEP = 22
INFO_W = 208
BTN_H = 26


def summary_button_y(row_count):
    """Кнопка выравнивается по последней строке деталей."""
    return ROW_Y_FIRST + max(0, row_count - 1) * ROW_STEP - 5


def summary_window_height(row_count):
    """Высота окна с итоговой карточкой зависит от числа строк с деталями."""
    rows_bottom = ROW_Y_FIRST + row_count * ROW_STEP - 6
    content_h = max(
        rows_bottom, summary_button_y(row_count) + BTN_H
    ) + SUMMARY_BOTTOM_PAD
    return TITLEBAR_H + content_h + 2

GRADIENT_INSTALL = ("#4C76FF", "#41A3FF")
GRADIENT_UNINSTALL = ("#FF614C", "#FFA041")
GRADIENT_DONE = ("#26D36B", "#1BD96A")

SUMMARY_INSTALL = APP_NAME + " установлен"
SUMMARY_UPDATE = APP_NAME + " обновлён"
SUMMARY_UNINSTALL = APP_NAME + " удалён"
SUMMARY_UPTODATE = "Установлена последняя версия"
SUB_INSTALL = "Установка прошла успешно"
SUB_UNINSTALL = "Файлы, ярлыки и записи в реестре удалены"
SUB_UPTODATE = "Обновление не требуется"
ROW_FOLDER = "Папка"
ROW_SIZE = "Размер"
ROW_FREED = "Освобождено"
ROW_VERSION = "Версия"
ROW_TIME = "Заняло"

TITLE_INSTALL = "Установка Undefined Client"
TITLE_UPDATE = "Обновление Undefined Client"
TITLE_UNINSTALL = "Удаление Undefined Client"
STATUS_INSTALL = "Установка лаунчера, подождите..."
STATUS_UPDATE = "Обновление лаунчера, подождите..."
STATUS_UNINSTALL = "Удаление лаунчера с компьютера..."
STATUS_FETCH = "Поиск последнего релиза..."
STATUS_DOWNLOAD = "Загрузка"
STATUS_EXTRACT = "Распаковка файлов..."
STATUS_DONE = "Установка завершена"
STATUS_UNINSTALL_DONE = "Удаление завершено"
STATUS_CHECK = "Проверка обновлений..."
STATUS_UPTODATE = "Обновление не требуется"
STATUS_ERROR = "Не удалось выполнить операцию"
BTN_RUN = "Запустить клиент"
BTN_DONE = "Готово"
BTN_CLOSE = "Закрыть"

FONT_FAMILY = "Nekst"
FONT_FAMILY_SEMIBOLD = "Nekst Semi Bold"
FONT_FALLBACK = "Segoe UI"


def set_dpi_awareness():
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


def window_handle(root):
    """HWND верхнеуровневого окна Tk (у Tk winfo_id даёт дочернее окно)."""
    root.update_idletasks()
    child = root.winfo_id()
    parent = ctypes.windll.user32.GetParent(child)
    return parent or child


def enable_rounded_corners(root):
    """Скругление углов средствами DWM. Работает только на Windows 11 (build 22000+)."""
    try:
        if sys.getwindowsversion().build < 22000:
            return False
    except Exception:
        return False
    DWMWA_WINDOW_CORNER_PREFERENCE = 33
    DWMWCP_ROUND = 2
    try:
        pref = ctypes.c_int(DWMWCP_ROUND)
        return ctypes.windll.dwmapi.DwmSetWindowAttribute(
            window_handle(root), DWMWA_WINDOW_CORNER_PREFERENCE,
            ctypes.byref(pref), ctypes.sizeof(pref),
        ) == 0
    except Exception:
        return False


def resource_roots():
    """Каталоги для поиска ресурсов: сначала распакованный бандл PyInstaller, затем исходники."""
    roots = []
    bundle = getattr(sys, "_MEIPASS", None)
    if bundle:
        roots.append(Path(bundle))
    script_dir = Path(__file__).resolve().parent
    roots += [script_dir, script_dir.parent, script_dir.parent.parent]
    return roots


def register_fonts(root):
    candidates = [
        base / "assets" / "fonts" / "nekst" for base in resource_roots()
    ]
    candidates += [base / "fonts" / "nekst" for base in resource_roots()]
    weights = ("Regular", "Bold", "SemiBold", "Medium")
    registered = 0
    for folder in candidates:
        if not folder.is_dir():
            continue
        for weight in weights:
            font_file = folder / f"Nekst-{weight}.ttf"
            if font_file.is_file():
                path = str(font_file)
                try:
                    ctypes.windll.gdi32.AddFontResourceExW(
                        path, 0x10, 0
                    )
                    registered += 1
                except Exception:
                    pass
    if registered:
        try:
            ctypes.windll.user32.SendMessageTimeoutW(
                0xFFFF, 0x001D, 0, 0, 2, 1000, None
            )
        except Exception:
            pass
    global FONT_FAMILY
    global FONT_FAMILY_SEMIBOLD
    families = tkfont.families(root)
    if "Nekst" not in families:
        FONT_FAMILY = FONT_FALLBACK
        FONT_FAMILY_SEMIBOLD = FONT_FALLBACK
    elif "Nekst Semi Bold" not in families:
        FONT_FAMILY_SEMIBOLD = FONT_FAMILY


def lighten(hex_color, amount):
    r = int(hex_color[1:3], 16)
    g = int(hex_color[3:5], 16)
    b = int(hex_color[5:7], 16)
    r = round(r + (255 - r) * amount)
    g = round(g + (255 - g) * amount)
    b = round(b + (255 - b) * amount)
    return f"#{r:02X}{g:02X}{b:02X}"


def parse_attrs(tag_text):
    return dict(
        re.findall(r'([\w-]+)\s*=\s*"([^"]*)"', tag_text)
    )


def parse_path(d):
    tokens = re.findall(
        r"[MmLlHhVvZz]|-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", d
    )
    subpaths = []
    pts = []
    cur = (0.0, 0.0)
    start = cur
    i = 0
    n = len(tokens)

    def num():
        nonlocal i
        value = float(tokens[i])
        i += 1
        return value

    while i < n:
        tok = tokens[i]
        if tok not in "MmLlHhVvZz":
            i += 1
            continue
        i += 1
        if tok in "Mm":
            if pts:
                subpaths.append(pts)
            x = num()
            y = num()
            if tok == "m":
                cur = (cur[0] + x, cur[1] + y)
            else:
                cur = (x, y)
            start = cur
            pts = [cur]
        elif tok in "Ll":
            x = num()
            y = num()
            cur = (x, y) if tok == "L" else (cur[0] + x, cur[1] + y)
            pts.append(cur)
        elif tok in "Hh":
            x = num()
            cur = (x, cur[1]) if tok == "H" else (cur[0] + x, cur[1])
            pts.append(cur)
        elif tok in "Vv":
            y = num()
            cur = (cur[0], y) if tok == "V" else (cur[0], cur[1] + y)
            pts.append(cur)
        elif tok in "Zz":
            pts.append(start)
            subpaths.append(pts)
            pts = []
            cur = start
    if pts:
        subpaths.append(pts)
    return subpaths


class SvgIcon:
    def __init__(self, path):
        self.elements = []
        self.vb_w = None
        self.vb_h = None
        source = Path(path).read_text(encoding="utf-8")
        self.parse(source)

    def parse(self, svg_text):
        vb = re.search(
            r'viewBox="\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)"',
            svg_text,
        )
        if vb:
            self.vb_w = float(vb.group(1))
            self.vb_h = float(vb.group(2))
        for match in re.finditer(r"<path\b([^>]*?)/>", svg_text):
            self.elements.append(("path", match.group(1)))
        for match in re.finditer(r"<rect\b([^>]*?)/>", svg_text):
            self.elements.append(("rect", match.group(1)))

    def render(self, canvas, x, y, w, h, color_override=None):
        scale = 1.0
        ox, oy = x, y
        if self.vb_w and self.vb_h:
            scale = min(w / self.vb_w, h / self.vb_h)
            ox = x + (w - self.vb_w * scale) / 2
            oy = y + (h - self.vb_h * scale) / 2
        for kind, tag_text in self.elements:
            attrs = parse_attrs(tag_text)
            if kind == "path":
                stroke = color_override or attrs.get("stroke") or "#FFFFFF"
                sw = max(1.0, float(attrs.get("stroke-width", 1)) * scale)
                for sub in parse_path(attrs.get("d", "")):
                    coords = []
                    for px, py in sub:
                        coords += [ox + px * scale, oy + py * scale]
                    if len(coords) >= 4:
                        canvas.create_line(
                            *coords, fill=stroke, width=sw,
                            capstyle="round", joinstyle="round",
                        )
            elif kind == "rect":
                rx = float(attrs.get("x", 0)) * scale
                ry = float(attrs.get("y", 0)) * scale
                rw = float(attrs.get("width", 0)) * scale
                rh = float(attrs.get("height", 0)) * scale
                fill = color_override or attrs.get("fill") or "#FFFFFF"
                canvas.create_rectangle(
                    ox + rx, oy + ry, ox + rx + rw, oy + ry + rh,
                    outline="", fill=fill,
                )


def find_asset(filename):
    for base in resource_roots():
        for candidate in (base / "assets" / filename, base / filename):
            if candidate.is_file():
                return candidate
    return None


# ===== Отрисовка через Pillow =====

SUPERSAMPLE = 4


# ===== Форматирование значений для интерфейса =====


def format_number(value, digits=1):
    """Число с запятой в роли десятичного разделителя."""
    return f"{value:.{digits}f}".replace(".", ",")


def format_size(num_bytes):
    if num_bytes >= 1024 ** 3:
        return format_number(num_bytes / 1024 ** 3) + " ГБ"
    if num_bytes >= 1024 ** 2:
        return format_number(num_bytes / 1024 ** 2) + " МБ"
    if num_bytes >= 1024:
        return format_number(num_bytes / 1024, 0) + " КБ"
    return f"{num_bytes} Б"


def format_speed(bytes_per_sec):
    if bytes_per_sec >= 1024 ** 2:
        return format_number(bytes_per_sec / 1024 ** 2) + " МБ/с"
    return format_number(bytes_per_sec / 1024, 0) + " КБ/с"


def format_duration(seconds):
    seconds = int(round(seconds))
    if seconds < 60:
        return f"{seconds} с"
    minutes, seconds = divmod(seconds, 60)
    if minutes < 60:
        return f"{minutes} мин {seconds} с" if seconds else f"{minutes} мин"
    hours, minutes = divmod(minutes, 60)
    return f"{hours} ч {minutes} мин"


def shorten_path(path):
    """Замена домашних каталогов на переменные окружения, чтобы путь влезал в строку."""
    text = str(path)
    for var in ("APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "USERPROFILE"):
        value = os.environ.get(var)
        if value and text.lower().startswith(value.lower()):
            return "%" + var + "%" + text[len(value):]
    return text


def elide_middle(root, text, font, max_width):
    """Сокращение длинного значения (обычно пути) многоточием в середине."""
    measure = tkfont.Font(root=root, font=font).measure
    if measure(text) <= max_width:
        return text
    left, right = len(text) // 2, len(text) // 2
    while left > 0 and right < len(text) - 1:
        left -= 1
        right += 1
        candidate = text[:left] + "…" + text[right:]
        if measure(candidate) <= max_width:
            return candidate
    return "…"


def dir_size(path):
    total = 0
    for root, dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
    return total


# ===== Регистрация схемы uclient:// в реестре =====


def delete_key_tree(hive, key_path):
    """
    Рекурсивное удаление ключа вместе с подключами.

    winreg.DeleteKey отказывается удалять ключ, у которого есть подключи, поэтому
    сначала собираются имена детей, а уже потом идёт обход. Имена собираются
    заранее, а не в цикле по индексу 0: если удалить какой-то подключ не удалось,
    перечисление на месте зациклилось бы на нём навсегда.
    """
    try:
        key = winreg.OpenKey(hive, key_path, 0, winreg.KEY_READ)
    except OSError:
        return
    children = []
    try:
        index = 0
        while True:
            try:
                children.append(winreg.EnumKey(key, index))
            except OSError:
                break
            index += 1
    finally:
        key.Close()
    for child in children:
        delete_key_tree(hive, key_path + "\\" + child)
    try:
        winreg.DeleteKey(hive, key_path)
    except OSError:
        pass


def register_url_scheme(exe_path):
    """
    Регистрация схемы uclient:// на текущего пользователя.

    Ошибка записи не считается фатальной и наверх не пробрасывается: клиент при
    каждом старте сам вызывает app.setAsDefaultProtocolClient и способен
    восстановить регистрацию, так что ронять из-за реестра всю установку смысла
    нет — пользователь останется с работающим клиентом, но без deep link'ов.
    """
    exe = str(exe_path)
    # Кавычки вокруг пути обязательны, даже если само имя uclient.exe пробелов
    # не содержит: каталог установки вполне может быть с пробелом (папка
    # пользователя, Program Files), и без кавычек Windows обрежет путь по
    # первому пробелу и передаст ссылку несуществующему процессу.
    command = f'"{exe}" "%1"'
    try:
        # CreateKey открывает уже существующий ключ, поэтому переустановка и
        # обновление просто перезаписывают путь — на случай смены каталога.
        with winreg.CreateKey(REG_HIVE, PROTOCOL_KEY) as key:
            winreg.SetValueEx(key, "", 0, winreg.REG_SZ, PROTOCOL_TITLE)
            # Именно наличие пустого параметра URL Protocol делает ключ URL-схемой
            winreg.SetValueEx(key, "URL Protocol", 0, winreg.REG_SZ, "")
        with winreg.CreateKey(
            REG_HIVE, PROTOCOL_KEY + r"\DefaultIcon"
        ) as key:
            winreg.SetValueEx(key, "", 0, winreg.REG_SZ, f'"{exe}",0')
        with winreg.CreateKey(
            REG_HIVE, PROTOCOL_KEY + r"\shell\open\command"
        ) as key:
            winreg.SetValueEx(key, "", 0, winreg.REG_SZ, command)
        return True
    except OSError as e:
        _log("Protocol registration failed:", e)
        return False


def unregister_url_scheme():
    """Снятие регистрации схемы. Отсутствие ключа — не ошибка."""
    try:
        delete_key_tree(REG_HIVE, PROTOCOL_KEY)
    except Exception as e:
        _log("Protocol unregister failed:", e)


def to_rgb(hex_color):
    return (
        int(hex_color[1:3], 16),
        int(hex_color[3:5], 16),
        int(hex_color[5:7], 16),
    )


def _log(*args):
    """Печать в stderr; при --noconsole у PyInstaller поток может быть None."""
    try:
        stream = sys.stderr
        if stream is None:
            return
        print(*args, file=stream)
    except Exception:
        pass


def rounded_mask(width, height, radius, fill_width=None):
    """Маска скруглённого прямоугольника, сглаженная за счёт рендера в увеличенном масштабе."""
    ss = SUPERSAMPLE
    if fill_width is None:
        fill_width = width
    fill_width = max(0.0, min(float(width), float(fill_width)))
    mask = Image.new("L", (width * ss, height * ss), 0)
    if fill_width > 0:
        # Пилюля не может быть уже своей высоты, иначе скругление вырождается
        w = max(fill_width, height) * ss
        ImageDraw.Draw(mask).rounded_rectangle(
            (0, 0, w - 1, height * ss - 1), radius=radius * ss, fill=255
        )
    return mask.resize((width, height), Image.LANCZOS)


def horizontal_gradient(width, height, start_hex, end_hex):
    row = bytearray()
    sr, sg, sb = to_rgb(start_hex)
    er, eg, eb = to_rgb(end_hex)
    for x in range(width):
        t = x / max(1, width - 1)
        row += bytes((
            round(sr + (er - sr) * t),
            round(sg + (eg - sg) * t),
            round(sb + (eb - sb) * t),
        ))
    return Image.frombytes("RGB", (width, 1), bytes(row)).resize(
        (width, height), Image.NEAREST
    )


class ProgressRenderer:
    """Кэширующий рендерер прогрессбара: скруглённый трек, градиентная заливка и бегущий блик."""

    SHINE_BAND = 48
    SHINE_AMOUNT = 0.45

    def __init__(self, width, height, pad, bg_hex, track_hex):
        self.width = width
        self.height = height
        self.pad = pad
        self.bg = to_rgb(bg_hex)
        self.inner_w = width - pad * 2
        self.inner_h = height - pad * 2
        self.track = self._render_track(track_hex)
        self._gradients = {}

    def _render_track(self, track_hex):
        ss = SUPERSAMPLE
        big = Image.new(
            "RGB", (self.width * ss, self.height * ss), self.bg
        )
        ImageDraw.Draw(big).rounded_rectangle(
            (0, 0, self.width * ss - 1, self.height * ss - 1),
            radius=(self.height / 2) * ss,
            outline=to_rgb(track_hex),
            width=ss,
        )
        return big.resize((self.width, self.height), Image.LANCZOS)

    def _gradient_pair(self, gradient):
        """Обычная и осветлённая версии градиента; осветлённая нужна для блика."""
        cached = self._gradients.get(gradient)
        if cached is None:
            base = horizontal_gradient(
                self.inner_w, self.inner_h, *gradient
            )
            bright = horizontal_gradient(
                self.inner_w, self.inner_h,
                lighten(gradient[0], self.SHINE_AMOUNT),
                lighten(gradient[1], self.SHINE_AMOUNT),
            )
            cached = (base, bright)
            self._gradients[gradient] = cached
        return cached

    def _shine_mask(self, fill_w, phase):
        """Мягкая полоса-блик, положение задаётся фазой 0..1 в пределах залитой части."""
        travel = max(0.0, fill_w - self.SHINE_BAND)
        center = self.SHINE_BAND / 2 + travel * phase
        half = self.SHINE_BAND / 2
        row = bytearray(self.inner_w)
        left = max(0, int(center - half))
        right = min(self.inner_w, int(center + half) + 1)
        for x in range(left, right):
            d = abs(x - center) / half
            row[x] = round(255 * (1 - d) ** 2)
        return Image.frombytes(
            "L", (self.inner_w, 1), bytes(row)
        ).resize((self.inner_w, self.inner_h), Image.NEAREST)

    def render(self, pct, gradient, phase=None):
        img = self.track.copy()
        fill_w = self.inner_w * max(0.0, min(1.0, pct))
        if fill_w > 0:
            base, bright = self._gradient_pair(gradient)
            fill = base
            if phase is not None:
                fill = base.copy()
                fill.paste(bright, (0, 0), self._shine_mask(fill_w, phase))
            img.paste(
                fill, (self.pad, self.pad),
                rounded_mask(
                    self.inner_w, self.inner_h,
                    self.inner_h / 2, fill_w,
                ),
            )
        return ImageTk.PhotoImage(img)


def rounded_button_image(width, height, radius, bg_hex, fill):
    """Фон кнопки: fill — либо сплошной цвет, либо пара цветов градиента."""
    if isinstance(fill, tuple):
        layer = horizontal_gradient(width, height, *fill)
    else:
        layer = Image.new("RGB", (width, height), to_rgb(fill))
    img = Image.new("RGB", (width, height), to_rgb(bg_hex))
    img.paste(layer, (0, 0), rounded_mask(width, height, radius))
    return ImageTk.PhotoImage(img)


def ease_out_back(t):
    """Плавное появление с лёгким перелётом за границу."""
    c = 1.70158
    t -= 1
    return 1 + (c + 1) * t ** 3 + c * t ** 2


def ease_out_cubic(t):
    return 1 - (1 - t) ** 3


def success_icon_image(size, progress, bg_hex, gradient):
    """Круг с галочкой; progress 0..1 — сначала появляется круг, затем прорисовывается галочка."""
    ss = SUPERSAMPLE
    px = size * ss
    img = Image.new("RGB", (px, px), to_rgb(bg_hex))

    circle_t = ease_out_back(min(1.0, progress / 0.45))
    radius = px / 2 * max(0.0, circle_t)
    if radius <= 0:
        return ImageTk.PhotoImage(img.resize((size, size), Image.LANCZOS))
    mask = Image.new("L", (px, px), 0)
    center = px / 2
    ImageDraw.Draw(mask).ellipse(
        (center - radius, center - radius,
         center + radius, center + radius), fill=255
    )
    img.paste(horizontal_gradient(px, px, *gradient), (0, 0), mask)

    check_t = (progress - 0.35) / 0.65
    if check_t > 0:
        check_t = ease_out_cubic(min(1.0, check_t))
        # Опорные точки галочки заданы в сетке 40x40 и масштабируются под размер
        pts = [(12.0, 20.5), (17.5, 26.0), (28.0, 14.5)]
        pts = [(x * px / 40, y * px / 40) for x, y in pts]
        seg1 = ((pts[1][0] - pts[0][0]) ** 2 + (pts[1][1] - pts[0][1]) ** 2) ** 0.5
        seg2 = ((pts[2][0] - pts[1][0]) ** 2 + (pts[2][1] - pts[1][1]) ** 2) ** 0.5
        drawn = (seg1 + seg2) * check_t
        line = [pts[0]]
        if drawn <= seg1:
            k = drawn / seg1
            line.append((
                pts[0][0] + (pts[1][0] - pts[0][0]) * k,
                pts[0][1] + (pts[1][1] - pts[0][1]) * k,
            ))
        else:
            k = (drawn - seg1) / seg2
            line.append(pts[1])
            line.append((
                pts[1][0] + (pts[2][0] - pts[1][0]) * k,
                pts[1][1] + (pts[2][1] - pts[1][1]) * k,
            ))
        draw = ImageDraw.Draw(img)
        width = round(3.2 * ss)
        draw.line(line, fill=(255, 255, 255), width=width, joint="curve")
        # Скругление концов штриха: ImageDraw рисует линии с плоскими торцами
        for x, y in (line[0], line[-1]):
            r = width / 2
            draw.ellipse((x - r, y - r, x + r, y + r), fill=(255, 255, 255))
    return ImageTk.PhotoImage(img.resize((size, size), Image.LANCZOS))


def load_logo(size, bg_hex):
    path = find_asset("logo.png")
    if path is None:
        return None
    try:
        src = Image.open(path).convert("RGBA").resize(
            (size, size), Image.LANCZOS
        )
    except Exception:
        return None
    canvas = Image.new("RGB", (size, size), to_rgb(bg_hex))
    canvas.paste(src, (0, 0), src)
    return ImageTk.PhotoImage(canvas)


class InstallerApp:
    def __init__(self, owner, repo, install_dir, mode="install",
                 preview_skin="install"):
        self.owner = owner
        self.repo = repo
        self.install_dir = Path(install_dir)
        self.mode = mode
        self.uninstall = mode == "uninstall"
        self.updater = mode == "updater"
        self.preview = mode == "preview"
        self.preview_skin = preview_skin
        self.relocated = None
        self.cancel_requested = False
        self.indeterminate = False
        self.msg_queue = queue.Queue()
        # Флаги итога: не даём позднему error затереть уже показанный success
        self._ui_finished = False
        self._done_emitted = False
        self._op_succeeded = False

        self.root = tk.Tk()
        self.root.title(APP_NAME)
        self.root.overrideredirect(True)
        self.root.configure(bg=BORDER)
        self.root.geometry(
            f"{WINDOW_W}x{WINDOW_H}+{self.center_x()}+{self.center_y()}"
        )
        self.root.resizable(False, False)
        if self.preview:
            self.root.attributes("-topmost", True)

        register_fonts(self.root)
        if FONT_FAMILY_SEMIBOLD != FONT_FAMILY:
            self.font_title = (FONT_FAMILY_SEMIBOLD, -14)
            self.font_card_title = (FONT_FAMILY_SEMIBOLD, -17)
        else:
            self.font_title = (FONT_FAMILY, -14, "bold")
            self.font_card_title = (FONT_FAMILY, -17, "bold")
        self.font_status = (FONT_FAMILY, -14)
        self.font_row = (FONT_FAMILY, -13)

        self.installed_before = self.install_dir.is_dir() and any(
            self.install_dir.glob("*.exe")
        )
        skin = preview_skin if self.preview else mode
        if skin == "uninstall":
            self.title_text = TITLE_UNINSTALL
            self.status_text = STATUS_UNINSTALL
            self.gradient = GRADIENT_UNINSTALL
        elif skin == "updater":
            self.title_text = TITLE_UPDATE
            self.status_text = STATUS_CHECK
            self.gradient = GRADIENT_INSTALL
        elif self.installed_before:
            self.title_text = TITLE_UPDATE
            self.status_text = STATUS_UPDATE
            self.gradient = GRADIENT_INSTALL
        else:
            self.title_text = TITLE_INSTALL
            self.status_text = STATUS_INSTALL
            self.gradient = GRADIENT_INSTALL

        self.close_icon = None
        close_svg = find_asset("close.svg")
        if close_svg:
            try:
                self.close_icon = SvgIcon(close_svg)
            except Exception:
                self.close_icon = None
        self.build_ui()
        enable_rounded_corners(self.root)
        self.drag_offset = None
        self.worker = threading.Thread(target=self.worker_main, daemon=True)
        self.worker.start()
        self.current_pct = 0.0
        self.phase_t = 0.0
        self.phase_dir = 1
        self.root.after(16, self.animate_loop)
        smoke_ms = os.environ.get("UCLIENT_INSTALLER_SMOKE_MS")
        if smoke_ms:
            self.root.after(int(smoke_ms), self.close)
        self.poll_queue()
        self.root.mainloop()
        if self.relocated:
            schedule_delete(self.relocated)

    def center_x(self):
        sw = self.root.winfo_screenwidth()
        return max(0, (sw - WINDOW_W) // 2)

    def center_y(self):
        sh = self.root.winfo_screenheight()
        return max(0, (sh - WINDOW_H) // 2)

    def build_ui(self):
        self.root.bind("<ButtonPress-1>", self.on_drag_start)
        self.root.bind("<B1-Motion>", self.on_drag_move)

        self.titlebar = tk.Frame(self.root, bg=BG, height=TITLEBAR_H)
        self.titlebar.place(x=1, y=1, width=WINDOW_W - 2, height=TITLEBAR_H)
        self.titlebar.bind("<ButtonPress-1>", self.on_drag_start)
        self.titlebar.bind("<B1-Motion>", self.on_drag_move)

        self.logo_img = load_logo(LOGO_SIZE, BG)
        if self.logo_img is not None:
            self.logo_label = tk.Label(
                self.titlebar, image=self.logo_img, bg=BG, bd=0
            )
            self.logo_label.place(
                x=LOGO_X, y=LOGO_Y, width=LOGO_SIZE, height=LOGO_SIZE
            )
            self.logo_label.bind("<ButtonPress-1>", self.on_drag_start)
            self.logo_label.bind("<B1-Motion>", self.on_drag_move)
            title_x = TITLE_X
        else:
            title_x = LOGO_X

        self.title_label = tk.Label(
            self.titlebar,
            text=self.title_text,
            font=self.font_title,
            bg=BG,
            fg=TEXT_WHITE,
            anchor="w",
        )
        self.title_label.place(
            x=title_x, y=0, width=CLOSE_X - title_x, height=TITLEBAR_H
        )
        self.title_label.bind("<ButtonPress-1>", self.on_drag_start)
        self.title_label.bind("<B1-Motion>", self.on_drag_move)

        self.close_hover_img = rounded_button_image(
            20, 20, 6, BG, BTN_BG
        )
        self.close_btn = tk.Canvas(
            self.titlebar, width=32, height=32, bg=BG,
            highlightthickness=0, cursor="hand2",
        )
        self.close_btn.place(x=CLOSE_X - 1, y=0)
        self.close_btn.bind("<ButtonPress-1>", lambda e: self.close())
        self.close_btn.bind("<Enter>", lambda e: self.draw_close(True))
        self.close_btn.bind("<Leave>", lambda e: self.draw_close(False))
        self.draw_close(False)

        self.content = tk.Frame(self.root, bg=CONTENT_BG)
        self.content.place(
            x=1, y=TITLEBAR_H + 1, width=WINDOW_W - 2, height=WINDOW_H - TITLEBAR_H - 2
        )

        self.progress_renderer = ProgressRenderer(
            PROGRESS_W, PROGRESS_H, PROGRESS_PAD, CONTENT_BG, TRACK_BG
        )
        self.progress_canvas = tk.Canvas(
            self.content, width=PROGRESS_W, height=PROGRESS_H,
            bg=CONTENT_BG, highlightthickness=0,
        )
        self.progress_canvas.place(x=PROGRESS_X, y=PROGRESS_Y)
        self.progress_photo = None
        self.progress_item = self.progress_canvas.create_image(
            0, 0, anchor="nw"
        )
        self.set_fill(0.0)

        # Детали загрузки занимают правый край строки, статус — всё остальное:
        # иначе непрозрачный фон одного лейбла перекрывает другой
        self.status_label = tk.Label(
            self.content, text=self.status_text, font=self.font_status,
            bg=CONTENT_BG, fg=TEXT_DIM, anchor="w",
        )
        self.status_label.place(
            x=16, y=48, width=PROGRESS_W - INFO_W - 8, height=16
        )

        self.percent_label = tk.Label(
            self.content, text="", font=self.font_status,
            bg=CONTENT_BG, fg=TEXT_WHITE, anchor="e",
        )
        self.percent_label.place(
            x=16 + PROGRESS_W - INFO_W, y=48, width=INFO_W, height=16
        )

        self.root.update()

    def draw_close(self, hover):
        self.close_btn.delete("all")
        if hover:
            self.close_btn.create_image(
                6, 6, anchor="nw", image=self.close_hover_img
            )
        if self.close_icon is not None:
            self.close_icon.render(self.close_btn, 10, 10, 12, 12)
        else:
            self.close_btn.create_line(13, 13, 19, 19, fill=TEXT_WHITE, width=1)
            self.close_btn.create_line(19, 13, 13, 19, fill=TEXT_WHITE, width=1)

    def on_drag_start(self, event):
        self.drag_offset = (event.x_root - self.root.winfo_x(),
                            event.y_root - self.root.winfo_y())

    def on_drag_move(self, event):
        if self.drag_offset is None:
            return
        dx = event.x_root - self.drag_offset[0]
        dy = event.y_root - self.drag_offset[1]
        self.root.geometry(f"+{dx}+{dy}")

    def close(self):
        self.cancel_requested = True
        self.root.destroy()

    def set_fill(self, pct, gradient=None, phase=None):
        self.current_pct = max(0.0, min(1.0, pct))
        if self.progress_canvas is None:
            return
        self.progress_photo = self.progress_renderer.render(
            self.current_pct, gradient or self.gradient, phase
        )
        try:
            self.progress_canvas.itemconfigure(
                self.progress_item, image=self.progress_photo
            )
        except tk.TclError:
            pass

    def animate_loop(self):
        # После разворачивания карточки прогрессбара уже нет — анимировать нечего
        if not self.root.winfo_exists() or self.progress_canvas is None:
            return
        self.phase_t += 0.02 * self.phase_dir
        if self.phase_t >= 1.0:
            self.phase_t = 1.0
            self.phase_dir = -1
        elif self.phase_t <= 0.0:
            self.phase_t = 0.0
            self.phase_dir = 1
        if self.indeterminate:
            t = ((self.anim_frame or 0) % 200) / 200.0
            self.anim_frame = (self.anim_frame or 0) + 1
            if t > 0.5:
                t = 1 - t
            self.set_fill(t * 2 * 0.9, self.gradient, self.phase_t)
        elif 0.0 < self.current_pct < 1.0:
            self.set_fill(self.current_pct, self.gradient, self.phase_t)
        self.root.after(33, self.animate_loop)

    def set_status(self, text, color=None):
        try:
            self.status_label.configure(text=text, fg=color or TEXT_DIM)
        except (tk.TclError, AttributeError):
            pass

    def set_percent(self, pct):
        try:
            self.percent_label.configure(text=f"{pct:.0f} %")
        except (tk.TclError, AttributeError):
            pass

    def show_error(self, detail=None):
        # Уже показали success — не подменяем статус на ложную ошибку
        if getattr(self, "_ui_finished", False):
            if detail:
                _log("Installer late error ignored:", detail)
            return
        self.indeterminate = False
        self.set_status(STATUS_ERROR, "#FF614C")
        self.set_fill(1.0, GRADIENT_UNINSTALL)
        try:
            self.percent_label.configure(text="")
        except (tk.TclError, AttributeError):
            pass
        if detail:
            _log("Installer error detail:", detail)

    def show_done(self, summary):
        # Защита от старого формата сообщений / битого payload
        if not isinstance(summary, dict):
            summary = {
                "title": SUMMARY_INSTALL,
                "subtitle": SUB_INSTALL,
                "rows": [],
                "button": BTN_DONE,
                "status": STATUS_DONE,
            }
        self.indeterminate = False
        self._ui_finished = True
        self.set_fill(1.0, GRADIENT_DONE)
        self.set_status(summary.get("status", STATUS_DONE), TEXT_WHITE)
        self.percent_label.configure(text="")
        # Пауза, чтобы заполненный прогрессбар успел прочитаться глазом
        self.root.after(450, lambda: self.expand_to_summary(summary))

    def expand_to_summary(self, summary):
        if not self.root.winfo_exists():
            return
        for widget in (
            self.progress_canvas, self.status_label, self.percent_label
        ):
            widget.destroy()
        self.progress_canvas = None
        target = summary_window_height(len(summary.get("rows", [])))
        self.animate_height(target, lambda: self.build_summary(summary))

    def animate_height(self, target_h, on_done, steps=14):
        """Плавный рост окна с сохранением центра по вертикали."""
        start_h = self.root.winfo_height()
        start_y = self.root.winfo_y()
        delta = target_h - start_h

        def step(i):
            if not self.root.winfo_exists():
                return
            h = round(start_h + delta * ease_out_cubic(i / steps))
            y = round(start_y - (h - start_h) / 2)
            self.root.geometry(f"{WINDOW_W}x{h}+{self.root.winfo_x()}+{y}")
            self.content.place_configure(height=h - TITLEBAR_H - 2)
            if i < steps:
                self.root.after(16, lambda: step(i + 1))
            else:
                on_done()

        step(1)

    def build_summary(self, summary):
        if not self.root.winfo_exists():
            return
        text_w = WINDOW_W - CARD_TEXT_X - 16

        self.icon_canvas = tk.Canvas(
            self.content, width=ICON_SIZE, height=ICON_SIZE,
            bg=CONTENT_BG, highlightthickness=0,
        )
        self.icon_canvas.place(x=ICON_X, y=ICON_Y)
        self.icon_item = self.icon_canvas.create_image(0, 0, anchor="nw")
        self.icon_photo = None

        tk.Label(
            self.content, text=summary["title"], font=self.font_card_title,
            bg=CONTENT_BG, fg=TEXT_WHITE, anchor="w",
        ).place(x=CARD_TEXT_X, y=16, width=text_w, height=22)
        tk.Label(
            self.content, text=summary["subtitle"], font=self.font_status,
            bg=CONTENT_BG, fg=TEXT_DIM, anchor="w",
        ).place(x=CARD_TEXT_X, y=38, width=text_w, height=18)

        rows = summary.get("rows", [])
        launch_path = summary.get("launch")
        if launch_path:
            command = lambda: self.launch(launch_path)
        else:
            command = self.close
        # Кнопка строится первой: по её левой границе обрезаются значения строк
        btn_y = summary_button_y(len(rows))
        btn_x = self.build_run_button(
            summary.get("button", BTN_DONE), command, y=btn_y,
            accent=summary.get("accent", bool(launch_path)),
        )
        value_x = 16 + ROW_LABEL_W

        if rows:
            tk.Frame(self.content, bg=DIVIDER).place(
                x=16, y=66, width=WINDOW_W - 34, height=1
            )
        for i, (label, value) in enumerate(rows):
            y = ROW_Y_FIRST + i * ROW_STEP
            # Ширину ограничивает только та строка, что идёт вровень с кнопкой
            overlaps = y + 16 > btn_y and y < btn_y + BTN_H
            right = btn_x - 12 if overlaps else WINDOW_W - 18 - 16
            value_w = max(80, right - value_x)
            tk.Label(
                self.content, text=label, font=self.font_row,
                bg=CONTENT_BG, fg=TEXT_LABEL, anchor="w",
            ).place(x=16, y=y, width=ROW_LABEL_W, height=16)
            tk.Label(
                self.content,
                text=elide_middle(self.root, value, self.font_row, value_w),
                font=self.font_row, bg=CONTENT_BG, fg=TEXT_WHITE, anchor="w",
            ).place(x=value_x, y=y, width=value_w, height=16)

        self.animate_icon(summary.get("gradient", GRADIENT_DONE))

    def animate_icon(self, gradient, frame=0):
        frames = 26
        if not self.root.winfo_exists() or not self.icon_canvas.winfo_exists():
            return
        t = min(1.0, frame / frames)
        self.icon_photo = success_icon_image(
            ICON_SIZE, t, CONTENT_BG, gradient
        )
        self.icon_canvas.itemconfigure(self.icon_item, image=self.icon_photo)
        if t < 1.0:
            self.root.after(
                16, lambda: self.animate_icon(gradient, frame + 1)
            )

    def build_run_button(self, label, command, y=44, accent=False):
        font = (FONT_FAMILY, -13)
        text_w = tkfont.Font(root=self.root, font=font).measure(label)
        btn_w = max(100, text_w + 32)
        btn_h = BTN_H
        radius = 7
        if accent:
            normal, hover = GRADIENT_DONE, tuple(
                lighten(c, 0.12) for c in GRADIENT_DONE
            )
            text_color = BTN_ACCENT_TEXT
        else:
            normal, hover = BTN_BG, BTN_BG_HOVER
            text_color = TEXT_WHITE
        self.btn_img_normal = rounded_button_image(
            btn_w, btn_h, radius, CONTENT_BG, normal
        )
        self.btn_img_hover = rounded_button_image(
            btn_w, btn_h, radius, CONTENT_BG, hover
        )
        self.run_btn = tk.Canvas(
            self.content, width=btn_w, height=btn_h, bg=CONTENT_BG,
            highlightthickness=0, cursor="hand2",
        )
        bg_item = self.run_btn.create_image(
            0, 0, anchor="nw", image=self.btn_img_normal
        )
        self.run_btn.create_text(
            btn_w / 2, btn_h / 2, text=label, fill=text_color, font=font
        )
        self.run_btn.bind("<ButtonPress-1>", lambda e: command())
        self.run_btn.bind(
            "<Enter>",
            lambda e: self.run_btn.itemconfigure(
                bg_item, image=self.btn_img_hover
            ),
        )
        self.run_btn.bind(
            "<Leave>",
            lambda e: self.run_btn.itemconfigure(
                bg_item, image=self.btn_img_normal
            ),
        )
        btn_x = WINDOW_W - 2 - btn_w - 16
        self.run_btn.place(x=btn_x, y=y)
        return btn_x

    def launch(self, path):
        try:
            os.startfile(str(path))
        except Exception:
            pass
        self.close()

    def poll_queue(self):
        try:
            while True:
                msg = self.msg_queue.get_nowait()
                kind = msg[0]
                if kind == "indeterminate":
                    self.indeterminate = True
                    self.anim_frame = 0
                    self.current_pct = 0.0
                elif kind == "determinate":
                    self.indeterminate = False
                    self.set_fill(0.0)
                    self.set_percent(0)
                elif kind == "status":
                    self.set_status(msg[1])
                elif kind == "progress":
                    self.set_fill(msg[1])
                    info = msg[2] if len(msg) > 2 else None
                    if info:
                        self.percent_label.configure(text=info)
                    else:
                        self.set_percent(msg[1] * 100)
                    if len(msg) > 3 and msg[3]:
                        self.set_status(msg[3])
                elif kind == "done":
                    self.show_done(msg[1])
                elif kind == "error":
                    # Не затираем успешную карточку, если done уже обработан
                    if not getattr(self, "_ui_finished", False):
                        self.show_error(msg[1] if len(msg) > 1 else None)
        except queue.Empty:
            pass
        self.root.after(30, self.poll_queue)

    def emit(self, msg):
        self.msg_queue.put(msg)

    def do_preview(self):
        """Демонстрация интерфейса без сетевых операций и изменений на диске."""
        total = 86 * 1024 ** 2
        speed = 5.2 * 1024 ** 2
        self.emit(("indeterminate",))
        self.emit(("status", STATUS_FETCH))
        time.sleep(1.2)
        self.emit(("determinate",))
        for i in range(101):
            time.sleep(0.025)
            done_bytes = total * i / 100
            self.emit((
                "progress", i / 100,
                self.download_info(done_bytes, total, speed),
                self.download_status(total - done_bytes, speed),
            ))
        if self.preview_skin == "uninstall":
            summary = self.uninstall_summary("1.0.5-beta", 186 * 1024 ** 2)
        else:
            summary = self.install_summary(
                "1.0.5-beta", 186 * 1024 ** 2, 42.0, None,
                previous="1.0.4-beta" if self.preview_skin == "updater" else None,
            )
        self.emit_done(summary)

    # ===== Итоговые карточки =====

    def install_summary(self, version, size_bytes, elapsed, exe, previous=None):
        updated = bool(previous) and previous.strip() != (version or "").strip()
        if updated:
            title = SUMMARY_UPDATE
            # Стрелки нет в наборе Nekst, поэтому переход версий описан словами
            subtitle = (
                f"с {previous} до {version} · за {format_duration(elapsed)}"
            )
        else:
            title = SUMMARY_INSTALL
            subtitle = SUB_INSTALL
            if version:
                subtitle = f"Версия {version}"
            subtitle += f" · за {format_duration(elapsed)}"
        return {
            "title": title,
            "subtitle": subtitle,
            "rows": [
                (ROW_FOLDER, shorten_path(self.install_dir)),
                (ROW_SIZE, format_size(size_bytes)),
            ],
            "button": BTN_RUN,
            "launch": str(exe) if exe else None,
            "accent": True,
            "status": STATUS_DONE,
        }

    def uninstall_summary(self, version, freed_bytes):
        return {
            "title": SUMMARY_UNINSTALL,
            "subtitle": SUB_UNINSTALL,
            "rows": [
                (ROW_VERSION, version or "—"),
                (ROW_FREED, format_size(freed_bytes)),
            ],
            "button": BTN_DONE,
            "launch": None,
            "status": STATUS_UNINSTALL_DONE,
            "gradient": GRADIENT_DONE,
        }

    def uptodate_summary(self, version, exe):
        return {
            "title": SUMMARY_UPTODATE,
            "subtitle": SUB_UPTODATE,
            "rows": [
                (ROW_VERSION, version or "—"),
                (ROW_FOLDER, shorten_path(self.install_dir)),
            ],
            "button": BTN_RUN if exe else BTN_CLOSE,
            "launch": str(exe) if exe else None,
            "status": STATUS_UPTODATE,
        }

    # ===== Загрузка с метриками =====

    def download_info(self, downloaded, total, speed):
        text = f"{format_size(downloaded)} из {format_size(total)}"
        if speed > 0:
            text += f" · {format_speed(speed)}"
        return text

    def download_status(self, remaining, speed):
        if speed <= 0 or remaining <= 0:
            return STATUS_DOWNLOAD
        return (
            STATUS_DOWNLOAD
            + " · осталось "
            + format_duration(remaining / speed)
        )

    def download(self, url, expected_size, dest_path):
        """Скачивание архива с отображением объёма, скорости и оставшегося времени."""
        req = urllib.request.Request(
            url, headers={"User-Agent": f"{APP_NAME}-installer"}
        )
        self.emit(("determinate",))
        self.emit(("status", STATUS_DOWNLOAD))
        with urllib.request.urlopen(req, timeout=60) as resp:
            total = expected_size or resp.headers.get("Content-Length")
            total = int(total) if total else None
            downloaded = 0
            speed = 0.0
            window_start = time.monotonic()
            window_bytes = 0
            last_emit = 0.0
            with open(dest_path, "wb") as fh:
                while True:
                    if self.cancel_requested:
                        return False
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    fh.write(chunk)
                    downloaded += len(chunk)
                    window_bytes += len(chunk)
                    now = time.monotonic()
                    elapsed = now - window_start
                    if elapsed >= 0.3:
                        # Экспоненциальное сглаживание: мгновенная скорость слишком дёргается
                        sample = window_bytes / elapsed
                        speed = sample if speed == 0 else speed * 0.6 + sample * 0.4
                        window_start, window_bytes = now, 0
                    if total and now - last_emit >= 0.1:
                        last_emit = now
                        self.emit((
                            "progress", downloaded / total,
                            self.download_info(downloaded, total, speed),
                            self.download_status(total - downloaded, speed),
                        ))
        return True

    def worker_main(self):
        self._op_succeeded = False
        self._done_emitted = False
        try:
            if self.preview:
                self.do_preview()
            elif self.uninstall:
                self.do_uninstall()
            elif self.updater:
                self.do_updater()
            else:
                self.do_install()
            self._op_succeeded = True
        except Exception as e:
            _log("Installer error:", e)
            # Если побочный эффект уже успешен (файлы на месте / удалены),
            # не показываем ложный STATUS_ERROR поверх результата.
            if self._op_succeeded or getattr(self, "_done_emitted", False):
                return
            if self._recover_as_success_after_error():
                return
            self.emit(("error", str(e)))

    def _recover_as_success_after_error(self):
        """Если операция по сути прошла — показать success вместо ложной ошибки."""
        try:
            if self.uninstall:
                # Каталог исчез или почти пуст (остались только заблокированные хвосты)
                if not self.install_dir.is_dir():
                    self.emit_done(self.uninstall_summary(self.read_version(), 0))
                    return True
                leftover = [
                    p for p in self.install_dir.rglob("*") if p.is_file()
                ]
                if len(leftover) <= 2:
                    self.emit_done(self.uninstall_summary(self.read_version(), 0))
                    return True
                return False
            exe = self.find_exe()
            if exe is None:
                return False
            version = self.read_version() or ""
            size_bytes = dir_size(self.install_dir) if self.install_dir.is_dir() else 0
            self.emit_done(self.install_summary(
                version, size_bytes, 0.0, exe, previous=None,
            ))
            return True
        except Exception as e:
            _log("Installer recover failed:", e)
            return False

    def emit_done(self, summary):
        self._done_emitted = True
        self.emit(("done", summary))

    def fetch_latest_zip(self):
        self.emit(("indeterminate",))
        self.emit(("status", STATUS_FETCH))
        site = self.fetch_latest_zip_from_site()
        if site is not None:
            return site
        return self.fetch_latest_zip_from_github()

    def fetch_latest_zip_from_site(self):
        """Зеркало на сайте: мета + стабильный /api/download/zip."""
        api_url = f"{SITE_API_BASE}/api/release/latest"
        req = urllib.request.Request(
            api_url,
            headers={
                "User-Agent": f"{APP_NAME}-installer",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                info = json.loads(resp.read().decode("utf-8"))
        except Exception as exc:
            _log("Site release meta failed:", exc)
            return None

        tag = str(info.get("tag") or info.get("version") or "").strip()
        name = str(info.get("zipFilename") or ASSET_NAME)
        size = info.get("zipSize")
        if size is not None:
            try:
                size = int(size)
            except (TypeError, ValueError):
                size = None

        if info.get("zipDirectAvailable"):
            return (name, f"{SITE_API_BASE}/api/download/zip", size, tag)

        zip_github = str(info.get("zipGithubUrl") or "").strip()
        if zip_github:
            return (name, zip_github, size, tag)

        mirror = str(info.get("zipMirrorUrl") or "").strip()
        if mirror:
            if mirror.startswith("/"):
                # Относительный путь от корня сайта (/client/...)
                base = SITE_API_BASE.rsplit("/client", 1)[0] or SITE_API_BASE
                mirror = base.rstrip("/") + mirror
            elif not mirror.startswith("http"):
                mirror = f"{SITE_API_BASE.rstrip('/')}/{mirror.lstrip('/')}"
            return (name, mirror, size, tag)

        return None

    def fetch_latest_zip_from_github(self):
        """Fallback: напрямую GitHub Releases."""
        api_url = (
            f"https://api.github.com/repos/{self.owner}/{self.repo}"
            "/releases/latest"
        )
        req = urllib.request.Request(
            api_url,
            headers={
                "User-Agent": f"{APP_NAME}-installer",
                "Accept": "application/vnd.github+json",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            release = json.loads(resp.read().decode("utf-8"))
        assets = release.get("assets", [])
        tag = str(release.get("tag_name") or "").strip()
        for asset in assets:
            if asset.get("name") == ASSET_NAME:
                return (
                    asset["name"],
                    asset["browser_download_url"],
                    asset.get("size"),
                    tag,
                )
        for asset in assets:
            if asset.get("name", "").lower().endswith(".zip"):
                return (
                    asset["name"],
                    asset["browser_download_url"],
                    asset.get("size"),
                    tag,
                )
        raise RuntimeError("No zip asset in latest release")

    def do_install(self):
        started = time.monotonic()
        previous = self.read_version() if self.installed_before else None
        name, url, size, tag = self.fetch_latest_zip()
        tag = str(tag or "").strip()
        # При переустановке поверх запущенного клиента exe занят — снимаем процесс
        if self.installed_before:
            self.kill_client()
            time.sleep(0.4)
        self.install_dir.mkdir(parents=True, exist_ok=True)
        tmp_fd, tmp_zip = tempfile.mkstemp(suffix=".zip")
        os.close(tmp_fd)
        try:
            if not self.download(url, size, tmp_zip):
                if not self.cancel_requested:
                    self.emit(("error", "download cancelled or failed"))
                return
            self.extract_zip(tmp_zip)
            exe = self.find_exe()
            if exe is None:
                raise RuntimeError("No executable found in archive")
            installed_size = self.write_install_meta(exe, tag)
            self.emit_done(self.install_summary(
                tag, installed_size, time.monotonic() - started, exe,
                previous=previous,
            ))
        finally:
            try:
                os.remove(tmp_zip)
            except OSError:
                pass

    def shortcut_paths(self):
        paths = []
        desktop = shell_folder(CSIDL_DESKTOPDIRECTORY)
        if not desktop:
            desktop = os.path.join(os.path.expanduser("~"), "Desktop")
        paths.append(os.path.join(desktop, SHORTCUT_NAME))
        programs = shell_folder(CSIDL_PROGRAMS)
        if not programs:
            programs = os.path.join(
                os.environ.get("APPDATA", os.path.expanduser("~")),
                "Microsoft", "Windows", "Start Menu", "Programs",
            )
        paths.append(os.path.join(programs, SHORTCUT_NAME))
        return paths

    def create_shortcuts(self, exe):
        for lnk in self.shortcut_paths():
            try:
                os.makedirs(os.path.dirname(lnk), exist_ok=True)
                create_shortcut(
                    lnk, str(exe),
                    working_dir=str(self.install_dir),
                    icon_path=str(exe),
                )
            except Exception:
                pass

    def remove_shortcuts(self):
        for lnk in self.shortcut_paths():
            try:
                if os.path.isfile(lnk):
                    os.remove(lnk)
            except OSError:
                pass

    def write_install_meta(self, exe, version):
        version = str(version or "").strip()
        try:
            (self.install_dir / VERSION_FILE).write_text(
                version, encoding="utf-8"
            )
        except OSError:
            pass
        size_bytes = dir_size(self.install_dir)
        size_kb = size_bytes // 1024
        try:
            with winreg.CreateKey(
                REG_HIVE, UNINSTALL_KEY
            ) as key:
                winreg.SetValueEx(
                    key, "DisplayName", 0, winreg.REG_SZ, APP_NAME
                )
                winreg.SetValueEx(
                    key, "DisplayVersion", 0, winreg.REG_SZ, version
                )
                winreg.SetValueEx(
                    key, "Publisher", 0, winreg.REG_SZ, "UClient"
                )
                winreg.SetValueEx(
                    key, "InstallLocation", 0, winreg.REG_SZ,
                    str(self.install_dir),
                )
                winreg.SetValueEx(
                    key, "DisplayIcon", 0, winreg.REG_SZ, str(exe)
                )
                winreg.SetValueEx(
                    key, "UninstallString", 0, winreg.REG_SZ,
                    f'"{self.install_dir / "unins000.exe"}"',
                )
                winreg.SetValueEx(
                    key, "QuietUninstallString", 0, winreg.REG_SZ,
                    f'"{self.install_dir / "unins000.exe"}" --mode uninstall',
                )
                winreg.SetValueEx(
                    key, "NoModify", 0, winreg.REG_DWORD, 1
                )
                winreg.SetValueEx(
                    key, "NoRepair", 0, winreg.REG_DWORD, 1
                )
                winreg.SetValueEx(
                    key, "EstimatedSize", 0, winreg.REG_DWORD, int(size_kb)
                )
                winreg.SetValueEx(
                    key, "URLInfoAbout", 0, winreg.REG_SZ,
                    f"https://github.com/{self.owner}/{self.repo}/releases",
                )
        except OSError:
            pass
        try:
            with winreg.CreateKey(
                REG_HIVE, APP_PATHS_KEY
            ) as key:
                winreg.SetValueEx(
                    key, "", 0, winreg.REG_SZ, str(exe)
                )
        except OSError:
            pass
        # Схема перерегистрируется на каждой установке и обновлении: каталог
        # установки мог смениться, и в реестре остался бы путь к старому exe.
        try:
            register_url_scheme(exe)
        except Exception as e:
            _log("Protocol registration raised:", e)
        try:
            self.create_shortcuts(exe)
        except Exception as e:
            _log("Shortcuts creation raised:", e)
        return size_bytes

    def read_version(self):
        try:
            with winreg.OpenKey(
                REG_HIVE, UNINSTALL_KEY
            ) as key:
                value, _ = winreg.QueryValueEx(key, "DisplayVersion")
                return str(value)
        except OSError:
            pass
        try:
            return (self.install_dir / VERSION_FILE).read_text(
                encoding="utf-8"
            ).strip()
        except OSError:
            return ""

    def remove_registry(self):
        for key_path in (UNINSTALL_KEY, APP_PATHS_KEY):
            try:
                key = winreg.OpenKey(
                    REG_HIVE, key_path, 0,
                    winreg.KEY_SET_VALUE | winreg.KEY_QUERY_VALUE,
                )
                try:
                    while True:
                        try:
                            winreg.DeleteValue(
                                key, winreg.EnumValue(key, 0)[0]
                            )
                        except OSError:
                            break
                finally:
                    key.Close()
                winreg.DeleteKey(REG_HIVE, key_path)
            except OSError:
                pass
        # У схемы есть подключи (DefaultIcon, shell\open\command), поэтому она
        # снимается отдельной рекурсивной процедурой, а не DeleteKey.
        try:
            unregister_url_scheme()
        except Exception as e:
            _log("Registry protocol cleanup raised:", e)

    def kill_client(self):
        try:
            subprocess.run(
                ["taskkill", "/IM", CLIENT_EXE, "/F"],
                capture_output=True, timeout=10,
                creationflags=0x08000000,
            )
        except Exception:
            pass

    def relocate_self(self):
        if not getattr(sys, "frozen", False):
            return None
        exe = Path(sys.executable)
        try:
            if self.install_dir.resolve() in exe.resolve().parents:
                tmp = Path(tempfile.gettempdir()) / (
                    exe.stem + "_" + str(os.getpid()) + exe.suffix
                )
                os.replace(exe, tmp)
                return tmp
        except OSError:
            pass
        return None

    def do_updater(self):
        started = time.monotonic()
        installed = self.read_version()
        try:
            name, url, size, tag = self.fetch_latest_zip()
        except Exception as e:
            _log("Updater fetch error:", e)
            self.emit(("error", str(e)))
            return
        tag = str(tag or "").strip()
        if tag and installed:
            if tag.strip().lstrip("vV") == installed.strip().lstrip("vV"):
                self.emit_done(self.uptodate_summary(installed, self.find_exe()))
                return
        self.kill_client()
        time.sleep(0.4)
        self.install_dir.mkdir(parents=True, exist_ok=True)
        tmp_fd, tmp_zip = tempfile.mkstemp(suffix=".zip")
        os.close(tmp_fd)
        try:
            if not self.download(url, size, tmp_zip):
                if not self.cancel_requested:
                    self.emit(("error", "download cancelled or failed"))
                return
            self.relocated = self.relocate_self()
            if self.install_dir.is_dir():
                shutil.rmtree(self.install_dir, ignore_errors=True)
            self.install_dir.mkdir(parents=True, exist_ok=True)
            self.extract_zip(tmp_zip)
            exe = self.find_exe()
            if exe is None:
                raise RuntimeError("No executable found in archive")
            installed_size = self.write_install_meta(exe, tag)
            self.emit_done(self.install_summary(
                tag, installed_size, time.monotonic() - started, exe,
                previous=installed,
            ))
        finally:
            try:
                os.remove(tmp_zip)
            except OSError:
                pass

    def extract_zip(self, zip_path):
        self.emit(("status", STATUS_EXTRACT))
        with zipfile.ZipFile(zip_path) as zf:
            names = zf.namelist()
            total = max(1, len(names))
            install_root = self.install_dir.resolve()
            for i, member in enumerate(names):
                if self.cancel_requested:
                    return
                try:
                    target = (self.install_dir / member).resolve()
                    # Zip-slip: путь обязан остаться внутри каталога установки
                    target.relative_to(install_root)
                except (ValueError, OSError):
                    continue
                try:
                    zf.extract(member, self.install_dir)
                except Exception as e:
                    # Один занятый файл (uclient.exe и т.п.) не роняет всю установку
                    _log("Extract skip:", member, e)
                self.emit(("progress", (i + 1) / total))

    def find_exe(self):
        for root, dirs, files in os.walk(self.install_dir):
            for f in files:
                if f.lower() == CLIENT_EXE:
                    return Path(root) / f
        for root, dirs, files in os.walk(self.install_dir):
            for f in files:
                if f.lower().endswith(".exe"):
                    return Path(root) / f
        return None

    def do_uninstall(self):
        self.emit(("indeterminate",))
        version = self.read_version()
        freed = dir_size(self.install_dir) if self.install_dir.is_dir() else 0
        self.kill_client()
        time.sleep(0.4)
        self.relocated = self.relocate_self()
        if self.install_dir.is_dir():
            shutil.rmtree(self.install_dir, ignore_errors=True)
        try:
            self.remove_registry()
        except Exception as e:
            _log("Uninstall registry cleanup:", e)
        try:
            self.remove_shortcuts()
        except Exception as e:
            _log("Uninstall shortcuts cleanup:", e)
        self.emit_done(self.uninstall_summary(version, freed))


def schedule_delete(path):
    try:
        subprocess.Popen(
            ["cmd", "/c",
             f'timeout /t 1 /nobreak >nul & del /f /q "{path}"'],
            creationflags=0x08000000,
        )
    except Exception:
        pass


class GUID(ctypes.Structure):
    _fields_ = [
        ("Data1", ctypes.c_ulong),
        ("Data2", ctypes.c_ushort),
        ("Data3", ctypes.c_ushort),
        ("Data4", ctypes.c_ubyte * 8),
    ]


CLSID_ShellLink = GUID(0x00021401, 0x0000, 0x0000, (0xC0, 0, 0, 0, 0, 0, 0, 0x46))
IID_IShellLinkW = GUID(0x000214F9, 0x0000, 0x0000, (0xC0, 0, 0, 0, 0, 0, 0, 0x46))
IID_IPersistFile = GUID(0x0000010B, 0x0000, 0x0000, (0xC0, 0, 0, 0, 0, 0, 0, 0x46))

HRESULT = ctypes.c_long
LPVOID = ctypes.c_void_p
LPWSTR = ctypes.c_wchar_p


def shell_folder(csidl):
    buf = ctypes.create_unicode_buffer(260)
    try:
        if ctypes.windll.shell32.SHGetFolderPathW(
            None, csidl, None, 0, buf
        ) == 0 and buf.value:
            return buf.value
    except Exception:
        pass
    return None


def create_shortcut(lnk_path, target, working_dir=None, icon_path=None):
    """Создание .lnk через IShellLink. Ошибки COM не фатальны для установки."""
    need_uninit = False
    try:
        # windll: не бросает на S_FALSE (COM уже инициализирован Tk)
        ole32 = ctypes.windll.ole32
        hr = int(ole32.CoInitialize(None) or 0)
        if hr == 0:
            need_uninit = True
        elif hr != 1:
            # S_FALSE=1 — COM уже был; прочие коды — пропускаем ярлык
            return False
        shell_link = LPVOID()
        create_hr = int(ole32.CoCreateInstance(
            ctypes.byref(CLSID_ShellLink), None, 1,
            ctypes.byref(IID_IShellLinkW), ctypes.byref(shell_link),
        ) or 0)
        if create_hr < 0 or not shell_link:
            return False
        vtbl = ctypes.cast(
            shell_link, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))
        ).contents
        ctypes.WINFUNCTYPE(
            HRESULT, LPVOID, LPWSTR
        )(vtbl[20])(shell_link, target)
        if working_dir:
            ctypes.WINFUNCTYPE(
                HRESULT, LPVOID, LPWSTR
            )(vtbl[9])(shell_link, working_dir)
        if icon_path:
            ctypes.WINFUNCTYPE(
                HRESULT, LPVOID, LPWSTR, ctypes.c_int
            )(vtbl[17])(shell_link, icon_path, 0)
        persist = LPVOID()
        ctypes.WINFUNCTYPE(
            HRESULT, LPVOID, ctypes.POINTER(GUID),
            ctypes.POINTER(LPVOID),
        )(vtbl[0])(
            shell_link, ctypes.byref(IID_IPersistFile),
            ctypes.byref(persist),
        )
        if not persist:
            return False
        vtbl_p = ctypes.cast(
            persist, ctypes.POINTER(ctypes.POINTER(LPVOID))
        ).contents
        ctypes.WINFUNCTYPE(
            HRESULT, LPVOID, LPWSTR, ctypes.c_int
        )(vtbl_p[6])(persist, lnk_path, 1)
        ctypes.WINFUNCTYPE(ctypes.c_ulong, LPVOID)(vtbl[2])(shell_link)
        ctypes.WINFUNCTYPE(ctypes.c_ulong, LPVOID)(vtbl_p[2])(persist)
        return True
    except Exception:
        return False
    finally:
        if need_uninit:
            try:
                ctypes.windll.ole32.CoUninitialize()
            except Exception:
                pass


def parse_args():
    parser = argparse.ArgumentParser(description=f"Installer for {APP_NAME}")
    parser.add_argument("--owner", default=GITHUB_OWNER)
    parser.add_argument("--repo", default=GITHUB_REPO)
    parser.add_argument("--dir", default=INSTALL_DIR)
    parser.add_argument(
        "--mode", choices=("install", "updater", "uninstall", "preview"),
        default="install",
    )
    parser.add_argument("--uninstall", action="store_true")
    parser.add_argument(
        "--preview-as", choices=("install", "updater", "uninstall"),
        default="install",
        help="Оформление, которое показывать в режиме preview",
    )
    return parser.parse_args()


def main():
    set_dpi_awareness()
    args = parse_args()
    mode = "uninstall" if args.uninstall else args.mode
    InstallerApp(args.owner, args.repo, args.dir, mode, args.preview_as)


if __name__ == "__main__":
    main()
