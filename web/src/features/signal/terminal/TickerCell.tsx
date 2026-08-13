interface TickerCellProps {
  value: number | null | undefined;
  /** decimal places */
  dp?: number;
  /** show +/- sign */
  signed?: boolean;
  /** color by sign (up/down); when false renders neutral */
  colorize?: boolean;
  suffix?: string;
  prefix?: string;
}

// Monospaced numeric cell, tabular figures, optional sign-coloring. The atom of
// every price/driver readout in the terminal.
export default function TickerCell({
  value,
  dp = 2,
  signed = false,
  colorize = true,
  suffix = '',
  prefix = '',
}: TickerCellProps) {
  if (value == null || Number.isNaN(value)) {
    return <span className="sig-num sig-flat">—</span>;
  }
  const cls = colorize ? (value > 0 ? 'sig-up' : value < 0 ? 'sig-down' : 'sig-flat') : '';
  const sign = signed && value > 0 ? '+' : '';
  return (
    <span className={`sig-num ${cls}`}>
      {prefix}
      {sign}
      {value.toFixed(dp)}
      {suffix}
    </span>
  );
}
