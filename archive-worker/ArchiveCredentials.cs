using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace ArchiveWorker;

/// <summary>Owns the auto-issued worker token; operator-supplied tokens are never replaced.</summary>
public sealed class ArchiveCredentials(WorkerOptions options, HttpClient http, ILogger<ArchiveCredentials> logger)
{
    public async Task<string> GetTokenAsync(CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(options.Token)) return options.Token;

        string? token;
        try { token = (await File.ReadAllTextAsync(options.TokenFile, ct)).Trim(); }
        catch (FileNotFoundException) { token = null; }
        catch (DirectoryNotFoundException) { token = null; }

        var endpoint = new UriBuilder(options.SpacetimeUri);
        endpoint.Scheme = endpoint.Scheme is "wss" or "https" ? "https" : "http";
        endpoint.Path = "/v1/identity";
        endpoint.Query = "";

        if (!string.IsNullOrEmpty(token))
        {
            using var check = new HttpRequestMessage(HttpMethod.Post, endpoint.Uri + "/websocket-token");
            check.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await http.SendAsync(check, ct);
            if (response.IsSuccessStatusCode) return token;
            // A timeout, unavailable server or proxy error must not rotate identity.
            if (response.StatusCode != HttpStatusCode.Unauthorized) response.EnsureSuccessStatusCode();
            logger.LogWarning("SpacetimeDB rejected the managed archive token (401); obtaining a replacement.");
        }

        using var issued = await http.PostAsync(endpoint.Uri, null, ct);
        issued.EnsureSuccessStatusCode();
        using var body = JsonDocument.Parse(await issued.Content.ReadAsStringAsync(ct));
        var replacement = body.RootElement.GetProperty("token").GetString();
        if (string.IsNullOrWhiteSpace(replacement) || replacement.Split('.').Length != 3)
            throw new InvalidOperationException("SpacetimeDB did not return a valid archive token.");

        // Keep the previous credential until issuance and the complete write succeed.
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(options.TokenFile))!);
        var temporary = options.TokenFile + ".tmp";
        var fileOptions = new FileStreamOptions { Mode = FileMode.Create, Access = FileAccess.Write };
        if (!OperatingSystem.IsWindows())
            fileOptions.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
        await using (var writer = new StreamWriter(new FileStream(temporary, fileOptions)))
            await writer.WriteAsync(replacement.AsMemory(), ct);
        File.Move(temporary, options.TokenFile, overwrite: true);
        logger.LogInformation("Persisted a new archive credential; awaiting automatic service registration.");
        return replacement;
    }
}
