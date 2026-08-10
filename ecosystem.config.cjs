module.exports = {
    apps: [
        {
            name: "tripwallet-ai",
            script: "./src/app.js",
            instances: 1,
            exec_mode: "fork",
            autorestart: true,
            watch: false,
            // Cap Node.js heap at 512MB
            node_args: "--max-old-space-size=512",
            // Restart if total process memory exceeds 900MB (Node + Chromium subprocess)
            max_memory_restart: "900M",
            env: {
                NODE_ENV: "production"
            }
        }
    ]
};
