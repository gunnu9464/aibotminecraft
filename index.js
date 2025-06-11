// Import necessary modules
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalNear } = goals;
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config(); // Load environment variables from .env file

// --- Configuration ---
// Your Aternos server IP and bot username
const SERVER_HOST = 'Nerddddsmp.aternos.me'; // Your Aternos server IP
const SERVER_PORT = 25565; // Default Minecraft port, usually works for Aternos
const BOT_USERNAME = 'AI'; // The username your bot will appear as in Minecraft

// Gemini AI API Key
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

// Bot instance (will be reassigned on reconnect)
let bot;
let movementInterval; // To control the bot's wandering

// --- Bot Creation and Connection Logic ---
function createBot() {
    console.log(`Attempting to connect to ${SERVER_HOST}:${SERVER_PORT} as ${BOT_USERNAME}...`);

    bot = mineflayer.createBot({
        host: SERVER_HOST,
        port: SERVER_PORT,
        username: BOT_USERNAME,
        // password: 'your_password_if_needed', // Uncomment and set if your server is online-mode and requires a password
        version: false, // Auto-detect server version
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
                    // Send prompt to Gemini AI
                    bot.chat(`Thinking about "${prompt}"...`);
                    const result = await model.generateContent(prompt);
                    const response = await result.response;
                    const text = response.text();

                    // Send AI response back to chat
                    bot.chat(`${username}, AI says: ${text}`);
                } catch (error) {
                    console.error('Error calling Gemini AI:', error);
                    bot.chat(`${username}, I'm sorry, I encountered an error while processing your request.`);
                }
            } else {
                bot.chat(`${username}, please provide a question after !ai, e.g., !ai Tell me a joke.`);
            }
        }
    });

    // When the bot is kicked from the server
    bot.on('kicked', (reason, loggedIn) => {
        console.log(`Kicked from server: ${reason} (Logged In: ${loggedIn})`);
        reconnect();
    });

    // When the bot disconnects (e.g., server stops, network issue)
    bot.on('end', (reason) => {
        console.log(`Disconnected from server: ${reason}`);
        reconnect();
    });

    // When an error occurs
    bot.on('error', (err) => {
        console.error(`Bot error: ${err}`);
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
function startWandering() {
    // Clear any previous wandering interval
    if (movementInterval) {
        clearInterval(movementInterval);
    }

    movementInterval = setInterval(() => {
        // If the bot is not yet spawned or already pathfinding, skip
        if (!bot || !bot.entity || bot.pathfinder.is == null) {
            // Check if pathfinder is ready before setting a goal
            console.log('Bot not spawned or pathfinder not ready for wandering.');
            return;
        }

        const x = bot.entity.position.x + (Math.random() - 0.5) * 32; // Random X within 32 blocks
        const z = bot.entity.position.z + (Math.random() - 0.5) * 32; // Random Z within 32 blocks
        const y = bot.entity.position.y; // Keep Y-level mostly the same for simple wandering

        // Set the goal for the pathfinder. Range of 1 means it will try to get within 1 block.
        bot.pathfinder.setGoal(new GoalNear(Math.floor(x), Math.floor(y), Math.floor(z), 1));
    }, 10000); // Move every 10 seconds
}

// Start the bot for the first time
createBot();


