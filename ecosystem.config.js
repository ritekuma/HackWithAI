module.exports = {
  apps: [{
    name: 'hackwithai-dev',
    script: 'npm',
    args: 'run dev:web',
    cwd: '/home/kali/HackWithAI',
    env: {
      PORT: '3006',
      NODE_ENV: 'development'
    }
  }]
};
