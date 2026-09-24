using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// BUG_ANALYSIS A14: ffmpeg parses uploader-controlled files and used to inherit
/// core-api's whole environment — JWT secret, OIDC key, database and storage
/// credentials. A stand-in "ffmpeg" records what it receives.
/// </summary>
public sealed class FfmpegEnvironmentTests
{
    [Fact]
    public async Task Ffmpeg_Receives_None_Of_Core_Apis_Secrets()
    {
        if (OperatingSystem.IsWindows()) return;
        var dir = Directory.CreateTempSubdirectory("ffmpeg-env-");
        var dump = Path.Combine(dir.FullName, "env.txt");
        var fake = Path.Combine(dir.FullName, "ffmpeg");
        await File.WriteAllTextAsync(fake, $"#!/bin/sh\nenv > '{dump}'\n");
        File.SetUnixFileMode(fake, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        Environment.SetEnvironmentVariable("LETSCHAT_TEST_PARENT_SECRET", "parent-secret-value");
        try
        {
            using var factory = new LetsChatWebApplicationFactory().WithWebHostBuilder(builder =>
                builder.ConfigureAppConfiguration(config => config.AddInMemoryCollection(
                    new Dictionary<string, string?> { ["FFMPEG_PATH"] = fake })));
            _ = factory.CreateClient(); // the worker probes `ffmpeg -version` at startup

            for (var i = 0; i < 100 && !File.Exists(dump); i++) await Task.Delay(50);
            var env = await File.ReadAllTextAsync(dump);

            Assert.DoesNotContain("parent-secret-value", env);
            Assert.DoesNotContain("AUTH_JWT_SECRET", env);
            Assert.Contains("PATH=", env);
        }
        finally
        {
            Environment.SetEnvironmentVariable("LETSCHAT_TEST_PARENT_SECRET", null);
            dir.Delete(recursive: true);
        }
    }
}
