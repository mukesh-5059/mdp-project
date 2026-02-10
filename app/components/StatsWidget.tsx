import React from 'react';

interface Stat {
  label: string;
  value: number;
  unit?: string;
}

interface StatsWidgetProps {
  stats: Stat[];
}

export const StatsWidget: React.FC<StatsWidgetProps> = ({ stats }) => {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 20,
        right: 20,
        padding: '10px',
        background: 'rgba(0,0,0,0.8)',
        color: 'white',
        fontFamily: 'monospace',
        borderRadius: '8px',
        minWidth: '200px',
      }}
    >
      {stats.map((stat, index) => (
        <div key={index} style={{ marginBottom: index < stats.length - 1 ? '10px' : '0' }}>
          <div>{stat.label}:</div>
          <div>{stat.value.toFixed(4)} {stat.unit || ''}</div>
        </div>
      ))}
    </div>
  );
};
