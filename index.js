// Import necessary modules
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalNear } = goals;
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config(); // Load environment variables from .env file
const http = require('http'); // Import Node.js http module for web server
const Vec3 = require('vec3').Vec3; // Import Vec3 for vector operations

// --- Configuration ---
// Load config from environment variables
const SERVER_HOST = process.env.SERVER_HOST || 'Nerddddsmp.aternos.me';
const SERVER_PORT = parseInt(process.env.SERVER_PORT) || 57453; // Use your provided port as default
const BOT_USERNAME = process.env.MC_USERNAME || 'AIBot'; // Using MC_USERNAME as per your snippet
const AUTH_TYPE = process.env.AUTH || 'offline'; // 'offline' for cracked, 'microsoft' for premium

// Using auto-detection for server version as this was when AI was reportedly answering
const SERVER_VERSION = false; // Auto-detect server version. If issues persist, try '1.20.4' or '1.19.4' explicitly.

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Render's required port for health checks
const RENDER_PORT = process.env.PORT || 3000;

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); // Using gemini-2.0-flash

// Bot instance (will be reassigned on reconnect)
let bot;
let movementInterval; // To control the bot's wandering (for pathfinder)
let reconnectTimeout; // To store the timeout for reconnection attempts
let reconnectAttempts = 0; // Track reconnection attempts
const MAX_RECONNECT_ATTEMPTS = 15;
const BASE_RECONNECT_DELAY = 30000; // <<< IMPORTANT: Increased to 30 seconds to allow server to recover/avoid throttling
const AI_RESPONSE_RESUME_DELAY = 1000; // Shorter delay after AI response

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
    clearTimeout(reconnectTimeout); // Clear any pending reconnection attempts
    reconnectAttempts++; // Increment attempt counter

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
        version: SERVER_VERSION, // Now set to false for auto-detection
        hideErrors: false,
    });

    // Load the pathfinder plugin
    bot.loadPlugin(pathfinder);

    // --- Event Handlers ---

    // When the bot successfully logs in
    bot.on('login', () => {
        console.log(`${BOT_USERNAME} logged in successfully! Detected server version: ${bot.version}`); // Log detected version
        reconnectAttempts = 0; // Reset attempts on successful login
        sendBotChat('Hello, world! I am your AI bot, ready to assist. Type !ai <your_question> to chat with me.');
    });

    // When the bot spawns in the world
    bot.on('spawn', () => {
        console.log(`${BOT_USERNAME} spawned.`);
        // Set up default movements for pathfinding
        const defaultMove = new Movements(bot);
        bot.pathfinder.setMovements(defaultMove);

        // Start wandering
        startWandering();
    });

    // When a player sends a chat message
    bot.on('chat', async (username, message) => {
        // Ignore messages from the bot itself
        if (username === bot.username) return;

        console.log(`[${username}] ${message}`);

        // Handle AI chat command
        if (message.startsWith('!ai ')) {
            const prompt = message.substring(4).trim(); // Get the text after "!ai "
            if (prompt) {
                try {
                    // Stop wandering while processing AI request to prevent conflict
                    stopWandering();
                    sendBotChat(`Thinking about "${prompt}"...`);

                    const result = await model.generateContent(prompt);
                    const response = await result.response;
                    const text = response.text();

                    // Send AI response back to chat
                    sendBotChat(`${username}, AI says: ${text}`);

                    // Added a short delay before resuming wandering
                    setTimeout(() => startWandering(), AI_RESPONSE_RESUME_DELAY);
                } catch (error) {
                    console.error('Error calling Gemini AI:', error);
                    sendBotChat(`${username}, I'm sorry, I encountered an error while processing your request: ${error.message || 'Unknown error'}.`);
                    // Added a short delay before resuming wandering even on error
                    setTimeout(() => startWandering(), AI_RESPONSE_RESUME_DELAY);
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
            console.error('SERVER THROTTLING: Bot was kicked for reconnecting too quickly. Increasing next delay (already set to 30s base).');
        }
        stopWandering(); // Stop movement before reconnecting
        reconnect();
    });

    // When the bot disconnects (e.g., server stops, network issue)
    bot.on('end', (reason) => {
        console.log(`Disconnected from server! Reason: "${reason}"`);
        // If the disconnection is due to a protocol error, log a specific message
        if (reason && typeof reason === 'string' && (reason.includes('Bad Packet') || reason.includes('Protocol Error'))) {
             console.error('SEVERE: Disconnection likely due to protocol mismatch. Double-check Aternos server version!');
        } else if (reason && typeof reason === 'string' && reason.includes('Timed out')) {
            console.error('TIMEOUT: Bot timed out. Server might be lagging or unreachable.');
        }
        stopWandering(); // Stop movement before reconnecting
        reconnect();
    });

    // When an error occurs
    bot.on('error', (err) => {
        console.error(`Bot encountered an error:`, err);
        // PartialReadError is almost always a version mismatch
        if (err.name === 'PartialReadError') {
            console.error('CRITICAL: PartialReadError! This strongly suggests a server version mismatch or malformed packet. Ensure SERVER_VERSION is EXACTLY correct or try `false` for auto-detect.');
        } else if (err.code === 'ECONNRESET') {
            console.error('ECONNRESET: Connection reset by peer. This often happens due to server issues (e.g., crash, restart) or network instability. Increase BASE_RECONNECT_DELAY.');
        }
        stopWandering(); // Stop movement before reconnecting
        reconnect();
    });
}

// --- Reconnection Logic ---
function reconnect() {
    // Clear any existing movement intervals to prevent multiple instances
    if (movementInterval) {
        clearInterval(movementInterval);
        movementInterval = null;
    }
    // Exponential backoff delay
    const delay = BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts);
    console.log(`Scheduling reconnection attempt ${reconnectAttempts + 1} in ${delay / 1000} seconds...`);
    reconnectTimeout = setTimeout(createBot, delay);
}

// --- Automatic Movement Logic ---
function stopWandering() {
    // Clear any previous wandering interval
    if (movementInterval) {
        clearInterval(movementInterval);
        movementInterval = null;
        console.log('Wandering interval stopped.');
    }
    // Optionally clear any current pathfinding goal
    if (bot && bot.pathfinder) {
        bot.pathfinder.setGoal(null);
        console.log('Pathfinding goal cleared.');
    }
}

function startWandering() {
    // Clear any previous wandering interval to prevent multiple intervals running
    stopWandering();

    movementInterval = setInterval(() => {
        // Only attempt to set a new goal if the bot exists, is spawned, and not already pathfinding
        if (bot && bot.entity && bot.pathfinder && !bot.pathfinder.isMoving()) {
            const x = bot.entity.position.x + (Math.random() - 0.5) * 32; // Random X within 32 blocks
            const z = bot.entity.position.z + (Math.random() - 0.5) * 32; // Random Z within 32 blocks
            const y = bot.entity.position.y; // Keep Y-level mostly the same for simple wandering

            // Set the goal for the pathfinder. Range of 1 means it will try to get within 1 block.
            // Using Math.floor for coordinates as GoalNear expects integers
            bot.pathfinder.setGoal(new GoalNear(Math.floor(x), Math.floor(y), Math.floor(z), 1));
        } else if (bot && bot.pathfinder && bot.pathfinder.isMoving()) {
            console.log('Bot is currently moving, waiting to set new goal.');
        } else {
            console.log('Bot not spawned or pathfinder not ready for wandering.');
        }
    }, 10000); // Move every 10 seconds
    console.log('Wandering interval started.');
}

// Start the bot for the first time
createBot();
