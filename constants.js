const MAX_NUM_PLAYERS = 10;
const MIN_NUM_PLAYERS = 5;

const GAME_CONFIG_BY_NUM_PLAYERS = {
  5: {numSpies: 2, numMisions: 5, missionTeamSizes: [2, 3, 2, 3, 3], missionNumNoVotesForFail: [1, 1, 1, 2, 1], maxMissionFails: 2},
  6: {numSpies: 2, numMisions: 5, missionTeamSizes: [2, 3, 4, 3, 4], missionNumNoVotesForFail: [1, 1, 1, 2, 1], maxMissionFails: 2},
  7: {numSpies: 3, numMisions: 5, missionTeamSizes: [2, 3, 3, 4, 4], missionNumNoVotesForFail: [1, 1, 1, 2, 1], maxMissionFails: 2},
  8: {numSpies: 3, numMisions: 5, missionTeamSizes: [3, 4, 4, 5, 5], missionNumNoVotesForFail: [1, 1, 1, 2, 1], maxMissionFails: 2},
  9: {numSpies: 3, numMisions: 5, missionTeamSizes: [3, 4, 4, 5, 5], missionNumNoVotesForFail: [1, 1, 1, 2, 1], maxMissionFails: 2},
  10: {numSpies: 4, numMisions: 5, missionTeamSizes: [3, 4, 4, 5, 5], missionNumNoVotesForFail: [1, 1, 1, 2, 1], maxMissionFails: 2},
};

const GAME_STAGE = Object.freeze({
    WAITING_FOR_PLAYERS: 'WAITING_FOR_PLAYERS',
    // -> WAITING_TO_START_MISSION
    WAITING_TO_START_MISSION: 'WAITING_TO_START_MISSION',
    // -> CHOOSING_TEAM
    CHOOSING_TEAM: 'CHOOSING_TEAM',
    // -> VOTING_ON_TEAM
    VOTING_ON_TEAM: 'VOTING_ON_TEAM',
    // -> TEAM_ACCEPTED, TEAM_DENIED
    TEAM_ACCEPTED: 'TEAM_ACCEPTED',
    // -> VOTING_ON_MISSION
    TEAM_DENIED: 'TEAM_DENIED',
    // -> WAITING_TO_START_MISSION
    VOTING_ON_MISSION: 'VOTING_ON_MISSION',
    // -> MISSION_SUCCESS, MISSION_FAIL
    MISSION_SUCCESS: 'MISSION_SUCCESS',
    // -> WAITING_TO_START_MISSION, GAME_SUCCESS
    MISSION_FAIL: 'MISSION_FAIL',
    // -> WAITING_TO_START_MISSION, GAME_FAIL
    GAME_SUCCESS: 'GAME_SUCCESS',
    // -> WAITING_FOR_PLAYERS
    GAME_FAIL: 'GAME_FAIL',
    // -> WAITING_FOR_PLAYERS
    GAME_CANCELLED: 'GAME_CANCELLED',
    // -> WAITING_FOR_PLAYERS
});

const MISSION_WINNER = Object.freeze({
    SPIES: 'SPIES',
    GOOD_GUYS: 'GOOD_GUYS',
});