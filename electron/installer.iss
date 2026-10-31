; 简辑 (JianJi) Windows 安装包 —— Inno Setup 脚本
;
; 用法（在仓库根目录）：
;   ISCC.exe /DMyArch=x64   electron\installer.iss
;   ISCC.exe /DMyArch=arm64 electron\installer.iss
;
; 前提：electron-builder 已用 `--win dir` 产出 release\win-unpacked（x64）
; 和 release\win-arm64-unpacked（arm64）。
; 中文语言包来自 readme\ChineseSimplified.isl。

#ifndef MyArch
  #define MyArch "x64"
#endif

#if MyArch == "arm64"
  #define MySourceDir "..\release\win-arm64-unpacked"
  #define MyArchitecturesAllowed "arm64"
  #define MyArchitecturesInstall "arm64"
  #define MyOutput "JianJi-Setup-arm64"
#else
  #define MySourceDir "..\release\win-unpacked"
  #define MyArchitecturesAllowed "x64compatible"
  #define MyArchitecturesInstall "x64compatible"
  #define MyOutput "JianJi-Setup-x64"
#endif

#define MyAppName "简辑"
#define MyAppExeName "JianJi.exe"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "DaYe"

[Setup]
AppId={{BB1F9976-7D22-4131-AB8C-183AE820472B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\release
OutputBaseFilename={#MyOutput}
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed={#MyArchitecturesAllowed}
ArchitecturesInstallIn64BitMode={#MyArchitecturesInstall}
; 不写进「添加/删除程序」里的语言字段，避免和 AppName 冲突
; CloseApplications=yes

[Languages]
Name: "chinesesimplified"; MessagesFile: "..\readme\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#MySourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent
