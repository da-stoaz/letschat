namespace ArchiveWorker;

internal static class Program
{
    private static void Main(string[] args)
    {
        var builder = Host.CreateApplicationBuilder(args);

        builder.Services.AddSingleton(WorkerOptions.FromConfiguration(builder.Configuration));
        builder.Services.AddSingleton(_ => new HttpClient { Timeout = TimeSpan.FromSeconds(10) });
        builder.Services.AddSingleton<ArchiveCredentials>();
        builder.Services.AddSingleton<ArchiveDatabase>();
        builder.Services.AddSingleton<Replication>();
        builder.Services.AddSingleton<Rebuild>();
        builder.Services.AddHostedService<ReplicationWorker>();

        var host = builder.Build();
        host.Run();
    }
}
