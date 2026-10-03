using SpacetimeDB;

namespace ArchiveWorker;

/// <summary>One in-flight restore batch; only a server commit acknowledges it.</summary>
internal sealed class ConfirmedRestore(Action tick, TimeSpan timeout)
{
    private TaskCompletionSource? _pending;

    public void Complete(Status status)
    {
        if (status is Status.Committed) _pending?.TrySetResult();
        else _pending?.TrySetException(new InvalidOperationException(status switch
        {
            Status.Failed(var reason) => $"Restore reducer failed: {reason}",
            Status.OutOfEnergy => "Restore reducer ran out of energy.",
            _ => $"Unexpected restore status: {status}",
        }));
    }

    public async Task ExecuteAsync(Action submit, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        if (_pending is not null) throw new InvalidOperationException("A restore batch is already pending.");
        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending = completion;
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(timeout);
        try
        {
            submit();
            while (!completion.Task.IsCompleted)
            {
                deadline.Token.ThrowIfCancellationRequested();
                tick();
                if (!completion.Task.IsCompleted) await Task.Delay(10, deadline.Token);
            }
            await completion.Task;
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new TimeoutException($"Restore batch was not confirmed within {timeout}. Restore may be incomplete; retry it before resuming normal operation.");
        }
        finally
        {
            _pending = null;
        }
    }
}
