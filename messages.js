const { MAX_NUM_PLAYERS, MIN_NUM_PLAYERS, GAME_STAGE, MISSION_STAGES } = require('./constants');

const gameCreated = () => ({text: `Game created!`});

const gameCancelled = () => ({text: `Game cancelled.`});

const gameCancelledBy = (userId) => ({text: `Game cancelled by <@${userId}>`});

const newGameBtn = () => ({
    type: "button",
    text: {type: "plain_text", text: "New Game"},
    value: "new_game",
    action_id: "new_game"
});

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

const whoAmIBtn = () => ({
    type: "button",
    text: {type: "plain_text", text: "Who am I?"},
    value: "who_am_i",
    action_id: "who_am_i",
    style: "primary",
});

const whatDoIDoNowBtn = () => ({
    type: "button",
    text: {type: "plain_text", text: "What do I do now?"},
    value: "what_do_i_do",
    action_id: "what_do_i_do",
    style: "primary",
});

const howToPlayBtn = () => ({
    type: "button",
    text: {type: "plain_text", text: "How to play."},
    value: "how_to_play",
    action_id: "how_to_play",
    style: "primary",
});

const manageGame = (game) => {
    if (!game) {
        return {blocks: [{type: "actions", elements: [newGameBtn()]}]};
    } else if (game.stage === GAME_STAGE.WAITING_FOR_PLAYERS) {
        return waitingForPlayers(game);
    }
    
    return {blocks: [{
        type: "actions",
        elements: [
            whoAmIBtn(),
            whatDoIDoNowBtn(),
            howToPlayBtn(),
            cancelGameBtn()
        ]}
    ]};
};

const whoAmI = (game, userId) => {
    if (game.spies.has(userId)) {
        return youAreASpy(userId, game);
    } else {
        return youAreAGoodGuy();
    }
};

const whatDoIDoNow = (game, mission, userId) => {
    if (!game.players.has(userId)) {
        return {text: `Game in progress wait for it to finish - or ask someone to cancel it`};
    } else if (mission.stage === MISSION_STAGES.CHOOSING_TEAM) {
        if (userId === mission.leader)
            return chooseTeam(game);
        else
            return playerIsChoosingTeam(mission.leader);
    } else if (mission.stage === MISSION_STAGES.VOTING_ON_TEAM) {
        if (userId in mission.votesForTeam)
            return waitingOnTeamVotesFrom(mission);
        else
            return voteOnTeam(mission);
    } else if (mission.stage === MISSION_STAGES.VOTING_ON_MISSION) {
        if (userId in mission.votesForMission || !mission.team.has(userId))
            return waitingOnMissionVotesFrom(mission);
        else
            return voteOnMission(mission);
    }

    return {text: 'Either the game is over - or something is in progress... either way sit tight...'};
};

const howToPlay = () => ({
    blocks: [{
        type: "section",
        text: {
            type: "mrkdwn",
            text: 
`
**HOW TO PLAY**

**Start of the game:**
- There are 2 teams - spies & good guys
- When the games starts each player is secretly told "You are a good guy" or "You are a spy".
- If you are a spy KEEP IT TO YOURSELF! - You need to deceive the good guys in order to win
- There are 5 missions - in order to win spies need to sabotage 3 out of 5 mission

**Before the mission:**
- Before each mission 1 player (the leader) chooses a team to go on the next mission
- After the leader chooses a team - everyone then votes to accept or reject the team
- If the team is rejected - a new leader is selected - they choose a new team - and the new team is voted on
- This process continues over and over until a team is accepted for the mission

**During the mission:**
- Once a team is accepted the mission starts
- Players on the team then vote to "Succeed" or "Fail" (sabotage) the mission
- If any player on the team votes to fail the mission the mission is failed (NOTE: mission 4 requires 2 no votes)
- Votes for the mission are anonymous - so no one knows who sabotaged the mission
    (if you are a good guy you always want the mission to succeed)

**End of the game:**
- The game ends when either spies or good guys have won 3 missions
`
        }
    }]
});

const waitingForPlayers = (game) => {
    const currentPlayersText = Array.from(game.players).map(userId => ` • <@${userId}>`).join('\n');

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

const youAreASpy = (userId, game) => ({
    blocks: [{
        type: "section",
        text: {
            type: "mrkdwn", 
            text: `You are a spy! :smiling_imp:\nOther Spies: ${Array.from(game.spies)
                .filter(player => player !== userId)
                .map(player => `<@${player}>`)}`
        }
    }]
});

const youAreAGoodGuy = () => ({text: `You are a good guy! :innocent:`});

const gameSummary = (game) => ({
    blocks: [
        spacing(),
        spacing(),
        gameSummaryTitleSection(),
        gameSummaryPlayersSection(game),
        ...gameSummaryMissionsSection(game),
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
            .map(player => `<@${player}>`)}`
    }
});

const gameSummaryMissionsSection = (game) => {
    const sections = [{type: "section", text: {type: "mrkdwn", text: "*Missions*"}}];
    const missionIcons = [':one:', ':two:', ':three:', ':four:', ':five:'];
    
    for (let index = 0; index < game.numMisions; index++) {
        const missionUuid = (game.missionsCompletedInOrder.length > index ? game.missionsCompletedInOrder[index] : null);
        const isComplete = game.missionsCompleted.has(missionUuid);
        const isSuccessful = game.missionsWon.has(missionUuid);

        sections.push(gameSummaryMissionsSectionRow({
            missionNumIcon: missionIcons[index],
            missionStatusIcon: (isComplete ? (isSuccessful ? ':heavy_check_mark:' : ':x:') : ':grey_question:'),
            teamSize: game.gameConfig.missionTeamSizes[index],
            votesToFail: game.gameConfig.missionMinNoVotesForFail[index],
        }));
    }

    return sections;
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
            action_id: 'choose_team',
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
            value: "yes",
            action_id: "vote_yes_on_team",
        }, {
            type: "button",
            text: {type: "plain_text", text: "Vote No  :x:", emoji: true},
            value: "no",
            action_id: "vote_no_on_team",
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

const waitingOnTeamVotesFrom = (mission) => ({
    type: "mrkdwn",
    text: `Waiting these players to vote on the team:\n${mission.playersWhoHaventVotedYetForTeam.map(player => `<@${player}>`)}`
});

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
            text: `*Mission Team:*\n${Array.from(mission.team).map(player => `<@${player}>`)}`
        }
    }, {
        type: "context",
        elements: [{
            type: "plain_text",
            text: game.currentMissionMinNoVotesForFail === 1 ?
                `1 No vote will fail the mission` :
                `${game.currentMissionMinNoVotesForFail} No votes will fail the mission`
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
            value: "yes",
            action_id: "vote_yes_on_mission",
        }, {
            type: "button",
            text: {type: "plain_text", text: "Fail Mission  :x:", emoji: true},
            value: "no",
            action_id: "vote_no_on_mission",
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

const waitingOnMissionVotesFrom = (mission) => ({
    type: "mrkdwn",
    text: `Waiting these players to vote on the mission:\n${mission.playersWhoHaventVotedYetForMission.map(player => `<@${player}>`)}`
});

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
			type: "section",
			text: {
				type: "mrkdwn",
				text: ":earth_asia:       *GAME OVER*       :earth_americas:"
			}
		},
        (game.isGameSuccessful ? {
            type: "section",
            text: {
                type: "mrkdwn",
                text: ":innocent:     Good Guys Win     :innocent:"
            }
        } : {
            type: "section",
            text: {
                type: "mrkdwn",
                text: ":smiling_imp:          Spies Win          :smiling_imp:"
            }
        }),
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: `The Spies:\n${Array.from(game.spies).map(player => `<@${player}>`)}`
            }
        }
    ]
});

module.exports = {
    manageGame,
    gameCreated,
    gameCancelled,
    gameCancelledBy,
    waitingForPlayers,
    gameStarted,
    gameStartedBy,
    youAreASpy,
    youAreAGoodGuy,
    gameSummary,
    chooseTeam,
    playerIsChoosingTeam,
    teamChoosen,
    voteOnTeam,
    votedForTeam,
    teamVoteResults,
    teamIsVotingOnMission,
    voteOnMission,
    votedForMission,
    missionVoteResults,
    gameOver,
    userJoinedGame,
    whoAmI,
    whatDoIDoNow,
    howToPlay,
    waitingOnMissionVotesFrom,
    waitingOnTeamVotesFrom,
}