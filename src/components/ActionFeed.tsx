import { memo } from 'react';
import type { ActionFeedEntry } from '../hooks/useActionFeed';

interface ActionFeedProps {
  entries: ActionFeedEntry[];
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour12: false,
    minute: '2-digit',
    second: '2-digit',
  });
}

export const ActionFeed = memo(function ActionFeed({ entries }: ActionFeedProps) {
  return (
    <aside className="action-feed" aria-label="Live action feed">
      <div className="action-feed-header">Live Action Feed</div>
      <div className="action-feed-list">
        {entries.length === 0 ? (
          <div className="action-feed-empty">Waiting for live actions...</div>
        ) : (
          entries.map(entry => (
            <div key={entry.id} className={`action-feed-item ${entry.severity}`}>
              <span className="action-feed-time">{formatTimestamp(entry.timestamp)}</span>
              <span className="action-feed-text">{entry.text}</span>
            </div>
          ))
        )}
      </div>
    </aside>
  );
});
