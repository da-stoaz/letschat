# core-api — .NET / ASP.NET Core Identity service.
# Build context is the core-api/ directory.

# Always build on the NATIVE arch and cross-compile to $TARGETARCH: emulating an
# arm64 SDK under QEMU turns a ~1 min build into ~15. Both ARGs are injected by
# buildkit (TARGETARCH follows --platform, or the host when it is omitted).
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0 AS build
# NO default value: a default SHADOWS the value buildkit injects, which
# silently produces x64 assemblies in an arm64 image ("The assembly
# architecture is not compatible with the current process architecture").
ARG TARGETARCH
WORKDIR /src

# Restore first (cached unless the project file or pinned SDK changes).
COPY global.json ./
COPY src/CoreApi/CoreApi.csproj src/CoreApi/
RUN dotnet restore -a $TARGETARCH src/CoreApi/CoreApi.csproj

# Build + publish the service.
COPY src/ src/
RUN dotnet publish -a $TARGETARCH src/CoreApi/CoreApi.csproj -c Release -o /app --no-restore

# ─────────────────────────────────────────────────────────────────────────────

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app ./

# In a container, bind all interfaces; the published port is mapped by compose.
ENV AUTH_BIND=0.0.0.0:8787
EXPOSE 8787

ENTRYPOINT ["dotnet", "CoreApi.dll"]
