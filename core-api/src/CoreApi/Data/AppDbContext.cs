using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace CoreApi.Data;

/// <summary>
/// EF Core context for the PostgreSQL <c>auth</c> database: the ASP.NET Core
/// Identity schema (<c>AspNetUsers</c>, <c>AspNetRoles</c>, …) plus the two
/// upload bookkeeping tables carried over from the legacy service.
/// </summary>
public sealed class AppDbContext(DbContextOptions<AppDbContext> options)
    : IdentityDbContext<ApplicationUser, IdentityRole, string>(options)
{
    public DbSet<PendingUpload> PendingUploads => Set<PendingUpload>();
    public DbSet<UploadQuota> UploadQuotas => Set<UploadQuota>();
    public DbSet<SystemConfig> SystemConfig => Set<SystemConfig>();
    public DbSet<AuditLogEntry> AuditLog => Set<AuditLogEntry>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<ApplicationUser>(user =>
        {
            user.Property(u => u.DisplayName).HasMaxLength(256);
            user.Property(u => u.SpacetimeIdentity).HasMaxLength(256);
            user.Property(u => u.SpacetimeIdentityNorm).HasMaxLength(256);
            user.Property(u => u.SpacetimeToken).HasMaxLength(4096);

            // The plan's highest-risk invariant: one account ↔ one SpacetimeDB
            // identity. A filtered unique index enforces it at the DB level.
            user.HasIndex(u => u.SpacetimeIdentityNorm)
                .IsUnique()
                .HasFilter("\"SpacetimeIdentityNorm\" <> ''");
        });

        builder.Entity<PendingUpload>(upload =>
        {
            upload.HasKey(u => u.Id);
            upload.Property(u => u.Id).HasMaxLength(64);
            upload.HasIndex(u => u.ExpiresAt);
        });

        builder.Entity<UploadQuota>(quota =>
        {
            quota.HasKey(q => new { q.Username, q.QuotaDate });
            quota.Property(q => q.Username).HasMaxLength(64);
            quota.Property(q => q.QuotaDate).HasMaxLength(10);
        });

        builder.Entity<SystemConfig>(config =>
        {
            // The Id is fixed (SystemConfig.SingletonId); never database-generated.
            config.Property(c => c.Id).ValueGeneratedNever();
        });

        builder.Entity<AuditLogEntry>(audit =>
        {
            audit.Property(a => a.Actor).HasMaxLength(128);
            audit.Property(a => a.Action).HasMaxLength(64);
            audit.Property(a => a.TargetType).HasMaxLength(64);
            audit.Property(a => a.TargetId).HasMaxLength(256);
            audit.HasIndex(a => a.TimestampUtc);
        });
    }
}
