<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\SmsService;
use App\Mail\ManagerReviewNotification;
use Illuminate\Support\Facades\Mail;

class TestSmsNotification extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'test:sms {phone} {--email=}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Test SMS and Email notifications for manager review';

    protected $smsService;

    public function __construct(SmsService $smsService)
    {
        parent::__construct();
        $this->smsService = $smsService;
    }

    /**
     * Execute the console command.
     */
    public function handle()
    {
        $phone = $this->argument('phone');
        $email = $this->option('email');

        $this->info('Testing Manager Review Notifications...');
        $this->newLine();

        // Test data
        $userQuery = 'I am interested in purchasing a 2023 Honda Civic. Can you help me with financing options?';
        $chatbotId = 'test-chatbot-123';
        $dealerName = 'Test Dealership';
        $conversationId = 'test-conversation-456';

        // Test SMS
        if ($phone) {
            $this->info('Sending SMS notification...');
            $smsResult = $this->smsService->sendManagerReviewSms(
                $phone,
                $userQuery,
                $chatbotId,
                $dealerName,
                $conversationId
            );

            if ($smsResult) {
                $this->info('✅ SMS sent successfully!');
            } else {
                $this->error('❌ SMS failed to send. Check logs for details.');
            }
            $this->newLine();
        }

        // Test Email
        if ($email) {
            $this->info('Sending Email notification...');
            try {
                Mail::to($email)->send(new ManagerReviewNotification(
                    $userQuery,
                    $chatbotId,
                    $dealerName,
                    $conversationId
                ));
                $this->info('✅ Email sent successfully!');
            } catch (\Exception $e) {
                $this->error('❌ Email failed to send: ' . $e->getMessage());
            }
            $this->newLine();
        }

        $this->info('Test completed. Check your phone and email for notifications.');
    }
}
