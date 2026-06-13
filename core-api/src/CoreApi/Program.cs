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
builder.Services.AddDbContext<ArchiveDbContext>(db => db.UseNpgsql(options.ArchiveConnectionString));

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

// ── Rate limiting ────────────────────────────────────────────────────────────
// Per-IP fixed window on abuse-prone auth endpoints (register / login / resend).
// Limits come from the runtime SystemConfig; new windows pick up edits.
// NOTE: behind a reverse proxy, configure forwarded headers so the real client
// IP is used for partitioning rather than the proxy's.
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
app.MapAdminEndpoints();
app.MapRazorPages();

await DbInitializer.InitializeAsync(app);

app.Logger.LogInformation(
    "core-api — public API on http://{Bind}, admin panel on http://{AdminBind}",
    options.Bind, options.AdminBind);
app.Run();

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
