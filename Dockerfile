# syntax=docker/dockerfile:1
# Build stages run on the build machine's platform and cross-compile, so
# multi-architecture images don't need emulation.
FROM --platform=$BUILDPLATFORM node:24-alpine AS web
WORKDIR /src/apps/web
COPY apps/web/package.json apps/web/pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    corepack enable && pnpm install --frozen-lockfile
COPY apps/web/ ./
RUN pnpm build

FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS backend
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
ENV CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    LDFLAGS="-s -w -X github.com/nanaaikinson/spool/internal/version.Version=${VERSION}" && \
    go build -trimpath -ldflags="$LDFLAGS" -o /out/spool ./cmd/server && \
    go build -trimpath -ldflags="$LDFLAGS" -o /out/spool-demo ./cmd/demo

FROM alpine:3.24
# /data is owned by spool so a named volume mounted there starts writable.
RUN apk add --no-cache ca-certificates && addgroup -S spool && adduser -S spool -G spool && \
    install -d -o spool -g spool /data
WORKDIR /app
COPY --from=backend /out/ /app/
COPY --from=web /src/apps/web/dist /app/web
ENV SPOOL_STATIC_DIR=/app/web SPOOL_ADDR=0.0.0.0:8003
USER spool
EXPOSE 8003
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8003/ready || exit 1
ENTRYPOINT ["/app/spool"]
