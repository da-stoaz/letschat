using System.Net;
using System.Text.Json;
using System.Threading.RateLimiting;
using CoreApi;
using CoreApi.Configuration;
using CoreApi.Data;
using CoreApi.Data.Archive;
using CoreApi.Endpoints;
using CoreApi.Identity;
using CoreApi.Services;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// ── Configuration ────────────────────────────────────────────────────────────
var options = ServiceOptions.FromConfiguration(builder.Configuration);
builder.Services.AddSingleton(options);

// Public API on AUTH_BIND; the admin control panel on the separate ADMIN_BIND
// port, which the public reverse proxy is not configured to expose.
builder.WebHost.UseUrls($"http://{options.Bind}", $"http://{options.AdminBind}");
var adminPort = int.Parse(options.AdminBind.Split(':')[^1]);

// ── Persistence + Identity ───────────────────────────────────────────────────
builder.Services.AddDbContext<AppDbContext>(db => db.UseNpgsql(options.ConnectionString));

// The cold-archive schema (storage-tiering, plan 2) is owned here: migrations
// apply on startup like the auth context. The archive-worker connects to the
// already-migrated schema; phase-3 read endpoints use this context.
//
// Registered ONLY when ARCHIVE_DATABASE_URL is configured. The archive is an
// optional background replica; an environment that hasn't provisioned it (e.g.
// the current prod compose) simply runs without it rather than failing to start.
if (!string.IsNullOrWhiteSpace(options.ArchiveConnectionString))
{
    builder.Services.AddDbContext<ArchiveDbContext>(db => db.UseNpgsql(options.ArchiveConnectionString));
}

builder.Services
    .AddIdentity<ApplicationUser, IdentityRole>(identity =>
    {
        // Username rules mirror the legacy validator ([a-z0-9_], 2-32).
        identity.User.AllowedUserNameCharacters =
            "abcdefghijklmnopqrstuvwxyz0123456789_";
        identity.User.RequireUniqueEmail = true;

        // Legacy password policy was simply "at least 8 characters".
        identity.Password.RequiredLength = 8;
        identity.Password.RequireDigit = false;
        identity.Password.RequireLowercase = false;
        identity.Password.RequireUppercase = false;
        identity.Password.RequireNonAlphanumeric = false;
        identity.Password.RequiredUniqueChars = 1;
    })
    .AddEntityFrameworkStores<AppDbContext>()
    .AddDefaultTokenProviders();

// Replace Identity's PBKDF2 hasher with Argon2id so migrated hashes verify.
builder.Services.AddScoped<IPasswordHasher<ApplicationUser>, Argon2PasswordHasher>();

// The control panel signs admins in with the Identity cookie.
builder.Services.ConfigureApplicationCookie(cookie =>
{
    cookie.Cookie.Name = "letschat.admin";
    cookie.LoginPath = "/admin/login";
    cookie.LogoutPath = "/admin/logout";
    cookie.AccessDeniedPath = "/admin/login";
    cookie.ExpireTimeSpan = TimeSpan.FromHours(8);
    cookie.SlidingExpiration = true;
});

// ── Domain services ──────────────────────────────────────────────────────────
builder.Services.AddSingleton<TokenService>();
// OIDC issuer for SpacetimeDB — mints the SpacetimeDB JWT and derives identities.
builder.Services.AddSingleton<SpacetimeTokenService>();
builder.Services.AddSingleton<LiveKitTokenService>();
builder.Services.AddSingleton<StorageService>();

// Email transport — SMTP for real delivery, log sender for local dev.
if (options.EmailSenderKind == "smtp")
{
    builder.Services.AddSingleton<IEmailSender, SmtpEmailSender>();
}
else
{
    builder.Services.AddSingleton<IEmailSender, LogEmailSender>();
}

builder.Services.AddScoped<AccountEmailService>();

// Keeps the SpacetimeDB module's copy of an account's access state (suspended,
// token generation) in step with core-api's — the chat client never asks
// core-api, so nothing else revokes a session there.
builder.Services.AddScoped<AccountAccessService>();

// Runtime-editable config + audit log (admin control panel).
builder.Services.AddSingleton<SystemConfigService>();
builder.Services.AddSingleton<AuditService>();

// SpacetimeDB HTTP wrapper — admin panel uses it to read / set chat-domain
// settings (currently the space-create policy from plan 1.5).
builder.Services.AddSingleton<SpacetimeClient>();
builder.Services.AddHttpClient("spacetimedb", client =>
{
    client.Timeout = TimeSpan.FromSeconds(8);
    client.DefaultRequestHeaders.Accept.ParseAdd("application/json");
});

// Version triple (server + recommended/min client). Read once at startup
// from the assembly's InformationalVersion plus env overrides.
builder.Services.AddSingleton<VersionInfo>();

// HTTP client + memory cache power the /downloads/{os} proxy that resolves
// installer URLs from the GitHub Releases API server-side.
builder.Services.AddMemoryCache();
builder.Services.AddHttpClient("github", client =>
{
    client.Timeout = TimeSpan.FromSeconds(8);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("letschat-core-api");
    client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
});

// ── Forwarded headers ────────────────────────────────────────────────────────
// Both documented production topologies (Caddy, Cloudflare Tunnel) put a reverse
// proxy in front, so Connection.RemoteIpAddress is the PROXY's address. Without
// this, the auth rate limiter below partitions every request in the instance
// into a single bucket — which not only defeats per-client limiting but lets one
// client exhaust the window and lock every other user out of login, register and
// password reset.
//
// X-Forwarded-For is honoured only when the immediate peer is on a loopback or
// private network — i.e. the container network the proxy runs on. A request that
// reaches the listener directly from a public address cannot spoof the header to
// dodge the limiter. ForwardLimit 1 trusts only the adjacent proxy's assertion.
// Loopback, RFC1918 and IPv6 unique-local — the ranges a container network and
// a locally-bound proxy actually use.
var trustedProxyNetworks = new (string Prefix, int Bits)[]
{
    ("127.0.0.0", 8),
    ("10.0.0.0", 8),
    ("172.16.0.0", 12),
    ("192.168.0.0", 16),
    ("::1", 128),
    ("fc00::", 7),
};

builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.ForwardLimit = 1;
    options.KnownProxies.Clear();
    options.KnownIPNetworks.Clear();
    foreach (var (prefix, bits) in trustedProxyNetworks)
    {
        options.KnownIPNetworks.Add(new System.Net.IPNetwork(IPAddress.Parse(prefix), bits));
    }
});

// ── Rate limiting ────────────────────────────────────────────────────────────
// Per-IP fixed window on abuse-prone auth endpoints (register / login / resend).
// Limits come from the runtime SystemConfig; new windows pick up edits.
// Partitioning is only meaningful because UseForwardedHeaders runs first.
builder.Services.AddRateLimiter(rateLimiter =>
{
    rateLimiter.AddPolicy(AuthEndpoints.RateLimitPolicy, httpContext =>
    {
        var config = httpContext.RequestServices.GetRequiredService<SystemConfigService>().Current;
        return RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = config.RateLimitPermitLimit,
                Window = TimeSpan.FromSeconds(config.RateLimitWindowSeconds),
                QueueLimit = 0,
            });
    });

    rateLimiter.OnRejected = async (context, cancellationToken) =>
    {
        context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        context.HttpContext.Response.ContentType = "application/json";
        await context.HttpContext.Response.WriteAsync(
            JsonSerializer.Serialize(new { error = "Too many requests. Please try again later." }),
            cancellationToken);
    };
});

builder.Services.AddCors(cors => cors.AddDefaultPolicy(policy =>
    policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

builder.Services.AddRazorPages();

var app = builder.Build();

// Fail fast: outside Development, refuse to boot on any secret left at its public
// dev default. A silently-accepted dev secret is the worst failure mode — auth
// and voice keep working, but anyone can forge tokens with the well-known key.
EnsureProductionConfigIsSafe(app);

// Must precede every middleware that reads the client IP (notably the rate
// limiter) so RemoteIpAddress is the real caller and not the reverse proxy.
app.UseForwardedHeaders();

// ── Listener-scope guard ─────────────────────────────────────────────────────
// Each listener is mutually exclusive about what it serves:
//   • The admin listener serves ONLY /admin/* and the admin panel's own static
//     assets (its stylesheet lives at /css/…, not under /admin) — never the
//     public landing page, /auth/*, /downloads/*, etc.
//   • The public listener serves everything EXCEPT /admin/* (so the control
//     panel is unreachable from the public reverse proxy).
// Requests on the wrong listener get 404'd before any handler runs.
app.Use(async (context, next) =>
{
    var path = context.Request.Path;
    var isAdminPort = context.Connection.LocalPort == adminPort;
    var isAdminPath = path.StartsWithSegments("/admin");
    // Static assets the admin pages reference from the app root.
    var isAdminAsset =
        path.StartsWithSegments("/css")
        || path.StartsWithSegments("/js")
        || path.StartsWithSegments("/lib")
        || path.StartsWithSegments("/favicon.ico");

    var allowed = isAdminPort ? isAdminPath || isAdminAsset : !isAdminPath;
    if (!allowed)
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }

    await next();
});

// ── Error handling ───────────────────────────────────────────────────────────
// API failures become { "error": "…" } with an appropriate status — the exact
// shape the desktop client expects. Admin (Razor) requests are left to the
// framework's own error handling so they render HTML, not JSON.
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/admin"))
    {
        await next();
        return;
    }

    try
    {
        await next();
    }
    catch (ApiException ex)
    {
        await WriteError(context, ex.Status, ex.Message);
    }
    catch (EmailDeliveryException ex)
    {
        // The transport already logged the cause; the client just needs a clear,
        // actionable 503 rather than an opaque "Internal server error".
        app.Logger.LogError(ex, "Email delivery failed processing {Path}", context.Request.Path);
        await WriteError(
            context, HttpStatusCode.ServiceUnavailable,
            "The server could not send a required email. Please try again later or contact the administrator.");
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Unhandled exception processing {Path}", context.Request.Path);
        await WriteError(context, HttpStatusCode.InternalServerError, "Internal server error.");
    }
});

// Developer exception page — admin (Razor) area only. API errors are already
// turned into { "error": … } JSON by the middleware above and must NOT be
// intercepted here, or the desktop client receives an HTML 500 it can't parse.
if (app.Environment.IsDevelopment())
{
    app.UseWhen(
        context => context.Request.Path.StartsWithSegments("/admin"),
        branch => branch.UseDeveloperExceptionPage());
}

app.UseStaticFiles();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapAuthEndpoints();
app.MapLiveKitEndpoints();
app.MapUploadEndpoints();
app.MapMiscEndpoints();
app.MapDownloadEndpoints();
app.MapRazorPages();

await DbInitializer.InitializeAsync(app);

app.Logger.LogInformation(
    "core-api — public API on http://{Bind}, admin panel on http://{AdminBind}",
    options.Bind, options.AdminBind);
app.Run();

// Reads the resolved options from DI so we validate exactly what the app uses
// (the integration-test host rebuilds ServiceOptions after Program.cs runs).
static void EnsureProductionConfigIsSafe(WebApplication app)
{
    if (app.Environment.IsDevelopment())
    {
        return;
    }

    var options = app.Services.GetRequiredService<ServiceOptions>();

    var insecureDefaults = options.FindInsecureDefaults();
    if (insecureDefaults.Count > 0)
    {
        throw new InvalidOperationException(
            $"Refusing to start in the '{app.Environment.EnvironmentName}' environment: " +
            $"these secrets are still set to their public dev defaults: {string.Join(", ", insecureDefaults)}. " +
            "Set strong random values (e.g. `openssl rand -base64 32`) before deploying.");
    }

    // Same reasoning one layer out: a client-facing endpoint left at its dev
    // default does not fail here, it fails silently in every client.
    //
    // Production only, unlike the secret check above. A forgeable secret is
    // exploitable in any non-dev environment, but "the address clients are given
    // must be reachable by them" is a statement about a real deployment — the
    // integration-test host is a loopback host by construction, and the shipped
    // compose files set no ASPNETCORE_ENVIRONMENT, so they land on Production.
    if (!app.Environment.IsProduction())
    {
        return;
    }

    var unreachable = options.FindClientUnreachableEndpoints();
    if (unreachable.Count > 0)
    {
        throw new InvalidOperationException(
            $"Refusing to start in the '{app.Environment.EnvironmentName}' environment: " +
            "these endpoints are handed to clients but are not reachable by them:" +
            Environment.NewLine + "  - " + string.Join(Environment.NewLine + "  - ", unreachable));
    }
}

static async Task WriteError(HttpContext context, HttpStatusCode status, string message)
{
    if (context.Response.HasStarted)
    {
        return;
    }

    context.Response.Clear();
    context.Response.StatusCode = (int)status;
    context.Response.ContentType = "application/json";
    await context.Response.WriteAsync(JsonSerializer.Serialize(new { error = message }));
}

/// <summary>Exposed so the integration test host can reference the entry point.</summary>
public partial class Program;
