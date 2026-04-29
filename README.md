# AI Project Manager Assistant

Production-ready SaaS for multi-project planning, execution monitoring, AI insights, reporting, and decision support.

## Docs
- docs/api-spec.md
- docs/data-model.md
- docs/deployment.md

## Deployment

### Backend (Render)
1. Create a new Web Service from the `backend` folder.
2. Set the Start Command to:
	`gunicorn wsgi:app -c gunicorn.conf.py`
3. Set environment variables (recommended minimum):
	- `APP_ENV=production`
	- `APP_VERSION=1.0.0`
	- `DATA_PATH=./data/data.json`
	- `LOG_LEVEL=info`
	- `CORS_ALLOWED_ORIGINS=https://<your-vercel-domain>`
4. Deploy and note the Render service URL (e.g., `https://<service>.onrender.com`).

### Frontend (Vercel)
1. Deploy the `frontend` folder as a static site.
2. Update [frontend/vercel.json](frontend/vercel.json) to point rewrites to the Render URL:
	- `https://<service>.onrender.com/api/$1`
3. Redeploy the frontend.

### Deploy Order
1. Deploy backend to Render first and confirm `/api/v1/health` is live.
2. Update Vercel rewrite to the backend URL.
3. Deploy frontend to Vercel and validate API connectivity from the dashboard.
