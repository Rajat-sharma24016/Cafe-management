const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = Number(process.env.PORT || 5180);

function loadEnv(file = '.env.n8n') {
  const env = {...process.env};
  const fullPath = path.join(root, file);
  if (!fs.existsSync(fullPath)) return env;
  for (const line of fs.readFileSync(fullPath, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && !env[key]) env[key] = value;
  }
  return env;
}

const env = loadEnv();
const memoryOrders = [];
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
};

function sendJson(res, status, data) {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function supabaseHeaders() {
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function supabaseUrl(table, query = '') {
  const base = (env.CAFE_API_BASE_URL || '').replace(/\/$/, '');
  return `${base}/${table}${query}`;
}

async function supabaseFetch(table, options = {}, query = '') {
  if (!env.CAFE_API_BASE_URL || (!env.SUPABASE_SERVICE_ROLE_KEY && !env.SUPABASE_ANON_KEY)) {
    return {ok: false, status: 500, data: {error: 'Supabase environment is not configured'}};
  }
  try {
    const response = await fetch(supabaseUrl(table, query), {
      ...options,
      headers: {...supabaseHeaders(), ...(options.headers || {})},
    });
    const text = await response.text();
    let data = text;
    try { data = text ? JSON.parse(text) : null; } catch {}
    return {ok: response.ok, status: response.status, data};
  } catch (error) {
    return {ok: false, status: 503, data: {error: error.message}};
  }
}

const fallbackMenu = [
  {name:'Cappuccino',category:'Coffee',price:180,available:true},
  {name:'Cold Coffee',category:'Coffee',price:160,available:true},
  {name:'Espresso',category:'Coffee',price:120,available:true},
  {name:'Cold Brew',category:'Coffee',price:200,available:true},
  {name:'Latte',category:'Coffee',price:190,available:true},
  {name:'Paneer Sandwich',category:'Food',price:220,available:true},
  {name:'Margherita Pizza',category:'Food',price:350,available:true},
  {name:'Grilled Sandwich',category:'Food',price:210,available:false},
  {name:'Veg Wrap',category:'Food',price:195,available:true},
  {name:'Chocolate Cake',category:'Desserts',price:240,available:true},
  {name:'Cheesecake',category:'Desserts',price:260,available:true},
  {name:'Blueberry Muffin',category:'Desserts',price:130,available:true},
  {name:'Masala Chai',category:'Beverages',price:60,available:true},
  {name:'Green Tea',category:'Beverages',price:80,available:true},
  {name:'Fresh Lime Soda',category:'Beverages',price:90,available:true},
];

async function handleApi(req, res, url) {
  if (url.pathname === '/api/health') {
    const checks = {
      supabaseConfigured: Boolean(env.CAFE_API_BASE_URL && (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY)),
      sarvamConfigured: Boolean(env.SARVAM_API_KEY),
      groqConfigured: Boolean(env.GROQ_API_KEY),
      evolutionConfigured: Boolean(env.EVOLUTION_API_KEY && (env.WHATSAPP_SEND_URL || env.EVOLUTION_SEND_URL)),
      paymentConfigured: Boolean(env.PAYMENT_CREATE_URL),
    };
    return sendJson(res, 200, {ok: true, checks});
  }

  if (url.pathname === '/api/menu' && req.method === 'GET') {
    const result = await supabaseFetch('menu_items', {method: 'GET'}, '?select=*&order=category.asc,name.asc');
    if (result.ok) return sendJson(res, 200, {ok: true, source: 'supabase', items: result.data});
    return sendJson(res, 200, {ok: true, source: 'fallback', items: fallbackMenu, warning: result.data});
  }

  if (url.pathname === '/api/orders' && req.method === 'GET') {
    const result = await supabaseFetch('orders', {method: 'GET'}, '?select=*&order=created_at.desc&limit=100');
    if (!result.ok) return sendJson(res, 200, {ok: true, source: 'memory', orders: memoryOrders, warning: result.data});
    return sendJson(res, 200, {ok: true, orders: result.data});
  }

  if (url.pathname === '/api/orders' && req.method === 'POST') {
    const input = await readBody(req);
    const order = {
      customer_name: String(input.customer || input.customer_name || '').trim(),
      phone: String(input.phone || '').trim(),
      table_no: input.table ? Number(input.table) : null,
      items: input.items || [],
      items_text: input.itemsText || input.items_text || '',
      total: Number(input.total || 0),
      order_type: input.type || (input.table ? `Table ${input.table}` : 'Dine-in'),
      status: input.status || 'pending',
      source: input.source || 'table_qr',
      notes: input.notes || '',
    };
    if (!order.customer_name || !order.phone || !order.items.length || !order.total) {
      return sendJson(res, 400, {ok: false, error: 'Missing customer, phone, items, or total'});
    }
    const result = await supabaseFetch('orders', {
      method: 'POST',
      headers: {Prefer: 'return=representation'},
      body: JSON.stringify(order),
    });
    if (!result.ok) {
      const localOrder = {
        ...order,
        id: `local-${Date.now()}`,
        order_code: `QR-${Date.now().toString().slice(-7)}`,
        created_at: new Date().toISOString(),
      };
      memoryOrders.unshift(localOrder);
      return sendJson(res, 201, {ok: true, source: 'memory', order: localOrder, warning: result.data});
    }
    return sendJson(res, 201, {ok: true, order: Array.isArray(result.data) ? result.data[0] : result.data});
  }

  if (url.pathname === '/api/evolution/status' && req.method === 'GET') {
    const base = (env.WHATSAPP_SEND_URL || env.EVOLUTION_SEND_URL || '').split('/message/')[0];
    if (!base || !env.EVOLUTION_API_KEY || !env.EVOLUTION_INSTANCE_NAME) {
      return sendJson(res, 503, {ok: false, error: 'Evolution is not configured'});
    }
    try {
      const response = await fetch(`${base}/instance/connectionState/${env.EVOLUTION_INSTANCE_NAME}`, {
        headers: {apikey: env.EVOLUTION_API_KEY},
      });
      const text = await response.text();
      let data = text;
      try { data = text ? JSON.parse(text) : null; } catch {}
      return sendJson(res, response.ok ? 200 : response.status, {ok: response.ok, data});
    } catch (error) {
      return sendJson(res, 503, {ok: false, error: error.message});
    }
  }

  return sendJson(res, 404, {ok: false, error: 'API route not found'});
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/CAFE_CRM_Dashboard.html';
  const filePath = path.normalize(path.join(root, pathname));
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
      return res.end('Not found');
    }
    res.writeHead(200, {'Content-Type': types[path.extname(filePath).toLowerCase()] || 'application/octet-stream'});
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (error) {
    return sendJson(res, 500, {ok: false, error: error.message});
  }
});

server.listen(port, () => {
  console.log(`Brew & Co server running at http://127.0.0.1:${port}`);
});
