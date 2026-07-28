# syntax=docker/dockerfile:1

# Сборка один раз, рантайм — только готовый standalone-вывод Next.js.
# Это заметно ускоряет деплой в Timeweb Cloud: раньше зависимости
# ставились дважды (full + prod), теперь — один install в builder.
FROM node:24-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
RUN pnpm install --frozen-lockfile --prefer-offline

COPY . .
RUN pnpm build

FROM node:24-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV TMPDIR=/tmp

RUN groupadd --system --gid 1001 nextjs \
    && useradd --system --uid 1001 --gid nextjs nextjs \
    && mkdir -p /tmp && chmod 1777 /tmp

COPY --from=builder --chown=nextjs:nextjs /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./

USER nextjs

EXPOSE 3000

CMD ["sh", "-c", "exec node server.js"]
