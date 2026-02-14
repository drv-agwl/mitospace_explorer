# Deploy MitoSpace Explorer (GitHub → Render → Netlify)

This guide does everything in order: put the project on GitHub, deploy the backend on Render, then deploy the frontend on Netlify and connect it to the backend. No prior experience required.

**If you already have a version on Netlify and a domain you want to use:**  
- Point that existing Netlify site at this repo/branch and set **`VITE_API_URL`** (see **You already have a Netlify site**).  
- Add your domain in Netlify and set **`CORS_ORIGINS`** on the backend to your domain (see **Using your custom domain**).

---

## What needs to be on GitHub?

Yes, Netlify (and Render) work by connecting to a Git repo. **Use GitHub** for this guide.

**You should have on GitHub:**

- All **source code**: `src/`, `server/`, `scripts/`, `public/`, etc.
- **Config files**: `package.json`, `netlify.toml`, `server/requirements.txt`, etc.
- **Backend data** the server needs at runtime:
  - `data/filtered/umap_points.npy`
  - `data/filtered/mitotnt_features.csv`
  - Optional: `data/filtered/umap_reducer.pkl` (if you use it)

**You should NOT commit:**

- **`.env`** – already in `.gitignore`; it may contain local API URLs.
- **`data/filtered/embeddings.npy`** – too large for GitHub (over 100 MB); the backend does not need it to run.
- **`node_modules/`**, **`dist/`** – ignored; built on Netlify/Render.

So: push your project to GitHub **except** the files above. The repo’s `.gitignore` is set so that `.env` and `data/filtered/embeddings.npy` are not pushed.

---

## Step 1: Put the project on GitHub

### 1.1 Create a GitHub account (if you don’t have one)

- Go to [github.com](https://github.com) and sign up.

### 1.2 Create a new repository on GitHub

1. Click **“+”** (top right) → **“New repository”**.
2. **Repository name:** e.g. `mitospace_explorer`.
3. Choose **Public**.
4. **Do not** check “Add a README” (you already have code locally).
5. Click **“Create repository”**.

### 1.3 Push your local project to GitHub

**Before you push:** The backend needs `data/filtered/umap_points.npy` and `data/filtered/mitotnt_features.csv` in the repo so Render can run. If `data/` is currently untracked, `git add .` will add it (except `embeddings.npy`, which is ignored).

In a terminal, from your project folder (e.g. `mitospace_explorer`):

```bash
cd /Users/dhruvagarwal/4DCELL/mitospace_explorer

# If this folder isn’t a git repo yet:
# git init

# Add GitHub as remote (replace YOUR_USERNAME and REPO_NAME with yours)
git remote add origin https://github.com/YOUR_USERNAME/mitospace_explorer.git

# Stage everything (respects .gitignore, so .env and embeddings.npy stay local)
git add .
# If data/ was never committed, this adds data/filtered/ except embeddings.npy
git status   # optional: check that .env and data/filtered/embeddings.npy are not listed

git commit -m "Add MitoSpace Explorer app for deploy"
git branch -M main
git push -u origin main
```

If GitHub asks for login, use a **Personal Access Token** as the password (GitHub → Settings → Developer settings → Personal access tokens).

After this, your code and the required `data/filtered/` files (except `embeddings.npy`) should be on GitHub.

---

## Step 2: Deploy the backend on Render

Render will run your FastAPI server and give you a public URL. Netlify will call that URL.

### 2.1 Create a Render account and connect GitHub

1. Go to [render.com](https://render.com) and sign up (e.g. “Sign up with GitHub”).
2. Authorize Render to access your GitHub account and repositories.

### 2.2 Create a new Web Service from your repo

1. **Dashboard** → **“New +”** → **“Web Service”**.
2. Connect the repo **`mitospace_explorer`** (or whatever you named it). If you don’t see it, click **“Configure account”** and grant access to that repo.
3. Click **“Connect”** next to the repo.

### 2.3 Configure the service

Use these settings (Render will pre-fill some from the repo):

| Field | Value |
|--------|--------|
| **Name** | e.g. `mitospace-api` (this becomes part of the URL). |
| **Region** | Choose one close to you. |
| **Branch** | `main` (or your default branch). |
| **Root Directory** | Leave **empty** (project root). |
| **Runtime** | **Python 3**. |
| **Build Command** | `pip install -r server/requirements.txt` |
| **Start Command** | `uvicorn server.main:app --host 0.0.0.0 --port $PORT` |

- **Instance type:** Free is enough to start.

Then click **“Create Web Service”**. Render will clone the repo, run the build command, then run the start command. The first deploy can take a few minutes.

### 2.4 Get the backend URL

When the deploy finishes, the top of the page shows the service URL, e.g.:

**`https://mitospace-api.onrender.com`**

- Open it in the browser and add `/api/health`, e.g.  
  **`https://mitospace-api.onrender.com/api/health`**  
  You should see JSON with `umap_points_loaded`, `features`, etc.
- Copy the **base URL** (no trailing slash), e.g. `https://mitospace-api.onrender.com`. You’ll use it in the next step.

If the deploy fails, check the **Logs** tab. Common issues: wrong branch, wrong root directory, or missing `data/filtered/umap_points.npy` / `mitotnt_features.csv` in the repo.

---

## Step 3: Deploy the frontend on Netlify

Netlify will build your Vite app and host it. It needs to know the backend URL so the frontend can call your API.

### 3.1 Create a Netlify account and connect GitHub

1. Go to [app.netlify.com](https://app.netlify.com) and sign up (e.g. “Sign up with GitHub”).
2. Authorize Netlify to access your GitHub account and repositories.

### 3.2 Add a new site from Git

1. **“Add new site”** → **“Import an existing project”**.
2. **“Connect to Git provider”** → **GitHub**.
3. Pick the **`mitospace_explorer`** repo (and authorize if asked).
4. Netlify will read `netlify.toml` and show:
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
   - **Branch:** `main` (or your default)

**Do not click “Deploy” yet.** Set the API URL first.

### 3.3 Set the backend URL (important)

1. Open **“Site configuration”** (or **“Options”** / **“Environment variables”**) so you can add a variable **before** the first build.
2. **“New variable”** / **“Add a variable”**:
   - **Key:** `VITE_API_URL`
   - **Value:** the Render URL from Step 2.4, e.g. `https://mitospace-api.onrender.com`  
   (No trailing slash.)
3. Save.

### 3.4 Deploy

Click **“Deploy site”** (or **“Trigger deploy”**). Netlify will run `npm run build`; the built app will have the backend URL baked in. When the deploy is done, your app will be at:

**`https://<something>.netlify.app`**

(e.g. `https://mitospace-explorer.netlify.app`). Open it and try the app; the 4D view and semantic slider should call your Render backend.

---

## You already have a Netlify site

If a version of this app is **already deployed** on Netlify and you want that same site to serve this project (or this branch):

1. In **Netlify**: open the existing site → **Site configuration** → **Build & deploy** → **Continuous deployment**.
2. **Connect to a different repo or branch** if needed:
   - **Repository:** point it to the repo that contains this code (e.g. `mitospace_explorer`).
   - **Branch:** set to the branch you push to (e.g. `main` or `improved_ui`).
3. **Environment variables:** ensure **`VITE_API_URL`** is set to your backend URL (e.g. your Render URL). If you add or change it, **trigger a new deploy** so the frontend is rebuilt.
4. **Trigger deploy:** **Deploys** → **Trigger deploy** → **Deploy site** (or push to the connected branch to auto-deploy).

After the deploy, the existing Netlify URL (and your custom domain, if added) will serve the new build.

---

## Using your custom domain

You can serve the app at a domain you own (e.g. `explorer.yourdomain.com` or `yourdomain.com`) on the **same** Netlify site.

### 1. Add the domain in Netlify

1. Open your site in Netlify → **Site configuration** → **Domain management**.
2. Click **Add domain** or **Add custom domain**.
3. Enter your domain (e.g. `explorer.yourdomain.com` or `yourdomain.com`) and follow the steps.
4. Netlify will show you what to set at your DNS provider (e.g. an **A** record or **CNAME**).

### 2. Point DNS to Netlify

At the place where you bought the domain (GoDaddy, Namecheap, Google Domains, Cloudflare, etc.):

- **Subdomain** (e.g. `explorer.yourdomain.com`): add a **CNAME** record: name `explorer` (or the subdomain you use), value `your-site-name.netlify.app` (Netlify shows this).
- **Apex domain** (e.g. `yourdomain.com`): Netlify usually gives you an **A** record with an IP, or you can use their DNS (Netlify DNS) so they manage it.

Save the DNS changes; it can take a few minutes up to 48 hours to propagate.

### 3. Let the backend accept requests from your domain (CORS)

The backend only allows certain origins. For **`https://*.netlify.app`** it’s already allowed. For a **custom domain** you must add it explicitly:

1. In **Render**: open your backend service → **Environment** → add (or edit):
   - **Key:** `CORS_ORIGINS`
   - **Value:** your frontend URL with `https://` and no trailing slash, e.g. `https://explorer.yourdomain.com`  
   If you use both www and non-www, add both comma-separated: `https://yourdomain.com,https://www.yourdomain.com`
2. Save. Render will redeploy the service; after that, the browser will allow your custom-domain frontend to call the API.

Once DNS and CORS are set, open your custom domain in the browser; it should show the same app as the Netlify URL.

---

## Step 4: Quick checklist

| Step | What you did |
|------|----------------|
| 1 | Pushed the project to GitHub (code + `data/filtered` except `embeddings.npy`; no `.env`). |
| 2 | Deployed the backend on Render; got a URL like `https://mitospace-api.onrender.com`; checked `/api/health`. |
| 3 | Created a Netlify site from the same repo; set **`VITE_API_URL`** to the Render URL; deployed. |
| 4 | Opened the Netlify URL and confirmed the app loads and talks to the API. |

---

## If something goes wrong

- **Netlify build fails:** Check the build log. Often it’s a missing dependency or wrong Node version; we can add an explicit Node version in `netlify.toml` if needed.
- **Frontend loads but API errors / “Failed to fetch”:**  
  - Confirm `VITE_API_URL` in Netlify is exactly the Render URL (no trailing slash).  
  - Redeploy the Netlify site after changing `VITE_API_URL` (the value is fixed at build time).  
  - Open Render URL in the browser: `https://your-service.onrender.com/api/health` — it should return JSON.
- **Render deploy fails:** In the Render **Logs** tab, see if the error is about missing files (e.g. `data/filtered/umap_points.npy`). Those files must be in the repo (and not ignored).  
- **CORS errors in the browser:** The backend allows `https://*.netlify.app` by default. For a **custom domain**, set **`CORS_ORIGINS`** on Render to your frontend URL (e.g. `https://yourdomain.com`). See **Using your custom domain** above.

---

## Changing the backend URL later

1. In Netlify: **Site configuration** → **Environment variables** → edit **`VITE_API_URL`** to the new backend URL.
2. **Trigger deploy** (e.g. **Deploys** → **Trigger deploy** → **Deploy site**) so the frontend is rebuilt with the new URL.

---

## Summary

- **GitHub:** Holds your code and the `data/filtered` files the backend needs (not `.env`, not `embeddings.npy`).
- **Render:** Runs the Python backend and gives you an API URL.
- **Netlify:** Builds and hosts the frontend; you set **`VITE_API_URL`** to the Render URL so the app talks to your backend.

Once this is done, every push to `main` can automatically redeploy both the backend (Render) and the frontend (Netlify) if you left the default “Auto-Deploy” on.
