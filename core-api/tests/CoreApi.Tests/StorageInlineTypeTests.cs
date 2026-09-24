using CoreApi.Services;

namespace CoreApi.Tests;

/// <summary>
/// Downloads are served by storage-key extension (BUG_ANALYSIS A15), so an
/// upload without an extension takes one from its declared type — otherwise an
/// extensionless PDF would be forced to download and lose its preview.
/// </summary>
public sealed class StorageInlineTypeTests
{
    [Theory]
    [InlineData("application/pdf", "pdf")]
    [InlineData("image/png", "png")]
    [InlineData("video/mp4", "mp4")]
    [InlineData("text/html", null)]
    [InlineData("image/svg+xml", null)]
    public void Extensionless_Uploads_Get_The_Extension_Of_An_Inline_Type(string mimeType, string? extension) =>
        Assert.Equal(extension, StorageService.InlineExtension(mimeType));

    [Theory]
    [InlineData("uploads/ch/1/alice/a.PDF", "application/pdf")]
    [InlineData("uploads/ch/1/alice/clip.mp4.thumb.jpg", "image/jpeg")]
    [InlineData("uploads/ch/1/alice/page.html", null)]
    [InlineData("uploads/ch/1/alice/noextension", null)]
    public void Only_Known_Extensions_Are_Served_Inline(string storageKey, string? contentType) =>
        Assert.Equal(contentType, StorageService.InlineContentType(storageKey));
}
