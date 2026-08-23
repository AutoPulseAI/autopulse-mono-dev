// https://recharts.org/en-US/examples/StackedBarChart
"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const data = [
    { name: 'Jan', value: 400 },
    { name: 'Feb', value: 300 },
    { name: 'Mar', value: 500 },
    { name: 'Apr', value: 700 },
    { name: 'May', value: 600 },
    { name: 'Jun', value: 600 },
    { name: 'Jul', value: 800 },
    { name: 'Aug', value: 850 },
    { name: 'Sup', value: 800 },
    { name: 'Oct', value: 790 },
    { name: 'Nov', value: 750 },
    { name: 'Dec', value: 825 },
];

export default function BarChartProgress() {
    return (
        <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" fill="var(--primary)" />
            </BarChart>
        </ResponsiveContainer>
    );
}
