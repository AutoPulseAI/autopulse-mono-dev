// https://recharts.org/en-US/examples/StackedBarChart
"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function ActivityOverTimeDataBar({ data, onBarClick }) {
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
                <XAxis
                  dataKey="date"
                  tickFormatter={(str) => {
                    if (!str) return '';
                    try {
                      const parts = str.split('-');
                      // Daily: YYYY-MM-DD -> DD-MM
                      if (parts.length === 3) {
                        const [year, month, day] = parts;
                        if (year && month && day) {
                          return `${day}-${month}`;
                        }
                      }
                      // Monthly: YYYY-MM -> Mon-YY
                      if (parts.length === 2 && /^\d{4}$/.test(parts[0])) {
                        const [year, month] = parts;
                        if (year && month) {
                          const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
                          if (!isNaN(date.getTime())) {
                            return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
                          }
                        }
                      }
                      // Weekly or any other label: show as-is
                      return str;
                    } catch (e) {
                      return str;
                    }
                  }}
                />
                <YAxis label={{ value: 'Total Number of Leads Received', angle: -90, position: 'insideLeft' }} />
                <Tooltip cursor={{ fill: 'rgba(0, 0, 0, 0.1)' }} />
                <Legend />
                <Bar dataKey="count" fill="var(--secondary)" name="Total Number of Leads Received" onClick={handleClick} style={{ cursor: 'pointer' }} />
            </BarChart>
        </ResponsiveContainer>
    );
}
