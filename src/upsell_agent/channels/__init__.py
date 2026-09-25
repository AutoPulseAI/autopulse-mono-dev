"""Outbound channels. Only Twilio (SMS) and SendGrid (email) in production
(architecture §9); a fake driver everywhere else."""

from upsell_agent.channels.base import ChannelDriver
from upsell_agent.config import Settings


def get_channel_driver(settings: Settings) -> ChannelDriver:
    if settings.channel_driver == "fake":
        from upsell_agent.channels.fake import FakeChannelDriver

        return FakeChannelDriver()

    from upsell_agent.channels.live import LiveChannelDriver
    from upsell_agent.channels.sendgrid import SendGridEmailDriver
    from upsell_agent.channels.twilio import TwilioSmsDriver

    status_callback = (f"{settings.public_base_url.rstrip('/')}/v1/webhooks/twilio/status"
                       if settings.public_base_url else None)
    # Missing credentials fail here, at worker startup, not on the first send.
    return LiveChannelDriver(
        sms=TwilioSmsDriver(account_sid=settings.twilio_account_sid, auth_token=settings.twilio_auth_token,
                            api_base=settings.twilio_api_base, status_callback=status_callback),
        email=SendGridEmailDriver(api_key=settings.sendgrid_api_key, api_base=settings.sendgrid_api_base,
                                  from_email=settings.sendgrid_from_email),
        allowlist=None if settings.is_production else settings.allowlist,
    )
