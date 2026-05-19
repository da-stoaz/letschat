using CoreApi.Configuration;
using CoreApi.Data;
using CoreApi.Models;
using CoreApi.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace CoreApi.Endpoints;

/// <summary>
/// <c>/auth/*</c> endpoints — register, link, login, verify, renew-session,
/// refresh-spacetime-token, plus the Phase 2 email-verification endpoints
/// (confirm-email, resend-confirmation).
/// </summary>
public static class AuthEndpoints
{
    /// <summary>Rate-limiting policy applied to abuse-prone auth endpoints.</summary>
    public const string RateLimitPolicy = "auth";

    public static void MapAuthEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapPost("/auth/register", Register).RequireRateLimiting(RateLimitPolicy);
        routes.MapPost("/auth/login", Login).RequireRateLimiting(RateLimitPolicy);
        routes.MapPost("/auth/resend-confirmation", ResendConfirmation)
            .RequireRateLimiting(RateLimitPolicy);

        routes.MapPost("/auth/link", Link);
        routes.MapPost("/auth/verify", Verify);
        routes.MapPost("/auth/renew-session", RenewSession);
        routes.MapPost("/auth/refresh-spacetime-token", RefreshSpacetimeToken);

        // Hit from the email link in a browser — returns an HTML page.
        routes.MapGet("/auth/confirm-email", ConfirmEmail);
    }

    private static async Task<RegisterResponse> Register(
        RegisterRequest request,
        UserManager<ApplicationUser> users,
        TokenService tokens,
        ServiceOptions options,
        AccountEmailService accountEmail)
    {
        var username = Validation.NormalizeUsername(request.Username);
        Validation.ValidateUsername(username);
        Validation.ValidatePassword(request.Password);
        var displayName = Validation.Required(request.DisplayName, "Display name is required.");
        var spacetimeToken = Validation.Required(request.SpacetimeToken, "Spacetime token is required.");
        var spacetimeIdentity = Validation.Required(request.SpacetimeIdentity, "Spacetime identity is required.");
        var identityNorm = Validation.NormalizeIdentity(spacetimeIdentity);

        // Email is mandatory when confirmation is required; otherwise optional.
        var requiresConfirmation = options.RequireEmailConfirmation;
        string? email = null;
        if (requiresConfirmation || !string.IsNullOrWhiteSpace(request.Email))
        {
            email = Validation.NormalizeEmail(request.Email);
        }

        if (await users.FindByNameAsync(username) is not null)
        {
            throw ApiException.Conflict("Username already exists.");
        }

        if (await users.Users.AnyAsync(u => u.SpacetimeIdentityNorm == identityNorm))
        {
            throw ApiException.Conflict(
                "Spacetime identity is already linked to another account.");
        }

        var user = new ApplicationUser
        {
            UserName = username,
            Email = email,
            DisplayName = displayName,
            SpacetimeIdentity = spacetimeIdentity,
            SpacetimeIdentityNorm = identityNorm,
            SpacetimeToken = spacetimeToken,
            Status = requiresConfirmation ? AccountStatus.Registered : AccountStatus.Active,
            EmailConfirmed = !requiresConfirmation,
        };

        var result = await users.CreateAsync(user, request.Password);
        if (!result.Succeeded)
        {
            throw TranslateIdentityFailure(result);
        }

        if (requiresConfirmation)
        {
            await accountEmail.SendConfirmationEmailAsync(user);
            return new RegisterResponse("pending_email_verification", Auth: null, Email: email);
        }

        var auth = await BuildAuthResponse(user, users, tokens);
        return new RegisterResponse("active", auth, Email: null);
    }

    private static async Task<AuthResponse> Link(
        LinkRequest request,
        UserManager<ApplicationUser> users,
        TokenService tokens)
    {
        var username = Validation.NormalizeUsername(request.Username);
        Validation.ValidateUsername(username);
        Validation.ValidatePassword(request.Password);
        var displayName = Validation.Required(request.DisplayName, "Display name is required.");
        var spacetimeToken = Validation.Required(request.SpacetimeToken, "Spacetime token is required.");
        var spacetimeIdentity = Validation.Required(request.SpacetimeIdentity, "Spacetime identity is required.");
        var identityNorm = Validation.NormalizeIdentity(spacetimeIdentity);

        var existing = await users.FindByNameAsync(username);
        if (existing is not null)
        {
            if (!string.Equals(existing.SpacetimeIdentityNorm, identityNorm, StringComparison.Ordinal))
            {
                throw ApiException.Conflict(
                    "Username is linked to a different Spacetime identity.");
            }

            existing.DisplayName = displayName;
            existing.SpacetimeToken = spacetimeToken;
            existing.UpdatedAtUtc = DateTime.UtcNow;

            var passwordReset = await users.RemovePasswordAsync(existing);
            if (passwordReset.Succeeded)
            {
                passwordReset = await users.AddPasswordAsync(existing, request.Password);
            }

            if (!passwordReset.Succeeded)
            {
                throw TranslateIdentityFailure(passwordReset);
            }

            var update = await users.UpdateAsync(existing);
            if (!update.Succeeded)
            {
                throw TranslateIdentityFailure(update);
            }

            EnsureSignInAllowed(existing);
            return await BuildAuthResponse(existing, users, tokens);
        }

        if (await users.Users.AnyAsync(u => u.SpacetimeIdentityNorm == identityNorm))
        {
            throw ApiException.Conflict(
                "Spacetime identity is already linked to another account.");
        }

        // `link` is the credential-(re)binding path for an identity the caller
        // already controls; a new account created here is Active directly.
        var user = new ApplicationUser
        {
            UserName = username,
            DisplayName = displayName,
            SpacetimeIdentity = spacetimeIdentity,
            SpacetimeIdentityNorm = identityNorm,
            SpacetimeToken = spacetimeToken,
            Status = AccountStatus.Active,
            EmailConfirmed = true,
        };

        var created = await users.CreateAsync(user, request.Password);
        if (!created.Succeeded)
        {
            throw TranslateIdentityFailure(created);
        }

        return await BuildAuthResponse(user, users, tokens);
    }

    private static async Task<AuthResponse> Login(
        LoginRequest request,
        UserManager<ApplicationUser> users,
        TokenService tokens)
    {
        var username = Validation.NormalizeUsername(request.Username);
        Validation.ValidateUsername(username);
        Validation.ValidatePassword(request.Password);

        var user = await users.FindByNameAsync(username)
            ?? throw ApiException.Unauthorized("Invalid username or password.");

        if (!await users.CheckPasswordAsync(user, request.Password))
        {
            throw ApiException.Unauthorized("Invalid username or password.");
        }

        EnsureSignInAllowed(user);
        return await BuildAuthResponse(user, users, tokens);
    }

    private static async Task<VerifyResponse> Verify(VerifyRequest request, TokenService tokens)
    {
        var username = await tokens.ValidateAsync(request.SessionToken);
        return new VerifyResponse(username is not null);
    }

    private static async Task<RenewSessionResponse> RenewSession(
        RenewSessionRequest request,
        UserManager<ApplicationUser> users,
        TokenService tokens)
    {
        var spacetimeToken = Validation.Required(request.SpacetimeToken, "Spacetime token is required.");
        var identityNorm = Validation.NormalizeIdentity(
            Validation.Required(request.SpacetimeIdentity, "Spacetime identity is required."));

        var user = await users.Users.FirstOrDefaultAsync(u =>
            u.SpacetimeToken == spacetimeToken && u.SpacetimeIdentityNorm == identityNorm)
            ?? throw ApiException.Unauthorized("Could not renew session for this account.");

        EnsureSignInAllowed(user);
        var roles = await users.GetRolesAsync(user);
        return new RenewSessionResponse(tokens.IssueSession(user.UserName!, roles));
    }

    private static async Task<IResult> RefreshSpacetimeToken(
        RefreshSpacetimeTokenRequest request,
        UserManager<ApplicationUser> users,
        TokenService tokens)
    {
        var username = await tokens.ValidateAsync(request.SessionToken)
            ?? throw ApiException.Unauthorized("Invalid or expired session token.");

        var spacetimeToken = Validation.Required(request.SpacetimeToken, "spacetimeToken is required.");

        var user = await users.FindByNameAsync(username)
            ?? throw ApiException.Unauthorized("Account not found for session token.");

        user.SpacetimeToken = spacetimeToken;
        user.UpdatedAtUtc = DateTime.UtcNow;
        var update = await users.UpdateAsync(user);
        if (!update.Succeeded)
        {
            throw TranslateIdentityFailure(update);
        }

        return Results.Json(new { });
    }

    /// <summary>Email-link target — confirms the address and activates the account.</summary>
    private static async Task<IResult> ConfirmEmail(
        string? userId, string? token, UserManager<ApplicationUser> users)
    {
        if (string.IsNullOrEmpty(userId) || string.IsNullOrEmpty(token))
        {
            return HtmlPage("Invalid link", "This confirmation link is malformed.", ok: false);
        }

        var user = await users.FindByIdAsync(userId);
        if (user is null)
        {
            return HtmlPage("Invalid link", "This confirmation link is no longer valid.", ok: false);
        }

        if (user.EmailConfirmed && user.Status != AccountStatus.Registered)
        {
            return HtmlPage(
                "Already confirmed",
                "Your email address is already confirmed — you can sign in to LetsChat.",
                ok: true);
        }

        var result = await users.ConfirmEmailAsync(user, token);
        if (!result.Succeeded)
        {
            return HtmlPage(
                "Link expired",
                "This confirmation link is invalid or has expired. Request a new one from the app.",
                ok: false);
        }

        if (user.Status == AccountStatus.Registered)
        {
            user.Status = AccountStatus.Active;
            user.UpdatedAtUtc = DateTime.UtcNow;
            await users.UpdateAsync(user);
        }

        return HtmlPage(
            "Email confirmed",
            "Your email address is confirmed. You can now sign in to LetsChat.",
            ok: true);
    }

    /// <summary>Re-sends the confirmation email. Always responds generically.</summary>
    private static async Task<IResult> ResendConfirmation(
        ResendConfirmationRequest request,
        UserManager<ApplicationUser> users,
        AccountEmailService accountEmail)
    {
        var email = Validation.NormalizeEmail(request.Email);
        var user = await users.FindByEmailAsync(email);

        if (user is { Status: AccountStatus.Registered, EmailConfirmed: false })
        {
            await accountEmail.SendConfirmationEmailAsync(user);
        }

        // Generic response — never reveal whether an account exists for the address.
        return Results.Json(new
        {
            status = "ok",
            message = "If that address has an unconfirmed account, a new confirmation email has been sent.",
        });
    }

    private static async Task<AuthResponse> BuildAuthResponse(
        ApplicationUser user, UserManager<ApplicationUser> users, TokenService tokens)
    {
        var roles = await users.GetRolesAsync(user);
        var session = tokens.IssueSession(user.UserName!, roles);
        return new AuthResponse(
            user.UserName!,
            user.DisplayName,
            user.SpacetimeToken,
            user.SpacetimeIdentity,
            session);
    }

    /// <summary>Blocks sign-in for any account not in the <see cref="AccountStatus.Active"/> state.</summary>
    private static void EnsureSignInAllowed(ApplicationUser user)
    {
        switch (user.Status)
        {
            case AccountStatus.Active:
                return;
            case AccountStatus.Registered:
                throw ApiException.Unauthorized(
                    "Please confirm your email address before signing in.");
            case AccountStatus.EmailVerified:
                throw ApiException.Unauthorized(
                    "Your account is awaiting administrator approval.");
            case AccountStatus.Disabled:
                throw ApiException.Unauthorized("This account has been disabled.");
            case AccountStatus.Rejected:
                throw ApiException.Unauthorized("This account was not approved.");
            default:
                throw ApiException.Unauthorized("This account cannot sign in.");
        }
    }

    private static IResult HtmlPage(string heading, string message, bool ok)
    {
        var accent = ok ? "#16a34a" : "#dc2626";
        var glyph = ok ? "&#10003;" : "&#10007;";
        var html =
            $"""
             <!doctype html>
             <html lang="en">
             <head>
               <meta charset="utf-8">
               <meta name="viewport" content="width=device-width, initial-scale=1">
               <title>{heading} — LetsChat</title>
             </head>
             <body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
                          background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
               <div style="background:#fff;border-radius:12px;padding:40px;max-width:420px;text-align:center;
                           box-shadow:0 1px 3px rgba(0,0,0,.1)">
                 <div style="font-size:44px;line-height:1;color:{accent}">{glyph}</div>
                 <h1 style="font-size:20px;color:#111827;margin:16px 0 8px">{heading}</h1>
                 <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0">{message}</p>
               </div>
             </body>
             </html>
             """;
        return Results.Content(html, "text/html");
    }

    private static ApiException TranslateIdentityFailure(IdentityResult result)
    {
        var message = string.Join(" ", result.Errors.Select(e => e.Description));
        if (string.IsNullOrWhiteSpace(message))
        {
            message = "The request could not be completed.";
        }

        var isConflict = result.Errors.Any(e =>
            e.Code.Contains("Duplicate", StringComparison.OrdinalIgnoreCase));

        return isConflict ? ApiException.Conflict(message) : ApiException.BadRequest(message);
    }
}
