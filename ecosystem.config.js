module.exports = {
  apps: [
    {
      name: "video-downloader",
      script: "server.py",
      // pythonw：沒有主控台視窗，背景執行時不會跳出終端機
      interpreter: ".venv/Scripts/pythonw.exe",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      windowsHide: true,
    },
  ],
};
