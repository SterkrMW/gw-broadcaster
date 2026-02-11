import { useEffect, useRef, useState } from 'react';
import type { BattlegroundState, PlayerState } from '../types';

type ActionSeverity = 'score' | 'combat' | 'system';

export interface ActionFeedEntry {
  id: string;
  text: string;
  severity: ActionSeverity;
}

interface UseActionFeedOptions {
  maxEntries?: number;
}

function buildPlayerLookup(players: PlayerState[]): Map<number, PlayerState> {
  return new Map(players.map(player => [player.id, player]));
}

function formatScoreDelta(delta: number): string {
  return delta > 1 ? `+${delta} points` : '+1 point';
}

function getTeamStatueName(team: PlayerState['team']): string {
  return team === 'red' ? 'Red Statue' : 'Blue Statue';
}

interface Engagement {
  playerAId: number;
  playerBId: number;
  playerAName: string;
  playerBName: string;
}

function buildEngagements(players: PlayerState[]): Map<string, Engagement> {
  const playerLookup = buildPlayerLookup(players);
  const engagements = new Map<string, Engagement>();

  for (const player of players) {
    if (!player.inCombat || player.combatTargetId === null) continue;
    const target = playerLookup.get(player.combatTargetId);
    if (!target) continue;

    const [playerAId, playerBId] = player.id < target.id ? [player.id, target.id] : [target.id, player.id];
    const key = `${playerAId}-${playerBId}`;
    if (engagements.has(key)) continue;

    const playerA = playerLookup.get(playerAId);
    const playerB = playerLookup.get(playerBId);
    if (!playerA || !playerB) continue;

    engagements.set(key, {
      playerAId,
      playerBId,
      playerAName: playerA.name,
      playerBName: playerB.name,
    });
  }

  return engagements;
}

function inferEngagementResult(
  engagement: Engagement,
  currentPlayers: Map<number, PlayerState>
): { winner: string; loser: string } | null {
  const playerA = currentPlayers.get(engagement.playerAId);
  const playerB = currentPlayers.get(engagement.playerBId);

  if (!playerA && playerB) {
    return { winner: engagement.playerBName, loser: engagement.playerAName };
  }
  if (!playerB && playerA) {
    return { winner: engagement.playerAName, loser: engagement.playerBName };
  }
  if (!playerA || !playerB) return null;

  if (playerA.inCombat && !playerB.inCombat) {
    return { winner: engagement.playerAName, loser: engagement.playerBName };
  }
  if (playerB.inCombat && !playerA.inCombat) {
    return { winner: engagement.playerBName, loser: engagement.playerAName };
  }

  return null;
}

export function useActionFeed(
  selectedInstance: BattlegroundState | undefined,
  options: UseActionFeedOptions = {}
) {
  const maxEntries = options.maxEntries ?? 24;
  const [entries, setEntries] = useState<ActionFeedEntry[]>([]);
  const previousInstanceRef = useRef<BattlegroundState | null>(null);
  const sequenceRef = useRef(0);

  useEffect(() => {
    if (!selectedInstance) {
      previousInstanceRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntries([]);
      return;
    }

    const previous = previousInstanceRef.current;
    const nextEntries: ActionFeedEntry[] = [];
    const createEntry = (text: string, severity: ActionSeverity) => {
      sequenceRef.current += 1;
      nextEntries.push({
        id: `${selectedInstance.roundId}-${selectedInstance.timeRemainingMs}-${sequenceRef.current}`,
        text,
        severity,
      });
    };

    if (!previous || previous.roundId !== selectedInstance.roundId) {
      setEntries([
        {
          id: `${selectedInstance.roundId}-round-start`,
          text: `${selectedInstance.roundName}: ${selectedInstance.guild1.name} vs ${selectedInstance.guild2.name}`,
          severity: 'system',
        },
      ]);
      previousInstanceRef.current = selectedInstance;
      return;
    }

    const guild1Delta = selectedInstance.guild1.score - previous.guild1.score;
    const guild2Delta = selectedInstance.guild2.score - previous.guild2.score;
    if (guild1Delta > 0) {
      createEntry(
        `${selectedInstance.guild1.name} score ${formatScoreDelta(guild1Delta)} (total ${selectedInstance.guild1.score})`,
        'score'
      );
    }
    if (guild2Delta > 0) {
      createEntry(
        `${selectedInstance.guild2.name} score ${formatScoreDelta(guild2Delta)} (total ${selectedInstance.guild2.score})`,
        'score'
      );
    }

    const previousPlayers = buildPlayerLookup(previous.players);
    const currentPlayers = buildPlayerLookup(selectedInstance.players);
    const previousEngagements = buildEngagements(previous.players);
    const currentEngagements = buildEngagements(selectedInstance.players);

    for (const player of selectedInstance.players) {
      const prior = previousPlayers.get(player.id);
      if (!prior) continue;

      if (!prior.isPendingScore && player.isPendingScore) {
        createEntry(`${player.name} is scoring the flag`, 'score');
      }

      if (!prior.isScored && player.isScored) {
        createEntry(`${player.name} is returning to ${getTeamStatueName(player.team)}`, 'score');
      }
    }

    for (const [engagementKey, engagement] of currentEngagements) {
      if (!previousEngagements.has(engagementKey)) {
        createEntry(`${engagement.playerAName} engages ${engagement.playerBName}`, 'combat');
      }
    }

    for (const [engagementKey, engagement] of previousEngagements) {
      if (currentEngagements.has(engagementKey)) continue;
      const result = inferEngagementResult(engagement, currentPlayers);
      if (!result) continue;
      createEntry(`${result.winner} defeats ${result.loser}`, 'combat');
    }

    if (nextEntries.length > 0) {
      setEntries(prevEntries => [...nextEntries.reverse(), ...prevEntries].slice(0, maxEntries));
    }

    previousInstanceRef.current = selectedInstance;
  }, [maxEntries, selectedInstance]);

  return entries;
}
