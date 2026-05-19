using System.Net;

namespace CoreApi.Services;

/// <summary>
/// Builds the HTML bodies for transactional emails.
///
/// <para>
/// Email HTML is a constrained medium — no external stylesheets, no flexbox/grid
/// you can rely on, inconsistent client support. So the layout is table-based
/// with <c>role="presentation"</c>, every style is inline, fonts are web-safe
/// stacks, and the palette is light for broad readability.
/// </para>
/// </summary>
public static class EmailTemplates
{
    private const string FontStack =
        "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

    public static (string Subject, string HtmlBody) EmailConfirmation(
        string displayName, string confirmUrl)
    {
        const string subject = "Confirm your email for LetsChat";
        var body = Layout(
            "Confirm your email address",
            $"""
             <p style="margin:0 0 16px 0;">Hi {Escape(displayName)},</p>
             <p style="margin:0 0 8px 0;">
               Welcome to LetsChat. Tap the button below to confirm this email
               address and activate your account.
             </p>
             {Button("Confirm email address", confirmUrl)}
             <p style="margin:0 0 4px 0;font-size:13px;color:#6b7280;">
               Button not working? Paste this link into your browser:
             </p>
             <p style="margin:0;font-size:13px;word-break:break-all;">
               <a href="{Escape(confirmUrl)}" style="color:#4f46e5;text-decoration:underline;">{Escape(confirmUrl)}</a>
             </p>
             <p style="margin:24px 0 0 0;font-size:13px;color:#6b7280;">
               Didn't create a LetsChat account? You can safely ignore this email —
               nothing will happen without confirmation.
             </p>
             """);
        return (subject, body);
    }

    private static string Layout(string heading, string innerHtml) =>
        $"""
         <!doctype html>
         <html lang="en">
         <head>
           <meta charset="utf-8">
           <meta name="viewport" content="width=device-width, initial-scale=1">
           <meta name="x-apple-disable-message-reformatting">
           <title>{Escape(heading)}</title>
         </head>
         <body style="margin:0;padding:0;background-color:#eef0f4;">
           <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                  style="background-color:#eef0f4;">
             <tr>
               <td align="center" style="padding:36px 16px;">
                 <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0"
                        style="width:480px;max-width:100%;background-color:#ffffff;border-radius:16px;
                               border:1px solid #e4e7ec;box-shadow:0 1px 2px rgba(16,24,40,0.04);">
                   <tr>
                     <td style="padding:30px 36px 0 36px;font-family:{FontStack};">
                       <span style="font-size:19px;font-weight:700;letter-spacing:-0.01em;color:#4f46e5;">
                         Lets<span style="color:#0ea5e9;">Chat</span>
                       </span>
                     </td>
                   </tr>
                   <tr>
                     <td style="padding:22px 36px 4px 36px;font-family:{FontStack};">
                       <h1 style="margin:0 0 14px 0;font-size:22px;line-height:1.3;
                                  font-weight:700;color:#101828;">{Escape(heading)}</h1>
                       <div style="font-size:15px;line-height:1.65;color:#344054;">{innerHtml}</div>
                     </td>
                   </tr>
                   <tr>
                     <td style="padding:24px 36px 30px 36px;">
                       <div style="border-top:1px solid #eceef2;padding-top:16px;
                                   font-family:{FontStack};font-size:12px;line-height:1.6;color:#98a2b3;">
                         LetsChat — self-hosted chat. This is an automated message; replies aren't monitored.
                       </div>
                     </td>
                   </tr>
                 </table>
               </td>
             </tr>
           </table>
         </body>
         </html>
         """;

    private static string Button(string label, string url) =>
        $"""
         <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
           <tr>
             <td align="center" style="border-radius:10px;background-color:#4f46e5;">
               <a href="{Escape(url)}"
                  style="display:inline-block;padding:13px 30px;font-family:{FontStack};
                         font-size:15px;font-weight:600;line-height:1;color:#ffffff;
                         text-decoration:none;border-radius:10px;">{Escape(label)}</a>
             </td>
           </tr>
         </table>
         """;

    private static string Escape(string value) => WebUtility.HtmlEncode(value);
}
