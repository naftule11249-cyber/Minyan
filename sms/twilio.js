
/* ---- Twilio Function (Node 18+). Add an Environment Variable CONFIG_URL = https://YOUR-SITE/config.json
   and point your number's "A message comes in" webhook at this function. ---- */
exports.handler = async function (context, event, callback) {
  var twiml = new Twilio.twiml.MessagingResponse();
  try {
    var res = await fetch(context.CONFIG_URL, { cache: 'no-store' });
    var cfg = await res.json();
    twiml.message(MinyanSms.buildReply(cfg, event.Body || '', Date.now()).text);
  } catch (e) {
    twiml.message('Sorry, the schedule is unavailable right now. / הלוח אינו זמין כרגע');
  }
  return callback(null, twiml);
};
