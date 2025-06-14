// Import necessary modules
const mineflayer = require('mineflayer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config(); // Load environment variables from .env file
const http = require('http'); // Import Node.js http module for web server

// --- Configuration ---
// Load config from environment variables
const SERVER_HOST = process.env.SERVER_HOST || 'Nerddddsmp.aternos.me';
const SERVER_PORT = parseInt(process.env.SERVER_PORT) || 57453;
const BOT_USERNAME = process.env.MC_USERNAME || 'AI';
const AUTH_TYPE = process.env.AUTH || 'offline';
// <<< IMPORTANT: Still auto-detecting. If PartialReadError persists, manually set this to EXACT Aternos version (e.g., '1.20.4')
const SERVER_VERSION = false; // Set to false for auto-detection, or '1.20.4', '1.21.5' etc.

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Render's required port for health checks
const RENDER_PORT = process.env.PORT || 3000;

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

// Bot instance (will be reassigned on reconnect)
let bot;
let movementInterval; // To control the bot's wandering
let reconnectTimeout; // To store the timeout for reconnection attempts
let reconnectAttempts = 0; // Track reconnection attempts
const MAX_RECONNECT_ATTEMPTS = 15;
const BASE_RECONNECT_DELAY = 30000; // <<< IMPORTANT: Increased to 30 seconds to avoid throttling
const AI_RESPONSE_RESUME_DELAY = 3000;

// --- Web Server for Render Health Checks ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Minecraft AI Bot is running!\n');
});

server.listen(RENDER_PORT, () => {
    console.log(`Web server listening on port ${RENDER_PORT} for Render health checks.`);
});

// --- Helper function to safely send chat messages ---
function sendBotChat(message) {
    if (bot && bot.chat) {
        try {
            bot.chat(message);
        } catch (chatError) {
            console.error(`Error sending chat message: ${chatError.message}. Message: "${message}"`);
        }
    } else {
        console.error('Attempted to send chat message but bot.chat is not available (bot may be disconnected):', message);
    }
}

// --- Bot Creation and Connection Logic ---
function createBot() {
    clearTimeout(reconnectTimeout);
    reconnectAttempts++;

    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        console.error(`Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. The bot will no longer attempt to reconnect automatically.`);
        return;
    }

    console.log(`Attempt ${reconnectAttempts} to connect to ${SERVER_HOST}:${SERVER_PORT} as ${BOT_USERNAME} (Minecraft v${SERVER_VERSION === false ? 'Auto-Detect' : SERVER_VERSION})...`);

    bot = mineflayer.createBot({
        host: SERVER_HOST,
        port: SERVER_PORT,
        username: BOT_USERNAME,
        auth: AUTH_TYPE,
        version: SERVER_VERSION, // Still set to false for auto-detection
        hideErrors: false,
    });

    // --- Event Handlers ---

    // When the bot successfully logs in
    bot.on('login', () => {
        console.log(`${BOT_USERNAME} logged in successfully!`);
        reconnectAttempts = 0; // Reset attempts on successful login
        sendBotChat('Hello, world! I am your AI bot, ready to assist. Type !ai <your_question> to chat with me.');
    });

    // When the bot spawns in the world
    bot.on('spawn', () => {
        console.log('Bot spawned! Starting random movement.');
        randomMove(); // Call the new randomMove for continuous movement
    });

    // When a player sends a chat message
    bot.on('chat', async (username, message) => {
        // Ignore messages from the bot itself
        if (username === bot.username) return;

        console.log(`[${username}] ${message}`);

        // Handle AI chat command
        if (message.startsWith('!ai ')) {
            const prompt = message.substring(4).trim();
            if (prompt) {
                try {
                    // Stop current movement during AI processing
                    stopMovement();
                    sendBotChat(`Thinking about "${prompt}"...`);

                    const result = await model.generateContent(prompt);
                    const response = await result.response;
                    const text = response.text();

                    // Send AI response back to chat
                    sendBotChat(`${username}, AI says: ${text}`);

                } catch (error) {
                    console.error('Error calling Gemini AI:', error);
                    sendBotChat(`${username}, I'm sorry, I encountered an error while processing your request: ${error.message || 'Unknown error'}.`);
                } finally {
                    // Always try to resume movement after AI interaction, with a slight delay
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

    // When the bot is kicked from the server
    bot.on('kicked', (reason, loggedIn) => {
        console.log(`Kicked from server! Reason: "${reason}" (Logged In: ${loggedIn})`);
        if (reason && typeof reason === 'string' && reason.includes('Connection throttled')) {
            console.error('SERVER THROTTLING: Bot was kicked for reconnecting too quickly. Increasing next delay.');
        }
        stopMovement(); // Stop movement before reconnecting
        reconnect();
    });

    // When the bot disconnects (e.g., server stops, network issue)
    bot.on('end', (reason) => {
        console.log(`Disconnected from server! Reason: "${reason}"`);
        // If the disconnection is due to a protocol error, log a specific message
        if (reason && typeof reason === 'string' && (reason.includes('Bad Packet') || reason.includes('Protocol Error'))) {
             console.error('SEVERE: Disconnection likely due to protocol mismatch. Double-check Aternos server version!');
        }
        stopMovement(); // Stop movement before reconnecting
        reconnect();
    });

    // When an error occurs
    bot.on('error', (err) => {
        console.error(`Bot encountered an error:`, err);
        // PartialReadError is almost always a version mismatch
        if (err.name === 'PartialReadError') {
            console.error('CRITICAL: PartialReadError! This strongly suggests a server version mismatch or malformed packet. Ensure SERVER_VERSION is EXACTLY correct or try `false` for auto-detect.');
        } else if (err.code === 'ECONNRESET') {
            console.error('ECONNRESET: Connection reset by peer. This often happens due to server issues or network instability.');
        }
        stopMovement(); // Stop movement before reconnecting
        reconnect();
    });
}

// --- Reconnection Logic ---
function reconnect() {
    stopMovement(); // Ensure movement is stopped
    // Exponential backoff delay
    const delay = BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts);
    console.log(`Scheduling reconnection attempt ${reconnectAttempts + 1} in ${delay / 1000} seconds...`);
    reconnectTimeout = setTimeout(createBot, delay);
}

// --- Automatic Movement Logic ---
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
