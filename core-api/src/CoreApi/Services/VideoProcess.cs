using System.Diagnostics;

namespace CoreApi.Services;

internal static class VideoProcess
{
    internal const string Formats = "mov,matroska,avi,mpegts,ogg,flv";

    internal static ProcessStartInfo StartInfo(string executable, params string[] arguments)
    {
        var sandbox = Environment.IsPrivilegedProcess && File.Exists("/usr/bin/setpriv");
        var info = new ProcessStartInfo(sandbox ? "/usr/bin/setpriv" : executable)
        {
            RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false,
        };
        info.Environment.Clear();
        info.Environment["PATH"] = "/usr/local/bin:/usr/bin:/bin";
        if (sandbox)
            foreach (var flag in new[] { "--reuid=nobody", "--regid=nogroup", "--clear-groups", "--no-new-privs", executable })
                info.ArgumentList.Add(flag);
        foreach (var argument in arguments) info.ArgumentList.Add(argument);
        return info;
    }
}
