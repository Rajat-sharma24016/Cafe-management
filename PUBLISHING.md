# Brew & Co Publishing Checklist

## Local production run

```powershell
cd "C:\Users\mamta\OneDrive\Desktop\cafe maganement"
& "C:\Users\mamta\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.js
```

Open:

```text
http://127.0.0.1:5180/
http://127.0.0.1:5180/QR_Table_Order.html?table=1
```

## Required before public deployment

1. Run `supabase_schema.sql` in Supabase SQL Editor.
2. Set environment variables from `.env.example` on your hosting provider.
3. Do not publish `.env.n8n`, `apis.txt`, or any service-role key to the browser.
4. Connect the Evolution `cafemain` instance by scanning its WhatsApp QR.
5. Configure Paytm or another payment provider in `PAYMENT_CREATE_URL`.

## API checks

```powershell
& "C:\Users\mamta\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" check_apis.js
```

Supabase table warnings disappear after the SQL schema is installed.
