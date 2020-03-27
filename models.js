const redis = new (require("ioredis"))();
const uuid = require('uuid/v4');
const _ = require('lodash');

const { GAME_CONFIG_BY_NUM_PLAYERS, GAME_STAGE } = require('./constants');


class SlackChannel {
    constructor(teamId, channelId, gameUuid) {
        this.teamId = teamId;
        this.channelId = channelId;
        this.gameUuid = gameUuid;
    }

    async createGame() {
        this.gameUuid = uuid();
        const {teamId, channelId, gameUuid} = this;

        if (!await redis.setnx(`slack_channel:${teamId}:${channelId}:game`, gameUuid))
            throw new SlackGameError(`Game already exists in this channel`, {teamId, channelId});

        await redis.set(`game:${gameUuid}:stage`, GAME_STAGE.WAITING_FOR_PLAYERS);
        return await SpyGame.fetch(gameUuid);
    }

    static async fetch(teamId, channelId) {
        const gameUuid = await redis.get(`slack_channel:${teamId}:${channelId}:game`);
        return new SlackChannel(teamId, channelId, gameUuid);
    }
}

class SpyGame {
    constructor({
        gameUuid,
        players,
        missions,
        currentMission,
        missionsCompleted,
        missionsWon,
        missionsLost,
        spies,
        stage,
        leaderQueue
    }) {
        this.gameUuid = gameUuid;
        this.stage = stage;

        this.players = new Set(players || []);
        this.spies = new Set(spies || []);        
        this.leaderQueue = leaderQueue || [];

        this.missions = missions || [];
        this.currentMission = currentMission || null;
        this.missionsCompleted = new Set(missionsCompleted || []);
        this.missionsWon = new Set(missionsWon || []);
        this.missionsLost = new Set(missionsLost || []);
    }

    get currentMission() {
        return (this.missions.length ? _.last(this.missions): null)
    }

    get gameConfig() {
        return GAME_CONFIG_BY_NUM_PLAYERS[this.players.size];
    }

    get numSpies() {
        return this.gameConfig.numSpies;
    }

    get numMisions() {
        return this.gameConfig.numMisions;
    }

    get numMissionsCompleted() {
        return this.missionsCompleted.size;
    }

    get currentMissionTeamSize() {
        return this.gameConfig.missionTeamSizes[this.numMissionsCompleted];
    }

    get currentMissionNumVotesForFail() {
        return this.gameConfig.missionNumNoVotesForFail;
    }

    get currentNumMissionFails() {
        return this.missionsLost.size;
    }

    get maxMissionFails() {
        return this.gameConfig.maxMissionFails;
    }

    async addPlayer(userId) {
        const {gameUuid} = this;
        if (this.stage !== GAME_STAGE.WAITING_FOR_PLAYERS)
            throw new SlackGameError(`Cannot add player. Game has already started or been cancelled.`, {gameUuid, userId});
        
        await redis.sadd(`game:${gameUuid}:players`, userId);
        this.players.add(userId);
    }

    async startGame() {
        const {gameUuid} = this;
        
        if (this.stage !== GAME_STAGE.WAITING_FOR_PLAYERS)
            throw new SlackGameError(`Cannot start game. Game has already started or been cancelled.`, {gameUuid});
        this.stage = GAME_STAGE.WAITING_TO_START_MISSION;
        await redis.set(`game:${gameUuid}:stage`, this.stage);
        
        this.spies = _.sampleSize(players, gameConfig.numSpies);
        await Promise.all(this.spies.map(player => await redis.sadd(`game:${gameUuid}:spies`, player)));

        this.leaderQueue = _.shuffle(Array.from(players));
        await Promise.all(this.leaderQueue.map(player => await redis.rpush(`game:${gameUuid}:leader_queue`, player)));
    }

    async startNewMission() {
        const {gameUuid} = this;

        const missionUuid = uuid();
        if (!await redis.setnx(`game:${gameUuid}:current_mission`, missionUuid))
            throw new SlackGameError(`Game already has a mission in progress.`, {gameUuid});
        await redis.rpush(`game:${gameUuid}:missions`, missionUuid);

        const leader = await redis.lpop(`game:${gameUuid}:leader_queue`);
        await redis.rpush(`game:${gameUuid}:leader_queue`);
    }

    async completeMission() {

    }

    async cancelGame() {

    }

    static async fetch(gameUuid) {
        const players = await redis.smembers(`game:${gameUuid}:players`);
        const missions = await redis.lrange(`game:${gameUuid}:missions`, 0, -1);
        const spies = await redis.smembers(`game:${gameUuid}:spies`);
        const stage = await redis.get(`game:${gameUuid}:stage`);
        const leaderQueue = await redis.lrange(`game:${gameUuid}:leader_queue`, 0, -1);
        const currentMission = await redis.get(`game:${gameUuid}:current_mission`);
        const missionsCompleted = await redis.smembers(`game:${gameUuid}:missions_completed`);
        const missionsWon = await redis.smembers(`game:${gameUuid}:missions_won`);
        const missionsLost = await redis.smembers(`game:${gameUuid}:missions_lost`);

        return new SpyGame({
            gameUuid,
            players,
            missions,
            spies,
            stage,
            leaderQueue,
            currentMission,
            missionsCompleted,
            missionsWon,
            missionsLost
        })
    }
}

class Mission {
    constructor({
        missionUuid,
        leader,
        team,
        voters,
        isTeamAccepted,
        isSuccessful,
        isComplete,
        votesForTeam,
        votesForMission
    }) {
        this.missionUuid = missionUuid;
        
        this.leader = leader || null;
        this.team = new Set(team || []);
        this.voters = new Set(voters || []);
        this.winner = winner || null;
        this.isTeamAccepted = isTeamAccepted || false;
        this.isComplete = isComplete || false;
        this.isSuccessful = isSuccessful || false;
        this.votesForTeam = votesForTeam || {};
        this.votesForMission = votesForMission || {};
    }

    async chooseTeam(team) {

    }

    async addTeamVote(userUuid, vote) {

    }

    async addMissionVote(userUuid, vote) {
        
    }

    static async fetchMany(missionUuids) {
        return await Promise.all(missionUuids.map(Mission.fetch));
    }

    static async fetch(missionUuid) {
        const leader = await redis.get(`mission:${missionUuid}:leader`);
        const team = await redis.smembers(`mission:${missionUuid}:team`);
        const voters = await redis.smembers(`mission:${missionUuid}:voters`);
        const isTeamAccepted = await redis.get(`mission:${missionUuid}:is_team_accepted`);
        const isComplete = await redis.get(`mission:${missionUuid}:is_complete`);
        const isSuccessful = await redis.get(`mission:${missionUuid}:is_successful`);
        const votesForTeam = await redis.hgetall(`mission:${missionUuid}:votes_for_team`);
        const votesForMission = await redis.hgetall(`mission:${missionUuid}:votes_for_mission`);

        return new Mission({
            missionUuid,
            leader,
            team,
            voters,
            isTeamAccepted,
            isComplete,
            isSuccessful,
            votesForTeam,
            votesForMission
        });
    }
}

class SlackGameError extends Error {
    constructor(message, data, isEphemeral = false) {
        super(`${message} (${JSON.stringify(data)})`);
        this.message = message;
        this.data = data;
    }

    get slackMessage() {
        return {text: this.message}
    }
}

/* HERE BE CRAPPY TRANSACTION MANAGEMENT */

const PESSIMISTIC_LOCK_RETRY_TIME = 50;
const PESSIMISTIC_LOCK_MAX_RETRIES = 100;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function lockObject(objectKey, uuid) {
    let lockAquired = false;

    for (let numRetries = 0; numRetries < PESSIMISTIC_LOCK_MAX_RETRIES; numRetries++) {
        lockAquired = await redis.setnx(`${objectKey}:${uuid}:lock`, true);
        if (lockAquired) return;

        await sleep(PESSIMISTIC_LOCK_RETRY_TIME);
    }

    throw Error(`Failed to obtain lock - ${objectKey}:${uuid}`);
}

async function unlockObject(objectKey, uuid) {
    await redis.del(`${objectKey}:${uuid}:lock`);
}