// PM2 ecosystem for HackWithAI v2
// Runs Next.js dev (port 3006) + Convex dev with auto-restart and boot persistence
module.exports = {
  apps: [
    {
      name: 'hwai-next',
      cwd: '/home/kali/HackWithAI',
      script: 'npx',
      args: 'next dev --turbopack -p 3006',
      // Watch for changes (Turbopack handles HMR)
      watch: false,
      // Auto-restart settings
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 20,
      max_memory_restart: '2G',
      // Logs
      out_file: '/home/kali/HackWithAI/logs/pm2-hwai-next.out.log',
      error_file: '/home/kali/HackWithAI/logs/pm2-hwai-next.err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      // Env
      env: {
        NODE_ENV: 'development',
        PORT: '3006',
      },
    },
    {
      name: 'hwai-convex',
      cwd: '/home/kali/HackWithAI',
      script: 'npx',
      args: 'convex dev',
      watch: false,
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 20,
      max_memory_restart: '1G',
      out_file: '/home/kali/HackWithAI/logs/pm2-hwai-convex.out.log',
      error_file: '/home/kali/HackWithAI/logs/pm2-hwai-convex.err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
