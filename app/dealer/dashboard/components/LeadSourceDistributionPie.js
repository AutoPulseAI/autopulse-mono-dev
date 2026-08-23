"use client";
import { useState, useEffect } from 'react';
import { ResponsiveContainer, PieChart, Pie, Legend, Tooltip, Cell } from 'recharts';

export default function LeadSourceDistributionPie({ data, onSegmentClick }) {
    const COLORS = ['var(--primary)', 'var(--secondary)', 'var(--primary2)', 'var(--secondary2)', 'var(--primary3)', 'var(--secondary3)'];
    
    // Calculate total once for use in tooltip and labels
    const total = data.reduce((sum, item) => sum + (item.value || 0), 0);

    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768); // Mobile breakpoint
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

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

    // Scrollable Legend 
const ScrollableLegend = ({ payload, onSegmentClick }) => {
        return (
            <div
                style={{
                    maxHeight: isMobile ? 'auto' : 300,
                    overflowY: isMobile ? 'visible' : 'auto',
                    paddingRight: 10,
                    display: 'flex',
                    flexDirection: isMobile ? 'row' : 'column',
                    flexWrap: isMobile ? 'wrap' : 'nowrap',
                    gap: 10,
                    justifyContent: isMobile ? 'center' : 'flex-start',
                }}
            >
                {payload.map((entry, index) => (
                    <div
                        key={`legend-${index}`}
                        onClick={() => onSegmentClick(entry.payload)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            cursor: 'pointer',
                            fontSize: 12,
                            userSelect: 'none',
                        }}
                    >
                        <span
                            style={{
                                width: 10,
                                height: 10,
                                backgroundColor: entry.color,
                                display: 'inline-block',
                                marginRight: 4,
                            }}
                        />
                        <span>{entry.value}: {entry.payload.value}</span>
                    </div>
                ))}
            </div>
        );
    };


    return (
        <ResponsiveContainer width="100%" height={isMobile ? 600 : 300}>
            <PieChart>
                <Pie margin={{ top: 20, right: 20, bottom: isMobile ? 80 : 20, left: 20 }}
                    data={data}
                    fill="var(--primary)"
                    dataKey="value"
                    label={<CustomLabel />}
                    outerRadius={isMobile ? 80 : 100}
                    innerRadius={20}
                    paddingAngle={3}
                    onClick={onSegmentClick}
                    style={{ cursor: 'pointer' }}
                >
                    {data.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend
                    layout={isMobile ? "horizontal" : "vertical"}
                    align={isMobile ? "bottom" : "right"}
                    verticalAlign={isMobile ? "bottom" : "middle"}
                    content={
                        <ScrollableLegend onSegmentClick={onSegmentClick} />
                    }
                />
                {/* <Legend
                    layout={isMobile ? "horizontal" : "vertical"}
                    align={isMobile ? "center" : "right"}
                    verticalAlign={isMobile ? "bottom" : "middle"}
                    content={
                        <ScrollableLegend onSegmentClick={onSegmentClick} />
                    }
                /> */}
            </PieChart>
        </ResponsiveContainer>
    );
}
