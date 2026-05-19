using CoreApi.Data;
using CoreApi.Models;
using CoreApi.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace CoreApi.Endpoints;

/// <summary>
/// <c>/auth/*</c> endpoints — register, link, login, verify, renew-session,
/// refresh-spacetime-token. Re-implements <c>handlers/auth.rs</c> on ASP.NET
/// Core Identity with the JSON contract unchanged.
/// </summary>
public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapPost("/auth/register", Register);
        routes.MapPost("/auth/link", Link);
        routes.MapPost("/auth/login", Login);
        routes.MapPost("/auth/verify", Verify);
        routes.MapPost("/auth/renew-session", RenewSession);
        routes.MapPost("/auth/refresh-spacetime-token", RefreshSpacetimeToken);
    }

    private static async Task<AuthResponse> Register(
        RegisterRequest request,
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
            DisplayName = displayName,
            SpacetimeIdentity = spacetimeIdentity,
            SpacetimeIdentityNorm = identityNorm,
            SpacetimeToken = spacetimeToken,
            // Phase 1 preserves the legacy behaviour: a fresh registration is
            // immediately usable. Email verification (Phase 2) and approval
            // (Phase 3) will gate this.
            Status = AccountStatus.Active,
            EmailConfirmed = true,
        };

        var result = await users.CreateAsync(user, request.Password);
        if (!result.Succeeded)
        {
            throw TranslateIdentityFailure(result);
        }

        return await BuildAuthResponse(user, users, tokens);
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

            return await BuildAuthResponse(existing, users, tokens);
        }

        if (await users.Users.AnyAsync(u => u.SpacetimeIdentityNorm == identityNorm))
        {
            throw ApiException.Conflict(
                "Spacetime identity is already linked to another account.");
        }

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

        // Legacy contract: an empty JSON object on success.
        return Results.Json(new { });
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

    /// <summary>
    /// Maps an Identity failure to an <see cref="ApiException"/>. A unique
    /// constraint surfaces as 409; everything else as 400.
    /// </summary>
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
