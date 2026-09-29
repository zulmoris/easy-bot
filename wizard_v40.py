# -*- coding: utf-8 -*-
r"""
Easy Bot 4.0 — мастер первичной настройки.
Запуск:  .venv\Scripts\python wizard_v40.py
"""
import os, sys, json, webbrowser, urllib.request, urllib.parse
from datetime import datetime
from pathlib import Path
import customtkinter as ctk
from tkinter import filedialog, messagebox

APP_NAME   = "Easy Bot"
DATA_DIR   = Path(os.environ.get("APPDATA", str(Path.home()))) / "EasyBot"
APP_DIR    = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).parent
KEY_FILE   = DATA_DIR / "key.json"
GAS_FILE   = APP_DIR / "apps_script.gs"
TEMPLATE_URL = "https://docs.google.com/spreadsheets/d/1b4fuRTzRlRDGSHzXJeoNWHPMCPmzO6L7a-59J7uw5MI/edit"

ctk.set_appearance_mode("system")
ctk.set_default_color_theme("blue")

# ============ СЕРВИСНЫЕ ФУНКЦИИ ============
def http_get(url: str, timeout=25) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": f"{APP_NAME}/4.0"})
    return urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8")

def find_key():
    for p in (DATA_DIR / "key.json", APP_DIR / "key.json"):
        if p.exists():
            return p
    return None

def read_service_email() -> str:
    p = find_key()
    if not p:
        return ""
    try:
        return json.loads(p.read_text(encoding="utf-8")).get("client_email", "")
    except Exception:
        return ""

def check_sheet(url: str) -> tuple:
    import gspread
    from gspread.exceptions import APIError
    p = find_key()
    if not p:
        return False, "❌ key.json не найден — вернитесь на шаг «Google-проект»"
    if "docs.google.com" not in (url or ""):
        return False, "❌ Это не ссылка на Google-таблицу"
    try:
        sh = gspread.service_account(filename=str(p)).open_by_url(url)
        return True, f"✅ Доступ есть: «{sh.title}»"
    except APIError as e:
        code = getattr(e.response, "status_code", 0)
        if code == 403:
            return False, ("❌ Нет доступа.\n1) «Настроить доступ» → вставьте email сервисного "
                           "аккаунта (кнопка 📋 выше) → Редактор\n2) Если уже добавили — включите "
                           "Sheets API: console.cloud.google.com/apis/library/sheets.googleapis.com")
        if code == 404:
            return False, "❌ Таблица не найдена — проверьте ссылку (скопирована ли КОПИЯ?)"
        return False, f"❌ API ошибка {code}"
    except Exception as e:
        return False, f"❌ {e}"

def check_token(token: str) -> tuple:
    token = token.strip()
    if not token:
        return False, "❌ Введите токен"
    try:
        r = json.loads(http_get(f"https://api.telegram.org/bot{token}/getMe"))
        if r.get("ok"):
            return True, f"✅ Бот найден: @{r['result']['username']}"
        return False, "❌ Telegram отклонил токен"
    except Exception as e:
        return False, f"❌ {e}"

def check_gas(url: str) -> tuple:
    url = url.strip()
    if not (url.startswith("https://script.google.com/") and url.rstrip("/").endswith("exec")):
        return False, "❌ Ссылка должна быть вида https://script.google.com/macros/s/.../exec"
    try:
        body = http_get(url)
        if "unknown action" in body:
            return True, "✅ Веб-приложение живое"
        return False, f"⚠️ Неожиданный ответ: {body[:100]}"
    except Exception as e:
        return False, f"❌ {e}"

def smoke_test(gas_url: str, chat_id: str) -> tuple:
    try:
        q = urllib.parse.urlencode({"action": "notify", "chat_id": chat_id,
                                    "text": f"✅ {APP_NAME} 4.0 установлен и работает!"})
        r = json.loads(http_get(f"{gas_url}?{q}"))
        return (bool(r.get("ok") and r.get("sent")),
                "✅ Тестовое сообщение отправлено" if r.get("ok") else f"❌ {r}")
    except Exception as e:
        return False, f"❌ {e}"

def save_settings(sheet_url: str, folder: str):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "settings.json").write_text(
        json.dumps({"sheet_url": sheet_url}, ensure_ascii=False, indent=2), encoding="utf-8")
    (DATA_DIR / "config.json").write_text(
        json.dumps({"folder_path": folder}, ensure_ascii=False, indent=2), encoding="utf-8")

def already_configured() -> bool:
    return (DATA_DIR / "settings.json").exists()

# ============ ЭКСПОРТ/ИМПОРТ (перенос настроек на второй ПК) ============
CONFIG_EXPORT_NAME = "easybot-config.json"

def export_config(target_path) -> tuple:
    """Собирает все настройки в один файл для переноса на другой ПК."""
    try:
        settings, config, key = {}, {}, None
        if (DATA_DIR / "settings.json").exists():
            settings = json.loads((DATA_DIR / "settings.json").read_text(encoding="utf-8"))
        if (DATA_DIR / "config.json").exists():
            config = json.loads((DATA_DIR / "config.json").read_text(encoding="utf-8"))
        if KEY_FILE.exists():
            key = json.loads(KEY_FILE.read_text(encoding="utf-8"))
        if not settings and not key:
            return False, "Нечего экспортировать — сначала пройдите настройку"
        payload = {
            "product": APP_NAME,
            "version": "4.0",
            "exported_at": datetime.now().strftime("%d.%m.%Y %H:%M"),
            "settings": settings,
            "config": config,
            "key": key,
        }
        Path(target_path).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return True, str(target_path)
    except Exception as e:
        return False, str(e)

def import_config(path) -> tuple:
    """Разворачивает настройки из файла экспорта. Возвращает (ok, url_таблицы_или_ошибка)."""
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if data.get("product") != APP_NAME:
            return False, "Это не файл настроек Easy Bot"
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        if data.get("settings"):
            (DATA_DIR / "settings.json").write_text(
                json.dumps(data["settings"], ensure_ascii=False, indent=2), encoding="utf-8")
        if data.get("config"):
            (DATA_DIR / "config.json").write_text(
                json.dumps(data["config"], ensure_ascii=False, indent=2), encoding="utf-8")
        if data.get("key"):
            KEY_FILE.write_text(
                json.dumps(data["key"], ensure_ascii=False, indent=2), encoding="utf-8")
        return True, data.get("settings", {}).get("sheet_url", "")
    except Exception as e:
        return False, str(e)

# ============ UI-КАРКАС ============
STEPS = ["Приветствие", "Google-проект", "Таблица", "Telegram-бот",
         "Токен → скрипт", "Apps Script", "Главный чат", "Папка PDF", "Готово"]

class Wizard(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title(f"{APP_NAME} 4.0 — первичная настройка")
        self.geometry("820x600")
        self.answers = {}
        self.step = 0
        if already_configured():
            self.step = -1
        elif (APP_DIR / CONFIG_EXPORT_NAME).exists():
            if messagebox.askyesno(APP_NAME,
                "Рядом с программой найден файл настроек (easybot-config.json).\n"
                "Импортировать его? (для второго ПК этой фирмы)"):
                if self.do_import():
                    return          # импорт удался — окно закрыто, мастер не нужен
            self.step = 0
        self.header = ctk.CTkFrame(self, height=46); self.header.pack(fill="x")
        self.body   = ctk.CTkFrame(self); self.body.pack(fill="both", expand=True)
        self.nav    = ctk.CTkFrame(self, height=56); self.nav.pack(fill="x")
        self.btn_back = ctk.CTkButton(self.nav, text="← Назад", width=110, command=self.go_back)
        self.btn_back.pack(side="left", padx=12, pady=10)
        self.lbl_step = ctk.CTkLabel(self.nav, text=""); self.lbl_step.pack(side="left", expand=True)
        self.btn_next = ctk.CTkButton(self.nav, text="Далее →", width=130, command=self.go_next)
        self.btn_next.pack(side="right", padx=12, pady=10)
        self.bind_all("<Control-KeyPress>", self._paste_any_layout, add="+")
        self.render()

    # --- навигация ---
    def go_next(self):
        validator = getattr(self, f"validate_{self.step}", None)
        if validator and not validator():
            return
        if self.step >= len(STEPS) - 1:
            messagebox.showinfo(APP_NAME, "Настройка завершена. Можно закрыть окно ✅")
            self.destroy()
            return
        self.step += 1
        self.render()

    def go_back(self):
        self.step = max(0, self.step - 1)
        self.render()

    def render(self):
        for f in (self.header, self.body):
            for w in f.winfo_children():
                w.destroy()
        idx = self.step
        self.btn_back.configure(state="normal" if idx > 0 else "disabled")
        title = "Выбор режима" if idx == -1 else f"Шаг {idx+1} из {len(STEPS)} — {STEPS[idx]}"
        self.lbl_step.configure(text=title)
        page = getattr(self, f"page_{idx}".replace("-", "_"), None)
        if page:
            page()
        else:
            ctk.CTkLabel(self.body, text="(страница в разработке)").pack(pady=40)

    # --- вспомогательное UI ---
    def clip(self, text: str):
        self.clipboard_clear()
        self.clipboard_append(text)
        self._toast("Скопировано")

    def _toast(self, msg: str):
        ctk.CTkLabel(self.header, text=msg, text_color="#2e7d32").pack(side="right", padx=12)

    # --- вспомогательное UI ---
    def clip(self, text: str):
        self.clipboard_clear()
        self.clipboard_append(text)
        self._toast("Скопировано")

    def _toast(self, msg: str):
        ctk.CTkLabel(self.header, text=msg, text_color="#2e7d32").pack(side="right", padx=12)

    def _paste_any_layout(self, event):
        """Ctrl+V работает на любой раскладке (клиенты будут на русской)."""
        keysym = (event.keysym or "").lower()
        if keysym not in ("v", "м"):      # 'м' — физическая клавиша V на русской раскладке
            return
        if event.state & 0x0004:          # зажат Control
            try:
                text = self.clipboard_get()
            except Exception:
                return
            widget = self.focus_get()
            if isinstance(widget, ctk.CTkEntry) or widget.__class__.__name__ == "Entry":
                widget.delete(0, "end")
                widget.insert(0, text)

    def result_label(self):
        lbl = ctk.CTkLabel(self.body, text="", justify="left")
        lbl.pack(anchor="w", padx=24, pady=6)
        return lbl

    def run_check(self, fn, *args):
        if not hasattr(self, "lbl_res"):
            self.lbl_res = self.result_label()
        ok, msg = fn(*args)
        self.lbl_res.configure(text=msg, text_color="#2e7d32" if ok else "#c62828")
        self.check_ok = ok

    # ================= СТРАНИЦЫ =================
    def page__1(self):  # уже установлено
        ctk.CTkLabel(self.body, text="Обнаружена существующая настройка",
                     font=("", 20, "bold")).pack(pady=(40, 8))
        ctk.CTkLabel(self.body, text="Easy Bot уже настроен на этом компьютере.\nЧто делаем?",
                     justify="center").pack(pady=8)
        row = ctk.CTkFrame(self.body); row.pack(pady=16)
        ctk.CTkButton(row, text="Подключиться к существующей", width=200,
                      command=self.connect_existing).pack(side="left", padx=6)
        ctk.CTkButton(row, text="📤 Экспорт для 2-го ПК", width=180,
                      fg_color="#2e7d32", command=self.do_export).pack(side="left", padx=6)
        ctk.CTkButton(row, text="Настроить заново", width=160,
                      fg_color="#c62828", command=self.start_fresh).pack(side="left", padx=6)
        ctk.CTkLabel(self.body, justify="center", text_color="#666666",
                     text="Для ВТОРОГО компьютера: скопируйте файл туда,\n"
                          "запустите мастер и нажмите «Импорт» на первом экране."
                     ).pack(pady=20)

    def connect_existing(self):
        messagebox.showinfo(APP_NAME, "Подключение к существующей настройке — готово.\n"
                            "Запустите Easy Bot из меню «Пуск».")
        self.destroy()

    def do_export(self):
        target = filedialog.asksaveasfilename(
            title="Куда сохранить файл настроек",
            initialfile=CONFIG_EXPORT_NAME, defaultextension=".json",
            filetypes=[("Easy Bot настройки", "*.json")])
        if not target:
            return
        ok, msg = export_config(Path(target))
        if ok:
            messagebox.showinfo(APP_NAME,
                "Файл настроек сохранён:\n" + msg +
                "\n\n⚠️ Внутри файла — ключ доступа к таблице (как пароль).\n"
                "Передавайте только лично, не через открытые чаты.")
        else:
            messagebox.showerror(APP_NAME, "Ошибка экспорта:\n" + msg)

    def do_import(self):
        """Возвращает True, если импорт завершён (окно закрыто)."""
        path = filedialog.askopenfilename(
            title="Выберите файл easybot-config.json",
            filetypes=[("Easy Bot настройки", "*.json"), ("Все файлы", "*.*")])
        if not path:
            return False
        ok, url = import_config(Path(path))
        if not ok:
            messagebox.showerror(APP_NAME, url)
            return False
        folder = filedialog.askdirectory(
            title="Выберите папку для PDF-счетов НА ЭТОМ компьютере")
        if not folder:
            folder = str(Path.home() / "Desktop" / "Счета для бота")
        (DATA_DIR / "config.json").write_text(
            json.dumps({"folder_path": folder.replace("/", "\\")},
                       ensure_ascii=False, indent=2), encoding="utf-8")
        ok2, msg2 = check_sheet(url)
        if ok2:
            messagebox.showinfo(APP_NAME,
                "✅ Настройки перенесены, доступ проверен!\n\n"
                "Таблица: " + url + "\nПапка PDF: " + folder)
        else:
            messagebox.showwarning(APP_NAME,
                "Настройки перенесены, но доступ не подтверждён:\n" + msg2)
        self.destroy()
        return True

    def start_fresh(self):
        self.step = 0
        self.render()

    def page_0(self):
        ctk.CTkLabel(self.body, text="👋 Здравствуйте!\nЭто Easy Bot 4.0",
                     font=("", 26, "bold")).pack(pady=(50, 10))
        ctk.CTkLabel(self.body, justify="center", text=(
            "Мастер настроит всё за ~15 минут:\n\n"
            "  1. Google-таблицу и доступы\n"
            "  2. Telegram-бота для уведомлений\n"
            "  3. Папку для PDF-счетов\n\n"
            "Вам понадобятся: аккаунт Google и 15 минут времени.\n"
            "Жмите «Далее →»")).pack()
        ctk.CTkButton(self.body, text="📥 У меня есть файл настроек с другого ПК",
                      command=self.do_import).pack(pady=14)

    # ============ ШАГ 1: GOOGLE-ПРОЕКТ ============
    def page_1(self):
        ctk.CTkLabel(self.body, text="Шаг 1. Ключ Google (key.json)",
                     font=("", 20, "bold")).pack(pady=(18, 4), anchor="w", padx=24)
        ctk.CTkLabel(self.body, justify="left", text=(
            "Программе нужен ключ доступа к Google-таблицам от имени сервисного аккаунта.\n"
            "Если у вас уже есть проект Google Cloud и ключ — просто укажите файл."
        )).pack(anchor="w", padx=24)

        key = find_key()
        if key:
            email = read_service_email()
            box = ctk.CTkFrame(self.body, fg_color="#e8f5e9")
            box.pack(fill="x", padx=24, pady=12)
            ctk.CTkLabel(box, text=f"✅ Ключ найден: {key}", text_color="#2e7d32",
                         justify="left").pack(anchor="w", padx=12, pady=(10, 2))
            row = ctk.CTkFrame(box, fg_color="transparent"); row.pack(fill="x", padx=12, pady=(0, 10))
            ctk.CTkLabel(row, text=f"Email сервисного аккаунта: {email}").pack(side="left")
            ctk.CTkButton(row, width=40, text="📋", command=lambda: self.clip(email)).pack(side="left", padx=6)
            self.btn_next.configure(state="normal")
        else:
            ctk.CTkLabel(self.body, justify="left", text=(
                "Ключ не найден. Выполните 4 шага (по порядку), затем укажите скачанный файл:"
            )).pack(anchor="w", padx=24, pady=(8, 4))
            steps = [
                ("1. Создать проект в Google Cloud",
                 "https://console.cloud.google.com/projectcreate",
                 "Название любое, например «easybot». Ничего больше менять не нужно → «Создать»."),
                ("2. Включить Google Sheets API",
                 "https://console.cloud.google.com/apis/library/sheets.googleapis.com",
                 "Выберите созданный проект сверху → кнопка «Включить» → подождите ~1 минуту."),
                ("3. Включить Google Drive API",
                 "https://console.cloud.google.com/apis/library/drive.googleapis.com",
                 "Там же: найдите и нажмите «Включить»."),
                ("4. Создать сервисный аккаунт и ключ",
                 "https://console.cloud.google.com/iam-admin/serviceaccounts/create",
                 "Имя любое → «Готово» → в списке аккаунта: ⋮ → «Управление ключами» → "
                 "«Добавить ключ» → JSON → файл скачается."),
            ]
            for title, url, hint in steps:
                card = ctk.CTkFrame(self.body)
                card.pack(fill="x", padx=24, pady=4)
                inner = ctk.CTkFrame(card, fg_color="transparent"); inner.pack(fill="x", padx=12, pady=8)
                ctk.CTkLabel(inner, text=title, justify="left", font=("", 13, "bold")).pack(anchor="w")
                ctk.CTkLabel(inner, text=hint, justify="left", wraplength=640).pack(anchor="w")
                ctk.CTkButton(card, width=150, text="🌐 Открыть ссылку",
                              command=lambda u=url: webbrowser.open(u)).pack(anchor="e", padx=12, pady=(0, 8))
            row2 = ctk.CTkFrame(self.body, fg_color="transparent"); row2.pack(fill="x", padx=24, pady=10)
            ctk.CTkButton(row2, text="📁 Указать скачанный key.json", command=self.pick_key).pack(side="left")
            self.btn_next.configure(state="disabled")

    def pick_key(self):
        path = filedialog.askopenfilename(
            title="Выберите скачанный JSON-ключ",
            filetypes=[("JSON файлы", "*.json"), ("Все файлы", "*.*")])
        if not path:
            return
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
            email = data.get("client_email", "")
            if not email or "iam.gserviceaccount.com" not in email:
                messagebox.showerror(APP_NAME, "Это не похоже на ключ сервисного аккаунта\n"
                                               "(нет поля client_email). Проверьте файл.")
                return
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            KEY_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            self.answers["key_email"] = email
            messagebox.showinfo(APP_NAME, f"Ключ сохранён.\nСервисный аккаунт: {email}")
            self.render()
        except Exception as e:
            messagebox.showerror(APP_NAME, f"Не удалось прочитать файл:\n{e}")

    def validate_1(self):
        if not find_key():
            messagebox.showwarning(APP_NAME, "Сначала укажите файл key.json")
            return False
        return True

    # ============ ШАГ 2: ТАБЛИЦА ============
    def page_2(self):
        ctk.CTkLabel(self.body, text="Шаг 2. Ваша Google-таблица",
                     font=("", 20, "bold")).pack(pady=(18, 4), anchor="w", padx=24)
        ctk.CTkLabel(self.body, justify="left", text=(
            "1) Нажмите «Открыть шаблон» → в открывшейся таблице:\n"
            "     Файл → Создать копию (копия сохранится в вашем Google)\n"
            "2) В КОПИИ: «Настроить доступ» → вставьте email сервисного аккаунта\n"
            "     (кнопка 📋 ниже копирует его) → роль «Редактор» → «Отправить»\n"
            "3) Скопируйте адрес КОПИИ из браузера и вставьте ниже → «Проверить»"
        )).pack(anchor="w", padx=24, pady=6)

        email = self.answers.get("key_email") or read_service_email()
        row0 = ctk.CTkFrame(self.body); row0.pack(fill="x", padx=24, pady=4)
        ctk.CTkLabel(row0, text=f"Ваш email сервисного аккаунта:  {email}").pack(side="left", padx=12, pady=6)
        ctk.CTkButton(row0, width=40, text="📋", command=lambda: self.clip(email)).pack(side="left")
        ctk.CTkButton(row0, width=160, text="🌐 Открыть шаблон",
                      command=lambda: webbrowser.open(TEMPLATE_URL)).pack(side="left", padx=8)

        ctk.CTkLabel(self.body, text="Ссылка на ВАШУ КОПИЮ таблицы:").pack(anchor="w", padx=24, pady=(10, 0))
        self.e_sheet = ctk.CTkEntry(self.body, width=680,
                                    placeholder_text="https://docs.google.com/spreadsheets/d/...")
        self.e_sheet.pack(anchor="w", padx=24, pady=4)
        row1 = ctk.CTkFrame(self.body, fg_color="transparent"); row1.pack(fill="x", padx=24)
        ctk.CTkButton(row1, text="✔ Проверить", width=120,
                      command=lambda: self.run_check(check_sheet, self.e_sheet.get().strip())).pack(side="left")
        self.lbl_res = self.result_label()
        self.btn_next.configure(state="normal")

    def validate_2(self):
        url = self.e_sheet.get().strip()
        ok, msg = check_sheet(url)
        if not ok:
            messagebox.showerror(APP_NAME, msg)
            return False
        self.answers["sheet_url"] = url
        return True

    # ============ ШАГ 3: TELEGRAM-БОТ ============
    def page_3(self):
        ctk.CTkLabel(self.body, text="Шаг 3. Telegram-бот",
                     font=("", 20, "bold")).pack(pady=(18, 4), anchor="w", padx=24)
        self.var_bot = ctk.StringVar(value="new" if not self.answers.get("bot_token") else "have")
        row_mode = ctk.CTkFrame(self.body, fg_color="transparent"); row_mode.pack(fill="x", padx=24, pady=6)
        ctk.CTkRadioButton(row_mode, text="Создать нового бота", variable=self.var_bot,
                           value="new", command=self._toggle_bot_mode).pack(side="left", padx=(0, 20))
        ctk.CTkRadioButton(row_mode, text="У меня уже есть токен", variable=self.var_bot,
                           value="have", command=self._toggle_bot_mode).pack(side="left")

        self.bot_frame = ctk.CTkFrame(self.body, fg_color="transparent")
        self.bot_frame.pack(fill="x", padx=24, pady=6)
        self._render_bot_mode()
        self.lbl_res = self.result_label()

    def _toggle_bot_mode(self):
        self._render_bot_mode()

    def _render_bot_mode(self):
        for w in self.bot_frame.winfo_children():
            w.destroy()
        if self.var_bot.get() == "new":
            ctk.CTkLabel(self.bot_frame, justify="left", text=(
                "1) Откройте в Telegram бота @BotFather → команда /newbot\n"
                "2) Введите имя (любое, например «Easy Bot Аганим»)\n"
                "3) Введите username — он должен заканчиваться на «bot»\n"
                "     (например: aganim_easy_bot)\n"
                "4) BotFather пришлёт ТОКЕН вида 1234567890:AAE... — скопируйте его\n"
                "5) Вставьте токен ниже и нажмите «Проверить»"
            )).pack(anchor="w")
            ctk.CTkButton(self.bot_frame, width=170, text="🌐 Открыть @BotFather",
                          command=lambda: webbrowser.open("https://t.me/BotFather")).pack(anchor="w", pady=6)
        else:
            ctk.CTkLabel(self.bot_frame, justify="left", text=(
                "Возьмите токен вашего бота (у того, кто его создавал,\n"
                "или в @BotFather → /mybots → выбрать бота → API Token)."
            )).pack(anchor="w")

        row = ctk.CTkFrame(self.bot_frame, fg_color="transparent"); row.pack(fill="x", pady=4)
        self.e_token = ctk.CTkEntry(row, width=420, placeholder_text="1234567890:AAE...")
        self.e_token.pack(side="left")
        if self.answers.get("bot_token"):
            self.e_token.insert(0, self.answers["bot_token"])
        ctk.CTkButton(row, text="✔ Проверить", width=110,
                      command=lambda: self.run_check(self._check_token_field)).pack(side="left", padx=8)

    def _check_token_field(self):
        token = self.e_token.get().strip()
        ok, msg = check_token(token)
        if ok:
            self.answers["bot_token"] = token
        return ok, msg

    def validate_3(self):
        if not self.answers.get("bot_token"):
            messagebox.showwarning(APP_NAME, "Сначала проверьте токен — кнопка «Проверить»")
            return False
        return True

    # ============ ШАГ 4: ТОКЕН → СКРИПТ ============
    def page_4(self):
        ctk.CTkLabel(self.body, text="Шаг 4. Вставляем код в таблицу",
                     font=("", 20, "bold")).pack(pady=(18, 4), anchor="w", padx=24)
        token = self.answers.get("bot_token", "")
        sheet_url = self.answers.get("sheet_url", "")
        script_url = self.script_editor_url(sheet_url)

        ctk.CTkLabel(self.body, justify="left", text=(
            "Сейчас вставим код бота в вашу копию таблицы (3 минуты):\n"
            "1) Откройте вашу таблицу кнопкой ниже → Расширения → Apps Script\n"
            "2) Удалите ВЕСЬ старый код в редакторе (если есть)\n"
            "3) Нажмите «📋 Скопировать код» ЗДЕСЬ — токен уже вшит!\n"
            "4) Вставьте в редактор (Ctrl+V) → Ctrl+S\n"
            "5) Вверху: «Развернуть» → «Новое развертывание» → тип «Веб-приложение»\n"
            "     Выполнять от имени: «Я» • Доступ: «Любой» → «Развернуть»\n"
            "6) Скопируйте ссылку, которая закончится на /exec — она нужна на следующем шаге"
        )).pack(anchor="w", padx=24, pady=6)

        row = ctk.CTkFrame(self.body, fg_color="transparent"); row.pack(fill="x", padx=24, pady=8)
        ctk.CTkButton(row, width=220, text="🌐 Открыть вашу таблицу",
                      command=lambda: webbrowser.open(sheet_url)).pack(side="left", padx=(0, 10))
        ctk.CTkButton(row, width=200, text="📋 Скопировать код (токен вшит)",
                      command=self.copy_gas_code).pack(side="left")

        ctk.CTkLabel(self.body, justify="left", text_color="#666666", text=(
            "Если кнопка редактора не открылась: ваша таблица → Расширения → Apps Script."
        )).pack(anchor="w", padx=24)

    def script_editor_url(self, sheet_url: str) -> str:
        """URL редактора Apps Script собираем из ссылки таблицы."""
        import re
        m = re.search(r"/spreadsheets/d/([a-zA-Z0-9\-_]+)", sheet_url or "")
        if not m:
            return "https://script.google.com"
        return f"https://script.google.com/home/lightspeed/get/{m.group(1)}"

    def copy_gas_code(self):
        if not GAS_FILE.exists():
            messagebox.showerror(APP_NAME, f"Файл {GAS_FILE.name} не найден рядом с программой.")
            return
        code = GAS_FILE.read_text(encoding="utf-8")
        token = self.answers.get("bot_token", "")
        if token and 'var BOT_TOKEN' in code:
            import re
            code = re.sub(r'var BOT_TOKEN\s*=\s*"[^"]*"\s*;',
                          f'var BOT_TOKEN = "{token}";', code, count=1)
        self.clipboard_clear()
        self.clipboard_append(code)
        self._toast("Код скопирован — токен уже вшит")

    # ============ ШАГ 5: APPS SCRIPT URL ============
    def page_5(self):
        ctk.CTkLabel(self.body, text="Шаг 5. Ссылка веб-приложения",
                     font=("", 20, "bold")).pack(pady=(18, 4), anchor="w", padx=24)
        ctk.CTkLabel(self.body, justify="left", text=(
            "На прошлом шаге после «Развернуть» Google показал ссылку вида\n"
            "https://script.google.com/macros/s/.../exec\n\n"
            "Если закрыли окно — не страшно: «Развернуть» → «Управление развертываниями» →\n"
            "скопируйте ссылку из колонки «URL» (она заканчивается на /exec).\n"
            "Вставьте её ниже и нажмите «Проверить»."
        )).pack(anchor="w", padx=24, pady=6)

        self.e_gas = ctk.CTkEntry(self.body, width=680,
                                  placeholder_text="https://script.google.com/macros/s/.../exec")
        self.e_gas.pack(anchor="w", padx=24, pady=4)
        if self.answers.get("gas_url"):
            self.e_gas.insert(0, self.answers["gas_url"])
        row = ctk.CTkFrame(self.body, fg_color="transparent"); row.pack(fill="x", padx=24)
        ctk.CTkButton(row, text="✔ Проверить", width=120,
                      command=lambda: self.run_check(check_gas, self.e_gas.get().strip())).pack(side="left")
        self.lbl_res = self.result_label()
        self.btn_next.configure(state="normal")

    def validate_5(self):
        url = self.e_gas.get().strip()
        ok, msg = check_gas(url)
        if not ok:
            messagebox.showerror(APP_NAME, msg)
            return False
        self.answers["gas_url"] = url
        return True

    # ============ ШАГ 6: ГЛАВНЫЙ ЧАТ (B1) ============
    def page_6(self):
        ctk.CTkLabel(self.body, text="Шаг 6. Куда присылать уведомления",
                     font=("", 20, "bold")).pack(pady=(18, 4), anchor="w", padx=24)
        ctk.CTkLabel(self.body, justify="left", text=(
            "Все уведомления (приход товара, заявки клиентов, бэкапы)\n"
            "приходят в один главный Telegram-чат.\n\n"
            "1) Откройте вашего бота в Telegram и напишите ему /start\n"
            "2) Бот ответит числом — это и есть ID чата\n"
            "3) Введите число ниже и нажмите «Отправить тест»"
        )).pack(anchor="w", padx=24, pady=6)

        row = ctk.CTkFrame(self.body, fg_color="transparent"); row.pack(fill="x", padx=24, pady=4)
        self.e_chat = ctk.CTkEntry(row, width=220, placeholder_text="например 438544636")
        self.e_chat.pack(side="left")
        if self.answers.get("chat_id"):
            self.e_chat.insert(0, self.answers["chat_id"])
        ctk.CTkButton(row, text="📨 Отправить тест", width=150,
                      command=self.send_chat_test).pack(side="left", padx=8)
        self.lbl_res = self.result_label()

        ctk.CTkLabel(self.body, justify="left", text_color="#666666", text=(
            "Тест придёт через веб-приложение (шаг 5). Если НЕ пришло — проверьте,\n"
            "что на шаге 4 код вставлен и развернут, а ссылка на шаге 5 — верная."
        )).pack(anchor="w", padx=24, pady=8)
        self.btn_next.configure(state="normal")

    def send_chat_test(self):
        chat_id = self.e_chat.get().strip()
        if not chat_id.isdigit():
            self.lbl_res.configure(text="❌ Введите число — ID из ответа бота на /start",
                                   text_color="#c62828")
            return
        ok, msg = smoke_test(self.answers.get("gas_url", ""), chat_id)
        self.lbl_res.configure(text=msg, text_color="#2e7d32" if ok else "#c62828")
        if ok:
            self.answers["chat_id"] = chat_id

    def validate_6(self):
        chat_id = self.e_chat.get().strip()
        if not chat_id.isdigit():
            messagebox.showwarning(APP_NAME, "Сначала отправьте тест и убедитесь, что сообщение пришло")
            return False
        # Автозапись B1 в лист «Настройки»
        try:
            import gspread
            sh = gspread.service_account(filename=str(find_key())).open_by_url(self.answers["sheet_url"])
            ws = sh.worksheet("Настройки")
            ws.update_acell("B1", chat_id)
            ws.update_acell("B2", self.answers["gas_url"])
            self.answers["chat_id_saved"] = True
            return True
        except Exception as e:
            if messagebox.askyesno(APP_NAME,
                f"Не удалось записать B1/B2 автоматически:\n{e}\n\n"
                "Продолжить? (тогда впишите вручную: лист «Настройки», B1 = ID чата, B2 = ссылка /exec)"):
                return True
            return False

    # ============ ШАГ 7: ПАПКА PDF ============
    def page_7(self):
        ctk.CTkLabel(self.body, text="Шаг 7. Папка для PDF-счетов",
                     font=("", 20, "bold")).pack(pady=(18, 4), anchor="w", padx=24)
        ctk.CTkLabel(self.body, justify="left", text=(
            "Менеджер будет сохранять PDF-счета в эту папку —\n"
            "программа следит за ней и заносит счета в таблицу.\n\n"
            "Рекомендуем создать папку на рабочем столе, например «Счета для бота»."
        )).pack(anchor="w", padx=24, pady=6)
        row = ctk.CTkFrame(self.body, fg_color="transparent"); row.pack(fill="x", padx=24, pady=8)
        ctk.CTkButton(row, width=220, text="📁 Выбрать папку", command=self.pick_folder).pack(side="left")
        self.lbl_folder = ctk.CTkLabel(self.body, text=self.answers.get("pdf_folder", ""),
                                       wraplength=700, justify="left")
        self.lbl_folder.pack(anchor="w", padx=24, pady=4)

    def pick_folder(self):
        folder = filedialog.askdirectory(title="Папка для PDF-счетов")
        if folder:
            self.answers["pdf_folder"] = folder.replace("/", "\\")
            self.lbl_folder.configure(text="✅ " + self.answers["pdf_folder"], text_color="#2e7d32")

    def validate_7(self):
        if not self.answers.get("pdf_folder"):
            messagebox.showwarning(APP_NAME, "Выберите папку для PDF-счетов")
            return False
        return True

    # ============ ШАГ 8: ГОТОВО ============
    def page_8(self):
        ctk.CTkLabel(self.body, text="🎉 Всё готово!",
                     font=("", 24, "bold")).pack(pady=(30, 8))
        ctk.CTkLabel(self.body, justify="left", text=(
            "Настройка завершена. Что теперь:\n\n"
            "  📄 PDF-счет кладём в выбранную папку → программа сама занесёт счёт в таблицу\n"
            "  📦 Заполнили приход (M/N) у всех позиций → всем придёт уведомление в Telegram\n"
            "  💰 Бонусы дизайнеров считаются в листе «Детализация» (5%, от 500 000 ₽ за 3 мес — 10%)\n"
            "  💾 Бэкапы — каждый день в 23:23, тревога при удалении строк — сразу в Telegram\n\n"
            "Первая проверка: положите тестовый PDF в папку — счёт появится в таблице."
        )).pack(anchor="w", padx=24, pady=6)
        row = ctk.CTkFrame(self.body, fg_color="transparent"); row.pack(fill="x", padx=24, pady=10)
        ctk.CTkButton(row, width=240, text="📤 Экспорт для второго ПК",
                      command=self.do_export).pack(side="left", padx=(0, 10))
        ctk.CTkButton(row, width=240, text="❓ Открыть инструкцию менеджеру",
                      command=self.open_manager_doc).pack(side="left")

    def open_manager_doc(self):
        doc = APP_DIR / "ИНСТРУКЦИЯ-МЕНЕДЖЕРУ.md"
        if doc.exists():
            os.startfile(str(doc))
        else:
            messagebox.showinfo(APP_NAME, "Файл инструкции положите рядом с программой:\n" + str(doc))

    def validate_8(self):
        # Финализация: сохраняем все локальные настройки
        try:
            save_settings(self.answers.get("sheet_url", ""), self.answers.get("pdf_folder", ""))
            return True
        except Exception as e:
            messagebox.showerror(APP_NAME, f"Не удалось сохранить настройки:\n{e}")
            return False



if __name__ == "__main__":
    Wizard().mainloop()
