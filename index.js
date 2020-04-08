require('dotenv').config();

const { App } = require('@slack/bolt');

const { SlackChannel, SpyGame, Mission, SlackGameError } = require('./models');
const messages = require('./messages');


const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET
});

async function postEphemeral(channelId, userId, context, message) {
    try {
        await app.client.chat.postEphemeral({
            token: context.botToken,
            channel: channelId,
            user: userId,
            ...message
        });        
    } catch (err) {
        console.log(`ephemeral message error:\n${JSON.stringify(message, null, 2)}`);
        console.error(err);
    }
}

async function postChat(channelId, userId, context, message) {
    try {
        await app.client.chat.postMessage({
            token: context.botToken,
            channel: channelId,
            user: userId,
            ...message
        });        
    } catch (err) {
        console.log(`chat message error:\n${JSON.stringify(message, null, 2)}`);
        console.error(err);
    }
}

// SLASH COMMAND ENDPOINT
app.command('/spygame', async ({command, ack, respond}) => {
    console.log(`COMMAND: /spygame\n${JSON.stringify(command, null, 2)}`);
    ack();

    const teamId = command.team_id;
    const channelId = command.channel_id;

    let channel, game;

    try {
        channel = await SlackChannel.fetch(teamId, channelId);
        await channel.lockChannel();

        game = (channel.gameUuid ? await SpyGame.fetch(channel.gameUuid) : null);
    } catch (err) {
        console.error(err);
        if (err instanceof SlackGameError) respond(err.slackMessage);
    } finally {
        if (channel) await channel.unlockChannel();
    }

    respond(messages.manageGame(game));
});

// INTERACTIVE MESSAGES SERVER
app.action('new_game', async ({body, ack, respond, say}) => {
    console.log(`ACTION: new_game\n${JSON.stringify(body, null, 2)}`);
    ack();

    const teamId = body.team.id;
    const channelId = body.channel.id;
    const userId = body.user.id;

    let channel, game;

    try {
        channel = await SlackChannel.fetch(teamId, channelId);
        await channel.lockChannel();

        game = await channel.createGame();
        await game.addPlayer(userId);
    } catch (err) {
        console.error(err);
        if (err instanceof SlackGameError) respond(err.slackMessage);
        return;
    } finally {
        if (channel) await channel.unlockChannel();
    }

    respond(messages.gameCreated());
    say(messages.joinGame(game));
});

app.action('join_game', async ({body, ack, respond, context}) => {
    console.log(`ACTION: join_game\n${JSON.stringify(body, null, 2)}`);
    ack();

    const teamId = body.team.id;
    const channelId = body.channel.id;
    const userId = body.user.id;

    let channel, game;

    try {
        channel = await SlackChannel.fetch(teamId, channelId);
        await channel.lockChannel();

        game = await SpyGame.fetch(channel.gameUuid); // should always exist at this point
        if (game.players.has(userId))
            throw new SlackGameError(`You've already joined this game!`, {teamId, channelId, userId, gameUuid: game.gameUuid})

        await game.addPlayer(userId);
    } catch (err) {
        console.error(err);
        if (err instanceof SlackGameError) await postEphemeral(channelId, userId, context, err.slackMessage);
        return;
    } finally {
        if (channel) await channel.unlockChannel();
    }

    respond(messages.joinGame(game));
    await postChat(channelId, userId, context, messages.userJoinedGame(userId));
});

app.action('cancel_game', async ({body, ack, respond, context}) => {
    console.log(`ACTION: cancel_game\n${JSON.stringify(body, null, 2)}`);
    ack();

    const teamId = body.team.id;
    const channelId = body.channel.id;
    const userId = body.user.id;

    let channel, game;

    try {
        channel = await SlackChannel.fetch(teamId, channelId);
        await channel.lockChannel();
        
        game = await SpyGame.fetch(channel.gameUuid);
        if (!game)
            throw new SlackGameError(`Something went wrong - Game no longer available`, {teamId, channelId, userId});

        await game.cancelGame(userId);
        await channel.removeGame();

    } catch (err) {
        console.error(err);
        if (err instanceof SlackGameError) await postEphemeral(channelId, userId, context, err.slackMessage);
        return;
    } finally {
        if (channel) await channel.unlockChannel();
    }

    respond(messages.gameCancelled());
    await postChat(channelId, userId, context, messages.gameCancelledBy(userId));
});

app.action('start_game', async ({body, ack, respond, context}) => {
    console.log(`ACTION: start_game\n${JSON.stringify(body, null, 2)}`);
    ack();

    const teamId = body.team.id;
    const channelId = body.channel.id;
    const userId = body.user.id;

    let channel, game, mission;

    try {
        channel = await SlackChannel.fetch(teamId, channelId);
        await channel.lockChannel();
        
        game = await SpyGame.fetch(channel.gameUuid);
        if (!game)
            throw new SlackGameError(`Something went wrong - Game no longer available`, {teamId, channelId, userId});

        await game.startGame();
        mission = await game.startNewMission();

    } catch (err) {
        console.error(err);
        if (err instanceof SlackGameError) await postEphemeral(channelId, userId, context, err.slackMessage);
        return;
    } finally {
        if (channel) await channel.unlockChannel();
    }

    respond(messages.gameStarted());
    await postChat(channelId, userId, context, messages.gameStartedBy(userId));

    await postChat(channelId, userId, context, messages.gameSummary(game));

    await Promise.all(Array.from(game.spies)
        .map(player => postEphemeral(channelId, player, context, messages.youAreASpy(player, game))));
    await Promise.all(Array.from(game.players)
        .filter(player => !game.spies.has(player))
        .map(player => postEphemeral(channelId, player, context, messages.youAreAGoodGuy())));

    await postEphemeral(channelId, mission.leader, context, messages.chooseTeam(game));
    await Promise.all(Array.from(game.players)
        .filter(player => mission.leader !== player)
        .map(player => postEphemeral(channelId, player, context, messages.playerIsChoosingTeam(mission.leader))));
});

app.action('choose_team', async ({body, ack, respond, context}) => {
    console.log(`ACTION: choose_team\n${JSON.stringify(body, null, 2)}`);
    ack();

    const teamId = body.team.id;
    const channelId = body.channel.id;
    const userId = body.user.id;

    let channel, game, mission;

    try {
        channel = await SlackChannel.fetch(teamId, channelId);
        await channel.lockChannel();
        
        game = await SpyGame.fetch(channel.gameUuid);
        if (!game)
            throw new SlackGameError(`Something went wrong - Game no longer available`, {teamId, channelId, userId});

        mission = await Mission.fetch(game.currentMission);
        if (!mission)
            throw new SlackGameError(`Something went wrong - Mission no longer available`, {teamId, channelId, userId});

        const team = body.actions[0].selected_options.map(option => option.value);
        await mission.chooseTeam(userId, team);

    } catch (err) {
        console.error(err);
        if (err instanceof SlackGameError) await postEphemeral(channelId, userId, context, err.slackMessage);
        return;
    } finally {
        if (channel) await channel.unlockChannel();
    }

    respond(messages.teamChoosen());
    await Promise.all(Array.from(game.players)
        .map(player => postEphemeral(channelId, player, context, messages.voteOnTeam(mission))));
});

const voteOnTeam = async ({body, ack, respond, context}, vote) => {
    console.log(`ACTION: vote_on_team\n${JSON.stringify(body, null, 2)}`);
    ack();

    const teamId = body.team.id;
    const channelId = body.channel.id;
    const userId = body.user.id;

    let channel, game, mission, nextMission;

    try {
        channel = await SlackChannel.fetch(teamId, channelId);
        await channel.lockChannel();
        
        game = await SpyGame.fetch(channel.gameUuid);
        if (!game)
            throw new SlackGameError(`Something went wrong - Game no longer available`, {teamId, channelId, userId});

        mission = await Mission.fetch(game.currentMission);
        if (!mission)
            throw new SlackGameError(`Something went wrong - Mission no longer available`, {teamId, channelId, userId});

        await mission.addTeamVote(userId, vote);
        if (mission.isTeamVoteComplete && !mission.isTeamAccepted) {
            await game.discardCurrentMission();
            nextMission = await game.startNewMission();
        }
    } catch (err) {
        console.error(err);
        if (err instanceof SlackGameError) await postEphemeral(channelId, userId, context, err.slackMessage);
        return;
    } finally {
        if (channel) await channel.unlockChannel();
    }

    respond(messages.votedForTeam(vote));

    if (!mission.isTeamVoteComplete) return;
    await postChat(channelId, userId, context, messages.teamVoteResults(mission));

    if (mission.isTeamAccepted) {
        await postChat(channelId, userId, context, messages.teamIsVotingOnMission(game, mission));
        await Promise.all(Array.from(mission.team)
            .map(player => postEphemeral(channelId, player, context, messages.voteOnMission(mission))));
    } else {
        await postEphemeral(channelId, nextMission.leader, context, messages.chooseTeam(game));
        await Promise.all(Array.from(game.players)
            .filter(player => nextMission.leader !== player)
            .map(player => postEphemeral(channelId, player, context, messages.playerIsChoosingTeam(nextMission.leader))));
    }
};

app.action('vote_yes_on_team', (params) => voteOnTeam(params, true));
app.action('vote_no_on_team', (params) => voteOnTeam(params, false));

const voteOnMission = async ({body, ack, respond, context}, vote) => {
    console.log(`ACTION: vote_on_mission\n${JSON.stringify(body, null, 2)}`);
    ack();

    const teamId = body.team.id;
    const channelId = body.channel.id;
    const userId = body.user.id;

    let channel, game, mission, nextMission;

    try {
        channel = await SlackChannel.fetch(teamId, channelId);
        await channel.lockChannel();
        
        game = await SpyGame.fetch(channel.gameUuid);
        if (!game)
            throw new SlackGameError(`Something went wrong - Game no longer available`, {teamId, channelId, userId});

        mission = await Mission.fetch(game.currentMission);
        if (!mission)
            throw new SlackGameError(`Something went wrong - Mission no longer available`, {teamId, channelId, userId});

        await mission.addMissionVote(userId, vote);
        if (mission.isMissionComplete) {
            await game.completeMission(mission);

            if (!game.isGameOver)
                nextMission = await game.startNewMission();
            else
                await channel.removeGame();
        }

    } catch (err) {
        console.error(err);
        if (err instanceof SlackGameError) await postEphemeral(channelId, userId, context, err.slackMessage);
        return;
    } finally {
        if (channel) await channel.unlockChannel();
    }

    respond(messages.votedForMission(vote));
        
    if (!mission.isMissionComplete) return;
    await postChat(channelId, userId, context, messages.missionVoteResults(mission));
    await postChat(channelId, userId, context, messages.gameSummary(game));

    if (game.isGameOver) {
        await postChat(channelId, userId, context, messages.gameOver(game));
    } else {
        await postEphemeral(channelId, nextMission.leader, context, messages.chooseTeam(game));
        await Promise.all(Array.from(game.players)
            .filter(player => nextMission.leader !== player)
            .map(player => postEphemeral(channelId, player, context, messages.playerIsChoosingTeam(nextMission.leader))));
    }
};

app.action('vote_yes_on_mission', (params) => voteOnMission(params, true));
app.action('vote_no_on_mission', (params) => voteOnMission(params, false));

(async () => {
    // Start your app
    await app.start(process.env.PORT);
  
    console.log('⚡️ Bolt app is running!');
})();