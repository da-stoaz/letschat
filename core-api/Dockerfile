# core-api — .NET / ASP.NET Core Identity service.
# Build context is the core-api/ directory.

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Restore first (cached unless the project file or pinned SDK changes).
COPY global.json ./
COPY src/CoreApi/CoreApi.csproj src/CoreApi/
RUN dotnet restore src/CoreApi/CoreApi.csproj

# Build + publish the service.
COPY src/ src/
RUN dotnet publish src/CoreApi/CoreApi.csproj -c Release -o /app --no-restore

# ─────────────────────────────────────────────────────────────────────────────

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app ./

# In a container, bind all interfaces; the published port is mapped by compose.
ENV AUTH_BIND=0.0.0.0:8787
EXPOSE 8787

ENTRYPOINT ["dotnet", "CoreApi.dll"]
