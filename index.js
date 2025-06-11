// index.js
// This is the main file for the Aternos AI Bot.

// --- Imports ---
// 'mineflayer' is the library that lets us create Minecraft bots
import mineflayer from 'mineflayer';
// 'pathfinder' is a mineflayer plugin for movement and navigation
import { pathfinder, Movements } from 'mineflayer-pathfinder';
import { GoalFollow } from 'mineflayer-pathfinder/lib/goals.js';
// Google's Generative AI for the chat functionality
import { GoogleGenerativeAI } from '@google/generative-ai';
// Your personal configuration
import { config } from './config.js';

// --- Initial Checks ---
if (config.geminiApiKey === "PASTE_YOUR_GEMINI_API_KEY_HERE") {
    console.error("ERROR: Please paste your Gemini API Key into the 'config.js' file.");
    process.exit(1); // Exit the script
}

// --- Setup AI ---
const genAI = new GoogleGenerativeAI(config.geminiApiKey);
const aiModel = genAI.getGenerativeModel({ model: "gemini-flash" });
const chatHistory = [
    // Start the conversation with the system prompt
    { role: "user", parts: [{ text: config.aiSystemPrompt }] },
    { role: "model", parts: [{ text: "Okay, I understand. I am a friendly Minecraft player named AIBot. I will keep my answers short and conversational." }] },
];

console.log("🤖 AI Bot is starting up...");

// --- Create the Bot ---
const bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version,
    // This setting tells the server we are not using a paid "premium" account.
    // Required for "Cracked" / Offline-mode servers like a configured Aternos server.
    auth: 'offline', 
});

// --- Load Plugins ---
// Load the pathfinder plugin so the bot can move
bot.loadPlugin(pathfinder);
console.log("🔌 Pathfinder plugin loaded.");

// --- Bot Event Listeners ---

// This runs once the bot has successfully joined the server
bot.once('spawn', () => {
    console.log(`✅ Bot '${bot.username}' has joined the server.`);
    
    // Set up pathfinder movements
    const mcData = await bot.waitFordatavalue('mcData')
    const defaultMove = new Movements(bot, mcData);
    bot.pathfinder.setMovements(defaultMove);
    
    // Announce arrival
    bot.chat("Hello everyone! The AI Bot is online.");

    // Start "alive" behavior
    setInterval(lookAround, 5000); // Look around every 5 seconds
});

// This runs every time a chat message appears
bot.on('chat', async (username, message) => {
    // Ignore messages from the bot itself
    if (username === bot.username) return;

    console.log(`[Chat] ${username}: ${message}`);

    // --- Command Handling ---
    if (message.toLowerCase() === 'follow me') {
        const player = bot.players[username];
        if (!player || !player.entity) {
            bot.chat(`Sorry ${username}, I can't see you.`);
            return;
        }
        bot.chat(`Okay, ${username}, I'm following you now.`);
        // Set a goal to follow the player who spoke
        bot.pathfinder.setGoal(new GoalFollow(player.entity, 1), true);
        return;
    }

    if (message.toLowerCase() === 'stop') {
        bot.chat('Okay, I am stopping.');
        // Clear all current pathfinder goals
        bot.pathfinder.stop();
        return;
    }

    // --- AI Chat Handling ---
    // Check if the message is directed at the bot
    if (message.toLowerCase().startsWith(bot.username.toLowerCase())) {
        const question = message.substring(bot.username.length).trim();
        console.log(`❓ Received question for AI: "${question}"`);
        
        // Add user's question to history
        chatHistory.push({ role: "user", parts: [{ text: question }] });

        try {
            // Show that the bot is "thinking"
            bot.chat("..."); 
            
            const chatSession = aiModel.startChat({ history: chatHistory });
            const result = await chatSession.sendMessage(question);
            const response = result.response;
            const text = response.text();

            console.log(`🧠 AI Response: "${text}"`);

            // Add AI's response to history
            chatHistory.push({ role: "model", parts: [{ text: text }] });
            
            // Send the response to the in-game chat
            bot.chat(text);

        } catch (error) {
            console.error("ERROR calling Gemini API:", error);
            bot.chat("Sorry, my brain is a bit fuzzy right now. I couldn't think of a response.");
        }
    }
});

// --- Utility Functions ---

// Makes the bot look around randomly to seem more alive
function lookAround() {
    if (bot.pathfinder.isMoving()) return; // Don't look around if walking

    const yaw = Math.random() * Math.PI * 2 - Math.PI; // Full 360 degrees
    const pitch = Math.random() * Math.PI - Math.PI / 2; // Look up and down
    bot.look(yaw, pitch);
}


// --- Error Handling ---
bot.on('kicked', (reason) => console.log('❌ Bot was kicked from server for:', reason));
bot.on('error', (err) => console.log('❌ An error occurred:', err));
bot.on('end', () => console.log('🔌 Bot has been disconnected.'));
