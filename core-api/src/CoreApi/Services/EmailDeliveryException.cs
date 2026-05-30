namespace CoreApi.Services;

/// <summary>
/// Thrown by an <see cref="IEmailSender"/> when it cannot hand a message to its
/// transport (SMTP unreachable, authentication rejected, …). Distinct from an
/// unexpected bug so the API layer can answer "the email couldn't be sent"
/// (503) instead of a generic 500 — and so callers like registration can roll
/// back work that depended on the email going out.
/// </summary>
public sealed class EmailDeliveryException(string message, Exception? innerException = null)
    : Exception(message, innerException);
