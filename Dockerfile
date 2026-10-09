FROM node:24-alpine AS web
WORKDIR /src/apps/web
COPY apps/web/package.json apps/web/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY apps/web/ ./
RUN pnpm build

FROM golang:1.27-alpine AS backend
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/spool ./cmd/server && \
    CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/spool-demo ./cmd/demo

FROM alpine:3.23
RUN apk add --no-cache ca-certificates && addgroup -S spool && adduser -S spool -G spool
WORKDIR /app
COPY --from=backend /out/ /app/
COPY --from=web /src/apps/web/dist /app/web
ENV SPOOL_STATIC_DIR=/app/web SPOOL_ADDR=0.0.0.0:8080
USER spool
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/ready || exit 1
ENTRYPOINT ["/app/spool"]
