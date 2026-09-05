using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// End-to-end check that the startup guard actually refuses to boot a non-Dev
/// host whose secrets are still at their public dev defaults — the security net
/// behind <see cref="CoreApi.Configuration.ServiceOptions.FindInsecureDefaults"/>.
/// </summary>
public sealed class StartupSecretGuardTests
{
    [Fact]
    public void Refuses_To_Start_In_Production_With_Default_Secrets()
    {
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                // Production (not the test factory's "Testing") so the guard is armed,
                // and we deliberately leave AUTH_JWT_SECRET / LIVEKIT_API_SECRET /
                // MINIO_SECRET_KEY unset so they fall back to their dev defaults.
                builder.UseEnvironment(Environments.Production);
                builder.ConfigureAppConfiguration(config =>
                    config.AddInMemoryCollection(new Dictionary<string, string?>
                    {
                        ["AUTH_DATABASE_URL"] = "Host=test;Database=test;Username=t;Password=t",
                    }));
            });

        // CreateClient triggers host build; the guard throws before the server starts.
        var error = Record.Exception(() => factory.CreateClient());

        Assert.NotNull(error);
        var chain = AllMessages(error!);
        Assert.Contains("dev defaults", chain);
        Assert.Contains("LIVEKIT_API_SECRET", chain);
    }

    [Fact]
    public void Refuses_To_Start_In_Production_With_A_Client_Unreachable_Endpoint()
    {
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                // Secrets all set, so only the endpoint guard can fire. MinIO's
                // public endpoint is left unset — the production footgun: it
                // silently becomes the Docker-internal address that every
                // presigned upload and download URL is then signed against.
                builder.UseEnvironment(Environments.Production);
                // UseSetting, not ConfigureAppConfiguration: with minimal hosting
                // the factory's configuration delegate does not reach the
                // IConfiguration ServiceOptions is built from.
                builder.UseSetting("AUTH_DATABASE_URL", "Host=test;Database=test;Username=t;Password=t");
                builder.UseSetting("AUTH_JWT_SECRET", "a-strong-unique-jwt-secret-value-1234567890");
                builder.UseSetting("LIVEKIT_API_SECRET", "a-strong-unique-livekit-secret-1234567890");
                builder.UseSetting("MINIO_SECRET_KEY", "a-strong-unique-minio-secret-value");
                builder.UseSetting("SPACETIME_OIDC_ISSUER", "https://auth.example.com");
                builder.UseSetting("SPACETIME_OIDC_PRIVATE_KEY", "-----BEGIN PRIVATE KEY-----\nMII\n-----END PRIVATE KEY-----");
                builder.UseSetting("MINIO_INTERNAL_ENDPOINT", "http://minio:44390");
                builder.UseSetting("DISCOVERY_AUTH_URL", "https://auth.example.com");
                builder.UseSetting("DISCOVERY_SPACETIMEDB_URI", "wss://chat.example.com");
                builder.UseSetting("DISCOVERY_LIVEKIT_URL", "wss://lk.example.com");
            });

        var error = Record.Exception(() => factory.CreateClient());

        Assert.NotNull(error);
        var chain = AllMessages(error!);
        Assert.True(chain.Contains("not reachable by them"), chain);
        Assert.True(chain.Contains("MINIO_PUBLIC_ENDPOINT"), chain);
    }

    /// <summary>Flattens an exception chain (incl. aggregates) into one searchable string.</summary>
    private static string AllMessages(Exception exception)
    {
        var builder = new StringBuilder();
        for (Exception? current = exception; current is not null; current = current.InnerException)
        {
            builder.AppendLine(current.Message);
            if (current is AggregateException aggregate)
            {
                foreach (var inner in aggregate.InnerExceptions)
                {
                    builder.AppendLine(AllMessages(inner));
                }
            }
        }
        return builder.ToString();
    }
}
