import { useState, useEffect } from 'react';
import { AlertCircle, Calendar, Phone, Cake, UserCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { getCustomerBirthDate, calculateAge } from '../lib/customerBirthday';

type Customer = Database['public']['Tables']['customers']['Row'];

interface InactiveRow {
  customer: Customer;
  daysSince: number;
  lastVisitDate: string;
  visitCount: number;
  ltvApprox: number;
}

interface BirthdayRow {
  customer: Customer;
  birthDate: string;
  displayAge: number;
}

function lastVisitPerCustomer(visits: { customer_id: string; visit_date: string; amount?: number | null }[]) {
  const map = new Map<string, { date: string; count: number; sum: number }>();
  visits.forEach((v) => {
    const cur = map.get(v.customer_id);
    const amt = Number(v.amount || 0);
    if (!cur) {
      map.set(v.customer_id, { date: v.visit_date, count: 1, sum: amt });
    } else {
      cur.count++;
      cur.sum += amt;
      if (v.visit_date > cur.date) cur.date = v.visit_date;
    }
  });
  return map;
}

export default function InactivePatientAlerts() {
  const [b30, setB30] = useState<InactiveRow[]>([]);
  const [b60, setB60] = useState<InactiveRow[]>([]);
  const [b90, setB90] = useState<InactiveRow[]>([]);
  const [birthdays, setBirthdays] = useState<BirthdayRow[]>([]);
  const [activeMembers, setActiveMembers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAlerts();
    const interval = setInterval(loadAlerts, 60000);
    return () => clearInterval(interval);
  }, []);

  const loadAlerts = async () => {
    setLoading(true);
    const today = new Date();

    const { data: customers } = await supabase.from('customers').select('*');
    const { data: visits } = await supabase.from('visit_records').select('customer_id, visit_date, amount');
    const { data: products } = await supabase.from('product_sales').select('customer_id, amount');
    const { data: subs } = await supabase.from('subscription_records').select('customer_id, amount');

    const visitMap = lastVisitPerCustomer(visits || []);

    const ltv = new Map<string, number>();
    (visits || []).forEach((v) => ltv.set(v.customer_id, (ltv.get(v.customer_id) || 0) + Number(v.amount || 0)));
    (products || []).forEach((p) => ltv.set(p.customer_id, (ltv.get(p.customer_id) || 0) + Number(p.amount || 0)));
    (subs || []).forEach((s) => ltv.set(s.customer_id, (ltv.get(s.customer_id) || 0) + Number(s.amount || 0)));

    const bucket30: InactiveRow[] = [];
    const bucket60: InactiveRow[] = [];
    const bucket90: InactiveRow[] = [];
    const active: Customer[] = [];
    const thirtyAgo = new Date(today);
    thirtyAgo.setDate(thirtyAgo.getDate() - 30);

    for (const c of customers || []) {
      const vi = visitMap.get(c.id);
      if (vi) {
        const last = new Date(vi.date);
        const daysSince = Math.floor((today.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
        if (last >= thirtyAgo) {
          active.push(c);
        }
        if (daysSince >= 30 && daysSince < 60) {
          bucket30.push({
            customer: c,
            daysSince,
            lastVisitDate: vi.date,
            visitCount: vi.count,
            ltvApprox: ltv.get(c.id) || vi.sum,
          });
        } else if (daysSince >= 60 && daysSince < 90) {
          bucket60.push({
            customer: c,
            daysSince,
            lastVisitDate: vi.date,
            visitCount: vi.count,
            ltvApprox: ltv.get(c.id) || vi.sum,
          });
        } else if (daysSince >= 90) {
          bucket90.push({
            customer: c,
            daysSince,
            lastVisitDate: vi.date,
            visitCount: vi.count,
            ltvApprox: ltv.get(c.id) || vi.sum,
          });
        }
      }
    }

    bucket30.sort((a, b) => b.daysSince - a.daysSince);
    bucket60.sort((a, b) => b.daysSince - a.daysSince);
    bucket90.sort((a, b) => b.daysSince - a.daysSince);
    active.sort((a, b) => (a.name_kana || '').localeCompare(b.name_kana || ''));

    const bdays: BirthdayRow[] = [];
    for (const c of customers || []) {
      const bd = getCustomerBirthDate(c);
      if (!bd) continue;
      const birthDate = new Date(bd);
      if (Number.isNaN(birthDate.getTime())) continue;
      let next = new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate());
      if (next < today) next = new Date(today.getFullYear() + 1, birthDate.getMonth(), birthDate.getDate());
      const daysUntil = Math.floor((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntil <= 7) {
        const age = calculateAge(bd) ?? 0;
        bdays.push({ customer: c, birthDate: bd, displayAge: age });
      }
    }
    bdays.sort((a, b) => a.birthDate.localeCompare(b.birthDate));

    setB30(bucket30);
    setB60(bucket60);
    setB90(bucket90);
    setBirthdays(bdays);
    setActiveMembers(active);
    setLoading(false);
  };

  const renderInactiveList = (title: string, color: string, items: InactiveRow[]) => {
    if (items.length === 0) return null;
    return (
      <div className="bg-white rounded-2xl shadow-lg p-6">
        <h3 className={`text-lg font-bold mb-4 flex items-center gap-2 ${color}`}>
          <Calendar size={20} />
          {title}（{items.length}名）
        </h3>
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {items.map((item) => (
            <div
              key={item.customer.id}
              className="rounded-lg p-4 border-2 border-gray-200 hover:shadow-md bg-gray-50"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-lg font-bold text-gray-900">{item.customer.name}</div>
                  <div className="text-sm text-gray-600">{item.customer.name_kana}</div>
                  <div className="flex flex-wrap gap-3 text-sm text-gray-700 mt-1">
                    <span className="font-bold">{item.daysSince}日経過</span>
                    <span>最終来院: {new Date(item.lastVisitDate).toLocaleDateString('ja-JP')}</span>
                    <span>来院{item.visitCount}回</span>
                    <span>LTV目安: ¥{Math.round(item.ltvApprox).toLocaleString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="text-gray-600" size={16} />
                  <span className="text-sm font-bold">{item.customer.phone_number || '-'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-6">
        <div className="text-center py-8 text-gray-500">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-2">
        <AlertCircle className="text-red-600" size={28} />
        <h2 className="text-2xl font-bold text-gray-800">アラート・フォロー</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-2xl shadow-lg p-6 border-2 border-yellow-300">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="text-yellow-600" size={22} />
            <h3 className="font-bold text-yellow-900">30〜59日</h3>
          </div>
          <div className="text-4xl font-bold text-yellow-900">{b30.length}</div>
        </div>
        <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-2xl shadow-lg p-6 border-2 border-orange-300">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="text-orange-600" size={22} />
            <h3 className="font-bold text-orange-900">60〜89日</h3>
          </div>
          <div className="text-4xl font-bold text-orange-900">{b60.length}</div>
        </div>
        <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-2xl shadow-lg p-6 border-2 border-red-300">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="text-red-600" size={22} />
            <h3 className="font-bold text-red-900">90日以上</h3>
          </div>
          <div className="text-4xl font-bold text-red-900">{b90.length}</div>
        </div>
        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-2xl shadow-lg p-6 border-2 border-emerald-300">
          <div className="flex items-center gap-2 mb-2">
            <UserCheck className="text-emerald-600" size={22} />
            <h3 className="font-bold text-emerald-900">アクティブ（30日以内来院）</h3>
          </div>
          <div className="text-4xl font-bold text-emerald-900">{activeMembers.length}</div>
        </div>
      </div>

      {activeMembers.length > 0 && (
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <UserCheck className="text-emerald-600" size={20} />
            アクティブ会員リスト（直近30日に来院あり）
          </h3>
          <div className="max-h-64 overflow-y-auto divide-y">
            {activeMembers.map((c) => (
              <div key={c.id} className="py-2 flex justify-between text-sm">
                <span className="font-bold">{c.name}</span>
                <span className="text-gray-500">{c.phone_number || '-'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {birthdays.length > 0 && (
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Cake className="text-pink-600" size={20} />
            誕生日アラート（7日以内）
          </h3>
          <div className="space-y-3">
            {birthdays.map((item) => (
              <div key={item.customer.id} className="bg-pink-50 rounded-lg p-4 border-2 border-pink-200">
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <div className="text-lg font-bold">{item.customer.name}</div>
                    <div className="text-sm text-gray-600">{item.customer.name_kana}</div>
                    <div className="text-sm mt-1">
                      {new Date(item.birthDate).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' })}（満
                      {item.displayAge}歳付近）
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone size={16} />
                    <span className="font-bold">{item.customer.phone_number || '-'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {renderInactiveList('30日以上〜59日未満 未来院', 'text-yellow-800', b30)}
      {renderInactiveList('60日以上〜89日未満 未来院', 'text-orange-800', b60)}
      {renderInactiveList('90日以上 未来院', 'text-red-800', b90)}

      {b30.length === 0 && b60.length === 0 && b90.length === 0 && birthdays.length === 0 && (
        <div className="bg-green-50 rounded-2xl shadow-lg p-8 border-2 border-green-200 text-center">
          <div className="text-2xl font-bold text-green-900">離脱帯の来院患者はいません</div>
          <p className="text-green-800 mt-2 text-sm">（30日以上未来院の患者がいないか、来院データがありません）</p>
        </div>
      )}
    </div>
  );
}
