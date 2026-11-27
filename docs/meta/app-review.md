# Meta App Review: Mellox Inbox

What to paste into Meta's App Review for the **Mellox** app (ID 1646425650496239,
business portfolio Mellox AI, 1568028975356683), and what's done already.
Written 2026-11-27.

## Status

| Step                                                          | State                                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Business verification (MELLOX (PRIVATE) LIMITED)              | Done, verified 24 Nov 2026                                                                             |
| Privacy policy, terms                                         | `https://mellox.ai/privacy`, `https://mellox.ai/terms` (both name Meta data, AI replies and retention) |
| App icon, category (Business and pages), contact email        | Done                                                                                                   |
| Data deletion instructions (App settings → Basic)             | `https://mellox.ai/data-deletion`                                                                      |
| Deauthorize callback (Facebook Login for Business → Settings) | `https://mellox.ai/api/integrations/meta/deauthorize`                                                  |
| Data deletion request callback (same page)                    | `https://mellox.ai/api/integrations/meta/data-deletion`, status page `/data-deletion/status?code=…`    |
| Login configuration grants messaging scopes                   | Done (`pages_messaging`, `instagram_manage_messages`)                                                  |
| Become a Tech Provider (Dashboard)                            | **Owner's click**: needed to submit App Review; Meta says it can't be undone                           |
| Data handling questions                                       | After Tech Provider; answers below                                                                     |
| Screencasts (one per permission)                              | **To record**: script below                                                                            |
| Reviewer test account on Mellox                               | **To create**: a Mellox login with an active plan and the Inbox connected to a test Page               |
| Submit for review, then switch the app to Live                | After the above                                                                                        |

## Permissions and what to write for each

Use case to name everywhere: _Mellox is a marketing app for small businesses.
Its Inbox shows comments and messages people send to the business's own
Facebook Page and Instagram professional account, and lets the business answer
them, by hand or with Mox, Mellox's AI assistant, which only answers from the
business's own facts and leaves complaints, orders and anything sensitive to a
person._

**pages_show_list**: After the business signs in with Facebook Login for
Business, Mellox lists the Pages they chose so they can see which Page the
Inbox reads. Shown on Inbox → Setup check.

**business_management**: Pages and Instagram accounts owned by a business
portfolio are only listed when this is granted. Mellox uses it only to find
the Pages and Instagram accounts the person chose during sign-in; it never
changes the portfolio, its people or its assets.

**pages_read_engagement**: Mellox reads the Page's recent posts and their
comment counts so it only fetches comments where there are new ones, and shows
which post a comment was left on.

**pages_read_user_content**: Mellox reads the comments people leave on the
Page's posts and shows them in the Inbox, with the author's name, so the
business can answer.

**pages_manage_engagement**: When the business presses Send (or switched on
auto-reply / a quick reply), Mellox posts the reply under that comment on the
Page.

**pages_messaging**: Messenger conversations people start with the Page appear
in the Inbox. The business (or Mox, if switched on) answers within 24 hours of
the person's last message, as a RESPONSE message. Mellox never starts a
conversation, never sends promotions, and stops if the 24-hour window closed.

**pages_manage_metadata**: When a business connects, Mellox subscribes its
Page to Mellox's webhook (feed and messages). Meta then tells Mellox the
moment a new comment or message arrives, and the Inbox reads it within a
minute instead of waiting for the next scheduled read. Mellox changes no other
Page setting.

**instagram_basic**: Mellox reads the Instagram professional account's
username and recent posts so comments can be shown with the post they belong
to.

**instagram_manage_comments**: Mellox reads comments on the account's posts and
posts the business's reply under the comment.

**instagram_manage_messages**: Instagram Direct conversations people start
with the account appear in the Inbox and are answered within 24 hours of the
person's last message (1,000 characters at most). A quick reply can also send
one private reply to a commenter who asked for a link.

## Screencast script (record once, trim per permission)

Record at mellox.ai, signed in as the reviewer test account, English UI.

1. Open the workspace → sidebar **Inbox**. Show the empty Inbox and the line
   "Connect Instagram and Facebook".
2. Press **Connect**: Facebook Login for Business opens. Show the Page and
   Instagram account being chosen and every permission screen, then **Save**.
   (pages_show_list, business_management, instagram_basic)
3. Back in Mellox, open **Setup check**: Facebook, Instagram and messages are
   green. (pages_show_list)
4. From another account, comment on a Page post and on an Instagram post.
   Press **Refresh** in the Inbox: both comments appear with their post.
   (pages_read_engagement, pages_read_user_content, instagram_manage_comments)
5. Type a reply and press **Send**. Open the post on Facebook and Instagram and
   show the reply under the comment. (pages_manage_engagement,
   instagram_manage_comments)
6. From another account, send the Page a Messenger message and the Instagram
   account a DM. Press **Refresh**: both show as "Messenger" and "Instagram DM".
   Press **Send** on the draft, then show the answer arriving in Messenger and
   Instagram. (pages_messaging, instagram_manage_messages)
7. Turn **Auto-reply** on, send another question, and show Mox answering it,
   then show a complaint ("my order was broken") waiting for a person instead.
8. Show **Disconnect** in the Inbox, and the Data deletion page at
   mellox.ai/data-deletion.

## Data handling answers

- **Data processors / service providers:** Supabase (database and storage),
  Railway (hosting), KIE and OpenRouter (AI model gateways for drafting replies;
  OpenRouter requests set data_collection: deny), Resend (email
  notifications to the business's own team).
- **Who requests the data:** only the business that connected its own Page or
  Instagram account, and its team members in that Mellox workspace.
- **Sold, used for ads or shared with data brokers:** no.
- **Retention:** comments and messages are deleted 90 days after they arrive;
  everything from an account is deleted when it is disconnected, when Mellox is
  removed in Facebook (deauthorize callback) or on a deletion request (callback,
  immediate).
- **Security:** tokens encrypted with AES-256-GCM, every Graph call uses
  appsecret_proof, row-level security on every table, workspace roles checked on
  every request.
- **Public authorities' requests:** none received; policy is to refuse unless
  legally compelled and to tell the business where allowed.

## After approval

Switch the app to **Live** (App settings → top bar), then reconnect once in
Mellox so the live token carries Advanced Access. Every brand can then connect
without an app role.
