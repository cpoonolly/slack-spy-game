require('dotenv').config();
const express = require('express');
const { createMessageAdapter } = require('@slack/interactive-messages');
const { WebClient } = require('@slack/web-api')

const app = express();

const webClient = new WebClient(process.env.SLACK_BOT_TOKEN)
const slackInteractions = createMessageAdapter(process.env.SLACK_SIGNING_SECRET);

app.use('/slack/actions', slackInteractions.expressMiddleware());

// SLASH COMMAND ENDPOINT
app.post('/', (req, res) => {
    console.log('Got a slash command!!!!');

    res.send({
        blocks: [{
            type: "actions",
            elements: [{
                type: "button",
                text: {type: "plain_text", text: "Start Game"},
                value: "start_game",
                action_id: "start_game"
            }]
        }]
    });
});

// INTERACTIVE MESSAGES SERVER
slackInteractions.action({actionId: 'start_game'}, (payload, respond) => {
    console.log('got a test 1..2..3.. action!');
    console.log(`payload:\n${JSON.stringify(payload, null, 2)}`);

    respond({text: 'Starting Game...'});
    setTimeout(() => respond({replace_original: "false", text: 'Success!'}), 1000);

    return {text: 'Starting Game...'};
});



app.listen(process.env.PORT, () => console.log(`Spy Game Server listening on port ${process.env.PORT}!`))