FROM golang:1.24-bookworm AS builder

WORKDIR /app

COPY apps/wa-core/go.mod ./go.mod
COPY apps/wa-core/go.sum ./go.sum

RUN go mod download

COPY apps/wa-core/ ./

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/wa-core ./cmd/server

FROM debian:bookworm-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    tzdata \
    wget \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --uid 10001 appuser

WORKDIR /app

ENV PORT=3333
ENV DATABASE_URL=postgres://postgres:postgres@postgres:5432/pulse_hub?sslmode=disable
ENV REDIS_URL=redis://redis:6379/0

COPY --from=builder /out/wa-core /app/wa-core

RUN chown -R appuser:appuser /app

USER appuser

EXPOSE 3333

CMD ["/app/wa-core"]
