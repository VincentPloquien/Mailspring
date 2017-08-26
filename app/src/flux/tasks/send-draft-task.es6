/* eslint global-require: 0 */
import url from 'url'
import AccountStore from '../stores/account-store';
import Task from './task';
import Actions from '../actions';
import SoundRegistry from '../../registries/sound-registry';
import Attributes from '../attributes';
import Message from '../models/message';

export default class SendDraftTask extends Task {

  static attributes = Object.assign({}, Task.attributes, {
    draft: Attributes.Object({
      modelKey: 'draft',
      itemClass: Message,
    }),
    headerMessageId: Attributes.String({
      modelKey: 'headerMessageId',
    }),
    emitError: Attributes.Boolean({
      modelKey: 'emitError',
    }),
    playSound: Attributes.Boolean({
      modelKey: 'playSound',
    }),
    allowMultiSend: Attributes.Boolean({
      modelKey: 'allowMultiSend',
    }),
    perRecipientBodies: Attributes.Object({
      modelKey: 'perRecipientBodies',
    }),
  });

  get accountId() {
    return this.draft.accountId;
  }

  set accountId(a) {
    // no-op
  }

  get headerMessageId() {
    return this.draft.headerMessageId;
  }

  set headerMessageId(h) {
    // no-op
  }

  constructor(...args) {
    super(...args);

    if (this.draft) {
      const OPEN_TRACKING_ID = NylasEnv.packages.pluginIdFor('open-tracking');
      const LINK_TRACKING_ID = NylasEnv.packages.pluginIdFor('link-tracking');

      const pluginsAvailable = (OPEN_TRACKING_ID && LINK_TRACKING_ID);
      const pluginsInUse = pluginsAvailable && (!!this.draft.metadataForPluginId(OPEN_TRACKING_ID) || !!this.draft.metadataForPluginId(LINK_TRACKING_ID));
      if (pluginsInUse) {
        const bodies = {
          self: this.draft.body,
        };
        this.draft.participants({includeFrom: false, includeBcc: true}).forEach((recipient) => {
          bodies[recipient.email] = this.personalizeBodyForRecipient(this.draft.body, recipient);
        })
        this.perRecipientBodies = bodies;
      }
    }
  }

  label() {
    return "Sending message";
  }

  validate() {
    const account = AccountStore.accountForEmail(this.draft.from[0].email);

    if (!this.draft.from[0]) {
      throw new Error("SendDraftTask - you must populate `from` before sending.");
    }
    if (!account) {
      throw new Error("SendDraftTask - you can only send drafts from a configured account.");
    }
    if (this.draft.accountId !== account.id) {
      throw new Error("The from address has changed since you started sending this draft. Double-check the draft and click 'Send' again.");
    }
  }

  onSuccess() {
    Actions.recordUserEvent("Draft Sent")
    Actions.draftDeliverySucceeded({headerMessageId: this.draft.headerMessageId});

    // Play the sending sound
    if (this.playSound && NylasEnv.config.get("core.sending.sounds")) {
      SoundRegistry.playSound('send');
    }
  }

  onError({key, debuginfo}) {
    let message = key;
    if (key === 'no-sent-folder') {
      message = "We couldn't find a Sent folder in your account.";
    }

    if (this.emitError) {
      Actions.draftDeliveryFailed({
        threadId: this.draft.threadId,
        headerMessageId: this.draft.headerMessageId,
        errorMessage: message,
        errorDetail: debuginfo,
      });
    }
    Actions.recordUserEvent("Draft Sending Errored", {
      error: message,
      key: key,
    })
  }


  // note - this code must match what is used for send-later!

  personalizeBodyForRecipient(_body, recipient) {
    const addRecipientToUrl = (originalUrl, email) => {
      const parsed = url.parse(originalUrl, true);
      const query = parsed.query || {}
      query.recipient = email;
      parsed.query = query;
      parsed.search = null // so the format will use the query. See url docs.
      return parsed.format()
    }

    let body = _body;

    // This adds a `recipient` param to the open tracking src url.
    body = body.replace(/<img class="n1-open".*?src="(.*?)">/g, (match, src) => {
      const newSrc = addRecipientToUrl(src, recipient.email)
      return `<img class="n1-open" width="0" height="0" style="border:0; width:0; height:0;" src="${newSrc}">`;
    });
    // This adds a `recipient` param to the link tracking tracking href url.
    const trackedLinkRegexp = new RegExp(/(<a.*?href\s*?=\s*?['"])((?!mailto).+?)(['"].*?>)([\s\S]*?)(<\/a>)/gim);

    body = body.replace(trackedLinkRegexp, (match, prefix, href, suffix, content, closingTag) => {
      const newHref = addRecipientToUrl(href, recipient.email)
      return `${prefix}${newHref}${suffix}${content}${closingTag}`;
    });

    body = body.replace('data-open-tracking-src=', 'src=');

    return body;
  }

}