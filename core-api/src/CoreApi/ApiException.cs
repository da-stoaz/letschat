using System.Net;

namespace CoreApi;

/// <summary>
/// A handled error that maps to an HTTP status and a <c>{ "error": "…" }</c>
/// JSON body — the exact response shape the legacy service produced, so the
/// client's error parsing (which reads <c>errorBody.error</c>) is unchanged.
/// </summary>
public sealed class ApiException(HttpStatusCode status, string message)
    : Exception(message)
{
    public HttpStatusCode Status { get; } = status;

    public static ApiException BadRequest(string message) =>
        new(HttpStatusCode.BadRequest, message);

    public static ApiException Unauthorized(string message) =>
        new(HttpStatusCode.Unauthorized, message);

    public static ApiException Conflict(string message) =>
        new(HttpStatusCode.Conflict, message);
}
