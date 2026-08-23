// https://recharts.org/en-US/examples/StackedBarChart
"use client";
import { ResponsiveContainer, PieChart, Pie, Legend, Tooltip, Cell } from 'recharts';

export default function LeadSourceDataPie({ data, onSegmentClick }) {
    const COLORS = ['var(--primary)', 'var(--secondary)', 'var(--primary2)', 'var(--secondary2)', 'var(--primary3)', 'var(--secondary3)'];
    
    // Calculate total once for use in tooltip and labels
    const total = data.reduce((sum, item) => sum + (item.value || 0), 0);

    const CustomTooltip = ({ active, payload }) => {
        if (active && payload && payload.length) {
            const itemData = payload[0].payload;
            // Calculate percentage manually
            const calculatedPercent = total > 0 ? ((itemData.value || 0) / total) * 100 : 0;
            const displayPercent = (itemData.percent && !isNaN(itemData.percent)) ? itemData.percent * 100 : calculatedPercent;
            
            return (
                <div className="bg-white p-3 border rounded shadow-sm">
                    <p className="mb-1"><strong>{itemData.name}</strong></p>
                    <p className="mb-0 text-muted">
                        {itemData.value} leads ({displayPercent.toFixed(1)}%)
                    </p>
                    <small className="text-primary">Click to filter leads</small>
                </div>
            );
        }
        return null;
    };

    const CustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, payload }) => {
        // Calculate percentage manually if percent is not available
        const itemValue = payload?.value || 0;
        const calculatedPercent = total > 0 ? (itemValue / total) * 100 : 0;
        const displayPercent = (percent && !isNaN(percent)) ? percent * 100 : calculatedPercent;
        
        // Hide labels for slices less than 3% to prevent overlap
        if (displayPercent < 3) return null;
        
        const RADIAN = Math.PI / 180;
        // Position labels outside the pie chart
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

    return (
        <ResponsiveContainer width="100%" height={300}>
            <PieChart>
                <Pie
                    data={data}
                    fill="var(--primary)"
                    dataKey="value"
                    label={<CustomLabel />}
                    labelLine={false}
                    outerRadius={90}
                    innerRadius={30}
                    paddingAngle={2}
                    onClick={onSegmentClick}
                    style={{ cursor: 'pointer' }}
                >
                    {data.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
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


