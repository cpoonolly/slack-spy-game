require('dotenv').config();

const { App } = require('@slack/bolt');

const { SlackChannel, SpyGame, SlackGameError } = require('./models');
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

    const teamId = action.team_id;
    const channelId = action.channel_id;
    const userId = action.user_id;

    try {
        const channel = await SlackChannel.fetch(teamId, channelId);
        const game = await channel.createGame();
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

    const teamId = action.team_id;
    const channelId = action.channel_id;
    const userId = action.user_id;

    try {
        const channel = await SlackChannel.fetch(teamId, channelId);

        const game = await SpyGame.fetch(channel.gameUuid); // should always exist at this point
        if (game.players.has(userId))
            throw new SlackGameError(`You've already joined this game!`, {teamId, channelId, userId, gameUuid: game.gameUuid})

        await game.addPlayer(userId);
        respond(messages.joinGame(game));
        say(message.userJoinedGame(userId));
    } catch (err) {
        console.error(err);
        if (err instanceof SlackGameError) postEphemeral(channelId, userId, context, err.slackMessage);
    }
});

app.action('cancel_game', async ({action, ack}) => {
    console.log(`ACTION: cancel_game\n${JSON.stringify(action, null, 2)}`);
    ack();
});

app.action('start_game', async ({action, ack, respond, say, context}) => {
    console.log(`ACTION: start_game\n${JSON.stringify(action, null, 2)}`);
    ack();

    const teamId = action.team_id;
    const channelId = action.channel_id;
    const userId = action.user_id;

    try {
        const channel = await SlackChannel.fetch(teamId, channelId);
        const game = await SpyGame.fetch(channel.gameUuid);
        
        if (!game)
            throw new SlackGameError(`Something went wrong - Game no longer available`, {teamId, channelId, userId});

        await game.startGame();
        await game.startNewMission();

        respond(messages.gameStarted());
        game.spies.forEach(player => postEphemeral(channel, player, context))


        
    } catch (err) {
        console.error(err);
        if (err instanceof SlackGameError) postEphemeral(channelId, userId, context, err.slackMessage);
    }
});


(async () => {
    // Start your app
    await app.start(process.env.PORT);
  
    console.log('⚡️ Bolt app is running!');
})();