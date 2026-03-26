FROM rust:1.85-slim AS builder

RUN apt-get update && apt-get install -y pkg-config && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY . .

RUN cargo build --release

# ─────────────────────────────────────────────────────────────────────────────

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/target/release/auth-service /usr/local/bin/auth-service

CMD ["auth-service"]
