import { memo } from 'react';
import type { BattlegroundState } from '../types';

interface InstanceSelectorProps {
  instances: BattlegroundState[];
  selectedRoundId: number | null;
  onSelect: (roundId: number) => void;
}

export const InstanceSelector = memo(function InstanceSelector({
  instances,
  selectedRoundId,
  onSelect,
}: InstanceSelectorProps) {
  if (instances.length === 0) {
    return (
      <div className="instance-selector empty">
        <span>No active Guild Wars</span>
      </div>
    );
  }

  return (
    <div className="instance-selector">
      <label htmlFor="instance-select">Select Match:</label>
      <select
        id="instance-select"
        value={selectedRoundId ?? ''}
        onChange={(e) => onSelect(Number(e.target.value))}
      >
        {instances.map((instance) => (
          <option key={instance.roundId} value={instance.roundId}>
            {instance.roundName}: {instance.guild1.name} vs {instance.guild2.name}
          </option>
        ))}
      </select>
    </div>
  );
});
