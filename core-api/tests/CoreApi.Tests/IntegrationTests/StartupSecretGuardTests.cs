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
