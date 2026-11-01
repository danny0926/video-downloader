module.exports = {
  apps: [
    {
      name: "video-downloader",
      script: "server.py",
      interpreter: ".venv/Scripts/python.exe",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      windowsHide: true,
    },
  ],
};
