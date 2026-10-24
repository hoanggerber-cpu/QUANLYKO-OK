// Draft only. DO NOT deploy before enabling PINs for customers and staging QA.
// This endpoint serves one customer's ledger AFTER validating its PIN server-side.
// Deploy with verify_jwt=false only after RLS and abuse protection are reviewed.
import { createClient } from 'npm:@supabase/supabase-js@2';

const origin = Deno.env.get('TRACKING_ALLOWED_ORIGIN') || '';
const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const db = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd').replace(/[^a-z0-9]/g, '');
}

function compareConstantTime(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  const n = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

const json = (value: unknown, status: number, headers: HeadersInit) =>
  new Response(JSON.stringify(value), { status, headers: { ...headers, 'content-type': 'application/json', 'cache-control': 'no-store' } });

Deno.serve(async req => {
  const cors = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Vary': 'Origin',
  };
  if (!origin || !serviceKey || !supabaseUrl) return json({ error: 'not_configured' }, 503, cors);
  if (req.headers.get('origin') !== origin) return json({ error: 'forbidden' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);

  try {
    const body = await req.json();
    const trackingId = String(body?.trackingId || '').trim();
    const pin = String(body?.pin || '').trim();
    if (!trackingId || trackingId.length > 200 || !/^[a-zA-Z0-9]{4,10}$/.test(pin)) {
      return json({ error: 'invalid_credentials' }, 403, cors);
    }

    // Query only necessary rows; never send a customer PIN, other customers, or raw DB objects.
    // The full customer list is used only on the server for compatibility with legacy links.
    const { data: customers, error: customerError } = await db
      .from('customers').select('id,name,type,pin_code');
    if (customerError) throw customerError;
    const token = normalize(trackingId);
    const matches = (customers || []).filter(c => {
      const name = normalize(c.name || '');
      const type = String(c.type || '');
      return c.id?.toLowerCase() === trackingId.toLowerCase() || name === token ||
        (type === 'dtf' && name + 'dtf' === token) ||
        (type === 'tshirt' && (name + 'ao' === token || name + 'tshirt' === token));
    });
    if (matches.length !== 1) return json({ error: 'invalid_credentials' }, 403, cors);
    const cust = matches[0];
    // Require a server-stored PIN for every public request; legacy unprotected links fail closed.
    if (!cust.pin_code || !compareConstantTime(String(cust.pin_code), pin)) {
      return json({ error: 'invalid_credentials' }, 403, cors);
    }
    const { data: orders, error: ordersError } = await db.from('orders')
      .select('id,order_code,customer_name,type,product_name,color,quantity,unit_price,total_price,paid_amount,debt_amount,status,created_at,order_images')
      .eq('customer_name', cust.name).eq('type', cust.type).order('created_at', { ascending: false });
    if (ordersError) throw ordersError;
    const ids = (orders || []).map(o => o.id);
    let items: any[] = [];
    if (ids.length) {
      const { data, error } = await db.from('order_items')
        .select('id,order_id,type,product_name,color,size,quantity,unit_price,total_price,image')
        .in('order_id', ids);
      if (error) throw error;
      items = data || [];
    }
    const productItems = (orders || []).map(o => {
      const rowItems = items.filter(i => i.order_id === o.id).map(i => ({
        id:i.id, type:i.type, productName:i.product_name, color:i.color || '',
        size:i.size || '',quantity:Number(i.quantity || 0),
        unitPrice:Number(i.unit_price || 0),totalPrice:Number(i.total_price || 0),image:i.image || '',
      }));
      return {
        id:o.id,orderCode:o.order_code,customerName:o.customer_name,type:o.type,
        productName:o.product_name || '',color:o.color || '',quantity:Number(o.quantity || 0),
        unitPrice:Number(o.unit_price || 0),totalPrice:Number(o.total_price || 0),
        paidAmount:Number(o.paid_amount || 0),debtAmount:Number(o.debt_amount || 0),
        status:o.status,createdAt:o.created_at,orderImages: (() => {
          if (!o.order_images) return [];
          try { const parsed=JSON.parse(o.order_images);return Array.isArray(parsed)?parsed:[]; }
          catch { return []; }
        })(),items:rowItems,
      };
    });
    const totalSpent = productItems.reduce((sum,o)=>sum+o.totalPrice,0);
    const paidAmount = productItems.reduce((sum,o)=>sum+o.paidAmount,0);
    const debtAmount = productItems.reduce((sum,o)=>sum+o.debtAmount,0);
    return json({ customer: {id:cust.id,name:cust.name,type:cust.type,productsTaken:[],
      totalSpent,paidAmount,debtAmount,updatedAt: new Date().toISOString()},
      orders:productItems }, 200, cors);
  } catch (error) {
    console.error('tracking endpoint error:', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'server_error' }, 500, cors);
  }
});
