import { useEffect, useRef, useState } from 'react';
import type { BattlegroundState, PlayerState } from '../types';

type ActionSeverity = 'score' | 'combat' | 'objective' | 'system';

export interface ActionFeedEntry {
  id: string;
  timestamp: number;
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
      setEntries([]);
      return;
    }

    const now = Date.now();
    const previous = previousInstanceRef.current;
    const nextEntries: ActionFeedEntry[] = [];
    const createEntry = (text: string, severity: ActionSeverity) => {
      sequenceRef.current += 1;
      nextEntries.push({
        id: `${selectedInstance.roundId}-${selectedInstance.timeRemainingMs}-${sequenceRef.current}`,
        timestamp: now,
        text,
        severity,
      });
    };

    if (!previous || previous.roundId !== selectedInstance.roundId) {
      setEntries([
        {
          id: `${selectedInstance.roundId}-round-start`,
          timestamp: now,
          text: `Now tracking ${selectedInstance.roundName}: ${selectedInstance.guild1.name} vs ${selectedInstance.guild2.name}.`,
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
        `${selectedInstance.guild1.name} score ${formatScoreDelta(guild1Delta)} (total ${selectedInstance.guild1.score}).`,
        'score'
      );
    }
    if (guild2Delta > 0) {
      createEntry(
        `${selectedInstance.guild2.name} score ${formatScoreDelta(guild2Delta)} (total ${selectedInstance.guild2.score}).`,
        'score'
      );
    }

    const previousPlayers = buildPlayerLookup(previous.players);
    const currentPlayers = buildPlayerLookup(selectedInstance.players);

    for (const player of selectedInstance.players) {
      const prior = previousPlayers.get(player.id);
      if (!prior) {
        createEntry(`${player.name} enters the battlefield for ${player.team}.`, 'system');
        continue;
      }

      if (!prior.inCombat && player.inCombat) {
        const targetName = player.combatTargetId
          ? currentPlayers.get(player.combatTargetId)?.name ?? 'an opponent'
          : 'an opponent';
        createEntry(`${player.name} engages ${targetName}.`, 'combat');
      }

      if (prior.inCombat && !player.inCombat) {
        createEntry(`${player.name} disengages from combat.`, 'combat');
      }

      if (
        player.inCombat &&
        prior.combatTargetId !== player.combatTargetId &&
        player.combatTargetId !== null
      ) {
        const targetName = currentPlayers.get(player.combatTargetId)?.name ?? 'an opponent';
        createEntry(`${player.name} switches target to ${targetName}.`, 'combat');
      }

      if (!prior.isPendingScore && player.isPendingScore) {
        createEntry(`${player.name} starts channeling at a score objective.`, 'objective');
      }

      if (!prior.isScored && player.isScored) {
        createEntry(`${player.name} secures a scoring objective.`, 'objective');
      }

      if (prior.partySize !== player.partySize) {
        if (player.partySize > prior.partySize) {
          createEntry(`${player.name}'s party grows to ${player.partySize}.`, 'system');
        } else {
          createEntry(`${player.name}'s party shrinks to ${player.partySize}.`, 'system');
        }
      }
    }

    for (const prior of previous.players) {
      if (!currentPlayers.has(prior.id)) {
        createEntry(`${prior.name} leaves the battleground.`, 'system');
      }
    }

    if (nextEntries.length > 0) {
      setEntries(prevEntries => [...nextEntries.reverse(), ...prevEntries].slice(0, maxEntries));
    }

    previousInstanceRef.current = selectedInstance;
  }, [maxEntries, selectedInstance]);

  return entries;
}
