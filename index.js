// Import necessary modules
const mineflayer = require('mineflayer');
// Removed pathfinder and goals as they are no longer used for movement
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config(); // Load environment variables from .env file
const express = require('express'); // Using express for the web server

// --- Configuration ---
// Load config from environment variables
const SERVER_HOST = process.env.SERVER_HOST || 'Nerddddsmp.aternos.me';
const SERVER_PORT = parseInt(process.env.SERVER_PORT) || 57453;
const BOT_USERNAME = process.env.MC_USERNAME || 'AIBot';
const AUTH_TYPE = process.env.AUTH || 'offline';

// Setting to false for auto-detection as per previous discussions.
// If connection issues persist, strongly consider setting your Aternos server
// to a stable version like '1.20.4' or '1.19.4' and hardcoding it here.
const SERVER_VERSION = false;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Render's required port for health checks
const RENDER_PORT = process.env.PORT || 3000;

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

// Bot instance (will be reassigned on reconnect)
let bot;
let movementInterval; // Controls the randomMove setTimeout
let reconnectTimeout; // Controls the setTimeout for reconnecting

const AI_RESPONSE_RESUME_DELAY = 3000; // Delay after AI response before resuming movement

// --- Web Server for Render Health Checks ---
const app = express();
app.get('/', (_req, res) => {
    res.send('Aternos Bot is running!');
});
app.listen(RENDER_PORT, () => {
    console.log(`Web server running on port ${RENDER_PORT}`);
});

// --- Helper function to safely send chat messages ---
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

// --- Bot Creation and Connection Logic ---
function createBot() {
    // Clear any pending reconnect attempts from previous cycles
    clearTimeout(reconnectTimeout);
    stopMovement(); // Ensure any old movement loops are stopped before creating a new bot instance

    console.log(`Attempting to connect to ${SERVER_HOST}:${SERVER_PORT} as ${BOT_USERNAME} (Minecraft v${SERVER_VERSION === false ? 'Auto-Detect' : SERVER_VERSION})...`);

    bot = mineflayer.createBot({
        host: SERVER_HOST,
        port: SERVER_PORT,
        username: BOT_USERNAME,
        auth: AUTH_TYPE,
        version: SERVER_VERSION, // Set to false for auto-detection
        hideErrors: false,
    });

    // --- Event Handlers (Using your provided structure) ---

    bot.on('login', () => {
        console.log(`${BOT_USERNAME} logged in successfully! Detected server version: ${bot.version}`);
        sendBotChat('Hello, world! I am your AI bot, ready to assist. Type !ai <your_question> to chat with me.');
    });

    // Your provided spawn handler
    bot.on('spawn', () => {
        console.log('Bot spawned! Starting random movement.');
        // Ensure only one movement loop is active
        stopMovement();
        randomMove();
    });

    bot.on('chat', async (username, message) => {
        // Ignore messages from the bot itself
        if (username === bot.username) return;

        console.log(`[${username}] ${message}`);

        // Handle AI chat command
        if (message.startsWith('!ai ')) {
            const prompt = message.substring(4).trim();
            if (prompt) {
                // Stop current movement during AI processing
                stopMovement();
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
                    // Always try to resume movement after AI interaction, with a delay
                    console.log(`Scheduling resumption of movement in ${AI_RESPONSE_RESUME_DELAY / 1000} seconds.`);
                    setTimeout(() => {
                        randomMove(); // Resume the new random movement
                    }, AI_RESPONSE_RESUME_DELAY);
                }
            } else {
                sendBotChat(`${username}, please provide a question after !ai, e.g., !ai Tell me a joke.`);
            }
        }
    });

    // Your provided end handler
    bot.on('end', (reason) => {
        console.log(`Bot disconnected! Reason: "${reason}". Reconnecting in 10 seconds...`);
        clearTimeout(reconnectTimeout); // Clear any existing reconnect
        reconnectTimeout = setTimeout(createBot, 10000); // Fixed 10s delay
    });

    // Your provided error handler
    bot.on('error', err => {
        console.error('Bot error:', err.message, 'Reconnecting in 15 seconds...');
        // Log more context for common errors
        if (err.name === 'PartialReadError') {
            console.error('CRITICAL: PartialReadError! This strongly suggests a server version mismatch or malformed packet.');
        } else if (err.code === 'ECONNRESET') {
            console.error('ECONNRESET: Connection reset by peer. This often happens due to server issues (e.g., crash, restart) or network instability.');
        }
        clearTimeout(reconnectTimeout); // Clear any existing reconnect
        reconnectTimeout = setTimeout(createBot, 10000); // Fixed 15s delay
    });

    // Your provided kicked handler
    bot.on('kicked', (reason) => {
        console.log('Bot was kicked:', reason);
        // The 'end' event handler will typically be triggered right after 'kicked',
        // handling the reconnection.
    });
}

// --- Automatic Movement Logic (from previous turns) ---
function stopMovement() {
    clearTimeout(movementInterval); // Clear any pending randomMove calls
    movementInterval = null; // Clear the interval ID
    console.log('Bot movement stopped.');
    // Explicitly set all control states to false to ensure bot is idle
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

function randomMove() {
    // Ensure bot is active and has a position before attempting movement
    if (!bot || !bot.entity || !bot.entity.position) {
        console.log('Bot not ready for random movement. Skipping.');
        // Schedule next check anyway, in case bot becomes ready later
        movementInterval = setTimeout(() => randomMove(), 5000 + Math.random() * 5000);
        return;
    }

    // Define available actions and their corresponding functions
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

    // Pick a random action and execute it
    const action = actions[Math.floor(Math.random() * actions.length)];
    console.log(`Executing random movement action.`);
    action();

    // Schedule the next random movement
    movementInterval = setTimeout(() => randomMove(), 5000 + Math.random() * 5000); // Move every 5-10 seconds
}

// Start the bot for the first time
createBot();

