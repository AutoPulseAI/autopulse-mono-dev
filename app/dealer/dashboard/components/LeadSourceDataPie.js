// https://recharts.org/en-US/examples/StackedBarChart
"use client";
import { useMemo } from 'react';
import { ResponsiveContainer, PieChart, Pie, Legend, Tooltip, Cell } from 'recharts';

const CHART_COLORS = [
  '#0272b4',
  '#e67e22',
  '#27ae60',
  '#8e44ad',
  '#e74c3c',
  '#16a085',
  '#f39c12',
  '#2980b9',
  '#c0392b',
  '#1abc9c',
  '#9b59b6',
  '#d35400',
  '#2c3e50',
  '#3498db',
  '#e91e63',
  '#00bcd4',
];

const OTHER_COLOR = '#95a5a6';
const MIN_SLICE_PERCENT = 2;
const MIN_LABEL_PERCENT = 5;

function preparePieData(data) {
  if (!data?.length) return [];
  const total = data.reduce((sum, item) => sum + (item.value || 0), 0);
  if (total <= 0) return [];

  const sorted = [...data].sort((a, b) => (b.value || 0) - (a.value || 0));
  const major = [];
  let otherValue = 0;

  sorted.forEach((item) => {
    const pct = ((item.value || 0) / total) * 100;
    if (pct >= MIN_SLICE_PERCENT) major.push(item);
    else otherValue += item.value || 0;
  });

  if (otherValue > 0) {
    major.push({ name: 'Other', value: otherValue, isOther: true });
  }
  return major;
}

export default function LeadSourceDataPie({ data, onSegmentClick }) {
    const chartData = useMemo(() => preparePieData(data), [data]);
    const total = useMemo(
      () => chartData.reduce((sum, item) => sum + (item.value || 0), 0),
      [chartData]
    );

    const getColor = (entry, index) =>
      entry?.isOther ? OTHER_COLOR : CHART_COLORS[index % CHART_COLORS.length];
    
    const CustomTooltip = ({ active, payload }) => {
        if (active && payload && payload.length) {
            const itemData = payload[0].payload;
            const calculatedPercent = total > 0 ? ((itemData.value || 0) / total) * 100 : 0;
            const displayPercent = (itemData.percent && !isNaN(itemData.percent)) ? itemData.percent * 100 : calculatedPercent;
            
            return (
                <div className="bg-white p-3 border rounded shadow-sm">
                    <p className="mb-1"><strong>{itemData.name}</strong></p>
                    <p className="mb-0 text-muted">
                        {itemData.value} leads ({displayPercent.toFixed(1)}%)
                    </p>
                    {!itemData.isOther && (
                      <small className="text-primary">Click to filter leads</small>
                    )}
                </div>
            );
        }
        return null;
    };

    const CustomLabel = ({ cx, cy, midAngle, outerRadius, percent, payload }) => {
        const itemValue = payload?.value || 0;
        const calculatedPercent = total > 0 ? (itemValue / total) * 100 : 0;
        const displayPercent = (percent && !isNaN(percent)) ? percent * 100 : calculatedPercent;
        
        if (displayPercent < MIN_LABEL_PERCENT) return null;
        
        const RADIAN = Math.PI / 180;
        const radius = outerRadius + 20;
        const x = cx + radius * Math.cos(-midAngle * RADIAN);
        const y = cy + radius * Math.sin(-midAngle * RADIAN);

        return (
            <text 
                x={x} 
                y={y} 
                fill="#333" 
                textAnchor={x > cx ? 'start' : 'end'} 
                dominantBaseline="central"
                fontSize={11}
                fontWeight="500"
            >
                {`${payload?.name || ''}: ${displayPercent.toFixed(0)}%`}
            </text>
        );
    };

    if (!chartData.length) return null;

    return (
        <ResponsiveContainer width="100%" height={300}>
            <PieChart>
                <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="name"
                    label={<CustomLabel />}
                    labelLine={false}
                    outerRadius={90}
                    innerRadius={30}
                    paddingAngle={2}
                    onClick={(entry) => {
                      if (!entry?.isOther) onSegmentClick?.(entry);
                    }}
                    style={{ cursor: 'pointer' }}
                >
                    {chartData.map((entry, index) => (
                        <Cell key={`cell-${entry.name}-${index}`} fill={getColor(entry, index)} />
                    ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend 
                    verticalAlign="bottom" 
                    height={36}
                    formatter={(value, entry) => (
                        <span style={{ color: entry.color }}>
                            {value}
                        </span>
                    )}
                />
            </PieChart>
        </ResponsiveContainer>
    );
}
