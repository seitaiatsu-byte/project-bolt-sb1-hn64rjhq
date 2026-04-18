import { useState, useEffect } from 'react';
import { User, Phone, MapPin, Calendar, TrendingUp, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { formatPaymentDetailLabel, formatPaymentMethodLabel, mergeIdNameMaps } from '../lib/paymentDisplay';

type Customer = Database['public']['Tables']['customers']['Row'];
type VisitRow = Database['public']['Tables']['visit_records']['Row'];

interface CustomerProfileProps {
  customer: Customer;
  onClose: () => void;
}

export default function CustomerProfile({ customer, onClose }: CustomerProfileProps) {
  const [visitCount, setVisitCount] = useState(0);
  const [totalLtv, setTotalLtv] = useState(0);
  const [yearlyLtv, setYearlyLtv] = useState<Record<string, number>>({});
  const [visitHistory, setVisitHistory] = useState<VisitRow[]>([]);
  const [paymentNameMap, setPaymentNameMap] = useState<Record<string, string>>({});

  useEffect(() => {
    loadCustomerData();
  }, [customer.id]);

  const loadCustomerData = async () => {
    const [{ data: visits }, { data: pm }, { data: pd }] = await Promise.all([
      supabase.from('visit_records').select('*').eq('customer_id', customer.id).order('visit_date', { ascending: false }),
      supabase.from('payment_method_master').select('id,name'),
      supabase.from('payment_detail_master').select('id,name'),
    ]);
    setPaymentNameMap(mergeIdNameMaps(pm as { id: string; name: string }[], pd as { id: string; name: string }[]));

    const { data: products } = await supabase
      .from('product_sales')
      .select('*')
      .eq('customer_id', customer.id);

    const { data: subscriptions } = await supabase
      .from('subscription_records')
      .select('*')
      .eq('customer_id', customer.id);

    const allVisits = visits || [];
    const allProducts = products || [];
    const allSubscriptions = subscriptions || [];

    setVisitCount(allVisits.length);

    const visitTotal = allVisits.reduce((sum, v) => sum + Number(v.amount || 0), 0);
    const productTotal = allProducts.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const subscriptionTotal = allSubscriptions.reduce((sum, s) => sum + Number(s.amount || 0), 0);

    setTotalLtv(visitTotal + productTotal + subscriptionTotal);

    const yearly: Record<string, number> = {};

    allVisits.forEach((v) => {
      const year = new Date(v.visit_date).getFullYear().toString();
      yearly[year] = (yearly[year] || 0) + Number(v.amount || 0);
    });

    allProducts.forEach((p) => {
      const year = new Date(p.sale_date).getFullYear().toString();
      yearly[year] = (yearly[year] || 0) + Number(p.amount || 0);
    });

    allSubscriptions.forEach((s) => {
      const year = new Date(s.start_date).getFullYear().toString();
      yearly[year] = (yearly[year] || 0) + Number(s.amount || 0);
    });

    setYearlyLtv(yearly);
    setVisitHistory(allVisits);
  };

  const calculateAge = (birthDate: string | null) => {
    if (!birthDate) return '-';
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-blue-600 text-white p-6 rounded-t-2xl flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold">{customer.name}</h2>
            <p className="text-blue-100">{customer.name_kana}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-all"
          >
            <X size={28} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-4 border-2 border-orange-200">
              <div className="text-sm text-orange-600 font-bold mb-1">顧客番号</div>
              <div className="text-2xl font-bold text-orange-900">{customer.customer_number || '-'}</div>
            </div>

            <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-4 border-2 border-green-200">
              <div className="text-sm text-green-600 font-bold mb-1">来院回数</div>
              <div className="text-2xl font-bold text-green-900">{visitCount}回</div>
            </div>

            <div className="bg-gradient-to-br from-pink-50 to-pink-100 rounded-xl p-4 border-2 border-pink-200">
              <div className="flex items-center gap-2 text-sm text-pink-600 font-bold mb-1">
                <TrendingUp size={16} />
                総LTV
              </div>
              <div className="text-2xl font-bold text-pink-900">¥{totalLtv.toLocaleString()}</div>
            </div>

            <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4 border-2 border-purple-200">
              <div className="text-sm text-purple-600 font-bold mb-1">年齢</div>
              <div className="text-2xl font-bold text-purple-900">
                {customer.birth_date ? `${calculateAge(customer.birth_date)}歳` : '-'}
              </div>
            </div>

            <div className="bg-gradient-to-br from-yellow-50 to-amber-100 rounded-xl p-4 border-2 border-yellow-400">
              <div className="text-sm text-yellow-700 font-bold mb-1">持ちポイント</div>
              <div className="text-2xl font-bold text-yellow-900">{customer.points || 0}pt</div>
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
            <div className="flex items-start gap-2">
              <User className="text-gray-600 mt-1" size={20} />
              <div className="flex-1">
                <div className="text-sm text-gray-600 font-bold">性別</div>
                <div className="text-lg font-bold">{customer.gender || '-'}</div>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <Calendar className="text-gray-600 mt-1" size={20} />
              <div className="flex-1">
                <div className="text-sm text-gray-600 font-bold">生年月日</div>
                <div className="text-lg font-bold">
                  {customer.birth_date ? new Date(customer.birth_date).toLocaleDateString('ja-JP') : '-'}
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <Phone className="text-gray-600 mt-1" size={20} />
              <div className="flex-1">
                <div className="text-sm text-gray-600 font-bold">電話番号</div>
                <div className="text-lg font-bold">{customer.phone_number || '-'}</div>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <MapPin className="text-gray-600 mt-1" size={20} />
              <div className="flex-1">
                <div className="text-sm text-gray-600 font-bold">住所</div>
                <div className="text-lg font-bold">
                  {customer.prefecture && customer.city
                    ? `${customer.prefecture} ${customer.city} ${customer.address || ''}`
                    : '-'}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-4">
            <h3 className="text-lg font-bold text-gray-800 mb-3">年別LTV</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Object.entries(yearlyLtv)
                .sort(([a], [b]) => parseInt(b) - parseInt(a))
                .map(([year, amount]) => (
                  <div key={year} className="bg-white rounded-lg p-3 shadow">
                    <div className="text-sm text-gray-600 font-bold">{year}年</div>
                    <div className="text-xl font-bold text-blue-600">¥{amount.toLocaleString()}</div>
                  </div>
                ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border-2 border-gray-200">
            <div className="bg-gray-100 p-4 rounded-t-xl">
              <h3 className="text-lg font-bold text-gray-800">来院履歴</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600">来院日</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600">メニュー</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600">プログラム</th>
                    <th className="px-4 py-3 text-right text-xs font-bold text-gray-600">金額</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600">決済内容</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600">支払方法</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600">担当</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {visitHistory.map((visit) => (
                    <tr key={visit.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm">
                        {new Date(visit.visit_date).toLocaleDateString('ja-JP')}
                      </td>
                      <td className="px-4 py-3 text-sm font-bold">{visit.menu_name || '-'}</td>
                      <td className="px-4 py-3 text-sm">{visit.program_name || '-'}</td>
                      <td className="px-4 py-3 text-sm text-right font-bold">
                        ¥{Number(visit.amount ?? 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {formatPaymentDetailLabel(visit.payment_detail_id, null, paymentNameMap)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {formatPaymentMethodLabel(visit.payment_method, paymentNameMap)}
                      </td>
                      <td className="px-4 py-3 text-sm">{visit.staff_name || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
