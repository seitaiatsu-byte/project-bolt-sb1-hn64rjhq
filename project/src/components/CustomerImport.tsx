import { useState, useRef, useEffect } from 'react';
import { Upload, Download, CheckCircle, AlertCircle, FileText, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { fetchAllCustomersByCreatedDesc } from '../lib/fetchAllCustomers';

type Customer = Database['public']['Tables']['customers']['Row'];

const LIST_ROWS_PER_PAGE = 200;

export default function CustomerImport() {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ success: number; error: number; messages: string[] } | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listPage, setListPage] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadCustomers();
    const reload = () => {
      loadCustomers();
    };
    window.addEventListener('customers-updated', reload);
    return () => window.removeEventListener('customers-updated', reload);
  }, []);

  useEffect(() => {
    const max = Math.max(1, Math.ceil(customers.length / LIST_ROWS_PER_PAGE));
    setListPage((p) => (p > max ? max : p));
  }, [customers.length]);

  const loadCustomers = async () => {
    setLoadingList(true);
    try {
      const rows = await fetchAllCustomersByCreatedDesc();
      setCustomers(rows as Customer[]);
      setListPage(1);
    } catch (error) {
      console.error('顧客リスト読み込みエラー:', error);
    } finally {
      setLoadingList(false);
    }
  };

  const totalListPages = Math.max(1, Math.ceil(customers.length / LIST_ROWS_PER_PAGE));
  const effectiveListPage = Math.min(listPage, totalListPages);
  const listPageStart = (effectiveListPage - 1) * LIST_ROWS_PER_PAGE;
  const displayedCustomers = customers.slice(listPageStart, listPageStart + LIST_ROWS_PER_PAGE);
  const listRangeEnd = customers.length === 0 ? 0 : Math.min(listPageStart + displayedCustomers.length, customers.length);

  const downloadTemplate = () => {
    const csv = 'customer_number,name,name_kana,gender,birth_date,phone_number,referral_source,prefecture,city,town,chief_complaint_1,chief_complaint_2,chief_complaint_3,email,memo\n1001,田中太郎,たなかたろう,男性,1980/01/01,09012345678,ホームページ,大阪府,高槻市,芥川町,腰痛,肩こり,,tanaka@example.com,\n5001,山田花子,やまだはなこ,女性,1990/05/15,08098765432,紹介,兵庫県,川西市,栄町,首の痛み,頭痛,姿勢改善,yamada@example.com,';
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = '顧客名簿インポートテンプレート.csv';
    link.click();
  };

  const parseCSV = (text: string): string[][] => {
    const lines = text.split(/\r?\n/).filter(line => line.trim());

    const firstLine = lines[0] || '';
    const hasTab = firstLine.includes('\t');
    const delimiter = hasTab ? '\t' : ',';

    return lines.map(line => {
      if (delimiter === '\t') {
        return line.split('\t').map(v => v.trim());
      }

      const values: string[] = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());
      return values;
    });
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setResult(null);

    try {
      const text = await file.text();
      const rows = parseCSV(text);

      if (rows.length === 0) {
        setResult({ success: 0, error: 0, messages: ['ファイルが空です'] });
        setImporting(false);
        return;
      }

      const headers = rows[0].map(h => h.toLowerCase().trim());
      const dataRows = rows.slice(1);

      const customerNumberIndex = headers.findIndex(h => h === 'customer_number' || h === '顧客番号');
      const nameIndex = headers.findIndex(h => h === 'name' || h === '氏名' || h === '名前');
      const kanaIndex = headers.findIndex(h => h === 'name_kana' || h === 'かな' || h === 'ふりがな' || h === 'カナ' || h === 'フリガナ');
      const genderIndex = headers.findIndex(h => h === 'gender' || h === '性別');
      const birthDateIndex = headers.findIndex(h => h === 'birth_date' || h === '生年月日' || h === '誕生日');
      const phoneIndex = headers.findIndex(h => h === 'phone' || h === 'phone_number' || h === '電話番号' || h === 'tel');
      const referralIndex = headers.findIndex(h => h === 'referral_source' || h === '流入経路' || h === '流入のメイン');
      const referral2Index = headers.findIndex(h => h === 'referral_source_2' || h === '流入経路2' || h === '流入のサブ');
      const prefectureIndex = headers.findIndex(h => h === 'prefecture' || h === '府県');
      const cityIndex = headers.findIndex(h => h === 'city' || h === '市' || h === '市・郡');
      const townIndex = headers.findIndex(h => h === 'town' || h === '町');
      const complaint1Index = headers.findIndex(h => h === 'chief_complaint_1' || h === '主訴1' || h === '主訴１');
      const complaint2Index = headers.findIndex(h => h === 'chief_complaint_2' || h === '主訴2' || h === '主訴２');
      const complaint3Index = headers.findIndex(h => h === 'chief_complaint_3' || h === '主訴3' || h === '主訴３');
      const emailIndex = headers.findIndex(h => h === 'email' || h === 'メール' || h === 'メールアドレス');
      const memoIndex = headers.findIndex(h => h === 'memo' || h === 'メモ' || h === '備考');

      if (customerNumberIndex === -1) {
        setResult({
          success: 0,
          error: 0,
          messages: ['エラー: 「customer_number」または「顧客番号」列が必須です'],
        });
        setImporting(false);
        return;
      }

      if (nameIndex === -1) {
        setResult({ success: 0, error: 0, messages: ['エラー: 「name」または「氏名」列が見つかりません'] });
        setImporting(false);
        return;
      }

      if (kanaIndex === -1) {
        setResult({ success: 0, error: 0, messages: ['エラー: 「name_kana」または「ふりがな」列が見つかりません'] });
        setImporting(false);
        return;
      }

      let successCount = 0;
      let errorCount = 0;
      const messages: string[] = [];

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const name = row[nameIndex]?.trim();
        const nameKana = kanaIndex !== -1 ? row[kanaIndex]?.trim() : '';

        if (!name) {
          errorCount++;
          messages.push(`行${i + 2}: 氏名が空です`);
          continue;
        }

        if (!nameKana) {
          errorCount++;
          messages.push(`行${i + 2}: ふりがなが空です`);
          continue;
        }

        const customerNumber = row[customerNumberIndex]?.trim();
        if (!customerNumber) {
          errorCount++;
          messages.push(`行${i + 2}: 顧客番号が空です`);
          continue;
        }

        const { data: existing } = await supabase
          .from('customers')
          .select('id')
          .eq('customer_number', customerNumber)
          .maybeSingle();

        if (existing) {
          errorCount++;
          messages.push(`行${i + 2}: 顧客番号 ${customerNumber} は既に登録されています`);
          continue;
        }

        let clinicName = '';
        const num = parseInt(customerNumber);
        if (!isNaN(num)) {
          if (num >= 1 && num <= 4999) {
            clinicName = '川西あつ整体院';
          } else if (num >= 5000) {
            clinicName = '高槻あつ整体院';
          }
        }

        let age = null;
        let birthDate = birthDateIndex !== -1 ? row[birthDateIndex]?.trim() : null;
        if (birthDate) {
          const normalized = birthDate.replace(/\//g, '-');
          const birth = new Date(normalized);
          const today = new Date();
          let calculatedAge = today.getFullYear() - birth.getFullYear();
          const monthDiff = today.getMonth() - birth.getMonth();
          if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
            calculatedAge--;
          }
          age = calculatedAge;
          if (!Number.isNaN(birth.getTime())) {
            birthDate = birth.toISOString().split('T')[0];
          }
        }

        const customerData: Record<string, unknown> = {
          customer_number: customerNumber,
          name,
          name_kana: nameKana,
          gender: genderIndex !== -1 ? row[genderIndex]?.trim() || null : null,
          birth_date: birthDate,
          birthday: birthDate,
          age: age,
          phone_number:
            phoneIndex !== -1
              ? (row[phoneIndex]?.trim() || '').replace(/\D/g, '') || null
              : null,
          referral_source: referralIndex !== -1 ? row[referralIndex]?.trim() || null : null,
          referral_source_2: referral2Index !== -1 ? row[referral2Index]?.trim() || null : null,
          prefecture: prefectureIndex !== -1 ? row[prefectureIndex]?.trim() || null : null,
          city: cityIndex !== -1 ? row[cityIndex]?.trim() || null : null,
          town: townIndex !== -1 ? row[townIndex]?.trim() || null : null,
          chief_complaint_1: complaint1Index !== -1 ? row[complaint1Index]?.trim() || null : null,
          chief_complaint_2: complaint2Index !== -1 ? row[complaint2Index]?.trim() || null : null,
          chief_complaint_3: complaint3Index !== -1 ? row[complaint3Index]?.trim() || null : null,
          email: emailIndex !== -1 ? row[emailIndex]?.trim() || null : null,
          memo: memoIndex !== -1 ? row[memoIndex]?.trim() || null : null,
          clinic_name: clinicName || null,
        };

        const { error } = await supabase.from('customers').insert([customerData as Database['public']['Tables']['customers']['Insert']]);

        if (error) {
          errorCount++;
          const errObj = error as { message?: string; details?: string; hint?: string; code?: string };
          const detailParts = [errObj.message, errObj.details, errObj.hint, errObj.code && `code=${errObj.code}`].filter(
            Boolean
          );
          const errorMsg = detailParts.join(' | ');
          messages.push(`行${i + 2}: ${name} の登録失敗 - ${errorMsg}`);
        } else {
          successCount++;
        }
      }

      setResult({
        success: successCount,
        error: errorCount,
        messages: messages,
      });

      if (successCount > 0) {
        await loadCustomers();
        window.dispatchEvent(new Event('customers-updated'));
      }

    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      setResult({ success: 0, error: 0, messages: [`ファイル読み込みエラー: ${msg}`] });
    }

    setImporting(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-xl p-6">
      <div className="flex items-center gap-3 mb-6">
        <Upload className="text-teal-600" size={32} />
        <h2 className="text-2xl font-bold text-gray-800">顧客名簿インポート</h2>
      </div>

      <div className="mb-6 bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <FileText className="text-blue-600 mt-1" size={24} />
          <div className="w-full">
            <div className="font-bold text-blue-800 mb-3">CSVファイル形式（15列対応）</div>
            <div className="text-sm text-blue-700 space-y-2">
              <div className="font-bold bg-white rounded p-2 border border-blue-300 text-xs">
                A. 顧客番号 | B. 名前 <span className="text-red-600">*</span> | C. ふりがな <span className="text-red-600">*</span> | D. 性別 | E. 生年月日 | F. 電話番号 | G. 流入のメイン | H. 府県 | I. 市・郡 | J. 町 | K. 主訴1 | L. 主訴2 | M. 主訴3 | N. メールアドレス | O. 備考
              </div>
              <div className="space-y-1">
                <div>• <span className="font-bold text-red-600">必須:</span> 名前、ふりがな</div>
                <div>• <span className="font-bold text-orange-600">顧客番号ルール:</span> 1～4999 = 川西院 / 5000～7999 = 高槻院（自動設定）</div>
                <div>• <span className="font-bold text-green-600">生年月日:</span> YYYY/MM/DD形式（例: 1980/01/01）で年齢自動計算</div>
                <div>• <span className="font-bold text-purple-600">電話番号:</span> ハイフンなし（例: 09012345678）</div>
                <div>• <span className="font-bold text-teal-600">コピペルール:</span> Excelからそのままコピペ可能（タブ区切り対応）</div>
                <div>• 列名は日本語でも英語でも自動認識します</div>
                <div>• 既に登録されている顧客番号はスキップされます</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-3 mb-6">
        <button
          onClick={downloadTemplate}
          className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white rounded-xl font-bold shadow-lg transition-all"
        >
          <Download size={20} />
          テンプレートをダウンロード
        </button>

        <label className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-600 hover:to-cyan-600 text-white rounded-xl font-bold shadow-lg transition-all cursor-pointer">
          <Upload size={20} />
          CSVファイルを選択
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt"
            onChange={handleFileUpload}
            className="hidden"
            disabled={importing}
          />
        </label>
      </div>

      {importing && (
        <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-6 text-center">
          <div className="text-lg font-bold text-yellow-800 mb-2">インポート中...</div>
          <div className="text-sm text-yellow-700">数千件のデータでも数秒で完了します</div>
        </div>
      )}

      {result && (
        <div className={`border-2 rounded-lg p-6 ${result.error > 0 ? 'bg-orange-50 border-orange-300' : 'bg-green-50 border-green-300'}`}>
          <div className="flex items-center gap-3 mb-4">
            {result.error === 0 ? (
              <CheckCircle className="text-green-600" size={32} />
            ) : (
              <AlertCircle className="text-orange-600" size={32} />
            )}
            <div>
              <div className="text-xl font-bold text-gray-800">インポート完了</div>
              <div className="text-sm text-gray-600 mt-1">
                成功: <span className="font-bold text-green-600">{result.success}件</span>
                {result.error > 0 && (
                  <span className="ml-4">
                    スキップ/エラー: <span className="font-bold text-orange-600">{result.error}件</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {result.messages.length > 0 && (
            <div className="mt-4">
              <div className="font-bold text-gray-700 mb-2">詳細: ({result.messages.length}件のメッセージ)</div>
              <div className="bg-white rounded-lg p-3 max-h-64 overflow-y-auto space-y-1 text-sm border border-gray-200">
                {result.messages.map((msg, idx) => (
                  <div key={idx} className="text-gray-700 py-1 border-b border-gray-100 last:border-0">{msg}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 bg-gray-50 rounded-lg p-4">
        <div className="text-sm text-gray-700 space-y-2">
          <div className="font-bold text-gray-800">使い方:</div>
          <div>1. 「テンプレートをダウンロード」でCSV形式を確認</div>
          <div>2. Excelで顧客データを開き、CSV形式で保存（UTF-8推奨）</div>
          <div>3. 「CSVファイルを選択」でアップロード</div>
          <div>4. 自動的にデータベースに登録され、入力フォームで即座に検索可能になります</div>
        </div>
      </div>

      <div className="mt-8 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl shadow-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Users className="text-blue-600" size={28} />
            <h3 className="text-xl font-bold text-gray-800">登録名簿一覧</h3>
          </div>
          <div className="text-sm font-bold text-blue-600 bg-white px-4 py-2 rounded-lg shadow">
            合計 {customers.length} 件
          </div>
        </div>

        {loadingList ? (
          <div className="bg-white rounded-xl p-8 text-center">
            <div className="text-gray-500">読み込み中...</div>
          </div>
        ) : customers.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center">
            <div className="text-gray-500">まだ顧客が登録されていません</div>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-inner border border-gray-200">
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full">
                <thead className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-bold">顧客番号</th>
                    <th className="px-4 py-3 text-left text-sm font-bold">氏名</th>
                    <th className="px-4 py-3 text-left text-sm font-bold">ふりがな</th>
                    <th className="px-4 py-3 text-left text-sm font-bold">性別</th>
                    <th className="px-4 py-3 text-left text-sm font-bold">年齢</th>
                    <th className="px-4 py-3 text-left text-sm font-bold">電話番号</th>
                    <th className="px-4 py-3 text-left text-sm font-bold">院</th>
                    <th className="px-4 py-3 text-left text-sm font-bold">登録日</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedCustomers.map((customer, idx) => (
                    <tr
                      key={customer.id}
                      className={`border-b border-gray-100 hover:bg-blue-50 transition-colors ${idx % 2 === 0 ? 'bg-gray-50' : 'bg-white'}`}
                    >
                      <td className="px-4 py-3 text-sm font-mono text-gray-700">{customer.customer_number}</td>
                      <td className="px-4 py-3 text-sm font-bold text-gray-800">{customer.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{customer.name_kana}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{customer.gender || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{customer.age ? `${customer.age}歳` : '-'}</td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-600">{customer.phone_number || '-'}</td>
                      <td className="px-4 py-3 text-sm">
                        {customer.clinic_name ? (
                          <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                            customer.clinic_name.includes('川西')
                              ? 'bg-green-100 text-green-700'
                              : 'bg-orange-100 text-orange-700'
                          }`}>
                            {customer.clinic_name}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {new Date(customer.created_at).toLocaleDateString('ja-JP')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {customers.length > 0 && totalListPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-gray-200 bg-gray-50 text-sm">
                <span className="text-gray-600">
                  {listPageStart + 1}〜{listRangeEnd} 件を表示（全 {customers.length} 件・{LIST_ROWS_PER_PAGE} 件/ページ）
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={effectiveListPage <= 1}
                    onClick={() => setListPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1.5 rounded-lg font-bold border border-gray-300 bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100"
                  >
                    前へ
                  </button>
                  <span className="font-mono text-gray-700 px-2">
                    {effectiveListPage} / {totalListPages}
                  </span>
                  <button
                    type="button"
                    disabled={effectiveListPage >= totalListPages}
                    onClick={() => setListPage((p) => Math.min(totalListPages, p + 1))}
                    className="px-3 py-1.5 rounded-lg font-bold border border-gray-300 bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100"
                  >
                    次へ
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
