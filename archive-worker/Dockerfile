# Archive replication worker (storage-tiering, plan 2).
# Multi-stage: restore+publish on the SDK image, run on the runtime image.
# Cross-compile rather than emulate — see the note in core-api/Dockerfile.
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0 AS build
# NO default value: a default SHADOWS the value buildkit injects, which
# silently produces x64 assemblies in an arm64 image ("The assembly
# architecture is not compatible with the current process architecture").
ARG TARGETARCH
WORKDIR /src

COPY archive-worker/ArchiveWorker.csproj archive-worker/
RUN dotnet restore -a $TARGETARCH archive-worker/ArchiveWorker.csproj

COPY archive-worker/ archive-worker/
RUN dotnet publish -a $TARGETARCH archive-worker/ArchiveWorker.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/runtime:10.0 AS runtime
WORKDIR /app
COPY --from=build /app ./
ENTRYPOINT ["dotnet", "ArchiveWorker.dll"]
