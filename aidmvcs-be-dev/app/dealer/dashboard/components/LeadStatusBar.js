// https://recharts.org/en-US/examples/StackedBarChart
"use client";
// Each bar takes its status's colour (meaningColors.js). On a phone the bars lie flat: long status names need the width.
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { statusChartColor } from '../../components/meaningColors';
import useIsMobile from '../../components/useIsMobile';
import { statusLabel } from '../../../lib/statusLabels';

const Tick = ({ x, y, payload }) => (
    <text x={x} y={y + 10} textAnchor="middle" fontSize={12}>
        {statusLabel(payload.value || '').split(' ').map((word, i) => <tspan key={i} x={x} dy={i === 0 ? 0 : 15}>{word}</tspan>)}
    </text>
);

export default function LeadStatusBar({ data, onBarClick }) {
    const isMobile = useIsMobile();
    const handleClick = (entry) => { if (onBarClick && entry) onBarClick(entry); };
    const bars = (
        <Bar dataKey="value" name="Leads" onClick={handleClick} style={{ cursor: 'pointer' }} maxBarSize={isMobile ? 22 : 90}>
            {data.map((entry) => <Cell key={entry.name} fill={statusChartColor(entry.name)} />)}
        </Bar>
    );
    const tooltip = <Tooltip cursor={{ fill: 'rgba(0, 0, 0, 0.1)' }} labelFormatter={(v) => statusLabel(v)} />;

    if (isMobile) {
        return (
            <ResponsiveContainer width="100%" height={Math.max(160, data.length * 40 + 40)}>
                <BarChart data={data} layout="vertical" margin={{ left: 0, right: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} fontSize={12} />
                    <YAxis type="category" dataKey="name" width={118} interval={0} fontSize={12} tickFormatter={(v) => statusLabel(v)} />
                    {tooltip}{bars}
                </BarChart>
            </ResponsiveContainer>
        );
    }
    return (
        <ResponsiveContainer width="100%" height={320}>
            <BarChart data={data} margin={{ bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" interval={0} tick={<Tick />} />
                <YAxis allowDecimals={false} />
                {tooltip}{bars}
            </BarChart>
        </ResponsiveContainer>
    );
}
