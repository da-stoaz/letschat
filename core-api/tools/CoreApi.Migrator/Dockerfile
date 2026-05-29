# CoreApi.Migrator — one-shot data migration from the legacy auth-service
# SQLite database into the core-api PostgreSQL `auth` database.
#
# Build context is the core-api/ directory (the tool depends on the CoreApi
# project for the AppDbContext / ApplicationUser model).

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY global.json ./
COPY src/CoreApi/CoreApi.csproj src/CoreApi/
COPY tools/CoreApi.Migrator/CoreApi.Migrator.csproj tools/CoreApi.Migrator/
RUN dotnet restore tools/CoreApi.Migrator/CoreApi.Migrator.csproj

COPY src/ src/
COPY tools/ tools/
RUN dotnet publish tools/CoreApi.Migrator/CoreApi.Migrator.csproj \
    -c Release -o /app --no-restore

# ─────────────────────────────────────────────────────────────────────────────

FROM mcr.microsoft.com/dotnet/runtime:10.0
WORKDIR /app
COPY --from=build /app ./

# Defaults assume the operator mounts the legacy SQLite at /data/auth.db and
# supplies the target Postgres URL via AUTH_DATABASE_URL. Override with
# `docker run … --sqlite /other/path --postgres "Host=…"`.
ENTRYPOINT ["dotnet", "CoreApi.Migrator.dll", "--sqlite", "/data/auth.db"]
