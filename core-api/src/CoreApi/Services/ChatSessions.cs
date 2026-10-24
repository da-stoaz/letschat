using System.Security.Cryptography;
using CoreApi.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.IdentityModel.JsonWebTokens;

namespace CoreApi.Services;

/// <summary>
/// The public chat transport checks PostgreSQL, the account authority. Module
/// views only receive an identity and cannot distinguish two token generations.
/// </summary>
public sealed class ChatSessions(IServiceScopeFactory scopes, SpacetimeTokenService tokens) : IDisposable
{
    internal sealed record Credential(string Token, string UserId, long Generation, DateTime ExpiresAt);
    private readonly MemoryCache _tickets = new(new MemoryCacheOptions { SizeLimit = 4096 });
    private readonly object _gate = new();
    private readonly Dictionary<Guid, (Credential Credential, CancellationTokenSource Stop)> _connections = [];

    internal async Task<Credential?> AuthenticateAsync(string? token, CancellationToken ct)
    {
        var subject = await tokens.ValidateAndGetSubjectAsync(token);
        if (subject is null) return null;
        var credential = new Credential(token!, subject, SpacetimeTokenService.ReadGeneration(token),
            new JsonWebToken(token).ValidTo);
        return await IsCurrentAsync(credential, ct) ? credential : null;
    }

    internal async Task<bool> IsCurrentAsync(Credential credential, CancellationToken ct)
    {
        if (credential.ExpiresAt <= DateTime.UtcNow) return false;
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.Users.AsNoTracking().AnyAsync(user => user.Id == credential.UserId
            && user.Status == AccountStatus.Active && user.TokenGeneration == credential.Generation, ct);
    }

    internal string IssueTicket(Credential credential)
    {
        var ticket = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
        _tickets.Set(ticket, credential, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30),
            Size = 1,
        });
        return ticket;
    }

    internal Credential? TakeTicket(string ticket)
    {
        lock (_gate)
        {
            if (!_tickets.TryGetValue<Credential>(ticket, out var credential)) return null;
            _tickets.Remove(ticket);
            return credential;
        }
    }

    internal Guid Register(Credential credential, CancellationTokenSource stop)
    {
        lock (_gate)
        {
            var id = Guid.NewGuid();
            _connections.Add(id, (credential, stop));
            return id;
        }
    }

    internal void Remove(Guid id)
    {
        lock (_gate) _connections.Remove(id);
    }

    public void Revoke(ApplicationUser user)
    {
        lock (_gate)
        {
            foreach (var (credential, stop) in _connections.Values)
            {
                if (credential.UserId == user.Id
                    && (user.Status != AccountStatus.Active || credential.Generation < user.TokenGeneration))
                    stop.Cancel();
            }
        }
    }

    public void Dispose() => _tickets.Dispose();
}
