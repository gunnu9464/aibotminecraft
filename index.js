// Import necessary modules
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalNear } = goals;
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config(); // Load environment variables from .env file
const http = require('http'); // Import Node.js http module for web server
const Vec3 = require('vec3').Vec3; // Import Vec3 for vector operations

// --- Configuration ---
// Your Aternos server IP and bot username
const SERVER_HOST = 'Nerddddsmp.aternos.me'; // Your Aternos server IP
const SERVER_PORT = 25565; // Default Minecraft port, usually works for Aternos
const BOT_USERNAME = 'AIBot'; // The username your bot will appear as in Minecraft
const SERVER_VERSION = '1.20.1'; // <<< IMPORTANT: REPLACE WITH YOUR EXACT ATERNOS SERVER VERSION (e.g., '1.20.1', '1.19.4')

// Gemini AI API Key
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Render's required port for health checks
const RENDER_PORT = process.env.PORT || 3000; // Use port provided by Render, or 3000 as a fallback

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
// --- CHANGE MADE HERE: Model reverted to gemini-2.0-flash ---
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

// Bot instance (will be reassigned on reconnect)
let bot;
let movementInterval; // To control the bot's wandering

// --- Web Server for Render Health Checks ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Minecraft AI Bot is running!\n');
});

server.listen(RENDER_PORT, () => {
    console.log(`Web server listening on port ${RENDER_PORT} for Render health checks.`);
});

// --- Bot Creation and Connection Logic ---
function createBot() {
    console.log(`Attempting to connect to ${SERVER_HOST}:${SERVER_PORT} as ${BOT_USERNAME} (Minecraft v${SERVER_VERSION})...`);

    bot = mineflayer.createBot({
        host: SERVER_HOST,
        port: SERVER_PORT,
        username: BOT_USERNAME,
        // password: 'your_password_if_needed', // Uncomment and set if your server is online-mode and requires a password
        version: SERVER_VERSION, // <<< IMPORTANT: Using explicit server version
        hideErrors: false, // Set to true to hide some common errors in console
    });

    // Load the pathfinder plugin
    bot.loadPlugin(pathfinder);

    // --- Event Handlers ---

    // When the bot successfully logs in
    bot.on('login', () => {
        console.log(`${BOT_USERNAME} logged in.`);
        bot.chat('Hello, world! I am your AI bot, ready to assist. Type !ai <your_question> to chat with me.');
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
                    bot.chat(`Thinking about "${prompt}"...`);
                    const result = await model.generateContent(prompt);
                    const response = await result.response;
                    const text = response.text();

                    // Send AI response back to chat
                    bot.chat(`${username}, AI says: ${text}`);

                    // Resume wandering after responding
                    startWandering();
                } catch (error) {
                    console.error('Error calling Gemini AI:', error);
                    bot.chat(`${username}, I'm sorry, I encountered an error while processing your request.`);
                    // Resume wandering even on error
                    startWandering();
                }
            } else {
                bot.chat(`${username}, please provide a question after !ai, e.g., !ai Tell me a joke.`);
            }
        }
    });

    // When the bot is kicked from the server
    bot.on('kicked', (reason, loggedIn) => {
        console.log(`Kicked from server: ${reason} (Logged In: ${loggedIn})`);
        stopWandering(); // Stop movement before reconnecting
        reconnect();
    });

    // When the bot disconnects (e.g., server stops, network issue)
    bot.on('end', (reason) => {
        console.log(`Disconnected from server: ${reason}`);
        stopWandering(); // Stop movement before reconnecting
        reconnect();
    });

    // When an error occurs
    bot.on('error', (err) => {
        console.error(`Bot error: ${err}`);
        // If the error is a PartialReadError, log more context but still attempt reconnect
        if (err.name === 'PartialReadError') {
            console.error('PartialReadError suggests a server version mismatch or malformed packet. Ensure SERVER_VERSION is correct!');
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
    // Set a timeout before attempting to reconnect
    console.log('Attempting to reconnect in 5 seconds...');
    setTimeout(createBot, 5000);
}

// --- Automatic Movement Logic ---
function stopWandering() {
    if (movementInterval) {
        clearInterval(movementInterval);
        movementInterval = null;
        console.log('Stopped wandering.');
        // Optionally clear any current pathfinding goal
        if (bot && bot.pathfinder) {
            bot.pathfinder.setGoal(null);
        }
    }
}

function startWandering() {
    // Clear any previous wandering interval to prevent multiple intervals running
    stopWandering();

    movementInterval = setInterval(() => {
        // Only attempt to set a new goal if the bot exists, is spawned, and not already moving
        if (bot && bot.entity && bot.pathfinder && !bot.pathfinder.isMoving()) {
            // Randomly decide to jump or sneak
            const action = Math.random();
            if (action < 0.3) { // 30% chance to jump
                console.log('Bot is jumping...');
                bot.setControlState('jump', true);
                setTimeout(() => bot.setControlState('jump', false), 500); // Jump for 0.5 seconds
            } else if (action < 0.6) { // 30% chance to sneak
                console.log('Bot is sneaking...');
                bot.setControlState('sneak', true);
                setTimeout(() => bot.setControlState('sneak', false), 1000); // Sneak for 1 second
            }

            // Pathfinding movement (still preferred for actual navigation)
            // Generate a random target position within a reasonable range
            const randomOffsetX = (Math.random() - 0.5) * 20; // -10 to +10 blocks
            const randomOffsetZ = (Math.random() - 0.5) * 20; // -10 to +10 blocks

            const targetX = bot.entity.position.x + randomOffsetX;
            const targetZ = bot.entity.position.z + randomOffsetZ;
            const targetY = bot.entity.position.y; // Keep Y-level for simplicity

            // Try to find a valid block near the target Y-level
            const targetBlock = bot.world.getBlock(new Vec3(Math.floor(targetX), Math.floor(targetY), Math.floor(targetZ)));
            if (targetBlock && targetBlock.walkable) { // Check if the block is walkable
                console.log(`Setting new wandering goal to: (${Math.floor(targetX)}, ${Math.floor(targetY)}, ${Math.floor(targetZ)})`);
                // Set the goal for the pathfinder. Range of 2 means it will try to get within 2 blocks of the target.
                bot.pathfinder.setGoal(new GoalNear(Math.floor(targetX), Math.floor(targetY), Math.floor(targetZ), 2));
            } else {
                console.log('Random target block not walkable, trying again next interval.');
            }
        } else if (bot && bot.pathfinder && bot.pathfinder.isMoving()) {
            console.log('Bot is currently moving, waiting to set new goal.');
        } else {
            console.log('Bot not ready to wander.');
        }
    }, 15000); // Attempt to move and perform actions every 15 seconds
    console.log('Started wandering.');
}

// Start the bot for the first time
createBot();
