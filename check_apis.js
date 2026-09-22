const fs = require('fs');

function loadEnv(path = '.env.n8n') {
  const out = {};
  if (!fs.existsSync(path)) return out;
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

function ok(name, detail = '') {
  console.log(`PASS ${name}${detail ? ' - ' + detail : ''}`);
}

function warn(name, detail = '') {
  console.log(`WARN ${name}${detail ? ' - ' + detail : ''}`);
}

function fail(name, detail = '') {
  console.log(`FAIL ${name}${detail ? ' - ' + detail : ''}`);
}

async function request(name, url, options = {}) {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    if (res.ok) ok(name, `HTTP ${res.status}`);
    else fail(name, `HTTP ${res.status}: ${text.slice(0, 160).replace(/\s+/g, ' ')}`);
    return res;
  } catch (err) {
    fail(name, err.message);
    return null;
  }
}

async function groqModel(env) {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
    });
    if (!res.ok) return 'openai/gpt-oss-120b';
    const json = await res.json();
    const ids = (json.data || []).map(model => model.id);
    return ids.find(id => id === 'openai/gpt-oss-120b')
      || ids.find(id => id.includes('llama') && !id.includes('guard'))
      || ids.find(Boolean)
      || 'openai/gpt-oss-120b';
  } catch {
    return 'openai/gpt-oss-120b';
  }
}

async function main() {
  const env = loadEnv();

  if (!env.SUPABASE_SERVICE_ROLE_KEY && !env.SUPABASE_ANON_KEY) {
    warn('Supabase', 'missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY');
  } else if (!env.CAFE_API_BASE_URL) {
    warn('Supabase', 'missing CAFE_API_BASE_URL');
  } else {
    const supabaseHeaders = {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY}`,
      Accept: 'application/json',
    };
    const res = await fetch(env.CAFE_API_BASE_URL, { headers: supabaseHeaders }).catch(err => ({
      status: 'ERR',
      text: async () => err.message,
    }));
    if (res.status === 'ERR') fail('Supabase project reachable', await res.text());
    else ok('Supabase project reachable', `REST API responded with HTTP ${res.status}`);
    for (const table of ['orders', 'reservations', 'customers', 'menu_items', 'payments', 'feedback', 'cafe_tables']) {
      const url = `${env.CAFE_API_BASE_URL.replace(/\/$/, '')}/${table}?select=*&limit=1`;
      const tableRes = await fetch(url, { headers: supabaseHeaders }).catch(err => ({
        ok: false,
        status: 'ERR',
        text: async () => err.message,
      }));
      if (tableRes.ok) ok(`Supabase table ${table}`, `HTTP ${tableRes.status}`);
      else {
        const body = await tableRes.text();
        warn(`Supabase table ${table}`, `missing or blocked: ${tableRes.status} ${body.slice(0, 90).replace(/\s+/g, ' ')}`);
      }
    }
  }

  if (!env.SARVAM_API_KEY) {
    warn('Sarvam', 'missing SARVAM_API_KEY');
  } else {
    await request('Sarvam chat', 'https://api.sarvam.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'api-subscription-key': env.SARVAM_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sarvam-105b-conversations',
        messages: [{ role: 'user', content: 'Reply with JSON {"ok":true}' }],
        response_format: { type: 'json_object' },
        temperature: 0,
      }),
    });
  }

  if (!env.GROQ_API_KEY) {
    warn('Groq', 'missing GROQ_API_KEY');
  } else {
    const model = await groqModel(env);
    await request('Groq chat', 'https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Say ok' }],
        max_tokens: 8,
        temperature: 0,
      }),
    });
    ok('Groq model selected', model);
  }

  if (!env.EVOLUTION_API_KEY) {
    warn('Evolution', 'missing EVOLUTION_API_KEY');
  } else if (!env.EVOLUTION_INSTANCE_NAME) {
    warn('Evolution', 'missing EVOLUTION_INSTANCE_NAME');
  } else {
    const base = (env.WHATSAPP_SEND_URL || env.EVOLUTION_SEND_URL || '').split('/message/')[0];
    if (!base) {
      warn('Evolution', 'missing WHATSAPP_SEND_URL or EVOLUTION_SEND_URL');
    } else {
      await request('Evolution instance state', `${base}/instance/connectionState/${env.EVOLUTION_INSTANCE_NAME}`, {
        headers: { apikey: env.EVOLUTION_API_KEY },
      });
    }
  }

  if (!env.PAYMENT_CREATE_URL) warn('Payment API', 'not configured yet');
  if (!env.KITCHEN_WEBHOOK) warn('Kitchen webhook', 'not configured yet');
  if (!env.MANAGER_ALERT_WEBHOOK) warn('Manager alert webhook', 'not configured yet');
}

main().catch(err => fail('Diagnostics', err.message));
