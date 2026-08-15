using System.Net.Http.Json;
using System.Text.Json;
using CoreApi.Configuration;
using CoreApi.Data;
using CoreApi.Data.Archive;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// Boots an in-process copy of <c>CoreApi.Program</c> against an EF Core
/// InMemory database so endpoint behaviour can be exercised end-to-end without
/// touching PostgreSQL. Each factory instance gets its own InMemory database
/// name so test cases stay isolated.
/// </summary>
public sealed class LetsChatWebApplicationFactory : WebApplicationFactory<Program>
{
    /// <summary>Unique per-instance to keep cases from leaking into each other.</summary>
    private readonly string _databaseName = $"letschat-tests-{Guid.NewGuid():N}";

    /// <summary>A throwaway RSA key so the OIDC issuer service has a stable signer in tests.</summary>
    private const string TestOidcPrivateKeyPem =
        "-----BEGIN PRIVATE KEY-----\n" +
        "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDhmLkazjWH/AN4\n" +
        "tRBkhKCHRx5ltcy8KCmgOVi9KAIjIOGFjyYomX8mGEoMW3Cueayjr00HBadVvRTB\n" +
        "zM5d+hI3D5dwiG7MI7exOw6U+KqAVxtPpW1e0oDQvh+GTOkOEP1veGdNlIejydlM\n" +
        "AFpcFW8rcg/wXZ8WxXstRZz63vLkQOvmMx0GnrXooGHmcMe1yl49fKgvLS2OoESp\n" +
        "snI6a9NbTEsQdYHQwYZUmxPsyuBHdCbtpV4uyQ+2C2aauR7KSTWN24oI2+7j1bwk\n" +
        "wdg0t4atsRmOkXG5a0CxTWFns/Prf5zRGIMGMqLIKM9g+0PIvnMVjXRwchL2hqm9\n" +
        "V6DgeVHlAgMBAAECggEAB853n/2rwja5I10B92B+3OoxRewVF3ESWQOIVmoDLOuv\n" +
        "MiZ3zRGGt1mW0mJQU2aiz+U54U4o8gwWzaAEh3b8WLXBk/jR+17EYAMpqC5fWWKU\n" +
        "74bLcpZj3mqof5wQt9ZkVrj6u3yyIZD+DnsNUBYZII6UDklxvwwlYjXVo/lsEUmR\n" +
        "3Xr93ngYCJ2xQh2SArGofDVrWa3ABexJXBOkyZoG2AAYuMzLN8HjMRBnD3+qEpAU\n" +
        "DMH9ChBI8hksmHBJcyQ3ayB0mbV0XvSbCciQ2mIl/PMB/62P84ouCaPD+69p65O6\n" +
        "932m1KIZBXLqc5D0dF79S6fBGFXvlwpsoM2O/9uw7wKBgQD1S7PfTdxOHSilw0g7\n" +
        "LMBMUVsXDo5eni2nauRO6Cp1zcPa47K5rbTHGynbd9dP8GEoe+KziT10Qp0i4CF/\n" +
        "oxVvrK8KpDNw75fKM/kOXfedxmlXe/Cb5QATDD0HdacA7EtJa3qREgjm/nauKKgp\n" +
        "LUjOpajCj37/SRkCzikS6XzL+wKBgQDrcPQSwVyMBn+1FcNyrI9FR8i9dek2kLAa\n" +
        "hfpFkotd0C2ntMh/yrnInjLWrHIZBBG9T37/TZd1epqks5aGNsyI3XtSIJovOnBn\n" +
        "jvWbPiGuV/6Yz9UMQ/hPn8fUNBR7TeK+ddvYEkX0qChnpGu1yOHqgJgrYx54ULsb\n" +
        "wu3utwkTnwKBgGOgnaviucnYOfwpdpriMDBPEsoolVaEtFI9LgGGdkhmjFfJB3w2\n" +
        "uyfrNnL3F7JWFYAV4Ru+cAFaVOwnUDPBDyHOZ0HRMzt5dJMhzNQzAjFIttxbcHxA\n" +
        "5GjYHal79ZqAXouxZZSqWIdJbvaJeNNQmzOjQQnUsmYJUGk9Rp1xy8glAoGARcxt\n" +
        "v2WtryF6GNBD6io4KzzVyT08j12jp6lSge+o+33tGwvgaOpL26ryvWvQQ5ROQgZg\n" +
        "SwXQwhY/5FYNaOq0BltK5RUfQKMdkcXzEDwCNjKGGv16VrGL2ucukb2C2O9FKlu8\n" +
        "ejkonhiAKgG3oOPV/fRzqGExNlAQuHE4oo2G1lcCgYEAz6XrCUvaCsw8SHGFbG+6\n" +
        "/WZv2ouz8UaYneDA2okLgvRWtI6u+yviXmM5arHjRfmsCxO7jSPiXLuHFszRC+2c\n" +
        "z5hnH5tCs+XLCf4p9HqDDREOjCcnIu/4BhduCLV6fCBnnJdKN8V8bsN6Z1O6fNBV\n" +
        "TuLettEP5Fmvovmmbg9oXbM=\n" +
        "-----END PRIVATE KEY-----\n";

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// Optional stub transport for the <c>spacetimedb</c> named HTTP client.
    /// Set it to drive endpoints that consult the chat module (currently
    /// <c>/livekit/token</c>'s room-authorization query) without a live module.
    /// </summary>
    public HttpMessageHandler? SpacetimeTransport { get; init; }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // Stay out of the Development env so appsettings.Development.json
        // (with its real SMTP, REQUIRE_EMAIL_CONFIRMATION, etc.) doesn't
        // override the test config below.
        builder.UseEnvironment("Testing");

        // Free ports so two factories started in parallel can't collide.
        builder.UseUrls("http://127.0.0.1:0");

        // Supply the minimum config the app expects. Values are deliberately
        // boring placeholders — these tests never reach LiveKit/MinIO/SMTP.
        builder.ConfigureAppConfiguration(config =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                // Connection string isn't used because we swap the DbContext
                // to InMemory below, but ServiceOptions requires a value.
                ["AUTH_DATABASE_URL"] = "Host=test;Database=test;Username=t;Password=t",
                ["AUTH_BIND"] = "127.0.0.1:0",
                ["ADMIN_BIND"] = "127.0.0.1:0",
                ["AUTH_JWT_SECRET"] = "this-is-a-test-jwt-secret-value-with-enough-bytes-to-sign",
                ["MINIO_ACCESS_KEY"] = "test",
                ["MINIO_SECRET_KEY"] = "test",
                ["MINIO_BUCKET"] = "test",
                ["MINIO_INTERNAL_ENDPOINT"] = "http://localhost:0",
                ["MINIO_PUBLIC_ENDPOINT"] = "http://localhost:0",
                ["LIVEKIT_API_KEY"] = "test",
                ["LIVEKIT_API_SECRET"] = "long-enough-livekit-secret-for-tests-1234567890",
                ["DISCOVERY_SPACETIMEDB_URI"] = "ws://localhost:4300",
                ["DISCOVERY_AUTH_URL"] = "http://localhost:8787",
                ["DISCOVERY_LIVEKIT_URL"] = "ws://localhost:7880",
                ["DISCOVERY_DATABASE"] = "letschat-test",
                ["REQUIRE_EMAIL_CONFIRMATION"] = "false",
                ["REQUIRE_ADMIN_APPROVAL"] = "false",
                ["EMAIL_SENDER"] = "log",
                ["EMAIL_FROM_ADDRESS"] = "no-reply@test.local",
                ["EMAIL_FROM_NAME"] = "Test",
                ["RATE_LIMIT_PERMIT"] = "100000",
                ["RATE_LIMIT_WINDOW_SECONDS"] = "60",
                ["ADMIN_BOOTSTRAP_EMAIL"] = "admin@test.local",
                // OIDC issuer for SpacetimeDB — non-default values so the
                // production-safety guard (this host runs as "Testing", not
                // "Development") doesn't refuse to boot. The key is a throwaway.
                ["SPACETIME_OIDC_ISSUER"] = "https://issuer.test",
                ["SPACETIME_OIDC_PRIVATE_KEY"] = TestOidcPrivateKeyPem,
            });
        });

        builder.ConfigureServices(services =>
        {
            // Replace the singleton ServiceOptions Program.cs already captured
            // from the real config. Our ConfigureAppConfiguration callback
            // fires too late to affect that materialised options instance, so
            // we rebuild it here from the merged configuration.
            services.RemoveAll(typeof(ServiceOptions));
            services.AddSingleton(sp =>
                ServiceOptions.FromConfiguration(sp.GetRequiredService<IConfiguration>()));

            // Replace the Postgres DbContext with EF InMemory so tests don't
            // need a database container. DbInitializer detects this via
            // Database.IsRelational and falls back to EnsureCreatedAsync.
            // Two collaborating bits of friction here:
            //   1. The Npgsql provider auto-registers EF internal services in
            //      the global container; the InMemory provider would clash
            //      ("two providers registered"). Mitigated by handing the test
            //      DbContext its own isolated internal service provider.
            //   2. AddDbContext chains `IDbContextOptionsConfiguration<TContext>`
            //      entries rather than replacing, so we strip them too.
            for (var i = services.Count - 1; i >= 0; i--)
            {
                var type = services[i].ServiceType;
                if (type == typeof(DbContextOptions<AppDbContext>)
                    || type == typeof(DbContextOptions<ArchiveDbContext>)
                    || type == typeof(DbContextOptions)
                    || type.FullName?.StartsWith(
                        "Microsoft.EntityFrameworkCore.Infrastructure.IDbContextOptionsConfiguration",
                        StringComparison.Ordinal) == true)
                {
                    services.RemoveAt(i);
                }
            }

            var internalSp = new ServiceCollection()
                .AddEntityFrameworkInMemoryDatabase()
                .BuildServiceProvider();

            services.AddDbContext<AppDbContext>(opts =>
            {
                opts.UseInMemoryDatabase(_databaseName);
                opts.UseInternalServiceProvider(internalSp);
            });

            // The archive context (storage-tiering) is Postgres in prod; swap it to
            // InMemory too so tests don't need a second database. DbInitializer
            // detects this via Database.IsRelational and skips MigrateAsync.
            services.AddDbContext<ArchiveDbContext>(opts =>
            {
                opts.UseInMemoryDatabase($"{_databaseName}-archive");
                opts.UseInternalServiceProvider(internalSp);
            });

            if (SpacetimeTransport is not null)
            {
                // Named-client configuration chains rather than replaces, so this
                // keeps Program.cs's timeout/header setup and only swaps transport.
                services.AddHttpClient("spacetimedb")
                    .ConfigurePrimaryHttpMessageHandler(() => SpacetimeTransport);
            }
        });
    }

    /// <summary>Reads a JSON response or throws a clear failure if the body isn't parseable.</summary>
    public static async Task<T> ReadJsonAsync<T>(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        if (string.IsNullOrWhiteSpace(body))
        {
            throw new InvalidOperationException(
                $"Response body was empty (status {(int)response.StatusCode} {response.StatusCode}).");
        }
        return JsonSerializer.Deserialize<T>(body, Json)
            ?? throw new InvalidOperationException(
                $"Could not deserialise response as {typeof(T).Name}: {body}");
    }

    public static Task<HttpResponseMessage> PostJsonAsync(HttpClient client, string path, object payload) =>
        client.PostAsJsonAsync(path, payload, Json);
}
