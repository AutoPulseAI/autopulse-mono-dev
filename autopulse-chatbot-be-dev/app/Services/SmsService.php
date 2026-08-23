<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class SmsService
{
    protected $apiKey;
    protected $apiUrl;

    public function __construct()
    {
        $this->apiKey = config('services.twilio.api_key', env('TWILIO_API_KEY'));
        $this->apiUrl = config('services.twilio.api_url', 'https://api.twilio.com/2010-04-01');
    }

    /**
     * Send SMS notification to manager
     */
    public function sendManagerReviewSms($phoneNumber, $userQuery, $chatbotId, $dealerName, $conversationId)
    {
        try {
            // Format phone number (remove any non-numeric characters except +)
            $formattedPhone = $this->formatPhoneNumber($phoneNumber);
            
            if (!$formattedPhone) {
                Log::error('Invalid phone number format: ' . $phoneNumber);
                return false;
            }

            $message = $this->buildManagerReviewMessage($userQuery, $chatbotId, $dealerName, $conversationId);

            // Send SMS using Twilio
            $response = $this->sendTwilioSms($formattedPhone, $message);

            if ($response['success']) {
                Log::info('SMS sent successfully to manager', [
                    'phone' => $formattedPhone,
                    'conversation_id' => $conversationId
                ]);
                return true;
            } else {
                Log::error('Failed to send SMS to manager', [
                    'phone' => $formattedPhone,
                    'error' => $response['error'],
                    'conversation_id' => $conversationId
                ]);
                return false;
            }

        } catch (\Exception $e) {
            Log::error('SMS service error: ' . $e->getMessage(), [
                'phone' => $phoneNumber,
                'conversation_id' => $conversationId
            ]);
            return false;
        }
    }

    /**
     * Send SMS using Twilio API
     */
    protected function sendTwilioSms($to, $message)
    {
        try {
            $accountSid = config('services.twilio.account_sid', env('TWILIO_ACCOUNT_SID'));
            $authToken = config('services.twilio.auth_token', env('TWILIO_AUTH_TOKEN'));
            $fromNumber = config('services.twilio.from_number', env('TWILIO_FROM_NUMBER'));

            if (!$accountSid || !$authToken || !$fromNumber) {
                return [
                    'success' => false,
                    'error' => 'Twilio configuration missing'
                ];
            }

            $response = Http::withBasicAuth($accountSid, $authToken)
                ->asForm()
                ->post("{$this->apiUrl}/Accounts/{$accountSid}/Messages.json", [
                    'From' => $fromNumber,
                    'To' => $to,
                    'Body' => $message
                ]);

            if ($response->successful()) {
                return [
                    'success' => true,
                    'message_id' => $response->json('sid')
                ];
            } else {
                return [
                    'success' => false,
                    'error' => $response->body()
                ];
            }

        } catch (\Exception $e) {
            return [
                'success' => false,
                'error' => $e->getMessage()
            ];
        }
    }

    /**
     * Build the SMS message for manager review
     */
    protected function buildManagerReviewMessage($userQuery, $chatbotId, $dealerName, $conversationId)
    {
        $timestamp = now()->format('M j, Y g:i A');
        $shortQuery = strlen($userQuery) > 100 ? substr($userQuery, 0, 100) . '...' : $userQuery;

        return "🔍 MANAGER REVIEW REQUIRED\n\n" .
               "Dealership: {$dealerName}\n" .
               "Customer Query: \"{$shortQuery}\"\n" .
               "Chatbot ID: {$chatbotId}\n" .
               "Conversation ID: {$conversationId}\n" .
               "Time: {$timestamp}\n\n" .
               "Please review this conversation and take appropriate action if needed.";
    }

    /**
     * Format phone number for international use
     */
    protected function formatPhoneNumber($phoneNumber)
    {
        // Remove all non-numeric characters except +
        $cleaned = preg_replace('/[^\d+]/', '', $phoneNumber);
        
        // If it doesn't start with +, assume it's a US number
        if (!str_starts_with($cleaned, '+')) {
            // Remove leading 1 if present
            if (str_starts_with($cleaned, '1') && strlen($cleaned) === 11) {
                $cleaned = substr($cleaned, 1);
            }
            // Add +1 for US numbers
            $cleaned = '+1' . $cleaned;
        }

        // Validate the format (should be + followed by 10-15 digits)
        if (preg_match('/^\+\d{10,15}$/', $cleaned)) {
            return $cleaned;
        }

        return null;
    }

    /**
     * Test SMS functionality
     */
    public function testSms($phoneNumber, $message = 'Test message from chatbot system')
    {
        return $this->sendTwilioSms($this->formatPhoneNumber($phoneNumber), $message);
    }
}
