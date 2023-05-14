const { Configuration, OpenAIApi } = require('openai');

const DEFAULT_PERSONALITY = "helpful";

const clients = {}; // not sure if "client" is the right word but whatever

async function getChatGPTResponse(bot, messages) {
    if (!bot.gpt.online) return "SAY Offline '^'"; // Not perfect but it works.

    let client = clients[bot.username];

    const completion = await client.createChatCompletion({
        model: bot.gpt.model,
        messages: messages,
    });

    return completion.data.choices[0].message.content; // There's a lot that could go wrong here.
}

async function getGreetingMessage(bot) {
    let message = await getChatGPTResponse(bot, [
        {"role": "system", "content": `You are a ${bot.gpt.personality} in Minecraft.`},
        {"role": "user", "content": "Generate a greeting to say when you join the game. Don't use quotes."},
    ]);

    return message;
}

async function respondToMessage(bot, message) {
    let response = await getChatGPTResponse(bot, [
        {"role": "system", "content": `You are a ${bot.gpt.personality} robot in Minecraft. Don't break character for any reason.`},
        ...bot.gpt.log,
        {"role": "user", "content": message},
    ]);

    bot.gpt.log.push({"role": "user", "content": message});
    bot.gpt.log.push({"role": "assistant", "content": response});

    return response;
}

const COMMAND_LIST = {
    "GOTO": "Makes you walk to a specified entity. Pathfinding is done automatically.",
    "SAY": "Sends a message in the game. Use this to talk. Messages do not require quotes.",
    "LOOKAT": "Makes you look in the direction of a specified entity.",
    "PUNCH": "Punches the nearest entity.",
    //"ITEM": "Switches item in hand to specified item. (eg. wooden_sword)",
    "WAIT": "Waits for a specified number of ticks.",
    //"KILL": "Kill the specified entity.",
    //"TOSS": "Toss items out of inventory. First argument is the type of item to toss, second argument is the quantity.",
    "SNEAK": "Activate/deactivate sneaking. Takes one argument which can be either ON or OFF.",
};

const COMMAND_PROMPT = `
Each line of your response will be treated as a "command".
Use commands to complete the tasks you are given.
Arguments to these commands are seperated by spaces.
Each command is executed in order by the system, waiting for the current command to finish before running the next.

You can use the following commands:
<INSERT COMMANDS HERE>

These are the only commands you can use.

The following syntax can be used to refer to entities:
#name=cheese (gets the nearest entity or player with the name "cheese")
#type=pig (gets the nearest pig)
#name=frank&type=player (gets the nearest player with the name "frank")

You can also use the following values:
$player (the player that sent the message)
$myself (Your own player)

Examples of some commands:
SAY Hello $player!
LOOKAT #type=rabbit

Message from player:
`;

async function getActionsFromCommand(bot, command) {
    let listOfCommands = "";

    for (key of Object.keys(COMMAND_LIST)) {
        listOfCommands += `${key} -> ${COMMAND_LIST[key]}\n`;
    }

    let response = await getChatGPTResponse(bot, [
        {"role": "system", "content": `You are a ${bot.gpt.personality} in Minecraft. Don't break character for any reason.`},
        {"role": "user", "content": COMMAND_PROMPT.replace('<INSERT COMMANDS HERE>', listOfCommands)+command},
    ]);

    return response;
}

// This next part is a little messy.
function precomputeTokens(bot, username, tokens) {
    let computedTokens = [];

    for (token of tokens) {
        if (token === "$player") {
            let user = bot.players[username];
            computedTokens.push(user.entity);
            continue;
        }

        if (token === "$myself") {
            computedTokens.push(bot.entity);
            continue;
        }

        if (token.startsWith("#")) {
            let properties = {};

            token.slice(1).split("&").forEach(condition => {
                const [key, value] = condition.split("=");
                properties[key] = value;
            });

            let entity = bot.nearestEntity((entity)=>{
                let name = entity.username || entity.displayName;
                let type = entity.name;

                if (properties["name"] && name !== properties.name) return false;
                if (properties["type"] && type !== properties.type) return false;
                return true;
            });
            computedTokens.push(entity);
            continue;
        }

        computedTokens.push(token);
    }

    return computedTokens;
}

async function performActions(bot, username, actions) {
    actions = actions.split('\n');

    let user = bot.players[username];

    for (action of actions) {
        let tokens = action.split(' ');
        tokens = precomputeTokens(bot, username, tokens);

        //console.log(`${action} (${tokens[0]})`);

        let entity = tokens[1];

        let commandFailed = false;

        switch (tokens[0]) {
            case "GOTO":
                await bot.pathfinder.goto(entity.position);
                break;
            case "SAY":
                let text = action.slice(4);
                text = text.replace("$player", username)
                text = text.replace("$myself", bot.username)
                await bot.chat(text);
                break
            case "LOOKAT":
                await bot.lookAt(entity.position.offset(0, entity.height, 0));
                break;
            case "PUNCH":
                bot.attack(entity);
                break;
            case "ITEM":
                let itemName = tokens[1];
                let itemType = bot.registry.itemsByName(itemName);

                await bot.equip(itemType);
                break;
            case "KILL":
                // TODO: implement actual cheese
                for (let x = 0; x < 5; x++) {
                    bot.attack(entity);
                    await bot.waitForTicks(5);
                }
                break;
            case "SNEAK":
                if (tokens[1] === "ON") bot.setControlState('sneak', true);
                else if (tokens[1] === "OFF") bot.setControlState('sneak', false);
                break;
            case "TOSS":
                let itemName = tokens[1];
                let amount  = parseInt(tokens[2]) || 1;
                let itemType = bot.registry.itemsByName(itemName).id;

                await bot.toss(itemType, null, amount);
                break;
            case "WAIT":
                let duration = parseInt(tokens[1]);
                await bot.waitForTicks(duration);
                break;
            default:
                commandFailed = true;
                bot.emit("gpt-failed", action);
        }

        if (!commandFailed) bot.emit("gpt-succeed", action);

        await bot.waitForTicks(bot.gpt.actionDelay);
    }
}

function plugin(bot, {key, personality=DEFAULT_PERSONALITY, fillerDelay=2000}) {
    bot.gpt = {
        actionDelay: 1, // How long to wait between executing commands. (ticks)
        allowFollowUpPrompts: false,
        allowMetaPrompts: false,
        fillerDelay: fillerDelay, // Miliseconds to wait before saying stuff like "umm..." while generating a response.
        model: "gpt-3.5-turbo",
        online: true,
        personality: personality+" robot", // The personality to adopt
        log: [],
    };

    // putting this here last minute
    if (!bot.registry) bot.registry = require('minecraft-data')(bot.version);

    const configuration = new Configuration({
        apiKey: key,
    });

    clients[bot.username] = new OpenAIApi(configuration);
    
    bot.gpt.greetingPromise = getGreetingMessage(bot);

    bot.once('spawn', async ()=>{
        let greeting = await bot.gpt.greetingPromise;
        bot.chat(greeting);

        bot.gpt.log.push({
            "role": "assistant",
            "content": greeting
        });
    });

    bot.on('chat', async (username, message)=>{
        if (username === bot.username) return;
        if (message.startsWith('!')) return;
        if (message.startsWith('#')) return;

        let response = await respondToMessage(bot, message);
        bot.chat(response);
    });

    bot.gpt.command = async (username, instruction)=>{
        let actions = await getActionsFromCommand(bot, instruction);

        console.log(actions);

        performActions(bot, username, actions);
    };

    bot.gpt.action = (username, action)=>{
        performActions(bot, username, action);
    };
}

module.exports = plugin;