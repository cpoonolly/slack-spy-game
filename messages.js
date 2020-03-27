const { MAX_NUM_PLAYERS, MIN_NUM_PLAYERS } = require('./constants');

const gameCreated = () => ({text: `Game created!`});

function manageGame(game) {
    if (game) {
        return {text: `A Game is already in progress in this channel. Please wait until it's over.`};
    }

    return {
        blocks: [{
            type: "actions",
            elements: [{
                type: "button",
                text: {type: "plain_text", text: "New Game"},
                value: "new_game",
                action_id: "new_game"
            }]
        }]
    };
}


const joinGameBtn = () => ({
    type: "button",
    text: {
        type: "plain_text",
        text: "Join Game"
    },
    value: "join_game",
    action_id: "join_game",
    style: "primary",
});

const cancelGameBtn = () => ({
    type: "button",
    text: {
        type: "plain_text",
        text: "Cancel Game"
    },
    value: "cancel_game",
    action_id: "cancel_game",
    style: "danger",
});

const startGameBtn = () => ({
    type: "button",
    text: {
        type: "plain_text",
        text: "Start Game"
    },
    value: "start_game",
    action_id: "start_game",
    style: "primary",
});

function joinGame(game) {
    const currentPlayersText = game.players.map(userId => ` • <@${userId}>`).join('\n');

    let buttons, message;
    if (game.players.size >= MAX_NUM_PLAYERS) {
        buttons = [startGameBtn(), cancelGameBtn()];
        message = `*GAME FULL*`;
    } else if (game.players.size >= MIN_NUM_PLAYERS) {
        buttons = [joinGameBtn(), startGameBtn(), cancelGameBtn()];
        message = `Game ready (${MAX_NUM_PLAYERS - game.players.size} spots available)`;
    } else {
        buttons = [joinGameBtn(), cancelGameBtn()];
        message = `Waiting for more players (Need ${MIN_NUM_PLAYERS - game.players.size} more players)`;
    }

    return {
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: message,
                }
            }, {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `Current players: \n${currentPlayersText}`,
                }
            }, {
                type: "actions",
                elements: buttons,
            }
        ]
    }
}

const userJoinedGame = (userId) => ({text: `<@${userId}> joined the game!`});

const gameStarted = () => ({text: `Game started!`});

