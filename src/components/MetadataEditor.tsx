/**
 * MetadataEditor — key/value pairs for token & NFT metadata
 * =========================================================
 *
 * Navio asset metadata is an arbitrary string→string map
 * (`TokenMetadata` in navio-sdk). For a *collection* the metadata is one
 * of the two inputs — together with the max supply — that DERIVE the
 * collection's token id (`calcCollectionTokenHashHex`), so it is fixed at
 * creation. For an *NFT mint* the metadata is the per-piece attributes.
 *
 * This is a controlled component: the parent owns the rows so it can read
 * them on submit. Empty keys are dropped by `toMetadata()`.
 */
import { Dispatch, SetStateAction } from 'react';

export interface MetaRow {
  key: string;
  value: string;
}

export const emptyRows = (seed: MetaRow[] = [{ key: 'name', value: '' }]): MetaRow[] => seed;

/** Collapse rows into the map navio-sdk expects, ignoring blank keys. */
export function toMetadata(rows: MetaRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, value } of rows) {
    const k = key.trim();
    if (k) out[k] = value;
  }
  return out;
}

export function MetadataEditor({
  rows,
  setRows,
  label = 'Metadata',
}: {
  rows: MetaRow[];
  setRows: Dispatch<SetStateAction<MetaRow[]>>;
  label?: string;
}) {
  const update = (i: number, patch: Partial<MetaRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));
  const add = () => setRows((prev) => [...prev, { key: '', value: '' }]);

  return (
    <div className="meta-editor">
      <div className="meta-editor-head">
        <span>{label}</span>
        <button type="button" className="ghost" onClick={add}>+ field</button>
      </div>
      {rows.length === 0 ? (
        <p className="hint">No metadata. Add a field, or leave empty.</p>
      ) : (
        rows.map((row, i) => (
          <div className="meta-row" key={i}>
            <input
              aria-label="Metadata key"
              placeholder="key (e.g. name)"
              value={row.key}
              onChange={(e) => update(i, { key: e.target.value })}
            />
            <input
              aria-label="Metadata value"
              placeholder="value"
              value={row.value}
              onChange={(e) => update(i, { value: e.target.value })}
            />
            <button type="button" className="ghost danger" onClick={() => remove(i)} aria-label="Remove field">
              ×
            </button>
          </div>
        ))
      )}
    </div>
  );
}
