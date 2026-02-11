import { memo } from 'react';

interface ScoreBoardProps {
  guild1: {
    name: string;
    score: number;
    playerCount: number;
  };
  guild2: {
    name: string;
    score: number;
    playerCount: number;
  };
  roundName: string;
  timeRemainingMs: number;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export const ScoreBoard = memo(function ScoreBoard({
  guild1,
  guild2,
  roundName,
  timeRemainingMs,
}: ScoreBoardProps) {
  return (
    <div className="scoreboard">
      {/* Left Side: Red Team */}
      <div className="team-section red">
        <div className="team-name">{guild2.name}</div>
        <div className="team-score">{guild2.score}</div>
      </div>

      {/* Center: Timer & Round */}
      <div className="center-info">
        <div className="round-name">{roundName}</div>
        <div className="timer">{formatTime(timeRemainingMs)}</div>
      </div>

      {/* Right Side: Blue Team */}
      <div className="team-section blue">
        <div className="team-score">{guild1.score}</div>
        <div className="team-name">{guild1.name}</div>
      </div>
    </div>
  );
});
