# How to Add Libraries.io API Key

## Quick Setup

### Method 1: Via API Endpoint (Recommended)

```bash
curl -X POST http://localhost:3000/api/config/libraries-io \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "your-api-key-here"}'
```

### Method 2: Manual Setup

Add to `.env.local` file in project root:

```bash
LIBRARIES_IO_API_KEY=your-api-key-here
```

## Check Status

```bash
curl http://localhost:3000/api/config/libraries-io
```

## Remove Key

```bash
curl -X DELETE http://localhost:3000/api/config/libraries-io
```

## Get Your API Key

1. Sign up at https://libraries.io
2. Go to your account settings
3. Generate an API key
4. Copy the key and use one of the methods above

