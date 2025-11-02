# API Testing Guide

## How to Test All APIs

### Method 1: Using the Test Script (Recommended)

```bash
# Make sure the server is running first
npm run dev

# In another terminal, run the test script
npm run test-apis
```

This will test all API endpoints automatically.

### Method 2: Manual Testing

Test each endpoint manually:

#### 1. Health Check
```bash
curl http://localhost:3000/api/health
```
**Expected**: `{"ok":true}`

#### 2. Popular Packages
```bash
curl http://localhost:3000/api/categories/popular
```
**Expected**: `{"category":"popular","packages":["requests","numpy",...]}`

#### 3. Package Metadata
```bash
curl http://localhost:3000/api/meta/requests
```
**Expected**: Package metadata with download stats

#### 4. Similar Packages
```bash
curl http://localhost:3000/api/similar/requests?limit=5
```
**Expected**: `{"similar":[...],"cooccur":[...]}`

#### 5. Reverse Dependencies
```bash
curl http://localhost:3000/api/reverse-deps/requests
```
**Expected**: `{"pkg":"requests","dependents":[...],"count":N}`

#### 6. Libraries.io Config (GET)
```bash
curl http://localhost:3000/api/config/libraries-io
```
**Expected**: `{"configured":false,"hasKey":false,"source":"none"}`

#### 7. Libraries.io Config (POST - Set API Key)
```bash
curl -X POST http://localhost:3000/api/config/libraries-io \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"your-api-key"}'
```
**Expected**: `{"success":true,"message":"API key configured successfully"}`

#### 8. Libraries.io Config (DELETE - Remove API Key)
```bash
curl -X DELETE http://localhost:3000/api/config/libraries-io
```
**Expected**: `{"success":true,"message":"API key removed successfully"}`

## API Endpoints Summary

| Endpoint | Method | Purpose | Status Code |
|----------|--------|---------|-------------|
| `/api/health` | GET | Health check | 200 |
| `/api/categories/popular` | GET | Popular packages list | 200 |
| `/api/meta/[pkg]` | GET | Package metadata + downloads | 200 |
| `/api/similar/[pkg]` | GET | Similar & co-occurring packages | 200 |
| `/api/reverse-deps/[pkg]` | GET | Reverse dependencies | 200 |
| `/api/config/libraries-io` | GET | Check API key status | 200 |
| `/api/config/libraries-io` | POST | Set API key | 200 |
| `/api/config/libraries-io` | DELETE | Remove API key | 200 |

## Testing with Different Test Package

You can test with different packages:

```bash
# Test with django
curl http://localhost:3000/api/similar/django?limit=10

# Test with numpy
curl http://localhost:3000/api/meta/numpy
```

## UI Configuration

You can also configure the API key via the UI:

1. Open the application in your browser
2. You'll see a "Libraries.io API Key" section at the top
3. Click "Configure API Key"
4. Enter your API key
5. Click "Save"

The API key status will be displayed in the UI.




