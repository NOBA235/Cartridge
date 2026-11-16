/**
 * One answer: rule chip, decision, exceptions, calculation line, the quote in
 * the rulebook, and a route chip. 'Verified against the source' only when the
 * quote check passed on this device.
 */
import type { Answer } from '@/cartridge/answer';
import type { SourceText } from '@/cartridge/source';
import type { Rule } from '@/cartridge/types';
import { RouteBadge } from '@/ui/components/RouteBadge';
import { SeverityChip } from '@/ui/components/SeverityChip';
import { SourceContext } from '@/ui/components/SourceContext';

const REASON: Record<NonNullable<Answer['reason']>, string> = {
  NO_MATCH: 'The device found no matching rule.',
  LOW_RETRIEVAL: 'No rule is close to this question.',
  VALIDATION_FAILED: 'The device’s choice did not pass the checks.',
  DEVICE_ERROR: 'The on-device model failed.',
  DEVICE_UNAVAILABLE: 'The on-device model is not ready.',
  USER_REQUESTED: 'You asked the cloud.',
};

function Status({ a }: { a: Answer }) {
  if (a.status === 'verified') {
    return (
      <p className="text-sm font-medium text-success">
        Verified against the source{a.page !== undefined && `, page ${a.page}`}
      </p>
    );
  }
  if (a.status === 'queued')
    return <p className="text-sm text-muted-foreground">Waiting for signal.</p>;
  if (a.status === 'unanswered')
    return <p className="text-sm text-muted-foreground">Not answered.</p>;
  if (a.notCovered) return <p className="text-sm text-warning">Not covered by this rulebook.</p>;
  return <p className="text-sm text-warning">Cloud answer, not verified against the source.</p>;
}

export function AnswerCard({
  answer: a,
  rule,
  source,
}: {
  answer: Answer;
  rule?: Rule;
  source?: SourceText;
}) {
  const route = a.route;
  const quoteOk =
    a.quoteCheck?.ok === true && a.quoteCheck.start !== undefined && a.quoteCheck.end !== undefined;
  return (
    <article
      className="flex flex-col gap-3 rounded-xl border bg-card p-5"
      aria-label={`Answer to: ${a.question}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">{a.question}</p>
        <RouteBadge route={route} />
      </header>

      {a.ruleId && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-xs">
            {a.ruleId}
          </span>
          <span className="font-medium">{a.title}</span>
          {rule && <SeverityChip severity={rule.severity} />}
        </div>
      )}

      {a.decision && (
        <div>
          <p className="text-base font-medium">{a.decision}</p>
          {a.wordingFrom === 'cloud' && (
            <p className="text-xs text-muted-foreground">
              Written by the cloud model, not taken from a rule.
            </p>
          )}
        </div>
      )}

      {a.calcLine && (
        <p className="rounded-md bg-muted px-3 py-2 font-mono text-sm">{a.calcLine}</p>
      )}
      {a.calcHint && <p className="text-sm text-muted-foreground">{a.calcHint}</p>}

      {a.exceptions.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase">Exceptions</p>
          <ul className="list-disc pl-5 text-sm">
            {a.exceptions.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <Status a={a} />
      {quoteOk && source && a.quoteCheck?.start !== undefined && a.quoteCheck.end !== undefined && (
        <SourceContext text={source.text} start={a.quoteCheck.start} end={a.quoteCheck.end} />
      )}
      {a.quote && !quoteOk && (
        <blockquote className="border-l-2 pl-3 text-sm text-muted-foreground">
          “{a.quote}”
        </blockquote>
      )}

      {a.reason && a.status !== 'verified' && (
        <p className="text-xs text-muted-foreground">
          {REASON[a.reason]} {a.detail}
        </p>
      )}
      {a.reason && a.status === 'verified' && a.route === 'IN_CLOUD' && (
        <p className="text-xs text-muted-foreground">
          Sent to the cloud because: {REASON[a.reason]}
        </p>
      )}
    </article>
  );
}
