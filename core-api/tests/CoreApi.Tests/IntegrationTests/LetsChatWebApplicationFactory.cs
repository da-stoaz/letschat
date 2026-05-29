using System.Net.Http.Json;
using System.Text.Json;
using CoreApi.Configuration;
using CoreApi.Data;
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

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

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
