using Microsoft.EntityFrameworkCore;

namespace CoreApi.Data.Archive;

/// <summary>
/// EF Core context for the PostgreSQL <c>archive</c> database (storage-tiering,
/// plan 2): a verbatim mirror of the durable SpacetimeDB tables. core-api owns
/// this schema and applies its migrations on startup, kept in a database
/// separate from <c>auth</c> to isolate the two very different workloads (auth:
/// small, critical, tiny reads; archive: large, append-mostly).
/// </summary>
public sealed class ArchiveDbContext(DbContextOptions<ArchiveDbContext> options) : DbContext(options)
{
    public DbSet<ArchiveUser> Users => Set<ArchiveUser>();
    public DbSet<ArchiveServer> Servers => Set<ArchiveServer>();
    public DbSet<ArchiveServerMember> ServerMembers => Set<ArchiveServerMember>();
    public DbSet<ArchiveBan> Bans => Set<ArchiveBan>();
    public DbSet<ArchiveJoinRequest> JoinRequests => Set<ArchiveJoinRequest>();
    public DbSet<ArchiveInvite> Invites => Set<ArchiveInvite>();
    public DbSet<ArchiveDmServerInvite> DmServerInvites => Set<ArchiveDmServerInvite>();
    public DbSet<ArchiveChannel> Channels => Set<ArchiveChannel>();
    public DbSet<ArchiveMessage> Messages => Set<ArchiveMessage>();
    public DbSet<ArchiveDirectMessage> DirectMessages => Set<ArchiveDirectMessage>();
    public DbSet<ArchiveFriend> Friends => Set<ArchiveFriend>();
    public DbSet<ArchiveBlock> Blocks => Set<ArchiveBlock>();
    public DbSet<ArchiveReadState> ReadStates => Set<ArchiveReadState>();
    public DbSet<ReplicationState> ReplicationState => Set<ReplicationState>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        // Auto-inc ids are assigned upstream (SpacetimeDB) and copied verbatim —
        // never database-generated here, or explicit-id inserts would fight an
        // identity sequence.
        builder.Entity<ArchiveServer>().Property(e => e.Id).ValueGeneratedNever();
        builder.Entity<ArchiveDmServerInvite>().Property(e => e.Id).ValueGeneratedNever();
        builder.Entity<ArchiveChannel>().Property(e => e.Id).ValueGeneratedNever();
        builder.Entity<ArchiveMessage>().Property(e => e.Id).ValueGeneratedNever();
        builder.Entity<ArchiveDirectMessage>().Property(e => e.Id).ValueGeneratedNever();

        // Read-pattern indexes (archive read API, phase 3).
        builder.Entity<ArchiveServerMember>().HasIndex(e => e.ServerId);
        builder.Entity<ArchiveBan>().HasIndex(e => e.ServerId);
        builder.Entity<ArchiveJoinRequest>().HasIndex(e => e.ServerId);
        builder.Entity<ArchiveInvite>().HasIndex(e => e.ServerId);
        builder.Entity<ArchiveChannel>().HasIndex(e => e.ServerId);
        builder.Entity<ArchiveMessage>().HasIndex(e => new { e.ChannelId, e.SentAt });

        builder.Entity<ArchiveDirectMessage>(dm =>
        {
            // Sorted identity pair, computed in the database; one index serves a
            // conversation regardless of who sent which message.
            dm.Property(e => e.ConversationKey).HasComputedColumnSql(
                "LEAST(sender_identity, recipient_identity) || ':' || GREATEST(sender_identity, recipient_identity)",
                stored: true);
            dm.HasIndex(e => new { e.ConversationKey, e.SentAt });
        });

        builder.Entity<ReplicationState>(rs =>
        {
            rs.Property(e => e.RowCount).HasDefaultValue(0L);
            rs.Property(e => e.UpdatedAt).HasDefaultValueSql("now()");
        });
    }
}
