import { supabase } from './supabase';
import type { Database } from './database.types';

export type CustomerRow = Database['public']['Tables']['customers']['Row'];

/**
 * PostgREST の max_rows により、要求した range より少ない件数しか返らないことがある。
 * 「返却 < chunk で打ち切る」と max_rows=500・chunk=1000 のとき 500 件で誤終了する。
 * offset は実際の返却件数だけ進め、0 件が返るまで繰り返す（最後の不足ページの次の range が空になる）。
 */
const RANGE_CHUNK = 500;

export async function fetchAllCustomersByCreatedDesc(): Promise<CustomerRow[]> {
  const rows: CustomerRow[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + RANGE_CHUNK - 1);

    if (error) throw error;
    const batch = (data || []) as CustomerRow[];
    if (batch.length === 0) break;
    rows.push(...batch);
    offset += batch.length;
  }

  return rows;
}

/** 自動採番用: customer_number のみ全件（max_rows 対策でページング） */
export async function fetchAllCustomerNumbers(): Promise<string[]> {
  const out: string[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase
      .from('customers')
      .select('customer_number')
      .not('customer_number', 'is', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + RANGE_CHUNK - 1);

    if (error) throw error;
    const batch = data || [];
    if (batch.length === 0) break;
    for (const r of batch) {
      if (r.customer_number != null && r.customer_number !== '') out.push(r.customer_number);
    }
    offset += batch.length;
  }

  return out;
}
