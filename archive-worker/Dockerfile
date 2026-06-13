# Archive replication worker (storage-tiering, plan 2).
# Multi-stage: restore+publish on the SDK image, run on the runtime image.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY archive-worker/ArchiveWorker.csproj archive-worker/
RUN dotnet restore archive-worker/ArchiveWorker.csproj

COPY archive-worker/ archive-worker/
RUN dotnet publish archive-worker/ArchiveWorker.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/runtime:10.0 AS runtime
WORKDIR /app
COPY --from=build /app ./
ENTRYPOINT ["dotnet", "ArchiveWorker.dll"]
