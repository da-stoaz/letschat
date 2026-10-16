using CoreApi.Services;
using MimeKit;

namespace CoreApi.Tests;

public sealed class EmailTemplatesTests
{
    [Fact]
    public void AccountEmails_IncludeAnEmbeddedPngMatchingTheHeaderReference()
    {
        var emails = new[]
        {
            EmailTemplates.EmailConfirmation("Test", "https://example.com/confirm"),
            EmailTemplates.PasswordReset("Test", "https://example.com/reset"),
            EmailTemplates.ExistingAccount("Test", "test"),
            EmailTemplates.AccountApproved("Test"),
        };

        foreach (var (_, html) in emails)
        {
            using var message = new MimeMessage { Body = EmailTemplates.CreateMessageBody(html) };
            using var wire = new MemoryStream();
            message.WriteTo(wire);
            wire.Position = 0;
            using var received = MimeMessage.Load(wire);
            var image = Assert.Single(received.BodyParts.OfType<MimePart>(), part => part.ContentId is not null);
            Assert.Equal("image/png", image.ContentType.MimeType);
            Assert.Contains($"src=\"cid:{image.ContentId}\"", received.HtmlBody);
            using var bytes = new MemoryStream();
            Assert.NotNull(image.Content);
            image.Content.DecodeTo(bytes);
            Assert.Equal(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }, bytes.ToArray()[..8]);
        }
    }
}
