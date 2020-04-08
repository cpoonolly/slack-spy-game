const MAX_NUM_PLAYERS = 10;
const MIN_NUM_PLAYERS = 5;

const GAME_CONFIG_BY_NUM_PLAYERS = {
  5: {numSpies: 2, numMisions: 5, missionTeamSizes: [2, 3, 2, 3, 3], missionMinNoVotesForFail: [1, 1, 1, 2, 1], maxMissionFails: 2},
  6: {numSpies: 2, numMisions: 5, missionTeamSizes: [2, 3, 4, 3, 4], missionMinNoVotesForFail: [1, 1, 1, 2, 1], maxMissionFails: 2},
  7: {numSpies: 3, numMisions: 5, missionTeamSizes: [2, 3, 3, 4, 4], missionMinNoVotesForFail: [1, 1, 1, 2, 1], maxMissionFails: 2},
  8: {numSpies: 3, numMisions: 5, missionTeamSizes: [3, 4, 4, 5, 5], missionMinNoVotesForFail: [1, 1, 1, 2, 1], maxMissionFails: 2},
  9: {numSpies: 3, numMisions: 5, missionTeamSizes: [3, 4, 4, 5, 5], missionMinNoVotesForFail: [1, 1, 1, 2, 1], maxMissionFails: 2},
  10: {numSpies: 4, numMisions: 5, missionTeamSizes: [3, 4, 4, 5, 5], missionMinNoVotesForFail: [1, 1, 1, 2, 1], maxMissionFails: 2},
};

const GAME_STAGE = Object.freeze({
    WAITING_FOR_PLAYERS: 'WAITING_FOR_PLAYERS',
    IN_PROGRESS: 'IN_PROGRESS',
    GAME_SUCCESS: 'GAME_SUCCESS',
    GAME_FAIL: 'GAME_FAIL',
    GAME_CANCELLED: 'GAME_CANCELLED',
});

const MISSION_STAGES = Object.freeze({
    CHOOSING_TEAM: 'CHOOSING_TEAM',
    VOTING_ON_TEAM: 'VOTING_ON_TEAM',
    TEAM_DENIED: 'TEAM_DENIED',
    VOTING_ON_MISSION: 'VOTING_ON_MISSION',
    MISSION_SUCCESS: 'MISSION_SUCCESS',
    MISSION_FAIL: 'MISSION_FAIL',
});

module.exports = {
  MAX_NUM_PLAYERS,
  MIN_NUM_PLAYERS,
  GAME_CONFIG_BY_NUM_PLAYERS,
  GAME_STAGE,
  MISSION_STAGES,
};