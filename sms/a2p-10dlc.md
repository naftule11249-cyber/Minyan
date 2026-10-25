# A2P 10DLC registration — answers for the Twilio forms

Carriers require every business texting from a US local number to register a **Brand** (who you are)
and a **Campaign** (what you send). Most rejections come from: a privacy policy without the SMS
sentence, no public page that shows how people opt in, or sample messages that don't match the
description. The site now has both pages ready: `sms.html` (program details) and `privacy.html`.

Prerequisite: the website online (so the two pages have public addresses), and the Twilio number bought.
Fees are one-time registration charges plus a small monthly campaign fee; Twilio shows the current
amounts on the registration screen.

## 1. Brand (Trust Hub → A2P 10DLC → Register a brand)

| Field | What to enter |
|---|---|
| Business type | **Sole proprietor**: the service is run privately under your own name, not by the shul (a shul-owned registration would be "Non-profit organization" with the shul's EIN) |
| Legal business name | Your own full legal name, exactly as on your ID |
| EIN | Not needed for a sole proprietor |
| Address | Your own US address |
| Website | `https://minyan.cascadeshul.org/` |
| Industry / vertical | Religion / Non-profit |
| Business registration region | USA |
| Authorized representative | Your name, title "Owner", email and your mobile number (a verification code is texted to it) |

Sole proprietor path (no EIN): one number only, US address, your personal mobile for a verification code,
capped at about 1,000 message segments a day. Plenty for a shul.

## 2. Campaign (after the brand is approved → Create campaign)

| Field | What to enter |
|---|---|
| Use case | **Low volume mixed** (or "Customer care"). Not "Marketing". |
| Campaign description | People text a keyword such as MINYAN (or מנין) to the Cascade Zmanim number and receive one automated reply with the time of the next prayer service (minyan), the room, and today's prayer times. Replies are sent only in direct response to an inbound message from the user. No marketing, no recurring messages. |
| Message flow / how users opt in | Users opt in by sending a keyword to the number. The keyword and the number are published at https://minyan.cascadeshul.org/sms.html and on a sign in the synagogue. Each reply answers only the message that was just received. Users can reply STOP at any time to opt out and HELP for help. |
| Opt-in keywords | MINYAN, NEXT, מנין |
| Opt-in message (confirmation) | Not needed for a keyword-initiated reply; if the form insists: "Cascade Zmanim: you'll receive one reply per message you send. Msg&data rates may apply. Reply STOP to opt out, HELP for help." |
| Opt-out keywords | STOP, UNSUBSCRIBE, CANCEL, END, QUIT |
| Opt-out message | You have been unsubscribed from Cascade Zmanim minyan times. No further messages will be sent. |
| Help keywords | HELP, INFO |
| Help message | Cascade Zmanim minyan times: text MINYAN, SHACHARIS, MINCHA, MAARIV, TODAY, TOMORROW or ZMANIM. Reply STOP to opt out. Msg&data rates may apply. |
| Sample message 1 | Cascade Zmanim: Next minyan: Shacharis – ברך משה 7:15 (Hodu 7:25), in 12 min. Then: דברי יואל 7:40. Reply STOP to opt out. |
| Sample message 2 | Cascade Zmanim: Mincha today: 1:10 ברך משה, 5:45 דברי יואל, 6:00 ברך משה. Reply STOP to opt out. |
| Message content attributes | Embedded links: No · Embedded phone numbers: No · Age-gated content: No · Direct lending: No |
| Subscriber opt-in | Yes · Subscriber opt-out | Yes · Subscriber help | Yes |
| Number pooling | No |
| Privacy policy | `https://minyan.cascadeshul.org/privacy.html` |
| Terms / program page | `https://minyan.cascadeshul.org/sms.html` |

Put the service name (Cascade Zmanim) at the start of the sample messages (carriers want to see who the sender is);
the live replies and the program page carry it too.

## 3. Attach the number

Messaging → Services → the Messaging Service that the campaign created → Sender Pool → add your number.
Then under Integration keep "Defaults" or point incoming messages at the `/minyan` Function.

## 4. What to expect

Brand approval is usually instant or a day; campaign vetting typically one to five business days.
If the campaign comes back rejected, the reason text says what is missing; the usual fixes are the
privacy-policy SMS sentence (already on the page), the opt-in page link, or sample messages that
mention Cascade Zmanim and STOP. Resubmitting is free in the first attempts.
