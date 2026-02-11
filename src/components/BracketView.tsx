import {
	Bracket,
	Seed,
	SeedItem,
	SeedTeam,
	type IRenderSeedProps,
	type IRoundProps,
	type ISingleEliminationProps,
} from 'react-brackets';
import { memo, useCallback, useMemo } from 'react';
import type { GuildWarBracket, GuildWarBracketMatch } from '../types';

interface BracketViewProps {
	bracket: GuildWarBracket;
}

function BracketSeed({ seed, breakpoint }: IRenderSeedProps) {
	const match = (seed.match as GuildWarBracketMatch | null | undefined) ?? null;
	const isTbd = Boolean(seed.isTbd);
	const isCompleted = Boolean(match && match.winner !== null);
	const aIsWinner = Boolean(match && isCompleted && match.winner === match.guildA);
	const bIsWinner = Boolean(match && isCompleted && match.winner === match.guildB);

	return (
		<Seed className="bracket-seed" mobileBreakpoint={breakpoint}>
			<SeedItem className="bracket-seed-item">
				<div className="bracket-match">
					<div className={`bracket-slot ${aIsWinner ? 'winner' : ''} ${isCompleted && !aIsWinner ? 'loser' : ''} ${isTbd ? 'tbd' : ''}`}>
						<SeedTeam className="bracket-guild-name">{seed.teams[0]?.name ?? 'TBD'}</SeedTeam>
						{match?.scoreA != null && <span className="bracket-score">{match.scoreA}</span>}
					</div>
					<div className={`bracket-slot ${bIsWinner ? 'winner' : ''} ${isCompleted && !bIsWinner ? 'loser' : ''} ${isTbd ? 'tbd' : ''}`}>
						<SeedTeam className="bracket-guild-name">{seed.teams[1]?.name ?? 'TBD'}</SeedTeam>
						{match?.scoreB != null && <span className="bracket-score">{match.scoreB}</span>}
					</div>
				</div>
			</SeedItem>
		</Seed>
	);
}

function buildRounds(bracket: GuildWarBracket): IRoundProps[] {
	const rounds: IRoundProps[] = [];

	for (let roundNumber = bracket.startingRound; roundNumber <= 4; roundNumber++) {
		const roundData = bracket.rounds.find(rd => rd.round === roundNumber);
		const expectedMatches = Math.pow(2, 4 - roundNumber);
		const roundName = roundData?.roundName ?? getRoundName(roundNumber);
		const seeds = Array.from({ length: expectedMatches }, (_, index) => {
			const match = roundData?.matches[index] ?? null;
			return {
				id: `${roundNumber}-${index}`,
				teams: [
					{ name: match?.guildA ?? 'TBD' },
					{ name: match?.guildB ?? 'TBD' },
				],
				match,
				isTbd: match === null,
			};
		});

		rounds.push({ title: roundName, seeds });
	}

	return rounds;
}

function BracketViewComponent({ bracket }: BracketViewProps) {
	const { rounds, champion } = bracket;
	const bracketRounds = useMemo(() => buildRounds(bracket), [bracket]);
	const roundTitleComponent = useCallback<NonNullable<ISingleEliminationProps['roundTitleComponent']>>(
		(title) => <div className="bracket-round-label">{title}</div>,
		[]
	);

	return (
		<div className="bracket-container">
			{champion && (
				<div className="bracket-champion">
					<span className="champion-icon">👑</span>
					<span className="champion-name">{champion}</span>
				</div>
			)}
			<Bracket
				rounds={bracketRounds}
				bracketClassName="bracket-tree"
				roundClassName="bracket-column"
				mobileBreakpoint={0}
				renderSeedComponent={BracketSeed}
				roundTitleComponent={roundTitleComponent}
			/>

			{rounds.some(round => round.byes.length > 0) && (
				<div className="bracket-byes">
					{rounds.filter(round => round.byes.length > 0).map(round => (
						<div key={round.round} className="bracket-bye-group">
							<span className="bracket-bye-label">Bye ({round.roundName}):</span>
							{round.byes.map(name => (
								<span key={name} className="bracket-bye-name">{name}</span>
							))}
						</div>
					))}
				</div>
			)}
		</div>
	);
}

export const BracketView = memo(BracketViewComponent);

function getRoundName(round: number): string {
	switch (round) {
		case 1:
			return 'Round 1';
		case 2:
			return 'Round 2';
		case 3:
			return 'Semi-Finals';
		case 4:
			return 'Finals';
		default:
			return `Round ${round}`;
	}
}
