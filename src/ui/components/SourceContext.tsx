/** Shows a passage of the source with the matched part highlighted. */
export function SourceContext({
  text,
  start,
  end,
  radius = 160,
}: {
  text: string;
  start: number;
  end: number;
  radius?: number;
}) {
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  return (
    <p className="rounded-lg border bg-muted/50 p-3 text-sm leading-relaxed whitespace-pre-wrap">
      {from > 0 && '…'}
      {text.slice(from, start)}
      <mark className="rounded-sm bg-primary/25 px-0.5 text-foreground">
        {text.slice(start, end)}
      </mark>
      {text.slice(end, to)}
      {to < text.length && '…'}
    </p>
  );
}
