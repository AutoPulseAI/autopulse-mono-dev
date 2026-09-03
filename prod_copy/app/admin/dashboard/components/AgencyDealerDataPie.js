// https://recharts.org/en-US/examples/StackedBarChart
"use client";
import { ResponsiveContainer, PieChart, Pie, Legend, Tooltip, Cell } from 'recharts';

export default function AgencyDealerDataPie({ data, onPieClick }) {
    const COLORS = ['var(--primary)', 'var(--primary2)', 'var(--primary3)', '#FF8042', '#8884D8'];
    
    // Calculate total at component level
    const total = data?.reduce((sum, item) => sum + (item.value || 0), 0) || 0;
    
    const handleClick = (data) => {
        if (onPieClick && data) {
            onPieClick(data);
        }
    };

    const CustomTooltip = ({ active, payload }) => {
        if (active && payload && payload.length) {
            const itemData = payload[0];
            const value = itemData.value || 0;
            const calculatedPercent = total > 0 ? (value / total) * 100 : 0;
            const displayPercent = calculatedPercent.toFixed(0);
            
            return (
                <div className="bg-white p-2 border rounded shadow-sm">
                    <p className="mb-0"><strong>{itemData.name}</strong></p>
                    <p className="mb-0">Count: {value}</p>
                    <p className="mb-0">Percentage: {displayPercent}%</p>
                </div>
            );
        }
        return null;
    };

    const CustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, name, value }) => {
        // Calculate percentage manually if percent is not available
        const calculatedPercent = total > 0 ? ((value || 0) / total) * 100 : 0;
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
                {`${name}: ${displayPercent.toFixed(0)}%`}
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
                    outerRadius={90}
                    label={CustomLabel}
                    labelLine={false}
                    onClick={handleClick}
                    style={{ cursor: 'pointer' }}
                >
                    {data.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
            </PieChart>
        </ResponsiveContainer>
    );
}


