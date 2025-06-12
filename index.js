// Import necessary modules
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalNear } = goals;
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config(); // Load environment variables from .env file
const http = require('http'); // Import Node.js http module for web server
const Vec3 = require('vec3').Vec3; // Import Vec3 for vector operations

// --- Configuration ---
// Load config from environment variables (from your snippet)
// Defaults are provided, but prefer setting these in Render's environment variables.
const SERVER_HOST = process.env.SERVER_HOST || 'Nerddddsmp.aternos.me';
const SERVER_PORT = parseInt(process.env.SERVER_PORT) || 57453; // Use your provided port as default
const BOT_USERNAME = process.env.MC_USERNAME || 'AIBot'; // Using MC_USERNAME as per your snippet
const AUTH_TYPE = process.env.AUTH || 'offline'; // 'offline' for cracked, 'microsoft' for premium
const SERVER_VERSION = process.env.MC_VERSION || '1.21.5'; // Use your provided version as default
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Render's required port for health checks
const RENDER_PORT = process.env.PORT || 3000;

// Initialize Gemini AI (re-integrated)
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); // Retaining gemini-2.0-flash as it was working better for you

// Bot instance (will be reassigned on reconnect)
let bot;
let movementInterval; // To control the bot's wandering
let reconnectTimeout; // To store the timeout for reconnection attempts
let reconnectAttempts = 0; // Track reconnection attempts
const MAX_RECONNECT_ATTEMPTS = 15; // Increased max attempts for more resilience
const BASE_RECONNECT_DELAY = 5000; // 5 seconds base delay
const AI_RESPONSE_RESUME_DELAY = 3000; // Delay before resuming wandering after AI response

// --- Web Server for Render Health Checks ---
// This ensures Render marks your service as "live"
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Minecraft AI Bot is running!\n');
});

server.listen(RENDER_PORT, () => {
    console.log(`Web server listening on port ${RENDER_PORT} for Render health checks.`);
});

// --- Bot Creation and Connection Logic ---
function createBot() {
    clearTimeout(reconnectTimeout); // Clear any pending reconnection attempts
    reconnectAttempts++; // Increment attempt counter

    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        console.error(`Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. The bot will no longer attempt to reconnect automatically.`);
        // At this point, Render might eventually restart the container if it's unhealthy.
        return;
    }

    console.log(`Attempt ${reconnectAttempts} to connect to ${SERVER_HOST}:${SERVER_PORT} as ${BOT_USERNAME} (Minecraft v${SERVER_VERSION})...`);

    bot = mineflayer.createBot({
        host: SERVER_HOST,
        port: SERVER_PORT,
        username: BOT_USERNAME,
        auth: AUTH_TYPE, // Use AUTH_TYPE from environment variables
        version: SERVER_VERSION, // Use SERVER_VERSION from environment variables
        hideErrors: false, // Set to true to hide some common errors in console
    });

    // Load the pathfinder plugin for intelligent movement
    bot.loadPlugin(pathfinder);

    // --- Event Handlers ---

    // When the bot successfully logs in
    bot.on('login', () => {
        console.log(`${BOT_USERNAME} logged in successfully!`);
        reconnectAttempts = 0; // Reset attempts on successful login
        try {
            bot.chat('Hello, world! I am your AI bot, ready to assist. Type !ai <your_question> to chat with me.');
        } catch (chatError) {
            console.error(`Error sending login chat message: ${chatError.message}`);
        }
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

    // When a player sends a chat message (re-integrated AI logic)
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
                    try {
                        bot.chat(`Thinking about "${prompt}"...`);
                    } catch (chatError) {
                        console.error(`Error sending "Thinking..." chat message: ${chatError.message}`);
                    }

                    const result = await model.generateContent(prompt);
                    const response = await result.response;
                    const text = response.text();

                    // Send AI response back to chat
                    try {
                        bot.chat(`${username}, AI says: ${text}`);
                    } catch (chatError) {
                        console.error(`Error sending AI response chat message: ${chatError.message}`);
                    }

                } catch (error) {
                    console.error('Error calling Gemini AI:', error);
                    // Provide a more detailed error message to the user
                    try {
                        bot.chat(`${username}, I'm sorry, I encountered an error while processing your request: ${error.message || 'Unknown error'}.`);
                    } catch (chatError) {
                        console.error(`Error sending AI error chat message: ${chatError.message}`);
                    }
                } finally {
                    // Always try to resume wandering after AI interaction, with a slight delay
                    console.log(`Scheduling resumption of wandering in ${AI_RESPONSE_RESUME_DELAY / 1000} seconds.`);
                    setTimeout(() => {
                        startWandering();
                    }, AI_RESPONSE_RESUME_DELAY);
                }
            } else {
                try {
                    bot.chat(`${username}, please provide a question after !ai, e.g., !ai Tell me a joke.`);
                } catch (chatError) {
                    console.error(`Error sending AI usage chat message: ${chatError.message}`);
                }
            }
        }
    });

    // When the bot is kicked from the server (retained handler)
    bot.on('kicked', (reason, loggedIn) => {
        console.log(`Kicked from server! Reason: "${reason}" (Logged In: ${loggedIn})`);
        stopWandering(); // Stop movement before reconnecting
        reconnect();
    });

    // When the bot disconnects (e.g., server stops, network issue) (retained handler)
    bot.on('end', (reason) => {
        console.log(`Disconnected from server! Reason: "${reason}"`);
        stopWandering(); // Stop movement before reconnecting
        reconnect();
    });

    // When an error occurs (retained handler)
    bot.on('error', (err) => {
        console.error(`Bot encountered an error:`, err);
        // If the error is a PartialReadError, log more context but still attempt reconnect
        if (err.name === 'PartialReadError') {
            console.error('PartialReadError suggests a server version mismatch or malformed packet. Ensure SERVER_VERSION is correct!');
        }
        stopWandering(); // Stop movement before reconnecting
        reconnect();
    });
}

// --- Reconnection Logic (retained exponential backoff) ---
function reconnect() {
    stopWandering(); // Ensure wandering is stopped and any existing goals are cleared

    // Calculate exponential backoff delay to avoid spamming connection attempts
    const delay = BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts);
    console.log(`Scheduling reconnection attempt ${reconnectAttempts + 1} in ${delay / 1000} seconds...`);

    reconnectTimeout = setTimeout(createBot, delay);
}

// --- Automatic Movement Logic (combined approach) ---
function stopWandering() {
    if (movementInterval) {
        clearInterval(movementInterval);
        movementInterval = null;
        console.log('Wandering interval stopped.');
        // Clear any current pathfinding goal to immediately stop movement
        if (bot && bot.pathfinder) {
            bot.pathfinder.setGoal(null);
            console.log('Pathfinding goal cleared.');
        }
    }
}

function startWandering() {
    // Clear any previous wandering interval to prevent multiple intervals running
    stopWandering();

    movementInterval = setInterval(() => {
        // Only attempt to set a new goal if the bot exists, is spawned, and not already moving
        if (bot && bot.entity && bot.pathfinder && !bot.pathfinder.isMoving()) {
            // Randomly decide between simple movement (jump/sneak) and pathfinding
            const randomActionType = Math.random();
            if (randomActionType < 0.3) { // 30% chance for simple action if not already moving
                const simpleAction = Math.random();
                if (simpleAction < 0.5) { // 50% of that 30% for jump
                    console.log('Bot is jumping...');
                    bot.setControlState('jump', true);
                    setTimeout(() => bot.setControlState('jump', false), 500);
                } else { // 50% of that 30% for sneak
                    console.log('Bot is sneaking...');
                    bot.setControlState('sneak', true);
                    setTimeout(() => bot.setControlState('sneak', false), 1000);
                }
            } else { // 70% chance for pathfinding if not doing a simple action and not already pathfinding
                // Pathfinding to a random nearby location
                const randomOffsetX = (Math.random() - 0.5) * 20; // -10 to +10 blocks
                const randomOffsetZ = (Math.random() - 0.5) * 20; // -10 to +10 blocks

                const targetX = bot.entity.position.x + randomOffsetX;
                const targetZ = bot.entity.position.z + randomOffsetZ;
                const targetY = bot.entity.position.y; // Keep Y-level for simplicity

                // Attempt to find a valid walkable block near the target Y-level
                const targetBlock = bot.world.getBlock(new Vec3(Math.floor(targetX), Math.floor(targetY), Math.floor(targetZ)));
                if (targetBlock && targetBlock.walkable) {
                    console.log(`Setting new wandering goal to: (${Math.floor(targetX)}, ${Math.floor(targetY)}, ${Math.floor(targetZ)})`);
                    bot.pathfinder.setGoal(new GoalNear(Math.floor(targetX), Math.floor(targetY), Math.floor(targetZ), 2));
                } else {
                    console.log('Random target block not walkable for pathfinding, trying again next interval.');
                }
            }
        } else {
            console.log('Bot or pathfinder not ready for wandering.');
        }
    }, 10000); // Check for movement/action every 10 seconds
    console.log('Wandering interval started.');
}

// Start the bot for the first time
createBot();
