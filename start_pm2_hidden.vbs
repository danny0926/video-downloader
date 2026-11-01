' Start PM2 and resurrect video-downloader with NO visible window.
' Keeps running so the PM2 daemon is not tied to any terminal or session.
Set sh = CreateObject("WScript.Shell")
pm2 = sh.ExpandEnvironmentStrings("%APPDATA%") & "\npm\pm2.cmd"
sh.Run "cmd /c """"" & pm2 & """ resurrect""", 0, True
Do
    WScript.Sleep 3600000
Loop
