module.exports = {
  apps: [{
    name: 'hackwithai-dev',
    script: 'npm',
    args: 'run dev:web',
    cwd: '/home/kali/HackWithAI',
    env: {
      PORT: '3006',
      NODE_ENV: 'development'
    },
    // Durable recovery: auto-restart on crash, kill, or exit
    autorestart: true,
    max_restarts: 10,
    restart_delay: 3000,
    // Keep logs trimmed
    max_memory_restart: '500M',
    // Ensure clean state on crash restart
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 30000,
  }]
};
