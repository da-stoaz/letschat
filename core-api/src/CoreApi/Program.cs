using System.Net;
using System.Text.Json;
using System.Threading.RateLimiting;
using CoreApi;
using CoreApi.Configuration;
using CoreApi.Data;
using CoreApi.Endpoints;
using CoreApi.Identity;
using CoreApi.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// ── Configuration ────────────────────────────────────────────────────────────
var options = ServiceOptions.FromConfiguration(builder.Configuration);
builder.Services.AddSingleton(options);

// Bind to AUTH_BIND (host:port), matching the legacy service's listener.
builder.WebHost.UseUrls($"http://{options.Bind}");

// ── Persistence + Identity ───────────────────────────────────────────────────
builder.Services.AddDbContext<AppDbContext>(db => db.UseNpgsql(options.ConnectionString));

builder.Services
    .AddIdentity<ApplicationUser, IdentityRole>(identity =>
    {
        // Username rules mirror the legacy validator ([a-z0-9_], 2-32).
        identity.User.AllowedUserNameCharacters =
            "abcdefghijklmnopqrstuvwxyz0123456789_";
        identity.User.RequireUniqueEmail = false;

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

// ── Rate limiting ────────────────────────────────────────────────────────────
// Per-IP fixed window on abuse-prone auth endpoints (register / login / resend).
// NOTE: behind a reverse proxy, configure forwarded headers so the real client
// IP is used for partitioning rather than the proxy's.
builder.Services.AddRateLimiter(rateLimiter =>
{
    rateLimiter.AddPolicy(AuthEndpoints.RateLimitPolicy, httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = options.RateLimitPermitLimit,
                Window = TimeSpan.FromSeconds(options.RateLimitWindowSeconds),
                QueueLimit = 0,
            }));

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

var app = builder.Build();

// ── Error handling ───────────────────────────────────────────────────────────
// Every failure becomes { "error": "…" } with an appropriate status — the
// exact shape the desktop client's error parsing expects.
app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (ApiException ex)
    {
        await WriteError(context, ex.Status, ex.Message);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Unhandled exception processing {Path}", context.Request.Path);
        await WriteError(context, HttpStatusCode.InternalServerError, "Internal server error.");
    }
});

app.UseCors();
app.UseRateLimiter();

app.MapAuthEndpoints();
app.MapLiveKitEndpoints();
app.MapUploadEndpoints();
app.MapMiscEndpoints();

await DbInitializer.InitializeAsync(app);

app.Logger.LogInformation("core-api listening on http://{Bind}", options.Bind);
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
