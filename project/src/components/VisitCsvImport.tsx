import { useRef, useState } from 'react';
import { Upload, Download, CheckCircle, AlertCircle, FileText } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { matchMasterIdByFreeText } from '../lib/paymentDisplay';

type VisitInsert = Database['public']['Tables']['visit_records']['Insert'];
type CustomerRow = Database['public']['Tables']['customers']['Row'];

type ImportResult = {
  success: number;
  error: number;
  messages: string[];
};

const kawanishiClinic = '川西あつ整体院';
const takatsukiClinic = '高槻あつ整体院';

const normalizeHeader = (v: string) => v.trim().toLowerCase().replace(/\s+/g, '');
const toDigits = (v: string) => v.replace(/\D/g, '');

const parseDate = (raw: string): string | null => {
  const t = raw.trim();
  if (!t) return null;
  const normalized = t.replace(/\./g, '/').replace(/-/g, '/');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const parseAmount = (raw: string): number | null => {
  const n = Number(raw.replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return null;
  return n;
};

const pickClinicByCustomerNumber = (customerNumberDigits: string): string | null => {
  const num = Number(customerNumberDigits);
  if (!Number.isFinite(num)) return null;
  if (num <= 4999) return kawanishiClinic;
  return takatsukiClinic;
};

const parseCSV = (text: string): string[][] => {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return [];
  return lines.map((line) => {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else current += ch;
    }
    values.push(current.trim());
    return values;
  });
};

export default function VisitCsvImport() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  const downloadTemplate = () => {
    const csv = [
      '日付,顧客番号,氏名,売上金額,支払方法,決済内容,プログラム,メニュー,通院count,実質BE回数,メモ,回数券count,他記載事項,経過メ1,経過メ2,経過メ3',
      '2026/04/01,2470,山田太郎,6500,クレジットカード,事前精算,,プログラムall-in-one,15,12,首肩の違和感あり,13/16,4/1からサブスク開始,首可動域改善,肩の張り残る,次回骨盤調整',
      '2026/04/03,5001,鈴木花子,8000,現金,当日精算,,都度,5,4,,2/10,次回ストレッチ指導,腰痛改善,座位で再発気味,',
    ].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '来院履歴インポートテンプレート.csv';
    a.click();
  };

  const buildMemo = (
    baseMemo: string,
    m1: string,
    m2: string,
    m3: string,
    other: string,
    visitCount: string,
    realBeCount: string
  ) => {
    const parts: string[] = [];
    if (baseMemo.trim()) parts.push(`メモ: ${baseMemo.trim()}`);
    if (m1.trim()) parts.push(`経過メ1: ${m1.trim()}`);
    if (m2.trim()) parts.push(`経過メ2: ${m2.trim()}`);
    if (m3.trim()) parts.push(`経過メ3: ${m3.trim()}`);
    if (other.trim()) parts.push(`他記載事項: ${other.trim()}`);
    if (visitCount.trim()) parts.push(`通院count(元CSV): ${visitCount.trim()}`);
    if (realBeCount.trim()) parts.push(`実質BE回数(元CSV): ${realBeCount.trim()}`);
    return parts.join('\n') || null;
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setProgressText('CSVを読み込み中...');
    setResult(null);

    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length < 2) {
        setResult({ success: 0, error: 0, messages: ['CSVにデータ行がありません'] });
        setImporting(false);
        return;
      }

      const headers = rows[0].map((h) => normalizeHeader(h));
      const findIndex = (...names: string[]) => headers.findIndex((h) => names.includes(h));

      const idxCustomerNumber = findIndex('顧客番号', 'customer_number', 'customerid', '顧客id');
      const idxDate = findIndex('日付', '来院日', 'visit_date', 'date');
      const idxAmount = findIndex('売上金額', '売上', 'amount', '金額');
      const idxName = findIndex('氏名', '名前', 'name');
      const idxPaymentMethod = findIndex('決済方法', '支払方法', 'payment_method');
      const idxPaymentDetail = findIndex('決済内容', 'payment_detail', '精算区分');
      const idxProgram = findIndex('プログラム', 'program_name', 'プログラム名');
      const idxLegacyDetail = idxPaymentDetail === -1 ? findIndex('内容', 'content') : -1;
      const idxMenu = findIndex('メニュー', 'menu', 'menu_name');
      const idxVisitCount = findIndex('通院count', '通院回数', 'visit_count');
      const idxRealBeCount = findIndex('実質be回数', '実質ｂｅ回数', 'be_count');
      const idxMemo = findIndex('メモ', 'memo', 'notes');
      const idxTicketCount = findIndex('回数券count', '回数券', 'ticket_count');
      const idxM1 = findIndex('経過メ1', '経過メ１', 'memo1');
      const idxM2 = findIndex('経過メ2', '経過メ２', 'memo2');
      const idxM3 = findIndex('経過メ3', '経過メ３', 'memo3');
      const idxOther = findIndex('他記載事項', '備考', 'other', 'memo');

      if (idxCustomerNumber === -1 || idxDate === -1 || idxAmount === -1) {
        setResult({
          success: 0,
          error: 0,
          messages: ['必須列不足: 「顧客番号」「日付」「売上金額」を含めてください'],
        });
        setImporting(false);
        return;
      }

      const dataRows = rows.slice(1);
      setProgressText('既存顧客と紐付け中...');
      const { data: customers, error: customerError } = await supabase
        .from('customers')
        .select('id, customer_number');
      if (customerError) throw customerError;

      const customerMap = new Map<string, CustomerRow>();
      (customers || []).forEach((c) => {
        const num = toDigits(c.customer_number || '');
        if (num) customerMap.set(num, c as CustomerRow);
      });

      setProgressText('支払・決済マスタを読み込み中...');
      let [{ data: methodRows }, { data: detailRows }] = await Promise.all([
        supabase.from('payment_detail_master').select('id,name').eq('is_active', true).order('display_order'),
        supabase.from('payment_method_master').select('id,name').eq('is_active', true).order('display_order'),
      ]);
      if (!methodRows?.length) {
        const r = await supabase.from('payment_detail_master').select('id,name').order('display_order');
        methodRows = r.data;
      }
      if (!detailRows?.length) {
        const r = await supabase.from('payment_method_master').select('id,name').order('display_order');
        detailRows = r.data;
      }
      const methods = methodRows || [];
      const details = detailRows || [];

      const insertRows: VisitInsert[] = [];
      const messages: string[] = [];
      let errorCount = 0;

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const line = i + 2;
        const number = toDigits(row[idxCustomerNumber] || '');
        const visitDate = parseDate(row[idxDate] || '');
        const amount = parseAmount(row[idxAmount] || '');

        if (!number) {
          errorCount++;
          messages.push(`行${line}: 顧客番号が空です`);
          continue;
        }
        if (!visitDate) {
          errorCount++;
          messages.push(`行${line}: 日付形式が不正です`);
          continue;
        }
        if (amount == null) {
          errorCount++;
          messages.push(`行${line}: 売上金額が不正です`);
          continue;
        }

        const customer = customerMap.get(number);
        if (!customer) {
          errorCount++;
          messages.push(`行${line}: 顧客番号 ${number} が見つかりません`);
          continue;
        }

        if (idxName !== -1) {
          const csvName = (row[idxName] || '').trim();
          // 氏名は参照情報として受け取り、顧客番号紐付けを優先する
          if (csvName && customer.name && csvName !== customer.name) {
            messages.push(`行${line}: 氏名不一致（CSV: ${csvName} / DB: ${customer.name}）だが顧客番号優先で取込`);
          }
        }

        const ticketRaw = idxTicketCount !== -1 ? (row[idxTicketCount] || '').trim() : '';
        const ticketCountParsed = ticketRaw.includes('/') ? Number(ticketRaw.split('/')[0].replace(/\D/g, '')) : Number(ticketRaw.replace(/\D/g, ''));
        const pointsUsed = Number.isFinite(ticketCountParsed) ? ticketCountParsed : 0;

        const memo = buildMemo(
          idxMemo !== -1 ? row[idxMemo] || '' : '',
          idxM1 !== -1 ? row[idxM1] || '' : '',
          idxM2 !== -1 ? row[idxM2] || '' : '',
          idxM3 !== -1 ? row[idxM3] || '' : '',
          idxOther !== -1 ? row[idxOther] || '' : '',
          idxVisitCount !== -1 ? row[idxVisitCount] || '' : '',
          idxRealBeCount !== -1 ? row[idxRealBeCount] || '' : ''
        );

        const rawMethod = idxPaymentMethod !== -1 ? (row[idxPaymentMethod] || '').trim() : '';
        const detailCol = idxPaymentDetail !== -1 ? idxPaymentDetail : idxLegacyDetail;
        const rawDetail = detailCol !== -1 ? (row[detailCol] || '').trim() : '';
        const methodId = rawMethod ? matchMasterIdByFreeText(rawMethod, methods) : null;
        const detailId = rawDetail ? matchMasterIdByFreeText(rawDetail, details) : null;
        const programCell = idxProgram !== -1 ? (row[idxProgram] || '').trim() : '';

        insertRows.push({
          customer_id: customer.id,
          visit_date: visitDate,
          amount,
          payment_method: (methodId || rawMethod || null) as string | null,
          payment_detail_id: detailId,
          program_name: programCell || null,
          menu_name: idxMenu !== -1 ? (row[idxMenu] || '').trim() || null : null,
          points_used: pointsUsed,
          memo,
          clinic_name: pickClinicByCustomerNumber(number),
        });
      }

      if (insertRows.length === 0) {
        setResult({ success: 0, error: errorCount, messages: messages.slice(0, 100) });
        setImporting(false);
        return;
      }

      const chunkSize = 200;
      let success = 0;
      for (let start = 0; start < insertRows.length; start += chunkSize) {
        const chunk = insertRows.slice(start, start + chunkSize);
        setProgressText(`取り込み中... ${Math.min(start + chunk.length, insertRows.length)} / ${insertRows.length}`);
        const { error } = await supabase.from('visit_records').insert(chunk);
        if (error) {
          errorCount += chunk.length;
          messages.push(`バッチ ${start + 1}-${start + chunk.length} でエラー: ${error.message}`);
        } else {
          success += chunk.length;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      setResult({
        success,
        error: errorCount,
        messages: messages.slice(0, 200),
      });

      if (success > 0) {
        window.dispatchEvent(new Event('records-updated'));
      }
      setProgressText('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setResult({ success: 0, error: 1, messages: [`取り込み失敗: ${msg}`] });
      setProgressText('');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-xl p-6">
      <div className="flex items-center gap-3 mb-6">
        <Upload className="text-blue-600" size={30} />
        <h2 className="text-2xl font-bold text-gray-800">CSV来院データ・インポート</h2>
      </div>

      <div className="mb-5 bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <FileText className="text-blue-600 mt-1" size={20} />
          <div className="text-sm text-blue-800 space-y-1">
            <div className="font-bold">必須列: 日付 / 顧客番号 / 売上金額</div>
            <div>
              対応列: 氏名 / 支払方法 / 決済内容（列名が無い場合のみ「内容」） / プログラム / メニュー / 通院count / 実質BE回数 /
              メモ / 回数券count / 他記載事項 / 経過メ1〜3
            </div>
            <div>通院count・実質BE回数は記録参照用としてメモへ保存します（回数はカルテ側で自動計算）。</div>
            <div>院は 顧客番号 4999以下=川西 / 5000以上=高槻 で自動振り分けします。</div>
          </div>
        </div>
      </div>

      <div className="flex gap-3 mb-4">
        <button
          type="button"
          onClick={downloadTemplate}
          className="flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white font-bold shadow"
        >
          <Download size={18} />
          テンプレート
        </button>
        <label className="flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-bold shadow cursor-pointer">
          <Upload size={18} />
          CSVファイルを選択
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt"
            onChange={handleUpload}
            className="hidden"
            disabled={importing}
          />
        </label>
      </div>

      {importing && (
        <div className="mb-4 bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
          <div className="font-bold text-blue-800">{progressText || '取り込み中...'}</div>
          <div className="text-xs text-blue-600 mt-1">800件以上でも非同期で処理します</div>
        </div>
      )}

      {result && (
        <div className={`rounded-xl border-2 p-4 ${result.error > 0 ? 'bg-orange-50 border-orange-200' : 'bg-green-50 border-green-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            {result.error > 0 ? <AlertCircle className="text-orange-600" size={20} /> : <CheckCircle className="text-green-600" size={20} />}
            <div className="font-bold text-gray-800">取り込み完了</div>
          </div>
          <div className="text-sm text-gray-700">
            <span className="font-bold text-green-700">{result.success}件の取り込みに成功しました</span>
            {result.error > 0 && <span className="ml-3 text-orange-700">エラー/スキップ: {result.error}件</span>}
          </div>
          {result.messages.length > 0 && (
            <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border bg-white p-2 text-xs text-gray-700 space-y-1">
              {result.messages.map((m, i) => (
                <div key={`${m}-${i}`}>{m}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
