// Secure customer ledger links; no PIN or customer login required.
// A link contains 256 bits of random entropy. Only its SHA-256 hash is stored.
// Deployment must use verify_jwt=false because the 'read' action is anonymous.
// The 'issue' action independently verifies the owner's Supabase Auth JWT.
// IMPORTANT: Never give the service_role key to browser code.
import { createClient } from 'npm:@supabase/supabase-js@2.106.1';

const url = Deno.env.get('SUPABASE_URL') || '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const OWNER_UID = '3ea90802-af4a-4163-b403-da7ee313eb6d';
const OWNER_EMAIL = 'hoangkenlee@gmail.com';

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const auth = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function trustedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  const defaults = ['https://quanlyko-ph.vercel.app', 'http://localhost:3000'];
  const configured = (Deno.env.get('TRACKING_ALLOWED_ORIGINS') || '')
    .split(',').map(x => x.trim()).filter(Boolean);
  return [...defaults, ...configured].includes(origin);
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': trustedOrigin(origin) ? origin! : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}

function reply(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function digest(token: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toHex(new Uint8Array(buffer));
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function imagesOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === 'string' && !!x);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string' && !!x) : [value];
  } catch {
    return [value];
  }
}

async function issue(req: Request, body: Record<string, unknown>, origin: string | null): Promise<Response> {
  const authorization = req.headers.get('authorization') || '';
  const jwt = authorization.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!jwt) return reply({ error: 'unauthorized' }, 401, origin);

  // Server-side ownership check. 'authenticated' role alone is insufficient.
  const { data, error: userError } = await auth.auth.getUser(jwt);
  if (userError || !data.user || data.user.id !== OWNER_UID ||
      data.user.email?.toLowerCase() !== OWNER_EMAIL) {
    return reply({ error: 'forbidden' }, 403, origin);
  }

  const name = typeof body.customerName === 'string' ? body.customerName.trim() : '';
  const type = body.customerType;
  if (!name || name.length > 200 || (type !== 'dtf' && type !== 'tshirt')) {
    return reply({ error: 'invalid_request' }, 400, origin);
  }

  // Don't mint arbitrary customer identities that have no actual orders.
  const { data: existing, error: queryError } = await admin
    .from('orders').select('id').eq('customer_name', name).eq('type', type)
    .limit(1).maybeSingle();
  if (queryError) throw queryError;
  if (!existing) return reply({ error: 'customer_not_found' }, 404, origin);

  const token = newToken();
  const tokenHash = await digest(token);
  const { error: insertError } = await admin.from('customer_tracking_links').insert({
    token_hash: tokenHash,
    customer_name: name,
    customer_type: type,
  });
  if (insertError) throw insertError;
  return reply({ token }, 200, origin);
}

async function read(body: Record<string, unknown>, origin: string | null): Promise<Response> {
  const token = typeof body.token === 'string' ? body.token : '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return reply({ error: 'invalid_link' }, 404, origin);
  }
  const hash = await digest(token);
  const { data: link, error: tokenError } = await admin.from('customer_tracking_links')
    .select('customer_name,customer_type')
    .eq('token_hash', hash).is('revoked_at', null).maybeSingle();
  if (tokenError) throw tokenError;
  if (!link) return reply({ error: 'invalid_link' }, 404, origin);

  // Fetch by the exact name AND business type assigned when the owner created the link.
  // All pages are fetched, including older orders; no global customer/order download.
  const orders: Record<string, unknown>[] = [];
  const size = 500;
  for (let offset = 0; offset < 10000; offset += size) {
    const { data, error } = await admin.from('orders')
      .select('id,order_code,customer_name,type,product_name,color,quantity,unit_price,total_price,paid_amount,debt_amount,status,created_at,order_images')
      .eq('customer_name', link.customer_name)
      .eq('type', link.customer_type)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + size - 1);
    if (error) throw error;
    orders.push(...(data || []));
    if (!data || data.length < size) break;
  }
  if (orders.length >= 10000) return reply({ error: 'too_many_orders' }, 413, origin);

  const orderIds = orders.map(o => String(o.id));
  const itemsByOrder = new Map<string, Record<string, unknown>[]>();
  for (let offset = 0; offset < orderIds.length; offset += 100) {
    const ids = orderIds.slice(offset, offset + 100);
    if (!ids.length) continue;
    for (let itemOffset = 0; itemOffset < 10000; itemOffset += size) {
      const { data, error } = await admin.from('order_items')
        .select('id,order_id,type,product_name,color,size,quantity,unit_price,total_price,image')
        .in('order_id', ids).order('id').range(itemOffset, itemOffset + size - 1);
      if (error) throw error;
      for (const i of data || []) {
        const key = String(i.order_id);
        itemsByOrder.set(key, [...(itemsByOrder.get(key) || []), i]);
      }
      if (!data || data.length < size) break;
    }
  }

  const mapped = orders.map(o => ({
    id: o.id, orderCode: o.order_code, customerName: o.customer_name,
    type: o.type, productName: o.product_name || '', color: o.color || '',
    quantity: Number(o.quantity || 0), unitPrice: Number(o.unit_price || 0),
    totalPrice: Number(o.total_price || 0), paidAmount: Number(o.paid_amount || 0),
    debtAmount: Number(o.debt_amount || 0), status: o.status, createdAt: o.created_at,
    orderImages: imagesOf(o.order_images),
    items: (itemsByOrder.get(String(o.id)) || []).map(i => ({
      id: i.id, type: i.type, productName: i.product_name || '',
      color: i.color || '', size: i.size || '',
      quantity: Number(i.quantity || 0), unitPrice: Number(i.unit_price || 0),
      totalPrice: Number(i.total_price || 0), image: i.image || '',
    })),
  }));

  const totalSpent = mapped.reduce((s, o) => s + o.totalPrice, 0);
  const paidAmount = mapped.reduce((s, o) => s + o.paidAmount, 0);
  const debtAmount = totalSpent - paidAmount;
  const customer = {
    id: 'scoped-ledger',
    name: link.customer_name,
    type: link.customer_type,
    productsTaken: [],
    totalSpent, paidAmount, debtAmount,
    updatedAt: mapped.length ? mapped[0].createdAt : new Date().toISOString(),
  };
  return reply({ customer, orders: mapped }, 200, origin);
}

Deno.serve(async req => {
  const origin = req.headers.get('origin');
  if (!url || !anonKey || !serviceKey) return reply({ error: 'unavailable' }, 503, origin);
  if (!trustedOrigin(origin)) return reply({ error: 'forbidden' }, 403, origin);
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405, origin);
  try {
    if (Number(req.headers.get('content-length') || 0) > 8192) {
      return reply({ error: 'payload_too_large' }, 413, origin);
    }
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply({ error: 'invalid_request' }, 400, origin);
    }
    if (body.action === 'issue') return await issue(req, body, origin);
    if (body.action === 'read') return await read(body, origin);
    return reply({ error: 'invalid_action' }, 400, origin);
  } catch (err) {
    console.error('customer-tracking:', err instanceof Error ? err.message : 'unknown error');
    return reply({ error: 'server_error' }, 500, origin);
  }
});
