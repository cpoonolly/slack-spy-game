require('dotenv').config();

const { App } = require('@slack/bolt');

const { SlackChannel, SpyGame, Mission, SlackGameError } = require('./models');
const messages = require('./messages');


const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET
});

// Posts a private (ephemeral) message to a single player
async function postPrivate(channelId, userId, context, message) {
    try {
        await app.client.chat.postEphemeral({
            token: context.botToken,
            channel: channelId,
            user: userId,
            ...message
        });        
    } catch (err) {
        console.log(`ephemeral message error:`, message);
        console.error(err);
    }
}

// Posts a public message to the channel
async function postPublic(channelId, userId, context, message) {
    try {
        await app.client.chat.postMessage({
            token: context.botToken,
            channel: channelId,
            user: userId,
            ...message
        });        
    } catch (err) {
        console.log(`chat message error:`, message);
        console.error(err);
    }
}

function registerCommand(commandName, commandHandler) {
    app.command(commandName, async (params) => {
        const {command, ack, context} = params;

        console.log(`COMMAND: ${commandName}\n${JSON.stringify(command, null, 2)}`);
        ack();

        const teamId = command.team_id;
        const channelId = command.channel_id;
        const userId = command.user_id;

        try {
            return await commandHandler({teamId, channelId, userId, ...params});
        } catch (err) {
            console.error(err);
            if (err instanceof SlackGameError)
                await postPrivate(channelId, userId, context, err.slackMessage);
            else
                await postPrivate(channelId, userId, context, {text: 'Command unavailable'});
        }
    });
}

function registerAction(actionName, actionHandler) {
    app.action(actionName, async (params) => {
        console.log(`ACTION: ${actionName}\n${JSON.stringify(body, null, 2)}`);
        ack();
    
        const teamId = body.team.id;
        const channelId = body.channel.id;
        const userId = body.user.id;

        try {
            return await actionHandler({teamId, channelId, userId, ...params});
        } catch (err) {
            console.error(err);
            if (err instanceof SlackGameError)
                await postPrivate(channelId, userId, context, err.slackMessage);
            else
                await postPrivate(channelId, userId, context, {text: 'Action unavailable'});
        }
    });
}

async function runInTxn(teamId, channelId, runnable) {
    try {
        channel = await SlackChannel.fetch(teamId, channelId);
        await channel.lockChannel();

        game = (channel.gameUuid ? await SpyGame.fetch(channel.gameUuid) : null);
        mission = (game && game.currentMission ? await Mission.fetch(game.currentMission) : null);

        return await runnable({channel, game, mission});

    } finally {
        if (channel) await channel.unlockChannel();
    }
}

async function loadModels(teamId, channelId) {
    return await runInTxn(teamId, channelId, async (models) => models);
}

// SLASH COMMAND ENDPOINT
registerCommand('/spygame', async ({teamId, channelId, respond}) => {
    const {game} = await loadModels(teamId, channelId);
    respond(messages.manageGame(game));
});

// INTERACTIVE MESSAGES SERVER
registerAction('new_game', async ({teamId, channelId, userId, respond}) => {
    const game = await runInTxn(teamId, channelId, async ({channel}) => {
        const game = await channel.createGame()
        await game.addPlayer(userId);

        return game;
    });

    respond(messages.gameCreated());
    await postPublic(channelId, userId, context, messages.waitingForPlayers(game));
});

registerAction('join_game', async ({teamId, channelId, userId, respond}) => {
    const game = await runInTxn(teamId, channelId, async ({game}) => {
        await game.addPlayer(userId);

        return game;
    });

    respond(messages.waitingForPlayers(game));
    await postPublic(channelId, userId, context, messages.userJoinedGame(userId));
});

registerAction('cancel_game', async ({teamId, channelId, userId, respond}) => {
    await runInTxn(teamId, channelId, async ({channel, game}) => {
        await game.cancelGame(userId);
        await channel.removeGame();

        return game;
    });

    respond(messages.gameCancelled());
    await postPublic(channelId, userId, context, messages.gameCancelledBy(userId));
});

registerAction('who_am_i', async ({teamId, channelId, userId, respond}) => {
    const {game} = await loadModels(teamId, channelId);

    respond(messages.whoAmI(game, userId));
});

registerAction('what_do_i_do', async ({teamId, channelId, userId, respond}) => {
    const {game, mission} = await loadModels(teamId, channelId);

    respond(messages.whatDoIDoNow(game, mission, userId));
});

registerAction('how_to_play', async ({respond}) => {
    respond(messages.howToPlay());
});

registerAction('start_game', async ({teamId, channelId, userId, respond, context}) => {
    const {game, mission} = await runInTxn(teamId, channelId, async ({game}) => {
        await game.startGame();
        const mission = await game.startNewMission();

        return {game, mission};
    });

    respond(messages.gameStarted());
    await postPublic(channelId, userId, context, messages.gameStartedBy(userId));
    await postPublic(channelId, userId, context, messages.gameSummary(game));

    await Promise.all(Array.from(game.spies)
        .map(player => postPrivate(channelId, player, context, messages.youAreASpy(player, game))));
    await Promise.all(Array.from(game.players)
        .filter(player => !game.spies.has(player))
        .map(player => postPrivate(channelId, player, context, messages.youAreAGoodGuy())));

    await postPrivate(channelId, mission.leader, context, messages.chooseTeam(game));
    await Promise.all(Array.from(game.players)
        .filter(player => mission.leader !== player)
        .map(player => postPrivate(channelId, player, context, messages.playerIsChoosingTeam(mission.leader))));
});

registerAction('choose_team', async ({teamId, channelId, userId, body, respond}) => {
    const team = body.actions[0].selected_options.map(option => option.value);

    const {game, mission} = await runInTxn(teamId, channelId, async ({game, mission}) => {
        await mission.chooseTeam(userId, team);

        return {game, mission};
    });

    respond(messages.teamChoosen());
    await Promise.all(Array.from(game.players)
        .map(player => postPrivate(channelId, player, context, messages.voteOnTeam(mission))));
});

const voteOnTeam = async ({teamId, channelId, userId, respond, context}, vote) => {
    const {game, mission, nextMission} = await runInTxn(teamId, channelId, async ({game, mission}) => {
        let nextMission;

        await mission.addTeamVote(userId, vote);
        if (mission.isTeamVoteComplete && !mission.isTeamAccepted) {
            await game.discardCurrentMission();
            nextMission = await game.startNewMission();
        }

        return {game, mission, nextMission};
    });

    respond(messages.votedForTeam(vote));
    if (!mission.isTeamVoteComplete) {
        await postPublic(channelId, userId, context, messages.waitingOnTeamVotesFrom(mission));
        return;
    }

    await postPublic(channelId, userId, context, messages.teamVoteResults(mission));

    if (mission.isTeamAccepted) {
        await postPublic(channelId, userId, context, messages.teamIsVotingOnMission(game, mission));
        await Promise.all(Array.from(mission.team)
            .map(player => postPrivate(channelId, player, context, messages.voteOnMission(mission))));
    } else {
        await postPrivate(channelId, nextMission.leader, context, messages.chooseTeam(game));
        await Promise.all(Array.from(game.players)
            .filter(player => nextMission.leader !== player)
            .map(player => postPrivate(channelId, player, context, messages.playerIsChoosingTeam(nextMission.leader))));
    }
};

registerAction('vote_yes_on_team', (params) => voteOnTeam(params, true));
registerAction('vote_no_on_team', (params) => voteOnTeam(params, false));

const voteOnMission = async ({teamId, channelId, userId, respond, context}, vote) => {
    const {game, mission, nextMission} = await runInTxn(teamId, channelId, async ({game, mission, channel}) => {
        let nextMission;

        await mission.addMissionVote(userId, vote);
        if (mission.isMissionComplete) {
            await game.completeMission(mission);

            if (!game.isGameOver)
                nextMission = await game.startNewMission();
            else
                await channel.removeGame();
        }

        return {game, mission, nextMission};
    });

    respond(messages.votedForMission(vote));
    if (!mission.isMissionComplete) {
        await postPublic(channelId, userId, context, messages.waitingOnMissionVotesFrom(mission));
        return;
    }
        
    await postPublic(channelId, userId, context, messages.missionVoteResults(mission));
    await postPublic(channelId, userId, context, messages.gameSummary(game));

    if (game.isGameOver) {
        await postPublic(channelId, userId, context, messages.gameOver(game));
    } else {
        await postPrivate(channelId, nextMission.leader, context, messages.chooseTeam(game));
        await Promise.all(Array.from(game.players)
            .filter(player => nextMission.leader !== player)
            .map(player => postPrivate(channelId, player, context, messages.playerIsChoosingTeam(nextMission.leader))));
    }
};

registerAction('vote_yes_on_mission', (params) => voteOnMission(params, true));
registerAction('vote_no_on_mission', (params) => voteOnMission(params, false));

(async () => {
    // Start your app
    await app.start(process.env.PORT);
  
    console.log('⚡️ Bolt app is running!');
})();