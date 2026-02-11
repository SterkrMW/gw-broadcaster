import { memo, useRef, useEffect, useState } from 'react';
import type { PlayerState } from '../types';
import mapBackground from '../assets/background.jpg';

interface BattleMapProps {
  players: PlayerState[];
  mapWidth: number;
  mapHeight: number;
}

// Colors for teams
const TEAM_COLORS = {
  red: '#a00404ff',
  blue: '#002394ff',
};

const COMBAT_LINE_COLOR = '#fb24fbff';
const DOT_RADIUS = 6;
const NAME_OFFSET_Y = -12;

export const BattleMap = memo(function BattleMap({
  players,
  mapWidth,
  mapHeight,
}: BattleMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const playersRef = useRef<PlayerState[]>(players);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [imageAspectRatio, setImageAspectRatio] = useState<number | null>(null);
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain');

  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  // Preload background image
  useEffect(() => {
    const img = new Image();
    img.src = mapBackground;
    img.onload = () => {
      imageRef.current = img;
      setImageAspectRatio(img.width / img.height);
    };
  }, []);

  // Handle resizing
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: containerWidth, height: containerHeight } = entry.contentRect;

        // Determine target aspect ratio: use Image's if loaded, else fallback to Map's (or 16:10 default)
        let targetAspectRatio = imageAspectRatio ?? (mapWidth > 0 && mapHeight > 0 ? mapWidth / mapHeight : 1.6);
        if (!targetAspectRatio || isNaN(targetAspectRatio)) targetAspectRatio = 1.6;

        // Calculate dimensions based on fitMode
        let width = containerWidth;
        let height = containerHeight;

        if (fitMode === 'contain') {
          // Contain: maximize dimensions without cropping
          width = containerWidth;
          height = width / targetAspectRatio;
          if (height > containerHeight) {
            height = containerHeight;
            width = height * targetAspectRatio;
          }
        } else {
          // Cover: fill container, cropping excess
          width = containerWidth;
          height = width / targetAspectRatio;
          if (height < containerHeight) {
            height = containerHeight;
            width = height * targetAspectRatio;
          }
        }

        setDimensions({ width, height });
      }

    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [mapWidth, mapHeight, imageAspectRatio, fitMode]);

  // Draw the map with animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const render = () => {
      const currentPlayers = playersRef.current;
      const scaleX = mapWidth > 0 ? dimensions.width / mapWidth : 1;
      const scaleY = mapHeight > 0 ? dimensions.height / mapHeight : 1;

      // Clear canvas
      ctx.clearRect(0, 0, dimensions.width, dimensions.height);

      // Draw background
      if (imageRef.current) {
        ctx.drawImage(imageRef.current, 0, 0, dimensions.width, dimensions.height);
      } else {
        // Fallback background
        ctx.fillStyle = '#d4a574';
        ctx.fillRect(0, 0, dimensions.width, dimensions.height);
      }

      // Create a map of player positions for combat lines
      const playerPositions = new Map<number, { x: number; y: number }>();
      for (const player of currentPlayers) {
        playerPositions.set(player.id, {
          x: player.x * scaleX,
          y: player.y * scaleY,
        });
      }

      // Draw combat connection lines first (under the dots)
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = COMBAT_LINE_COLOR;
      ctx.lineWidth = 2;
      for (const player of currentPlayers) {
        if (player.inCombat && player.combatTargetId) {
          const targetPos = playerPositions.get(player.combatTargetId);
          if (targetPos) {
            const playerPos = playerPositions.get(player.id);
            if (playerPos) {
              ctx.beginPath();
              ctx.moveTo(playerPos.x, playerPos.y);
              ctx.lineTo(targetPos.x, targetPos.y);
              ctx.stroke();
            }
          }
        }
      }
      ctx.setLineDash([]);

      // Calculate pulse for scored players (oscillate between 0.3 and 1.0 alpha)
      const time = Date.now();
      const pulseAlpha = 0.3 + 0.7 * (0.5 * (Math.sin(time / 150) + 1));

      // Draw players
      for (const player of currentPlayers) {
        const x = player.x * scaleX;
        const y = player.y * scaleY;
        const color = TEAM_COLORS[player.team];

        // Draw active combat glow/indicator
        if (player.inCombat) {
          ctx.beginPath();
          ctx.arc(x, y, DOT_RADIUS + 4, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
          ctx.fill();
        }

        // Draw score indicator ring (golden ring if pending score)
        if (player.isPendingScore) {
          ctx.beginPath();
          const scoreRadius = player.partySize > 1 ? DOT_RADIUS * 1.5 + 6 : DOT_RADIUS + 6;
          ctx.arc(x, y, scoreRadius, 0, Math.PI * 2);
          ctx.strokeStyle = '#ffd700'; // Gold
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Main dot
        ctx.beginPath();
        // Scale dot based on party size (leaders are bigger)
        const radius = player.partySize > 1 ? DOT_RADIUS * 1.5 : DOT_RADIUS;
        ctx.arc(x, y, radius, 0, Math.PI * 2);

        // Scored players pulse instead of graying out
        if (player.isScored) {
            ctx.globalAlpha = pulseAlpha;
            ctx.fillStyle = color; // Use team color
        } else {
            ctx.globalAlpha = 1.0;
            ctx.fillStyle = color;
        }
        
        ctx.fill();
        ctx.globalAlpha = 1.0; // Reset alpha

        // Stroke for visibility
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Draw party size indicator if > 1
        if (player.partySize > 1) {
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 10px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(player.partySize.toString(), x, y);
        }

        // Draw name
        // Draw name
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px Arial'; // Slightly larger/bolder
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle'; // Ensure consistent vertical alignment
        
        const nameY = y + NAME_OFFSET_Y - (player.partySize > 1 ? 5 : 0);
        
        // Name background for readability
        const textWidth = ctx.measureText(player.name).width;
        const boxPadding = 4;
        const boxHeight = 15;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; // Slightly darker box
        // Center box vertically on nameY
        ctx.fillRect(
            x - textWidth / 2 - boxPadding, 
            nameY - boxHeight / 2, 
            textWidth + boxPadding * 2, 
            boxHeight
        );
        
        ctx.fillStyle = '#fff';
        ctx.fillText(player.name, x, nameY + 1); // +1 minor adjustment for visual center of font
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [dimensions, mapWidth, mapHeight]);

  return (
    <div 
      ref={containerRef} 
      style={{ 
        width: '100%', 
        height: '100%', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        background: 'transparent'
      }}
    >
      <canvas
        ref={canvasRef}
        width={dimensions.width}
        height={dimensions.height}
        style={{ 
          display: 'block',
          // Add drop shadow only in 'contain' mode to separate from background
          boxShadow: fitMode === 'contain' ? '0 0 50px rgba(0,0,0,0.8)' : 'none'
        }}
      />
      
      {/* Fit/Cover Toggle Button */}
      <button
        onClick={() => setFitMode(prev => prev === 'contain' ? 'cover' : 'contain')}
        style={{
          position: 'absolute',
          bottom: '20px',
          right: '20px',
          zIndex: 50,
          background: 'rgba(0,0,0,0.6)',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.3)',
          borderRadius: '4px',
          padding: '8px 12px',
          cursor: 'pointer',
          fontSize: '12px',
          textTransform: 'uppercase',
          backdropFilter: 'blur(4px)'
        }}
      >
        {fitMode === 'contain' ? 'Maximize' : 'Fit Whole Map'}
      </button>
    </div>
  );
});
