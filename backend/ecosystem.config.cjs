module.exports = {
  apps: [
    {
      name: "fruitfit-backend",
      script: "src/server.js",
      cwd: "/opt/fruitfit/backend",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production"
      },
      error_file: "/var/log/fruitfit/backend-error.log",
      out_file: "/var/log/fruitfit/backend-out.log",
      merge_logs: true,
      time: true,
      max_memory_restart: "512M"
    }
  ]
};
