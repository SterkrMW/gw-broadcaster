import { useMemo, useState } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useActionFeed } from './hooks/useActionFeed';
import { BattleMap } from './components/BattleMap';
import { ScoreBoard } from './components/ScoreBoard';
import { InstanceSelector } from './components/InstanceSelector';
import { BracketView } from './components/BracketView';
import { ActionFeed } from './components/ActionFeed';
import type { BattlegroundState } from './types';
import './App.css';

// Configuration - in production, load from environment
const WS_URL = (() => {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;

  const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const hostname = window.location.hostname;
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

  // Local dev convenience: connect directly to backend default port.
  if (isLocalHost) {
    return `${wsProtocol}://${hostname}:8081`;
  }

  // Production-safe fallback: route through reverse proxy path.
  return `${wsProtocol}://${window.location.host}/ws`;
})();
const EMPTY_INSTANCES: BattlegroundState[] = [];



function App() {
  const { isConnected, lastState, welcome, error } = useWebSocket({
    url: WS_URL,
  });

  const [selectedRoundId, setSelectedRoundId] = useState<number | null>(null);
  const instances = lastState?.instances ?? EMPTY_INSTANCES;

  // Derive effective round ID: use selection, or default to first instance
  const effectiveRoundId = useMemo(
    () => selectedRoundId ?? instances[0]?.roundId ?? null,
    [selectedRoundId, instances]
  );

  // Get selected instance
  const selectedInstance = useMemo(
    () => instances.find((i) => i.roundId === effectiveRoundId),
    [instances, effectiveRoundId]
  );
  const isLiveView = Boolean(selectedInstance);
  const actionFeedEntries = useActionFeed(selectedInstance, { maxEntries: 16 });

  // Map dimensions from server
  const mapWidth = welcome?.mapDimensions.width ?? 4800;
  const mapHeight = welcome?.mapDimensions.height ?? 3000;

  return (
    <>
      <div className="bg-container" />
      <div className="bg-overlay" />
      <div className={`app ${isLiveView ? 'live-mode' : 'bracket-mode'}`}>
      {isLiveView && (
        <header className="app-header">
          <div className="header-left">
            <h1>⚔️ Guild War Live</h1>
            <div className="connection-status">
              <span className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`} />
              {isConnected ? 'Connected' : 'Disconnected'}
            </div>
          </div>
          <div className="header-right">
            <InstanceSelector
              instances={instances}
              selectedRoundId={selectedRoundId}
              onSelect={setSelectedRoundId}
            />
          </div>
        </header>
      )}

      {error && (
        <div className="error-banner">{error}</div>
      )}

      <main className={`main-content ${isLiveView ? 'live-content' : 'bracket-content'}`}>
        {selectedInstance ? (
          <>
            <div className="battle-view">
              <ScoreBoard
                guild1={selectedInstance.guild1}
                guild2={selectedInstance.guild2}
                roundName={selectedInstance.roundName}
                timeRemainingMs={selectedInstance.timeRemainingMs}
              />
              <div className="map-container">
                <BattleMap
                  players={selectedInstance.players}
                  mapWidth={mapWidth}
                  mapHeight={mapHeight}
                />
              </div>
              <ActionFeed entries={actionFeedEntries} />
            </div>
          </>
        ) : lastState?.bracket ? (
          <BracketView bracket={lastState.bracket} />
        ) : (
          <div className="no-battles">
            <div className="no-battles-icon">🏰</div>
            <h2>No Active Battles</h2>
            <p>Waiting for Guild War to begin...</p>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>Guild War Broadcast • Updated every 2 seconds</p>
      </footer>
    </div>
    </>
  );
}

export default App;
