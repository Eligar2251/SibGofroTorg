# syntax=docker/dockerfile:1

# Сборка один раз, рантайм — только готовый standalone-вывод Next.js.
# Это заметно ускоряет деплой в Timeweb Cloud: раньше зависимости
# ставились дважды (full + prod), теперь — один install в builder.
#
# ВАЖНО для Timeweb Cloud (РФ): deb.debian.org часто недоступен из-за ТСПУ / IPv6
# (см. логи: Cannot initiate connection to deb.debian.org, Network is unreachable).
# Поэтому в рантайме НЕ ставим системные пакеты через apt-get. Healthcheck
# реализован на чистом Node (fetch), curl/wget не требуются. Если пакеты
# всё же понадобятся — используйте блок с яндекс-зеркалом ниже.

FROM node:24-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NEXT_TELEMETRY_DISABLED=1
ENV CI=true
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate

FROM base AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
# Ускоряем и делаем установку устойчивее к сети в РФ: retries + offline-cache
RUN pnpm config set fetch-retries 5 && \
    pnpm config set fetch-retry-mintimeout 20000 && \
    pnpm config set fetch-retry-maxtimeout 120000 && \
    pnpm install --frozen-lockfile --prefer-offline

COPY . .
RUN pnpm build

FROM node:24-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV TMPDIR=/tmp

RUN groupadd --system --gid 1001 nextjs \
    && useradd --system --uid 1001 --gid nextjs nextjs \
    && mkdir -p /tmp && chmod 1777 /tmp

# --- Системные зависимости НЕ ставим по умолчанию ---
# Если нужен curl/wget для healthcheck или отладки — раскомментируйте
# устойчивый вариант с fallback на яндекс-зеркало и невлиянием на сборку:
#
# RUN set -eux; \
#     if ! apt-get update -o Acquire::Retries=5 -o Acquire::http::Timeout=15; then \
#       sed -i 's|deb.debian.org|mirror.yandex.ru|g' /etc/apt/sources.list /etc/apt/sources.list.d/* 2>/dev/null || true; \
#       sed -i 's|security.debian.org|mirror.yandex.ru/debian-security|g' /etc/apt/sources.list /etc/apt/sources.list.d/* 2>/dev/null || true; \
#       echo "deb http://mirror.yandex.ru/debian/ bookworm main" > /etc/apt/sources.list; \
#       echo "deb http://mirror.yandex.ru/debian/ bookworm-updates main" >> /etc/apt/sources.list; \
#       echo "deb http://mirror.yandex.ru/debian-security bookworm-security main" >> /etc/apt/sources.list; \
#       apt-get update -o Acquire::Retries=5; \
#     fi; \
#     apt-get install -y --no-install-recommends curl ca-certificates || true; \
#     rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=nextjs:nextjs /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./

USER nextjs

EXPOSE 3000

# Healthcheck без curl/wget — через Node fetch, не требует apt
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "exec node server.js"]
