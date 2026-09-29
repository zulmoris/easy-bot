#define MyAppName "Easy Bot"
#define MyAppVersion "4.0"
#define MyAppExeName "wizard.exe"

[Setup]
AppId={{22dc867b-55e4-43cb-8b7f-13f1b328db36}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={autopf}\Easy Bot
DefaultGroupName=Easy Bot
UninstallDisplayIcon={app}\wizard.exe
OutputDir=install_build
OutputBaseFilename=Easy-Bot-setup-v{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin

[Files]
Source: "setup_src\wizard.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "setup_src\pdf_bot.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "setup_src\dashboard.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "setup_src\apps_script.gs"; DestDir: "{app}"; Flags: ignoreversion
Source: "setup_src\ИНСТРУКЦИЯ-МЕНЕДЖЕРУ.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Easy Bot — Настройка (мастер)"; Filename: "{app}\wizard.exe"
Name: "{group}\Easy Bot — Управление (дашборд)"; Filename: "{app}\dashboard.exe"
Name: "{group}\Easy Bot — Бот счетов"; Filename: "{app}\pdf_bot.exe"
Name: "{autodesktop}\Easy Bot"; Filename: "{app}\dashboard.exe"

[Run]
Filename: "{app}\wizard.exe"; Description: "Запустить первичную настройку"; Flags: postinstall skipifsilent nowait

[UninstallDelete]
