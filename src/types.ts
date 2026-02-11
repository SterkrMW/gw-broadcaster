// TypeScript interfaces matching the server broadcast payloads

export interface PlayerState {
	id: number;
	name: string;
	team: 'red' | 'blue';
	x: number;
	y: number;
	inCombat: boolean;
	combatTargetId: number | null;
	isPendingScore: boolean;
	isScored: boolean;
	partySize: number;
}

export interface GuildState {
	id: number;
	name: string;
	score: number;
	playerCount: number;
}

export interface BattlegroundState {
	roundId: number;
	roundNumber: number;
	roundName: string;
	guild1: GuildState;
	guild2: GuildState;
	players: PlayerState[];
	timeRemainingMs: number;
}

export interface GuildWarBracketMatch {
	guildA: string;
	guildB: string;
	winner: string | null;
	scoreA: number | null;
	scoreB: number | null;
}

export interface GuildWarBracketRound {
	round: number;
	roundName: string;
	matches: GuildWarBracketMatch[];
	byes: string[];
}

export interface GuildWarBracket {
	totalGuilds: number;
	startingRound: number;
	rounds: GuildWarBracketRound[];
	champion: string | null;
	timestamp: number;
}

export interface BroadcastPayload {
	type: 'state';
	timestamp: number;
	instances: BattlegroundState[];
	bracket: GuildWarBracket | null;
}

export interface WelcomePayload {
	type: 'welcome';
	message: string;
	mapDimensions: { width: number; height: number };
	updateIntervalMs: number;
}

export type ServerMessage = BroadcastPayload | WelcomePayload;
