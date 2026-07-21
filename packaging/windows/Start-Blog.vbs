' Start-Blog.vbs — LEGACY Windows launcher shim.
'
' The current release ships Start-Blog.exe (a windowless Go launcher in
' cmd/windows-launcher/) as the double-click entry point; the exe handles the
' "already running? open / restart" prompt, starts the server hidden, and opens
' the browser itself. This .vbs is kept only so that older shortcuts still work:
' it simply hands off to Start-Blog.exe (or, if that is missing, to the console
' fallback Start-Blog-console.bat), then exits.
Option Explicit
Dim fso, shell, here, exe, bat
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)
exe = here & "\Start-Blog.exe"
bat = here & "\Start-Blog-console.bat"

If fso.FileExists(exe) Then
  shell.Run """" & exe & """", 1, False
ElseIf fso.FileExists(bat) Then
  ' Console fallback: it hands off to the exe itself, or runs the server visibly.
  shell.Run """" & bat & """", 1, False
Else
  MsgBox "Start-Blog.exe not found. The package may be incomplete — please re-extract the full release folder.", _
         vbCritical, "dev@home Blog"
  WScript.Quit 1
End If
