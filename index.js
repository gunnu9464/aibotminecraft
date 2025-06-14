// Import necessary modules
const mineflayer = require('mineflayer');
// Removed pathfinder, Movements, goals, GoogleGenerativeAI, Vec3 as they are no longer used for this simplified bot.
require('dotenv').config(); // Load environment variables from .env file
const http = require('http'); // Import Node.js http module for web server

// === CONFIGURATION ===
// Bot config loaded from environment variables or uses defaults
const BOT_USERNAME = process.env.BOT_USERNAME || "AternosBot" + Math.floor(Math.random() * 1000); // Any name, change as you wish
const SERVER_IP = process.env.SERVER_IP || "Nerddddsmp.aternos.me";
const SERVER_PORT = parseInt(process.env.SERVER_PORT) || 25565; // Default Minecraft port, can be overridden by env
const MC_VERSION = process.env.MC_VERSION || false; // Set to false for auto-detect

// No Gemini API Key needed as AI functionality has been removed in this version.
// const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// UptimeRobot Web Server port
const RENDER_PORT = process.env.PORT || 8080; // Default UptimeRobot port from your snippet

// === BOT LOGIC ===
function createBot() {
    const bot = mineflayer.createBot({
        host: SERVER_IP,
        port: SERVER_PORT,
        username: BOT_USERNAME,
        version: MC_VERSION // auto-detect
    });

    // Helper function for random movement
    function randomMove() {
        if (!bot.entity || !bot.entity.position) {
            console.log('Bot not ready for random movement. Skipping.');
            setTimeout(randomMove, 5000 + Math.random() * 5000); // Try again later
            return;
        }

        const actions = [
            () => bot.setControlState('forward', true),
            () => bot.setControlState('back', true),
            () => bot.setControlState('left', true),
            () => bot.setControlState('right', true),
            () => bot.setControlState('jump', true),
            () => bot.setControlState('sneak', true),
            () => bot.setControlState('sprint', true),
            // Actions to stop movement (important for preventing continuous motion)
            () => bot.setControlState('forward', false),
            () => bot.setControlState('back', false),
            () => bot.setControlState('left', false),
            () => bot.setControlState('right', false),
            () => bot.setControlState('jump', false),
            () => bot.setControlState('sneak', false),
            () => bot.setControlState('sprint', false),
        ];

        // Reset all controls to ensure a clean state before applying a new action
        bot.setControlState('forward', false);
        bot.setControlState('back', false);
        bot.setControlState('left', false);
        bot.setControlState('right', false);
        bot.setControlState('jump', false);
        bot.setControlState('sneak', false);
        bot.setControlState('sprint', false);

        const action = actions[Math.floor(Math.random() * actions.length)];
        console.log(`Executing random movement action.`);
        action();

        setTimeout(randomMove, 5000 + Math.random() * 5000);
    }

    bot.on('login', () => {
        console.log(`${BOT_USERNAME} logged in successfully! Detected server version: ${bot.version}`);
        bot.chat('Hello, I am your Aternos bot.');
    });

    bot.on('spawn', () => {
        console.log('Bot spawned! Starting random movement.');
        randomMove();
        // Removed AI initial chat as AI functionality is no longer present
        // bot.chat('!ai hello how are you im fine i hope you ai is good');
    });

    // Chat handler removed as AI functionality is no longer present
    // bot.on('chat', async (username, message) => { ... });

    bot.on('end', (reason) => {
        console.log('Bot disconnected! Reason:', reason, 'Reconnecting in 10 seconds...');
        // Using fixed delay for reconnect as per your provided snippet
        setTimeout(createBot, 10000);
    });

    bot.on('error', err => {
        console.error('Bot error:', err.message, 'Reconnecting in 15 seconds...');
        // Using fixed delay for reconnect as per your provided snippet
        setTimeout(createBot, 15000);
    });

    bot.on('kicked', (reason) => {
        console.log('Bot was kicked:', reason);
        // 'end' event handler will typically follow 'kicked' and handle reconnection.
    });
}

// Start the bot for the first time
createBot();

// UptimeRobot Web Server (using plain http as per your snippet)
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running!');
}).listen(RENDER_PORT, () => {
    console.log(`HTTP server for UptimeRobot started on port ${RENDER_PORT}`);
});
