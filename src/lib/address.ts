/**
 * BLSCT address helpers
 * =====================
 *
 * Navio BLSCT addresses are a DoublePublicKey (view key + spend key, 96
 * bytes) encoded with `bech32_mod` — a Bech32m variant with an 8-character
 * checksum sized for the 154-character payload (standard bech32 checksums
 * only protect ~90 characters).
 *
 * Why the re-encode helper exists
 * -------------------------------
 * navio-blsct ≤ 1.1.15 derives regtest addresses with the HRP `rnav`, but
 * the daemon's blsctregtest chainparams expect `rnv` — so the daemon
 * rejects addresses the binding produces. This is fixed upstream
 * (navio-core `blsct::bech32_hrp::Regtest`), but until a binding release
 * ships the fix we transpose the payload to the correct HRP ourselves.
 * The payload (the actual keys) is untouched; only the human-readable
 * prefix and the checksum change.
 *
 * The polymod constants below are a direct port of navio-core
 * `src/blsct/bech32_mod.cpp`. Mainnet/testnet addresses are unaffected.
 */

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32M_MOD_CONST = 0x2bc830a3n;

function polymod(values: number[]): bigint {
  let c = 1n;
  for (const v of values) {
    const c0 = Number(c >> 35n);
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(v);
    if (c0 & 1) c ^= 0xf0732dc147n;
    if (c0 & 2) c ^= 0xa8b6dfa68en;
    if (c0 & 4) c ^= 0x193fabc83cn;
    if (c0 & 8) c ^= 0x322fd3b451n;
    if (c0 & 16) c ^= 0x640f37688bn;
  }
  return c;
}

function expandHrp(hrp: string): number[] {
  const out: number[] = [];
  for (const ch of hrp) out.push(ch.charCodeAt(0) >> 5);
  out.push(0);
  for (const ch of hrp) out.push(ch.charCodeAt(0) & 0x1f);
  return out;
}

/** Re-encode a bech32_mod BLSCT address under a different HRP. */
export function reencodeBlsctAddress(address: string, newHrp: string): string {
  const sep = address.lastIndexOf('1');
  const dataPart = address.slice(sep + 1);
  // The last 8 characters are the checksum; everything before is payload.
  const values = [...dataPart.slice(0, -8)].map((ch) => CHARSET.indexOf(ch));
  if (values.some((v) => v < 0)) {
    throw new Error(`Invalid bech32 payload in address: ${address.slice(0, 16)}…`);
  }
  const enc = [...expandHrp(newHrp), ...values, 0, 0, 0, 0, 0, 0, 0, 0];
  const mod = polymod(enc) ^ BECH32M_MOD_CONST;
  let out = `${newHrp}1${values.map((v) => CHARSET[v]).join('')}`;
  for (let i = 0; i < 8; i++) {
    out += CHARSET[Number((mod >> BigInt(5 * (7 - i))) & 31n)];
  }
  return out;
}

/**
 * Fix a regtest address produced by navio-blsct ≤ 1.1.15 so the local
 * daemon accepts it. A no-op for mainnet/testnet addresses and for future
 * binding versions that already emit `rnv`.
 */
export function normalizeRegtestAddress(address: string): string {
  return address.startsWith('rnav1') ? reencodeBlsctAddress(address, 'rnv') : address;
}
