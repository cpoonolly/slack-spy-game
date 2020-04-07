const redis = new (require("ioredis"))();
const { v4: uuid } = require('uuid');
const _ = require('lodash');

const { GAME_CONFIG_BY_NUM_PLAYERS, GAME_STAGE, MISSION_STAGES } = require('./constants');

const PESSIMISTIC_LOCK_RETRY_TIME = 50;
const PESSIMISTIC_LOCK_MAX_RETRIES = 100;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

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

    async removeGame() {
        const {teamId, channelId, gameUuid} = this;
        if (!gameUuid)
            throw new SlackGameError(`Cannot end game. No game exists in this channel`, {teamId, channelId});

        await redis.del(`slack_channel:${teamId}:${channelId}:game`)
        this.gameUuid = null;
    }

    /* HERE BE CRAPPY TRANSACTION MANAGEMENT */
    async lockChannel() {
        const {teamId, channelId} = this;
        let lockAquired = false;

        if (!teamId || !channelId)
            throw Error(`Invalid channel - ${teamId}:${channelId}`);
    
        for (let numRetries = 0; numRetries < PESSIMISTIC_LOCK_MAX_RETRIES; numRetries++) {
            lockAquired = await redis.setnx(`slack_channel:${teamId}:${channelId}:lock`, true);
            if (lockAquired) return;
    
            await sleep(PESSIMISTIC_LOCK_RETRY_TIME);
        }
    
        throw Error(`Failed to obtain lock - ${teamId}:${channelId}`);
    }
    
    async unlockChannel() {
        const {teamId, channelId} = this;
        await redis.del(`slack_channel:${teamId}:${channelId}:lock`);
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

    get missionsCompletedInOrder() {
        return this.missions.filter(missionUuid => this.missionsCompleted.has(missionUuid));
    }

    get currentMissionTeamSize() {
        return this.gameConfig.missionTeamSizes[this.numMissionsCompleted];
    }

    get currentMissionNumVotesForFail() {
        return this.gameConfig.missionNumNoVotesForFail[this.numMissionsCompleted];
    }

    get currentNumMissionFails() {
        return this.missionsLost.size;
    }

    get maxMissionFails() {
        return this.gameConfig.maxMissionFails;
    }

    get currentLeader() {
        return this.leaderQueue[this.leaderQueue.length - 1];
    }

    get isGameOver() {
        return new Set([
            GAME_STAGE.GAME_FAIL,
            GAME_STAGE.GAME_SUCCESS
        ]).has(this.stage);
    }

    get isGameSuccessful() {
        return this.stage === GAME_STAGE.GAME_SUCCESS;
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
        this.stage = GAME_STAGE.IN_PROGRESS;
        await redis.set(`game:${gameUuid}:stage`, this.stage);
        
        this.spies = new Set(_.sampleSize(Array.from(this.players), this.numSpies));
        console.log(`Spies chosen: ${JSON.stringify(Array.from(this.spies))}`);
        await Promise.all(Array.from(this.spies).map(player => redis.sadd(`game:${gameUuid}:spies`, player)));
        console.log(`Spies set: ${await redis.smembers(`game:${gameUuid}:spies`)}`);

        this.leaderQueue = _.shuffle(Array.from(this.players));
        await Promise.all(this.leaderQueue.map(player => redis.rpush(`game:${gameUuid}:leader_queue`, player)));
    }

    async discardCurrentMission() {
        await redis.del(`game:${this.gameUuid}:current_mission`)
    }

    async startNewMission() {
        const {gameUuid} = this;

        const missionUuid = uuid();
        if (!await redis.setnx(`game:${gameUuid}:current_mission`, missionUuid))
            throw new SlackGameError(`Game already has a mission in progress.`, {gameUuid});
        await redis.rpush(`game:${gameUuid}:missions`, missionUuid);
        
        const leader = await redis.lpop(`game:${gameUuid}:leader_queue`);
        await redis.rpush(`game:${gameUuid}:leader_queue`, leader);
        await redis.set(`mission:${missionUuid}:leader`, leader);
        
        const voters = Array.from(this.players);
        await Promise.all(voters.map(player => redis.sadd(`mission:${missionUuid}:voters`, player)));

        await redis.set(`mission:${missionUuid}:mission_num`, this.numMissionsCompleted);
        await redis.set(`mission:${missionUuid}:stage`, MISSION_STAGES.CHOOSING_TEAM);
        await redis.set(`mission:${missionUuid}:team_size`, this.currentMissionTeamSize);

        return await Mission.fetch(missionUuid);
    }

    async completeMission(mission) {
        const {gameUuid} = this;
        const {missionUuid} = mission;

        if (!mission.isMissionComplete)
            throw new SlackGameError(`Something went wrong.`, {gameUuid, missionUuid, msg: 'Attempt to complete a uncompleted mission.'});
        if (this.currentMission !== missionUuid)
            throw new SlackGameError(`Something went wrong.`, {gameUuid, missionUuid, msg: 'Attempt to complete a non current mission.'});

        await redis.sadd(`mission:${missionUuid}:completed_missions`, missionUuid);
        this.missionsCompleted = new Set(await redis.smembers(`mission:${missionUuid}:completed_missions`));

        if (mission.isMissionSuccessful) {
            this.missionsWon.add(missionUuid);
            await redis.sadd(`mission:${missionUuid}:missions_won`, missionUuid);
        } else {
            this.missionsLost.add(missionUuid);
            await redis.sadd(`mission:${missionUuid}:missions_lost`, missionUuid);
        }

        if (this.numMissionsCompleted < this.numMisions) return;
        this.stage = (this.missionsLost.size >= this.maxMissionFails ? GAME_STAGE.GAME_FAIL : GAME_STAGE.GAME_SUCCESS);
        await redis.set(`mission:${missionUuid}:stage`, this.stage);
    }

    async cancelGame(userId) {
        const {gameUuid} = this;
        
        if (!this.players.has(userId))
            throw new SlackGameError(`Only players in the game can cancel it.`, {gameUuid, userId, players: JSON.stringify(Array.from(this.players))});
        if (this.stage === GAME_STAGE.GAME_CANCELLED)
            throw new SlackGameError(`Game has already been cancelled.`, {gameUuid, userId});

        await redis.set(`game:${gameUuid}:stage`, GAME_STAGE.GAME_CANCELLED);
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

        if (_.isNil(stage)) return null;

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
        missionNum,
        stage,
        leader,
        teamSize,
        team,
        voters,
        votesForTeam,
        votesForMission
    }) {
        this.missionUuid = missionUuid;
        this.missionNum = parseInt(missionNum) || null;
        this.stage = stage || null;
        this.leader = leader || null;
        this.teamSize = parseInt(teamSize) || null;
        
        this.team = new Set(team || []);
        this.voters = new Set(voters || []);
        this.votesForTeam = votesForTeam || {};
        this.votesForMission = votesForMission || {};
    }

    get playersWhoVotedYesForTeam() {
        return Object.keys(this.votesForTeam).filter(player => this.votesForTeam[player] === 'true');
    }

    get playersWhoVotedNoForTeam() {
        return Object.keys(this.votesForTeam).filter(player => this.votesForTeam[player] !== 'true');
    }

    get playersWhoVotedYesForMission() {
        return Object.keys(this.votesForMission).filter(player => this.votesForMission[player] === 'true');
    }

    get playersWhoVotedNoForMission() {
        return Object.keys(this.votesForMission).filter(player => !this.votesForMission[player] !== 'true');
    }

    get isTeamVoteComplete() {
        return new Set([
            MISSION_STAGES.TEAM_DENIED,
            MISSION_STAGES.VOTING_ON_MISSION,
            MISSION_STAGES.MISSION_SUCCESS,
            MISSION_STAGES.MISSION_FAIL
        ]).has(this.stage);
    }

    get isTeamAccepted() {
        return new Set([
            MISSION_STAGES.VOTING_ON_MISSION,
            MISSION_STAGES.MISSION_SUCCESS,
            MISSION_STAGES.MISSION_FAIL
        ]).has(this.stage);
    }

    get isMissionSuccessful() {
        return this.stage === MISSION_STAGES.MISSION_SUCCESS;
    }

    get isMissionComplete() {
        return new Set([
            MISSION_STAGES.MISSION_SUCCESS,
            MISSION_STAGES.MISSION_FAIL
        ]).has(this.stage);
    }

    get gameConfig() {
        return GAME_CONFIG_BY_NUM_PLAYERS[this.voters.size];
    }

    get numNoVotesForMissionFail() {
        return this.gameConfig.missionNumNoVotesForFail[this.missionNum];
    }

    async chooseTeam(userId, team) {
        const {missionUuid} = this;
        if (this.leader !== userId)
            throw new SlackGameError(`You're not the leader of this mission. You cannot choose the team.`, {userId, missionUuid});
        if (this.teamSize !== team.length)
            throw new SlackGameError(`You need to select ${this.teamSize} players.`, {userId, missionUuid});
        if (this.stage !== MISSION_STAGES.CHOOSING_TEAM)
            throw new SlackGameError(`No longer choosing team for Mission.`, {userId, missionUuid});

        await Promise.all(team.map(player => redis.sadd(`mission:${missionUuid}:team`, player)));
        await redis.set(`mission:${missionUuid}:stage`, MISSION_STAGES.VOTING_ON_TEAM);
        
        this.team = new Set(await redis.smembers(`mission:${missionUuid}:team`));
        this.stage = await redis.get(`mission:${missionUuid}:stage`);
    }

    async addTeamVote(userId, vote) {
        const {missionUuid} = this;
        if (this.stage !== MISSION_STAGES.VOTING_ON_TEAM)
            throw new SlackGameError(`No longer voting on team for mission.`, {userId, missionUuid});
        if (!this.voters.has(userId))
            throw new SlackGameError(`You're not a voter on this team'.`, {userId, missionUuid});
        if (this.votesForTeam[userId] !== undefined)
            throw new SlackGameError(`You've already voted for this team.`, {userId, missionUuid});

        await redis.hset(`mission:${missionUuid}:votes_for_team`, userId, vote);
        this.votesForTeam = await redis.hgetall(`mission:${missionUuid}:votes_for_team`);
        if (this.voters.size > _.size(this.votesForTeam)) return;
        console.log(`Team Vote complete: ${this.voters.size} > ${_.size(this.votesForTeam)}`);

        const numYesVotes = this.playersWhoVotedYesForTeam.length;
        const numNoVotes = this.playersWhoVotedNoForTeam.length;
        const isTeamAccepted = numYesVotes > numNoVotes;
        this.stage = (isTeamAccepted ? MISSION_STAGES.VOTING_ON_MISSION : MISSION_STAGES.TEAM_DENIED);
        await redis.set(`mission:${missionUuid}:stage`, this.stage);
        console.log(`mission stage: ${this.stage} - yes: ${numYesVotes} - no: ${numNoVotes}`);
    }

    async addMissionVote(userId, vote) {
        const {missionUuid} = this;
        if (this.stage !== MISSION_STAGES.VOTING_ON_MISSION)
            throw new SlackGameError(`No longer voting on mission success.`, {userId, missionUuid});
        if (!this.team.has(userId))
            throw new SlackGameError(`You're not on the team for this mission'.`, {userId, missionUuid});
        if (this.votesForMission[userId] !== undefined)
            throw new SlackGameError(`You've already voted for this mission.`, {userId, missionUuid});

        await redis.hset(`mission:${missionUuid}:votes_for_mission`, userId, vote);
        this.votesForMission = await redis.hgetall(`mission:${missionUuid}:votes_for_mission`);
        if (this.team.size > _.size(this.votesForMission)) return;
        console.log(`Mission Vote complete: ${this.team.size} > ${_.size(this.votesForMission)}`);

        const numNoVotes = this.playersWhoVotedNoForMission.length;
        const isMissionSuccessful = (numNoVotes > this.numNoVotesForMissionFail);
        this.stage = (isMissionSuccessful ? MISSION_STAGES.MISSION_SUCCESS : MISSION_STAGES.MISSION_FAIL);
        await redis.set(`mission:${missionUuid}:stage`, this.stage);
        console.log(`mission stage: ${this.stage} - no: ${numNoVotes}`);
    }

    static async fetch(missionUuid) {
        const missionNum = await redis.get(`mission:${missionUuid}:mission_num`);
        const stage = await redis.get(`mission:${missionUuid}:stage`);
        const leader = await redis.get(`mission:${missionUuid}:leader`);
        const team = await redis.smembers(`mission:${missionUuid}:team`);
        const teamSize = await redis.get(`mission:${missionUuid}:team_size`);
        const voters = await redis.smembers(`mission:${missionUuid}:voters`);
        const votesForTeam = await redis.hgetall(`mission:${missionUuid}:votes_for_team`);
        const votesForMission = await redis.hgetall(`mission:${missionUuid}:votes_for_mission`);

        if (_.isNil(missionNum) || _.isNil(stage) || _.isNil(leader)) return null;

        return new Mission({
            missionUuid,
            missionNum,
            stage,
            leader,
            team,
            teamSize,
            voters,
            votesForTeam,
            votesForMission
        });
    }
}

class SlackGameError extends Error {
    constructor(message, data) {
        super(`${message} (${JSON.stringify(data)})`);
        this.message = message;
        this.data = data;
    }

    get slackMessage() {
        return {text: this.message}
    }
}

module.exports = {
    SlackChannel,
    SpyGame,
    Mission,
    SlackGameError,
};