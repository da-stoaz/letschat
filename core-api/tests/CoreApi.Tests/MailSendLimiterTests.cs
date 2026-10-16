using CoreApi.Services;
using Microsoft.Extensions.Caching.Memory;

namespace CoreApi.Tests;

public sealed class MailSendLimiterTests
{
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Initial_Confirmation_Allows_Immediate_Correction_Or_Resend_After_30_Seconds(bool correctFirst)
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var clock = new TestClock();
        var limiter = new MailSendLimiter(cache, clock);
        Assert.True(limiter.TryAcquire("account", initialConfirmation: true));
        Assert.False(limiter.TryAcquire("account"));
        if (!correctFirst)
        {
            clock.Advance(TimeSpan.FromSeconds(29));
            Assert.False(limiter.TryAcquire("account"));
            clock.Advance(TimeSpan.FromSeconds(1));
        }
        Assert.True(limiter.TryAcquire("account", correctingAddress: correctFirst));
        Assert.False(limiter.TryAcquire("account"));
        Assert.False(limiter.TryAcquire("account", correctingAddress: true));
        clock.Advance(TimeSpan.FromSeconds(59));
        Assert.False(limiter.TryAcquire("account", correctingAddress: true));
        clock.Advance(TimeSpan.FromSeconds(1));
        Assert.True(limiter.TryAcquire("account", correctingAddress: !correctFirst));
        clock.Advance(TimeSpan.FromSeconds(60));
        Assert.False(limiter.TryAcquire("account", correctingAddress: true));
    }

    [Fact]
    public void Enforces_Minimum_Gap_And_Rolling_Hour_Without_Extending_Rejected_Attempts()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var clock = new TestClock();
        var limiter = new MailSendLimiter(cache, clock);
        Assert.True(limiter.TryAcquire("account"));
        clock.Advance(TimeSpan.FromSeconds(59));
        Assert.False(limiter.TryAcquire("account"));
        clock.Advance(TimeSpan.FromSeconds(1));
        Assert.True(limiter.TryAcquire("account"));
        clock.Advance(TimeSpan.FromSeconds(90));
        Assert.True(limiter.TryAcquire("account"));
        clock.Advance(TimeSpan.FromSeconds(60));
        Assert.False(limiter.TryAcquire("account"));
        Assert.True(limiter.TryAcquire("other-account"));
        clock.Advance(TimeSpan.FromHours(1));
        Assert.True(limiter.TryAcquire("account"));
    }

    [Fact]
    public async Task Concurrent_Requests_Reserve_Only_One_Send()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var limiter = new MailSendLimiter(cache);
        var results = await Task.WhenAll(Enumerable.Range(0, 100)
            .Select(_ => Task.Run(() => limiter.TryAcquire("account"))));
        Assert.Single(results.Where(acquired => acquired));
    }
}
