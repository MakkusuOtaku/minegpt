const mineflayer = require('mineflayer');
const fs = require('fs');
const mcGPT = require('./plugin.js');
const pathfinder = require('./pathfinder.js');

const COLOR = {
    blue: '\x1b[34m%s\x1b[0m',
    green: '\x1b[32m%s\x1b[0m',
    red: '\x1b[31m%s\x1b[0m',
};

const bot = mineflayer.createBot({
    username: "MineGPT",
    host: "localhost",
    port: 56188,
});

bot.on('kicked', console.log);
bot.on('error', console.log);

// I'm not sure if there's a way to pass additional data to plugins using loadPlugin so I'm not using it.
//bot.loadPlugin(mcGPT, "cheeseburger applepie");
mcGPT(bot, {
    personality: "anime catgirl",
    key: fs.readFileSync('key.txt', 'utf8'),
});

bot.on("gpt-succeed", (command)=>{
    console.log(COLOR.green, `${command}`);
});

bot.on("gpt-failed", (command)=>{
    console.log(COLOR.red, `${command}`);
});

bot.once('spawn', ()=>{
    bot.loadPlugin(pathfinder);
});

bot.on('chat', (username, message)=>{
    if (username === bot.username) return;

    if (message.startsWith('!')) {
        console.log(`COMMAND: ${message.slice(1)}`);
        bot.gpt.command(username, message.slice(1));
    }

    if (message.startsWith('#')) {
        console.log(`ACTION: ${message.slice(1)}`);
        bot.gpt.action(username, message.slice(1));
    }
});