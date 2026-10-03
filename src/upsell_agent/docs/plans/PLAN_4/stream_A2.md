# Stream A2: vehicle image, not link (MASTER_PLAN_4 F3)

Client (conversation_6): "we want to send an image not the link unless the customer asks for it... we need to
get them to the appointment stage."

## What was built

- `agent/vehicle_media.py` (new): the image check (`HttpImageChecker`: https, HEAD 200, `image/*`, Content-Length
  <= 5 MB; `OfflineImageChecker` for the fake driver, URL shape only, so unit tests never hit the network;
  `use_image_checker` for tests), `MMS_ENABLED` per dealer (`mms_enabled`), `pick_vehicle_photo` (always via
  `agent/media.py choose_photo`, tries up to 3 of the same vehicle's photos), `media_vin`, `lead_vehicle_vin`,
  `photo_for_draft`, `wants_link`.
- `agent/media.py`: `photo_candidates`, and `choose_photo(..., exclude=)` so the countdown can show a different
  photo each day. Same-VIN-only rule unchanged.
- `guardrails/link_guard.py` (new), called from `agent/nodes/guard.py` as check `no_link_unless_asked`: any URL
  fails unless `wants_link` (>= 0.8) and it is the `page_url` of a vehicle named in that same version.
- `agent/llm.py`: Extract `wants_link` + `wants_link_confidence`; Compose `sms_media_vin` / `email_media_vin`;
  prompt: no links unless `link_requested`, never mention a photo in words. `agent/nodes/compose.py` passes
  `link_requested`. Offline model does the same.
- `channels/base.py`: `OutboundMessage.media_urls` (additive tuple, default empty). Twilio sends `MediaUrl`,
  SendGrid shows an inline `<img>` after the greeting, fake driver records `media_urls`.
- `channels/sender.py`: `SendRequest.media_urls`, stored on the claimed `ai_messages` row; a resumed send uses the
  row's own photo; the platform record payload and `SendOutcome` carry it.
- `agent/turn.py`: the reply and the other-channel cadence send attach the photo (none when the freshness
  re-check swapped in the stock-free version). Day 2 / Day 5 touches (`vehicle_visual`, `vehicle_value`) that
  name no vehicle use the lead's own vehicle.
- `scheduler/followups.py`: countdown and no-show step 1 attach the lead's vehicle photo on both channels; the
  countdown's start index is days-to-appointment, so consecutive days differ.
- `api/dev.py`: conversation items include `media_urls` (Debug UI unchanged otherwise).
- `config.py`: `MMS_ENABLED` default true; dealer record `ai_mms_enabled: false` overrides.

## Decisions

1. Idempotency: the key stays `<turn>:<channel>`. "Covers media" = the photo is part of the claimed row, so a
   re-run is a duplicate and a resume sends the row's photo, never a second/different one.
2. The model never picks or writes a photo URL; it only names which named VIN the photo is for (falls back to
   the first named VIN). The photo is attached after the guard, so drafts must not mention it (the C6
   unattached-photo check is kept as is).
3. Missing Content-Length fails the check (can't show it fits Twilio's 5 MB limit).
4. SendGrid embeds by `<img src=https://...>` rather than a CID attachment (no download needed).
5. The dealer's own website (from its record) is still allowed when asked for, as before F3.
6. Lead vehicle = VIN on the lead (`vin`, `data.vin`, `data.vehicle.vin`), else the last vehicle we named.
7. MMS off affects SMS only; email keeps its inline image.

## Open items

- MMS cost review (about 3x an SMS) before rollout, per F3.
- The 24h channel-switch resend (`plan_followup`) is text only; it doesn't carry the photo yet.
- The platform's conversation screen doesn't render `media_urls` yet (sent in the record payload).
- Live: confirm real CDN HEAD responses include Content-Length / accept HEAD.
