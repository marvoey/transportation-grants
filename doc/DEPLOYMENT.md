# Deployment Guide

## Deployment Options

### Option 1: Local Development (Current Setup)

**Best For**: Testing, development, demo

**Setup**:
```bash
cd /Users/tae.youn.kim.oey/projects/webmcp
npm install
npm run build
npm run start:web
```

**Access**: http://localhost:3000

**Data Mode**: Mock (no API key needed)

### Option 2: Single Server Deployment

**Best For**: Internal use, small teams

**Architecture**:
```
Server
├── MCP Server (stdio) - For Claude
└── Web Server (HTTP:3000) - For browsers
```

**Setup**:
1. Clone repo to server
2. Install Node.js 18+
3. Configure `.env`
4. Build and start both servers

**Commands**:
```bash
# Terminal 1: MCP Server
npm start

# Terminal 2: Web Server
npm run start:web
```

**Or use PM2**:
```bash
npm install -g pm2
pm2 start ecosystem.config.js
```

### Option 3: Web-Only Deployment

**Best For**: Public access, production use

**Architecture**:
```
Nginx/Apache → Node.js (port 3000) → SAM.gov API
```

**Setup**:
1. Deploy web server only
2. Configure reverse proxy
3. Set up SSL certificate
4. Enable API mode

**Environment**:
```bash
DATA_SOURCE=api
SAM_API_KEY=<your-key>
WEB_PORT=3000
NODE_ENV=production
```

### Option 4: Containerized Deployment

**Best For**: Cloud deployment, scalability

**Docker Setup**:

Create `Dockerfile`:
```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start:web"]
```

Create `docker-compose.yml`:
```yaml
version: '3.8'
services:
  webmcp:
    build: .
    ports:
      - "3000:3000"
    env_file:
      - .env
    volumes:
      - ./.cache:/app/.cache
    restart: unless-stopped
```

**Deploy**:
```bash
docker-compose up -d
```

## Project discovery workspace (optional)

The project workspace (`PROJECT_DISCOVERY_ENABLED=true`) stores projects in one JSON file
(`PROJECT_DB_PATH`, default `.data/projects.json`). This changes what is safe above:

- **Run exactly one web instance.** The Option 2 PM2 example with `instances: 2` and the
  "Horizontal Scaling" section must not be used with this feature on: each instance would keep
  its own copy of the file and overwrite the other's writes.
- **The data is ephemeral.** It lives only as long as the file. For Docker, mount a volume for
  the directory (for example `- ./data-projects:/app/.data`); on Heroku, Cloud Run or any
  platform with an ephemeral filesystem, projects disappear on every restart or deploy.
- Back up by copying the file; roll back by setting `PROJECT_DISCOVERY_ENABLED=false`
  (the file is left alone).

All settings, limits and rollout steps: [PROJECT_DISCOVERY.md](./PROJECT_DISCOVERY.md).

## Configuration

### Environment Variables

**Production Settings**:

```bash
# Data Source
DATA_SOURCE=api  # Use real SAM.gov API

# SAM.gov API
SAM_API_KEY=your-actual-key
SAM_RATE_LIMIT_REQUESTS=1000  # Upgrade to federal account

# Web Server
WEB_PORT=3000
NODE_ENV=production

# CORS (restrict origins in production)
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# Caching
CACHE_DIR=/var/cache/webmcp
CACHE_ASSISTANCE_TTL_MS=604800000    # 7 days
CACHE_OPPORTUNITIES_TTL_MS=21600000  # 6 hours

# Logging
LOG_LEVEL=warn  # Less verbose in production

# Chat feature (optional — omit to disable /api/chat; the rest of the
# site works fine without it)
ANTHROPIC_API_KEY=your-anthropic-key
ANTHROPIC_MODEL=claude-sonnet-5
ANTHROPIC_MAX_TOKENS=1024
CHAT_RATE_LIMIT_REQUESTS=10      # per IP, protects against runaway API spend
CHAT_RATE_LIMIT_WINDOW_MS=60000

# Project discovery workspace (optional, off by default; single instance only —
# see "Project discovery workspace" above and PROJECT_DISCOVERY.md)
PROJECT_DISCOVERY_ENABLED=false
PROJECT_DB_PATH=/var/lib/webmcp/projects.json
PROJECT_ALLOWED_ORIGINS=https://yourdomain.com
```

**Development Settings**:

```bash
DATA_SOURCE=mock  # No API calls
WEB_PORT=3000
NODE_ENV=development
CORS_ORIGINS=*
LOG_LEVEL=debug

# Chat feature (optional)
ANTHROPIC_API_KEY=your-anthropic-key
```

### Obtaining API Keys

**SAM.gov API Key** (Required for production):

1. Visit: https://open.gsa.gov/api/get-opportunities-public-api/
2. Click "Get API Key"
3. Create SAM.gov account (free)
4. Navigate to account settings
5. Copy API key from API section
6. Add to `.env`: `SAM_API_KEY=your-key-here`

**Tiers**:
- **Public/Free**: 100 requests/day
- **Federal Account**: 1,000 requests/day (for government users)

### Security Hardening

**1. Environment Variables**
```bash
# Never commit .env to git
echo ".env" >> .gitignore

# Set secure file permissions
chmod 600 .env
```

**2. CORS Configuration**
```bash
# Production: Restrict origins
CORS_ORIGINS=https://yourdomain.com

# Development: Allow all
CORS_ORIGINS=*
```

**3. Rate Limiting**

Add Express rate limiter:
```javascript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api/', limiter);
```

**4. HTTPS/SSL**

Use reverse proxy (Nginx):
```nginx
server {
    listen 443 ssl http2;
    server_name grants.yourdomain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Process Management

### Using PM2 (Recommended)

**Install**:
```bash
npm install -g pm2
```

**Create `ecosystem.config.js`**:
```javascript
module.exports = {
  apps: [
    {
      name: 'webmcp-mcp',
      script: 'dist/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'webmcp-web',
      script: 'dist/web-index.js',
      instances: 2,
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        WEB_PORT: 3000
      }
    }
  ]
};
```

**Commands**:
```bash
# Start all
pm2 start ecosystem.config.js

# Status
pm2 status

# Logs
pm2 logs webmcp-web

# Restart
pm2 restart webmcp-web

# Stop
pm2 stop all

# Auto-start on boot
pm2 startup
pm2 save
```

### Using systemd

**Create `/etc/systemd/system/webmcp.service`**:
```ini
[Unit]
Description=WebMCP DOT Grants Server
After=network.target

[Service]
Type=simple
User=webmcp
WorkingDirectory=/opt/webmcp
ExecStart=/usr/bin/node dist/web-index.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

**Commands**:
```bash
sudo systemctl daemon-reload
sudo systemctl enable webmcp
sudo systemctl start webmcp
sudo systemctl status webmcp
```

## Monitoring

### Health Checks

**Endpoint**: `GET /api/health`

**Response**:
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "version": "1.0.0",
    "rateLimit": {
      "requests": 45,
      "limit": 100,
      "remaining": 55,
      "resetAt": "2026-10-08T00:00:00.000Z"
    }
  }
}
```

**Monitoring Script**:
```bash
#!/bin/bash
# health-check.sh

RESPONSE=$(curl -s http://localhost:3000/api/health)
STATUS=$(echo $RESPONSE | jq -r '.data.status')

if [ "$STATUS" != "ok" ]; then
    echo "Health check failed"
    # Send alert
    exit 1
fi
```

### Logging

**Application Logs**:
```bash
# PM2
pm2 logs webmcp-web --lines 100

# systemd
journalctl -u webmcp -f

# File logs (configure Winston)
tail -f /var/log/webmcp/access.log
```

**Log Rotation**:

Create `/etc/logrotate.d/webmcp`:
```
/var/log/webmcp/*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 webmcp webmcp
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
```

### Metrics

**Install Monitoring** (optional):
```bash
npm install express-prom-bundle
```

**Add to `src/web/api-server.ts`**:
```javascript
import promBundle from 'express-prom-bundle';

const metricsMiddleware = promBundle({
  includeMethod: true,
  includePath: true
});

app.use(metricsMiddleware);
```

**Expose metrics**: http://localhost:3000/metrics

**Grafana Dashboard**: Connect to Prometheus

## Scaling

### Horizontal Scaling

**Load Balancer** (Nginx):
```nginx
upstream webmcp_backend {
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
}

server {
    location / {
        proxy_pass http://webmcp_backend;
    }
}
```

**Multiple Instances**:
```bash
# Instance 1
WEB_PORT=3000 npm run start:web

# Instance 2
WEB_PORT=3001 npm run start:web

# Instance 3
WEB_PORT=3002 npm run start:web
```

### Caching Strategy

**1. Application Cache** (current):
- File-based in `.cache/` directory
- 6-hour TTL for opportunities
- Shared across instances (use NFS)

**2. Redis Cache** (recommended for production):

Install:
```bash
npm install redis ioredis
```

Replace file cache with Redis in `src/cache/cache-manager.ts`

**3. CDN for Static Files**:
- Upload `public/` to CDN
- Update asset URLs
- Reduce server load

## Backup and Recovery

### Cache Backup

**Automated Backup**:
```bash
#!/bin/bash
# backup-cache.sh

DATE=$(date +%Y%m%d)
tar -czf /backup/cache-$DATE.tar.gz .cache/
find /backup -name "cache-*.tar.gz" -mtime +7 -delete
```

**Cron Job**:
```cron
0 2 * * * /path/to/backup-cache.sh
```

### Database Backup (if implemented)

```bash
# PostgreSQL
pg_dump webmcp > backup-$(date +%Y%m%d).sql

# MongoDB
mongodump --db webmcp --out /backup/$(date +%Y%m%d)
```

## Performance Optimization

### Node.js Tuning

**Memory**:
```bash
NODE_OPTIONS="--max-old-space-size=2048" npm run start:web
```

**Cluster Mode**:
```javascript
// src/web/cluster.js
import cluster from 'cluster';
import os from 'os';

if (cluster.isPrimary) {
  const numCPUs = os.cpus().length;
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
} else {
  import('./web-index.js');
}
```

### Compression

**Enable gzip**:
```javascript
import compression from 'compression';
app.use(compression());
```

### Static File Caching

**Nginx**:
```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

## Troubleshooting

### Common Issues

**1. Port Already in Use**
```bash
# Find process
lsof -i :3000

# Kill process
kill -9 <PID>

# Or use different port
WEB_PORT=3001 npm run start:web
```

**2. Permission Errors**
```bash
# Fix cache directory permissions
chmod 755 .cache
chown -R $USER .cache
```

**3. Out of Memory**
```bash
# Increase Node.js memory
NODE_OPTIONS="--max-old-space-size=4096"
```

**4. Rate Limit Exhausted**
```bash
# Switch to mock data
DATA_SOURCE=mock

# Or clear rate limit cache
rm .cache/rate_limit_sam.json
```

### Debug Mode

**Enable Detailed Logging**:
```bash
LOG_LEVEL=debug npm run start:web
```

**Node.js Debugger**:
```bash
node --inspect dist/web-index.js
```

Then connect Chrome DevTools to `chrome://inspect`

## Maintenance

### Regular Tasks

**Daily**:
- Check health endpoint
- Review error logs
- Monitor rate limit usage

**Weekly**:
- Review cache hit rates
- Check disk space
- Update dependencies (`npm outdated`)

**Monthly**:
- Security updates (`npm audit fix`)
- Backup verification
- Performance review

### Updates

**Dependency Updates**:
```bash
# Check for updates
npm outdated

# Update safely
npm update

# Update to latest (breaking changes possible)
npm install <package>@latest

# Security patches
npm audit fix
```

**Application Updates**:
```bash
git pull
npm install
npm run build
pm2 restart webmcp-web
```

## Cloud Deployment Examples

### AWS (Elastic Beanstalk)

```bash
# Install EB CLI
pip install awsebcli

# Initialize
eb init -p node.js webmcp

# Create environment
eb create webmcp-prod

# Deploy
eb deploy

# Open
eb open
```

### Heroku

```bash
# Login
heroku login

# Create app
heroku create webmcp-grants

# Set config
heroku config:set SAM_API_KEY=your-key
heroku config:set DATA_SOURCE=api

# Deploy
git push heroku main

# Open
heroku open
```

### Google Cloud Platform (Cloud Run)

```bash
# Build container
gcloud builds submit --tag gcr.io/PROJECT/webmcp

# Deploy
gcloud run deploy webmcp \
  --image gcr.io/PROJECT/webmcp \
  --platform managed \
  --port 3000 \
  --set-env-vars SAM_API_KEY=your-key
```

## Support

**Issues**: Check logs first
**Errors**: Review troubleshooting section
**Questions**: Consult ARCHITECTURE.md and README.md
