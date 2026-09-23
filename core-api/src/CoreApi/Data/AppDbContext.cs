using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace CoreApi.Data;

/// <summary>
/// EF Core context for the PostgreSQL <c>auth</c> database: the ASP.NET Core
/// Identity schema (<c>AspNetUsers</c>, <c>AspNetRoles</c>, …) plus upload
/// reservation, confirmed-object, and daily-rate bookkeeping.
/// </summary>
public sealed class AppDbContext(DbContextOptions<AppDbContext> options)
    : IdentityDbContext<ApplicationUser, IdentityRole, string>(options)
{
    public DbSet<PendingUpload> PendingUploads => Set<PendingUpload>();
    public DbSet<UploadQuota> UploadQuotas => Set<UploadQuota>();
    public DbSet<ConfirmedUpload> ConfirmedUploads => Set<ConfirmedUpload>();
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
            upload.Property(u => u.QuotaDate).HasMaxLength(10);
            upload.Property(u => u.MultipartUploadId).HasMaxLength(512);
            upload.HasIndex(u => u.ExpiresAt);
            upload.HasIndex(u => u.Username);
        });

        builder.Entity<UploadQuota>(quota =>
        {
            quota.HasKey(q => new { q.Username, q.QuotaDate });
            quota.Property(q => q.Username).HasMaxLength(64);
            quota.Property(q => q.QuotaDate).HasMaxLength(10);
        });

        builder.Entity<ConfirmedUpload>(upload =>
        {
            upload.HasKey(u => u.StorageKey);
            upload.Property(u => u.StorageKey).HasMaxLength(512);
            upload.Property(u => u.Username).HasMaxLength(64);
            upload.Property(u => u.FileName).HasMaxLength(512);
            upload.Property(u => u.MimeType).HasMaxLength(256);
            upload.HasIndex(u => u.ConfirmedAt);
            upload.HasIndex(u => u.Username);
            upload.Property(u => u.UploadId).HasMaxLength(64);
            upload.HasIndex(u => u.UploadId).IsUnique().HasFilter("\"UploadId\" IS NOT NULL");
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
