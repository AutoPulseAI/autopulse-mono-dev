// https://recharts.org/en-US/examples/StackedBarChart
"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';

export default function LeadStatusBar({ data, onBarClick }) {
    const COLORS = ['var(--primary)', 'var(--secondary)', 'var(--primary2)', 'var(--secondary2)', 'var(--primary3)', 'var(--secondary3)'];
    
    const handleClick = (data) => {
        if (onBarClick && data) {
            onBarClick(data);
        }
    };
    
    return (
        <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                {/* <XAxis dataKey="name" interval={0} /> */}
                <XAxis 
                    dataKey="name" 
                    interval={0} 
                    tick={({ x, y, payload }) => {
                        const words = payload.value.split(' '); // split label by spaces
                        return (
                            <text x={x} y={y + 10} textAnchor="middle" fontSize={12}>
                                {words.map((word, index) => (
                                    <tspan key={index} x={x} dy={index === 0 ? 0 : 15}>
                                        {word}
                                    </tspan>
                                ))}
                            </text>
                        );
                    }}
                />
                <YAxis />
                <Tooltip cursor={{ fill: 'rgba(0, 0, 0, 0.1)' }} />
                
                <Bar dataKey="value" name="Status" onClick={handleClick} style={{ cursor: 'pointer' }}>
                    {data.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    );
}
