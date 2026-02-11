import React from 'react';

interface Stat {
  label: string;
  value: number;
  unit?: string;
  // Optional formatting: 'fixed' (toFixed), 'exponential' (toExponential), 'auto' (toPrecision)
  format?: 'fixed' | 'exponential' | 'auto';
  // Number of digits for formatting (decimal places for fixed/exponential, significant digits for auto)
  precision?: number;
}

interface StatsWidgetProps {
  stats: Stat[];
}

export const StatsWidget: React.FC<StatsWidgetProps> = ({ stats }) => {
  const formatValue = (stat: Stat) => {
    const p = stat.precision !== undefined ? stat.precision : 4; // Default precision to 4

    switch (stat.format) {
      case 'exponential':
        return stat.value.toExponential(p);
      case 'fixed':
        return stat.value.toFixed(p);
      case 'auto':
      default: // Default to auto (toPrecision) if format is not specified or unrecognized
        return stat.value.toPrecision(p);
    }
  };

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
          <div>{formatValue(stat)} {stat.unit || ''}</div>
        </div>
      ))}
    </div>
  );
};
