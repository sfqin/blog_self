' Start-Blog.vbs — Windows double-click launcher & controller (no console window).
'
' Double-clicking this feels like opening an app: no black console window. It:
'   1. checks whether a blog is already running (reads dev-home-blog\.runtime.json
'      and probes it),
'   2. if running, asks (Yes=open / No=restart with the latest build / Cancel),
'   3. otherwise starts the server hidden via Start-Blog.bat, waits for it to
'      report its port, and opens the browser to the setup wizard.
'
' The server picks its own port and stops itself about a minute after the last
' blog page is closed (heartbeat), so there is no Stop button to press.

Option Explicit
Dim fso, shell, here, bat, data, runtime
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)
bat = here & "\Start-Blog.bat"
data = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\dev-home-blog"
runtime = data & "\.runtime.json"

If Not fso.FileExists(bat) Then
  MsgBox "Start-Blog.bat not found. The package may be incomplete — please re-extract the full release folder.", _
         vbCritical, "dev@home Blog"
  WScript.Quit 1
End If

' --- read the live URL/PID the server advertises, if any -------------------
Function ReadFile(path)
  Dim ts, s : s = ""
  If fso.FileExists(path) Then
    On Error Resume Next
    Set ts = fso.OpenTextFile(path, 1)
    If Not ts Is Nothing Then s = ts.ReadAll : ts.Close
    On Error Goto 0
  End If
  ReadFile = s
End Function

' Extract a JSON string value, e.g. jsonStr(txt,"url").
Function JsonStr(txt, key)
  Dim re, m
  Set re = New RegExp
  re.Pattern = """" & key & """\s*:\s*""([^""]*)"""
  Set m = re.Execute(txt)
  If m.Count > 0 Then JsonStr = m(0).SubMatches(0) Else JsonStr = ""
End Function

Function JsonNum(txt, key)
  Dim re, m
  Set re = New RegExp
  re.Pattern = """" & key & """\s*:\s*(\d+)"
  Set m = re.Execute(txt)
  If m.Count > 0 Then JsonNum = m(0).SubMatches(0) Else JsonNum = ""
End Function

' Probe url/internal/ready; alive if it returns our "ready" marker. This is the
' ultra-light endpoint (no GitHub/network check), so the probe stays fast even
' on a weak connection instead of blocking on /setup/status.
Function IsAlive(url)
  IsAlive = False
  If Len(url) = 0 Then Exit Function
  On Error Resume Next
  Dim http : Set http = CreateObject("MSXML2.XMLHTTP")
  http.open "GET", url & "/internal/ready", False
  http.send
  If Err.Number = 0 Then
    If http.status = 200 And InStr(http.responseText, """ready""") > 0 Then IsAlive = True
  End If
  On Error Goto 0
End Function

Sub StartHidden()
  ' Run the .bat with window style 0 = hidden, do not wait. It runs the server.
  ' "noopen": this .vbs opens the browser itself (OpenWhenReady), so the .bat
  ' must not also open one.
  shell.Run "cmd /c """ & bat & """ noopen", 0, False
End Sub

Sub OpenWhenReady()
  Dim i, txt, url
  For i = 1 To 60
    txt = ReadFile(runtime)
    url = JsonStr(txt, "url")
    If Len(url) > 0 Then
      If IsAlive(url) Then shell.Run url & "/setup", 1, False : Exit Sub
    End If
    WScript.Sleep 250
  Next
  shell.Run "http://localhost:8080/setup", 1, False   ' best-effort fallback
End Sub

' Open the self-contained loading page IMMEDIATELY (it polls the server and
' redirects to /setup itself), so the user sees a CRT spinner instead of a blank
' few seconds while the server boots. Falls back to poll-then-open if the file
' is missing. loading.html ships next to this .vbs in the release root.
Sub OpenUI()
  Dim page : page = here & "\loading.html"
  If fso.FileExists(page) Then
    shell.Run """" & page & """", 1, False
  Else
    OpenWhenReady
  End If
End Sub

' --- already running? offer open / restart ---------------------------------
Dim txt0, url0, pid0, ans
txt0 = ReadFile(runtime)
url0 = JsonStr(txt0, "url")
If Len(url0) > 0 And IsAlive(url0) Then
  ans = MsgBox("博客已经在运行中。" & vbCrLf & vbCrLf & _
               "是(Y)：打开网页，继续使用当前博客。" & vbCrLf & _
               "否(N)：重启，用最新版本重新启动（更新后用这个）。" & vbCrLf & _
               "取消：什么都不做。", _
               vbYesNoCancel + vbQuestion, "dev@home 博客")
  If ans = vbYes Then
    shell.Run url0 & "/setup", 1, False
    WScript.Quit 0
  ElseIf ans = vbNo Then
    pid0 = JsonNum(txt0, "pid")
    If Len(pid0) > 0 Then shell.Run "taskkill /PID " & pid0 & " /F", 0, True
    ' Wait for the old server to go away, then start fresh.
    Dim j
    For j = 1 To 20
      If Not IsAlive(url0) Then Exit For
      WScript.Sleep 250
    Next
    StartHidden
    OpenUI
    WScript.Quit 0
  Else
    WScript.Quit 0   ' Cancel
  End If
End If

' --- not running: start hidden and open the browser ------------------------
StartHidden
OpenUI
