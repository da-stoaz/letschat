namespace CoreApi.Services;

/// <summary>
/// Finishes the SpacetimeDB side of an install without an operator: pins
/// core-api's OIDC issuer into the module (which fails closed until then, so
/// nobody can register) and registers the archive-worker's identity (without
/// which the cold archive silently replicates nothing).
///
/// <para>
/// Retries until both are done, because on a fresh install neither can succeed
/// at first: module-init publishes — and writes the owner credential core-api
/// reads — only after SpacetimeDB is healthy, and the worker persists its token
/// on its first connect. Runs after the listener is up, so SpacetimeDB can also
/// fetch this service's JWKS when an admin's minted token is the credential.
/// </para>
/// </summary>
public sealed class SpacetimeBootstrapper(
    SpacetimeClient spacetime,
    Configuration.ServiceOptions options,
    ILogger<SpacetimeBootstrapper> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(10);

    /// <summary>Log on the first failure, then every ~5 minutes while retrying.</summary>
    private const int QuietRounds = 30;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var issuerPinned = false;
        var archiveRegistered = options.ArchiveWorkerTokenFile is null;

        for (var round = 1; !stoppingToken.IsCancellationRequested; round++)
        {
            var loud = round == 1 || round % QuietRounds == 0;
            if (!issuerPinned)
            {
                issuerPinned = await AttemptAsync(
                    () => spacetime.PinTrustedIssuerAsync(stoppingToken), loud,
                    "Registration stays closed until the trusted issuer is pinned: no module-owner "
                    + "credential yet (SPACETIMEDB_SERVICE_TOKEN or SPACETIMEDB_SERVICE_TOKEN_FILE).");
            }
            if (!archiveRegistered)
            {
                archiveRegistered = await AttemptAsync(
                    () => spacetime.RegisterArchiveServiceAsync(stoppingToken), loud,
                    "Archive-worker identity not registered yet: its token file or an admin "
                    + "credential is missing, so the cold archive is not replicating.");
            }
            if (issuerPinned && archiveRegistered)
            {
                return;
            }

            try
            {
                await Task.Delay(Interval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    private async Task<bool> AttemptAsync(Func<Task<bool>> step, bool loud, string notReady)
    {
        try
        {
            if (await step())
            {
                return true;
            }
            if (loud)
            {
                logger.LogWarning("{Reason}", notReady);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // SpacetimeDB still starting, module not published yet, … — retried.
            if (loud)
            {
                logger.LogWarning(ex, "SpacetimeDB bootstrap step failed; retrying.");
            }
        }
        return false;
    }
}
