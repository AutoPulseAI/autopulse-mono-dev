// https://recharts.org/en-US/examples/StackedBarChart
"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function UserDistributionBar({ data, onBarClick }) {
    console.log(data);
    
    const handleClick = (data) => {
        if (onBarClick && data) {
            onBarClick(data);
        }
    };
    
    return (
        <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" interval={0} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" fill="var(--primary)" name="Count" onClick={handleClick} style={{ cursor: 'pointer' }} />
            </BarChart>
        </ResponsiveContainer>
    );
}
