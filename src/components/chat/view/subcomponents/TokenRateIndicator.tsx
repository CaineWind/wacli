import { GaugeIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { TokenRateSnapshot } from '../../utils/tokenRate';

function formatTokenRate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '--';
  return value < 100 ? value.toFixed(1) : Math.round(value).toString();
}

export default function TokenRateIndicator({ rate }: { rate: TokenRateSnapshot }) {
  const { t } = useTranslation('chat');
  const label = rate.isLive
    ? t('input.tokenRateLive', { defaultValue: 'Estimated output speed, updating live' })
    : t('input.tokenRateLast', { defaultValue: 'Last estimated output speed' });

  return (
    <div
      className="inline-flex h-8 min-w-[5.75rem] items-center justify-center gap-1.5 rounded-lg border border-border/70 bg-background/70 px-2 text-xs text-muted-foreground shadow-sm"
      title={label}
      aria-label={`${label}: ${formatTokenRate(rate.value)} tok/s`}
    >
      <span className="relative grid h-5 w-5 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
        <GaugeIcon className="h-3.5 w-3.5" aria-hidden />
        {rate.isLive && (
          <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
        )}
      </span>
      <span className="whitespace-nowrap font-medium tabular-nums text-foreground">
        {formatTokenRate(rate.value)} <span className="text-muted-foreground/70">tok/s</span>
      </span>
    </div>
  );
}
