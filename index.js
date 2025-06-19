// Import necessary modules
const mineflayer = require('mineflayer');
// Removed pathfinder, Movements, goals, Vec3 as they are no longer used for this simplified bot.
require('dotenv').config(); // Load environment variables from .env file
const http = require('http'); // Import Node.js http module for web server
const { GoogleGenerativeAI } = require('@google/generative-ai'); // Re-import GoogleGenerativeAI

// === CONFIGURATION ===
// Bot config loaded from environment variables or uses defaults
const BOT_USERNAME = process.env.BOT_USERNAME || "AI"; // Any name, change as you wish
const SERVER_IP = process.env.SERVER_IP || "anothernerd.aternos.me";
const SERVER_PORT = parseInt(process.env.SERVER_PORT) || 25565; // Default Minecraft port, can be overridden by env
const MC_VERSION = process.env.MC_VERSION || false; // Set to false for auto-detect

// Gemini API Key - IMPORTANT: Ensure this is set in your Render environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// UptimeRobot Web Server port
const RENDER_PORT = process.env.PORT || 8080; // Default UptimeRobot port from your snippet

// Initialize Gemini AI (re-integrated)
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); // Using gemini-2.0-flash

// === BOT LOGIC ===
let bot; // Declare bot globally so createBot can reassign it
let movementTimeoutId; // Changed to clear the correct timeout for randomMove

// Helper function to safely send chat messages
function sendBotChat(message) {
    if (bot && bot.chat && bot.currentWindow === null) { // Check if bot.chat is available and not in a menu
        try {
            bot.chat(message);
        } catch (chatError) {
            console.error(`Error sending chat message: ${chatError.message}. Message: "${message}"`);
        }
    } else {
        console.error('Attempted to send chat message but bot.chat is not available (bot may be disconnected or in a menu):', message);
    }
}

function createBot() {
    // Clear any existing timeouts to prevent multiple bot instances or conflicting movements
    clearTimeout(movementTimeoutId);
    // No need to clear reconnectTimeout here as createBot is called by it

    console.log(`Attempting to connect to ${SERVER_IP}:${SERVER_PORT} as ${BOT_USERNAME} (Minecraft v${MC_VERSION === false ? 'Auto-Detect' : MC_VERSION})...`);

    bot = mineflayer.createBot({
        host: SERVER_IP,
        port: SERVER_PORT,
        username: BOT_USERNAME,
        version: MC_VERSION // auto-detect
    });

    // Helper function for random movement
    function randomMove() {
        if (!bot.entity || !bot.entity.position) {
            console.log('Bot not ready for random movement. Skipping.');
            // Schedule next attempt only if not already scheduled
            if (!movementTimeoutId) {
                movementTimeoutId = setTimeout(randomMove, 5000 + Math.random() * 5000); // Try again later
            }
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

        // Schedule the next random movement
        movementTimeoutId = setTimeout(randomMove, 5000 + Math.random() * 5000);
    }

    // Function to stop all ongoing movement
    function stopMovement() {
        clearTimeout(movementTimeoutId);
        movementTimeoutId = null;
        console.log('Bot movement stopped.');
        if (bot) {
            bot.setControlState('forward', false);
            bot.setControlState('back', false);
            bot.setControlState('left', false);
            bot.setControlState('right', false);
            bot.setControlState('jump', false);
            bot.setControlState('sneak', false);
            bot.setControlState('sprint', false);
        }
    }

    bot.on('login', () => {
        console.log(`${BOT_USERNAME} logged in successfully! Detected server version: ${bot.version}`);
        sendBotChat('Hello, I am your Aternos AI bot. Ask me questions with !ai <your_question>.');
    });

    bot.on('spawn', () => {
        console.log('Bot spawned! Starting random movement.');
        stopMovement(); // Ensure any old movement is cleared
        randomMove(); // Start new movement
    });

    // Chat handler re-integrated for AI
    bot.on('chat', async (username, message) => {
        // Ignore messages from the bot itself
        if (username === bot.username) return;

        console.log(`[${username}] ${message}`);

        if (message.startsWith('!ai ')) {
            const prompt = message.substring(4).trim();
            if (prompt) {
                stopMovement(); // Stop movement while processing AI
                sendBotChat(`Thinking about "${prompt}"...`);

                try {
                    const result = await model.generateContent(prompt);
                    const response = await result.response;
                    const text = response.text();
                    sendBotChat(`${username}, AI says: ${text}`);
                } catch (error) {
                    console.error('Error calling Gemini AI:', error);
                    sendBotChat(`${username}, I'm sorry, I encountered an error while processing your request: ${error.message || 'Unknown error'}.`);
                } finally {
                    console.log(`Scheduling resumption of movement in 3 seconds after AI interaction.`);
                    setTimeout(() => {
                        randomMove(); // Resume movement after a short delay
                    }, 3000); // 3-second delay
                }
            } else {
                sendBotChat(`${username}, please provide a question after !ai, e.g., !ai Tell me a joke.`);
            }
        }
    });

    bot.on('end', (reason) => {
        console.log('Bot disconnected! Reason:', reason, 'Reconnecting in 10 seconds...');
        stopMovement(); // Stop movement on disconnect
        clearTimeout(movementTimeoutId); // Clear any pending randomMove calls
        movementTimeoutId = null;
        // Schedule reconnection
        setTimeout(createBot, 10000);
    });

    bot.on('error', err => {
        console.error('Bot error:', err.message, 'Reconnecting in 15 seconds...');
        stopMovement(); // Stop movement on error
        clearTimeout(movementTimeoutId); // Clear any pending randomMove calls
        movementTimeoutId = null;
        // Log more context for common errors
        if (err.name === 'PartialReadError') {
            console.error('CRITICAL: PartialReadError! This strongly suggests a server version mismatch or malformed packet.');
        } else if (err.code === 'ECONNRESET') {
            console.error('ECONNRESET: Connection reset by peer. This often happens due to server issues or network instability.');
        }
        // Schedule reconnection
        setTimeout(createBot, 15000);
    });

    bot.on('kicked', (reason) => {
        console.log('Bot was kicked:', reason);
        // 'end' event handler will typically follow 'kicked' and handle reconnection.
    });
}

// Start the bot for the first time
createBot();

// UptimeRobot Web Server
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running!');
}).listen(RENDER_PORT, () => {
    console.log(`HTTP server for UptimeRobot started on port ${RENDER_PORT}`);
});
