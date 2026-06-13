using ArchiveWorker;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddSingleton(WorkerOptions.FromConfiguration(builder.Configuration));
builder.Services.AddSingleton<ArchiveDatabase>();
builder.Services.AddSingleton<Replication>();
builder.Services.AddHostedService<ReplicationWorker>();

var host = builder.Build();
host.Run();
