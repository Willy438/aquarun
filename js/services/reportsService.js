// Daily and monthly sales. Pages never call Supabase directly, they call this file.
import { supabase } from '../config/supabaseClient.js';
import { cachedQuery, getTodayManila } from '../core/ui.js';

export async function getTodayReportSummary() {
  const today = getTodayManila();
  return cachedQuery(`reports:today:${today}`, async () => {
    const { data, error } = await supabase
      .from('daily_report')
      .select('report_date, orders, refill_sales, service_charges, pending_payment, recorded_sales')
      .eq('report_date', today)
      .maybeSingle();

    if (error || !data) {
      return {
        report_date: today,
        orders: 0,
        refill_sales: 0,
        service_charges: 0,
        pending_payment: 0,
        recorded_sales: 0,
      };
    }
    return data;
  });
}

export async function getDailyReports({ limit = 30 } = {}) {
  return cachedQuery(`reports:daily:${limit}`, async () => {
    const { data, error } = await supabase
      .from('daily_report')
      .select('report_date, orders, refill_sales, service_charges, pending_payment, recorded_sales')
      .order('report_date', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data ?? [];
  });
}

export async function getMonthlyReports({ limit = 12 } = {}) {
  return cachedQuery(`reports:monthly:${limit}`, async () => {
    const { data, error } = await supabase
      .from('monthly_report')
      .select('report_month, orders, refill_sales, service_charges, pending_payment, recorded_sales')
      .order('report_month', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data ?? [];
  });
}

export async function getOrderActivityByHour({ days = 1 } = {}) {
  const todayStr = getTodayManila();
  return cachedQuery(`reports:hourly:${todayStr}:${days}`, async () => {
    const cutoff = new Date(todayStr + 'T00:00:00');
    cutoff.setDate(cutoff.getDate() - Math.max(0, Number(days) - 1));
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from('order_activity_by_hour')
      .select('order_date, hour_of_day, orders')
      .gte('order_date', cutoffStr);

    if (error) throw error;

    // Aggregate hours 7..18 (7 AM to 6 PM)
    const countsByHour = new Map();
    for (let h = 7; h <= 18; h++) countsByHour.set(h, 0);

    for (const row of data ?? []) {
      const h = Number(row.hour_of_day);
      const prev = countsByHour.get(h) || 0;
      countsByHour.set(h, prev + Number(row.orders || 0));
    }

    return Array.from({ length: 12 }, (_, idx) => {
      const hour = 7 + idx;
      const label =
        hour === 12 ? '12PM' : hour < 12 ? `${hour}AM` : `${hour - 12}PM`;
      const fullLabel =
        hour === 12 ? '12:00 PM' : hour < 12 ? `${hour}:00 AM` : `${hour - 12}:00 PM`;
      return {
        hour,
        label,
        fullLabel,
        orders: countsByHour.get(hour) || 0,
      };
    });
  });
}
