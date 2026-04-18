import { useState, useEffect, useMemo, useCallback } from 'react';
import { Download, Image as ImageIcon, Trash2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import CustomerSearchPanel from './CustomerSearchPanel';
import { getCustomerBirthDate, calculateAge } from '../lib/customerBirthday';
import { fetchBusinessRules } from '../lib/businessRules';
import {
  filterQualifyingVisits,
  firstQualifyingVisitDate,
  qualifyingVisitRepeatCount,
} from '../lib/repeatMetrics';
import { formatPaymentDetailLabel, formatPaymentMethodLabel, mergeIdNameMaps } from '../lib/paymentDisplay';

type Customer = Database['public']['Tables']['customers']['Row'];
type VisitRow = Database['public']['Tables']['visit_records']['Row'];
type ProductRow = Database['public']['Tables']['product_sales']['Row'];
type SubRow = Database['public']['Tables']['subscription_records']['Row'];

type TimelineItem = {
  id: string;
  kind: 'visit' | 'product' | 'subscription';
  date: string;
  label: string;
  sublabel: string;
  amount: number;
};

type MediaEntry = {
  visitId: string;
  visitDate: string;
  url: string;
};

export default function IndividualChart() {
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [paymentMethodNames, setPaymentMethodNames] = useState<Record<string, string>>({});
  const [paymentDetailNames, setPaymentDetailNames] = useState<Record<string, string>>({});
  const [excludeKeywords, setExcludeKeywords] = useState<string[]>([]);

  useEffect(() => {
    fetchBusinessRules().then((r) => setExcludeKeywords(r.excludeKeywords));
  }, []);

  const loadCustomerData = useCallback(async () => {
    if (!selectedCustomer) return;
    const [{ data: v }, { data: p }, { data: s }, { data: pm }, { data: pd }] = await Promise.all([
      supabase.from('visit_records').select('*').eq('customer_id', selectedCustomer.id).order('visit_date', { ascending: false }),
      supabase.from('product_sales').select('*').eq('customer_id', selectedCustomer.id).order('sale_date', { ascending: false }),
      supabase.from('subscription_records').select('*').eq('customer_id', selectedCustomer.id).order('start_date', { ascending: false }),
      supabase.from('payment_method_master').select('id, name'),
      supabase.from('payment_detail_master').select('id, name'),
    ]);
    setVisits(v || []);
    setProducts(p || []);
    setSubs(s || []);
    const merged = mergeIdNameMaps(pm as { id: string; name: string }[], pd as { id: string; name: string }[]);
    setPaymentMethodNames(merged);
    setPaymentDetailNames(merged);
  }, [selectedCustomer]);

  useEffect(() => {
    void loadCustomerData();
  }, [loadCustomerData]);

  useEffect(() => {
    const onRecordsUpdated = () => {
      void loadCustomerData();
    };
    window.addEventListener('records-updated', onRecordsUpdated);
    return () => window.removeEventListener('records-updated', onRecordsUpdated);
  }, [loadCustomerData]);

  const totalLtv = useMemo(() => {
    const vt = visits.reduce((a, v) => a + Number(v.amount || 0), 0);
    const pt = products.reduce((a, p) => a + Number(p.amount || 0), 0);
    const st = subs.reduce((a, s) => a + Number(s.amount || 0), 0);
    return vt + pt + st;
  }, [visits, products, subs]);

  const timeline: TimelineItem[] = useMemo(() => {
    const rows: TimelineItem[] = [];
    visits.forEach((v) => {
      const pm = formatPaymentMethodLabel(v.payment_method, paymentMethodNames);
      const pd = formatPaymentDetailLabel(v.payment_detail_id, v.program_name, paymentDetailNames);
      rows.push({
        id: `v-${v.id}`,
        kind: 'visit',
        date: v.visit_date,
        label: '来院',
        sublabel: [v.menu_name, pd !== '-' ? pd : null, pm !== '-' ? pm : null].filter(Boolean).join(' / '),
        amount: Number(v.amount || 0),
      });
    });
    products.forEach((p) => {
      const pm = formatPaymentMethodLabel(p.payment_method, paymentMethodNames);
      rows.push({
        id: `p-${p.id}`,
        kind: 'product',
        date: p.sale_date,
        label: '物販',
        sublabel: `${p.product_name || '商品'} ×${p.quantity} / ${pm}`,
        amount: Number(p.amount || 0),
      });
    });
    subs.forEach((s) => {
      const pm = formatPaymentMethodLabel(s.payment_method, paymentMethodNames);
      rows.push({
        id: `s-${s.id}`,
        kind: 'subscription',
        date: s.start_date,
        label: 'サブスク',
        sublabel: `${s.subscription_name || 'プラン'} / ${pm}`,
        amount: Number(s.amount || 0),
      });
    });
    rows.sort((a, b) => b.date.localeCompare(a.date));
    return rows;
  }, [visits, products, subs, paymentMethodNames, paymentDetailNames]);

  const productSummary = useMemo(() => {
    const lineCount = products.length;
    const qtyTotal = products.reduce((s, p) => s + Number(p.quantity || 0), 0);
    const amountTotal = products.reduce((s, p) => s + Number(p.amount || 0), 0);
    return { lineCount, qtyTotal, amountTotal };
  }, [products]);

  const subscriptionSummary = useMemo(() => {
    const count = subs.length;
    const amountTotal = subs.reduce((s, x) => s + Number(x.amount || 0), 0);
    return { count, amountTotal };
  }, [subs]);

  const maintenanceSummary = useMemo(
    () => visits.reduce((s, v) => s + Number(v.maintenance_cost || 0), 0),
    [visits]
  );

  const allMediaEntries = useMemo<MediaEntry[]>(() => {
    const entries: MediaEntry[] = [];
    visits.forEach((v) => {
      (v.media_urls || []).forEach((u) => {
        entries.push({
          visitId: v.id,
          visitDate: v.visit_date,
          url: u,
        });
      });
    });
    return entries.sort((a, b) => b.visitDate.localeCompare(a.visitDate));
  }, [visits]);

  const removeMediaUrl = async (visitId: string, targetUrl: string) => {
    if (!window.confirm('この画像を削除してもよろしいですか？')) return;
    const row = visits.find((v) => v.id === visitId);
    if (!row) return;
    const nextUrls = (row.media_urls || []).filter((u) => u !== targetUrl);
    const { error } = await supabase.from('visit_records').update({ media_urls: nextUrls }).eq('id', visitId);
    if (error) {
      alert('画像削除に失敗しました');
      return;
    }
    setVisits((prev) => prev.map((v) => (v.id === visitId ? { ...v, media_urls: nextUrls } : v)));
  };

  const downloadMedia = async (url: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement('a');
      const filename = url.split('/').pop() || 'media';
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      window.open(url, '_blank');
    }
  };

  const visitLite = useMemo(
    () => visits.map((v) => ({ visit_date: v.visit_date, menu_name: v.menu_name })),
    [visits]
  );

  const firstQDate = firstQualifyingVisitDate(visitLite, excludeKeywords);
  const repeatVisitCount = qualifyingVisitRepeatCount(visitLite, excludeKeywords);
  const firstDayProductCount = useMemo(() => {
    if (!firstQDate) return 0;
    const day = firstQDate.slice(0, 10);
    return products.filter((p) => p.sale_date.slice(0, 10) === day).length;
  }, [firstQDate, products]);

  const qualifyingCount = filterQualifyingVisits(visitLite, excludeKeywords).length;

  const birth = selectedCustomer ? getCustomerBirthDate(selectedCustomer) : null;
  const age = calculateAge(birth);

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">個人カルテ</h2>

      {!selectedCustomer ? (
        <CustomerSearchPanel
          accent="blue"
          selectedCustomer={null}
          onSelect={(c) => setSelectedCustomer(c)}
          onClearSelection={() => {}}
        />
      ) : (
        <div>
          <div className="flex justify-end mb-2">
            <button
              type="button"
              onClick={() => setSelectedCustomer(null)}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl font-bold border bg-white text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <X size={18} />
              別の顧客
            </button>
          </div>

          <div className="bg-gradient-to-r from-blue-50 to-cyan-50 border-2 border-blue-200 rounded-xl p-6 mb-6 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs text-gray-600 font-bold">顧客番号</div>
                <div className="text-xl font-bold text-gray-900">{selectedCustomer.customer_number}</div>
                <div className="text-2xl font-bold text-gray-900 mt-1">{selectedCustomer.name}</div>
                <div className="text-gray-600">{selectedCustomer.name_kana}</div>
              </div>
              <div className="text-right text-sm">
                <div className="font-bold text-pink-700">総LTV</div>
                <div className="text-3xl font-bold text-pink-900">¥{Math.round(totalLtv).toLocaleString()}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <div className="text-xs text-gray-600 font-bold">性別</div>
                <div className="font-bold">{selectedCustomer.gender || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-600 font-bold">年齢</div>
                <div className="font-bold">{age != null ? `${age}歳` : '-'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-600 font-bold">生年月日</div>
                <div className="font-bold">
                  {birth ? new Date(birth).toLocaleDateString('ja-JP') : '-'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-600 font-bold">電話</div>
                <div className="font-bold">{selectedCustomer.phone_number || '-'}</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-gray-600 font-bold">住所</div>
                <div className="font-bold">
                  {[selectedCustomer.prefecture, selectedCustomer.city, selectedCustomer.town].filter(Boolean).join(' ') || '-'}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-gray-600 font-bold">流入経路</div>
                <div className="font-bold">
                  {[selectedCustomer.referral_source, selectedCustomer.referral_source_2].filter(Boolean).join(' / ') || '-'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-600 font-bold">主訴1</div>
                <div className="font-bold">{selectedCustomer.chief_complaint_1 || selectedCustomer.chief_complaint || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-600 font-bold">主訴2</div>
                <div className="font-bold">{selectedCustomer.chief_complaint_2 || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-600 font-bold">主訴3</div>
                <div className="font-bold">{selectedCustomer.chief_complaint_3 || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-600 font-bold">ポイント</div>
                <div className="font-bold text-blue-600">{selectedCustomer.points ?? 0} pt</div>
              </div>
            </div>

            <div className="bg-white/80 rounded-lg p-4 border border-blue-200">
              <div className="text-sm font-bold text-gray-800 mb-2">リピート・来院（設定連動）</div>
              <ul className="text-sm text-gray-700 space-y-1 list-disc list-inside">
                <li>対象来院: {qualifyingCount}回</li>
                <li>リピート回数: {repeatVisitCount}回</li>
                <li>初診日: {firstQDate ? new Date(firstQDate).toLocaleDateString('ja-JP') : '—'}</li>
                <li>初診当日物販: {firstDayProductCount}件</li>
              </ul>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold text-gray-700 mb-3 underline decoration-blue-200">全履歴タイムライン</h3>
            <div className="border-2 border-gray-100 rounded-xl overflow-hidden max-h-[400px] overflow-y-auto bg-gray-50/30">
              {timeline.length === 0 ? (
                <div className="p-8 text-center text-gray-400">履歴がありません</div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {timeline.map((row) => (
                    <li key={row.id} className="px-4 py-3 hover:bg-white transition-colors">
                      <div className="flex flex-wrap justify-between gap-2">
                        <div>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            row.kind === 'visit' ? 'bg-blue-100 text-blue-700' : 
                            row.kind === 'product' ? 'bg-orange-100 text-orange-700' : 'bg-purple-100 text-purple-700'
                          }`}>
                            {row.label}
                          </span>
                          <span className="ml-2 font-bold text-gray-800">
                            {new Date(row.date).toLocaleDateString('ja-JP')}
                          </span>
                          <div className="text-xs text-gray-500 mt-1">{row.sublabel}</div>
                        </div>
                        <div className="font-bold text-gray-900">¥{Math.round(row.amount).toLocaleString()}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* 来院画像一覧（あつさん指示：日付付きで上下に並べる） */}
          <div className="mt-8">
            <h3 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
              <ImageIcon size={18} className="text-blue-500" /> 
              来院画像一覧（日付順）
            </h3>
            {allMediaEntries.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-gray-200 p-10 text-center text-sm text-gray-400">
                画像はまだありません
              </div>
            ) : (
              <div className="flex flex-col gap-10">
                {allMediaEntries.map((m) => (
                  <div key={`${m.visitId}-${m.url}`} className="space-y-3">
                    {/* 日付ラベル */}
                    <div className="flex items-center gap-2">
                      <span className="bg-slate-800 text-white px-4 py-1 rounded-full text-xs font-bold shadow-sm">
                        📅 {new Date(m.visitDate).toLocaleDateString('ja-JP')} 来院画像
                      </span>
                    </div>
                    
                    {/* 画像本体：大きく表示 */}
                    <div className="group relative rounded-2xl border-4 border-white shadow-xl bg-black overflow-hidden">
                      <img 
                        src={m.url} 
                        alt="visit-media" 
                        className="w-full h-auto block mx-auto hover:opacity-95 transition-opacity" 
                      />
                      
                      {/* 操作ボタン */}
                      <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 p-2 rounded-xl backdrop-blur-sm">
                        <button
                          type="button"
                          onClick={() => window.open(m.url, '_blank')}
                          className="p-2 text-white hover:bg-white/20 rounded-lg"
                          title="全画面"
                        >
                          <ImageIcon size={20} />
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadMedia(m.url)}
                          className="p-2 text-blue-300 hover:bg-white/20 rounded-lg"
                          title="ダウンロード"
                        >
                          <Download size={20} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeMediaUrl(m.visitId, m.url)}
                          className="p-2 text-red-400 hover:bg-white/20 rounded-lg"
                          title="削除"
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-3 pt-6 border-t border-gray-100">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-[10px] font-bold text-amber-600">維持費用 合計</div>
              <div className="text-2xl font-bold text-amber-900">¥{Math.round(maintenanceSummary).toLocaleString()}</div>
            </div>
            <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
              <div className="text-[10px] font-bold text-orange-600">物販集計</div>
              <div className="text-xl font-bold text-orange-900 mt-1">¥{Math.round(productSummary.amountTotal).toLocaleString()}</div>
              <div className="text-[10px] text-orange-700 mt-1">{productSummary.qtyTotal}個 / {productSummary.lineCount}件</div>
            </div>
            <div className="rounded-xl border border-purple-200 bg-purple-50 p-4">
              <div className="text-[10px] font-bold text-purple-600">サブスク集計</div>
              <div className="text-xl font-bold text-purple-900 mt-1">¥{Math.round(subscriptionSummary.amountTotal).toLocaleString()}</div>
              <div className="text-[10px] text-purple-700 mt-1">{subscriptionSummary.count}件</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}