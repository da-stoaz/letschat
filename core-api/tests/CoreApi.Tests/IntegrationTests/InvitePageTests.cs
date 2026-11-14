using System.Net;
using System.Text;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// <c>/invite/{token}</c> is what link unfurlers fetch. It may show a space's
/// name, HTML-encoded, and nothing else; every other answer from the module
/// (none, missing procedure, outage) falls back to the same generic card.
/// </summary>
public sealed class InvitePageTests
{
    private static async Task<(HttpStatusCode Status, string Html, HttpResponseMessage Response)> GetAsync(
        string path, HttpStatusCode moduleStatus, string moduleBody)
    {
        await using var factory = new LetsChatWebApplicationFactory { SpacetimeTransport = new Stub(moduleStatus, moduleBody) };
        var response = await factory.CreateClient().GetAsync(path);
        return (response.StatusCode, await response.Content.ReadAsStringAsync(), response);
    }

    [Fact]
    public async Task LiveInvite_ShowsTheEncodedSpaceName_InTheCard()
    {
        var (status, html, response) = await GetAsync("/invite/Abc123", HttpStatusCode.OK, "[0,\"Rock & <Roll>\"]");

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Contains("<meta property=\"og:title\" content=\"Join Rock &amp; &lt;Roll&gt; on LetsChat\">", html);
        Assert.Contains("content=\"http://localhost:8787/img/letschat-logo.png\"", html);
        Assert.Contains("letschat://join?", html);
        Assert.Contains("&amp;i=Abc123", html);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.Contains("no-referrer", response.Headers.GetValues("Referrer-Policy"));
    }

    [Theory]
    [InlineData(HttpStatusCode.OK, "[1,[]]")]
    [InlineData(HttpStatusCode.NotFound, "No such procedure")]
    [InlineData(HttpStatusCode.InternalServerError, "")]
    public async Task AnythingElse_GetsTheGenericCard(HttpStatusCode moduleStatus, string moduleBody)
    {
        var (status, html, _) = await GetAsync("/invite/Abc123", moduleStatus, moduleBody);

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Contains("content=\"You&#x27;re invited to a LetsChat space\"", html);
    }

    [Fact]
    public async Task MalformedToken_IsNotLookedUp()
    {
        var (status, _, _) = await GetAsync("/invite/not-a-token", HttpStatusCode.OK, "[0,\"Leak\"]");
        Assert.Equal(HttpStatusCode.NotFound, status);
    }

    private sealed class Stub(HttpStatusCode status, string body) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
    }
}
