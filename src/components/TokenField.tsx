/**
 * TokenField: a token-id input with a wallet-aware picker
 * =======================================================
 *
 * Trading forms ask for token ids — 64-hex strings nobody wants to type.
 * This field pairs a free-form input (pasting any id still works) with a
 * small dropdown of what the wallet actually holds, prefilling the input
 * on selection. `NAV` is always offered for the native coin.
 *
 * The input stays a plain named form control, so parent forms keep reading
 * it through FormData like every other field — the component only manages
 * the visible value.
 */
import { useState } from 'react';
import { useWallet } from '../state/WalletContext';
import { shorten } from '../lib/format';

interface TokenFieldProps {
  /** Form-field name, read by the parent via FormData. */
  name: string;
  label: string;
  /** Muted annotation rendered next to the label. */
  hint?: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
  /** Extra class for the wrapping label (e.g. "grow" in row layouts). */
  className?: string;
}

export function TokenField({
  name,
  label,
  hint,
  placeholder = 'token id, or NAV',
  required = false,
  defaultValue = '',
  className,
}: TokenFieldProps) {
  const { balances } = useWallet();
  const [value, setValue] = useState(defaultValue);
  const tokens = balances.filter((b) => b.kind === 'token');

  return (
    <label className={className}>
      {label} {hint && <small>({hint})</small>}
      <input
        name={name}
        className="mono"
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      {/* value pinned to '' so the select acts as a one-shot picker: every
          choice fires onChange, then it snaps back to the placeholder row. */}
      <select
        className="token-pick"
        value=""
        aria-label={`Prefill ${label} from wallet`}
        onChange={(e) => {
          if (e.target.value) setValue(e.target.value === 'NAV' ? 'NAV' : e.target.value);
        }}
      >
        <option value="" disabled>
          choose from wallet…
        </option>
        <option value="NAV">NAV (native coin)</option>
        {tokens.map((t) => (
          <option key={t.tokenId} value={t.tokenId}>
            {shorten(t.tokenId, 10, 6)} — balance {t.balance.toLocaleString()}
          </option>
        ))}
      </select>
    </label>
  );
}
