import { useState, useEffect } from 'react';
import { Upload, Edit2, Trash2, History, ImageIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import CustomerSearchPanel from './CustomerSearchPanel';
import { CLINIC_OPTIONS, type ClinicFullName } from '../lib/clinic';

export default function VisitForm({ onSuccess }: { onSuccess: () => void }) {
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [menus, setMenus] = useState<any[]>([]);
  const [paymentDetails, setPaymentDetails] = useState<any[]>([]);
  const [staffList, setStaffList] = useState<any[]>([]);
  const [recentRecords, setRecentRecords] = useState<any[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [visitDate, setVisitDate] = useState(new Date().toISOString().split('T')[0]);
  const [clinicName, setClinicName] = useState<ClinicFullName>('高槻あつ整体院');
  const [amount, setAmount] = useState('');
  const [staffId, setStaffId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [selectedPaymentDetail, setSelectedPaymentDetail] = useState('');
  const [selectedMenu, setSelectedMenu] = useState('');
  const [pointsUsed, setPointsUsed] = useState('0');
  const [maintenanceCost, setMaintenanceCost] = useState('0');
  const [memo, setMemo] = useState('');
  
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [currentMediaUrls, setCurrentMediaUrls] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (selectedCustomer?.customer_number && !editingId) {
      const num = parseInt(selectedCustomer.customer_number);
      setClinicName(num >= 5000 ? '高槻あつ整体院' : '川西あつ整体院');
    }
  }, [selectedCustomer, editingId]);

  useEffect(() => {
    loadMasters();
    loadRecentRecords();
  }, []);

  const loadMasters = async () => {
    const [{ data: pm }, { data: m }, { data: pd }, { data: s }] = await Promise.all([
      supabase.from('payment_method_master').select('*').eq('is_active', true).order('display_order'),
      supabase.from('menu_master').select('*').eq('is_active', true).order('display_order'),
      supabase.from('payment_detail_master').select('*').eq('is_active', true).order('display_order'),
      supabase.from('staff_master').select('*').eq('is_active', true).order('display_order'),
    ]);
    if (pm?.length) { setPaymentMethods(pm); setPaymentMethodId(pm[0].id); }
    if (m) setMenus(m);
    if (pd) setPaymentDetails(pd);
    if (s) setStaffList(s);
  };

  const loadRecentRecords = async () => {
    const { data } = await supabase.from('visit_records').select('*, customers(*)').order('created_at', { ascending: false }).limit(5);
    if (data) setRecentRecords(data);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      setSelectedFiles(prev => [...prev, ...files]);
      const newPreviews = files.map(file => URL.createObjectURL(file));
      setPreviewUrls(prev => [...prev, ...newPreviews]);
    }
  };

  const resetForm = () => {
    setEditingId(null); setAmount(''); setMemo(''); setStaffId(''); setSelectedMenu(''); setSelectedPaymentDetail(''); 
    setPointsUsed('0'); setMaintenanceCost('0'); setSelectedFiles([]); setPreviewUrls([]); setCurrentMediaUrls([]); setSelectedCustomer(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return alert('顧客を選んでください');
    setIsSubmitting(true);

    try {
      const menuObj = menus.find(m => m.id === selectedMenu);
      const staffObj = staffList.find(s => s.id === staffId);

      const payload = {
        customer_id: selectedCustomer.id,
        visit_date: visitDate,
        payment_method: paymentMethodId,
        payment_detail_id: selectedPaymentDetail || null,
        amount: Number(amount) || 0,
        memo,
        clinic_name: clinicName,
        staff_name: staffObj?.name || null,
        menu_id: selectedMenu || null,
        menu_name: menuObj?.name || null,
        points_used: Number(pointsUsed) || 0,
        maintenance_cost: Number(maintenanceCost) || 0,
      };

      // 1. まずデータを保存（この時点では画像なし）
      const { data: record, error: dbError } = editingId 
        ? await supabase.from('visit_records').update(payload).eq('id', editingId).select()
        : await supabase.from('visit_records').insert([payload]).select();

      if (dbError) throw new Error(`DB登録失敗: ${dbError.message}`);

      // 2. 画像のアップロード（ここで失敗したらアラートを出す）
      const visitId = record[0].id;
      const uploadedUrls = [...currentMediaUrls];
      
      for (const file of selectedFiles) {
        const path = `${visitId}/${Date.now()}_${file.name}`;
        const { error: upErr } = await supabase.storage.from('visit-media').upload(path, file);
        
        if (upErr) {
          throw new Error(`画像アップロード失敗: ${upErr.message}\nストレージの設定を確認してください`);
        }

        const { data: pub } = supabase.storage.from('visit-media').getPublicUrl(path);
        uploadedUrls.push(pub.publicUrl);
      }

      // 3. 全画像URLをDBに書き込んで「完結」
      const { error: updateError } = await supabase.from('visit_records').update({ media_urls: uploadedUrls }).eq('id', visitId);
      if (updateError) throw new Error(`URL保存失敗: ${updateError.message}`);

      alert(editingId ? '内容と画像を修正しました' : '来院記録と画像を登録しました');
      resetForm();
      loadRecentRecords();
      window.dispatchEvent(new Event('records-updated'));
      onSuccess();

    } catch (err: any) {
      alert(`【エラー発生】\n${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const startEdit = (r: any) => {
    setEditingId(r.id);
    setSelectedCustomer(r.customers);
    setVisitDate(r.visit_date);
    setClinicName(r.clinic_name);
    setAmount(r.amount.toString());
    setStaffId(staffList.find(s => s.name === r.staff_name)?.id || '');
    setPaymentMethodId(r.payment_method);
    setSelectedPaymentDetail(r.payment_detail_id || '');
    setSelectedMenu(r.menu_id || '');
    setPointsUsed(r.points_used?.toString() || '0');
    setMaintenanceCost(r.maintenance_cost?.toString() || '0');
    setMemo(r.memo || '');
    setCurrentMediaUrls(r.media_urls || []);
    setPreviewUrls([]);
    setSelectedFiles([]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-6 pb-20">
      <div className={`bg-white rounded-2xl shadow-lg p-6 border-4 ${editingId ? 'border-orange-500' : 'border-blue-100'}`}>
        <h2 className="text-xl font-bold mb-4">{editingId ? '【修正モード】' : '【来院入力】'}</h2>
        <CustomerSearchPanel accent={editingId ? "orange" : "blue"} selectedCustomer={selectedCustomer} onSelect={setSelectedCustomer} onClearSelection={() => setSelectedCustomer(null)} />
        <form onSubmit={handleSubmit} className="space-y-4 mt-6">
          <div className="flex gap-2">
            <input type="date" value={visitDate} onChange={e => setVisitDate(e.target.value)} className="flex-1 p-3 border-2 rounded-lg font-bold" />
            <select value={clinicName} onChange={e => setClinicName(e.target.value as any)} className="flex-1 p-3 border-2 rounded-lg font-bold">
              {CLINIC_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="bg-gray-50 p-4 rounded-xl border-2">
            <label className="block text-xs font-bold text-gray-500 mb-1 text-right">金額</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="w-full bg-transparent text-right font-bold text-3xl text-blue-700 outline-none" />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2 font-bold">担当スタッフ</label>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => setStaffId('')} className={`py-2 rounded-lg text-xs font-bold ${staffId === '' ? 'bg-slate-600 text-white' : 'bg-gray-100'}`}>未選択</button>
              {staffList.map(s => (<button key={s.id} type="button" onClick={() => setStaffId(s.id)} className={`py-2 rounded-lg text-xs font-bold ${staffId === s.id ? 'bg-indigo-500 text-white' : 'bg-gray-100'}`}>{s.name}</button>))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2 font-bold">支払方法（看板）</label>
            <div className="grid grid-cols-3 gap-2">
              {paymentMethods.map(m => (<button key={m.id} type="button" onClick={() => setPaymentMethodId(m.id)} className={`py-3 px-2 rounded-lg font-bold text-sm ${paymentMethodId === m.id ? 'bg-green-500 text-white shadow-md' : 'bg-gray-100'}`}>{m.name}</button>))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2 font-bold">種類（看板）</label>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => setSelectedPaymentDetail('')} className={`py-3 px-2 rounded-lg font-bold text-sm ${selectedPaymentDetail === '' ? 'bg-slate-600 text-white' : 'bg-gray-100'}`}>未選択</button>
              {paymentDetails.map(d => (<button key={d.id} type="button" onClick={() => setSelectedPaymentDetail(d.id)} className={`py-3 px-2 rounded-lg font-bold text-sm ${selectedPaymentDetail === d.id ? 'bg-emerald-500 text-white shadow-md' : 'bg-gray-100'}`}>{d.name}</button>))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2 font-bold">実施メニュー</label>
            <select value={selectedMenu} onChange={e => setSelectedMenu(e.target.value)} className="w-full p-3 border-2 rounded-lg font-bold text-sm">
              <option value="">未選択</option>
              {menus.map(menu => <option key={menu.id} value={menu.id}>{menu.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="relative"><input type="number" value={pointsUsed} onChange={e => setPointsUsed(e.target.value)} className="w-full p-3 border-2 rounded-lg pr-12 font-bold" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">P使用</span></div>
            <div className="relative"><input type="number" value={maintenanceCost} onChange={e => setMaintenanceCost(e.target.value)} className="w-full p-3 border-2 border-amber-300 rounded-lg pr-12 font-bold" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-amber-600">維持費</span></div>
          </div>

          <textarea value={memo} onChange={e => setMemo(e.target.value)} className="w-full p-3 border-2 rounded-lg text-sm" placeholder="メモを入力..." rows={2} />

          <div className="p-4 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300">
            <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2 font-bold"><Upload size={16} /> 写真を追加（プレビュー表示）</label>
            <input type="file" multiple accept="image/*" onChange={handleFileChange} className="w-full text-sm mb-3 cursor-pointer" />
            <div className="flex flex-wrap gap-2">
              {currentMediaUrls.map((url, i) => <div key={i} className="w-16 h-16 rounded border-2 border-blue-400 overflow-hidden"><img src={url} className="w-full h-full object-cover" /></div>)}
              {previewUrls.map((url, i) => <div key={i} className="w-16 h-16 rounded border-2 border-green-400 overflow-hidden"><img src={url} className="w-full h-full object-cover" /></div>)}
            </div>
          </div>

          <button type="submit" disabled={isSubmitting} className={`w-full py-4 rounded-xl font-bold text-xl text-white shadow-lg ${editingId ? 'bg-orange-500' : 'bg-blue-600'}`}>
            {isSubmitting ? '画像を保存中...' : editingId ? '修正を保存する' : '登録する'}
          </button>
        </form>
      </div>

      <div className="bg-white rounded-2xl shadow-lg p-6 border">
        <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2 font-bold"><History className="text-gray-400" /> 最近の履歴（修正・削除可能）</h3>
        <div className="space-y-3">
          {recentRecords.map(r => (
            <div key={r.id} className="p-4 bg-gray-50 rounded-xl border flex justify-between items-center group">
              <div>
                <div className="text-xs font-bold text-blue-600">{new Date(r.visit_date).toLocaleDateString('ja-JP')}</div>
                <div className="font-bold text-sm text-gray-800">{r.customers?.name} 様</div>
                {r.media_urls?.length > 0 && <div className="text-[10px] text-blue-600 font-bold mt-1 flex items-center gap-1"><ImageIcon size={12}/>画像あり ({r.media_urls.length}枚)</div>}
              </div>
              <div className="flex gap-1">
                <button onClick={() => startEdit(r)} className="p-2 text-gray-400 hover:text-blue-600 bg-white rounded border shadow-sm"><Edit2 size={16} /></button>
                <button onClick={async () => { if (window.confirm('この記録を削除しますか？')) { await supabase.from('visit_records').delete().eq('id', r.id); loadRecentRecords(); window.dispatchEvent(new Event('records-updated')); } }} className="p-2 text-gray-400 hover:text-red-600 bg-white rounded border shadow-sm"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

