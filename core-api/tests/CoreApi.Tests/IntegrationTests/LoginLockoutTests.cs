using System.Net;
using System.Text.Json;
using CoreApi.Endpoints;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// <c>/auth/login</c> under attack (BUG_ANALYSIS A7): repeated wrong passwords
/// lock the account, a good sign-in clears the count, and an oversized password
/// is refused before anything is looked up or hashed.
/// </summary>
public sealed class LoginLockoutTests : IClassFixture<LetsChatWebApplicationFactory>
{
    private const string Password = "supersecret-test-1";
    private readonly LetsChatWebApplicationFactory _factory;

    public LoginLockoutTests(LetsChatWebApplicationFactory factory) => _factory = factory;

    private static async Task RegisterAsync(HttpClient client, string username)
    {
        var response = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/register",
            new { username, displayName = username, password = Password, email = $"{username}@test.local" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private static Task<HttpResponseMessage> LoginAsync(HttpClient client, string username, string password) =>
        LetsChatWebApplicationFactory.PostJsonAsync(client, "/auth/login", new { username, password });

    private static async Task<string> ErrorOf(HttpResponseMessage response)
    {
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("error").GetString()!;
    }

    [Fact]
    public async Task Five_Wrong_Passwords_Lock_The_Account_Even_Against_The_Right_One()
    {
        var client = _factory.CreateClient();
        await RegisterAsync(client, "lockme");

        for (var attempt = 0; attempt < 5; attempt++)
        {
            var wrong = await LoginAsync(client, "lockme", "wrong-password-" + attempt);
            Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
        }

        // Locked: the correct password no longer gets in, and the message says
        // why — waiting is the fix, not retyping.
        var locked = await LoginAsync(client, "lockme", Password);
        Assert.Equal(HttpStatusCode.Unauthorized, locked.StatusCode);
        Assert.Equal(AuthEndpoints.LockedOutMessage, await ErrorOf(locked));
    }

    [Fact]
    public async Task A_Good_Sign_In_Resets_The_Failure_Count()
    {
        var client = _factory.CreateClient();
        await RegisterAsync(client, "resetme");

        for (var attempt = 0; attempt < 4; attempt++)
        {
            await LoginAsync(client, "resetme", "wrong-password-" + attempt);
        }
        Assert.Equal(HttpStatusCode.OK, (await LoginAsync(client, "resetme", Password)).StatusCode);

        // Four more would be the fifth-through-eighth failure if the count had
        // carried over; they are the first-through-fourth again.
        for (var attempt = 0; attempt < 4; attempt++)
        {
            await LoginAsync(client, "resetme", "wrong-again-" + attempt);
        }
        Assert.Equal(HttpStatusCode.OK, (await LoginAsync(client, "resetme", Password)).StatusCode);
    }

    [Fact]
    public async Task The_Fourth_Failure_Does_Not_Lock()
    {
        var client = _factory.CreateClient();
        await RegisterAsync(client, "almost");

        for (var attempt = 0; attempt < 4; attempt++)
        {
            var wrong = await LoginAsync(client, "almost", "wrong-password-" + attempt);
            Assert.Equal("Invalid username or password.", await ErrorOf(wrong));
        }

        Assert.Equal(HttpStatusCode.OK, (await LoginAsync(client, "almost", Password)).StatusCode);
    }

    [Fact]
    public async Task An_Oversized_Password_Is_A_400_On_Login_And_Register()
    {
        var client = _factory.CreateClient();
        var huge = new string('p', Validation.MaxPasswordLength + 1);

        var login = await LoginAsync(client, "whoever", huge);
        Assert.Equal(HttpStatusCode.BadRequest, login.StatusCode);
        Assert.Contains("at most", await ErrorOf(login));

        var register = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/register",
            new { username = "hugepw", displayName = "hugepw", password = huge, email = "hugepw@test.local" });
        Assert.Equal(HttpStatusCode.BadRequest, register.StatusCode);

        // Exactly at the cap is fine.
        var max = new string('p', Validation.MaxPasswordLength);
        var ok = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/register",
            new { username = "maxpw", displayName = "maxpw", password = max, email = "maxpw@test.local" });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await LoginAsync(client, "maxpw", max)).StatusCode);
    }

    [Fact]
    public async Task An_Oversized_Display_Name_Is_A_400()
    {
        var client = _factory.CreateClient();

        var register = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/register",
            new
            {
                username = "longname",
                displayName = new string('n', 257),
                password = Password,
                email = "longname@test.local",
            });

        Assert.Equal(HttpStatusCode.BadRequest, register.StatusCode);
    }
}
