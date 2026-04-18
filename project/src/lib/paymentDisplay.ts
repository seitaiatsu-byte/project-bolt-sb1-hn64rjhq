/** 支払方法・決済内容の表示・集計用（UUIDマスター／レガシー文字列の両対応。マスタ入替時は mergeIdNameMaps を使用） */

export type PaymentMethodBucket = 'cash' | 'card' | 'paypay' | 'other';

export function buildIdToNameMap(rows: { id: string; name: string }[] | null | undefined): Record<string, string> {
  const m: Record<string, string> = {};
  for (const r of rows || []) m[r.id] = r.name;
  return m;
}

/** 支払／決済マスタがDB上で入替のとき、UUID→名称をどちらのテーブルからでも解決する */
export function mergeIdNameMaps(
  a: { id: string; name: string }[] | null | undefined,
  b: { id: string; name: string }[] | null | undefined
): Record<string, string> {
  return { ...buildIdToNameMap(a), ...buildIdToNameMap(b) };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function looksLikeUuid(s: string): boolean {
  return UUID_RE.test(s.trim());
}

/** DBの payment_method（マスタUUID or 現金/カード等の文字列）を表示名に */
export function formatPaymentMethodLabel(
  raw: string | null | undefined,
  methodIdToName: Record<string, string>
): string {
  if (raw == null || String(raw).trim() === '') return '-';
  const s = String(raw).trim();
  if (methodIdToName[s]) return methodIdToName[s];
  return s;
}

/** 決済内容: payment_detail_id を優先。未設定のときのみ program_name をレガシー代替として表示 */
export function formatPaymentDetailLabel(
  paymentDetailId: string | null | undefined,
  programNameFallback: string | null | undefined,
  detailIdToName: Record<string, string>
): string {
  if (paymentDetailId && detailIdToName[paymentDetailId]) return detailIdToName[paymentDetailId];
  if (!paymentDetailId) {
    const fb = programNameFallback?.trim();
    if (fb) return fb;
  }
  return '-';
}

export function normalizeForMasterMatch(s: string): string {
  return s.replace(/\u3000/g, ' ').trim().replace(/\s+/g, '').toLowerCase();
}

/** CSV等の自由記述をマスタ行 id に紐付け（見つからなければ null） */
export function matchMasterIdByFreeText(raw: string, rows: { id: string; name: string }[]): string | null {
  const t = normalizeForMasterMatch(raw);
  if (!t) return null;
  for (const r of rows) {
    if (normalizeForMasterMatch(r.name) === t) return r.id;
  }
  for (const r of rows) {
    const rn = normalizeForMasterMatch(r.name);
    if (rn && (t.includes(rn) || rn.includes(t))) return r.id;
  }
  if (t.includes('カード') || t.includes('credit') || t.includes('クレジ')) {
    const hit =
      rows.find((r) => normalizeForMasterMatch(r.name).includes('クレジット')) ||
      rows.find((r) => normalizeForMasterMatch(r.name) === 'カード');
    if (hit) return hit.id;
  }
  if (t.includes('paypay')) {
    const hit = rows.find((r) => normalizeForMasterMatch(r.name).includes('paypay'));
    if (hit) return hit.id;
  }
  return null;
}

/** 支払方法マスタ名から売上集計バケットへ */
export function bucketPaymentMethodByDisplayName(displayName: string): PaymentMethodBucket {
  const n = displayName.trim();
  if (!n) return 'other';
  const lower = n.toLowerCase();
  if (n === '現金' || lower === 'cash') return 'cash';
  if (n.includes('クレジット') || n === 'カード') return 'card';
  if (lower.includes('paypay')) return 'paypay';
  return 'other';
}

/** 生の payment_method 値と id→名マップからバケットへ */
export function bucketStoredPaymentMethod(
  raw: string | null | undefined,
  methodIdToName: Record<string, string>
): PaymentMethodBucket {
  const label = raw == null || String(raw).trim() === '' ? '' : formatPaymentMethodLabel(raw, methodIdToName);
  if (label === '-') return 'other';
  return bucketPaymentMethodByDisplayName(label);
}
