<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Auth;

use App\Models\FacebookPage;
use App\Models\Dealer;
use App\Models\User;
use App\Models\Conversation;

// Keep/remove based on your project
use App\Models\ChatSetting;
use App\Models\DealerSource;
use App\Mail\ManagerReviewNotification;
use App\Services\SmsService;
use Illuminate\Support\Facades\Mail;

class MessengerWebhookController extends Controller
{
    protected $smsService;

    public function __construct(SmsService $smsService)
    {
        $this->smsService = $smsService;
    }

    /**
     * GET /api/webhook/facebook/{dealerId}
     * Facebook verification handshake
     */
    public $user_id;
    public function verifyWebhook(Request $request)
    {
        $mode        = $request->query('hub_mode');
        $verifyToken = $request->query('hub_verify_token');
        $challenge   = $request->query('hub_challenge');

        $expectedToken = config('services.facebook.webhook_token', env('FB_WEBHOOK_TOKEN'));

        Log::debug('Messenger webhook verification', [
            'mode'          => $mode,
            'verify_token'  => $verifyToken,
            'expected_set?' => !empty($expectedToken),
        ]);

        if ($mode === 'subscribe' && $verifyToken === $expectedToken) {
            return response($challenge, 200);
        }

        return response('Invalid token', 403);
    }

    /**
     * POST /api/webhook/facebook/{dealerId}
     * Handle incoming events
     */
    public function handleWebhook(Request $request)
    {
        $entries = $request->input('entry', []);

        Log::info('Messenger webhook payload received', [
            'object'      => $request->input('object'),
            'entry_count' => count($entries),
        ]);

        foreach ($entries as $entry) {
            $pageId = $entry['id'] ?? null;
            if (!$pageId) {
                Log::warning('Entry missing page_id', ['entry' => $entry]);
                continue;
            }

            $page = FacebookPage::where('page_id', $pageId)->first();
            if (!$page) {
                Log::warning('No FacebookPage record for page_id', ['page_id' => $pageId]);
                continue;
            }

            // Idempotent subscription helper
            $this->ensureWebhookSubscription($page);

            foreach ($entry['messaging'] ?? [] as $event) {
                $this->processEvent($event, $page);
            }
        }

        return response('EVENT_RECEIVED', 200);
    }

    /**
     * Subscribe the app to page events if not already
     */
    protected function ensureWebhookSubscription(FacebookPage $page): void
    {
        try {
            $response = Http::asForm()->post(
                "https://graph.facebook.com/v23.0/{$page->page_id}/subscribed_apps",
                [
                    'access_token'      => $page->access_token,
                    'subscribed_fields' => ['messages', 'messaging_postbacks'],
                ]
            );

            if ($response->successful()) {
                Log::info('Subscribed to page webhook events', [
                    'page_id'  => $page->page_id,
                    'response' => $response->json(),
                ]);
            } else {
                Log::error('Failed to subscribe to page webhook events', [
                    'page_id' => $page->page_id,
                    'error'   => $response->json(),
                ]);
            }
        } catch (\Throwable $e) {
            Log::error('Exception subscribing to page events', [
                'page_id' => $page->page_id,
                'error'   => $e->getMessage(),
            ]);
        }
    }

    /**
     * Process a single Messenger event
     */
    protected function processEvent(array $event, FacebookPage $page): void
    {
        $senderId = $event['sender']['id'] ?? null;
        if (!$senderId) {
            Log::warning('Event missing sender.id', ['event' => $event]);
            return;
        }

        // Ignore echo messages (messages that our page sent) to prevent loops/duplicates
        if (isset($event['message']['is_echo']) && $event['message']['is_echo']) {
            Log::debug('Ignoring echo message', [
                'sender_id' => $senderId,
                'mid'       => $event['message']['mid'] ?? null,
            ]);
            return;
        }

        $userProfile = $this->getUserProfile($senderId, $page->access_token);

        
        if ($userProfile) {
           $user= $this->storeOrUpdateUserFromMessenger($senderId, $page, $userProfile);
        } else {
            // create a stub so we still track the PSID under this page
           $user= User::firstOrCreate(
                ['messenger_page_id' => $page->page_id, 'messenger_psid' => $senderId]
            );
        }
        $this->user_id = $user->id; // Store user ID for later use  ;

        Log::debug('Processing Messenger event', [
            'page_id'     => $page->page_id,
            'sender_id'   => $senderId,
            'event_type'  => isset($event['message']) ? 'message' : (isset($event['postback']) ? 'postback' : 'unknown'),
            'userProfile' => $userProfile,
        ]);

        if (isset($event['message'])) {
            $this->processMessage($event['message'], $senderId, $page, $userProfile);
        } elseif (isset($event['postback'])) {
           // $this->processPostback($event['postback'], $senderId, $page, $userProfile);
        } else {
            Log::info('Unhandled event type', ['keys' => array_keys($event)]);
        }
    }

    /**
     * Fetch Messenger profile fields
     */

    protected function storeOrUpdateUserFromMessenger(string $psid, FacebookPage $page, ?array $profile): User
    {
        $user = User::firstOrNew([
            'messenger_page_id' => $page->page_id,
            'messenger_psid'    => $psid,
        ]);

        // Fill display fields only if you haven't already set them in your app
        if (empty($user->name)) {
            $full = trim(($profile['first_name'] ?? '').' '.($profile['last_name'] ?? ''));
            if ($full !== '') {
                $user->name = $full;
            }
        }
        if (empty($user->profile_pic) && !empty($profile['profile_pic'])) {
            $user->profile_pic = $profile['profile_pic'];
        }

        // Store email if available and not already set
        if (empty($user->email) && !empty($profile['email'])) {
            $user->email = $profile['email'];
        }

        // Note: Facebook doesn't provide phone number in basic profile
        // Phone would need to be collected through other means (forms, etc.)

        $user->save();
        
        // Log user information for debugging
        Log::info('User information stored/updated from Messenger', [
            'user_id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'phone_number' => $user->phone_number,
            'psid' => $psid,
        ]);
        
        return $user;
    }
    protected function getUserProfile(string $psid, string $accessToken): ?array
    {
        try {
            $res = Http::get("https://graph.facebook.com/v23.0/{$psid}", [
                'fields'        => 'first_name,last_name,profile_pic,locale,timezone,email',
                'access_token'  => $accessToken,
            ]);

            if ($res->successful()) {
                return $res->json();
            }

            Log::warning('Failed to fetch user profile', [
                'psid'  => $psid,
                'error' => $res->json(),
            ]);
        } catch (\Throwable $e) {
            Log::error('Exception fetching user profile', ['psid' => $psid, 'error' => $e->getMessage()]);
        }

        return null;
    }

    /**
     * Handle text / attachments
     */
    protected function processMessage(array $message, string $senderId, FacebookPage $page, ?array $userProfile = null): void
    {
        $text        = $message['text'] ?? null;
        $attachments = $message['attachments'] ?? [];
        $messageId   = $message['mid'] ?? null;

        // Prevent duplicate processing using message ID (atomic add)
        if ($messageId) {
            $cacheKey = "processed_message_{$messageId}";
            $added = cache()->add($cacheKey, true, 3600); // only sets if not present
            if (!$added) {
                Log::info('Duplicate message detected, skipping processing', [
                    'message_id' => $messageId,
                    'sender_id'  => $senderId,
                ]);
                return;
            }
        }

        Log::info('Incoming message', [
            'sender_id'         => $senderId,
            'sender_first_name' => $userProfile['first_name'] ?? null,
            'has_text'          => !is_null($text),
            'attachment_count'  => count($attachments),
            'text'            => $text,
            'message_id'      => $messageId,
        ]);

        // UX: show typing indicator
        $this->sendAction($page->access_token, $senderId, 'typing_on');

        if ($text !== null && $text !== '') {
            $botResult = $this->callChatbot($text, $page->dealer_id, $senderId);

            if (is_array($botResult) && isset($botResult['_autopulse'])) {
                // Build data
                $heading = $botResult['heading'] ?? null;
                $lead    = $botResult['text'] ?? 'Here are the results.';
                $toSend  = $heading ? ($heading . "\n\n" . $lead) : $lead;

                // Vehicle carousel if listings present (support both top-level and nested)
                $listings = data_get($botResult, 'vehicle.listings', []);
                if (empty($listings)) {
                    $listings = data_get($botResult, 'response.vehicle.listings', []);
                }

                // Send BOTH when present, but ensure each type is sent once
                $sentSomething = false;
                if (!empty(trim($toSend))) {
                    $this->sendMessage($page->access_token, $senderId, $toSend);
                    $sentSomething = true;
                }

                if (!empty($listings)) {
                    $elements = $this->buildVehicleCarouselElements($listings, $page, $senderId, 10);
                    Log::info('Element Array', [
                        'elements' => $elements
                    ]);
                    if (!empty($elements)) {
                        $this->sendGenericTemplate($page->access_token, $senderId, $elements);
                        $sentSomething = true;
                    }
                }
                if (!$sentSomething) {
                    // Fallback safety
                    $this->sendMessage($page->access_token, $senderId, 'Thanks!');
                }

                // 3) Buttons (View All / Open API)
               /* $buttons = [];
                if (!empty($botResult['weburl'])) {
                    $buttons[] = [
                        'type'  => 'web_url',
                        'url'   => $botResult['weburl'],
                        'title' => 'View All Results',
                    ];
                }
                if (!empty($botResult['apiurl'])) {
                    $buttons[] = [
                        'type'  => 'web_url',
                        'url'   => $botResult['apiurl'],
                        'title' => 'Open API',
                    ];
                }
                if (!empty($buttons)) {
                    $this->sendButtonsTemplate($page->access_token, $senderId, 'Open full results or API:', $buttons);
                }*/
            } else {
                // Fallback plain text - only send if we have a valid response
                $reply = is_string($botResult) ? $botResult : 'Thanks! Here are your results.';
                if (!empty(trim($reply))) {
                    $this->sendMessage($page->access_token, $senderId, $this->truncate($reply, 640));
                }
            }
        } elseif (!empty($attachments)) {
            $this->handleAttachments($attachments, $senderId, $page);
        } else {
            $this->sendMessage($page->access_token, $senderId, "Sorry, I didn’t catch that.");
        }

        $this->sendAction($page->access_token, $senderId, 'typing_off');
    }

    /**
     * Handle postbacks (buttons, quick replies with payload)
     */
    protected function processPostback(array $postback, string $senderId, FacebookPage $page, ?array $userProfile = null): void
    {
        $payload = $postback['payload'] ?? '(no payload)';
        $postbackId = $postback['mid'] ?? null;

        // Prevent duplicate processing using postback ID (atomic add)
        if ($postbackId) {
            $cacheKey = "processed_postback_{$postbackId}";
            $added = cache()->add($cacheKey, true, 3600);
            if (!$added) {
                Log::info('Duplicate postback detected, skipping processing', [
                    'postback_id' => $postbackId,
                    'sender_id'   => $senderId,
                ]);
                return;
            }
        }

        Log::info('Postback', ['sender_id' => $senderId, 'payload' => $payload, 'postback_id' => $postbackId]);
        //$this->sendMessage($page->access_token, $senderId, "Thanks! Postback received: {$payload}");
    }

    /**
     * Call your chatbot service and normalize the payload.
     * Returns either a structured array (with _autopulse) or a plain string.
     */
    protected function callChatbot(string $messageText, int $dealerId, string $senderId): array|string
    {
        try {
            $dealer = Dealer::find($dealerId);
            if (!$dealer) {
                Log::warning('callChatbot: dealer not found', ['dealer_id' => $dealerId]);
                return 'Sorry, I could not identify the dealer.';
            }

            $chatbotSetting = ChatSetting::where('uuid', $dealer->uuid)->first()
                ?: ChatSetting::where('dealer_id', $dealerId)->first();

            if (!$chatbotSetting) {
                Log::warning('callChatbot: chat settings not found', ['dealer_id' => $dealerId]);
                return 'Chatbot settings are not configured yet.';
            }

            $dealerSource = DealerSource::where('dealer_id', $dealerId)->first();
            if (!$dealerSource || !$dealerSource->is_subscribed || ($dealerSource->cancelled_at && now()->gt($dealerSource->cancelled_at))) {
                return 'Your subscription appears inactive. Please renew to continue.';
            }

            $url = env('CHAT_BOT_SERVER_URL');
            if (!$url) {
                Log::error('CHAT_BOT_SERVER_URL is not set');
                return 'Bot server is not configured.';
            }
            $context ='';
            $oldconversation =Conversation::where('conversation_id', $senderId)->orderBy('response_timestamp','desc')->first();
            if($oldconversation){
                $context = $oldconversation->context ?? '';
            }

            // Get user information from database
            $user = User::find($this->user_id);
            $customerName = '';
            $customerEmail = '';
            $customerPhone = '';
            
            if ($user) {
                $customerName = $user->name ?? '';
                $customerEmail = $user->email ?? '';
                $customerPhone = $user->phone_number ?? '';
            }

            $payload = [
                'request'         => $messageText,
                'context'         => $context,
                'conversation_id' => $senderId,
                'customerId'     => $this->user_id,
                'dealer_id'       => $dealerId,
                'ip'              => request()->ip(),
                'dealersource'    => $chatbotSetting->dealership_url ?? '',
                'chatbotname'     => $chatbotSetting->chatbot_name ?? '',
                'dealership_name' => $chatbotSetting->dealership_name ?? '',
                // Customer information from Messenger user profile
                'customer_name'   => $customerName,
                'customer_email'  => $customerEmail,
                'customer_phone'  => $customerPhone,
                'booking_date'    => '',
                'booking_time'    => '',
                // Page information (will be empty for Messenger)
                'current_url'     => '',
                'page_title'      => '',
                'referrer'        => '',
                'user_agent'      => '',
            ];

            // Log the payload being sent to chatbot for debugging
            Log::info('Sending user information to chatbot', [
                'sender_id' => $senderId,
                'customer_name' => $customerName,
                'customer_email' => $customerEmail,
                'customer_phone' => $customerPhone,
            ]);

            $res = Http::timeout(25)->acceptJson()->asJson()->post($url, $payload);
            //Log::debug('callChatbot response body', ['body' => $res->body()]);

            if (!$res->successful()) {
                Log::error('callChatbot: bot server error', [
                    'status' => $res->status(),
                    'body'   => $res->body(),
                ]);
                return 'I had trouble contacting the bot service.';
            }

            $data = $res->json();
            if($this->user_id){
               
            }
            $newconversation =Conversation::where('conversation_id', $senderId)->orderBy('id','desc')->first();
            if($newconversation){
                $context .= $data['rawoutput'] ?? '';
                $newconversation->update([ 'context' => $context,'chat_source'=>'facebook']);
            }
            Conversation::where('conversation_id', $senderId)
                ->update(['user_id' => $this->user_id]);

            // Check for manager review requirement
            if(isset($data['manager_review']) && ($data['manager_review'])){
                $manager_email = $chatbotSetting->managerial_contact_email;
                $manager_phone = $chatbotSetting->managerial_contact_phone;
                $userQuery = $messageText; // Use the actual message text
                $conversationId = $senderId; // Use sender ID as conversation ID for Facebook
                $chatbotId = $chatbotSetting->uuid ?? $dealerId;
                $dealerName = $chatbotSetting->dealership_name ?? 'Unknown Dealership';

                // Send email notification to manager
                if ($manager_email) {
                    try {
                        Mail::to($manager_email)->send(new ManagerReviewNotification(
                            $userQuery,
                            $chatbotId,
                            $dealerName,
                            $conversationId
                        ));
                        
                        Log::info('Manager review email sent successfully (Facebook)', [
                            'email' => $manager_email,
                            'conversation_id' => $conversationId,
                            'chatbot_id' => $chatbotId
                        ]);
                    } catch (\Exception $e) {
                        Log::error('Failed to send manager review email (Facebook)', [
                            'email' => $manager_email,
                            'error' => $e->getMessage(),
                            'conversation_id' => $conversationId
                        ]);
                    }
                }

                // Send SMS notification to manager
                /*if ($manager_phone) {
                    try {
                        $smsSent = $this->smsService->sendManagerReviewSms(
                            $manager_phone,
                            $userQuery,
                            $chatbotId,
                            $dealerName,
                            $conversationId
                        );
                        
                        if ($smsSent) {
                            Log::info('Manager review SMS sent successfully (Facebook)', [
                                'phone' => $manager_phone,
                                'conversation_id' => $conversationId,
                                'chatbot_id' => $chatbotId
                            ]);
                        }
                    } catch (\Exception $e) {
                        Log::error('Failed to send manager review SMS (Facebook)', [
                            'phone' => $manager_phone,
                            'error' => $e->getMessage(),
                            'conversation_id' => $conversationId
                        ]);
                    }
                }

                // Log manager review requirement
                Log::info('Manager review required for Facebook conversation', [
                    'conversation_id' => $conversationId,
                    'chatbot_id' => $chatbotId,
                    'dealer_name' => $dealerName,
                    'user_query' => $userQuery,
                    'email_sent' => !empty($manager_email),
                    'sms_sent' => !empty($manager_phone)
                ]);*/
            }

            // Your service often returns ["{...json...}"]
            if (is_array($data) && isset($data[0]) && is_string($data[0])) {
                $inner = json_decode($data[0], true);
                if (json_last_error() === JSON_ERROR_NONE && is_array($inner)) {
                    return $this->normalizeAutopulsePayload($inner);
                }
            }

            // Or an associative array already
            if (is_array($data) && (isset($data['response']) || isset($data['rawoutput']) || isset($data['vehicle']))) {
                return $this->normalizeAutopulsePayload($data);
            }

            // Or a string
            if (is_string($data)) {
                return $data;
            }

            return 'I’m here! (But I didn’t understand the bot response.)';
        } catch (\Throwable $e) {
            Log::error('callChatbot exception', ['dealer_id' => $dealerId, 'error' => $e->getMessage()]);
            return 'Error contacting chatbot.';
        }
    }

    /** Strip basic Markdown so Messenger doesn't show raw asterisks/underscores. */
    protected function stripBasicMarkdown(?string $text): string
    {
        $text = (string) $text;

        // remove **bold**, __bold__, *italic*, _italic_, `code`
        $patterns = [
            '/\*\*(.*?)\*\*/s',
            '/__(.*?)__/s',
            '/\*(.*?)\*/s',
            '/_(.*?)_/s',
            '/`{1,3}(.*?)`{1,3}/s',
            '/^>{1}\s?/m',     // blockquote markers
            '/^#{1,6}\s*/m',   // heading markers
        ];
        $replacements = ['$1', '$1', '$1', '$1', '$1', '', ''];
        $text = preg_replace($patterns, $replacements, $text);

        // drop any stray HTML, normalize whitespace
        $text = strip_tags($text);
        $text = preg_replace('/[ \t]+/', ' ', $text);
        $text = preg_replace('/\s*\n\s*/', "\n", $text);

        return trim($text);
    }


    /**
     * Normalize Autopulse payload (handles heading/subheading/paragraphs/list + vehicle listings)
     */
    protected function normalizeAutopulsePayload(array $p): array
    {
        $heading = null;
        $text    = null;
        $parsedResponse = null;

        if (!empty($p['response']) && is_string($p['response'])) {
            $parsedResponse = json_decode($p['response'], true);
            if (json_last_error() === JSON_ERROR_NONE && is_array($parsedResponse)) {
                $heading = $parsedResponse['heading'] ?? null;
                $heading = $heading ? $this->stripBasicMarkdown($heading) : null;
                $text    = $this->formatAutopulseText($parsedResponse); // this also sanitizes markdown
            }
        }

        if (!$text) {
            $text = $p['rawoutput'] ?? $p['Message'] ?? 'Here are the results.';
            $text = $this->stripBasicMarkdown($text);
        }

        $vehicle = $p['vehicle'] ?? null;
        if (!$vehicle && is_array($parsedResponse) && isset($parsedResponse['vehicle'])) {
            $vehicle = $parsedResponse['vehicle'];
        }

        return [
            '_autopulse' => true,
            'heading'    => $heading,
            'text'       => $text,
            'apiurl'     => $p['apiurl'] ?? null,
            'weburl'     => $p['weburl'] ?? null,
            'vehicle'    => $vehicle,
            'response'   => $parsedResponse ?: null,
            'raw'        => $p,
        ];
    }


    /**
     * Convert the structured `response` JSON to a readable block
     * (heading/subheading handled separately in processMessage)
     */
    protected function formatAutopulseText(array $resp): string
    {
        $paras = $resp['paragraphs'] ?? [];
        $list  = $resp['list'] ?? [];

        $parts = [];
        foreach ($paras as $p)     $parts[] = $p;

        if (!empty($list)) {
            $bullets = array_map(fn($l) => '• ' . trim(strip_tags($l)), $list);
            $parts[] = implode("\n", $bullets);
        }

        $text = trim(implode("\n\n", array_filter($parts)));
        return $text !== '' ? $text : 'Here are the results.';
    }

    /**
     * Build Generic Template elements (max 10)
     */
    protected function buildVehicleCarouselElements(array $listings,$page,$senderId, int $limit = 10): array
    {
        $elements = [];
        $slice = array_slice($listings, 0, min($limit, 10));

        foreach ($slice as $v) {
            $title = $v['heading']
                ?? trim(($v['build']['year'] ?? '') . ' ' . ($v['build']['make'] ?? '') . ' ' . ($v['build']['model'] ?? ''));

            $title = $this->truncate($title ?: 'Vehicle', 80);

            $price  = isset($v['price']) ? '$' . number_format((float)$v['price']) : null;
            $miles  = isset($v['miles']) ? number_format((int)$v['miles']) . ' mi' : null;
            $city   = data_get($v, 'dealer.city');
            $state  = data_get($v, 'dealer.state');
            $loc    = trim(($city ? $city : '') . ($state ? ', ' . $state : ''));
            $pieces = array_filter([$price, $miles, $loc]);
            $subtitle = $this->truncate(implode(' • ', $pieces) ?: 'Tap to view details', 80);

            $img    = data_get($v, 'media.photo_links.0');
            $vdp    = $v['vdp_url'] ?? null;
            $phone  = data_get($v, 'dealer.phone');

            $buttons = [];
            if ($vdp) {
                $buttons[] = [
                    'type'  => 'web_url',
                    'url'   => $vdp,
                    'title' => 'View Details',
                ];
            }
            
            // Add Book Visit button
            $bookingUrl = url('/booking/visit') . '?' . http_build_query([
                'dealer_id' => $page->dealer_id,
                'utm_source' => 'facebook_messenger',
                'user_id' => $this->user_id,
                'conversation_id' => $senderId,
                'vehicle_id' => $v['id'] ?? null,
                'vehicle_title' => urlencode($title)
            ]);
            
            $buttons[] = [
                'type'  => 'web_url',
                'url'   => $bookingUrl,
                'title' => 'Book Visit',
            ];

            $element = [
                'title'     => $title,
                'subtitle'  => $subtitle,
                'buttons'   => array_slice($buttons, 0, 3),
            ];

            if ($img) {
                $element['image_url'] = $img;
            }
            if ($vdp) {
                $element['default_action'] = [
                    'type' => 'web_url',
                    'url'  => $vdp,
                ];
            }

            $elements[] = $element;
        }


        return $elements;
    }

    /**
     * Send Generic Template (carousel)
     */
    protected function sendGenericTemplate(string $accessToken, string $recipientId, array $elements): void
    {
        try {
            $payload = [
                'recipient' => ['id' => $recipientId],
                'message'   => [
                    'attachment' => [
                        'type'    => 'template',
                        'payload' => [
                            'template_type' => 'generic',
                            'elements'      => $elements,
                        ],
                    ],
                ],
                'access_token' => $accessToken,
            ];

            $resp = Http::timeout(15)->acceptJson()->asJson()
                ->post("https://graph.facebook.com/v23.0/me/messages", $payload);

            if ($resp->failed()) {
                Log::error('sendGenericTemplate failed', ['status' => $resp->status(), 'body' => $resp->body()]);
            }
        } catch (\Throwable $e) {
            Log::error('sendGenericTemplate exception', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Buttons template (for “View All”, “Open API”)
     */
    protected function sendButtonsTemplate(string $accessToken, string $recipientId, string $title, array $buttons): void
    {
        $title = $this->truncate($title, 640);
        try {
            $payload = [
                'recipient' => ['id' => $recipientId],
                'message'   => [
                    'attachment' => [
                        'type'    => 'template',
                        'payload' => [
                            'template_type' => 'button',
                            'text'          => $title,
                            'buttons'       => array_slice($buttons, 0, 3),
                        ],
                    ],
                ],
                'access_token' => $accessToken,
            ];

            $resp = Http::timeout(15)->acceptJson()->asJson()
                ->post("https://graph.facebook.com/v23.0/me/messages", $payload);

            if ($resp->failed()) {
                Log::error('sendButtonsTemplate failed', ['status' => $resp->status(), 'body' => $resp->body()]);
            }
        } catch (\Throwable $e) {
            Log::error('sendButtonsTemplate exception', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Send a plain text message
     */
    protected function sendMessage(string $accessToken, string $recipientId, string $text): void
    {
        try {
            Log::debug('Sending Messenger message', [
                'recipient_id'   => $recipientId,
                'message_length' => strlen($text),
            ]);

            $response = Http::timeout(15)
                ->acceptJson()
                ->asJson()
                ->post("https://graph.facebook.com/v23.0/me/messages", [
                    'messaging_type' => 'RESPONSE',
                    'recipient'      => ['id' => $recipientId],
                    'message'        => ['text' => $text],
                    'access_token'   => $accessToken,
                ]);

            if ($response->successful()) {
                Log::info('Message sent', ['recipient_id' => $recipientId, 'resp' => $response->json()]);
            } else {
                Log::error('Messenger send failed', ['recipient_id' => $recipientId, 'error' => $response->json()]);
            }
        } catch (\Throwable $e) {
            Log::error('Exception sending Messenger message', [
                'recipient_id' => $recipientId,
                'error'        => $e->getMessage(),
            ]);
        }
    }

    /**
     * Optional UX: typing indicators
     */
    protected function sendAction(string $accessToken, string $recipientId, string $action = 'typing_on'): void
    {
        try {
            Http::timeout(10)
                ->acceptJson()
                ->asJson()
                ->post("https://graph.facebook.com/v23.0/me/messages", [
                    'recipient'     => ['id' => $recipientId],
                    'sender_action' => $action,
                    'access_token'  => $accessToken,
                ]);
        } catch (\Throwable $e) {
            Log::debug('sendAction failed (non-fatal)', ['error' => $e->getMessage()]);
        }
    }

    /**
     * POST /api/webhook/facebook/test
     * Quick integration checks
     */
    public function testWebhook(Request $request)
    {
        $dealer = Auth::guard('dealer')->user();
        if (!$dealer) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
        }

        $page = FacebookPage::where('dealer_id', $dealer->id)->first();
        if (!$page) {
            return response()->json(['success' => false, 'message' => 'No Facebook page connected'], 404);
        }

        try {
            // 1) Token validity
            $tokenCheck = Http::get("https://graph.facebook.com/v23.0/debug_token", [
                'input_token'  => $page->access_token,
                'access_token' => config('services.facebook.app_id') . '|' . config('services.facebook.app_secret'),
            ]);

            if (!$tokenCheck->successful() || !data_get($tokenCheck->json(), 'data.is_valid')) {
                throw new \Exception('Invalid access token: ' . $tokenCheck->body());
            }

            // 2) Page subscription
            $subscriptionCheck = Http::get("https://graph.facebook.com/v23.0/{$page->page_id}/subscribed_apps", [
                'access_token' => $page->access_token,
            ]);
            if (!$subscriptionCheck->successful()) {
                throw new \Exception('Subscription check failed: ' . $subscriptionCheck->body());
            }

            // 3) App-level subscriptions (optional)
            $webhookCheck = Http::get("https://graph.facebook.com/v23.0/{$page->page_id}/subscriptions", [
                'access_token' => config('services.facebook.app_id') . '|' . config('services.facebook.app_secret'),
            ]);
            if (!$webhookCheck->successful()) {
                throw new \Exception('Webhook check failed: ' . $webhookCheck->body());
            }

            return response()->json([
                'success'        => true,
                'message'        => 'Webhook configuration is valid',
                'token_valid'    => true,
                'subscribed'     => true,
                'webhook_active' => true,
            ]);
        } catch (\Throwable $e) {
            Log::error('Webhook test failed', ['dealer_id' => $dealer->id, 'error' => $e->getMessage()]);

            return response()->json([
                'success'        => false,
                'message'        => $e->getMessage(),
                'token_valid'    => false,
                'subscribed'     => false,
                'webhook_active' => false,
            ], 400);
        }
    }

    /** Utility: safe truncation for FB limits */
    protected function truncate(?string $text, int $limit): string
    {
        $text = $text ?? '';
        return mb_strwidth($text, 'UTF-8') > $limit
            ? rtrim(mb_strimwidth($text, 0, $limit, '', 'UTF-8')) . '…'
            : $text;
    }
}
