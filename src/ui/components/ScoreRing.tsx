/**
 * A large ring for the test pass rate. Its colour moves from red (0%) through
 * amber to green (100%). Colour and length change with a short CSS transition,
 * which the reduced-motion rule in index.css turns off.
 */
export function ScoreRing({
  passed,
  total,
  caption,
  size = 176,
}: {
  passed: number;
  total: number;
  caption: string;
  size?: number;
}) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const fraction = total > 0 ? passed / total : 0;
  const hue = Math.round(fraction * 140);
  const color = total > 0 ? `hsl(${hue} 72% 52%)` : 'var(--muted-foreground)';
  return (
    <figure
      className="flex flex-col items-center gap-2"
      aria-label={`${caption}: ${passed} of ${total} passed`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 200ms ease-out, stroke 200ms ease-out' }}
        />
        <text
          x="50%"
          y="47%"
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-foreground text-3xl font-semibold"
        >
          {total > 0 ? `${Math.round(fraction * 100)}%` : '–'}
        </text>
        <text
          x="50%"
          y="64%"
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-muted-foreground text-xs"
        >
          {passed} of {total}
        </text>
      </svg>
      <figcaption className="text-sm text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}
