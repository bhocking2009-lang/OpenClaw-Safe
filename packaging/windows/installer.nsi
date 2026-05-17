; OpenClaw-Safe NSIS Installer Script
; Requirements: NSIS 3.x  (https://nsis.sourceforge.io/)
;
; Build from repo root:
;   makensis packaging\windows\installer.nsi
; Or let the build.ps1 script call it automatically.

Unicode True

!define PRODUCT_NAME      "OpenClaw Safe"
!define PRODUCT_PUBLISHER "Bee Pagoda Systems"
!define PRODUCT_VERSION   "1.0.0"
!define INSTALL_DIR       "$PROGRAMFILES64\OpenClaw Safe"
!define UNINSTALLER_KEY   "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClaw Safe"

Name            "${PRODUCT_NAME}"
OutFile         "..\..\OpenClaw-Safe-Setup.exe"
InstallDir      "${INSTALL_DIR}"
InstallDirRegKey HKLM "${UNINSTALLER_KEY}" "InstallLocation"
RequestExecutionLevel admin

; ---- Pages ---------------------------------------------------------------
!include "MUI2.nsh"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\..\README.md"
!insertmacro MUI_PAGE_DIRECTORY
!define MUI_COMPONENTSPAGE_SMALLDESC
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ---- Sections ------------------------------------------------------------

Section "Core Application (required)" SecCore
  SectionIn RO

  SetOutPath "$INSTDIR"

  ; Application files
  File /r "..\..\dist-pkg\dist\"
  CreateDirectory "$INSTDIR\dist"
  File /r /x "*.bat" "..\..\dist-pkg\dist\*.*"

  SetOutPath "$INSTDIR\dist"
  File /r "..\..\dist-pkg\dist\*.*"

  SetOutPath "$INSTDIR\node_modules"
  File /r "..\..\dist-pkg\node_modules\*.*"

  SetOutPath "$INSTDIR\node"
  File /r "..\..\dist-pkg\node\*.*"

  SetOutPath "$INSTDIR"
  File "..\..\dist-pkg\launcher.bat"

  ; Start Menu shortcut
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" \
    "$INSTDIR\launcher.bat" "" "$INSTDIR\launcher.bat" 0 \
    SW_SHOWNORMAL "" "Start OpenClaw Safe"
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall ${PRODUCT_NAME}.lnk" \
    "$INSTDIR\Uninstall.exe"

  ; Write uninstaller and registry keys
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr   HKLM "${UNINSTALLER_KEY}" "DisplayName"      "${PRODUCT_NAME}"
  WriteRegStr   HKLM "${UNINSTALLER_KEY}" "Publisher"        "${PRODUCT_PUBLISHER}"
  WriteRegStr   HKLM "${UNINSTALLER_KEY}" "DisplayVersion"   "${PRODUCT_VERSION}"
  WriteRegStr   HKLM "${UNINSTALLER_KEY}" "InstallLocation"  "$INSTDIR"
  WriteRegStr   HKLM "${UNINSTALLER_KEY}" "UninstallString"  "$INSTDIR\Uninstall.exe"
  WriteRegDWORD HKLM "${UNINSTALLER_KEY}" "NoModify"         1
  WriteRegDWORD HKLM "${UNINSTALLER_KEY}" "NoRepair"         1
SectionEnd

Section /o "Desktop shortcut" SecDesktop
  CreateShortcut "$DESKTOP\${PRODUCT_NAME}.lnk" \
    "$INSTDIR\launcher.bat" "" "$INSTDIR\launcher.bat" 0 \
    SW_SHOWNORMAL "" "Start OpenClaw Safe"
SectionEnd

; ---- Component descriptions ----------------------------------------------
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecCore}    "Core application files — required."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "Add a shortcut to your Desktop."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ---- Uninstaller ---------------------------------------------------------

Section "Uninstall"
  ; Remove installed files
  RMDir /r "$INSTDIR\dist"
  RMDir /r "$INSTDIR\node_modules"
  RMDir /r "$INSTDIR\node"
  Delete "$INSTDIR\launcher.bat"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir  "$INSTDIR"

  ; Remove shortcuts
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\*.lnk"
  RMDir  "$SMPROGRAMS\${PRODUCT_NAME}"
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"

  ; Remove registry keys
  DeleteRegKey HKLM "${UNINSTALLER_KEY}"
SectionEnd
