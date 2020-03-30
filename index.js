require('dotenv').config();

const { App } = require('@slack/bolt');

const { SlackChannel, SpyGame, Mission, SlackGameError } = require('./models');
const messages = require('./messages');


const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET
});

function postEphemeral(channelId, userId, context, message) {
    app.client.chat.postEphemeral({
        token: context.botToken,
        channel: channelId,
        user: userId,
        ...message
    });
}

// SLASH COMMAND ENDPOINT
app.command('/spygame', async ({command, ack, respond}) => {
    console.log(`COMMAND: /spygame\n${JSON.stringify(command, null, 2)}`);
    ack();

    const teamId = command.team_id;
    const channelId = command.channel_id;
    const channel = await SlackChannel.fetch(teamId, channelId);
    const game = (channel.gameUuid ? await SpyGame.fetch(channel.gameUuid) : null);

    respond(messages.manageGame(game));
});

// INTERACTIVE MESSAGES SERVER
app.action('new_game', async ({action, ack, respond, say}) => {
    console.log(`ACTION: new_game\n${JSON.stringify(action, null, 2)}`);
    ack();

    const teamId = action.team.id;
    const channelId = action.channel.id;
    const userId = action.user.id;

    let channel, game;

    try {
        channel = await SlackChannel.fetch(teamId, channelId);
        game = await channel.createGame();
        await game.addPlayer(userId);
    } catch (err) {
        console.error(err);
        if (err instanceof SlackGameError) respond(err.slackMessage);
    }

    respond(messages.gameCreated());
    say(messages.joinGame(hasJoinBtn=true, hasCancelBtn=true));
});

app.action('join_game', async ({action, ack, respond, say, context}) => {
    console.log(`ACTION: join_game\n${JSON.stringify(action, null, 2)}`);
    ack();

    const teamId = action.team.id;
    const channelId = action.channel.id;
    const userId = action.user.id;

    let channel, game;

    try {
        channel = await SlackChannel.fetch(teamId, channelId);

        game = await SpyGame.fetch(channel.gameUuid); // should always exist at this point
        if (game.players.has(userId))
            throw new SlackGameError(`You've already joined this game!`, {teamId, channelId, userId, gameUuid: game.gameUuid})

        await game.addPlayer(userId);
    } catch (err) {
        console.error(err);
        if (err instanceof SlackGameError) postEphemeral(channelId, userId, context, err.slackMessage);
    }

    respond(messages.joinGame(game));
    say(message.userJoinedGame(userId));
});

app.action('cancel_game', async ({action, ack}) => {
    console.log(`ACTION: cancel_game\n${JSON.stringify(action, null, 2)}`);
    ack();
});

app.action('start_game', async ({action, ack, respond, say, context}) => {
    console.log(`ACTION: start_game\n${JSON.stringify(action, null, 2)}`);
    ack();

    const teamId = action.team.id;
    const channelId = action.channel.id;
    const userId = action.user.id;

    let channel, game, mission;

    try {
        channel = await SlackChannel.fetch(teamId, channelId);
        
        game = await SpyGame.fetch(channel.gameUuid);
        if (!game)
            throw new SlackGameError(`Something went wrong - Game no longer available`, {teamId, channelId, userId});

        await game.startGame();
        mission = await game.startNewMission();

    } catch (err) {
        console.error(err);
        if (err instanceof SlackGameError) postEphemeral(channelId, userId, context, err.slackMessage);
    }

    respond(messages.gameStarted());
    say(messages.gameStartedBy(userId));

    game.spies.forEach(player => postEphemeral(channel, player, context, messages.youAreASpy()))
    Array.from(game.players)
        .filter(player => !game.spies.has(player))
        .forEach(player => postEphemeral(channel, player, context, messages.youAreAGoodGuy()))

    say(messages.gameSummary(game));

    postEphemeral(channel, mission.leader, context, messages.chooseTeam(game));
    Array.from(game.players)
        .filter(player => mission.leader !== player)
        .forEach(player => postEphemeral(channel, player, context, messages.playerIsChoosingTeam(mission.leader)));
});

app.action('choose_team', async ({action, ack, respond, context}) => {
    console.log(`ACTION: choose_team\n${JSON.stringify(action, null, 2)}`);
    ack();

    const teamId = action.team.id;
    const channelId = action.channel.id;
    const userId = action.user.id;

    let channel, game, mission;

    try {
        channel = await SlackChannel.fetch(teamId, channelId);
        
        game = await SpyGame.fetch(channel.gameUuid);
        if (!game)
            throw new SlackGameError(`Something went wrong - Game no longer available`, {teamId, channelId, userId});

        mission = await Mission.fetch(game.currentMission);
        if (!mission)
            throw new SlackGameError(`Something went wrong - Mission no longer available`, {teamId, channelId, userId});

        const team = action.actions.selected_options.map(option => option.value);
        await mission.chooseTeam(userId, team);

    } catch (err) {
        console.error(err);
        if (err instanceof SlackGameError) postEphemeral(channelId, userId, context, err.slackMessage);
    }

    respond(messages.teamChoosen());
    game.players.forEach(player => postEphemeral(channel, player, context, messages.voteOnTeam(mission)));
});

app.action('vote_on_team', async ({action}) => {
    console.log(`ACTION: vote_on_team\n${JSON.stringify(action, null, 2)}`);
    ack();

    const teamId = action.team.id;
    const channelId = action.channel.id;
    const userId = action.user.id;

    let channel, game, mission, vote, nextMission;

    try {
        channel = await SlackChannel.fetch(teamId, channelId);
        
        game = await SpyGame.fetch(channel.gameUuid);
        if (!game)
            throw new SlackGameError(`Something went wrong - Game no longer available`, {teamId, channelId, userId});

        mission = await Mission.fetch(game.currentMission);
        if (!mission)
            throw new SlackGameError(`Something went wrong - Mission no longer available`, {teamId, channelId, userId});

        vote = (action.actions[0].value === 'yes' ? true : false);
        await mission.addTeamVote(userId, vote);
        if (mission.isTeamVotingComplete && !mission.isTeamAccepted)
            nextMission = await game.startNewMission();

    } catch (err) {
        console.error(err);
        if (err instanceof SlackGameError) postEphemeral(channelId, userId, context, err.slackMessage);
    }

    respond(messages.votedFor(vote));

    if (!mission.isTeamVotingComplete) return;
    say(messages.teamVoteResults(mission));

    if (mission.isTeamAccepted) {
        say(messages.teamIsVotingOnMission(game, mission));
        mission.team.forEach(player => postEphemeral(channel, player, context, messages.voteOnMission(mission)));
    } else {
        postEphemeral(channel, nextMission.leader, context, messages.chooseTeam(game));
        Array.from(game.players)
            .filter(player => nextMission.leader !== player)
            .forEach(player => postEphemeral(channel, player, context, messages.playerIsChoosingTeam(nextMission.leader)));
    }
});

app.action('vote_on_mission', async ({action}) => {
    console.log(`ACTION: vote_on_mission\n${JSON.stringify(action, null, 2)}`);
    ack();

    const teamId = action.team.id;
    const channelId = action.channel.id;
    const userId = action.user.id;

    let channel, game, mission, vote, nextMission;

    try {
        channel = await SlackChannel.fetch(teamId, channelId);
        
        game = await SpyGame.fetch(channel.gameUuid);
        if (!game)
            throw new SlackGameError(`Something went wrong - Game no longer available`, {teamId, channelId, userId});

        mission = await Mission.fetch(game.currentMission);
        if (!mission)
            throw new SlackGameError(`Something went wrong - Mission no longer available`, {teamId, channelId, userId});

        vote = (action.actions[0].value === 'yes' ? true : false);
        await mission.addMissionVote(userId, vote);

        if (mission.isMissionComplete)
            await game.completeMission(mission);
        if (!game.isGameOver)
            nextMission = await game.startNewMission();
        else
            await game.removeGame();

    } catch (err) {
        console.error(err);
        if (err instanceof SlackGameError) postEphemeral(channelId, userId, context, err.slackMessage);
    }

    respond(messages.votedForMission(vote));
        
    if (!mission.isMissionComplete) return;
    say(messages.missionVoteResults(mission));
    say(messages.gameSummary(game));

    if (game.isGameOver) {
        say(messages.gameOver(game));
    } else {
        postEphemeral(channel, nextMission.leader, context, messages.chooseTeam(game));
        Array.from(game.players)
            .filter(player => nextMission.leader !== player)
            .forEach(player => postEphemeral(channel, player, context, messages.playerIsChoosingTeam(nextMission.leader)));
    }
});

(async () => {
    // Start your app
    await app.start(process.env.PORT);
  
    console.log('⚡️ Bolt app is running!');
})();