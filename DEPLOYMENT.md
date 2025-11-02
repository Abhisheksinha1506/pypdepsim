# Deployment Guide for pypdepsim

## ⚠️ GitHub Pages Limitation

**This project cannot be deployed to GitHub Pages** because:
- GitHub Pages only serves static files (HTML, CSS, JS)
- This project requires **server-side functionality**:
  - API routes (`/api/similar/[pkg]`, `/api/meta/[pkg]`, etc.)
  - Server-side API calls to PyPI and Libraries.io
  - In-memory caching (LRU Cache)
  - File system reads (cache files)

---

## ✅ Recommended: Deploy to Vercel (FREE)

[Vercel](https://vercel.com) is the best option for Next.js applications:

### Quick Setup:

1. **Install Vercel CLI** (optional, for local testing):
```bash
npm i -g vercel
```

2. **Deploy via GitHub** (Recommended):
   - Push your code to GitHub
   - Go to https://vercel.com
   - Click "Import Project"
   - Connect your GitHub repository
   - Vercel will auto-detect Next.js and deploy!

3. **Deploy via CLI**:
```bash
cd pypdepsim
vercel
```

### Environment Variables:

Add these in Vercel dashboard (Settings → Environment Variables):

```
LIBRARIES_IO_API_KEY=your-api-key-here  # Optional
PYPI_REQUEST_DELAY_MS=150
PYPI_MAX_RETRY_ATTEMPTS=5
```

### Build Settings:

Vercel auto-detects Next.js, but you can verify:
- **Framework Preset**: Next.js
- **Build Command**: `npm run build` (auto-detected)
- **Output Directory**: `.next` (auto-detected)
- **Install Command**: `npm install` (auto-detected)

### Data Files:

The `data/` directory will be included in the deployment. Make sure to:
- Download Libraries.io CSV before deploying: `npm run download-csv`
- Commit `data/reverseDeps.csv.json` if you want it in the deployment
- Or set up a build script to download data during build

---

## Alternative Hosting Options

### 1. **Netlify** (Also FREE)
- Supports Next.js with serverless functions
- Similar to Vercel, auto-detects Next.js
- [Netlify Docs](https://docs.netlify.com/frameworks/nextjs/)

### 2. **Railway** (FREE tier available)
- Full Node.js environment
- Good for apps needing persistent storage
- [Railway Docs](https://docs.railway.app/)

### 3. **Render** (FREE tier available)
- Auto-detects Next.js
- Simple deployment from GitHub
- [Render Docs](https://render.com/docs/deploy-nextjs-app)

### 4. **Cloudflare Pages** (FREE)
- **Note**: Requires Cloudflare Workers for API routes
- Would need to refactor API routes to Workers format

---

## If You REALLY Want GitHub Pages

You would need to **completely refactor** the project:

### Required Changes:

1. **Remove all API routes** (`app/api/` directory)
2. **Move all logic client-side**:
   - Make API calls directly from browser to PyPI/Libraries.io
   - Handle CORS issues (may need a proxy)
3. **Remove server-side features**:
   - In-memory LRU cache (use localStorage instead)
   - File system reads (pre-bundle all data)
4. **Use Next.js static export**:
   - Update `next.config.ts`:
   ```typescript
   const nextConfig = {
     output: 'export',
     trailingSlash: true,
   };
   ```
5. **Pre-build all data**:
   - Generate static JSON files for all packages
   - Include in build output

### Disadvantages:
- ❌ CORS issues with external APIs
- ❌ Slower (no server-side caching)
- ❌ Larger bundle size (all logic client-side)
- ❌ No real-time data fetching
- ❌ Need to rebuild for data updates

**Recommendation**: Don't do this. Use Vercel instead - it's free and works perfectly!

---

## Deployment Checklist

Before deploying to Vercel (or any platform):

- [ ] Push code to GitHub
- [ ] Install dependencies: `npm install`
- [ ] Test build locally: `npm run build`
- [ ] Download Libraries.io CSV: `npm run download-csv`
- [ ] Test locally: `npm run dev`
- [ ] Set environment variables (if using Libraries.io API)
- [ ] Deploy to Vercel
- [ ] Test production deployment
- [ ] Set up custom domain (optional)

---

## Troubleshooting

### Build Fails:
- Check Node.js version (should be 18+)
- Ensure all dependencies are in `package.json`
- Check build logs for specific errors

### API Routes Not Working:
- Verify platform supports Next.js API routes
- Check environment variables are set
- Verify CORS settings if making external API calls

### Data Files Missing:
- Ensure `data/` directory is committed to Git
- Or set up build script to download data during build

---

## Quick Deploy Commands

```bash
# Install Vercel CLI
npm i -g vercel

# Login to Vercel
vercel login

# Deploy (from pypdepsim directory)
cd pypdepsim
vercel

# Deploy to production
vercel --prod
```

---

## Summary

✅ **Best Option**: Deploy to **Vercel** (free, easy, perfect for Next.js)
✅ **Alternative**: Netlify, Railway, or Render (also good)
❌ **Not Recommended**: GitHub Pages (requires major refactoring)

