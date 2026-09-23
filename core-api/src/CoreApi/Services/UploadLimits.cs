namespace CoreApi.Services;

public static class UploadLimits
{
    public const long MiB = 1024L * 1024;
    public const int DefaultPartMiB = 64;
    public const int DefaultFileMiB = 500;
    public const long DefaultDailyMiB = 2048;
    // 90 MiB leaves headroom under Cloudflare Free/Pro's 100 MB request cap.
    public const int MaxPartMiB = 90;
    public const int MaxFileMiB = 2048; // The existing daily rate limit is 2 GiB.

    public static string? ValidationError(
        int partMiB, int fileMiB, long dailyMiB, long userStoredMiB, long instanceStoredMiB)
    {
        if (partMiB is < 5 or > MaxPartMiB)
        {
            return $"Upload part size must be between 5 and {MaxPartMiB} MiB.";
        }
        if (fileMiB < partMiB || fileMiB > MaxFileMiB)
        {
            return $"Maximum file size must be between the part size and {MaxFileMiB} MiB.";
        }
        if (dailyMiB < 1 || dailyMiB > long.MaxValue / MiB)
            return "Daily upload quota must be a positive MiB value.";
        if (userStoredMiB < 0 || userStoredMiB > long.MaxValue / MiB
            || instanceStoredMiB < 0 || instanceStoredMiB > long.MaxValue / MiB)
            return "Stored-byte limits must be non-negative MiB values (0 means unlimited).";
        return null;
    }
}
