# --- Stage 1: deps + build ---
FROM node:22-alpine AS builder
WORKDIR /app

# 安装 openssl (Prisma 运行所需)
RUN apk add --no-cache openssl libc6-compat

COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .
RUN mkdir -p public \
    && npx prisma generate \
    && npm run build

# --- Stage 2: runner ---
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apk add --no-cache openssl libc6-compat \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Next standalone 产物
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Prisma schema + 生成的 client + CLI + 迁移脚本 (容器内执行 migrate deploy)
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma

# 入口脚本: 迁移完再起服
COPY --from=builder --chown=nextjs:nodejs /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# 日志目录 (可被 volume 覆盖到宿主机)
RUN mkdir -p /app/logs && chown -R nextjs:nodejs /app/logs
ENV LOG_DIR=/app/logs

# 图像落盘目录 (public/generated/<uid>/*.png);volume 覆盖到宿主机后 rebuild 不丢历史图片
RUN mkdir -p /app/public/generated && chown -R nextjs:nodejs /app/public

USER nextjs
EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
