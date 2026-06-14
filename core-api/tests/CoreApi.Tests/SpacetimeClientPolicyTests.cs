using System.Net;
using System.Text;
using CoreApi.Configuration;
using CoreApi.Services;
using Microsoft.Extensions.Configuration;

namespace CoreApi.Tests;

/// <summary>
/// <see cref="SpacetimeClient.GetSpaceCreatePolicyAsync"/> decoding. The /sql
/// response is <c>[{ "rows": [[&lt;col&gt;]] }]</c> and the policy enum is a
/// SATS sum encoded as <c>[tag, body]</c> (tag 0 = anyone, 1 = adminsOnly) —
/// verified against a live SpacetimeDB 2.2.1.
/// </summary>
public sealed class SpacetimeClientPolicyTests
{
    private static SpacetimeClient Client(string body, HttpStatusCode status = HttpStatusCode.OK)
    {
        var options = ServiceOptions.FromConfiguration(new ConfigurationBuilder().Build());
        return new SpacetimeClient(new StubFactory(new StubHandler(status, body)), options);
    }

    [Fact]
    public async Task ParsesAnyone_FromTheSatsSumEncoding()
    {
        var client = Client("[{\"rows\":[[[0,[]]]]}]");
        Assert.Equal(SpaceCreatePolicy.Anyone, await client.GetSpaceCreatePolicyAsync());
    }

    [Fact]
    public async Task ParsesAdminsOnly_FromTheSatsSumEncoding()
    {
        var client = Client("[{\"rows\":[[[1,[]]]]}]");
        Assert.Equal(SpaceCreatePolicy.AdminsOnly, await client.GetSpaceCreatePolicyAsync());
    }

    [Fact]
    public async Task ParsesAdminsOnly_FromTheLegacyObjectEncoding()
    {
        var client = Client("[{\"rows\":[[{\"adminsOnly\":[]}]]}]");
        Assert.Equal(SpaceCreatePolicy.AdminsOnly, await client.GetSpaceCreatePolicyAsync());
    }

    [Fact]
    public async Task DefaultsToAnyone_OnNonSuccess()
    {
        var client = Client(string.Empty, HttpStatusCode.InternalServerError);
        Assert.Equal(SpaceCreatePolicy.Anyone, await client.GetSpaceCreatePolicyAsync());
    }

    [Fact]
    public async Task DefaultsToAnyone_OnEmptyResult()
    {
        var client = Client("[{\"rows\":[]}]");
        Assert.Equal(SpaceCreatePolicy.Anyone, await client.GetSpaceCreatePolicyAsync());
    }

    private sealed class StubHandler(HttpStatusCode status, string body) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(status)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            });
    }

    private sealed class StubFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }
}
