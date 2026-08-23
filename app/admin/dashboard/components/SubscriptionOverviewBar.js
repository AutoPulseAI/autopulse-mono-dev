// https://recharts.org/en-US/examples/StackedBarChart
"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function SubscriptionOverviewBar({ data, onBarClick }) {
    console.log(data);
    
    const handleVendorClick = (data) => {
        if (onBarClick && data) {
            onBarClick(data, 'vendors');
        }
    };
    
    const handleDealerClick = (data) => {
        if (onBarClick && data) {
            onBarClick(data, 'dealers');
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
                <Bar dataKey="vendors" fill="var(--primary)" name="Agencys" onClick={handleVendorClick} style={{ cursor: 'pointer' }} />
                <Bar dataKey="dealers" fill="var(--secondary)" name="Dealers" onClick={handleDealerClick} style={{ cursor: 'pointer' }} />
            </BarChart>
        </ResponsiveContainer>
    );
}
