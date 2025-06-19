require('dotenv').config();
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GeminiAI } = require('./lib/gemini');

const username = 'ai';
const host = 'anothernerd.aternos.me';
const port = 25565;
const ai = new GeminiAI(process.env.GEMINI_API_KEY);

function createBot() {
  const bot = mineflayer.createBot({
    host,
    port,
    username,
    version: false
  });

  bot.loadPlugin(pathfinder);

  bot.once('spawn', () => {
    console.log('Bot spawned as', username);
    wander(bot);
  });

  bot.on('chat', async (username, message) => {
    if (username === bot.username) return;
    if (message.startsWith('!ai')) {
      const prompt = message.replace('!ai', '').trim();
      if (prompt) {
        bot.chat('Thinking...');
        try {
          const response = await ai.ask(prompt);
          bot.chat(response.slice(0, 256)); // Minecraft chat limit
        } catch (e) {
          bot.chat('AI error.');
        }
      } else {
        bot.chat('Usage: !ai [your question]');
      }
    }
  });

  bot.on('end', () => {
    console.log('Bot disconnected. Attempting to reconnect...');
    setTimeout(createBot, 5000); // Wait 5 seconds before reconnecting
  });

  bot.on('error', err => {
    console.log('Bot error:', err);
  });

  return bot;
}

// Wander randomly
function wander(bot) {
  const mcData = require('minecraft-data')(bot.version);
  const defaultMove = new Movements(bot, mcData);
  function moveRandom() {
    if (!bot.entity) return;
    const pos = bot.entity.position;
    const dx = Math.floor(Math.random() * 10) - 5;
    const dz = Math.floor(Math.random() * 10) - 5;
    const goal = new goals.GoalBlock(pos.x + dx, pos.y, pos.z + dz);
    bot.pathfinder.setMovements(defaultMove);
    bot.pathfinder.setGoal(goal);
    setTimeout(moveRandom, 10000); // Move every 10 seconds
  }
  moveRandom();
}

createBot();
