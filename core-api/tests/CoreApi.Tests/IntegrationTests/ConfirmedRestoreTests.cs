using ArchiveWorker;
using SpacetimeDB;

namespace CoreApi.Tests.IntegrationTests;

public sealed class ConfirmedRestoreTests
{
    [Fact]
    public async Task Waits_for_commit_and_pumps_callbacks_before_advancing()
    {
        var ticks = 0;
        var submitted = 0;
        ConfirmedRestore restore = null!;
        restore = new ConfirmedRestore(() =>
        {
            if (++ticks % 3 == 0) restore.Complete(new Status.Committed(default));
        }, TimeSpan.FromSeconds(2));

        await restore.ExecuteAsync(() => submitted++, default);
        Assert.Equal(3, ticks);
        await restore.ExecuteAsync(() => submitted++, default);
        Assert.Equal(6, ticks);
        Assert.Equal(2, submitted);
    }

    [Fact]
    public async Task Reducer_failure_and_energy_exhaustion_fail_the_restore()
    {
        var restore = new ConfirmedRestore(() => { }, TimeSpan.FromSeconds(2));
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => restore.ExecuteAsync(
            () => restore.Complete(new Status.Failed("archive service identity only")), default));
        Assert.Contains("archive service identity only", error.Message);
        await Assert.ThrowsAsync<InvalidOperationException>(() => restore.ExecuteAsync(
            () => restore.Complete(new Status.OutOfEnergy(default)), default));
    }

    [Fact]
    public async Task Missing_acknowledgement_times_out_instead_of_reporting_success()
    {
        var restore = new ConfirmedRestore(() => { }, TimeSpan.FromMilliseconds(30));
        await Assert.ThrowsAsync<TimeoutException>(() => restore.ExecuteAsync(() => { }, default));
    }

    [Fact]
    public async Task Cancellation_stops_waiting_and_does_not_submit_another_batch()
    {
        using var cancelled = new CancellationTokenSource();
        var restore = new ConfirmedRestore(() => cancelled.Cancel(), TimeSpan.FromSeconds(2));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            restore.ExecuteAsync(() => { }, cancelled.Token));
        var submitted = false;
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            restore.ExecuteAsync(() => submitted = true, cancelled.Token));
        Assert.False(submitted);
    }

    [Fact]
    public async Task Disconnect_or_send_errors_are_not_swallowed()
    {
        var restore = new ConfirmedRestore(() => throw new IOException("disconnected"), TimeSpan.FromSeconds(2));
        await Assert.ThrowsAsync<IOException>(() => restore.ExecuteAsync(() => { }, default));
        await Assert.ThrowsAsync<IOException>(() => restore.ExecuteAsync(
            () => throw new IOException("send failed"), default));
    }
}
