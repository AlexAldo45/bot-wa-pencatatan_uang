module.exports = {
    apps: [
        {
            name: "tripwallet-ai",
            script: "./src/app.js",
            instances: 1,
            exec_mode: "fork",
            autorestart: true,
            watch: false,
            max_memory_restart: "400M",
            env: {
                NODE_ENV: "production"
            }
        }
    ]
};
