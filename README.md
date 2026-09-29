Easy Bot 4.0
Мастер настройки PDF-бота (wizard) + комплект Apps Script.

Сборка wizard.exe
python -m venv .venv.venv\Scripts\pip install customtkinter darkdetect gspread openpyxl pyinstaller.venv\Scripts\pyinstaller --onefile --windowed --name wizard wizard_v40.py

Сборка setup.exe (нужен Inno Setup 6)
собрать wizard.exe → скопировать в setup_src\ вместе сpdf_bot.exe, dashboard.exe (сборка из репо pdf-invoice-bot),apps_script.gs, инструкцией
& "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe" setup.iss
готово: install_build\Easy-Bot-setup-v4.0.exe
Секреты
key.json / настройки — в .gitignore, в репо НИКОГДА не попадают.Токен бота в apps_script.gs — только заглушка ВСТАВЬТЕ_ТОКЕН.
