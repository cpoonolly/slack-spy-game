require('dotenv').config();

const { App } = require('@slack/bolt');

const { SlackChannel, SpyGame, Mission, SlackGameError } = require('./models');
const messages = require('./messages');
const { GAMES_STAGE, MISSION_STAGES } = require('./constants');


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
registerCommand('/spygame', async ({teamId, channelId, userId, respond}) => {
    const {game} = await loadModels(teamId, channelId);
    respond(messages.manageGame(userId, game));
});

// INTERACTIVE MESSAGES SERVER
registerAction('new_game', async ({teamId, channelId, userId, respond, context}) => {
    const game = await runInTxn(teamId, channelId, async ({channel}) => {
        const game = await channel.createGame()
        await game.addPlayer(userId);

        return game;
    });

    respond(messages.gameCreated());
    await postPublic(channelId, userId, context, messages.waitingForPlayers(game));
});

registerAction('join_game', async ({teamId, channelId, userId, respond, context}) => {
    const game = await runInTxn(teamId, channelId, async ({game}) => {
        await game.addPlayer(userId);

        return game;
    });

    respond(messages.waitingForPlayers(game));
    await postPublic(channelId, userId, context, messages.userJoinedGame(userId));
});

registerAction('cancel_game', async ({teamId, channelId, userId, respond, context}) => {
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
    const game = await runInTxn(teamId, channelId, ({game}) => game.startGame());

    respond(messages.gameStarted());
    await postPublic(channelId, userId, context, messages.gameStartedBy(userId));
    await postPublic(channelId, userId, context, messages.gameSummary(game));
});

registerAction('admin_notify_spies', async ({teamId, channelId, userId, context}) => {
    const {game} = await loadModels(teamId, channelId);
    if (userId !== game.admin)
        throw new SlackGameError(`You are not the admin of this game`, {teamId, channelId, userId});

    await Promise.all(Array.from(game.spies)
        .map(player => postPrivate(channelId, player, context, messages.youAreASpy(player, game))));
});

registerAction('admin_notify_good_guys', async ({teamId, channelId, userId, context}) => {
    const {game} = await loadModels(teamId, channelId);
    if (userId !== game.admin)
        throw new SlackGameError(`You are not the admin of this game`, {teamId, channelId, userId});

    await Promise.all(Array.from(game.players)
        .filter(player => !game.spies.has(player))
        .map(player => postPrivate(channelId, player, context, messages.youAreAGoodGuy())));
});

registerAction('admin_start_mission', async ({teamId, channelId, userId, context}) => {
    const {game, mission} = await runInTxn(teamId, channelId, ({game}) => {
        if (userId !== game.admin)
            throw new SlackGameError(`You are not the admin of this game`, {teamId, channelId, userId});
        if (game.isGameOver)
            throw new SlackGameError(`Can't start new mission this game is already over`, {teamId, channelId, userId});
        if (game.currentMission)
            await game.discardCurrentMission();

        const mission = await game.startNewMission();

        return {game, mission};
    });

    await postPublic(channelId, userId, messages.playerIsChoosingTeam(mission.leader));
    await postPrivate(channelId, mission.leader, context, messages.chooseTeam(game));
});

registerAction('choose_team', async ({teamId, channelId, userId, body, respond, context}) => {
    const team = body.actions[0].selected_options.map(option => option.value);

    const mission = await runInTxn(teamId, channelId, async ({mission}) => {
        await mission.chooseTeam(userId, team);
        return mission;
    });

    respond(messages.teamChoosen());
    await postPublic(channelId, userId, context, messages.playerHasChoosenTeam(mission));
});

registerAction('admin_start_team_vote', async ({teamId, channelId, userId, context}) => {
    const {game, mission} = await loadModels(teamId, channelId);
    if (userId !== game.admin)
        throw new SlackGameError(`You are not the admin of this game`, {teamId, channelId, userId});
    if (mission.stage !== MISSION_STAGES.VOTING_ON_TEAM)
        throw new SlackGameError(`Something wen't wrong - we're no longer voting on the team`, {teamId, channelId, userId});

    await Promise.all(Array.from(game.players)
        .filter(player => !(player in mission.votesForTeam))
        .map(player => postPrivate(channelId, player, context, messages.voteOnTeam(mission))));
});

registerAction('admin_show_team_vote_status', async ({teamId, channelId, userId, context}) => {
    const {game, mission} = await loadModels(teamId, channelId);
    if (userId !== game.admin)
        throw new SlackGameError(`You are not the admin of this game`, {teamId, channelId, userId});
    if (mission.stage !== MISSION_STAGES.VOTING_ON_TEAM)
        throw new SlackGameError(`Something wen't wrong - we're no longer voting on the team`, {teamId, channelId, userId});

    await postPublic(channelId, userId, context, messages.teamVoteStatus(mission));
});

const voteOnTeam = async ({teamId, channelId, userId, respond, context}, vote) => {
    const mission = await runInTxn(teamId, channelId, async ({mission}) => {
        await mission.addTeamVote(userId, vote);

        return mission;
    });

    respond(messages.votedForTeam(vote));
    if (!mission.isTeamVoteComplete)
        await postPublic(channelId, userId, context, messages.playerVotedForTeam(userId));
    else
        await postPublic(channelId, userId, context, messages.teamVoteResults(mission));
};

registerAction('vote_yes_on_team', (params) => voteOnTeam(params, true));
registerAction('vote_no_on_team', (params) => voteOnTeam(params, false));

registerAction('admin_start_mission_vote', async ({teamId, channelId, userId, context}) => {
    const {game, mission} = await loadModels(teamId, channelId);
    if (userId !== game.admin)
        throw new SlackGameError(`You are not the admin of this game`, {teamId, channelId, userId});
    if (mission.stage !== MISSION_STAGES.VOTING_ON_MISSION)
        throw new SlackGameError(`Something wen't wrong - we're no longer voting on the mission`, {teamId, channelId, userId});
    
    await postPublic(channelId, userId, context, messages.teamIsVotingOnMission(game, mission));
    await Promise.all(Array.from(mission.team)
        .filter(player => !(player in mission.votesForMission))
        .map(player => postPrivate(channelId, player, context, messages.voteOnMission(mission))));
});

registerAction('admin_show_mission_vote_status', async ({teamId, channelId, userId, context}) => {
    const {game, mission} = await loadModels(teamId, channelId);
    if (userId !== game.admin)
        throw new SlackGameError(`You are not the admin of this game`, {teamId, channelId, userId});
    if (mission.stage !== MISSION_STAGES.VOTING_ON_MISSION)
        throw new SlackGameError(`Something wen't wrong - we're no longer voting on the mission`, {teamId, channelId, userId});
    
    await postPublic(channelId, userId, context, messages.missionVoteStatus(game, mission));
});

const voteOnMission = async ({teamId, channelId, userId, respond, context}, vote) => {
    const mission = await runInTxn(teamId, channelId, async ({mission}) => {
        await mission.addMissionVote(userId, vote);

        return mission;
    });

    respond(messages.votedForMission(vote));
    if (!mission.isMissionComplete) return;
    await postPublic(channelId, userId, context, messages.missionComplete(mission));
};

registerAction('vote_yes_on_mission', (params) => voteOnMission(params, true));
registerAction('vote_no_on_mission', (params) => voteOnMission(params, false));

registerAction('admin_show_mission_vote_results', async ({teamId, channelId, userId, context}) => {
    const {game, mission} = await runInTxn(teamId, channelId, async ({game, mission, channel}) => {
        if (userId !== game.admin)
            throw new SlackGameError(`You are not the admin of this game`, {teamId, channelId, userId});
        if (!mission.isMissionComplete) 
            throw new SlackGameError(`Something went wrong this mission hasn't completed yet`, {teamId, channelId, userId});

        await game.completeMission(mission);

        if (!game.isGameOver)
            await game.startNewMission();
        else
            await channel.removeGame();

        return {game, mission};
    });

    await postPublic(channelId, userId, context, messages.missionVoteResults(mission));
    await postPublic(channelId, userId, context, messages.gameSummary(game));

    if (game.isGameOver) {
        await postPublic(channelId, userId, context, messages.gameOver(game));
    }
});

(async () => {
    // Start your app
    await app.start(process.env.PORT);
  
    console.log('⚡️ Bolt app is running!');
})();