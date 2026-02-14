# Deploy the backend on Render (step-by-step)

This guide only deploys the **Python API** (FastAPI) so you get a URL like `https://something.onrender.com`. Your Netlify frontend will call this URL.

**Before you start:** Your code and `data/filtered/umap_points.npy` + `data/filtered/mitotnt_features.csv` must be on **GitHub** (branch `main` or the one you use). If you’re not sure, push first:

```bash
cd /Users/dhruvagarwal/4DCELL/mitospace_explorer
git add .
git status   # ensure data/filtered/embeddings.npy is NOT listed (it’s in .gitignore)
git commit -m "Prepare for deploy"
git push origin main
```

(Use your branch name instead of `main` if different, e.g. `improved_ui`.)

---

## Step 1: Open Render and sign in with GitHub

1. Go to **https://render.com** in your browser.
2. Click **“Get Started for Free”** (or **“Sign In”** if you have an account).
3. Choose **“Sign up with GitHub”** (or **“Log in with GitHub”**).
4. Authorize Render when GitHub asks. Render will be able to see your repositories.

---

## Step 2: Create a new Web Service

1. On the Render **Dashboard**, click the **“New +”** button (top right).
2. Click **“Web Service”** (a service that runs 24/7 and gets a public URL).

---

## Step 3: Connect your GitHub repo

1. Under **“Connect a repository”** you’ll see a list of repos. If you don’t see **`mitospace_explorer`**:
   - Click **“Configure account”** or **“Connect GitHub”** and grant Render access to the repo (or all repos).
   - Then select **`mitospace_explorer`** (or **`drv-agwl/mitospace_explorer`**).
2. Click **“Connect”** next to **mitospace_explorer**.

---

## Step 4: Fill in the service settings

Render will show a form. Use these values **exactly** (copy-paste where possible).

| Field | What to enter |
|--------|----------------|
| **Name** | `mitospace-api` (or any name you like; it becomes part of the URL). |
| **Region** | Pick one (e.g. **Oregon (US West)** or **Frankfurt (EU Central)**). |
| **Branch** | `main` (or your default branch, e.g. `improved_ui`). |
| **Root Directory** | Leave **empty**. |
| **Runtime** | **Python 3**. |
| **Build Command** | `pip install -r server/requirements.txt` |
| **Start Command** | `uvicorn server.main:app --host 0.0.0.0 --port $PORT` |

- **Instance Type:** leave **Free** (or pick a paid plan if you prefer).

Do **not** add a Dockerfile or change the root directory unless you know what you’re doing.

---

## Step 5: (Optional) Add environment variables

You can add these **now** or later:

- **CORS_ORIGINS** – only if your frontend uses a **custom domain**.  
  Value: your frontend URL, e.g. `https://yourdomain.com` (no trailing slash).  
  If you only use the Netlify URL (`https://something.netlify.app`), you can leave this blank.

Click **“Advanced”** if you don’t see the environment variables section; add the key and value there.

---

## Step 6: Create the service

1. Click **“Create Web Service”** at the bottom.
2. Render will:
   - Clone your repo from the branch you chose.
   - Run the **Build Command** (`pip install -r server/requirements.txt`).
   - Run the **Start Command** (`uvicorn server.main:app ...`).
3. Watch the **Logs** tab. The first deploy can take **3–5 minutes**. You should see:
   - Build: `Successfully installed ...`
   - Start: `[startup] Loaded UMAP points: ...` and `[startup] Loaded feature values: ...`
4. When the status at the top turns **green** (“Live” or “Deployed”), the backend is running.

---

## Step 7: Get your backend URL

1. At the **top** of the service page, Render shows the URL, e.g.:
   - **`https://mitospace-api.onrender.com`**
2. **Copy that URL** (no trailing slash). You’ll use it in Netlify as **`VITE_API_URL`**.
3. Test it in the browser:
   - Open: `https://mitospace-api.onrender.com/api/health`
   - You should see JSON like: `{"umap_points_loaded": true, "point_count": 13000, "features": ["Fragment Length", "Segment Length"], ...}`

If you see that JSON, the backend is deployed and ready for the frontend.

---

## If the deploy fails

- **Logs say “No such file or directory” for `umap_points.npy` or `mitotnt_features.csv`**  
  Those files must be in the repo on the branch you selected. Push them and redeploy:
  ```bash
  git add data/filtered/umap_points.npy data/filtered/mitotnt_features.csv
  git commit -m "Add backend data"
  git push origin main
  ```
  Then in Render: **Manual Deploy** → **Deploy latest commit**.

- **Build fails on `pip install`**  
  Check the log for the failing package (e.g. `numba`, `llvmlite`). The `server/requirements.txt` in the repo should list compatible versions; if you changed it, push and redeploy.

- **Service starts then crashes**  
  In the **Logs** tab, scroll to the **start** logs and read the Python error. Often it’s a missing file path (e.g. wrong branch so `data/filtered/` is empty).

- **“Application failed to respond”**  
  On the **free** tier, the service may **spin down** after 15 minutes of no traffic. The first request after that can take 30–60 seconds (cold start). That’s normal; refresh once and it should respond.

---

## Summary

| Step | What you did |
|------|----------------|
| 1 | Signed in to Render with GitHub. |
| 2 | Created a **Web Service**. |
| 3 | Connected the **mitospace_explorer** repo. |
| 4 | Set **Build:** `pip install -r server/requirements.txt`, **Start:** `uvicorn server.main:app --host 0.0.0.0 --port $PORT`, **Branch:** `main` (or yours). |
| 5 | (Optional) Set **CORS_ORIGINS** to your custom domain. |
| 6 | Clicked **Create Web Service** and waited for the deploy. |
| 7 | Copied the URL (e.g. `https://mitospace-api.onrender.com`) and tested `/api/health`. |

**Next:** In Netlify, set **`VITE_API_URL`** to this URL (no trailing slash), then trigger a new deploy so the frontend uses the new backend.
