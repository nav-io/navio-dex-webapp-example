/**
 * <Amount> — the "confidential chip"
 * ==================================
 *
 * Navio amounts are confidential on-chain (Pedersen commitments + range
 * proofs); only the wallet can decrypt its own values. The UI mirrors
 * that idea: with the privacy screen on (eye toggle in the top bar),
 * amounts render blurred and reveal on hover/focus. Useful when screen
 * sharing — and a small, honest reminder of what BLSCT actually does.
 */
import { useWallet } from '../state/WalletContext';
import { formatUnits } from '../lib/format';

export function Amount({
  units,
  suffix,
  decimals = 8,
}: {
  units: bigint;
  suffix?: string;
  /**
   * How many decimal places the ASSET has — 8 for NAV, 0 for tokens.
   * Token amounts are plain integers of base units: with decimals=0 the
   * value renders as-is, NOT divided by 1e8. (An earlier version always
   * divided by COIN and only trimmed the fraction, which displayed every
   * token balance under 10^8 units as "0".)
   */
  decimals?: number;
}) {
  const { concealAmounts } = useWallet();
  const text = decimals === 0 ? units.toLocaleString('en-US') : formatUnits(units, decimals);
  return (
    <span className={`amount${concealAmounts ? ' concealed' : ''}`} tabIndex={concealAmounts ? 0 : -1}>
      <span className="amount-value">{text}</span>
      {suffix ? <span className="amount-suffix">{suffix}</span> : null}
    </span>
  );
}
