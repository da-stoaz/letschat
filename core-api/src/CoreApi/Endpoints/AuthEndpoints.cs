using System.Globalization;
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
/// (confirm-email, resend-confirmation) and the password-reset flow
/// (forgot-password, reset-password).
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

        // Password reset. forgot-password mails the link; reset-password is the
        // browser-facing GET form + POST submit the email link opens.
        routes.MapPost("/auth/forgot-password", ForgotPassword)
            .RequireRateLimiting(RateLimitPolicy);
        routes.MapGet("/auth/reset-password", ResetPasswordForm);
        routes.MapPost("/auth/reset-password", ResetPassword)
            .RequireRateLimiting(RateLimitPolicy);

        // Not rate-limited — the client polls this from the "confirm email" screen.
        routes.MapPost("/auth/registration-status", RegistrationStatus);

        // Creates accounts and sets passwords — rate-limit it like /auth/register.
        routes.MapPost("/auth/link", Link).RequireRateLimiting(RateLimitPolicy);
        routes.MapPost("/auth/verify", Verify);
        routes.MapPost("/auth/account", Account);

        // Verifies the current password, so it is guessable — rate-limit it.
        routes.MapPost("/auth/change-password", ChangePassword)
            .RequireRateLimiting(RateLimitPolicy);
        routes.MapPost("/auth/renew-session", RenewSession);

        // Hit from the email link in a browser — returns an HTML page.
        routes.MapGet("/auth/confirm-email", ConfirmEmail);
    }

    private static async Task<RegisterResponse> Register(
        RegisterRequest request,
        UserManager<ApplicationUser> users,
        TokenService tokens,
        SpacetimeTokenService spacetime,
        SystemConfigService config,
        AccountEmailService accountEmail)
    {
        if (!config.Current.RegistrationOpen)
        {
            throw ApiException.BadRequest("Registration is currently closed.");
        }

        var username = Validation.NormalizeUsername(request.Username);
        Validation.ValidateUsername(username);
        Validation.ValidatePassword(request.Password);
        var displayName = Validation.Required(request.DisplayName, "Display name is required.");

        // Email is mandatory on every account — it's the recovery + uniqueness key.
        var requiresConfirmation = config.Current.RequireEmailConfirmation;
        var email = Validation.NormalizeEmail(request.Email);

        if (await users.FindByNameAsync(username) is not null)
        {
            throw ApiException.Conflict("Username already exists.");
        }

        if (await users.FindByEmailAsync(email) is not null)
        {
            throw ApiException.Conflict("Email address is already registered.");
        }

        var user = new ApplicationUser
        {
            UserName = username,
            Email = email,
            DisplayName = displayName,
            Status = requiresConfirmation ? AccountStatus.Registered : AccountStatus.Active,
            EmailConfirmed = !requiresConfirmation,
        };
        // Identity is derived from the (already-assigned) account id and frozen
        // here — deterministic and wipe-proof. Collisions between distinct
        // accounts are structurally impossible; the unique index just guards it.
        AssignDerivedIdentity(user, spacetime);

        var result = await users.CreateAsync(user, request.Password);
        if (!result.Succeeded)
        {
            throw TranslateIdentityFailure(result);
        }

        if (requiresConfirmation)
        {
            try
            {
                await accountEmail.SendConfirmationEmailAsync(user);
            }
            catch (EmailDeliveryException)
            {
                // The confirmation email is mandatory for a self-registered
                // account — without it the user can never advance past Registered.
                // Roll the just-created account back so its username / email free
                // up for a clean retry, then surface a clear 503 instead of
                // leaving an orphaned, unconfirmable user.
                await users.DeleteAsync(user);
                throw ApiException.ServiceUnavailable(
                    "Your account couldn't be created because the confirmation email " +
                    "couldn't be sent. Please try again later or contact the administrator.");
            }

            // Carry the computed identity so the confirm-email poll can locate the
            // account without leaking whether a username exists.
            return new RegisterResponse(
                "pending_email_verification", Auth: null, Email: email, Identity: user.SpacetimeIdentity);
        }

        var auth = BuildAuthResponse(user, await users.GetRolesAsync(user), tokens, spacetime);
        return new RegisterResponse("active", auth, Email: null);
    }

    /// <summary>
    /// Derives and freezes an account's SpacetimeDB identity from its id. The id
    /// is assigned by Identity at construction, so this is safe to call before
    /// <c>CreateAsync</c>. Access tokens are minted on demand and never stored.
    /// </summary>
    public static void AssignDerivedIdentity(ApplicationUser user, SpacetimeTokenService spacetime)
    {
        var identity = spacetime.ComputeIdentityHex(user.Id);
        user.SpacetimeIdentity = identity;
        user.SpacetimeIdentityNorm = Validation.NormalizeIdentity(identity);
    }

    private static async Task<AuthResponse> Link(
        LinkRequest request,
        UserManager<ApplicationUser> users,
        TokenService tokens,
        SpacetimeTokenService spacetime,
        SystemConfigService config,
        AccountEmailService accountEmail)
    {
        var username = Validation.NormalizeUsername(request.Username);
        Validation.ValidateUsername(username);
        Validation.ValidatePassword(request.Password);
        var displayName = Validation.Required(request.DisplayName, "Display name is required.");

        var existing = await users.FindByNameAsync(username);
        if (existing is not null)
        {
            // Set/change password on an existing account. The identity is derived
            // and permanent, so it can no longer stand in for "is signed in" —
            // require a valid session token for this same account instead.
            var caller = request.SessionToken is null ? null : await tokens.ValidateAsync(request.SessionToken);
            if (caller is null || !string.Equals(caller, username, StringComparison.Ordinal))
            {
                throw ApiException.Unauthorized("Sign in before changing this account's password.");
            }

            existing.DisplayName = displayName;
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
            return BuildAuthResponse(existing, await users.GetRolesAsync(existing), tokens, spacetime);
        }

        // Creating a NEW account here is reachable unauthenticated, so it has to
        // obey exactly the same controls as /auth/register. Previously it did
        // not, which made this endpoint a single call that bypassed a closed
        // instance, email confirmation and admin approval at once.
        if (!config.Current.RegistrationOpen)
        {
            throw ApiException.BadRequest("Registration is currently closed.");
        }

        var requiresConfirmation = config.Current.RequireEmailConfirmation;
        var email = Validation.NormalizeEmail(request.Email);
        if (await users.FindByEmailAsync(email) is not null)
        {
            throw ApiException.Conflict("Email address is already registered.");
        }

        var user = new ApplicationUser
        {
            UserName = username,
            Email = email,
            DisplayName = displayName,
            Status = requiresConfirmation ? AccountStatus.Registered : AccountStatus.Active,
            EmailConfirmed = !requiresConfirmation,
        };
        AssignDerivedIdentity(user, spacetime);

        var created = await users.CreateAsync(user, request.Password);
        if (!created.Succeeded)
        {
            throw TranslateIdentityFailure(created);
        }

        if (requiresConfirmation)
        {
            try
            {
                await accountEmail.SendConfirmationEmailAsync(user);
            }
            catch (EmailDeliveryException)
            {
                // Same rollback as Register: without the mail the account could
                // never advance past Registered, so don't leave it orphaned.
                await users.DeleteAsync(user);
                throw ApiException.ServiceUnavailable(
                    "Your account couldn't be created because the confirmation email " +
                    "couldn't be sent. Please try again later or contact the administrator.");
            }
        }

        // Mirrors the existing-account branch above: an account still awaiting
        // confirmation or approval gets a clear 401, never a usable session.
        EnsureSignInAllowed(user);
        return BuildAuthResponse(user, await users.GetRolesAsync(user), tokens, spacetime);
    }

    private static async Task<AuthResponse> Login(
        LoginRequest request,
        UserManager<ApplicationUser> users,
        TokenService tokens,
        SpacetimeTokenService spacetime,
        SpacetimeClient spacetimeClient,
        ILoggerFactory loggerFactory)
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

        // Every account has its real, deterministic identity from creation, so
        // an admin's instance-admin flag can be pushed straight through. Best-effort.
        await SyncAdminFlagBestEffort(user, users, spacetimeClient, loggerFactory);

        return BuildAuthResponse(user, await users.GetRolesAsync(user), tokens, spacetime);
    }

    /// <summary>
    /// Pushes <c>is_admin = true</c> to SpacetimeDB for an account that holds the
    /// ASP.NET <c>Admin</c> role, keeping the chat-domain admin gate in sync.
    /// Never blocks sign-in: a failure (SpacetimeDB down, identity not yet
    /// registered) is logged and swallowed; the next grant or sign-in retries.
    /// </summary>
    private static async Task SyncAdminFlagBestEffort(
        ApplicationUser user,
        UserManager<ApplicationUser> users,
        SpacetimeClient spacetime,
        ILoggerFactory loggerFactory)
    {
        try
        {
            if (await users.IsInRoleAsync(user, DbInitializer.AdminRole))
            {
                await spacetime.SyncUserAdminAsync(user.SpacetimeIdentity, true);
            }
        }
        catch (Exception ex)
        {
            loggerFactory.CreateLogger("CoreApi.Auth").LogWarning(
                ex, "Could not sync admin flag to SpacetimeDB for {User} on login", user.UserName);
        }
    }

    private static async Task<VerifyResponse> Verify(VerifyRequest request, TokenService tokens)
    {
        var username = await tokens.ValidateAsync(request.SessionToken);
        return new VerifyResponse(username is not null);
    }

    /// <summary>
    /// The signed-in account's own details, for the Settings surface. Email and
    /// username are only ever stored here, so this is the client's only way to
    /// show them. The session token identifies the account — a caller cannot ask
    /// about anyone else.
    /// </summary>
    private static async Task<AccountResponse> Account(
        AccountRequest request,
        UserManager<ApplicationUser> users,
        TokenService tokens)
    {
        var username = await tokens.ValidateAsync(request.SessionToken)
            ?? throw ApiException.Unauthorized("Not signed in.");

        var user = await users.FindByNameAsync(username)
            ?? throw ApiException.Unauthorized("Not signed in.");

        return new AccountResponse(
            user.UserName!,
            user.DisplayName,
            user.Email ?? string.Empty,
            StatusToString(user.Status),
            user.EmailConfirmed,
            // Force the UTC marker on — the column is UTC by construction, but a
            // round-trip can hand back Kind.Unspecified, which "o" renders
            // without the trailing Z and the client would then read as local.
            DateTime.SpecifyKind(user.CreatedAtUtc, DateTimeKind.Utc)
                .ToString("o", CultureInfo.InvariantCulture));
    }

    /// <summary>
    /// Changes the signed-in account's password after verifying the current one.
    ///
    /// <para>
    /// <c>/auth/link</c> can also set a password, but on the strength of the
    /// session alone — anyone at an unlocked, signed-in client could lock the
    /// owner out. That path stays for account creation and older clients; this
    /// is what the Settings UI calls.
    /// </para>
    /// </summary>
    private static async Task<IResult> ChangePassword(
        ChangePasswordRequest request,
        UserManager<ApplicationUser> users,
        TokenService tokens)
    {
        var username = await tokens.ValidateAsync(request.SessionToken)
            ?? throw ApiException.Unauthorized("Sign in before changing your password.");

        var user = await users.FindByNameAsync(username)
            ?? throw ApiException.Unauthorized("Sign in before changing your password.");

        Validation.ValidatePassword(request.NewPassword ?? string.Empty);

        var result = await users.ChangePasswordAsync(
            user, request.CurrentPassword ?? string.Empty, request.NewPassword!);
        if (!result.Succeeded)
        {
            throw TranslateIdentityFailure(result);
        }

        user.UpdatedAtUtc = DateTime.UtcNow;
        await users.UpdateAsync(user);
        return Results.NoContent();
    }

    /// <summary>Wire name for an account's lifecycle status.</summary>
    private static string StatusToString(AccountStatus status) => status switch
    {
        AccountStatus.Registered => "registered",
        AccountStatus.EmailVerified => "email_verified",
        AccountStatus.Active => "active",
        AccountStatus.Disabled => "disabled",
        AccountStatus.Rejected => "rejected",
        _ => "unknown",
    };

    private static async Task<RenewSessionResponse> RenewSession(
        RenewSessionRequest request,
        UserManager<ApplicationUser> users,
        TokenService tokens,
        SpacetimeTokenService spacetime)
    {
        // Verify the SpacetimeDB token cryptographically (signature + lifetime);
        // its `sub` is the account id. No DB token-equality lookup.
        var subject = await spacetime.ValidateAndGetSubjectAsync(request.SpacetimeToken)
            ?? throw ApiException.Unauthorized("Could not renew session for this account.");

        var user = await users.FindByIdAsync(subject)
            ?? throw ApiException.Unauthorized("Could not renew session for this account.");

        EnsureSignInAllowed(user);
        var roles = await users.GetRolesAsync(user);
        return new RenewSessionResponse(tokens.IssueSession(user.UserName!, roles));
    }

    /// <summary>
    /// Email-link target — confirms the address and advances the account. With
    /// admin approval enabled the account moves to <c>EmailVerified</c> (waiting
    /// for an admin); otherwise straight to <c>Active</c>.
    /// </summary>
    private static async Task<IResult> ConfirmEmail(
        string? userId, string? token,
        UserManager<ApplicationUser> users,
        SystemConfigService config)
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

        // Already past the Registered stage — report the current state idempotently.
        if (user.EmailConfirmed && user.Status != AccountStatus.Registered)
        {
            return ConfirmedStatePage(user.Status);
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
            user.Status = config.Current.RequireAdminApproval
                ? AccountStatus.EmailVerified
                : AccountStatus.Active;
            user.UpdatedAtUtc = DateTime.UtcNow;
            await users.UpdateAsync(user);
        }

        return ConfirmedStatePage(user.Status);
    }

    private static IResult ConfirmedStatePage(AccountStatus status) => status switch
    {
        AccountStatus.EmailVerified => HtmlPage(
            "Email confirmed",
            "Your email address is confirmed. Your account is now awaiting administrator " +
            "approval — you'll be able to sign in once it has been approved.",
            ok: true),
        AccountStatus.Active => HtmlPage(
            "Email confirmed",
            "Your email address is confirmed. You can now sign in to LetsChat.",
            ok: true),
        _ => HtmlPage("Email confirmed", "Your email address is confirmed.", ok: true),
    };

    /// <summary>
    /// Reports an account's lifecycle status so the client's pending screen can
    /// advance once the email is confirmed (and/or approved). Requires the
    /// SpacetimeDB identity to match the account — no username enumeration.
    /// </summary>
    private static async Task<RegistrationStatusResponse> RegistrationStatus(
        RegistrationStatusRequest request,
        UserManager<ApplicationUser> users)
    {
        var username = Validation.NormalizeUsername(request.Username ?? string.Empty);
        var identityNorm = Validation.NormalizeIdentity(request.SpacetimeIdentity ?? string.Empty);

        var user = string.IsNullOrEmpty(username) ? null : await users.FindByNameAsync(username);
        if (user is null
            || identityNorm.Length == 0
            || !string.Equals(user.SpacetimeIdentityNorm, identityNorm, StringComparison.Ordinal))
        {
            return new RegistrationStatusResponse("unknown");
        }

        return new RegistrationStatusResponse(StatusToString(user.Status));
    }

    /// <summary>Re-sends the confirmation email. Always responds generically.</summary>
    private static async Task<IResult> ResendConfirmation(
        ResendConfirmationRequest request,
        UserManager<ApplicationUser> users,
        AccountEmailService accountEmail)
    {
        // Look the account up by whichever identifier was supplied: email (the
        // post-registration screen) or username (the blocked-login screen).
        ApplicationUser? user = null;
        if (!string.IsNullOrWhiteSpace(request.Email))
        {
            user = await users.FindByEmailAsync(Validation.NormalizeEmail(request.Email));
        }
        else if (!string.IsNullOrWhiteSpace(request.Username))
        {
            user = await users.FindByNameAsync(Validation.NormalizeUsername(request.Username));
        }

        if (user is { Status: AccountStatus.Registered, EmailConfirmed: false })
        {
            await accountEmail.SendConfirmationEmailAsync(user);
        }

        // Generic response — never reveal whether an account exists.
        return Results.Json(new
        {
            status = "ok",
            message = "If that account exists and is unconfirmed, a new confirmation email has been sent.",
        });
    }

    /// <summary>
    /// Starts the password-reset flow: mails a tokenised reset link to the
    /// address if it belongs to a confirmed account. Always answered generically
    /// so it can't enumerate which addresses are registered.
    /// </summary>
    private static async Task<IResult> ForgotPassword(
        ForgotPasswordRequest request,
        UserManager<ApplicationUser> users,
        AccountEmailService accountEmail)
    {
        var email = Validation.NormalizeEmail(request.Email);
        var user = await users.FindByEmailAsync(email);

        // Only confirmed accounts can reset — an unconfirmed one has no proven
        // owner of the inbox yet. Resetting never grants sign-in on its own;
        // EnsureSignInAllowed still gates login afterwards.
        if (user is { EmailConfirmed: true })
        {
            await accountEmail.SendPasswordResetEmailAsync(user);
        }

        return Results.Json(new
        {
            status = "ok",
            message = "If that address has an account, a password-reset email has been sent.",
        });
    }

    /// <summary>
    /// Browser-facing form the reset email link opens — carries the userId and
    /// token forward into the POST. The token isn't validated until submit.
    /// </summary>
    private static IResult ResetPasswordForm(string? userId, string? token)
    {
        if (string.IsNullOrEmpty(userId) || string.IsNullOrEmpty(token))
        {
            return HtmlPage("Invalid link", "This password-reset link is malformed.", ok: false);
        }

        return ResetPasswordFormPage(userId, token);
    }

    /// <summary>
    /// Consumes the reset token and sets the new password. Posted by the browser
    /// form above (form-encoded), so it renders HTML rather than JSON.
    /// </summary>
    private static async Task<IResult> ResetPassword(
        HttpContext http,
        UserManager<ApplicationUser> users)
    {
        var form = await http.Request.ReadFormAsync();
        var userId = form["userId"].ToString();
        var token = form["token"].ToString();
        var password = form["password"].ToString();
        var confirm = form["confirmPassword"].ToString();

        if (string.IsNullOrEmpty(userId) || string.IsNullOrEmpty(token))
        {
            return HtmlPage("Invalid link", "This password-reset link is malformed.", ok: false);
        }

        if (password != confirm)
        {
            return ResetPasswordFormPage(userId, token, "The two passwords do not match.");
        }

        try
        {
            Validation.ValidatePassword(password);
        }
        catch (ApiException ex)
        {
            return ResetPasswordFormPage(userId, token, ex.Message);
        }

        var user = await users.FindByIdAsync(userId);
        if (user is null)
        {
            return HtmlPage("Invalid link", "This password-reset link is no longer valid.", ok: false);
        }

        var result = await users.ResetPasswordAsync(user, token, password);
        if (!result.Succeeded)
        {
            // A duplicate/expired token lands here; surface a retry path.
            return HtmlPage(
                "Link expired",
                "This password-reset link is invalid or has expired. Request a new one from the app.",
                ok: false);
        }

        return HtmlPage(
            "Password updated",
            "Your password has been reset. You can now sign in to LetsChat with your new password.",
            ok: true);
    }

    private static AuthResponse BuildAuthResponse(
        ApplicationUser user, IEnumerable<string> roles, TokenService tokens, SpacetimeTokenService spacetime)
    {
        var session = tokens.IssueSession(user.UserName!, roles);
        // The SpacetimeDB token is minted fresh (never stored); the client
        // presents it to SpacetimeDB, which derives the same identity we hold.
        var spacetimeToken = spacetime.Mint(user.Id);
        return new AuthResponse(
            user.UserName!,
            user.DisplayName,
            spacetimeToken,
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

    /// <summary>
    /// Renders the "choose a new password" form the reset email link opens.
    /// Posts back to the same path with the userId/token carried in hidden inputs.
    /// </summary>
    private static IResult ResetPasswordFormPage(string userId, string token, string? error = null)
    {
        var encodedUserId = System.Net.WebUtility.HtmlEncode(userId);
        var encodedToken = System.Net.WebUtility.HtmlEncode(token);
        var errorHtml = error is null
            ? ""
            : $"""<p style="color:#dc2626;font-size:14px;margin:0 0 16px">{System.Net.WebUtility.HtmlEncode(error)}</p>""";
        var html =
            $"""
             <!doctype html>
             <html lang="en">
             <head>
               <meta charset="utf-8">
               <meta name="viewport" content="width=device-width, initial-scale=1">
               <title>Reset password — LetsChat</title>
             </head>
             <body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
                          background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
               <form method="post" action="/auth/reset-password"
                     style="background:#fff;border-radius:12px;padding:36px;max-width:380px;width:100%;
                            box-shadow:0 1px 3px rgba(0,0,0,.1)">
                 <h1 style="font-size:20px;color:#111827;margin:0 0 6px">Choose a new password</h1>
                 <p style="color:#6b7280;font-size:14px;margin:0 0 20px">Enter a new password for your LetsChat account.</p>
                 {errorHtml}
                 <input type="hidden" name="userId" value="{encodedUserId}">
                 <input type="hidden" name="token" value="{encodedToken}">
                 <label style="display:block;font-size:13px;color:#374151;margin:0 0 6px">New password</label>
                 <input type="password" name="password" required autofocus
                        style="width:100%;box-sizing:border-box;padding:10px 12px;font-size:15px;margin:0 0 16px;
                               border:1px solid #d1d5db;border-radius:8px">
                 <label style="display:block;font-size:13px;color:#374151;margin:0 0 6px">Confirm password</label>
                 <input type="password" name="confirmPassword" required
                        style="width:100%;box-sizing:border-box;padding:10px 12px;font-size:15px;margin:0 0 20px;
                               border:1px solid #d1d5db;border-radius:8px">
                 <button type="submit"
                         style="width:100%;padding:11px;font-size:15px;font-weight:600;color:#fff;background:#4f46e5;
                                border:none;border-radius:8px;cursor:pointer">Reset password</button>
               </form>
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
