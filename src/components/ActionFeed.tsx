import { memo } from 'react';
import type { ActionFeedEntry } from '../hooks/useActionFeed';

interface ActionFeedProps {
  entries: ActionFeedEntry[];
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
              <span className="action-feed-text">{entry.text}</span>
            </div>
          ))
        )}
      </div>
    </aside>
  );
});
