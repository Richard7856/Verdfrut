# @tripdrive/landing

Public landing page for `tripdrive.xyz`. Static HTML, no build step.

## Local preview

```bash
cd apps/landing
pnpm dev    # serves on http://localhost:4321
```

Or just open `index.html` directly in the browser.

## Deploy to Vercel

This is a **separate Vercel project** from `apps/platform`. One-time setup:

### 1. Create new Vercel project

In the Vercel dashboard:
- **Import Git Repository** → choose `Verdfrut`
- **Root Directory** → `apps/landing`
- **Framework Preset** → "Other"
- **Build Command** → leave empty (or `echo skip`)
- **Output Directory** → `.`
- **Install Command** → leave empty

Deploy. You should see the landing at the auto-assigned `.vercel.app` URL.

### 2. Connect the apex domain

In the new project's **Settings → Domains**:
1. Add `tripdrive.xyz` (apex)
2. Add `www.tripdrive.xyz` (will auto-redirect to apex)

If `tripdrive.xyz` was previously assigned to the platform project, Vercel will ask to **transfer** it — confirm.

### 3. Reassign platform to `app.tripdrive.xyz`

In the `platform` Vercel project's **Settings → Domains**:
1. Add `app.tripdrive.xyz`
2. Remove `tripdrive.xyz` if it was assigned there (already transferred above)

DNS resolves automatically since the nameservers are already Vercel's (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`).

### 4. Verify

```bash
curl -I https://tripdrive.xyz           # should serve the landing
curl -I https://www.tripdrive.xyz       # should 301 to https://tripdrive.xyz
curl -I https://app.tripdrive.xyz       # should serve the platform app
```

## Editing the content

The entire landing is a single `index.html` file (CSS, scripts and JSON-LD inlined). Edit it directly.

## Demo request endpoint

The form posts to `/api/demo-request` (stubbed — currently fails silently and shows the success modal). To wire it up:

- **Option A**: deploy a Vercel Function in this same project at `api/demo-request.ts` that forwards to Resend/Postmark/email.
- **Option B**: redirect the form action to the platform API (e.g. `https://app.tripdrive.xyz/api/public/demo-request`) and handle there.

For now it just collects the data and shows success — fine for soft launch.
