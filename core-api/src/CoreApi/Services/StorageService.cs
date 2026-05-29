using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using CoreApi.Configuration;

namespace CoreApi.Services;

/// <summary>
/// MinIO (S3-compatible) access. Holds two clients, mirroring the legacy
/// <c>uploads.rs</c> design:
/// <list type="bullet">
///   <item><c>_internal</c> — the Docker-network endpoint, used for the
///   server-side HEAD verification that an object actually landed.</item>
///   <item><c>_presign</c> — the public endpoint baked into the presigned
///   PUT/GET URLs the client uses directly.</item>
/// </list>
/// </summary>
public sealed class StorageService : IDisposable
{
    private readonly AmazonS3Client _internal;
    private readonly AmazonS3Client _presign;
    private readonly string _bucket;
    private readonly string _presignScheme;

    public StorageService(ServiceOptions options)
    {
        _bucket = options.MinioBucket;
        _presignScheme = new Uri(options.MinioPublicEndpoint).Scheme;
        var credentials = new BasicAWSCredentials(options.MinioAccessKey, options.MinioSecretKey);

        _internal = BuildClient(credentials, options.MinioInternalEndpoint);
        _presign = BuildClient(credentials, options.MinioPublicEndpoint);
    }

    private static AmazonS3Client BuildClient(AWSCredentials credentials, string endpoint) =>
        new(credentials, new AmazonS3Config
        {
            ServiceURL = endpoint,
            ForcePathStyle = true,
            AuthenticationRegion = "us-east-1",
            UseHttp = endpoint.StartsWith("http://", StringComparison.OrdinalIgnoreCase),
        });

    /// <summary>Presigned PUT URL the client uploads raw bytes to directly.</summary>
    public async Task<string> PresignPutAsync(string storageKey, int expiresInSeconds) =>
        ForceScheme(await _presign.GetPreSignedURLAsync(new GetPreSignedUrlRequest
        {
            BucketName = _bucket,
            Key = storageKey,
            Verb = HttpVerb.PUT,
            Expires = DateTime.UtcNow.AddSeconds(expiresInSeconds),
        }));

    /// <summary>Short-lived presigned GET URL for displaying/downloading a file.</summary>
    public async Task<string> PresignGetAsync(string storageKey, int expiresInSeconds) =>
        ForceScheme(await _presign.GetPreSignedURLAsync(new GetPreSignedUrlRequest
        {
            BucketName = _bucket,
            Key = storageKey,
            Verb = HttpVerb.GET,
            Expires = DateTime.UtcNow.AddSeconds(expiresInSeconds),
        }));

    /// <summary>HEAD-checks an object via the internal endpoint.</summary>
    public async Task<bool> ObjectExistsAsync(string storageKey)
    {
        try
        {
            await _internal.GetObjectMetadataAsync(_bucket, storageKey);
            return true;
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return false;
        }
    }

    /// <summary>
    /// Rewrites the presigned URL's scheme to match the configured public
    /// endpoint. The SigV4 signature covers host, path, query and headers —
    /// not the scheme — so this swap is safe and keeps the URL valid. It is
    /// needed because the AWS SDK v4 endpoint resolver emits https even when
    /// the service URL is plain http (the dev MinIO case).
    /// </summary>
    private string ForceScheme(string url)
    {
        var builder = new UriBuilder(url) { Scheme = _presignScheme };
        if (builder.Uri.IsDefaultPort)
        {
            builder.Port = -1;
        }

        return builder.Uri.AbsoluteUri;
    }

    public void Dispose()
    {
        _internal.Dispose();
        _presign.Dispose();
    }
}
