const { performance } = require('perf_hooks');
const vec3 = require('vec3');

const BLOCKS = {};

function stringifyPosition(position) {
	return `${position.x},${position.y},${position.z}`;
}

function getBlock(bot, position) {
	let positionString = stringifyPosition(position);

	if (!BLOCKS[positionString]) BLOCKS[positionString] = bot.blockAt(position);
	return BLOCKS[positionString];
}

const ghostBlocks = ["air", "wheat", "grass", "tall_grass"];

function checkSolid(bot, position, cache=true) {
	let block = cache? getBlock(bot, position) : bot.blockAt(position);
	return block && !(block.displayName.includes('Air') || block.material === 'plant' || ghostBlocks.includes(block.name));
}

function checkWalkable(bot, position, cache=true) {
	return (
		checkSolid(bot, position.offset(0, -1, 0), cache) &&
		!checkSolid(bot, position, cache) &&
		!checkSolid(bot, position.offset(0, 1, 0), cache)
	)
}

function getNeighbours(bot, {position, g}) {
	let points = [
        position.offset( 0,-1,-1),
        position.offset( 0,-1, 1),
        position.offset(-1,-1, 0),
        position.offset( 1,-1, 0),

        position.offset( 0, 0,-1),
        position.offset( 0, 0, 1),
        position.offset(-1, 0, 0),
        position.offset( 1, 0, 0),

        position.offset( 0, 1,-1),
        position.offset( 0, 1, 1),
        position.offset(-1, 1, 0),
        position.offset( 1, 1, 0),
    ];

    points = points.filter((point)=>{
        return checkWalkable(bot, point);
    });

    return points.map(point=>{
        return {
            position: point,
            g: g+1,
        };
    });
}

function findPath(bot, goal, range=1, maxLoops=500) {
	let openList = [];
	let closedList = [];

	let start = bot.entity.position;
	let startDistance = start.distanceTo(goal);

	let startNode = {
        position: start,
        g: 0,
        h: startDistance,
        f: 0,
    };

	openList.push(startNode);

    for (let loops = 0; loops < maxLoops; loops++) {
    	if (!openList.length) break;

    	let node = openList.reduce((p, c)=>{
            return p.f < c.f ? p : c;
        });

        openList.splice(openList.indexOf(node), 1);
        closedList.push(node);

        if (node.position.distanceTo(goal) <= range) {
            let path = [];
            while (node.root) {
                path.push(node);
                node = node.root;
            }
            return path;
        }

        let neighbours = getNeighbours(bot, node);

        for (neighbour of neighbours) {
        	let onClosedList = closedList.find((obj)=>{
                return obj.position.distanceTo(neighbour.position) < 0.01;
            });

            if (onClosedList) continue;

            let g = node.g+1;
            let h = neighbour.position.distanceTo(goal);
            let f = g+h;

            neighbour.h = h;
            neighbour.f = f;
            neighbour.root = node;

            // Dealing with duplicates
            let duplicate = openList.find((obj)=>{
                return obj.position.distanceTo(neighbour.position) < 0.1;
            });

            if (duplicate) {
                if (g < duplicate.g) {
                    openList.splice(openList.indexOf(duplicate), 1);
                    openList.push(neighbour);
                }
            } else {
                openList.push(neighbour);
            }
        }
    }

    let searchSpace = closedList;//[...openList, ...closedList];

    if (searchSpace.length) {
        let point = openList.reduce((p, c)=>{
            return p.h < c.h ? p : c;
        });

        let path = [];//[startNode];

        while (point.root) {
            path.push(point);
            point = point.root;
        }

        return path;
    }
}

function gridWalk(bot, goal) {
    if (goal && bot.entity.position.distanceTo(goal) >= 0.1) {
        bot.lookAt(goal, true);
        bot.setControlState('forward', true);
        //bot.setControlState('sprint', true);
        bot.setControlState('jump', goal.y >= bot.entity.position.y+0.5);
        return;
    }

    bot.setControlState('forward', false);
    bot.setControlState('sprint', false);
    bot.setControlState('jump', false);
}

async function goto(bot, goal, settings) {
    let botPosition = bot.entity.position;
    let path = findPath(bot, goal, settings.range);

    let end = goal.floor();

    for (let i = path.length-1; i >= 0; i -= 1) {
        let subgoal = path[i].position.offset(0.5, 0, 0.5);

        while (bot.entity.position.distanceTo(subgoal) > 0.2) {
            gridWalk(bot, subgoal);
            await bot.waitForTicks(1);
        }
    }

    bot.clearControlStates();
};

function getBruteTarget(position, goal) {
    let xOffset = goal.x-position.x;
    let yOffset = goal.y-position.y;
    let zOffset = goal.z-position.z;

    xOffset = Math.min(1, Math.max(xOffset, -1));
    yOffset = Math.min(1, Math.max(yOffset, -1));
    zOffset = Math.min(1, Math.max(zOffset, -1));

    if (Math.abs(xOffset) > 0.25) return position.offset(xOffset, 0, 0);
    if (Math.abs(zOffset) > 0.25) return position.offset(0, 0, zOffset);
    if (Math.abs(yOffset) > 0.25) return position.offset(0, yOffset, 0);

    /*if (position.x < goal.x) return position.offset( 1, 0, 0);
    if (position.x > goal.x) return position.offset(-1, 0, 0);
    if (position.z < goal.z) return position.offset( 0, 0, 1);
    if (position.z > goal.z) return position.offset( 0, 0,-1);
    if (position.y < goal.y) return position.offset( 0, 1, 0);
    if (position.y > goal.y) return position.offset( 0,-1, 0);*/

    return null;
}

async function bruteGoto(bot, goal, settings) {
    bot.setControlState('forward', true);

    while (bot.entity.position.distanceTo(goal) > 0.5) {
        let subgoal = getBruteTarget(bot.entity.position, goal);

        if (!checkWalkable(bot, subgoal, false)) {
            let blockA = bot.blockAt(subgoal);
            let blockB = bot.blockAt(subgoal.offset(0, 1, 0));

            bot.setControlState('forward', false);

            await bot.dig(blockA);
            await bot.dig(blockB);
        }

        //gridWalk(bot, subgoal);

        bot.lookAt(subgoal);
        bot.setControlState('forward', true);

        await bot.waitForTicks(1);
    }

    bot.setControlState('forward', false);
}


function plugin(bot) {
    bot.pathfinder = {};

    bot.pathfinder.goto = async (goal, settings={})=>{
        await goto(bot, goal, settings);
    };

    bot.pathfinder.follow = async (target, settings)=>{
        //
    };

    bot.pathfinder.brute = async (goal, settings)=>{
        await bruteGoto(bot, goal);
    };

	/*bot.on('chat', async (username, message)=>{
		if (username === bot.username) return;

		if (message === "report") {
			console.log(checkSolid(bot, bot.entity.position.offset(0, -1, 0)));
			console.log(checkWalkable(bot, bot.entity.position));
		}

		if (message === "path") {
			let player = bot.players[username];

			let startTime = performance.now();

			let path = findPath(bot, player.entity.position);

			let endTime = performance.now();

			bot.chat(`Scanned in ${Math.round(endTime-startTime)}ms.`);
		}

        if (message === "come") {
            let player = bot.players[username];
            let goal = player.entity.position;

            await goto(bot, goal);
            console.log("Finished pathing.");
        }
	});*/
}

module.exports = plugin;