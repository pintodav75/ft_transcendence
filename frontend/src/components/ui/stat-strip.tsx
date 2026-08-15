import type { ReactNode } from 'react';

/**
 * The figures bar that closes a "dossier" header: a row of big monospaced numbers, each under
 * its small-caps label, with an optional sentence at the end of the row.
 *
 * It knows NOTHING of teams, players or ladders — it is handed strings — so by the repo's
 * rule it belongs in `components/ui` straight away rather than waiting for a second use.
 * It was pulled out of `TeamHero`, whose identity row (logo + team name) is genuinely
 * different from the solo one (avatar + pseudo) and was deliberately left alone.
 */

export type StatItem = {
  /** Also the React key: the labels of one strip are distinct by construction. */
  label: string;
  value: string;
  /** Denominator or unit, printed smaller right after the value ("/ 10", "/ 42"). */
  extra?: string;
};

type StatStripProps = {
  stats: StatItem[];
  /**
   * Trailing sentence, on the same row when it fits. For everything a number cannot say: "not
   * ranked yet", "standings unavailable".
   */
  note?: ReactNode;
};

export function StatStrip({ stats, note }: StatStripProps) {
  return (
    <div className="flex flex-wrap items-center border-t border-border-subtle bg-surface-card">
      <dl className="flex flex-wrap">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="min-w-28 border-r border-border-subtle px-6 py-3.5 last:border-r-0"
          >
            <dt className="text-xs label-caps text-text-muted">{stat.label}</dt>
            <dd className="mt-0.5 font-mono text-xl font-bold tabular-nums text-text-primary">
              {stat.value}
              {stat.extra && (
                <span className="ml-1 text-sm font-normal text-text-muted">{stat.extra}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      {note && <p className="px-6 py-3 text-xs text-text-secondary">{note}</p>}
    </div>
  );
}
