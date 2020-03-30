const { MAX_NUM_PLAYERS, MIN_NUM_PLAYERS } = require('./constants');

const gameCreated = () => ({text: `Game created!`});

const manageGame = (game) => {
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
};


const joinGameBtn = () => ({
    type: "button",
    text: {type: "plain_text", text: "Join Game"},
    value: "join_game",
    action_id: "join_game",
    style: "primary",
});

const cancelGameBtn = () => ({
    type: "button",
    text: {type: "plain_text", text: "Cancel Game"},
    value: "cancel_game",
    action_id: "cancel_game",
    style: "danger",
});

const startGameBtn = () => ({
    type: "button",
    text: {type: "plain_text", text: "Start Game"},
    value: "start_game",
    action_id: "start_game",
    style: "primary",
});

const joinGame = (game) => {
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
        blocks: [{
            type: "section",
            text: {type: "mrkdwn", text: message}
        }, {
            type: "section",
            text: {type: "mrkdwn", text: `Current players: \n${currentPlayersText}`}
        }, {
            type: "actions",
            elements: buttons,
        }]
    }
};

const userJoinedGame = (userId) => ({text: `<@${userId}> joined the game!`});

const gameStarted = () => ({text: `Game started!`});

const gameStartedBy = (userId) => ({text: `<@${userId}> started the game.`});

const youAreASpy = () => ({text: `You are a spy!`});

const youAreAGoodGuy = () => ({text: `You are a good guy!`});

const gameSummary = (game) => ({
    blocks: [
        spacing(),
        spacing(),
        gameSummaryTitleSection(),
        gameSummaryPlayersSection(game),
        gameSummaryMissionsSection(game),
    ]
});

const spacing = () => ({type: "section", text: {type: "plain_text", text: " "}});

const gameSummaryTitleSection = () => ({
    type: "section",
    text: {
        type: "mrkdwn",
        text: ":earth_asia::earth_africa::earth_americas:       *SPY GAME*      :earth_asia::earth_africa::earth_americas: "
    },
    fields: [{
        type: "mrkdwn",
        text: "*Number of Spies:*\n:smiling_imp: :smiling_imp:"
    }, {
        type: "mrkdwn",
        text: "*Number of Good Guys:*\n:innocent: :innocent: :innocent: :innocent:"
    }],
    accessory: {
        type: "image",
        image_url: "https://files.slack.com/files-pri/TB0D636QM-F011142LA78/spy-icon.png?pub_secret=ba972ca7c4",
        alt_text: "spy game image"
    }
});

const gameSummaryPlayersSection = (game) => ({
    type: "section",
    text: {
        type: "mrkdwn",
        text: `*Players:*\n<@${game.currentLeader}> ${game.leaderQueue
            .filter(player => player !== game.currentLeader)
            .map(player => `<@${player}`)}`
    }
});

const gameSummaryMissionsSection = (game) => {
    const sections = [{type: "section", text: {type: "mrkdwn", text: "*Missions*"}}];
    const missionIcons = [':one:', ':two:', ':three:', ':four:', ':five:'];
    
    game.missionsCompletedInOrder.forEach((missionUuid, index) => {
        const isComplete = game.missionsCompleted.has(missionUuid);
        const isSuccessful = game.missionsWon.has(missionUuid);

        sections.append(gameSummaryMissionsSectionRow({
            missionNumIcon: missionIcons[index],
            missionStatusIcon: (isComplete ? (isSuccessful ? ':heavy_check_mark:' : ':x:') : ':grey_question:'),
            teamSize: game.gameConfig.missionTeamSizes[index],
            votesToFail: game.gameConfig.missionNumNoVotesForFail[index],
        }));
    });
};

const gameSummaryMissionsSectionRow = ({missionNumIcon, missionStatusIcon, teamSize, votesToFail}) => ({
    type: "section",
    text: {
        type: "mrkdwn",
        text: `${missionNumIcon}  |  Status: ${missionStatusIcon}  |  Team Size: ${teamSize}${votesToFail > 1 ? `  |  (${votesToFail} votes to fail)`: ''}`
    }
});

const chooseTeam = (game) => ({
    blocks: [{
        type: "section",
        text: {
            type: "mrkdwn",
            text: `You are the leader of this mission. Please choose *${game.currentMissionTeamSize}* players to go on the mission.`
        },
        accessory: {
            type: "multi_static_select",
            placeholder: {type: "plain_text", text: "Choose Team"},
            options: Array.from(game.players).map(player => ({
                text: {type: "plain_text", text: `<@${player}>`},
                value: player
            })),
            max_selected_items: game.currentMissionTeamSize
        }
    }]
});

const playerIsChoosingTeam = (leader) => ({text: `<@${leader}> is the leader. They're choosing a team for the next mission.`})

const teamChoosen = () => ({text: `Team choosen!`});

const voteOnTeam = (mission) => ({
    blocks: [{
        type: "section",
        text: {
            type: "mrkdwn",
            text: `<@${mission.leader}> selected a team.\n*Team:*\n${Array.from(mission.team).map(player => `<@${player}>`)}`
        }
    }, {
        type: "actions",
        elements: [{
            type: "button",
            text: {type: "plain_text", text: "Vote Yes  :heavy_check_mark:", emoji: true},
            value: "yes"
        }, {
            type: "button",
            text: {type: "plain_text", text: "Vote No  :x:", emoji: true},
            value: "no"
        }]
    }, {
        type: "context",
        elements: [{
            type: "plain_text",
            text: "You're vote will be visible to everyone"
        }]
    }]
});

const votedForTeam = (vote) => ({type: "mrkdwn", text: `You've voted ${vote ? 'yes' : 'no'} for the team.`});

const teamVoteResults = (mission) => ({
    blocks: [{
        type: "section",
        text: {
            type: "mrkdwn",
            text: `Team ${mission.isTeamAccepted ? 'Accepted' : 'Rejected'}!`
        }
    }, {
        type: "section",
        text: {
            type: "mrkdwn",
            text: `*Voted Yes:*\n${mission.playersWhoVotedYesForTeam.map(player => `<@${player}>`)}`
        }
    }, {
        type: "section",
        text: {
            type: "mrkdwn",
            text: `*Voted No:*\n${mission.playersWhoVotedNoForTeam.map(player => `<@${player}>`)}`
        }
    }]
});

const teamIsVotingOnMission = (game, mission) => ({
    blocks: [{
        type: "section",
        text: {
            type: "mrkdwn",
            text: `Mission Starting! The players on the mission team will now vote on the success of the mission. Good luck!`
        }
    }, {
        type: "section",
        text: {
            type: "mrkdwn",
            text: `*Mission Team:*\n${mission.team.map(player => `<@${player}`)}`
        }
    }, {
        type: "context",
        elements: [{
            type: "plain_text",
            text: game.currentMissionNumVotesForFail === 1 ?
                `1 No vote will fail the mission` :
                `${game.currentMissionNumVotesForFail} No votes will fail the mission`
        }]
    }]
});

const voteOnMission = (mission) => ({
    blocks: [{
        type: "section",
        text: {
            type: "mrkdwn",
            text: `You are on the mission. Vote to succeed or fail it.`
        }
    }, {
        type: "actions",
        elements: [{
            type: "button",
            text: {type: "plain_text", text: "Succeed Mission  :heavy_check_mark:", emoji: true},
            value: "yes"
        }, {
            type: "button",
            text: {type: "plain_text", text: "Fail Mission  :x:", emoji: true},
            value: "no"
        }]
    }, {
        type: "context",
        elements: [{
            type: "plain_text",
            text: "You're vote will NOT be visible to anyone"
        }]
    }]
});

const votedForMission = (vote) => ({type: "mrkdwn", text: `You've voted ${vote ? 'yes' : 'no'} for the mission.`});

const missionVoteResults = (mission) => ({
    blocks: [{
        type: "section",
        text: {
            type: "mrkdwn",
            text: mission.isMissionSuccessful ? ':tada: Mission Succeeded! :tada:' : ':sob: Mission Failed :sob:'
        }
    }, {
        type: "section",
        text: {
            type: "mrkdwn",
            text: `*Number of votes to fail the mission:* ${mission.playersWhoVotedNoForMission.length}`
        }
    }]
});

const gameOver = (game) => ({
    blocks: [
        spacing(),
        {
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": ":earth_asia:       *GAME OVER*       :earth_americas:"
			}
		},
        (game.isSuccessful ? {
            type: "section",
            text: {
                type: "mrkdwn",
                text: ":smiling_imp:          Spies Win          :smiling_imp:"
            }
        } : {
            type: "section",
            text: {
                type: "mrkdwn",
                text: ":innocent:     Good Guys Win     :innocent:"
            }
        })  
    ]
});