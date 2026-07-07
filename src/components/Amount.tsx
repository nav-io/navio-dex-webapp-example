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
  decimals?: number;
}) {
  const { concealAmounts } = useWallet();
  return (
    <span className={`amount${concealAmounts ? ' concealed' : ''}`} tabIndex={concealAmounts ? 0 : -1}>
      <span className="amount-value">{formatUnits(units, decimals)}</span>
      {suffix ? <span className="amount-suffix">{suffix}</span> : null}
    </span>
  );
}
